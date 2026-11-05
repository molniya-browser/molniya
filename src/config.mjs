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
      sha256: 'e2df503cce7cf5069130618c349695f62bdddb9eb8c189156d027269ae4ae267',
    },
    {
      file: 'russian_trusted_sub_ca_pem.crt',
      url: 'https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt',
      sha256: 'e2df503cce7cf5069130618c349695f62bdddb9eb8c189156d027269ae4ae267',
    },
  ],
  search: {
    default: 'Яндекс',
    // 'policy' | 'autoconfig' | 'both' — фиксируется findings спайка (Task 4)
    mechanism: 'both',
  },
  extensions: {
    ublock: {
      url: 'https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/addon-607454-latest.xpi',
      // Пинится при первом прогоне генератора (Task 6); дальше — вручную по чек-листу релиза.
      version: null,
      sha256: null,
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
