// Тесты статуса обновлений в «О Молнии» — инжекция в aboutDialog.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { injectAboutUpdateStatus, ABOUT_STATUS_MARKER } from '../src/patch-brand.mjs';

test('injectAboutUpdateStatus: дописывает блок, парсится как JS, находит статус-элемент', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'about-'));
  const js = path.join(dir, 'aboutDialog.js');
  writeFileSync(js, 'function init() {}\ninit();\n');
  injectAboutUpdateStatus(js, '1.24b-molniya.1');
  const out = readFileSync(js, 'utf8');
  assert.ok(out.includes(ABOUT_STATUS_MARKER));
  assert.match(out, /getElementById\("policyDisabled"\)/);
  assert.match(out, /molniya\.updates\.latestTag/);
  assert.match(out, /getElementById\("failedLink"\)/, 'переиспользуем распарсенный text-link из downloadFailed');
  assert.match(out, /molniyaStatus\.appendChild\(link\)/, 'ссылка переезжает внутрь description');
  assert.match(out, /removeAttribute\("data-l10n-name"\)/, 'Fluent не должен перетирать текст ссылки');
  assert.match(out, /releases"/, 'ссылка ведёт на страницу всех релизов');
  assert.match(out, /removeAttribute\("data-l10n-id"\)/, 'FTL не должен перетирать динамический текст');
  assert.match(out, /function molniyaIsNewer\(/, 'компаратор встроен');
  assert.match(out, /molniyaIsNewer\(MOLNIYA_VERSION,\s*tag\)/);
  new Function(out.replace(/^function init.*$/m, '')); // синтаксис валиден
});

test('injectAboutUpdateStatus: идемпотентен, версию обновляет', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'about2-'));
  const js = path.join(dir, 'aboutDialog.js');
  writeFileSync(js, 'x();\n');
  injectAboutUpdateStatus(js, '1.24b-molniya.1');
  injectAboutUpdateStatus(js, '1.24b-molniya.2');
  const out = readFileSync(js, 'utf8');
  const blocks = (out.match(new RegExp(`==== конец ${ABOUT_STATUS_MARKER} ====`, 'g')) ?? []).length;
  assert.equal(blocks, 1, 'ровно один блок');
  assert.match(out, /MOLNIYA_VERSION = "1\.24b-molniya\.2"/);
});

test('patchOmni: проставляет статус в aboutDialog.js, если тот есть в архиве', async () => {
  const { patchOmni } = await import('../src/patch-brand.mjs');
  const { spawnSync } = await import('node:child_process');
  const { mkdirSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'about3-'));
  const tree = path.join(dir, 'tree');
  const mk = (rel, c) => {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, c);
    return p;
  };
  mk('localization/ru/browser/aboutDialog.ftl', 'update-policy-disabled = О новой версии браузер сообщит сам\n');
  mk('chrome/browser/content/browser/aboutDialog.js', 'function init() {}\ninit();\n');
  const z = path.join(dir, 'fixture.ja');
  spawnSync('zip', ['-qrX', z, '.'], { cwd: tree });
  await patchOmni(z, { version: '1.24b-molniya.2' });
  const out = spawnSync('7z', ['x', '-so', z, 'chrome/browser/content/browser/aboutDialog.js'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout;
  assert.ok(out.includes(ABOUT_STATUS_MARKER), 'блок статуса в aboutDialog.js');
  assert.match(out, /MOLNIYA_VERSION = "1\.24b-molniya\.2"/);
});
