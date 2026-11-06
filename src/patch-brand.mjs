// Патчер бренда Молнии: sweep строк omni.ja (browser), константы toolkit-omni,
// application.ini (с бампом BuildID — иначе стартовый кэш переживает репак),
// Info.plist + en.lproj/InfoPlist.strings + переименование бинарника (mac).
// Рецептура: docs/spike-findings-mac.md
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync, renameSync, existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG } from './config.mjs';

export class BrandResidueError extends Error {
  constructor(file) {
    super(`После замены бренда в «${file}» осталась строка Zen — проверить карту замен`);
    this.name = 'BrandResidueError';
    this.file = file;
  }
}

const LOCALE_RE = /\.(ftl|dtd|properties)$/;
// файлы под localization/** (без сегмента locale/) ИЛИ под chrome/**/locale/**
const PATH_RE = /(^|\/)localization\/|\/locale\//;
// бренд-файлы: residue-контроль строже — любой «Zen», даже слитный
const BRANDING_RE = /branding\/brand\.(ftl|properties|dtd)$/;
const SWEEP = [
  [/\bZen Browser\b/g, 'Молния'],
  [/\bZen\b/g, 'Молния'],
  [/\bZen OSS Team\b/g, 'Проект Молния'], // на случай порядка замен
];

export const DETECTOR_MARKER = 'MOLNIYA-UPDATE-DETECTOR';

/**
 * Встраивает детектор обновлений прямо в browser.js (chrome-привилегии, без подписи —
 * распределённые xpi без подписи release-Firefox молча отвергает, uBlock проходит как AMO-подписанный).
 * Идемпотентен: перезаписывает существующий блок, не дублируя.
 */
