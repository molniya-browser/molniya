import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag, compareVersions, decideUpdate } from '../detector-extension/lib/version.js';

const RELEASES_URL = 'https://github.com/molniya-browser/molniya/releases/latest';

test('parseTag разбирает zen-ядро и номер сборки Молнии', () => {
  assert.deepEqual(parseTag('1.24b-molniya.1'), { core: '1.24b', n: 1 });
  assert.deepEqual(parseTag('1.23-molniya.9'), { core: '1.23', n: 9 });
});

test('parseTag rejects мусорные теги', () => {
  assert.throws(() => parseTag('1.24b'));
  assert.throws(() => parseTag('мусор'));
});

test('compareVersions: та же версия — 0; большая molniya.N — новая', () => {
  assert.equal(compareVersions('1.24b-molniya.2', '1.24b-molniya.2'), 0);
  assert.equal(compareVersions('1.24b-molniya.1', '1.24b-molniya.2'), -1);
  assert.equal(compareVersions('1.24b-molniya.2', '1.24b-molniya.1'), 1);
});

test('compareVersions: сначала сравнивается ядро zen-тега', () => {
  assert.equal(compareVersions('1.23-molniya.9', '1.24b-molniya.1'), -1);
  assert.equal(compareVersions('2.0-molniya.1', '1.24b-molniya.99'), 1);
});

test('decideUpdate: новая версия — бейдж и уведомление со ссылкой', () => {
  assert.deepEqual(decideUpdate('1.24b-molniya.1', '1.24b-molniya.2', null), {
    badge: '⬆', notify: true, url: RELEASES_URL,
  });
});

test('decideUpdate: ошибка сети — тишина, без исключения (Review Focus №1)', () => {
  assert.deepEqual(decideUpdate('1.24b-molniya.1', null, new Error('offline')), {
    badge: '', notify: false, url: null,
  });
});

test('decideUpdate: та же версия — бейджа нет', () => {
  assert.deepEqual(decideUpdate('1.24b-molniya.2', '1.24b-molniya.2', null), {
    badge: '', notify: false, url: null,
  });
});

test('decideUpdate: повторное обнаружение той же версии — не спамим уведомлением', () => {
  const again = decideUpdate('1.24b-molniya.1', '1.24b-molniya.2', null, '1.24b-molniya.2');
  assert.equal(again.notify, false);
  assert.equal(again.badge, '⬆');
});
