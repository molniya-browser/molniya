// Синтетический мини-PE с секцией .rsrc — фикстуры для тестов src/patch-win-exe.mjs.
// Реализации независимы от продакшн-кода: если формат поня́т неверно,
// тесты обязаны разъехаться, а не подтверждать самосебя.
import { deflateSync } from 'node:zlib';

// ---------- PNG ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Однотонный валидный PNG 8-bit RGBA (фильтр 0). */
export function pngWriter(size, [r, g, b, a]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит
  ihdr[9] = 6; // RGBA
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) row.set([r, g, b, a], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** «Чужой» PNG-слот: сигнатура + мусор до нужного размера. */
export function fakePng(size) {
  const buf = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buf, 0);
  return buf;
}

/** «Чужой» BMP-кадр: корректный BITMAPINFOHEADER + пиксели-маркер 0xAA. */
export function bmpOld(size) {
  const frame = Buffer.alloc(40 + size * size * 4 + (((Math.ceil(size / 8) + 3) & ~3)) * size);
  frame.writeUInt32LE(40, 0);
  frame.writeInt32LE(size, 4);
  frame.writeInt32LE(size * 2, 8);
  frame.writeUInt16LE(1, 12);
  frame.writeUInt16LE(32, 14);
  frame.fill(0xaa, 40);
  return frame;
}

// ---------- VERSIONINFO ----------

const utf16 = (s) => Buffer.from(s, 'utf16le');
const pad4 = (n) => (4 - (n % 4)) % 4;

/** String-структура: длина в байтах, длина значения в символах, ключ, значение. */
function stringStruct(key, value) {
  const keyBuf = Buffer.concat([utf16(key), Buffer.alloc(2)]);
  const valBuf = utf16(value);
  const headLen = 6 + keyBuf.length + pad4(6 + keyBuf.length);
  const total = headLen + valBuf.length + pad4(headLen + valBuf.length);
  const buf = Buffer.alloc(total);
  buf.writeUInt16LE(total, 0);
  buf.writeUInt16LE(valBuf.length / 2, 2);
  buf.writeUInt16LE(1, 4);
  keyBuf.copy(buf, 6);
  valBuf.copy(buf, headLen);
  return buf;
}

