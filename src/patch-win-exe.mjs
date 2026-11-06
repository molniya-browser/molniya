// Патчер PE-ресурсов exe Windows: иконки Zen → Молния и строки VERSIONINFO.
// Всё in-place, без роста файла: BMP-кадры байт-в-байт совпадают по размеру с
// исходными (размер BMP-иконки фиксирован: 40 + w*h*4 + маска), PNG-256
// записывается только если влезает в слот, иначе 256-кадр выбрасывается из
// группы (Windows масштабирует 128px BMP). Никаких внешних зависимостей —
// PNG декодируется через node:zlib.
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Декодирует PNG (8 бит, RGB/RGBA, без interlace) в RGBA.
 * Наши ассеты именно такие; всё остальное — ошибка сборки.
 */
export function decodePngRgba(buf) {
  if (buf.length < 8 + 8 + 13 + 4 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('не PNG (нет сигнатуры)');
  }
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!width || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new Error(`PNG не поддерживается: ${width}x${height}, глубина ${bitDepth}, цвет ${colorType}, interlace ${interlace} — нужен 8-битный RGB(A) без interlace`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`неизвестный PNG-фильтр ${filter}`);
      }
      line[i] = v;
    }
    prev = line;
    for (let x = 0; x < width; x++) {
      const s = x * bpp, d = (y * width + x) * 4;
      rgba[d] = line[s];
      rgba[d + 1] = line[s + 1];
      rgba[d + 2] = line[s + 2];
      rgba[d + 3] = bpp === 4 ? line[s + 3] : 255;
    }
  }
  return { width, height, rgba };
}

/**
 * ICO-кадр: BITMAPINFOHEADER + пиксели BGRA снизу вверх + AND-маска.
 * Раскладка маски в реальных exe варьируется: без маски (maskRow=0), строка
 * ceil(size/8) байт с добивкой до 4 (стандарт) или legacy-строка шириной
 * с иконку (по 1 байту на пиксель) — размер подгоняется под конкретный слот.
 */
export function buildBmpFrame(size, rgba, maskRow = (Math.ceil(size / 8) + 3) & ~3) {
  const pixels = size * size * 4;
  const packedRow = (Math.ceil(size / 8) + 3) & ~3;
  const frame = Buffer.alloc(40 + pixels + maskRow * size);
  frame.writeUInt32LE(40, 0);
  frame.writeInt32LE(size, 4);
  frame.writeInt32LE(size * 2, 8); // высота удвоена: пиксели + маска
  frame.writeUInt16LE(1, 12);
  frame.writeUInt16LE(32, 14);
  // legacy-слоты считают biSizeImage вместе с маской, обычные — только XOR
  frame.writeUInt32LE(maskRow > packedRow ? pixels + maskRow * size : pixels, 20);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // снизу вверх
    for (let x = 0; x < size; x++) {
      const s = src + x * 4, d = 40 + (y * size + x) * 4;
      frame[d] = rgba[s + 2]; // B
      frame[d + 1] = rgba[s + 1]; // G
      frame[d + 2] = rgba[s]; // R
      frame[d + 3] = rgba[s + 3]; // A
    }
  }
  return frame; // маска остаётся нулевой: есть альфа-канал
}

import { CONFIG } from './config.mjs';

// ---------- Разбор PE ----------

/** Контекст секции .rsrc: смещения каталога, границы raw-данных, конвертация RVA. */
function parsePe(buf) {
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x4550) throw new Error('не PE-файл (нет сигнатуры PE)');
  const numSections = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const opt = peOff + 24;
  const dataDir = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96);
  const rsrcRva = buf.readUInt32LE(dataDir + 16);
  if (!rsrcRva) throw new Error('в PE нет каталога ресурсов (.rsrc)');
  const sections = [];
  for (let i = 0; i < numSections; i++) {
    const s = opt + optSize + i * 40;
    sections.push({ va: buf.readUInt32LE(s + 12), rawSize: buf.readUInt32LE(s + 16), raw: buf.readUInt32LE(s + 20) });
  }
  const rsrc = sections.find((s) => rsrcRva >= s.va && rsrcRva < s.va + s.rawSize);
  if (!rsrc) throw new Error('RVA .rsrc вне секций');
  const rva2o = (rva) => {
    const s = sections.find((x) => rva >= x.va && rva < x.va + x.rawSize);
    if (!s) throw new Error(`RVA 0x${rva.toString(16)} вне секций`);
    return rva - s.va + s.raw;
  };
  return { rva2o, dirOff: rva2o(rsrcRva), rawEnd: rsrc.raw + rsrc.rawSize };
}

