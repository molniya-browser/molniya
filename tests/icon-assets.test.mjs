import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve();
const design = path.join(root, 'design', 'molniya-icon');
const branding = path.join(root, 'assets', 'branding');

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test('SVG иконки автономен и содержит согласованное слабое свечение', () => {
  const svg = readFileSync(path.join(design, 'molniya.svg'), 'utf8');
  assert.match(svg, /viewBox="0 0 1024 1024"/);
  const tile = svg.match(/<rect x="30"[^>]+\/>/)?.[0];
  assert.ok(tile, 'внешняя плитка найдена');
  assert.doesNotMatch(tile, /\sstroke=/, 'у внешней плитки не должно быть окантовки');
  assert.match(svg, /stdDeviation="18"/);
  assert.match(svg, /opacity="0\.12"/);
  assert.match(svg, /mask="url\(#centerGlow\)"/);
  assert.doesNotMatch(svg, /<image\b/);
  assert.doesNotMatch(svg, /(?:href|src)="https?:\/\//);
});

test('PNG macOS, Windows и лендинга имеют требуемые размеры', () => {
  for (const size of [16, 32, 48, 64, 70, 128, 150, 256, 512]) {
    const file = path.join(branding, `icon${size}.png`);
    assert.deepEqual(pngDimensions(readFileSync(file)), [size, size], file);
  }
  assert.deepEqual(pngDimensions(readFileSync(path.join(root, 'assets', 'molniya-1024.png'))), [1024, 1024]);
  assert.deepEqual(pngDimensions(readFileSync(path.join(root, 'assets', 'molniya-512.png'))), [512, 512]);
  assert.deepEqual(pngDimensions(readFileSync(path.join(root, 'landing', 'molniya-512.png'))), [512, 512]);
  assert.deepEqual(pngDimensions(readFileSync(path.join(design, 'molniya-themes-preview.png'))), [1600, 1000]);

  const exports = {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024,
  };
  for (const [name, size] of Object.entries(exports)) {
    const file = path.join(design, 'Molniya.iconset', name);
    assert.deepEqual(pngDimensions(readFileSync(file)), [size, size], file);
  }
});

test('иконка Windows 256 палитровая и помещается в существующий PE-слот', () => {
  const file = path.join(branding, 'icon256.png');
  const png = readFileSync(file);
  assert.equal(png[25], 3, 'PNG color type 3 — indexed color');
  assert.ok(statSync(file).size <= 16540, `${statSync(file).size} байт`);
});

test('лендинг и macOS используют те же сгенерированные ассеты', () => {
  assert.ok(readFileSync(path.join(root, 'landing', 'molniya-512.png')).equals(
    readFileSync(path.join(root, 'assets', 'molniya-512.png')),
  ));
  assert.ok(readFileSync(path.join(root, 'assets', 'molniya.icns')).equals(
    readFileSync(path.join(design, 'Molniya.icns')),
  ));
  assert.equal(readFileSync(path.join(root, 'assets', 'molniya.icns')).subarray(0, 4).toString(), 'icns');
});
