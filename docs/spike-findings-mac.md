# Спайк macOS — findings (перепаковка Zen Browser)

- Дата: 2026-11-05
- Upstream: `zen-browser/desktop`, тег `1.24b`, артефакт `zen.macos-universal.dmg` (227 МБ)
- Живой результат: `work/spike/Молния.app` + `work/spike/molniya-spike.dmg` (250 МБ, hdiutil verify: VALID)

## Проверено автоматически (headless)

1. **Метод перепаковки omni.ja**: `7z x` работает, Info-ZIP `unzip` — НЕТ (у omni.ja Zena 4 мусорных байта перед PK-сигнатурой; читается только с конца). Обратно: `zip -qrX -x "*.DS_Store"`. Браузер стартует с патченным omni.ja (tab-процесс поднялся с `-appomni` на нашем файле, профиль создан, sandbox-процессы живы).
2. **Брендинг**: два семейства файлов — `chrome/<локаль>/locale/branding/brand.properties` (4 ключа: brandShorterName/brandShortName/brandFullName/vendorShortName) и `localization/<локаль>/branding/brand.ftl` (5 паттернов: `-brand-*`, `-vendor-short-name`). Всего 82 файла во всех локалях, патчатся sed-заменами, остатка «Zen» нет. **Toolkit `Resources/omni.ja` брендинга не содержит** — патчим только `browser/omni.ja`.
3. **Идентичность и сосуществование**: `Info.plist` → CFBundleName=Молния, CFBundleIdentifier=ru.molniya.browser (CFBundleDisplayName отсутствует и не нужен). `application.ini` → **Name=Molniya (латиницей осознанно: CLI/пути), Vendor=Molniya Project, Profile=molniya, RemotingName=molniya**. Ключевое: `Profile=molniya` задаёт корень профиля `~/Library/Application Support/molniya` (у Zen — `.../zen`), т.е. сосуществование и неприкосновенность профилей Zen обеспечены правкой одной строки.
4. **Поиск**: в снапшоте Remote Settings 55 движков, **Яндекса нет**, DuckDuckGo есть. Механизм по умолчанию: **политика `SearchEngines.Add` + `Default`** — подтверждено декодированием `search.json.mozlz4` профиля: движок `policy-Яндекс` (`_loadPath:"[policy]"`), `appDefaultEngineId: policy-Яндекс`, `locale: ru`, `region: RU`. Поисковое web-extension (distribution/extensions/*.xpi и каталог) в этой версии НЕ подхватывается — не тратить время, механизм = политика.
5. **Локаль**: `chrome/ru` в комплекте — ядро уже русское; собственные строки Zena: `localization/ru` = 151 файл, приличное покрытие. Лэнгпак с ftp.mozilla.org для ядра НЕ нужен. Остатки английского в UI Zena — смотреть партнёру (п.6 чек-листа).
6. **Политики/autoconfig**: `policies.json` из `Contents/Resources/distribution/` читается (доказано п.4). Autoconfig: `molniya.cfg` в `Contents/Resources/` + `defaults/pref/autoconfig.js` с диска — работают (locale/region применились). Телеметрия/апдейтер: DisableTelemetry + DisableAppUpdate в политиках, дубли в cfg.
7. **Codesign/DMG**: после `xattr -cr` ad-hoc `codesign -f -s - --deep` проходит, `--verify` OK. DMG: `hdiutil create -volname Молния -format UDZO` + verify VALID. Первое правило: `xattr -cr` ПЕРЕД каждой подписью.

## Не проверяемо в headless → чек-лист партнёра (GUI)

- **Certificates.Install**: в headless импорта корней в `cert9.db` не происходит (проверены и `{InstallationDirectory}`, и абсолютные пути — таблица certificates не создаётся). Ожидаем рабоче-способность в GUI; проверяется чек-листом (госуслуги без предупреждения + about:policies без ошибок). Если не взлетит и в GUI — эскалация: исследование import-механизма, вплоть до своих путей на дороге А.
- **Мигратор импорта из Chrome** при первом запуске.
- **Плитка новой вкладки**: у Zena собственная реализация, activity-stream top-sites не задействован. Решение исполнителя для v1: русские сайты — через политику `Bookmarks` (папка «Популярное» на панели закладок), родную плитку не трогаем.
- Первый запуск UX (оверлеи Zena, welcome-страницы).

## Форматы для генераторов (Task 6/7 плана)

- distribution на mac: `Contents/Resources/distribution/{policies.json, certs/*.crt}`; autoconfig: `Contents/Resources/molniya.cfg` + `Contents/Resources/defaults/pref/autoconfig.js` (каталог создаём с нуля — в комплекте Zena его нет).
- policies.json: тело зафиксировано спайком (Certificates.Install с `{InstallationDirectory}`, Disable* набор, Override*Page:"", SearchEngines.Add Яндекс+Default).
- molniya.cfg: defaultPref-набор из спайка (телеметрия off; safebrowsing on; extensions.update on; app.update off; intl.locale.requested ru; browser.search.region RU).
- application.ini патчи: Name/Vendor/Profile/RemotingName — точные значения выше.
- Замены бренда: таблица пар из п.2; генератор патчит ВСЕ локали (82 файла).

---

# РАУНДЫ 2–4: финальная рецептура (всё проверено партнёром в GUI)

## Полный рецепт перепаковки macOS (валидированный)

1. **omni.ja (browser)**: распаковка `7z x` (unzip НЕ работает — мусорные 4 байта перед PK).
   - Замены бренда: `chrome/*/locale/branding/brand.properties` (4 ключа) + `localization/*/branding/brand.ftl` (5 паттернов) + ШИРОКИЙ SWEEP `\bZen Browser\b`→«Молния», `\bZen\b`→«Молния» по ВСЕМ `.ftl/.dtd/.properties` в `localization/` и `chrome/*/locale/` (82+209 строк; имена файлов zen-*.ftl НЕ трогать).
   - **Бренд-картинки**: `chrome/browser/content/branding/about-wordmark.svg` (это вектор-пути — заменить файлом), `firefox-wordmark.svg`, `about-logo.svg`, `about-logo*.png`, `icon16/32/48/64/128.png` — заменить на свои (qlmanage -t -s N для растеризации). «Zen Browser» в about-диалоге — это КАРТИНКА-wordmark, не строка!
   - Запаковка: `zip -qrX` из корня распакованного дерева.
2. **omni.ja (toolkit)**: `modules/AppConstants.sys.mjs` — вкомпиленные константы: MOZ_APP_NAME→molniya, MOZ_APP_BASENAME→Molniya, MOZ_APP_DISPLAYNAME_DO_NOT_USE→Molniya, MOZ_MACBUNDLE_ID→ru.molniya.browser, MOZ_MACBUNDLE_NAME→«Молния.app».
3. **application.ini**: Name=Molniya, Vendor=Molniya Project, RemotingName=molniya, Profile=molniya (информативно), **BuildID = своя метка времени на каждый репак** (иначе стартовый кэш профилей переживает смену omni и пользователи видят старые строки!).
4. **Info.plist**: CFBundleName=«Молния», CFBundleIdentifier=ru.molniya.browser, CFBundleExecutable=molniya (+ переименовать бинарник).
5. **en.lproj/InfoPlist.strings**: CFBundleName «Zen» → «Молния» — ЭТО источник имени у яблока (локализованное перекрытие сильнее Info.plist!). plutil -convert xml1 перед правкой.
6. **Иконки приложения**: заменить `Resources/firefox.icns` + `document.icns` (iconutil из iconset; CFBundleIconFile=firefox.icns) и **УДАЛИТЬ `Resources/Assets.car`** — там зеновский AppIcon, который AppKit предпочитает. После замены: `xattr -cr` → codesign → `lsregister -f` → killall Dock.
7. **Подпись**: `xattr -cr` ПЕРЕД каждым codesign (иначе «detritus not allowed»), затем `codesign -f -s - --deep` + verify.
8. **DMG**: `hdiutil create -volname Молния -format UDZO` + verify.

## Сертификаты (финальный механизм)

`distribution/Certificates/<имя>.crt` (С ЗАГЛАВНОЙ C) + `policies.json` → `Certificates.Install: ["<голое имя файла>"]`. Поиск из Policies.sys.mjs: `dirs.unshift(XREAppDist)` — первым смотрит `<app>/Contents/Resources/distribution/Certificates/`. Токен `{InstallationDirectory}` на macOS НЕ резолвится, абсолютные пути тоже падают, autoconfig-песочница без Components/ChromeUtils — всё это тупики.

## Профили

US-root `~/Library/Application Support/zen` зашит в XUL (ini игнорируется, бинпоиск TESTNAME/TESTPROF это доказал). V1: общий корень (последовательная работа безопасна, движок один), формальное разделение = дорога А. Кэши профилей чистятся: `find ~/Library/Caches/<root> ~/Library/Application Support/<root> -maxdepth 4 -name startupCache`.

## Dev-инструменты, заработавшие в этом спайке

- **Marionette**: ASCII-фрейминг `<len>:<json>`, обязательно `-no-remote`, сначала `WebDriver:NewSession`; `about:` навигация запрещена в WebDriver-контексте.
- **OCR-скриншотов**: osascript -l JavaScript + Vision (VNRecognizeTextRequest, initWithURLOptions, topCandidates(1)) — работает с ru-RU.
- **Пиксельный тест**: screencapture + sips→bmp + подсчёт цветов (молния = жёлтый #ffd447 на тёмно-синем).
- geckodriver: режет about:-страницы и требует свой профиль — хуже Marionette для наших задач.

## Иконка дока (финал раунда 4)

Док-тайл упорно рисовал Zen при: заменённых icns (все размеры пиксельно молния ✓), удалённом Assets.car, сбросах Dock/IconServices/LS. Причина: **историческая регистрация пути** — бандл по work/spike впервые зарегистрировался в LS в раунде 1 с зеновской иконкой, и кэш не отпускал её для этого пути. Доказательство: копия по свежему пути («Свежая Молния.app») даёт молнию в доке сразу. Для продакшена проблемы нет: пользователь ставит из DMG в /Applications — путь всегда новый. Dev-машина лечится копированием бандла в новый путь.
