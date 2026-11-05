#!/usr/bin/env node
// Проверка внешних инструментов пайплайна. Запуск: npm run toolcheck
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const COMMON = ['curl', '7z', 'zip', 'unzip', 'xz', 'tar'];
const MAC_ONLY = ['hdiutil', 'codesign', 'iconutil'];

const tools = process.platform === 'darwin' ? [...COMMON, ...MAC_ONLY] : COMMON;

let failed = 0;
for (const tool of tools) {
  const probe = spawnSync('bash', ['-lc', `command -v ${tool}`], { encoding: 'utf8' });
  const ok = probe.status === 0 && probe.stdout.trim() !== '';
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'}  ${tool}`);
}
if (process.platform !== 'darwin') {
  console.log('–  hdiutil / codesign / iconutil пропущены (не macOS)');
}
if (failed > 0) {
  console.error(`\nОтсутствуют инструменты: ${failed} шт. Установите (macOS: brew install p7zip) и повторите.`);
  // 7z — бинарник формулы p7zip; «7zz» из плана — это формула sevenzip, функционально то же (см. ledger).
  process.exit(1);
}
console.log('\nВсе инструменты на месте.');
