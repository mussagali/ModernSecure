# Подготовка ModernSecure к App Store

Актуально на 2 ноября 2026 года. Текущий клиент: `apps/mobile_webview/ios`, Swift / WKWebView. `apps/client_mobile` — прежний Flutter-проект, его не отправляем. Версия первого релиза: `1.0.0`; Bundle ID: `kz.modernsecure.app`; сайт: `https://modernsecure.shpshka.work`.

Unsigned Release собран в Xcode 26.3; приложение запущено на симуляторах iPhone и iPad, экран входа проверен по реальным снимкам. [Результаты и CI](VALIDATION.md). Это **не готовый к отправке релиз**: подпись Apple, реальное устройство, удаление аккаунта и материалы владельца ещё требуют завершения. Успех source preflight или симулятора не означает успех TestFlight или App Review.

## Сборка с Windows без своего Mac

В репозитории подготовлены GitHub Actions, использующие macOS с полным Xcode. Для загрузок Apple с 28 апреля 2026 года требуется iOS 26 SDK или новее; workflow выбирает стабильный Xcode 26 на `macos-15`, а build-скрипт проверяет SDK. GitHub может учитывать macOS-минуты по тарифу приватного репозитория.

1. Разместить изменения в `shpshka/ModernSecure`, проверить вкладку **Actions → iOS build**. Этот процесс не требует Apple-ключей: собирает Release для симулятора, выдаёт `ModernSecure-ios-simulator`, запускает приложение на доступных iPhone/iPad и сохраняет реальные стартовые скриншоты. Это проверка старта, а не входа в дело или всех сценариев. Симуляторный `.app` нельзя установить на iPhone или отправить в магазин.
2. В Apple Developer проверить **Membership details**: Active membership, Team ID, Entity Type. Наличие Apple ID само по себе не подтверждает участие в платной программе. Apple ID, пароль и коды 2FA в проект не добавляются.
3. В **Certificates, Identifiers & Profiles** зарегистрировать явный App ID `kz.modernsecure.app` на нужной команде. Если ID уже занят другой командой, выбрать собственный ID и согласованно изменить `project.yml`, экспорт, проверку профиля и запись App Store Connect. В текущих entitlements включён Push Notifications; профиль должен поддерживать production APNs даже если доставка Firebase пока не включена.
4. Создать сертификат **Apple Distribution** с собственным CSR и соответствующим приватным ключом; получить `.p12` с этим ключом и паролем. Сертификата `.cer` без приватного ключа недостаточно. На Windows CSR и `.p12` можно подготовить OpenSSL; см. ниже.
5. Создать профиль **App Store Connect / App Store distribution** для этого App ID и сертификата; скачать `.mobileprovision`. Development, ad hoc и enterprise профили не подходят.
6. Создать приложение в **App Store Connect → My Apps → New App**: iOS, название «Современная защита», основной язык Russian, Bundle ID `kz.modernsecure.app`, собственный уникальный SKU (например `modernsecure-ios`). Зафиксировать числовой Apple ID приложения. Проверить, что аккаунт имеет право представлять юридическую компанию и использовать бренд; тип аккаунта пользователь ещё не подтвердил.
7. В **GitHub → Settings → Environments** создать окружение `app-store` для подписанного workflow. Добавить environment variable `APPLE_TEAM_ID`. Подписанный workflow предназначен для доверенной ветки; по возможности ограничить разрешённые ветки этого окружения основной/релизной веткой.
8. Добавить следующие **environment secrets**. Значения не коммитить, не вставлять в issues, логи или чат.

| Secret | Содержимое |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | Base64 полного `.p12` вместе с приватным ключом |
| `APPLE_CERTIFICATE_PASSWORD` | Пароль `.p12` |
| `APPLE_PROFILE_BASE64` | Base64 файла `.mobileprovision` |
| `ASC_KEY_ID` | Key ID командного App Store Connect API key, только для загрузки |
| `ASC_ISSUER_ID` | Issuer ID этого командного ключа, только для загрузки |
| `ASC_PRIVATE_KEY_P8_BASE64` | Base64 скачанного `.p8`, только для загрузки |

