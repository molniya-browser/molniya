// Генератор distribution/ и autoconfig для Молнии.
// Рецептура валидирована спайком: docs/spike-findings-mac.md
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { CertPinError } from './certs.mjs';

const POPULAR_SITES = [
  { Title: 'Госуслуги', URL: 'https://www.gosuslugi.ru' },
  { Title: 'ВКонтакте', URL: 'https://vk.com' },
  { Title: 'YouTube', URL: 'https://www.youtube.com' },
  { Title: 'Ozon', URL: 'https://www.ozon.ru' },
  { Title: 'Wildberries', URL: 'https://www.wildberries.ru' },
  { Title: 'Mail.ru', URL: 'https://mail.ru' },
  { Title: 'Тинькофф', URL: 'https://www.tinkoff.ru' },
  { Title: 'Кинопоиск', URL: 'https://hd.kinopoisk.ru' },
].map((b) => ({ ...b, Folder: 'Популярное', Placement: 'toolbar', Favicon: b.URL + '/favicon.ico' }));

function policiesJson() {
  return {
    policies: {
      Certificates: {
        Install: CONFIG.certs.map((c) => c.file), // голые имена: поиск из XREAppDist/Certificates
      },
      DisableTelemetry: true,
      DisableAppUpdate: true,
      DisableFeedbackCommands: true,
      DisableFirefoxStudies: true,
      OverrideFirstRunPage: '',
      OverridePostUpdatePage: '',
      SearchEngines: {
        Add: [
          {
            Name: CONFIG.search.default,
            IconURL: 'https://yandex.ru/favicon.ico',
            URLTemplate: 'https://yandex.ru/search/?text={searchTerms}',
            SuggestURLTemplate: 'https://suggest.yandex.ru/suggest-ff.cgi?part={searchTerms}',
            Method: 'GET',
            Encoding: 'UTF-8',
          },
        ],
        Default: CONFIG.search.default,
      },
      Bookmarks: POPULAR_SITES,
    },
  };
}

const CFG = `// Molniya: default prefs (autoconfig sandbox = pref-only, no Components).
// Телеметрия off; защитные проверки ON (Safe Browsing, обновления расширений).
defaultPref("intl.locale.requested", "ru");
defaultPref("browser.search.region", "RU");
defaultPref("datareporting.healthreport.uploadEnabled", false);
defaultPref("datareporting.policy.dataSubmissionEnabled", false);
defaultPref("toolkit.telemetry.unified", false);
defaultPref("toolkit.telemetry.enabled", false);
defaultPref("browser.ping-centre.telemetry", false);
defaultPref("browser.safebrowsing.malware.enabled", true);
defaultPref("browser.safebrowsing.phishing.enabled", true);
defaultPref("extensions.update.enabled", true);
defaultPref("app.update.enabled", false);
defaultPref("app.update.auto", false);
`;

const AUTOCONFIG_JS = `pref("general.config.filename", "molniya.cfg");
pref("general.config.obscure_value", 0);
`;

const DISTRIBUTION_INI = `[Global]
id=molniya
version=1.0.0
about=Пересборка Zen Browser и Mozilla (MPL 2.0)
[Preferences]
intl.locale.requested=ru
`;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function defaultDownload(url) {
  const res = spawnSync('curl', ['-sSLf', '--max-time', '300', '--retry', '5', '--retry-delay', '3', '--retry-all-errors', url], { maxBuffer: 64 * 1024 * 1024 }); // без encoding: бинарно-чисто
  if (res.status !== 0) throw new Error(`Не удалось скачать ${url}: curl → ${res.status}`);
  return res.stdout; // Buffer
}

/**
 * @param {string} root каталог установки (на mac = .app/Contents/Resources; win/linux = корень установки)
 * @param {object} opts {zenTag, downloads:{cert,ublock}, certs, ublock}
 * @returns {Promise<{files: string[]}>}
 */
/** Читает browser_specific_settings.gecko.id (или applications.gecko.id) из манифеста XPI. */
async function xpiGeckoId(buf) {
  const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(path.join(tmpdir(), 'xpi-'));
  try {
    const xpiPath = path.join(tmp, 'addon.xpi');
    await writeFile(xpiPath, buf);
    const res = spawnSync('7z', ['x', '-so', xpiPath, 'manifest.json'], { maxBuffer: 8 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`не удалось прочитать manifest.json из XPI (7z → ${res.status})`);
    const manifest = JSON.parse(res.stdout.toString('utf8'));
    return manifest.browser_specific_settings?.gecko?.id ?? manifest.applications?.gecko?.id ?? null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function buildDistribution(root, opts = {}) {
  const {
    zenTag,
    downloads = {},
    certs = CONFIG.certs,
    ublock = CONFIG.extensions.ublock,
  } = opts;
  if (!zenTag) throw new Error('buildDistribution: нужен zenTag (для distribution.ini/version)');

  const dist = path.join(root, 'distribution');
  const certDir = path.join(dist, 'Certificates');
  const extDir = path.join(dist, 'extensions');
  mkdirSync(certDir, { recursive: true });
  mkdirSync(extDir, { recursive: true });
  mkdirSync(path.join(root, 'defaults', 'pref'), { recursive: true });

  const certDownload = downloads.cert ?? defaultDownload;
  const written = [];

  // 1) Сертификаты Минцифры с проверкой пинов
  for (const cert of certs) {
    const buf = await certDownload(cert.url);
    const actual = sha256(buf);
    if (actual !== String(cert.sha256).toLowerCase()) {
      throw new CertPinError(cert.file, cert.sha256, actual);
    }
    const p = path.join(certDir, cert.file);
    await writeFile(p, buf);
    written.push(p);
  }

  // 2) uBlock Origin (пин: версия+sha256 в CONFIG; обновление — вручную по чек-листу релиза)
  const ublockBuf = await (downloads.ublock ?? defaultDownload)(ublock.url);
  const ublockActual = sha256(ublockBuf);
  if (ublock.sha256 && ublockActual !== String(ublock.sha256).toLowerCase()) {
    throw new CertPinError('ublock-origin.xpi', ublock.sha256, ublockActual);
  }
  // Firefox ставит distribution-аддон только если имя файла = внутреннему ID
  // расширения; сверяем манифест с ожидаемым ID (fail-fast, а не молчащий провал)
  const manifestId = await xpiGeckoId(ublockBuf);
  if (manifestId !== ublock.id) {
    throw new Error(`uBlock: ID манифеста «${manifestId}» ≠ ожидаемому «${ublock.id}» — файл будет назван неправильно`);
  }
  const ublockPath = path.join(extDir, `${ublock.id}.xpi`);
  await writeFile(ublockPath, ublockBuf);
  written.push(ublockPath);

  // 4) policies.json / cfg / autoconfig / distribution.ini
  const files = [
    [path.join(dist, 'policies.json'), JSON.stringify(policiesJson(), null, 2) + '\n'],
    [path.join(root, 'molniya.cfg'), CFG],
    [path.join(root, 'defaults', 'pref', 'autoconfig.js'), AUTOCONFIG_JS],
    [path.join(dist, 'distribution.ini'), DISTRIBUTION_INI.replace('version=1.0.0', `version=${zenTag}`)],
  ];
  for (const [p, content] of files) {
    await writeFile(p, content, 'utf8');
    written.push(p);
  }
  return { files: written };
}
