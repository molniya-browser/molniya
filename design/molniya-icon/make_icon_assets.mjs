import { spawnSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(ROOT, '..', '..');
const SVG = path.join(ROOT, 'molniya.svg');
const MASTER = path.join(ROOT, 'molniya-1024.png');
const ICONSET = path.join(ROOT, 'Molniya.iconset');
const ICNS = path.join(ROOT, 'Molniya.icns');
const PREVIEW = path.join(ROOT, 'molniya-themes-preview.png');
const BRANDING = path.join(PROJECT, 'assets', 'branding');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} → ${result.status}: ${result.stderr || result.stdout}`);
  }
}

function renderSvg(source, size, destination) {
  run('sips', ['-s', 'format', 'png', '-z', String(size), String(size), source, '--out', destination]);
}

function resize(source, size, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  run('sips', ['-z', String(size), String(size), source, '--out', destination]);
}

function makePalettePng(source, destination) {
  for (const colors of [256, 192, 128, 96, 64]) {
    run('pngquant', ['--force', '--output', destination, '--speed', '1', String(colors), source]);
    const size = statSync(destination).size;
    if (size <= 16540) {
      console.log(`icon256.png: ${colors} цветов, ${size} байт`);
      return;
    }
  }
  throw new Error('icon256.png не помещается в PE-слот 16540 байт даже после квантования');
}

function makePreview(staging) {
  const icon = readFileSync(SVG, 'utf8')
    .replace(/^.*?<svg[^>]*>/s, '')
    .replace(/<\/svg>\s*$/, '');
  const darkIcon = icon
    .replace(/id="([^"]+)"/g, 'id="$1Dark"')
    .replace(/url\(#([^)]+)\)/g, 'url(#$1Dark)');
  const scale = 620 / 1024;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="0 0 1600 1000">
    <rect width="800" height="1000" fill="#f5f5f7"/><rect x="800" width="800" height="1000" fill="#121216"/>
    <g transform="translate(90 145) scale(${scale})">${icon}</g>
    <g transform="translate(890 145) scale(${scale})">${darkIcon}</g>
    <g font-family="Helvetica, Arial, sans-serif" text-anchor="middle" font-size="30">
      <text x="400" y="840" fill="#232328">Светлая тема</text><text x="1200" y="840" fill="#eeeef2">Тёмная тема</text>
    </g>
    <g font-family="Helvetica, Arial, sans-serif" text-anchor="middle" font-size="20" fill="#7d7d87">
      <text x="400" y="890">МОЛНИЯ  ·  БРАУЗЕР</text><text x="1200" y="890">МОЛНИЯ  ·  БРАУЗЕР</text>
    </g>
  </svg>`;
  const source = path.join(staging, 'preview.svg');
  const rendered = path.join(staging, 'preview-1600.png');
  writeFileSync(source, svg);
  renderSvg(source, 1600, rendered);
  run('sips', ['-c', '1000', '1600', rendered, '--out', PREVIEW]);
}

function main() {
  const staging = mkdtempSync(path.join(tmpdir(), 'molniya-assets-'));
  try {
    renderSvg(SVG, 1024, MASTER);
    rmSync(ICONSET, { recursive: true, force: true });
    mkdirSync(ICONSET, { recursive: true });
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
    for (const [name, size] of Object.entries(exports)) resize(MASTER, size, path.join(ICONSET, name));
    run('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS]);

    for (const size of [16, 32, 48, 64, 70, 128, 150, 512]) {
      resize(MASTER, size, path.join(staging, `icon${size}.png`));
    }
    resize(MASTER, 256, path.join(staging, 'icon256-rgba.png'));
    makePalettePng(path.join(staging, 'icon256-rgba.png'), path.join(staging, 'icon256.png'));
    resize(MASTER, 512, path.join(staging, 'molniya-512.png'));
    makePreview(staging);

    for (const size of [16, 32, 48, 64, 70, 128, 150, 256, 512]) {
      copyFileSync(path.join(staging, `icon${size}.png`), path.join(BRANDING, `icon${size}.png`));
    }
    copyFileSync(ICNS, path.join(PROJECT, 'assets', 'molniya.icns'));
    copyFileSync(MASTER, path.join(PROJECT, 'assets', 'molniya-1024.png'));
    copyFileSync(path.join(staging, 'molniya-512.png'), path.join(PROJECT, 'assets', 'molniya-512.png'));
    copyFileSync(path.join(staging, 'molniya-512.png'), path.join(PROJECT, 'landing', 'molniya-512.png'));
    console.log(MASTER);
    console.log(ICNS);
    console.log(PREVIEW);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main();