/** Листья дерева ресурсов с адресами записи каталога (для удаления записей). */
function collectLeaves(buf, ctx) {
  const leaves = [];
  const walk = (dirOff, path) => {
    const named = buf.readUInt16LE(dirOff + 12);
    const ids = buf.readUInt16LE(dirOff + 14);
    for (let i = 0; i < named + ids; i++) {
      const e = dirOff + 16 + i * 8;
      const name = buf.readUInt32LE(e);
      const off = buf.readUInt32LE(e + 4);
      if (off & 0x80000000) {
        walk(ctx.dirOff + (off & 0x7fffffff), [...path, name]);
      } else {
        const leafOff = ctx.dirOff + off;
        leaves.push({
          // id лежит в имени самой записи-листа, когда в дереве нет уровня языка (Zen так)
          type: path[0], id: path[1] ?? name, leafOff, entryOff: e, parentDirOff: dirOff,
          dataOff: ctx.rva2o(buf.readUInt32LE(leafOff)),
          size: buf.readUInt32LE(leafOff + 4),
        });
      }
    }
  };
  walk(ctx.dirOff, []);
  return leaves;
}

/** Убирает запись листа из родительского каталога (сдвигом хвоста массива записей). */
function removeDirEntry(buf, leaf) {
  const dir = leaf.parentDirOff;
  const isNamed = buf.readUInt32LE(leaf.entryOff) & 0x80000000; // читаем до сдвига
  const named = buf.readUInt16LE(dir + 12);
  const ids = buf.readUInt16LE(dir + 14);
  const dirEnd = dir + 16 + (named + ids) * 8;
  const tail = Buffer.from(buf.subarray(leaf.entryOff + 8, dirEnd)); // без перекрытия
  tail.copy(buf, leaf.entryOff);
  buf.fill(0, dirEnd - 8, dirEnd);
  const countOff = dir + (isNamed ? 12 : 14);
  buf.writeUInt16LE(buf.readUInt16LE(countOff) - 1, countOff);
}

// ---------- VERSIONINFO ----------

const pad4 = (n) => (4 - (n % 4)) % 4;
const utf16 = (s) => Buffer.from(s, 'utf16le');

function readVKey(block, off) {
  let end = off;
  while (end + 1 < block.length && !(block[end] === 0 && block[end + 1] === 0)) end += 2;
  if (end + 1 >= block.length) throw new Error(`VERSIONINFO: ключ на смещении ${off} без нулевого терминатора`);
  return { key: block.toString('utf16le', off, end), bytes: end - off + 2 };
}

/** Разбор VS_VERSION_INFO: fixed-блок, пары строк и сырой VarFileInfo. */
function parseVersionTree(block) {
  const total = block.readUInt16LE(0);
  const fixedLen = block.readUInt16LE(2);
  const rootKey = readVKey(block, 6);
  const fixedOff = 6 + rootKey.bytes + pad4(6 + rootKey.bytes);
  const childrenStart = fixedOff + fixedLen + pad4(fixedOff + fixedLen);
  const fixed = Buffer.from(block.subarray(fixedOff, fixedOff + fixedLen));
  const strings = [];
  let varRaw = null;
  let p = childrenStart;
  while (p < total) {
    const wLength = block.readUInt16LE(p);
    if (wLength < 4) throw new Error(`VERSIONINFO: нулевая длина структуры на смещении ${p}`);
    const { key, bytes } = readVKey(block, p + 6);
    const body = p + 6 + bytes + pad4(p + 6 + bytes);
    if (key === 'StringFileInfo') {
      let q = body;
      while (q < p + wLength) {
        const tLen = block.readUInt16LE(q);
        if (tLen < 4) throw new Error(`VERSIONINFO: нулевая длина таблицы на смещении ${q}`);
        const tKey = readVKey(block, q + 6);
        let s = q + 6 + tKey.bytes + pad4(q + 6 + tKey.bytes);
        while (s < q + tLen) {
          const sLen = block.readUInt16LE(s);
          const sValLen = block.readUInt16LE(s + 2);
          const sKey = readVKey(block, s + 6);
          const sBody = s + 6 + sKey.bytes + pad4(s + 6 + sKey.bytes);
          if (sValLen > 0) strings.push([sKey.key, block.toString('utf16le', sBody, sBody + sValLen * 2)]);
          s = s + sLen + pad4(s + sLen);
        }
        q = q + tLen + pad4(q + tLen);
      }
    } else if (key === 'VarFileInfo') {
      varRaw = Buffer.from(block.subarray(p, p + wLength));
    }
    // rc выравнивает детей снаружи структур: после wLength — подъём до 4 байт
    p = p + wLength + pad4(p + wLength);
  }
  return { fixed, strings, varRaw };
}

