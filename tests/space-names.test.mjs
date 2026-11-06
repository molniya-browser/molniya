import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchOmni } from '../src/patch-brand.mjs';

const MANAGER = `async createAndSaveWorkspace(
    name = "Space",
    icon = undefined,
) {}
// ...
      let label =
        ContextualIdentityService.getUserContextLabel(containerTabId) ||
        "Default";
      name = this.isPrivateWindow ? "Incognito" : label;
// ...
    await this.createAndSaveWorkspace("Space", undefined, false, 0, {});
`;

function makeOmni(dir, files) {
  const tree = path.join(dir, 'tree');
  for (const [rel, c] of Object.entries(files)) {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, c);
  }
  const z = path.join(dir, 'omni.ja');
  spawnSync('zip', ['-qrX', z, '.'], { cwd: tree });
  return z;
}

test('patchOmni: дефолтные имена пространств — «Личное»/«Приватное», без Space/Default/Incognito', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-'));
  const z = makeOmni(dir, { 'modules/zen/ZenSpaceManager.mjs': MANAGER });
  await patchOmni(z, { workDir: path.join(dir, 'w'), version: '1.0-molniya.1' });
  const out = spawnSync('7z', ['x', '-so', z, 'modules/zen/ZenSpaceManager.mjs'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout;
  assert.match(out, /name = "Личное",/);
  assert.match(out, /await this\.createAndSaveWorkspace\("Личное", undefined/);
  assert.match(out, /\|\|\n\s+"Личное";/);
  assert.match(out, /isPrivateWindow \? "Приватное" : label/);
  assert.doesNotMatch(out, /"Space"|"Default"|"Incognito"/);
});

test('patchOmni: стартовые URL брендинга зануляются, релизы ведут на GitHub Молнии', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-'));
  const BR = `pref("startup.homepage_override_url", "https://zen-browser.app/whatsnew?v=%VERSION%");
pref("startup.homepage_welcome_url", "https://zen-browser.app/welcome/");
pref("startup.homepage_welcome_url.additional", "https://zen-browser.app/privacy-policy/");
pref("app.releaseNotesURL", "https://zen-browser.app/whatsnew/");
`;
  const z = makeOmni(dir, { 'defaults/preferences/firefox-branding.js': BR });
  await patchOmni(z, { workDir: path.join(dir, 'w'), version: '1.0-molniya.1' });
  const out = spawnSync('7z', ['x', '-so', z, 'defaults/preferences/firefox-branding.js'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).stdout;
  assert.match(out, /pref\("startup\.homepage_override_url", ""\);/);
  assert.match(out, /pref\("startup\.homepage_welcome_url", ""\);/);
  assert.match(out, /pref\("startup\.homepage_welcome_url\.additional", ""\);/);
  assert.match(out, /pref\("app\.releaseNotesURL", "https:\/\/github\.com\/molniya-browser\/molniya\/releases"\);/);
  assert.doesNotMatch(out, /zen-browser\.app/);
});

test('patchOmni: onboarding — «zen basics»→«молния», недостающие ru-ключи дописаны', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wl-'));
  const z = makeOmni(dir, {
    'chrome/browser/content/browser/zen-components/ZenWelcome.mjs': 'gZenFolders.createFolder(t, { label: "zen basics", });',
    'localization/ru/browser/zen-welcome.ftl': 'zen-welcome-title-line1 = Добро пожаловать\nzen-welcome-back = Назад\n',
  });
  await patchOmni(z, { workDir: path.join(dir, 'w'), version: '1.0-molniya.1' });
  const read = (rel) => spawnSync('7z', ['x', '-so', z, rel], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).stdout;
  assert.match(read('chrome/browser/content/browser/zen-components/ZenWelcome.mjs'), /label: "молния",/);
  assert.doesNotMatch(read('chrome/browser/content/browser/zen-components/ZenWelcome.mjs'), /zen basics/);
  const ftl = read('localization/ru/browser/zen-welcome.ftl');
  assert.match(ftl, /zen-welcome-skip = Пропустить/);
  assert.match(ftl, /zen-welcome-import-no = <strong>НЕТ<\/strong>, начать с чистого листа\./);
  assert.match(ftl, /zen-welcome-block-ads-title = Блокировать рекламу и трекеры\?/);
  assert.equal((ftl.match(/zen-welcome-back = Назад/g) ?? []).length, 1, 'существующий ключ не дублируется');
});
