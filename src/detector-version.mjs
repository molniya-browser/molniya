// Сравнение версий детектора обновлений. Тег релиза: <zenTag>-molniya.<N>,
// где zenTag — сегменты через точку (1.24b, 1.24.1), N — номер сборки Молнии.
// Функция встраивается в browser.js целиком (toString) — держать самодостаточной.

/**
 * Возвращает true, только если candidate строго новее current.
 * Нераспознанные теги — false (детектор молчит, а не предлагает ерунду).
 */
export function molniyaIsNewer(current, candidate) {
  const parse = (tag) => {
    const m = /^(\S+)-molniya\.(\d+)$/.exec(String(tag ?? ''));
    return m ? { zen: m[1].split('.'), build: Number(m[2]) } : null;
  };
  const a = parse(current);
  const b = parse(candidate);
  if (!a || !b) return false;
  if (a.zen.join('.') === b.zen.join('.')) return b.build > a.build;
  // сегмент: число + суффикс; суффикс = пре-релиз (24b < 24 < 25)
  const cmpSeg = (x, y) => {
    const nx = /^(\d+)(.*)$/.exec(x);
    const ny = /^(\d+)(.*)$/.exec(y);
    if (nx && ny) {
      const an = Number(nx[1]), bn = Number(ny[1]);
      if (an !== bn) return an < bn ? -1 : 1;
      if (nx[2] === ny[2]) return 0;
      if (!nx[2]) return 1; // 24 новее 24b
      if (!ny[2]) return -1;
      return nx[2] < ny[2] ? -1 : 1;
    }
    return x === y ? 0 : x < y ? -1 : 1;
  };
  const len = Math.max(a.zen.length, b.zen.length);
  for (let i = 0; i < len; i++) {
    const c = cmpSeg(a.zen[i] ?? '0', b.zen[i] ?? '0');
    if (c !== 0) return c < 0;
  }
  return false; // zen-части равны побуквенно, но build сравнен выше; сюда не доходим
}
