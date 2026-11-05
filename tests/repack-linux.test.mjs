import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { repackLinux } from '../src/repack-linux.mjs';

test('repackLinux: tar.xz с путями molniya, без zen в путях запуска', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lin-'));
  const src = path.join(dir, 'src');
  execSync(`mkdir -p "${src}/browser" && printf 'fake-binary' > "${src}/molniya" && printf 'x' > "${src}/browser/omni.ja" && printf 'x' > "${src}/libxul.so"`);
  const out = repackLinux({ srcDir: src, outDir: dir, version: '1.24b-molniya.1' });
  const listing = spawnSync('tar', ['-tJf', out], { encoding: 'utf8' }).stdout;
  assert.match(listing, /molniya$/m);              // стартовый бинарник переименован
  assert.doesNotMatch(listing, /(^|\/)zen$/m);      // путей запуска zen нет
  assert.match(path.basename(out), /^molniya-1\.24b-molniya\.1-linux\.tar\.xz$/);
});
