# Обновление ModernSecure в App Store

Текущий статус: [RELEASE-STATUS.ru.md](RELEASE-STATUS.ru.md). Используется Swift/WKWebView из `apps/mobile_webview/ios`; старый Flutter-проект не отправляется.

- App Store: https://apps.apple.com/kz/app/id6824547106
- App Store Connect: https://appstoreconnect.apple.com/apps/6824547106/distribution
- Bundle ID: `kz.modernsecure.modernSecure`; Team: `HRXCR95QG3`.
- Сайт: https://modern-secure.vercel.app
- Privacy: https://modern-secure.vercel.app/privacy
- Support: https://modern-secure.vercel.app/support
- Удаление: https://modern-secure.vercel.app/delete-account
- Подготовленная версия: `1.0.1`, build `4`. Сверьте с Apple перед следующим запуском; каждый загруженный build должен быть уникальным.

## Сборка

GitHub Actions → **iOS signed archive** → Run workflow с разрешённой ветки **main**. `source_ref=main`, `version=1.0.1`, `build_number=4`. По умолчанию `upload_to_testflight=false`: IPA только сохраняется в закрытых артефактах GitHub, App Review не запускается. Перед подписью read-only запрос к Apple сверяет идентификатор и занятость номера сборки.

Сертификат, provisioning profile и ASC API key уже находятся в GitHub environment `app-store`. Пароль Apple ID не нужен для сборки. Не копируйте ключи в репозиторий и не отключайте правила environment. Если сертификат/профиль истекли, workflow остановится с ошибкой.

Для локальной сборки нужен полный Xcode 26+ с iOS 26 SDK и XcodeGen:

```sh
cd apps/mobile_webview/ios
python3 scripts/preflight.py
python3 -m unittest discover -s scripts -p 'test_*.py'
bash scripts/build.sh simulator
```

`build.sh archive` дополнительно требует установленную подпись, `APPLE_TEAM_ID`, `IOS_PROFILE_UUID`. Сборка Release не использует localhost. `Signing.xcconfig` подключает необязательный `Local.xcconfig`, исключённый из Git.

## Готовый проверенный IPA

`artifacts/app-store-1.0.1-4/export/ModernSecure.ipa` — подписанный пакет. Его SHA-256 и ссылки на успешные сборку/проверку Apple находятся в `RELEASE-STATUS.ru.md`. Workflow **iOS validate existing IPA** проверяет выбранный артефакт по SHA-256 и отправляет его только на техническую валидацию Apple, без создания релиза.

## Проверка и материалы

`metadata.ru.json` содержит готовые название, описание, ключевые слова и «Что нового». `review-notes.en.txt` — текст для закрытых заметок после проверки указанных условий; пароль в нём не хранится.

Для новых настоящих скриншотов запустите **iOS build** с `capture_store_screenshots=true`, `screenshot_engine=xctest`, обеими группами устройств. Нужен работающий выделенный демо-аккаунт и принятое им действующее соглашение. Тест останавливается, если не находит синтетическое дело. Скриншоты не загружаются в App Store автоматически; диагностические кадры нельзя использовать в карточке.

`release-evidence.example.json` — пустая форма фактических проверок. Заполненная локальная копия игнорируется Git. `preflight.py --submission` проверяет полноту записанных подтверждений, но не заменяет испытания и не отправляет приложение.

После ручного разрешения загрузки `upload_to_testflight=true` валидирует и загружает IPA в Apple. Это ещё не отправка на App Review. В App Store Connect создайте обновление существующей карточки, прикрепите сборку, обновите материалы, проверьте демо-доступ, затем отправьте на проверку. Новую карточку приложения не создавайте.

## Что сохраняет оператор при удалении

Запрос поступает в `/staff/settings/deletion-requests`. Оператор выполняет удаление учётной записи через `/staff/accounts`, отдельно обрабатывает персональные материалы без законного основания хранения, описывает конкретные исключения и отправляет подтверждение на email заявителя. Только после этого отмечает завершение. Первичный администратор защищён от удаления: перед собственным запросом требуется передача полномочий через владельца инфраструктуры.

## Источники требований

- https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version
- https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon
- https://developer.apple.com/news/upcoming-requirements/
- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- https://developer.apple.com/app-store/app-privacy-details/