function structBuf(key, value, type, body) {
  const keyBuf = Buffer.concat([utf16(key), Buffer.alloc(2)]);
  const headLen = 6 + keyBuf.length + pad4(6 + keyBuf.length);
  const valLen = value ? value.length : 0;
  const total = headLen + valLen + body.length + pad4(headLen + valLen + body.length);
  const buf = Buffer.alloc(total);
  buf.writeUInt16LE(total, 0);
  // wValueLength: в байтах для бинарных структур (wType=0), в символах для текстовых
  buf.writeUInt16LE(value ? (type === 0 ? value.length : value.length / 2) : 0, 2);
  buf.writeUInt16LE(type, 4);
  keyBuf.copy(buf, 6);
  if (value) value.copy(buf, headLen);
  body.copy(buf, headLen + valLen);
  return buf;
}

/** Сборка VS_VERSIONINFO из fixed-блока, пар строк и VarFileInfo (как rc.exe). */
function serializeVersion(fixed, strings, varRaw) {
  const stringParts = Buffer.concat(strings.map(([k, v]) => structBuf(k, utf16(v), 1, Buffer.alloc(0))));
  const table = structBuf('000004b0', null, 1, stringParts);
  const sfi = structBuf('StringFileInfo', null, 1, Buffer.concat([table]));
  return structBuf('VS_VERSION_INFO', fixed, 0, Buffer.concat(varRaw ? [sfi, varRaw] : [sfi]));
}

// ---------- Патч exe ----------

/** Карта замен строк VERSIONINFO (атрибуция Mozilla не трогается). */
function versionStringMap(exeName) {
  return {
    FileDescription: CONFIG.brand.name,
    ProductName: CONFIG.brand.name,
    InternalName: CONFIG.brand.latin,
    CompanyName: `${CONFIG.brand.latin} Project`,
    OriginalFilename: exeName,
  };
}

/**
 * Патчит PE-ресурсы exe Windows: иконки Zen → Молния (in-place, файл не растёт)
 * и строки VERSIONINFO. BMP-кадры байт-в-байт совпадают по размеру; PNG-256
 * пишется в слот, если влезает, иначе 256-кадр выбрасывается из группы.
 * При нехватке места под VERSIONINFO выбрасывается мусорный RT_STRING.
 */
