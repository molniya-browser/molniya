import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchOmni, patchAppIdentity, BrandResidueError } from '../src/patch-brand.mjs';

function makeFixtureOmni(dir, files) {
  const tree = path.join(dir, 'tree');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const zipPath = path.join(dir, 'fixture-omni.ja');
  const r = spawnSync('zip', ['-qrX', zipPath, '.'], { cwd: tree });
  if (r.status !== 0) throw new Error('fixture zip failed');
  return { zipPath, tree };
}

const readFromZip = (zipPath, rel) =>
  spawnSync('7z', ['x', '-so', zipPath, rel], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout;

test('patchOmni: заменяет бренд-строки во всех локаль-файлах и перепаковывает валидный zip', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pbr1-'));
  const { zipPath } = makeFixtureOmni(dir, {
    'chrome/ru/locale/branding/brand.properties': 'brandShortName=Zen\nbrandFullName=Zen Browser\nvendorShortName=Zen OSS Team\n',
    'localization/ru/browser/zen-welcome.ftl': 'zen-welcome-title = Добро пожаловать в Zen Browser!\nzen-note = Zen быстро\n',
    'localization/en-US/browser/browser.ftl': 'menu = Zen Settings\n',
    'chrome/en-US/locale/browser/browser.properties': 'quit = Quit Zen\n',
  });
  const { replaced } = await patchOmni(zipPath, { workDir: path.join(dir, 'work') });
  assert.ok(replaced >= 7, `заменено >= 7 строк (получили ${replaced})`);
  assert.equal(readFromZip(zipPath, 'chrome/ru/locale/branding/brand.properties'),
    'brandShortName=Молния\nbrandFullName=Молния\nvendorShortName=Проект Молния\n');
  assert.match(readFromZip(zipPath, 'localization/ru/browser/zen-welcome.ftl'), /Добро пожаловать в Молния!/);
  assert.match(readFromZip(zipPath, 'localization/ru/browser/zen-welcome.ftl'), /Молния быстро/);
  assert.doesNotMatch(readFromZip(zipPath, 'chrome/en-US/locale/browser/browser.properties'), /Zen/);
});

test('patchOmni: остаточный «Zen» без границ слова — BrandResidueError', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pbr2-'));
  const { zipPath } = makeFixtureOmni(dir, {
    'chrome/ru/locale/branding/brand.properties': 'brandShortName=ZenBrowserXBuiltin\n',
  });
  await assert.rejects(() => patchOmni(zipPath, { workDir: path.join(dir, 'work') }), BrandResidueError);
});

test('patchAppIdentity (mac): AppConstants, application.ini c бампом BuildID, Info.plist, InfoPlist.strings, бинарник', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pbr3-'));
  const app = path.join(dir, 'Molniya.app', 'Contents');
  mkdirSync(path.join(app, 'MacOS'), { recursive: true });
  mkdirSync(path.join(app, 'Resources', 'en.lproj'), { recursive: true });
  writeFileSync(path.join(app, 'MacOS', 'zen'), '#!/bin/sh\nfake');
  writeFileSync(path.join(app, 'Resources', 'application.ini'),
    '[App]\nVendor=Mozilla\nName=Zen\nRemotingName=zen\nProfile=zen\nBuildID=20261029123729\nVersion=1.24b\n');
  writeFileSync(path.join(app, 'Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Zen</string><key>CFBundleIdentifier</key><string>app.zen-browser.zen</string><key>CFBundleExecutable</key><string>zen</string></dict></plist>');
  writeFileSync(path.join(app, 'Resources', 'en.lproj', 'InfoPlist.strings'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Zen</string></dict></plist>');
  const { tree } = makeFixtureOmni(dir, {
    'modules/AppConstants.sys.mjs': 'MOZ_APP_NAME: "zen",\nMOZ_APP_BASENAME: "Zen",\nMOZ_APP_DISPLAYNAME_DO_NOT_USE: "Zen",\nMOZ_MACBUNDLE_ID: "app.zen-browser.zen",\nMOZ_MACBUNDLE_NAME: "Zen.app",\n',
  });
  cpSync(tree, path.join(dir, 'tk-tree'), { recursive: true });
  // подменяем omni.ja toolkit фикстурой
  mkdirSync(path.join(app, 'Resources'), { recursive: true });
  spawnSync('zip', ['-qrX', path.join(app, 'Resources', 'omni.ja'), '.'], { cwd: path.join(dir, 'tk-tree') });

  const res = await patchAppIdentity(app, { platform: 'mac' });

  const ini = readFileSync(path.join(app, 'Resources', 'application.ini'), 'utf8');
  assert.match(ini, /^Name=Molniya$/m);
  assert.match(ini, /^Vendor=Molniya Project$/m);
  assert.match(ini, /^RemotingName=molniya$/m);
  assert.match(ini, /^Profile=molniya$/m);
  assert.match(ini, /^BuildID=20\d{12}$/m);
  assert.notEqual(ini.match(/^BuildID=(\d+)$/m)[1], '20261029123729', 'BuildID обновлён');
  const ac = readFromZip(path.join(app, 'Resources', 'omni.ja'), 'modules/AppConstants.sys.mjs');
  assert.match(ac, /MOZ_APP_NAME: "molniya"/);
  assert.match(ac, /MOZ_APP_BASENAME: "Molniya"/);
  assert.match(ac, /MOZ_MACBUNDLE_NAME: "Молния\.app"/);
  assert.match(ac, /MOZ_MACBUNDLE_ID: "ru\.molniya\.browser"/);
  assert.doesNotMatch(ac, /"zen"/);
  const plistName = spawnSync('plutil', ['-extract', 'CFBundleName', 'raw', path.join(app, 'Info.plist')], { encoding: 'utf8' }).stdout.trim();
  assert.equal(plistName, 'Молния');
  const exe = spawnSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', path.join(app, 'Info.plist')], { encoding: 'utf8' }).stdout.trim();
  assert.equal(exe, 'molniya');
  assert.ok(res.renamedBinary, 'бинарник переименован');
  const strings = readFileSync(path.join(app, 'Resources', 'en.lproj', 'InfoPlist.strings'), 'utf8');
  assert.match(strings, /Молния/);
  assert.doesNotMatch(strings, />Zen</);
});

test('patchAppIdentity (linux): только application.ini, без mac-слоёв', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pbr4-'));
  mkdirSync(path.join(dir, 'resources'), { recursive: true });
  writeFileSync(path.join(dir, 'resources', 'application.ini'), '[App]\nName=Zen\nVendor=Mozilla\nProfile=zen\nBuildID=20261029123729\n');
  await patchAppIdentity(dir, { platform: 'linux' });
  const ini = readFileSync(path.join(dir, 'resources', 'application.ini'), 'utf8');
  assert.match(ini, /^Name=Molniya$/m);
  assert.match(ini, /^Profile=molniya$/m);
});
