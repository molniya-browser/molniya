// Тесты патчера PE-ресурсов exe Windows (иконки + VERSIONINFO) — src/patch-win-exe.mjs.
// PE-фикстуры собираются синтетически (см. tests/helpers/win-pe.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodePngRgba, buildBmpFrame, patchWindowsExe } from '../src/patch-win-exe.mjs';
import {
  pngWriter, bmpOld, fakePng, buildSyntheticPe, parseRsrcLeaves, parseVersionStrings, ZEN_STRINGS,
} from './helpers/win-pe.mjs';

const assets = path.resolve('assets', 'branding');
const FRAME_SIZES = { 16: 1128, 32: 4264, 48: 9640, 64: 16936, 128: 67624 };

test('decodePngRgba: читает реальную иконку 16px со скруглёнными углами', () => {
  const { width, height, rgba } = decodePngRgba(readFileSync(path.join(assets, 'icon16.png')));
  assert.equal(width, 16);
  assert.equal(height, 16);
  assert.equal(rgba.length, 16 * 16 * 4);
  assert.ok(rgba[3] < 255, 'левый верхний угол сквиркла должен быть прозрачным');
  assert.equal(rgba[(8 * 16 + 8) * 4 + 3], 255, 'центр иконки должен быть непрозрачным');
});

test('buildBmpFrame: кадр 16px ровно 1128 байт с корректным BITMAPINFOHEADER', () => {
  const frame = buildBmpFrame(16, Buffer.alloc(16 * 16 * 4, 0x80));
  assert.equal(frame.length, 1128);
  assert.equal(frame.readUInt32LE(0), 40);   // biSize
  assert.equal(frame.readInt32LE(4), 16);    // biWidth
  assert.equal(frame.readInt32LE(8), 32);    // biHeight удвоен (иконка + маска)
  assert.equal(frame.readUInt16LE(12), 1);   // biPlanes
  assert.equal(frame.readUInt16LE(14), 32);  // biBitCount
  assert.equal(frame.readUInt32LE(16), 0);   // BI_RGB
});

test('buildBmpFrame: пиксели BGRA снизу вверх, альфа-маска нулевая', () => {
  const rgba = Buffer.alloc(2 * 2 * 4);
  const px = (x, y, [r, g, b]) => rgba.set([r, g, b, 255], (y * 2 + x) * 4);
  px(0, 0, [255, 0, 0]); px(1, 0, [255, 0, 0]); // верхняя строка — красная
  px(0, 1, [0, 0, 255]); px(1, 1, [0, 0, 255]); // нижняя строка — синяя
  const frame = buildBmpFrame(2, rgba);
  assert.equal(frame.length, 64); // 40 заголовок + 16 пиксели + 8 маска (1 байт/строка → до 4)
  // BMP хранит строки снизу вверх: первой идёт синяя строка, порядок байтов BGRA
  assert.deepEqual([...frame.subarray(40, 48)], [255, 0, 0, 255, 255, 0, 0, 255]);
  assert.deepEqual([...frame.subarray(48, 56)], [0, 0, 255, 255, 0, 0, 255, 255]);
  assert.deepEqual([...frame.subarray(56)], [0, 0, 0, 0, 0, 0, 0, 0]);
});

/** Каталог иконок-заглушек (однотонные PNG) + свежесобранный exe. */
function makeFixture(png256 = pngWriter(256, [10, 20, 30, 255])) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wpe-'));
  const iconDir = path.join(dir, 'icons');
  mkdirSync(iconDir);
  for (const s of [16, 32, 48, 64, 128]) {
    writeFileSync(path.join(iconDir, `icon${s}.png`), pngWriter(s, [200, 100, 50, 255]));
  }
  writeFileSync(path.join(iconDir, 'icon256.png'), png256);
  return { dir, iconDir, exe: (buf) => {
    const p = path.join(dir, 'molniya.exe');
    writeFileSync(p, buf);
    return p;
  } };
}

