import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractLinks, runChecks } from '../scripts/check-links.mjs';

test('extractLinks: собирает уникальные внешние href/src, локальные игнорирует', () => {
  const html = '<a href="https://a.example/x">1</a> <img src="https://a.example/x"> <a href="style.css"> <a href="https://b.example/y">';
  assert.deepEqual(extractLinks(html), ['https://a.example/x', 'https://b.example/y']);
});

test('runChecks: битая ссылка попадает в failures (Review Focus: кнопки скачивания)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cl-'));
  const f = path.join(dir, 'page.html');
  writeFileSync(f, '<a href="https://ok.example/1"><a href="https://broken.example/2">');
  const mock = async (url) => ({ ok: url.includes('ok.example'), status: url.includes('ok.example') ? 200 : 404 });
  const failures = await runChecks([f], mock);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /broken\.example/);
});
