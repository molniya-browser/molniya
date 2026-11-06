// Единый источник правды пайплайна «Молния».
// Спека: docs/superpowers/specs/2026-11-05-molniya-browser-design.md

export const CONFIG = {
  brand: {
    name: 'Молния',
    latin: 'Molniya',
    bundleId: 'ru.molniya.browser',
  },
  upstream: {
    owner: 'zen-browser',
    repo: 'desktop',
    // канал stable (см. Global Constraints плана)
    assets: {
      win: 'zen.installer.exe',
      mac: 'zen.macos-universal.dmg',
      linux: 'zen.linux-x86_64.tar.xz',
    },
  },
  certs: [
    {
      file: 'russian_trusted_root_ca_pem.crt',
      url: 'https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt',
      sha256: '936a43fea6e8e525bcc0f81acd9c3d21b4fc4b9b68acea7906d698005afc6504',
    },
    {
      file: 'russian_trusted_sub_ca_pem.crt',
      url: 'https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt',
      sha256: 'f0ae589f36774f29ef3648f7984b08d42fcce6f1ffeeb6236d773daeb2744ea6',
    },
  ],
  search: {
    default: 'Яндекс',
    // механизм валидирован спайком: политика SearchEngines.Add + Default
    mechanism: 'policy',
  },
  extensions: {
    ublock: {
      url: 'https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/addon-607454-latest.xpi',
      version: '1.75.4', // обновляется вручную по чек-листу релиза
      // внутренний ID расширения: Firefox требует, чтобы имя distribution-XPI совпадало с ним
      id: 'uBlock0@raymondhill.net',
      sha256: 'e2df503cce7cf5069130618c349695f62bdddb9eb8c189156d027269ae4ae267',
    },
  },
  github: {
    org: 'molniya-browser',
    repo: 'molniya',
  },
  paths: {
    work: 'work',
    dist: 'dist',
  },
};
