import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { artifactName, sha256sum, shaLine } from '../src/repack-mac.mjs';

test('artifactName: molniya-<версия>-mac.dmg, версия = zenTag-molniya.N', () => {
  assert.equal(artifactName('mac', '1.24b-molniya.1'), 'molniya-1.24b-molniya.1-mac.dmg');
  assert.equal(artifactName('win', '1.24b-molniya.1'), 'molniya-1.24b-molniya.1-win.zip');
  assert.equal(artifactName('linux', '1.24b-molniya.1'), 'molniya-1.24b-molniya.1-linux.tar.xz');
});

test('sha256sum: считает хеш файла; shaLine формирует строку SHA256SUMS', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sha-'));
  const f = path.join(dir, 'x.bin');
  const data = Buffer.from('molniya-test');
  writeFileSync(f, data);
  const expected = createHash('sha256').update(data).digest('hex');
  assert.equal(sha256sum(f), expected);
  assert.equal(shaLine(f), `${expected}  ${path.basename(f)}`);
});

test('stageDmgContents: приложение + ярлык «Программы» + фон, style:false без Finder', async () => {
  const { stageDmgContents } = await import('../src/repack-mac.mjs');
  const work = mkdtempSync(path.join(tmpdir(), 'stage-'));
  const app = path.join(work, 'Молния.app');
  execSync(`mkdir -p "${app}/Contents/MacOS" && printf x > "${app}/Contents/MacOS/molniya"`);
  const staging = stageDmgContents(app, work, { style: false });
  assert.ok(existsSync(path.join(staging, 'Молния.app')));
  assert.ok(existsSync(path.join(staging, 'Программы')), 'ярлык на /Applications');
  assert.ok(existsSync(path.join(staging, '.background', 'bg.png')), 'фон с подсказкой');
});
