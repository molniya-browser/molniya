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
const fakeXpi = Buffer.from('PK');

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
    ublock: { url: 'u', version: '1', sha256: createHash('sha256').update(fakeXpi).digest('hex') },
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
