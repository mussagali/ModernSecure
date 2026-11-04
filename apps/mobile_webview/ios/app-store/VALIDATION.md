# Проверка подготовки iOS — 4 ноября 2026

## Текущая облачная сборка

- Коммит `5f720788d270460d9b65c0ca8c8fee88be665b48`, ветка `release/app-store-preparation`.
- [GitHub Actions push run 41824495515](https://github.com/mussagali/ModernSecure/actions/runs/41824495515) и [PR run 41824504706](https://github.com/mussagali/ModernSecure/actions/runs/41824504706) завершились успешно.
- Release для iOS Simulator без подписи собран на macOS с Xcode 26.3 (17C529). Проверки итогового Bundle ID `kz.modernsecure.modernSecure`, production HTTPS origin, версии, privacy manifest и asset catalog пройдены.
- Приложение установлено и запущено на iPhone 17 Pro и iPad Pro 13-inch (M5), runtime iOS 26.2. Реальные PNG просмотрены: на обоих устройствах загрузился экран входа; ошибки конфигурации/сети не показаны.
- Артефакты: `ModernSecure-ios-simulator`, `ModernSecure-ios-startup-screenshots`. Приватные локальные снимки: `artifacts/ios-app-store/cloud-41824495515/`. Эти снимки показывают только старт приложения.
- Это не подписанный IPA, TestFlight или проверка физического устройства. Вход и полные сценарии в итоговой iOS-сборке ещё требуют теста; отсутствие production удаления и поддержки сохраняется.
- После переноса репозитория настроены environment и все шесть секретов; создан отдельный сертификат/профиль с production APNs. Первая проверка Apple отклонила подписанный IPA из-за ориентаций iPad, несмотря на код 0 от altool и зелёный CI. Коммит `d85fba8` исправляет iPad plist/spec, добавляет проверку собранного bundle и требует явного сообщения об успешной операции от Apple. 13 Python-тестов и Bash syntax check пройдены. Повторный run `41840680104` завершил сборку и загрузку `1.0.0 (2)`; подтверждения ниже.

---

# Историческая проверка — 2 ноября 2026

Это исторический отчёт о нативной сборке со старым Bundle ID `kz.modernsecure.app`. 4 ноября ID текущего клиента исправлен на `kz.modernsecure.modernSecure`; её успешная unsigned-сборка описана выше. Последующие изменения публикации, Apple membership и демо-доступа: [RELEASE-STATUS.ru.md](RELEASE-STATUS.ru.md).

Проверенный исходный коммит: `84b426ca1f00acc2c6b090d000466dff0e8ab4b8`, ветка `release/app-store-preparation` в `mussagali/ModernSecure`.

## Выполнено

- [GitHub Actions iOS build: success](https://github.com/mussagali/ModernSecure/actions/runs/41391223835).
- Xcode 26.3, iOS Simulator SDK 26.2, Release без подписи; сборка включает Firebase 13.1.1.
- Проверен собранный `.app`: Bundle ID, `https://modernsecure.shpshka.work`, версия `1.0.0`, номер сборки, privacy manifest и asset catalog.
- Приложение установлено и запущено на **iPhone 17 Pro** и **iPad Pro 13-inch (M5)**, runtime iOS 26.2. Реальные снимки просмотрены: виден загруженный экран входа, без ошибки конфигурации/загрузки.
- Артефакты Actions: `ModernSecure-ios-simulator` и `ModernSecure-ios-startup-screenshots`, срок хранения 7 дней. Локальная копия стартовых снимков: игнорируемая папка `artifacts/ios-app-store/`.
- 6 тестов preflight/блокировок релиза, проверка plist/XML/PNG и YAML, синтаксис Bash — пройдены.
- `npm run lint`, `npm run build` — пройдены после добавления `/support`.
- Production-сборка локального сайта: `/support` возвращает HTTP 200 без входа, корректные mailto/tel, ссылки восстановления и правовой информации с синтетической конфигурацией. Эта новая страница ещё не опубликована на production.
- Проверены публичные production `/privacy` и `/terms`: страницы отвечают 200, но не содержат опубликованной версии правового документа. HTTP 200 сам по себе недостаточен для App Review.

## Границы проверки

Нет подписанного IPA, Apple validation, TestFlight или проверки на физических устройствах. Apple Developer membership, Team ID, сертификаты и запись App Store Connect не подтверждены: подключение к открытому браузеру недоступно; подходящая интеграция App Store Connect в поиске плагинов не найдена.

Стартовые снимки относятся к текущему production-сайту внутри настоящего iOS-приложения. На них ещё нет нового `/support` из этой ветки; они не подтверждают визуальную проверку этой страницы. Её проверка ограничена исходниками, HTTP, TypeScript и ESLint. Дизайн-ревью вернуло `recapture`: нужны desktop/mobile снимки с публичными контактами и пустым состоянием после восстановления браузерного доступа.

Сценарии после входа, MFA, загрузка/выгрузка документов, шаринг, сохранение сессии, push, восстановление пароля и удаление аккаунта на iOS не проверены. Удаление аккаунта ещё не реализовано. Владелец должен утвердить сроки удаления и обязательного хранения, опубликовать политику/условия, задать публичные business-контакты и создать безопасный доступ для ревьюера. Снимки реальных рабочих экранов для магазина ещё нужно снять с вымышленными данными.

`preflight.py --submission` ожидаемо останавливается до заполнения честных подтверждений релиза. Само выставление флагов не заменяет тесты или юридическое согласование. Автоматической отправки на App Review и публичной публикации не было.

## Подписанный archive и загрузка — 4 ноября 2026

- Исходный коммит `d85fba84f339a45bab5b284012f6588350607cfd`, версия `1.0.0 (2)`, Swift/WKWebView, минимум iOS 16.
- [Signed run 41840680104](https://github.com/mussagali/ModernSecure/actions/runs/41840680104): import, archive, export, проверка подписи и compiled bundle, validation и upload — success.
- Apple: `VERIFY SUCCEEDED with no errors` / `No errors validating archive` в 13:47:16 UTC; `UPLOAD SUCCEEDED with no errors` / `No errors uploading archive` в 13:47:57 UTC. Это подтверждает передачу IPA, но не завершение обработки TestFlight и не одобрение App Review.
- Xcode 26.3, iOS SDK 26.2. App Store профиль проверен: Team HRXCR95QG3, bundle kz.modernsecure.modernSecure, production APNs, новый сертификат до 4 ноября 2027.
- Временная связка ключей и материалы runner удалены. IPA/dSYM опубликованы в Actions artifact на 7 дней; приватные ключи в artifact не входят.
- Скачанный IPA дополнительно проверен локально: Bundle ID, версия/номер, минимум iOS 16.0, SDK iphoneos26.2, все четыре ориентации iPad; внутри 15 privacy manifests. Инвентаризация `artifacts/ios-app-store/signed-privacy-inventory.json` не заменяет проверку фактического сбора данных и заполнение App Privacy.
- Локальная копия: `artifacts/ios-app-store/ModernSecure-1.0.0-2.ipa`, SHA-256 `440634320468fd6ade2d64b24685b8d723e040357fd8be3d6409f0240b149625`.
- Физическая установка TestFlight, авторизованные сценарии, удаление аккаунта и полные рабочие скриншоты остаются непроверенными. Доступ к Vercel отсутствует; Supabase-проекты и версия схемы расходятся, см. RELEASE-STATUS.ru.md.
