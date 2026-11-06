import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { patchInstallDir } from '../src/repack-win.mjs';

const fakeCert = Buffer.from('-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n');
const fakeSha = createHash('sha256').update(fakeCert).digest('hex');
// настоящий мини-XPI: buildDistribution сверяет имя файла с gecko.id
const xpiDir = mkdtempSync(path.join(tmpdir(), 'xpi-'));
writeFileSync(path.join(xpiDir, 'manifest.json'), JSON.stringify({
  name: 'test', version: '1', manifest_version: 2,
  browser_specific_settings: { gecko: { id: 'test@molniya' } },
}));
spawnSync('zip', ['-qrX', path.join(xpiDir, 'a.xpi'), 'manifest.json'], { cwd: xpiDir });
const fakeXpi = readFileSync(path.join(xpiDir, 'a.xpi'));

function zipFixture(dir, files) {
  const tree = path.join(dir, 'f-tree');
  for (const [rel, c] of Object.entries(files)) {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, c);
  }
  const z = path.join(dir, 'fixture.ja');
  spawnSync('zip', ['-qrX', z, '.'], { cwd: tree });
  return z;
}

test('patchInstallDir: бренд+identity+cfg+distribution на каталоге установки win', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'win-'));
  mkdirSync(path.join(dir, 'browser'), { recursive: true });
  const browserOmni = zipFixture(dir, { 'chrome/ru/locale/branding/brand.properties': 'brandShortName=Zen\nbrandFullName=Zen Browser\n' });
  spawnSync('cp', [browserOmni, path.join(dir, 'browser', 'omni.ja')]);
  const tkOmni = zipFixture(dir, { 'modules/AppConstants.sys.mjs': 'MOZ_APP_NAME: "zen",\nMOZ_APP_BASENAME: "Zen",\nMOZ_MACBUNDLE_ID: "app.zen-browser.zen",\n' });
  spawnSync('cp', [tkOmni, path.join(dir, 'omni.ja')]);
  writeFileSync(path.join(dir, 'application.ini'), '[App]\nVendor=Mozilla\nName=Zen\nProfile=zen\nBuildID=20261029123729\nVersion=1.24b\n');

  await patchInstallDir(dir, {
    zenTag: '1.24b',
    platform: 'win',
    downloads: { cert: async () => fakeCert, ublock: async () => fakeXpi },
    certs: [{ file: 'r.crt', url: 'u', sha256: fakeSha }, { file: 's.crt', url: 'u', sha256: fakeSha }],
    ublock: { url: 'u', version: '1', id: 'test@molniya', sha256: createHash('sha256').update(fakeXpi).digest('hex') },
  });

  const readFromZip = (z, rel) => spawnSync('7z', ['x', '-so', z, rel], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout;
  assert.match(readFromZip(path.join(dir, 'browser', 'omni.ja'), 'chrome/ru/locale/branding/brand.properties'), /Молния/);
  assert.match(readFromZip(path.join(dir, 'omni.ja'), 'modules/AppConstants.sys.mjs'), /MOZ_APP_NAME: "molniya"/);
  const ini = readFileSync(path.join(dir, 'application.ini'), 'utf8');
  assert.match(ini, /^Name=Molniya$/m);
  assert.match(ini, /^Profile=molniya$/m);
  assert.match(ini, /^BuildID=20\d{12}$/m);
  assert.ok(existsSync(path.join(dir, 'molniya.cfg')));
  assert.ok(existsSync(path.join(dir, 'defaults', 'pref', 'autoconfig.js')));
  assert.ok(existsSync(path.join(dir, 'distribution', 'policies.json')));
  assert.ok(existsSync(path.join(dir, 'distribution', 'Certificates', 'r.crt')));
});