test('patchWindowsExe: BMP-кадр заменяется in-place, размер файла не меняется', async () => {
  const f = makeFixture();
  const pe = buildSyntheticPe({
    icons: [{ id: 1, data: bmpOld(16) }],
    groups: [{ id: 1, entries: [{ w: 16, bytesRes: FRAME_SIZES[16], iconId: 1 }] }],
  });
  const exePath = f.exe(pe);
  const res = await patchWindowsExe(exePath, { iconDir: f.iconDir });
  const after = readFileSync(exePath);
  assert.equal(after.length, pe.length, 'файл не должен расти');
  const leaves = parseRsrcLeaves(after);
  const icon = leaves.find((l) => l.type === 3 && l.id === 1);
  const expected = buildBmpFrame(16, decodePngRgba(readFileSync(path.join(f.iconDir, 'icon16.png'))).rgba);
  assert.ok(icon.data.equals(expected), 'данные RT_ICON должны стать нашим кадром');
  assert.equal(res.iconsReplaced, 1);
  const group = leaves.find((l) => l.type === 14 && l.id === 1);
  assert.equal(group.size, 6 + 14);
  assert.equal(group.data.readUInt32LE(6 + 8), FRAME_SIZES[16], 'bytesInRes BMP-кадра не меняется');
});

test('patchWindowsExe: компактный PNG-256 влезает — заменяется, bytesInRes обновляется', async () => {
  const png256 = pngWriter(256, [10, 20, 30, 255]);
  const f = makeFixture(png256);
  const exePath = f.exe(buildSyntheticPe({
    icons: [{ id: 1, data: fakePng(5000) }],
    groups: [{ id: 1, entries: [{ w: 0, bytesRes: 5000, iconId: 1 }] }],
  }));
  const res = await patchWindowsExe(exePath, { iconDir: f.iconDir });
  const leaves = parseRsrcLeaves(readFileSync(exePath));
  const icon = leaves.find((l) => l.type === 3 && l.id === 1);
  assert.equal(icon.size, png256.length);
  assert.ok(icon.data.equals(png256));
  const group = leaves.find((l) => l.type === 14 && l.id === 1);
  assert.equal(group.data.readUInt32LE(6 + 8), png256.length, 'bytesInRes PNG-кадра обновляется');
  assert.equal(res.iconsReplaced, 1);
});

test('patchWindowsExe: тесный PNG-слот — 256-кадр выбрасывается из группы, данные затираются', async () => {
  const f = makeFixture();
  const pe = buildSyntheticPe({
    icons: [{ id: 1, data: bmpOld(16) }, { id: 2, data: fakePng(100) }],
    groups: [{ id: 1, entries: [
      { w: 16, bytesRes: FRAME_SIZES[16], iconId: 1 },
      { w: 0, bytesRes: 100, iconId: 2 },
    ] }],
  });
  const exePath = f.exe(pe);
  const res = await patchWindowsExe(exePath, { iconDir: f.iconDir });
  const after = readFileSync(exePath);
  assert.equal(after.length, pe.length, 'файл не должен расти');
  const leaves = parseRsrcLeaves(after);
  const group = leaves.find((l) => l.type === 14 && l.id === 1);
  assert.equal(group.size, 6 + 14, 'группа сокращается до одного кадра');
  assert.equal(group.data.readUInt16LE(4), 1);
  assert.equal(group.data.readUInt16LE(6 + 12), 1, 'остаётся только BMP-кадр');
  const dead = leaves.find((l) => l.type === 3 && l.id === 2);
  assert.ok(dead.data.every((b) => b === 0), 'старые данные выброшенного кадра затираются нулями');
  assert.equal(res.pngDropped, 1);
  assert.equal(res.iconsReplaced, 1, 'BMP-кадр всё равно заменяется');
});

