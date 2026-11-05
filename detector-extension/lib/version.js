// Чистая логика версии детектора обновлений. Тег Молнии: <zenCore>-molniya.<N>, напр. 1.24b-molniya.2
export const RELEASES_URL = 'https://github.com/molniya-browser/molniya/releases/latest';
const TAG_RE = /^(.+)-molniya\.(\d+)$/;

export function parseTag(tag) {
  const m = TAG_RE.exec(String(tag ?? ''));
  if (!m) throw new Error(`Нераспознаваемый тег Молнии: «${tag}» (ожидаю <zenCore>-molniya.<N>)`);
  return { core: m[1], n: Number(m[2]) };
}

// Сравнение ядер zen-тега: числовые части по числу, затем суффикс ('' < 'a' < 'b' ... < 'z')
function compareCore(a, b) {
  const pa = a.split('.'), pb = b.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? '0', nb = pb[i] ?? '0';
    const ma = /^(\d+)([a-z]*)$/.exec(na), mb = /^(\d+)([a-z]*)$/.exec(nb);
    if (!ma || !mb) return na < nb ? -1 : na > nb ? 1 : 0; // запасной путь для неожиданных форм
    if (Number(ma[1]) !== Number(mb[1])) return Number(ma[1]) < Number(mb[1]) ? -1 : 1;
    if (ma[2] !== mb[2]) return ma[2] < mb[2] ? -1 : 1; // '' < 'a' < 'b'
  }
  return 0;
}

export function compareVersions(a, b) {
  const ta = parseTag(a), tb = parseTag(b);
  const core = compareCore(ta.core, tb.core);
  if (core !== 0) return core;
  return ta.n === tb.n ? 0 : ta.n < tb.n ? -1 : 1;
}

/**
 * Решение по результату проверки GitHub Releases.
 * @param {string} currentTag установленная версия
 * @param {string|null} latestTag тег релиза с GitHub (null при ошибке сети)
 * @param {Error|null} fetchError ошибка сети (тишина — не тревожим пользователя)
 * @param {string|null} lastNotified версия, о которой уже уведомляли
 */
export function decideUpdate(currentTag, latestTag, fetchError, lastNotified = null) {
  if (fetchError || !latestTag) return { badge: '', notify: false, url: null };
  let newer;
  try {
    newer = compareVersions(currentTag, latestTag) < 0;
  } catch {
    return { badge: '', notify: false, url: null }; // нераспознаваемый тег — тишина
  }
  if (!newer) return { badge: '', notify: false, url: null };
  return { badge: '⬆', notify: latestTag !== lastNotified, url: RELEASES_URL };
}
