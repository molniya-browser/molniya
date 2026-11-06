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
