import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { injectUpdateDetector, DETECTOR_MARKER } from '../src/patch-brand.mjs';

test('injectUpdateDetector: дописывает блок с версией в browser.js, парсится как JS', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inj-'));
  const bjs = path.join(dir, 'browser.js');
  writeFileSync(bjs, 'function existing() { return 1; }\n');
  injectUpdateDetector(bjs, '1.24b-molniya.1');
  const out = readFileSync(bjs, 'utf8');
  assert.match(out, /function existing\(\)/);
  assert.ok(out.includes(DETECTOR_MARKER));
  assert.match(out, /MOLNIYA_VERSION = "1\.24b-molniya\.1"/);
  assert.match(out, /api\.github\.com\/repos\/molniya-browser\/molniya/);
  assert.match(out, /molniya\.updates\.notifiedVersion/);
});

test('injectUpdateDetector: повторный вызов не дублирует блок', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inj2-'));
  const bjs = path.join(dir, 'browser.js');
  writeFileSync(bjs, 'x();\n');
  injectUpdateDetector(bjs, '1.0-molniya.1');
  injectUpdateDetector(bjs, '1.0-molniya.2');
  const out = readFileSync(bjs, 'utf8');
  const blocks = (out.match(/==== конец MOLNIYA-UPDATE-DETECTOR ====/g) ?? []).length;
  assert.equal(blocks, 1, 'ровно один блок детектора');
  assert.match(out, /MOLNIYA_VERSION = "1\.0-molniya\.2"/); // обновлённая версия
});

test('injectUpdateDetector: открывает страницу релиза вместо системных уведомлений', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inj3-'));
  const bjs = path.join(dir, 'browser.js');
  writeFileSync(bjs, 'x();\n');
  injectUpdateDetector(bjs, '1.24b-molniya.1');
  const out = readFileSync(bjs, 'utf8');
  assert.match(out, /openTrustedLinkIn\(/, 'открывает вкладку с релизом');
  assert.match(out, /releases\/tag\/"\s*\+\s*tag/, 'ссылка на конкретный тег');
  assert.doesNotMatch(out, /showAlertNotification|nsIAlertsService/, 'системные уведомления не используются');
  assert.match(out, /function molniyaIsNewer\(/, 'встроен компаратор версий');
  assert.match(out, /molniyaIsNewer\(MOLNIYA_VERSION,\s*tag\)/, 'даунгрейд не предлагается');
});

test('injectUpdateDetector: пишет последний известный тег для «О Молнии»', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inj4-'));
  const bjs = path.join(dir, 'browser.js');
  writeFileSync(bjs, 'x();\n');
  injectUpdateDetector(bjs, '1.24b-molniya.1');
  const out = readFileSync(bjs, 'utf8');
  assert.match(out, /molniya\.updates\.latestTag/, 'преф со свежим тегом релиза');
});

test('injectUpdateDetector: однократная проверка на запуск, вкладка в свежем окне, следы диагностики', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inj5-'));
  const bjs = path.join(dir, 'browser.js');
  writeFileSync(bjs, 'x();\n');
  injectUpdateDetector(bjs, '1.24b-molniya.1');
  const out = readFileSync(bjs, 'utf8');
  assert.match(out, /molniya\.updates\.lastCheck/, 'время проверки пишется — видно по файлу');
  assert.match(out, /console\.error\("molniya update check failed/, 'ошибки не глотаются молча');
  assert.match(out, /getMostRecentBrowserWindow\(\)/, 'вкладка открывается в самом свежем окне');
  assert.match(out, /Date\.now\(\)\s*\/\s*1000\s*-\s*lastCheck\s*<\s*60/, 'повторные проверки окна в одну сессию гасятся');
});
