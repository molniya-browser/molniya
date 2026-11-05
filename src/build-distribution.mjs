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
about=Молния — пересборка Zen Browser (MPL 2.0). Zen Browser и Mozilla — авторы базового кода.
[Preferences]
intl.locale.requested=ru
`;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function defaultDownload(url) {
  const res = spawnSync('curl', ['-sSLf', '--max-time', '300', url], { maxBuffer: 64 * 1024 * 1024 }); // без encoding: бинарно-чисто
  if (res.status !== 0) throw new Error(`Не удалось скачать ${url}: curl → ${res.status}`);
  return res.stdout; // Buffer
}

function zipDirToBuffer(dir) {
  const res = spawnSync('zip', ['-qr', '-', '.'], { cwd: dir, maxBuffer: 128 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`zip ${dir} → ${res.status}`);
  return res.stdout;
}

/**
 * @param {string} root каталог установки (на mac = .app/Contents/Resources; win/linux = корень установки)
 * @param {object} opts {zenTag, detectorDir, downloads:{cert,ublock}, certs, ublock}
 * @returns {Promise<{files: string[]}>}
 */
export async function buildDistribution(root, opts = {}) {
  const {
    zenTag,
    detectorDir = 'detector-extension',
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
  const ublockPath = path.join(extDir, 'ublock-origin@molniya.xpi');
  await writeFile(ublockPath, ublockBuf);
  written.push(ublockPath);

  // 3) Детектор обновлений: упаковка каталога в xpi
  const detectorBuf = zipDirToBuffer(detectorDir);
  const detectorPath = path.join(extDir, 'update-detector@molniya.browser.xpi');
  await writeFile(detectorPath, detectorBuf);
  written.push(detectorPath);

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
