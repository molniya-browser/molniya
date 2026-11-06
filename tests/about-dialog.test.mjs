import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchOmni } from '../src/patch-brand.mjs';

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
const read = (z, rel) => spawnSync('7z', ['x', '-so', z, rel], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout;

const RU_ABOUT = `update-policy-disabled = Обновления отключены вашей организацией
update-policy-disabled
    .label = Обновления отключены вашей организацией
community-2 = { -brand-short-name } создан <label data-l10n-name="community-mozillaLink">{ -vendor-short-name }</label> — глобальным сообществом
helpus = Хотите помочь? <label>Сделайте пожертвование</label> или <label>присоединяйтесь!</label>
bottomLinks-license = Сведения о лицензии
`;

test('aboutDialog (ru): update-policy-disabled переформулирован, комьюнити-тексты убраны, лицензия осталась', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ab-'));
  const z = makeOmni(dir, { 'localization/ru/browser/aboutDialog.ftl': RU_ABOUT });
  await patchOmni(z, { workDir: path.join(dir, 'w'), version: '1.0-molniya.1' });
  const out = read(z, 'localization/ru/browser/aboutDialog.ftl');
  assert.match(out, /update-policy-disabled = Обновления поставляются сборками Молния/);
  assert.doesNotMatch(out, /отключены вашей организацией/);
  // community-2 и helpus не оставляют видимого текста
  const communityLine = out.match(/^community-2 = (.*)$/m)[1];
  assert.doesNotMatch(communityLine, /создан|сообществ/i);
  const helpusLine = out.match(/^helpus = (.*)$/m)[1];
  assert.doesNotMatch(helpusLine, /пожертвован|присоедин/i);
  // лицензионная ссылка не тронута
  assert.match(out, /^bottomLinks-license = Сведения о лицензии$/m);
});

test('aboutDialog (en): update-policy-disabled на английском', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'abe-'));
  const z = makeOmni(dir, { 'localization/en-US/browser/aboutDialog.ftl': RU_ABOUT });
  await patchOmni(z, { workDir: path.join(dir, 'w'), version: '1.0-molniya.1' });
  const out = read(z, 'localization/en-US/browser/aboutDialog.ftl');
  assert.match(out, /update-policy-disabled = Updates ship with Молния/i);
});
