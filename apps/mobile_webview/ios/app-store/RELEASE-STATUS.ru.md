# Статус загрузки — 4 ноября 2026

Карточка приложения и предыдущая сборка в TestFlight существуют. Текущая Swift/WKWebView-версия успешно собрана без подписи в GitHub Actions и запущена на iPhone/iPad Simulator; подписанный IPA и готовность к App Review ещё не подтверждены. Отправки на проверку и публикации в этом сеансе не было.

## Подтверждено через computer use

- Apple Developer: Team ID `HRXCR95QG3`, Individual, Mussagali Mussakhan; продление 17 октября 2027 года.
- Владелец явно подтвердил в переписке право публикации бренда ТОО «Современная Защита» через свой Individual аккаунт и предоставил контакт для закрытых полей App Review. Имя, фамилия, телефон в международном формате и email сохранены в App Store Connect; личные контакты не добавлены в публичный Support URL или отслеживаемые файлы.
- Apple требует принять обновлённое соглашение до 14 ноября 2026. Оно не принималось от имени владельца.
- [ModernSecure — Защита, Apple ID 6824547106](https://appstoreconnect.apple.com/apps/6824547106/distribution): SKU `modernsecure-ios-001`, основной язык Russian, Bundle ID `kz.modernsecure.modernSecure`.
- В карточке сохранены описание, promotional text, keywords, copyright и версия `1.0.0`; в App Information — подзаголовок и категория Business (подтверждено статусом Saved). В App Privacy сохранён URL `https://modernsecure.shpshka.work/privacy`. Support URL оставлен пустым до устранения 404.
- App Privacy, возрастной рейтинг и Content Rights ещё требуют заполнения; контакт App Review сохранён по явному разрешению владельца; демо-доступ ещё не внесён. Статус карточки: `Prepare for Submission`.
- В TestFlight есть **предыдущая** сборка `1.0.0 (1)`, загруженная 19 октября 2026 в 20:16 по отображению Apple. Binary State: `Validated`; размер 15,4 MB; минимум iOS 13.0; iPhone/iPad; executable `Runner.app/Runner`. В группе ModernSecure Internal показаны 1 установка и 4 сессии. Это не проверка текущего Swift-клиента с минимумом iOS 16.0.
- На портале существуют Distribution certificate и активный профиль `ModernSecure App Store` (`6P9986A6SD`), срок до 16 октября 2027. App ID профиля совпадает; в capabilities указан только In-App Purchase, APNs нет. Их наличие не подтверждает наличие P12 с приватным ключом на этом компьютере. Новые сертификаты/ключи не создавались, существующие не отзывались.

## Подготовлено в репозитории

- Текущий клиент: `apps/mobile_webview/ios`, Swift/WKWebView, версия `1.0.0`. Старый Flutter `apps/client_mobile` не является текущим клиентом.
- Bundle ID исправлен с `kz.modernsecure.app` на `kz.modernsecure.modernSecure` в XcodeGen, Xcode-проекте, проверке профиля, экспорте IPA и проверках бинарника/симулятора. Android ID не менялся.
- Source preflight и **8 тестов** пройдены, в том числе проверки рассогласования Bundle ID. Успех этих тестов не означает успешную Xcode-сборку или App Review.
- Готовы GitHub Actions для macOS, подписи и опциональной загрузки TestFlight. Исходники подготовлены в ветке `release/app-store-preparation`; облачная проверка выполняется workflow `iOS build`, подписанная сборка — отдельным `iOS signed archive`. После изменения Bundle ID сборка коммита `5f720788d270460d9b65c0ca8c8fee88be665b48` прошла: [push run](https://github.com/shpshka/ModernSecure/actions/runs/41824495515), [PR run](https://github.com/shpshka/ModernSecure/actions/runs/41824504706). Проверены Bundle ID итогового .app и старт на iPhone 17 Pro / iPad Pro 13-inch (M5), iOS 26.2. Реальные стартовые снимки просмотрены; это экран входа, не проверка сценариев после авторизации. Подробности см. в [VALIDATION.md](VALIDATION.md).
- Выделенный ревьюер повторно проверен 4 ноября через обычную пользовательскую сессию: вход успешен, доступ ровно к одному вымышленному делу. Доступ не административный; реальные клиентские данные не подключены; MFA не ослаблялась.
- Пароль хранится только в игнорируемом `reviewer-access.local.json`; его нельзя включать в архив материалов, Git, логи или этот документ.

## Проверка production 4 ноября

| Проверка | Результат |
|---|---|
| `/privacy`, `/terms` | HTTP 200; документы компании опубликованы ранее |
| `/support`, `/delete-account`, `/deletion-policy` | HTTP 404 |
| Вход выделенного ревьюера и изоляция вымышленного дела | Пройдены через обычную сессию/RLS |
| `own_account_deletion_request` | `PGRST202`: RPC отсутствует в production |
| Прямое подключение к production PostgreSQL | `ECONNRESET`; миграции не применялись |

Production Supabase: `bdkrihsiprkmukyjyspv`. Приватный отчёт без паролей: `artifacts/ios-app-store/reviewer-check-2026-11-04.json`. Не применять миграции в другой проект с похожим названием.

## Облачная подпись и доступ GitHub

- Репозиторий доступен для чтения и push; текущий GitHub credential имеет `push=true`, `admin=false`, `maintain=false`.
- В GitHub отсутствует environment `app-store`; repository Actions secrets пусты. Создание environment через API вернуло 404; подтверждённые права не позволяют завершить настройку администратором. Ничего не создано, права доступа не изменялись.
- Для владельца репозитория: создать `app-store`, задать `APPLE_TEAM_ID=HRXCR95QG3`, добавить секреты из README. Ограничить environment ветками `main` и `release/app-store-preparation`.
- На default branch зарегистрирован только `iOS build`. `iOS signed archive` пока находится в draft PR #1; перед ручным запуском workflow должен появиться на default branch. Полную release-ветку нельзя разворачивать до согласования миграций production.
- В App Store Connect существует командный API key с ролью App Manager и последним использованием 19 октября. Название не подтверждает конкретный сервис сборки. Приватный `.p8` не получен; существующий ключ не отзывался и не изменялся.
- Собственный Mac не требуется: проверенная сборка выполнена на macOS GitHub Actions. Для подписанного релиза нужны права администратора GitHub и приватные материалы подписи, а не другой ноутбук.

## Оставшийся список в порядке выполнения

1. Владелец проверяет и принимает обновлённое соглашение Apple. Право публикации бренда через индивидуальный аккаунт уже подтверждено; контакт App Review предоставлен отдельно и не публикуется в материалах магазина.
2. Восстановить доступ к production-базе и развёртыванию сайта. Сверить историю миграций; применить только недостающие миграции, включая `20261102009700_account_deletion_requests.sql`, затем развернуть release-ветку. Fresh-install SQL для существующей базы не использовать.
3. Проверить поддержку и реальные бизнес-контакты, хранение персональных данных, срок и исполнителя удаления. Ручное удаление допустимо по правилам Apple при понятном сроке и подтверждении завершения; одна запись запроса не доказывает фактического удаления. Проверить полный цикл на одноразовом QA-аккаунте, сохранив рабочий аккаунт Apple.
4. Для новой сборки использовать существующую карточку `6824547106` и точный Bundle ID `kz.modernsecure.modernSecure`. Нужны P12 с приватным ключом/паролем и App Store provisioning profile. Текущий проект использует production APNs entitlement: профиль прежнего Runner без APNs не подходит. Если подпись хранится в прежнем облачном сервисе сборки, можно использовать его после проверки проекта.
5. Настроить environment GitHub `app-store`, `APPLE_TEAM_ID=HRXCR95QG3` и секреты из [README](README.md). Для API-загрузки нужен командный App Store Connect API key. Секреты не отправлять в чат/Git. Выполнить `iOS signed archive` с новым номером сборки **выше 1**; пройти Apple validation и TestFlight.
6. Проверить итоговую сборку на iPhone/iPad: регистрация, подтверждение email, согласия, активация, восстановление пароля, сохранение сессии, права ролей/MFA, документы, Quick Look/шаринг, переписка, отсутствие сети, удаление аккаунта. Push не рекламировать до настройки и физического теста Firebase/APNs.
7. Снять рабочие экраны итогового приложения с вымышленными данными. По [актуальной спецификации Apple](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) обязательны iPhone с Dynamic Island (medium display) и iPad 13-inch для универсального приложения. Например: iPhone 17 Pro — 1206 × 2622; iPad Pro 13-inch — 2064 × 2752; без прозрачности. Прежние снимки показывают только вход. Не подменять их Android/браузерными изображениями.
8. Заполнить App Privacy по фактическим данным/SDK и Privacy Report нового archive; не выбирать «Data Not Collected». Завершить возрастную анкету с учётом переписки, файлов и вопросов social media, Content Rights и export compliance. Категория Business уже сохранена. Подтвердить бизнес-модель услуг, цену и территории; для ЕС нужен trader status по DSA. Подготовить подтверждение полномочий компании, если Apple запросит его.
9. После развёртывания сохранить рабочий Support URL, добавить приватный демо-доступ, заметки ревьюеру, протестированные модели/ОС, внешние сервисы. Контакт App Review уже сохранён. Выбрать проверенную новую сборку. Режим выпуска согласовать с владельцем; metadata предлагает ручной выпуск.
10. Отправить на App Review после закрытия блокеров. После одобрения выполнить выпуск. Соответствие guideline 4.2 оценивает Apple; наличие WKWebView и иконки не гарантирует одобрения.

## Источники требований

Проверены 4 ноября 2026. С 28 апреля 2026 минимальны Xcode 26 / iOS 26 SDK; текущий workflow проверяет SDK.

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Минимальные SDK](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)
- [Информация для полного ревью](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review)
- [Удаление аккаунта](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
- [App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
- [Скриншоты](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
