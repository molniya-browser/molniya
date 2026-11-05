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