API-ключ App Store Connect создаёт уполномоченный владелец в **Users and Access → Integrations → App Store Connect API**. Нужен ключ с правом загрузки сборок (например App Manager), а не ключ APNs. Для сборки и скачивания IPA три `ASC_*` секрета не нужны. Сценарий использует командный ключ с Issuer ID; индивидуальные ключи без Issuer ID в него не подставляются.

Base64 в PowerShell (скопировать результат напрямую в поле GitHub Secret):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path '.\distribution.p12'))) | Set-Clipboard
# Аналогично для .mobileprovision и .p8, по одному файлу.
```

9. После появления workflow на основной ветке открыть **Actions → iOS signed archive → Run workflow**. Задать версию `1.0.0` и ещё не использованный возрастающий номер сборки. Оставить `upload_to_testflight=false`, если нужен только архив IPA. При `true` выполняются валидация Apple и загрузка в App Store Connect для последующей обработки. Workflow не отправляет приложение на App Review и не публикует его.
10. Установить обработанную сборку через TestFlight на физический iPhone, затем проверить iPad: проект поддерживает оба типа устройств. Для внешнего TestFlight может потребоваться отдельная Beta App Review. Дождаться успешного тестирования перед App Review.

Приватные материалы импортируются в временную связку ключей GitHub runner; cleanup удаляет связку, профиль и файлы. Скрипт отклоняет просроченный профиль, другую команду/Bundle ID, development/ad hoc/enterprise профиль и отсутствие production APNs. Подписанный IPA и dSYM хранятся как приватный Actions artifact 7 дней. Workflow ещё нужно запустить и проверить в реальном окружении — локальный Windows не доказывает успешную сборку iOS.

### CSR и сертификат без Mac

Использовать доверенную установленную версию OpenSSL (например поставляемую с Git for Windows), работать в отдельной приватной папке вне репозитория. Подставить фактическое название владельца; пароль ключа вводить интерактивно, не сохранять в команде.

```sh
openssl genpkey -algorithm RSA -aes-256-cbc -pkeyopt rsa_keygen_bits:2048 -out distribution.key
openssl req -new -key distribution.key -out distribution.csr
# Загрузить только distribution.csr при создании Apple Distribution certificate.
# Скачанный сертификат Apple distribution.cer:
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -inkey distribution.key -in distribution.pem -out distribution.p12
```

Приватные `.key`, `.p12`, `.p8`, пароль и резервные копии остаются у владельца. Отдельный сертификат для CI упрощает его отзыв без влияния на другие приложения. Никакие сертификаты автоматически не создаются и не отзываются этими скриптами.

## Что блокирует отправку сейчас

| Блокер | Что требуется |
|---|---|
| Учётная запись Apple ещё не проверена | Active membership, Team ID, тип юридического лица, доступ к нужному приложению и подписи |
| Нет подписанного IPA и проверки Apple | Unsigned Release и старт на симуляторах прошли; требуются подписанный archive, валидация Apple и TestFlight |
| Нет удаления аккаунта из приложения | Реализовать понятный запуск удаления для клиента, сотрудника, неактивированного и заблокированного аккаунта. Удалять аккаунт и связанные данные, кроме конкретных обязательных для хранения записей. Выход/блокировка аккаунта удалением не являются |
| Не согласована политика хранения | Владелец определяет сроки удаления, обязательные исключения хранения документов по делам и способ подтверждения завершения. При ручной обработке показывать срок до отправки и подтверждать результат; не заставлять писать email или звонить вместо запуска удаления |
| Privacy policy может показывать заглушку | Проверить публичный `/privacy` без входа. Администратор должен опубликовать утверждённый текст в `/staff/settings/legal`, включая компанию, обработчиков, данные, хранение и удаление |
| Публичная поддержка ещё не развёрнута и не заполнена | Подготовлена `/support`, вход не нужен. В окружении хостинга задать одобренные для публичного показа `PUBLIC_SUPPORT_EMAIL` и/или `PUBLIC_SUPPORT_PHONE`, при необходимости `PUBLIC_SUPPORT_HOURS`; развернуть сайт и проверить ссылку из metadata. Без этих значений страница честно сообщает об отсутствии контактов. Частные контакты сотрудников и email Apple ID автоматически не публикуются |
| Не заполнен доступ для App Review | Создать отдельные QA-аккаунты, подтвердить email и активировать их заранее; подключить только вымышленные дела, документы и переписку. Не давать Apple реальные клиентские данные или главный admin аккаунт |
| Нет настоящих iOS-скриншотов | Снять рабочие экраны из фактической сборки iPhone и iPad с вымышленными данными; не подменять Android/браузерные снимки скриншотами iOS |
| WKWebView и guideline 4.2 | Проверить полезность приложения: работа с делом, документами, Quick Look, передачей файлов, перепиской и разрешениями на реальном iPhone. Наличие оболочки и иконки не гарантирует прохождение Review; Apple может потребовать дополнительную нативную функциональность |

Не добавляйте выдуманные контакты, реквизиты, гарантии одобрения, готовые правовые формулировки или неработающие кнопки удаления. Подготовка сборки не изменяет production-базу и не публикует юридические документы.

## Privacy и разрешения

`Sources/PrivacyInfo.xcprivacy` включён в ресурсы приложения. `UserDefaults` используется для собственных push-настроек и installation ID; добавлена причина `CA92.1`. Tracking объявлен выключенным; рекламные SDK в проекте не подключены. Это не означает «данные не собираются»: приложение передаёт сведения аккаунта, дела, переписку и файлы серверу. Manifest включает основные известные категории, а окончательные ответы App Privacy нужно сверить со всеми данными и версиями SDK.

| Категория для проверки владельцем | Источник / назначение |
|---|---|
| Name, Email Address, Phone Number | Регистрация, профиль, связь по делу; связаны с аккаунтом |
| Other Financial Info | Сведения об обязательствах и платежах по делу |
| Emails or Text Messages, Photos or Videos, Other User Content | Переписка, фотографии документов, загруженные файлы |
| User ID | Авторизация и разграничение доступа |
| Device ID | Installation ID и push-токен при включённом Firebase |
| Physical Address / Other Contact Info | Проверить город, адреса в карточках и документах |
| Payment Info / Sensitive Info / Other Data | Проверить реквизиты в квитанциях, ИИН и фактические категории документов; внести применимые категории в manifest и App Privacy |
| Diagnostics / Product Interaction | Проверить audit/security logs, хостинг и Firebase privacy report; отсутствие Analytics не исключает служебные журналы |

Нельзя отвечать в App Store Connect «Data Not Collected». Перед отправкой сформировать Privacy Report подписанного archive в Xcode/доступной macOS-среде, сверить privacy manifests всех Firebase dependencies и ответы App Privacy. При включении нового сбора данных обновить декларации и политику. Камера и выбор фотографий запрашиваются только для вложений; описание разрешений уже задано по-русски.

`ITSAppUsesNonExemptEncryption=false` соответствует текущему предположению о стандартном транспортном шифровании без собственного нестандартного криптоалгоритма. Владелец должен подтвердить экспортную классификацию окончательного бинарника и библиотек; это техническая настройка, не юридическое заключение.

Firebase пока не настроен. Для первой версии можно не рекламировать push; его экран уже скрывает подключение без конфигурации. Для включения нужны `GoogleService-Info.plist`, APNs-ключ в Firebase, серверные переменные и тест доставки на физическом устройстве. После добавления plist генерировать проект через `xcodegen generate --spec project.push.yml`; `scripts/build.sh` выбирает этот spec автоматически при наличии plist. Обычный `project.yml` не ссылается на отсутствующий файл. Не отключайте проверки прав, email-активацию или MFA ради Review.

## Материалы App Store Connect

- `metadata.ru.json` — готовый черновик названия, подзаголовка, описания, keywords и promotional text. Подтвердить владельцем, заполнить copyright и публичный Support URL. Не указывать неподтверждённую функциональность.
- `review-notes.en.txt` — инструкция ревьюеру; заполнить недостающие фактические сведения перед вставкой. Логины/пароли вводить в закрытых полях **App Review Information**, не в Git.
- `release-evidence.example.json` — перечень подтверждений. Скопировать в игнорируемый `release-evidence.local.json`, отмечать `true` только после проверки. Не хранить здесь пароли.
- Ответить на текущую анкету возраста, encryption/export compliance, content rights, accessibility и региональной доступности. Не выставлять возраст или поддержку accessibility без проверки.
- Указать условия оказания юридических услуг отдельно от условий приложения. Проверить фактическую модель оплаты: сейчас интерфейс показывает сведения и подтверждения по договорам; если появятся платные цифровые функции/подписки, повторно оценить требования Apple к оплате.
- Для первой публикации выбрать ручной выпуск после одобрения. Не включать автоматическую публикацию до проверки владельцем.

Скриншоты: 3–5 рабочих экранов (дело, документы, переписка, задачи, профиль). Использовать синтетические имена и файлы. Для проекта с поддержкой iPad требуется и соответствующий набор iPad. Точные размеры сверять по актуальной таблице Apple, а не растягивать произвольный снимок. На Mac можно сохранить текущий экран симулятора командой `xcrun simctl io booted screenshot screenshot.png`; это снимок, а не проверка сценария.

## Проверки и локальная сборка на будущем Mac

```powershell
python apps/mobile_webview/ios/scripts/preflight.py
python -m unittest discover -s apps/mobile_webview/ios/scripts -p 'test_*.py'
# Этот шаг ожидаемо завершится ошибкой до закрытия всех блокеров:
python apps/mobile_webview/ios/scripts/preflight.py --submission
```

```sh
cd apps/mobile_webview/ios
brew install xcodegen
cp Local.xcconfig.example Local.xcconfig
# Вписать Team ID в Local.xcconfig.
bash scripts/build.sh simulator
# Для ручного archive установить Apple Distribution identity и профиль,
# затем экспортировать APPLE_TEAM_ID, IOS_PROFILE_UUID, IOS_VERSION,
# IOS_BUILD_NUMBER и выполнить:
bash scripts/build.sh archive
```

Проверить на TestFlight: регистрация → email confirmation → ожидание → активация; вход/выход, восстановление пароля и сохранение сессии; все роли/MFA; чтение дела; загрузка PDF/фото и файла >4,5 МБ, просмотр/шаринг/ошибки доступа; переписка; отсутствие сети и повтор; отказ в разрешениях; VoiceOver/крупный шрифт/клавиатура/поворот; privacy/deletion; переходы из писем и, если настроен, push. Проверить, что содержимое скачанных документов не сохраняется дольше нужного и не доступно следующему пользователю устройства.

## Первичные источники

- [Минимум iOS 26 SDK с 28 апреля 2026](https://developer.apple.com/news/?id=ueeok6yw).
- [App Review Guidelines: 4.2, 5.1 и остальные требования](https://developer.apple.com/app-store/review/guidelines/).
- [Удаление аккаунта, включая ручную обработку](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).
- [Privacy manifest](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files), [App Privacy](https://developer.apple.com/app-store/app-privacy-details/).
- [Загрузка сборок](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [размеры скриншотов](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
- [Подпись Xcode на GitHub runner](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications).