test('patchInstallDir: exe Windows получают иконки/версию Молнии, плитки Пуска заменяются', async () => {
  const { buildSyntheticPe, bmpOld, ZEN_STRINGS, parseRsrcLeaves, parseVersionStrings, pngWriter } =
    await import('./helpers/win-pe.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'win2-'));
  mkdirSync(path.join(dir, 'browser', 'VisualElements'), { recursive: true });
  const browserOmni = zipFixture(dir, {
    'chrome/ru/locale/branding/brand.properties': 'brandShortName=Zen\n',
    'chrome/browser/content/branding/about-logo.png': 'stub',
  });
  spawnSync('cp', [browserOmni, path.join(dir, 'browser', 'omni.ja')]);
  const tkOmni = zipFixture(dir, { 'modules/AppConstants.sys.mjs': 'MOZ_APP_NAME: "zen",\n' });
  spawnSync('cp', [tkOmni, path.join(dir, 'omni.ja')]);
  writeFileSync(path.join(dir, 'application.ini'), '[App]\nVendor=Mozilla\nName=Zen\nProfile=zen\nBuildID=20261029123729\nVersion=1.24b\n');

  const iconDir = path.join(dir, 'icons');
  mkdirSync(iconDir);
  for (const s of [16, 32, 48, 64, 128]) writeFileSync(path.join(iconDir, `icon${s}.png`), pngWriter(s, [9, 8, 7, 255]));
  writeFileSync(path.join(iconDir, 'icon256.png'), pngWriter(256, [9, 8, 7, 255]));
  writeFileSync(path.join(iconDir, 'icon70.png'), pngWriter(70, [5, 5, 5, 255]));
  writeFileSync(path.join(iconDir, 'icon150.png'), pngWriter(150, [6, 6, 6, 255]));

  const peBody = () => buildSyntheticPe({
    icons: [{ id: 1, data: bmpOld(16) }],
    groups: [{ id: 1, entries: [{ w: 16, bytesRes: 1128, iconId: 1 }] }],
    versionStrings: ZEN_STRINGS,
    stringTableBytes: 64,
    slack: 4,
  });
  writeFileSync(path.join(dir, 'zen.exe'), peBody());
  writeFileSync(path.join(dir, 'private_browsing.exe'), peBody());
  for (const f of ['VisualElements_70.png', 'VisualElements_150.png', 'PrivateBrowsing_70.png', 'PrivateBrowsing_150.png']) {
    writeFileSync(path.join(dir, 'browser', 'VisualElements', f), 'ZEN-OLD');
  }

  const res = await patchInstallDir(dir, {
    zenTag: '1.24b',
    platform: 'win',
    brandAssets: iconDir,
    downloads: { cert: async () => fakeCert, ublock: async () => fakeXpi },
    certs: [{ file: 'r.crt', url: 'u', sha256: fakeSha }, { file: 's.crt', url: 'u', sha256: fakeSha }],
    ublock: { url: 'u', version: '1', id: 'test@molniya', sha256: createHash('sha256').update(fakeXpi).digest('hex') },
  });

  assert.ok(!existsSync(path.join(dir, 'zen.exe')), 'zen.exe должен быть переименован');
  assert.ok(existsSync(path.join(dir, 'molniya.exe')), 'должен быть molniya.exe');
  assert.equal(res.winExe.length, 2, 'патчены оба exe');

  for (const name of ['molniya.exe', 'private_browsing.exe']) {
    const leaves = parseRsrcLeaves(readFileSync(path.join(dir, name)));
    const strings = parseVersionStrings(leaves.find((l) => l.type === 16).data);
    assert.equal(strings.FileDescription, 'Молния', `${name}: FileDescription`);
    assert.equal(strings.OriginalFilename, name, `${name}: OriginalFilename`);
  }
  const ve = (f) => readFileSync(path.join(dir, 'browser', 'VisualElements', f));
  assert.ok(ve('VisualElements_70.png').equals(readFileSync(path.join(iconDir, 'icon70.png'))));
  assert.ok(ve('PrivateBrowsing_150.png').equals(readFileSync(path.join(iconDir, 'icon150.png'))));
});
