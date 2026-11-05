import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchOmni } from '../src/patch-brand.mjs';

function makeOmni(dir, files) {
  const tree = path.join(dir, 'tree');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(tree, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const z = path.join(dir, 'omni.ja');
  spawnSync('zip', ['-qrX', z, '.'], { cwd: tree });
  return z;
}

test('patchOmni заменяет бренд-КАРТИНКИ из каталога ассетов (wordmark, logo, иконки)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'img-'));
  const z = makeOmni(dir, {
    'chrome/ru/locale/branding/brand.properties': 'brandShortName=Zen\n',
    'chrome/browser/content/branding/about-wordmark.svg': '<svg>OLD-ZEN-WORDMARK</svg>',
    'chrome/browser/content/branding/about-logo.png': 'OLD-PNG-1x',
    'chrome/browser/content/branding/about-logo@2x.png': 'OLD-PNG-2x',
    'chrome/browser/content/branding/icon128.png': 'OLD-ICON-128',
    'chrome/browser/content/branding/icon16.png': 'OLD-ICON-16',
  });
  const brandAssets = path.join(dir, 'assets');
  mkdirSync(brandAssets, { recursive: true });
  writeFileSync(path.join(brandAssets, 'about-wordmark.svg'), '<svg>МОЛНИЯ-WORDMARK</svg>');
  writeFileSync(path.join(brandAssets, 'about-logo.svg'), '<svg>NEW-LOGO</svg>');
  writeFileSync(path.join(brandAssets, 'icon128.png'), 'NEW-ICON-128');
  writeFileSync(path.join(brandAssets, 'icon16.png'), 'NEW-ICON-16');

  await patchOmni(z, { workDir: path.join(dir, 'work'), brandAssets });

  const read = (rel) => spawnSync('7z', ['x', '-so', z, rel], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout;
  assert.match(read('chrome/browser/content/branding/about-wordmark.svg'), /МОЛНИЯ-WORDMARK/);
  assert.doesNotMatch(read('chrome/browser/content/branding/about-wordmark.svg'), /ZEN/);
  assert.match(read('chrome/browser/content/branding/about-logo.svg'), /NEW-LOGO/);
  assert.match(read('chrome/browser/content/branding/icon128.png'), /NEW-ICON-128/);
  assert.match(read('chrome/browser/content/branding/icon16.png'), /NEW-ICON-16/);
});
