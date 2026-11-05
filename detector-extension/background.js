// Детектор обновлений Молнии: раз в день опрашивает GitHub Releases.
// Сеть недоступна — тишина (см. lib/version.js decideUpdate, Review Focus №1).
import { RELEASES_URL, decideUpdate } from './lib/version.js';

const ALARM = 'molniya-update-check';
const API = 'https://api.github.com/repos/molniya-browser/molniya/releases/latest';

async function getCurrentTag() {
  const info = await browser.runtime.getManifest(); // версия пакета — но тег Молнии храним сами
  const stored = await browser.storage.local.get('currentTag');
  return stored.currentTag ?? `${info.version}-molniya.1`; // запасной вариант до первой прошивки тега
}

async function check() {
  const { enabled = true, lastNotified = null } = await browser.storage.local.get(['enabled', 'lastNotified']);
  if (!enabled) return;

  let latestTag = null;
  let fetchError = null;
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = await res.json();
    latestTag = release.tag_name ?? null;
  } catch (e) {
    fetchError = e; // офлайн/блокировка — решает decideUpdate (тишина)
  }

  const currentTag = await getCurrentTag();
  const verdict = decideUpdate(currentTag, latestTag, fetchError, lastNotified);
  await browser.browserAction.setBadgeText({ text: verdict.badge });
  await browser.browserAction.setBadgeBackgroundColor({ color: '#e63946' });

  if (verdict.notify) {
    await browser.notifications.create('molniya-update', {
      type: 'basic',
      iconUrl: browser.runtime.getURL('icon.png'),
      title: 'Молния',
      message: `Доступна новая версия: ${latestTag}. Открыть страницу скачивания?`,
    });
    await browser.storage.local.set({ lastNotified: latestTag });
  }
}

browser.alarms.create(ALARM, { periodInMinutes: 60 * 24 });
browser.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) check(); });
browser.notifications.onClicked.addListener((id) => {
  if (id === 'molniya-update') browser.tabs.create({ url: RELEASES_URL });
});
browser.browserAction.onClicked.addListener(() => browser.tabs.create({ url: RELEASES_URL }));
browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'molniya:set-current-tag') {
    return browser.storage.local.set({ currentTag: msg.tag });
  }
});
check(); // проверка и при старте браузера
