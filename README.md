# Молния

Открытый браузер для рунета: пересборка релизов [Zen Browser](https://github.com/zen-browser/desktop) (движок Firefox, MPL 2.0) с доверенным корневым сертификатом Минцифры из коробки, поиском Яндекс по умолчанию, uBlock Origin и полностью выключенной телеметрией.

- Спека: `docs/superpowers/specs/2026-11-05-molniya-browser-design.md`
- План: `docs/superpowers/plans/2026-11-05-molniya-v1.md`
- Findings спайка (вся рецептура): `docs/spike-findings-mac.md`

## Что сделано (v1, статус: артефакты собираются)

| Кусок | Как работает |
|---|---|
| **Сертификаты Минцифры** | Файлы кладутся в `<приложение>/distribution/Certificates/` (заглавная C), в политике — голые имена. Движок политик ищет их первым делом в `XREAppDist` — это канонический механизм macOS/Linux; токен `{InstallationDirectory}` на маке не работает, autoconfig-песочница не умеет Components (всё проверено спайком) |
| **Поиск Яндекс** | Политика `SearchEngines.Add` + `Default` — движок регистрируется политикой, DuckDuckGo уже в комплекте — переключение в один клик |
| **Брендинг** | Пять слоёв: (1) sweep `\bZen Browser\b`/`\bZen\b` → «Молния» по всем `.ftl/.dtd/.properties` в browser-omni (82+209 строк, residue-контроль кидает исключение); (2) константы `AppConstants.sys.mjs` в toolkit-omni (вкомпиленый `MOZ_APP_NAME` и др.); (3) `application.ini` (Name/Vendor/Profile/RemotingName + **BuildID-бамп на каждый репак** — иначе стартовый кэш профилей переживает обновление); (4) `Info.plist` + `en.lproj/InfoPlist.strings` (имя у яблока); (5) картинки: wordmark-текст, лого-иконки из `assets/branding/` поверх зеновских векторов, `Molniya.icns` в бандл + **удаление `Assets.car`** (в нём зеновский AppIcon, который AppKit предпочитает) |
| **Телекартинка приватности** | Телеметрия/эксперименты/отчёты off; Safe Browsing, списки отзыва сертификатов, обновления расширений — ON (защита ≠ слежка; лендинг объясняет честно) |
| **Обновления** | Родной апдейтер Zen отключён (`DisableAppUpdate` + префы); встроенное расширение-детектор раз в день опрашивает GitHub Releases и показывает бейдж/уведомление (offline → тишина) |
| **Русский язык** | Форсируется локаль ru; ядро Firefox уже переведено и есть в комплекте (лэнгпак не нужен); строки самого Zena переведены сообществом, дыры добираем sweep'ом |
| **Сборки** | macOS `.dmg` (ad-hoc codesign, `hdiutil verify` в пайплайне), Windows portable `.zip` (NSIS-инсталлятор Zena **целиком извлекается 7z** → `core/` → патчи → zip; реестр не трогаем, сосуществование безопасно), Linux `.tar.xz` (лаунчер `molniya`, корень архива `molniya/`) |
| **CI** | `workflow_dispatch(zen_tag, build_n)` → матрица → draft-release с SHA256SUMS; Pages для лендинга |

## Как собрать

```bash
brew install p7zip          # один раз
npm install                 # нет — зависимостей нет; просто убедитесь, что Node ≥ 20
npm run toolcheck           # проверит внешние инструменты
npm run pipeline -- --os mac   --tag latest   # → dist/molniya-<версия>-mac.dmg
npm run pipeline -- --os win   --tag latest   # → dist/...-win.zip   (кросс-сборка!)
npm run pipeline -- --os linux --tag latest   # → dist/...-linux.tar.xz
```

Все три артефакта собираются **локально на macOS**. Версия Молнии = `<тег Zen>-molniya.<N>`.

## Как устроен репозиторий

```
src/config.mjs            — все константы: upstream, пины сертификатов и uBlock (sha256), бренд
src/fetch-upstream.mjs    — скачивание артефактов Zen + строгая проверка ассетов
src/certs.mjs             — сертификаты Минцифры только с gu-st.ru с проверкой пинов
src/build-distribution.mjs— policies.json, molniya.cfg, autoconfig, Certificates/, xpi расширений
src/patch-brand.mjs       — sweep строк, бренд-картинки, AppConstants, identity, BuildID-бамп
src/repack-mac|win|linux  — платформенная упаковка (codesign+hdiutil / zip / tar.xz)
src/pipeline.mjs          — оркестратор
detector-extension/       — webextension-детектор обновлений (MV2)
landing/                  — лендинг molniya-browser.ru (GitHub Pages)
scripts/check-links.mjs   — проверка ссылок лендинга
tests/                    — 32 теста (node --test): npm test
assets/branding/          —(wordmark, лого, иконки всех размеров — генерируются из мастера)
```

## Проверки

```bash
npm test                        # 32/32
node scripts/check-links.mjs    # ссылки лендинга
```

Защитные механизмы: SHA256-пины сертификатов и uBlock (ротация/подмена валит пайплайн), residue-контроль бренда (остаток «Zen» — исключение), `hdiutil verify` + `codesign --verify` в пайплайне, SHA256SUMS на каждый релиз.

## Известные компромиссы v1

- **Общий корень профиля с Zen** (`~/Library/Application Support/zen`): имя зашито в скомпилированном XUL, перепаковкой не меняется. Последовательная работа безопасна (движок один), одновременный запуск двух браузеров даст стандартный диалог «профиль используется». Формальное разделение — дорога А (сборка из исходников).
- **Без код-подписи** OS-вендоров: SmartScreen/Gatekeeper предупреждают (FAQ лендинга объясняет). Подпись — после подтверждённого спроса.
- Windows — portable zip без инсталлятора: реестр не трогаем, зато без прав администратора и следов.

## Релиз

1. GitHub → Actions → **release** → Run workflow (`zen_tag`, `build_n`) → draft-release с тремя артефактами + SHA256SUMS.
2. Чек-лист ручной приёмки: `docs/release-checklist.md` (заполняется на репетиции).
3. Обновление uBlock — вручную: скачать xpi, обновить `version`+`sha256` в `src/config.mjs`.

## Благодарности

«Молния» — независимая пересборка [Zen Browser](https://github.com/zen-browser/desktop) и Mozilla Firefox. Вся базовая работа — их. Лицензия MPL 2.0; товарные знаки принадлежат владельцам.
