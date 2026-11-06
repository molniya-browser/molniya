import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDistribution } from '../src/build-distribution.mjs';
import { createHash } from 'node:crypto';

const fakeCert = Buffer.from('-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n');
const fakeSha = createHash('sha256').update(fakeCert).digest('hex');

// настоящий мини-XPI: Firefox сверяет имя файла с gecko.id манифеста
function miniXpi(id) {
  const dir = mkdtempSync(path.join(tmpdir(), 'xpi-'));
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    name: 'test', version: '1', manifest_version: 2,
    browser_specific_settings: { gecko: { id } },
  }));
  const z = path.join(dir, 'a.xpi');
  spawnSync('zip', ['-qrX', z, 'manifest.json'], { cwd: dir });
  return readFileSync(z);
}
const fakeXpi = miniXpi('test@molniya');

const baseOpts = (root) => ({
  zenTag: '1.24b',
  downloads: {
    cert: async () => fakeCert,
    ublock: async () => fakeXpi,
  },
  // подменяем пины, чтобы моки прошли проверку
  certs: [
    { file: 'russian_trusted_root_ca_pem.crt', url: 'u1', sha256: fakeSha },
    { file: 'russian_trusted_sub_ca_pem.crt', url: 'u2', sha256: fakeSha },
  ],
  ublock: { url: 'u3', version: '1.63.2', id: 'test@molniya', sha256: createHash('sha256').update(fakeXpi).digest('hex') },
});

test('policies.json: сертификаты голыми именами, Certificates/ с заглавной, весь disable-набор', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-'));
  await buildDistribution(root, baseOpts(root));
  const p = JSON.parse(readFileSync(path.join(root, 'distribution', 'policies.json'), 'utf8')).policies;
  assert.deepEqual(p.Certificates.Install, ['russian_trusted_root_ca_pem.crt', 'russian_trusted_sub_ca_pem.crt']);
  assert.equal(p.DisableTelemetry, true);
  assert.equal(p.DisableAppUpdate, true);
  assert.equal(p.DisableFeedbackCommands, true);
  assert.equal(p.DisableFirefoxStudies, true);
  assert.equal(p.OverrideFirstRunPage, '');
  assert.equal(p.OverridePostUpdatePage, '');
  assert.ok(existsSync(path.join(root, 'distribution', 'Certificates', 'russian_trusted_root_ca_pem.crt')));
});

test('policies.json: Яндекс поиском по умолчанию через SearchEngines.Add', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-'));
  await buildDistribution(root, baseOpts(root));
  const p = JSON.parse(readFileSync(path.join(root, 'distribution', 'policies.json'), 'utf8')).policies;
  assert.equal(p.SearchEngines.Default, 'Яндекс');
  const ya = p.SearchEngines.Add.find((e) => e.Name === 'Яндекс');
  assert.ok(ya, 'движок Яндекс описан');
  assert.equal(ya.Method, 'GET');
  assert.equal(ya.IconURL, 'https://yandex.ru/favicon.ico');
  assert.match(ya.URLTemplate, /^https:\/\/yandex\.ru\/search\/\?text=\{searchTerms\}$/);
});

test('policies.json: папка «Популярное» с русскими сайтами на панели закладок', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-'));
  await buildDistribution(root, baseOpts(root));
  const p = JSON.parse(readFileSync(path.join(root, 'distribution', 'policies.json'), 'utf8')).policies;
  assert.ok(Array.isArray(p.Bookmarks) && p.Bookmarks.length >= 6);
  const vk = p.Bookmarks.find((b) => b.Title === 'ВКонтакте');
  assert.equal(vk.Folder, 'Популярное');
  assert.equal(vk.Placement, 'toolbar');
  assert.ok(p.Bookmarks.every((b) => /^https:\/\//.test(b.URL)));
});

test('molniya.cfg: телеметрия off, защиты ON, локаль ru (Review Focus: защиты не вырублены)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-'));
  await buildDistribution(root, baseOpts(root));
  const cfg = readFileSync(path.join(root, 'molniya.cfg'), 'utf8');
  assert.match(cfg, /intl\.locale\.requested", "ru"/);
  assert.match(cfg, /browser\.search\.region", "RU"/);
  assert.match(cfg, /datareporting\.healthreport\.uploadEnabled", false/);
  assert.match(cfg, /browser\.safebrowsing\.phishing\.enabled", true/);
  assert.match(cfg, /browser\.safebrowsing\.malware\.enabled", true/);
  assert.match(cfg, /extensions\.update\.enabled", true/);
  assert.match(cfg, /app\.update\.enabled", false/);
  assert.doesNotMatch(cfg, /toolkit\.telemetry\.[a-z]+", true/);
});

test('autoconfig.js и distribution.ini на месте, uBlock упакован, хеши сверены', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-'));
  const res = await buildDistribution(root, baseOpts(root));
  const auto = readFileSync(path.join(root, 'defaults', 'pref', 'autoconfig.js'), 'utf8');
  assert.match(auto, /general\.config\.filename", "molniya\.cfg"/);
  const ini = readFileSync(path.join(root, 'distribution', 'distribution.ini'), 'utf8');
  assert.match(ini, /^id=molniya$/m);
  assert.match(ini, /Zen Browser/); // атрибуция обязательна
  const extDir = path.join(root, 'distribution', 'extensions');
  const exts = readdirSync(extDir);
  assert.ok(exts.includes('test@molniya.xpi'), 'имя файла = внутреннему ID расширения');
  assert.ok(res.files.length >= 5);
});

test('подмена сертификата на сервере валит генератор (CertPinError)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-'));
  const opts = baseOpts(root);
  opts.downloads.cert = async () => Buffer.from('EVIL');
  await assert.rejects(() => buildDistribution(root, opts));
});


test('XPI с чужим внутренним ID валит сборку (fail-fast)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dist-id-'));
  const opts = baseOpts(root);
  const alien = miniXpi('alien@example.com');
  opts.downloads.ublock = async () => alien;
  opts.ublock.sha256 = createHash('sha256').update(alien).digest('hex');
  await assert.rejects(() => buildDistribution(root, opts), /ID/);
});
