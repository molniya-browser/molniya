// Тесты компаратора версий детектора обновлений — src/detector-version.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { molniyaIsNewer } from '../src/detector-version.mjs';

test('molniyaIsNewer: та же версия — не новее', () => {
  assert.equal(molniyaIsNewer('1.24b-molniya.1', '1.24b-molniya.1'), false);
});

test('molniyaIsNewer: старший номер сборки — новее', () => {
  assert.equal(molniyaIsNewer('1.24b-molniya.1', '1.24b-molniya.2'), true);
  assert.equal(molniyaIsNewer('1.24b-molniya.2', '1.24b-molniya.1'), false);
});

test('molniyaIsNewer: другая версия Zen — сравнивается по сегментам', () => {
  assert.equal(molniyaIsNewer('1.24b-molniya.9', '1.25-molniya.1'), true);
  assert.equal(molniyaIsNewer('1.25-molniya.1', '1.24b-molniya.9'), false);
  assert.equal(molniyaIsNewer('1.24b-molniya.9', '1.24.1-molniya.1'), true, 'больше сегментов — патч-релиз новее');
});

test('molniyaIsNewer: нераспознанный тег — молчим (не новее)', () => {
  assert.equal(molniyaIsNewer('1.24b-molniya.1', 'какой-то-тег'), false);
  assert.equal(molniyaIsNewer('1.24b-molniya.1', ''), false);
});