test('patchWindowsExe: VERSIONINFO — Zen → Молния, теснота решается выбрасыванием RT_STRING', async () => {
  const f = makeFixture();
  const pe = buildSyntheticPe({
    icons: [{ id: 1, data: bmpOld(16) }],
    groups: [{ id: 1, entries: [{ w: 16, bytesRes: FRAME_SIZES[16], iconId: 1 }] }],
    versionStrings: ZEN_STRINGS,
    stringTableBytes: 64,
    slack: 4,
  });
  const exePath = f.exe(pe);
  const res = await patchWindowsExe(exePath, { iconDir: f.iconDir });
  const after = readFileSync(exePath);
  assert.equal(after.length, pe.length, 'файл не должен расти');
  const leaves = parseRsrcLeaves(after);
  assert.ok(!leaves.some((l) => l.type === 6), 'мусорный RT_STRING должен быть выкинут из каталога');
  const strings = parseVersionStrings(leaves.find((l) => l.type === 16).data);
  assert.equal(strings.FileDescription, 'Молния');
  assert.equal(strings.ProductName, 'Молния');
  assert.equal(strings.InternalName, 'Molniya');
  assert.equal(strings.CompanyName, 'Molniya Project');
  assert.equal(strings.OriginalFilename, 'molniya.exe');
  assert.equal(strings.FileVersion, '159.0', 'версия не трогается');
  assert.equal(strings.LegalCopyright, ZEN_STRINGS.LegalCopyright, 'атрибуция Mozilla сохраняется');
  assert.equal(after.indexOf(Buffer.from('Zen', 'utf16le')), -1, 'строк Zen в файле остаться не должно');
  assert.equal(res.versionPatched, true);
  assert.equal(res.iconsReplaced, 1);
});

test('patchWindowsExe: VERSIONINFO без места — понятная ошибка', async () => {
  const f = makeFixture();
  const exePath = f.exe(buildSyntheticPe({
    versionStrings: ZEN_STRINGS,
    stringTableBytes: 0,
    slack: 0,
  }));
  await assert.rejects(() => patchWindowsExe(exePath, { iconDir: f.iconDir }), /VERSIONINFO/);
});

test('реальные ассеты: кадры байт-в-байт и icon256 влезает в главный слот exe', () => {
  for (const [s, expected] of Object.entries(FRAME_SIZES)) {
    const frame = buildBmpFrame(+s, decodePngRgba(readFileSync(path.join(assets, `icon${s}.png`))).rgba);
    assert.equal(frame.length, expected, `кадр ${s}px`);
  }
  const pngSize = statSync(path.join(assets, 'icon256.png')).size;
  assert.ok(pngSize <= 16540, `icon256.png (${pngSize} байт) должен влезать в главный PNG-слот 16540`);
});

test('patchAppIdentity (win): zen.exe переименовывается в molniya.exe', async () => {
  const { patchAppIdentity } = await import('../src/patch-brand.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'wpe-id-'));
  writeFileSync(path.join(dir, 'application.ini'), '[App]\nVendor=Mozilla\nName=Zen\nProfile=zen\nBuildID=20261029123729\n');
  writeFileSync(path.join(dir, 'zen.exe'), 'stub');
  const res = await patchAppIdentity(dir, { platform: 'win' });
  assert.ok(existsSync(path.join(dir, 'molniya.exe')), 'должен появиться molniya.exe');
  assert.ok(!existsSync(path.join(dir, 'zen.exe')), 'zen.exe должен исчезнуть');
  assert.equal(res.renamedBinary, true);
  assert.match(readFileSync(path.join(dir, 'application.ini'), 'utf8'), /^Name=Molniya$/m);
});

test('buildBmpFrame: повторяет раскладки слотов реального zen.exe (маска 16Б/строку и без маски)', () => {
  const rgba = Buffer.alloc(16 * 16 * 4, 1);
  const legacy = buildBmpFrame(16, rgba, 16); // слоты 1320 байт (ids 17/19)
  assert.equal(legacy.length, 1320);
  assert.equal(legacy.readUInt32LE(20), 1280, 'biSizeImage legacy: XOR+маска');
  const bare = buildBmpFrame(16, rgba, 0); // слоты 1064 байт (группы ассоциаций файлов)
  assert.equal(bare.length, 1064);
  assert.equal(bare.readUInt32LE(20), 1024, 'biSizeImage без маски: только XOR');
  assert.equal(buildBmpFrame(16, rgba, 4).length, 1128); // обычная раскладка
});