export async function patchWindowsExe(exePath, { iconDir } = {}) {
  const rgbaBySize = {};
  for (const s of [16, 32, 48, 64, 128]) {
    const { width, height, rgba } = decodePngRgba(await readFile(path.join(iconDir, `icon${s}.png`)));
    if (width !== s || height !== s) throw new Error(`icon${s}.png: ${width}x${height}, нужен квадрат ${s}px`);
    rgbaBySize[s] = rgba;
  }
  const png256 = await readFile(path.join(iconDir, 'icon256.png'));
  const exeName = path.basename(exePath);
  const buf = Buffer.from(await readFile(exePath));
  const res = { iconsReplaced: 0, pngDropped: 0, versionPatched: false };

  const ctx = parsePe(buf);
  const leaves = collectLeaves(buf, ctx);

  // иконки: BMP заменяются всегда, PNG — если влезает, иначе выбрасывается из групп
  const replacedLen = new Map();
  const droppedIds = new Set();
  for (const leaf of leaves.filter((l) => l.type === 3)) {
    const isPng = buf[leaf.dataOff] === 0x89 && buf[leaf.dataOff + 1] === 0x50;
    if (isPng) {
      if (png256.length <= leaf.size) {
        png256.copy(buf, leaf.dataOff);
        buf.fill(0, leaf.dataOff + png256.length, leaf.dataOff + leaf.size);
        buf.writeUInt32LE(png256.length, leaf.leafOff + 4);
        replacedLen.set(leaf.id, png256.length);
        res.iconsReplaced += 1;
      } else {
        buf.fill(0, leaf.dataOff, leaf.dataOff + leaf.size);
        droppedIds.add(leaf.id);
        res.pngDropped += 1;
      }
    } else {
      const w = buf.readInt32LE(leaf.dataOff + 4);
      const h = buf.readInt32LE(leaf.dataOff + 8) / 2;
      if (!rgbaBySize[w]) throw new Error(`RT_ICON: неожиданный кадр ${w}x${h} — в ассетах нет иконки такого размера`);
      // раскладка маски выводится из размера слота (без маски / стандарт / legacy)
      const maskRow = (leaf.size - 40 - w * h * 4) / h;
      if (!Number.isInteger(maskRow) || maskRow < 0) {
        throw new Error(`RT_ICON ${w}x${h}: слот ${leaf.size} байт не раскладывается в BMP-кадр`);
      }
      const frame = buildBmpFrame(w, rgbaBySize[w], maskRow);
      if (frame.length !== leaf.size) throw new Error(`RT_ICON ${w}x${h}: кадр ${frame.length} байт ≠ слот ${leaf.size} байт`);
      frame.copy(buf, leaf.dataOff);
      res.iconsReplaced += 1;
    }
  }

  // группы: bytesInRes обновляется, выброшенные кадры уходят из перечня
  for (const leaf of leaves.filter((l) => l.type === 14)) {
    const count = buf.readUInt16LE(leaf.dataOff + 4);
    const entries = [];
    for (let i = 0; i < count; i++) {
      const p = leaf.dataOff + 6 + i * 14;
      const iconId = buf.readUInt16LE(p + 12);
      if (droppedIds.has(iconId)) continue;
      entries.push({
        head: Buffer.from(buf.subarray(p, p + 8)),
        bytesRes: replacedLen.get(iconId) ?? buf.readUInt32LE(p + 8),
        iconId,
      });
    }
    if (entries.length === count && !entries.some((e, i) => e.bytesRes !== buf.readUInt32LE(leaf.dataOff + 6 + i * 14 + 8))) continue;
    if (!entries.length) throw new Error('RT_GROUP_ICON остался без кадров — структура изменилась');
    const out = Buffer.alloc(6 + entries.length * 14);
    out.writeUInt16LE(1, 2);
    out.writeUInt16LE(entries.length, 4);
    entries.forEach((e, i) => {
      e.head.copy(out, 6 + i * 14);
      out.writeUInt32LE(e.bytesRes, 6 + i * 14 + 8);
      out.writeUInt16LE(e.iconId, 6 + i * 14 + 12);
    });
    if (out.length > leaf.size) throw new Error('RT_GROUP_ICON: новая группа больше слота');
    out.copy(buf, leaf.dataOff);
    buf.fill(0, leaf.dataOff + out.length, leaf.dataOff + leaf.size);
    buf.writeUInt32LE(out.length, leaf.leafOff + 4);
  }

  // VERSIONINFO: строки бренда, атрибуция Mozilla сохраняется
  const ver = leaves.find((l) => l.type === 16);
  if (ver) {
    const parsed = parseVersionTree(buf.subarray(ver.dataOff, ver.dataOff + ver.size));
    const map = versionStringMap(exeName);
    const strings = parsed.strings.map(([k, v]) => [k, map[k] ?? v]);
    for (const [, v] of strings) {
      if (/Zen/.test(v)) throw new Error(`в VERSIONINFO осталась строка Zen («${v}») — расширить карту замен`);
    }
    const out = serializeVersion(parsed.fixed, strings, parsed.varRaw);
    if (out.length <= ver.size) {
      out.copy(buf, ver.dataOff);
      buf.fill(0, ver.dataOff + out.length, ver.dataOff + ver.size);
      buf.writeUInt32LE(out.length, ver.leafOff + 4);
    } else {
      // расширяемся вправо: мусорные RT_STRING выбрасываются, живые ресурсы — блокер
      const after = leaves.filter((l) => l !== ver && l.dataOff > ver.dataOff);
      const blockers = after.filter((l) => l.type !== 6);
      if (blockers.length) {
        throw new Error(`VERSIONINFO: не хватает места, а после ресурса лежит тип ${blockers[0].type} — расширять нельзя`);
      }
      if (out.length > ctx.rawEnd - ver.dataOff) {
        throw new Error(`VERSIONINFO: не хватает места (нужно ${out.length} байт, есть ${ctx.rawEnd - ver.dataOff})`);
      }
      for (const leaf of after) removeDirEntry(buf, leaf);
      out.copy(buf, ver.dataOff);
      buf.fill(0, ver.dataOff + out.length, ctx.rawEnd);
      buf.writeUInt32LE(out.length, ver.leafOff + 4);
    }
    res.versionPatched = true;
  }

  await writeFile(exePath, buf);
  return res;
}