/** Структура VERSIONINFO-дерева: ключ + (опц.) двоичное значение + (опц.) тело-дети. */
function structOf(key, { value = null, body = Buffer.alloc(0), type = 1 } = {}) {
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

/** Полный VS_VERSION_INFO с набором строк (как rc.exe). */
export function versionInfoBlock(strings) {
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  fixed.writeUInt32LE(0x00010000, 4);
  const stringChildren = Buffer.concat(Object.entries(strings).map(([k, v]) => stringStruct(k, v)));
  const table = structOf('000004b0', { body: stringChildren });
  const sfi = structOf('StringFileInfo', { body: table });
  const varValue = Buffer.alloc(4);
  varValue.writeUInt16LE(0x0409, 0);
  varValue.writeUInt16LE(0x04b0, 2);
  const vfi = structOf('VarFileInfo', { body: structOf('Translation', { value: varValue, type: 0 }) });
  return structOf('VS_VERSION_INFO', { value: fixed, body: Buffer.concat([sfi, vfi]), type: 0 });
}

/** Обратный разбор VS_VERSION_INFO → { ключ: значение }. */
export function parseVersionStrings(block) {
  const readKey = (off) => {
    let end = off;
    while (!(block[end] === 0 && block[end + 1] === 0)) end += 2;
    return { key: block.toString('utf16le', off, end), len: end - off + 2 };
  };
  const walk = (off, end, out) => {
    let p = off;
    while (p < end) {
      const wLength = block.readUInt16LE(p);
      const wValueLength = block.readUInt16LE(p + 2);
      const head = p + 6;
      const { key, len } = readKey(head);
      const bodyStart = head + len + pad4(head + len - p);
      if (key === 'StringFileInfo') {
        walk(bodyStart, p + wLength, out); // таблицы — в общий аккумулятор
      } else if (/^[0-9a-f]{8}$/.test(key)) {
        walkStrings(bodyStart, p + wLength, out);
      }
      p += wLength;
    }
    return out;
  };
  const walkStrings = (off, end, out) => {
    let p = off;
    while (p < end) {
      const wLength = block.readUInt16LE(p);
      const wValueLength = block.readUInt16LE(p + 2);
      const head = p + 6;
      const { key, len } = readKey(head);
      const bodyStart = head + len + pad4(head + len - p);
      if (wValueLength > 0) out[key] = block.toString('utf16le', bodyStart, bodyStart + wValueLength * 2);
      p += wLength;
    }
  };
  // root: ключ → fixed 52 → дети
  const root = readKey(6);
  const childrenStart = 6 + root.len + pad4(6 + root.len) + 52;
  return walk(childrenStart, block.readUInt16LE(0), {});
}

// ---------- Сборка мини-PE ----------

const ZEN_STRINGS = {
  FileDescription: 'Zen',
  FileVersion: '159.0',
  ProductVersion: '1.24b',
  InternalName: 'Zen',
  CompanyName: 'Mozilla Corporation',
  OriginalFilename: 'zen.exe',
  ProductName: 'Zen',
  LegalCopyright: 'Firefox and Mozilla Developers; available under the MPL 2 license.',
};

/**
 * Мини-PE: секция .rsrc с иконками, группами, VERSIONINFO и (опц.) RT_STRING.
 * spec.icons: [{ id, data }]; spec.groups: [{ id, entries: [{ w, bytesRes, iconId }] }];
 * spec.versionStrings: объект строк (или null); spec.stringTableBytes: размер мусорного RT_STRING;
 * spec.slack: нулевой запас в конце секции.
 */
export function buildSyntheticPe(spec) {
  const types = [];
  if (spec.icons?.length) types.push({ type: 3, items: spec.icons });
  if (spec.groups?.length) types.push({ type: 14, items: spec.groups.map((g) => ({ id: g.id, data: groupDir(g.entries) })) });
  const version = spec.versionStrings ? versionInfoBlock(spec.versionStrings) : null;
  if (version) types.push({ type: 16, items: [{ id: 1, data: version }] });
  // RT_STRING в реальных exe лежит после VERSIONINFO — патчер расширяется в него
  if (spec.stringTableBytes) types.push({ type: 6, items: [{ id: 7, data: Buffer.alloc(spec.stringTableBytes, 0x55) }] });

  const dirsSize = 16 + 8 * types.length + types.reduce((s, t) => s + 16 + 8 * t.items.length, 0);
  let cursor = dirsSize;
  const placed = types.map((t) => ({
    ...t,
    items: t.items.map((item) => {
      const entryOff = cursor;
      cursor += 16;
      const dataOff = cursor;
      cursor += item.data.length + pad4(item.data.length);
      return { ...item, entryOff, dataOff };
    }),
  }));
  const rsrcSize = cursor + (spec.slack ?? 0);

  const raw = Buffer.alloc(rsrcSize);
  const VA = 0x1000;
  // корневой каталог
  raw.writeUInt16LE(types.length, 14);
  placed.forEach((t, i) => {
    const e = 16 + i * 8;
    raw.writeUInt32LE(t.type, e);
    raw.writeUInt32LE((0x80000000 | (16 + 8 * types.length + types.slice(0, i).reduce((s, x) => s + 16 + 8 * x.items.length, 0))) >>> 0, e + 4);
  });
  // каталоги типов: записи-листья указывают на data entry
  placed.forEach((t, ti) => {
    const dirOff = 16 + 8 * types.length + types.slice(0, ti).reduce((s, x) => s + 16 + 8 * x.items.length, 0);
    raw.writeUInt16LE(t.items.length, dirOff + 14);
    t.items.forEach((item, i) => {
      const e = dirOff + 16 + i * 8;
      raw.writeUInt32LE(item.id, e);
      raw.writeUInt32LE(item.entryOff, e + 4); // без 0x80000000 → лист
      raw.writeUInt32LE(VA + item.dataOff, item.entryOff);
      raw.writeUInt32LE(item.data.length, item.entryOff + 4);
      item.data.copy(raw, item.dataOff);
    });
  });

  // PE-обёртка
  const RAW_PTR = 0x200;
  const file = Buffer.alloc(RAW_PTR + rsrcSize);
  file.write('MZ', 0, 'latin1');
  file.writeUInt32LE(0x80, 0x3c);
  file.write('PE\0\0', 0x80, 'latin1');
  const coff = 0x84;
  file.writeUInt16LE(0x8664, coff);
  file.writeUInt16LE(1, coff + 2);
  file.writeUInt16LE(240, coff + 16);
  const opt = coff + 20;
  file.writeUInt16LE(0x20b, opt);
  file.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes
  file.writeUInt32LE(VA, opt + 128); // datadir[2].rva
  file.writeUInt32LE(rsrcSize, opt + 132);
  const sect = opt + 240;
  file.write('.rsrc\0\0\0', sect, 'latin1');
  file.writeUInt32LE(rsrcSize, sect + 8); // VirtualSize
  file.writeUInt32LE(VA, sect + 12);
  file.writeUInt32LE(rsrcSize, sect + 16); // SizeOfRawData
  file.writeUInt32LE(RAW_PTR, sect + 20);
  raw.copy(file, RAW_PTR);
  return file;
}

/** GRPICONDIR из записей { w (0 = 256), bytesRes, iconId }. */
export function groupDir(entries) {
  const buf = Buffer.alloc(6 + 14 * entries.length);
  buf.writeUInt16LE(1, 2); // тип: иконка
  buf.writeUInt16LE(entries.length, 4);
  entries.forEach((e, i) => {
    const p = 6 + i * 14;
    buf.writeUInt8(e.w & 0xff, p);
    buf.writeUInt8(e.w & 0xff, p + 1);
    buf.writeUInt16LE(32, p + 6); // бит
    buf.writeUInt32LE(e.bytesRes, p + 8);
    buf.writeUInt16LE(e.iconId, p + 12);
  });
  return buf;
}

/** Разбор листьев .rsrc после патча: [{ type, id, size, data }]. */
export function parseRsrcLeaves(buf) {
  const peOff = buf.readUInt32LE(0x3c);
  const optSize = buf.readUInt16LE(peOff + 20);
  const opt = peOff + 24;
  const rsrcRva = buf.readUInt32LE(opt + 128);
  const numSections = buf.readUInt16LE(peOff + 6);
  const sections = [];
  for (let i = 0; i < numSections; i++) {
    const s = opt + optSize + i * 40;
    sections.push({ va: buf.readUInt32LE(s + 12), rawSize: buf.readUInt32LE(s + 16), raw: buf.readUInt32LE(s + 20) });
  }
  const rsrc = sections.find((s) => rsrcRva >= s.va && rsrcRva < s.va + s.rawSize);
  const va = rsrc.va;
  const rawPtr = rsrc.raw;
  const dirOff = rsrcRva - va + rawPtr;
  const rva2o = (rva) => {
    const s = sections.find((x) => rva >= x.va && rva < x.va + x.rawSize);
    return rva - s.va + s.raw;
  };
  const leaves = [];
  const walk = (d, p) => {
    const n = buf.readUInt16LE(d + 12) + buf.readUInt16LE(d + 14);
    for (let i = 0; i < n; i++) {
      const e = d + 16 + i * 8;
      const name = buf.readUInt32LE(e);
      const off = buf.readUInt32LE(e + 4);
      if (off & 0x80000000) walk(dirOff + (off & 0x7fffffff), [...p, name]);
      else {
        const leaf = dirOff + off;
        const size = buf.readUInt32LE(leaf + 4);
        const dataOff = rva2o(buf.readUInt32LE(leaf));
        leaves.push({ type: p[0], id: p[1] ?? name, size, data: Buffer.from(buf.subarray(dataOff, dataOff + size)) });
      }
    }
  };
  walk(dirOff, []);
  return leaves;
}

export { ZEN_STRINGS };