export function injectUpdateDetector(browserJsPath, version) {
  const code = `
// ==== ${DETECTOR_MARKER} (встроено пайплайном Молнии; не редактировать вручную) ====
try {
  const MCc = Components.classes, MCi = Components.interfaces;
  const MOLNIYA_VERSION = ${JSON.stringify(version)};
  const MOLNIYA_API = "https://api.github.com/repos/molniya-browser/molniya/releases/latest";
  const MOLNIYA_URL = "https://github.com/molniya-browser/molniya/releases/latest";
  const molniyaCheck = async () => {
    try {
      if (Services.prefs.getPrefType("molniya.updates.enabled") &&
          !Services.prefs.getBoolPref("molniya.updates.enabled")) return;
      const res = await fetch(MOLNIYA_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      const tag = ((await res.json()) || {}).tag_name || "";
      if (!tag || tag === MOLNIYA_VERSION) return;
      if (Services.prefs.getStringPref("molniya.updates.notifiedVersion", "") === tag) return;
      Services.prefs.setStringPref("molniya.updates.notifiedVersion", tag);
      const alerts = MCc["@mozilla.org/alerts-service;1"].getService(MCi.nsIAlertsService);
      alerts.showAlertNotification(null, "Молния",
        "Доступна версия " + tag + ". Открыть страницу скачивания?",
        true, "molniya-update",
        (sb, topic) => { if (topic === "alertclickcallback") openTrustedLinkIn(MOLNIYA_URL, "tab"); });
    } catch (e) {}
  };
  setTimeout(molniyaCheck, 20000);
  setInterval(molniyaCheck, 24 * 60 * 60 * 1000);
} catch (e) {}
// ==== конец ${DETECTOR_MARKER} ====
`;
  let src = readFileSync(browserJsPath, 'utf8');
  const re = new RegExp(`\\n?// ==== ${DETECTOR_MARKER}[\\s\\S]*?// ==== конец ${DETECTOR_MARKER} ====\\n?`, 'g');
  src = src.replace(re, '\n');
  writeFileSync(browserJsPath, src + code, 'utf8');
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { maxBuffer: 256 * 1024 * 1024, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${res.status}: ${String(res.stderr).slice(0, 300)}`);
  return res.stdout;
}

// omni.ja Zena: 4 мусорных байта перед PK → 7z ругается на заголовки (exit 2), но распаковывает
// полностью (проверено спайком: 13 597 файлов, рабочее приложение). Терпим код, проверяем содержимое.
function extractOmni(omniPath, tree) {
  const res = spawnSync('7z', ['x', '-y', `-o${tree}`, omniPath], { maxBuffer: 256 * 1024 * 1024 });
  const looksComplete = ['chrome.manifest', 'chrome', 'modules', 'localization'].some((m) => existsSync(path.join(tree, m)));
  if (!looksComplete) {
    throw new Error(`7z x ${omniPath} → ${res.status}: ${String(res.stderr ?? '').slice(0, 300)} (архив не распакован)`);
  }
}

function* walkLocaleFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkLocaleFiles(p);
    else if (LOCALE_RE.test(entry.name) && PATH_RE.test(p)) yield p;
  }
}

// About-диалог: минимум текста, обновления «поставляются сборками» (не «отключены»)
const UPDATE_TEXT_RU = 'Обновления поставляются сборками Молния — о новой версии браузер сообщит сам';
const UPDATE_TEXT_EN = 'Updates ship with Молния builds — the browser will notify you when a new version is out';
const BLANK = '{ " " }';

export function aboutDialogOverrides(content, ru) {
  const text = ru ? UPDATE_TEXT_RU : UPDATE_TEXT_EN;
  // значение + вариант .label
  content = content.replace(/^(update-policy-disabled)( = ).*$/m, `$1$2${text}`);
  content = content.replace(/(^\s+\.label = )Обновления отключены вашей организацией$/m, `$1${text}`);
  // убрать абзацы про сообщество/пожертвования (лицензионную ссылку не трогаем)
  for (const id of ['community-exp', 'community-2', 'helpus', 'helpus-referrals2', 'helpus-2']) {
    content = content.replace(new RegExp(`^(${id.replace(/[-]/g, '\\-')}) = .*$`, 'm'), `$1 = ${BLANK}`);
  }
  return content;
}

/**
 * Патчит ЛОКАЛЬНЫЕ строки в omni.ja (browser): распаковка 7z → sweep → residue-контроль → zip -qrX.
 * @returns {Promise<{replaced: number}>}
 */
export async function patchOmni(omniPathArg, { workDir, brandAssets, version } = {}) {
  const omniPath = path.resolve(omniPathArg); // zip запускается с cwd=дерево: только абсолютный путь
  const tmp = workDir ?? mkdtempSync(path.join(tmpdir(), 'omni-patch-'));
  const tree = path.join(tmp, 'tree');
  mkdirSync(tree, { recursive: true });
  extractOmni(omniPath, tree);

  let replaced = 0;

  // Бренд-КАРТИНКИ: wordmark/logo/иконки из каталога ассетов (безусловно — даже если файла в архиве не было)
  if (brandAssets) {
    const brandingDir = path.join(tree, 'chrome', 'browser', 'content', 'branding');
    if (!existsSync(brandingDir)) throw new Error('В omni.ja нет каталога branding — структура изменилась');
    for (const name of readdirSync(brandAssets)) {
      cpSync(path.join(brandAssets, name), path.join(brandingDir, name));
    }
  }

  // Детектор обновлений — встроенный код браузера (без подписи, chrome-привилегии)
  if (version) {
    const bjs = path.join(tree, 'chrome', 'browser', 'content', 'browser', 'browser.js');
    if (existsSync(bjs)) injectUpdateDetector(bjs, version);
  }

  for (const file of walkLocaleFiles(tree)) {
    let content = await readFile(file, 'utf8');
    // About-диалог: «обновления отключены» → «поставляются сборками»; комьюнити-абзацы — убрать
    if (/aboutDialog\.ftl$/.test(file)) {
      content = aboutDialogOverrides(content, /\/ru\//.test(file));
      await writeFile(file, content, 'utf8');
      if (!/Zen/.test(content)) continue;
    }
    if (!/Zen/.test(content)) continue;
    let n = 0;
    // сначала фразы целиком, потом отдельные слова
    for (const [re, to] of [
      [/\bZen OSS Team\b/g, 'Проект Молния'],
      [/\bZen Browser\b/g, 'Молния'],
      [/\bZen\b/g, 'Молния'],
    ]) {
      content = content.replace(re, () => { n++; return to; });
    }
    const residueRe = BRANDING_RE.test(file) ? /Zen/ : /\bZen\b/;
    if (residueRe.test(content)) throw new BrandResidueError(path.relative(tree, file));
    if (n > 0) {
      await writeFile(file, content, 'utf8');
      replaced += n;
    }
  }

  rmSync(omniPath, { force: true });
  sh('zip', ['-qrX', omniPath, '.'], { cwd: tree });
  if (!workDir) rmSync(tmp, { recursive: true, force: true });
  return { replaced };
}

const APP_INI = [
  [/^Vendor=.*$/m, 'Vendor=Molniya Project'],
  [/^Name=Zen$/m, 'Name=Molniya'],
  [/^RemotingName=.*$/m, 'RemotingName=molniya'],
  [/^Profile=.*$/m, 'Profile=molniya'],
  [/^BuildID=.*$/m, `BuildID=${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`],
];

const TK_CONSTANTS = [
  [/MOZ_APP_NAME: "zen"/g, 'MOZ_APP_NAME: "molniya"'],
  [/MOZ_APP_BASENAME: "Zen"/g, 'MOZ_APP_BASENAME: "Molniya"'],
  [/MOZ_APP_DISPLAYNAME_DO_NOT_USE: "Zen"/g, 'MOZ_APP_DISPLAYNAME_DO_NOT_USE: "Molniya"'],
  [/MOZ_MACBUNDLE_ID: "app\.zen-browser\.zen"/g, 'MOZ_MACBUNDLE_ID: "ru.molniya.browser"'],
  [/MOZ_MACBUNDLE_NAME: "Zen\.app"/g, 'MOZ_MACBUNDLE_NAME: "Молния.app"'],
];

async function patchToolkitOmni(omniPathArg, tmp) {
  const omniPath = path.resolve(omniPathArg);
  const tree = path.join(tmp, 'tk-tree');
  mkdirSync(tree, { recursive: true });
  extractOmni(omniPath, tree);
  const acPath = path.join(tree, 'modules', 'AppConstants.sys.mjs');
  let ac = await readFile(acPath, 'utf8');
  for (const [re, to] of TK_CONSTANTS) ac = ac.replace(re, to);
  await writeFile(acPath, ac, 'utf8');
  rmSync(omniPath, { force: true });
  sh('zip', ['-qrX', omniPath, '.'], { cwd: tree });
}

/**
 * Идентичность приложения: application.ini (+BuildID-бамп), toolkit omni (AppConstants),
 * mac: Info.plist, en.lproj/InfoPlist.strings, переименование бинарника zen→molniya.
 * @param {string} contentsDir каталог Contents (mac) или корень установки (linux/win)
 */
export async function patchAppIdentity(contentsDir, { platform } = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'identity-'));
  const result = { renamedBinary: false };
  try {
    // mac: Resources внутри .app/Contents; win/linux: корень каталога установки
    const resources = platform === 'mac' ? path.join(contentsDir, 'Resources') : contentsDir;
    const iniPath = path.join(resources, 'application.ini');
    if (existsSync(iniPath)) {
      let ini = await readFile(iniPath, 'utf8');
      for (const [re, to] of APP_INI) ini = ini.replace(re, to);
      await writeFile(iniPath, ini, 'utf8');
    }
    const tkOmni = path.join(resources, 'omni.ja');
    if (existsSync(tkOmni)) await patchToolkitOmni(tkOmni, tmp);

    if (platform === 'mac') {
      const plist = path.join(contentsDir, 'Info.plist');
      sh('plutil', ['-replace', 'CFBundleName', '-string', CONFIG.brand.name, plist]);
      sh('plutil', ['-replace', 'CFBundleIdentifier', '-string', CONFIG.brand.bundleId, plist]);
      sh('plutil', ['-replace', 'CFBundleExecutable', '-string', 'molniya', plist]);
      const strings = path.join(resources, 'en.lproj', 'InfoPlist.strings');
      if (existsSync(strings)) {
        sh('plutil', ['-convert', 'xml1', strings]);
        sh('plutil', ['-replace', 'CFBundleName', '-string', CONFIG.brand.name, strings]);
      }
      const oldBin = path.join(contentsDir, 'MacOS', 'zen');
      const newBin = path.join(contentsDir, 'MacOS', 'molniya');
      if (existsSync(oldBin)) {
        renameSync(oldBin, newBin);
        result.renamedBinary = true;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return result;
}
