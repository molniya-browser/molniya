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
