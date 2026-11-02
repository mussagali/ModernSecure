# Статус загрузки — 2 ноября 2026

Пакет материалов подготовлен, но подписанного IPA и готовности к App Review пока нет.

## Подтверждено

- Текущий клиент: Swift/WKWebView, `apps/mobile_webview/ios`; версия `1.0.0`, Bundle ID `kz.modernsecure.app`.
- Apple Developer: Team ID `HRXCR95QG3`, Individual, имя Mussagali Mussakhan, следующее продление 17 октября 2027 года. Проверено через Membership details. Регистрация Bundle ID и запись App Store Connect ещё не проверены.
- На аккаунте Apple есть уведомление об обновлённом лицензионном соглашении: принять до 14 ноября 2026 года. От имени владельца оно не принималось.
- Privacy: https://modernsecure.shpshka.work/privacy ; Terms: https://modernsecure.shpshka.work/terms . Тексты опубликованы для ТОО «Современная Защита», БИН 220140025162.
- Отдельный клиент Apple активирован; email подтверждён. Реальный вход и доступ только к одному вымышленному делу проверены через обычную пользовательскую сессию и RLS. Добавлена вымышленная задача. Пароль — только в игнорируемом `reviewer-access.local.json` рядом с этим файлом.
- Аккаунт не является администратором и не связан с реальными клиентскими делами. Права сотрудников/MFA не ослаблялись. В App Store Connect доступ пока не внесён.
- Подготовлены GitHub Actions для сборки на macOS, подписи и опциональной загрузки TestFlight. Успешная неподписанная iOS-сборка и запуск iPhone/iPad описаны в VALIDATION.md.

## Обязательные оставшиеся шаги

1. Владелец проверяет и принимает обновлённое соглашение Apple; подтверждает право публикации бренда компании через индивидуальный аккаунт.
2. Зарегистрировать или проверить `kz.modernsecure.app` в команде, создать запись приложения App Store Connect; сохранить numeric app ID в приватное evidence.
3. Получить Distribution certificate с приватным ключом и App Store provisioning profile. Администратор GitHub настраивает environment `app-store`, `APPLE_TEAM_ID=HRXCR95QG3` и секреты из README. Для загрузки через API нужен App Store Connect API key. Секреты не отправлять в чат или Git.
4. Дать доступ к production Supabase `bdkrihsiprkmukyjyspv` и к развёртыванию сайта. Открытый аккаунт Supabase содержит `dukqvwqxgwyadffmdeee` (Modernsecure, Singapore) и другой проект; переход в production возвращает список организаций. Не применять миграцию в другую базу.
5. В production применить только новую миграцию `20261102009700_account_deletion_requests.sql` после сверки истории; затем развернуть release-ветку. `/support`, `/delete-account`, `/deletion-policy` пока возвращают 404. Fresh-install SQL не предназначен для существующей базы.
6. Проверить рабочие контакты поддержки, фактическое размещение персональных данных и выполнение удаления/законного хранения. Почта `mail@sovz.kz` из публичного справочника не проверена; MX не обнаружены. Политика не заменяет проверку инфраструктуры.
7. Получить подписанный IPA через `iOS signed archive`, пройти Apple validation и TestFlight. Проверить на iPhone/iPad вход, согласия, сессию, файлы, переписку и запрос удаления; ручное исполнение удаления проверить на отдельном одноразовом QA-аккаунте, сохранив рабочий доступ для Apple.
8. Снять реальные рабочие экраны iOS с вымышленными данными. Текущие снимки показывают только вход и не составляют полный комплект магазина.
9. В App Store Connect внести metadata.ru.json, проверенные App Privacy, возрастной рейтинг, export compliance, рабочий контакт App Review, заметки и приватный логин/пароль. Владелец проверяет заявления перед отправкой.

## Приватный тестовый доступ

`reviewer-access.local.json` нельзя публиковать на сайте, включать в архив материалов или коммитить. Логин/пароль вводятся только в App Store Connect → App Review Information. При первом входе ревьюер читает текущие юридические тексты и проходит обычный экран согласий. На iOS этот сценарий пока не проверен.

Сценарий подготовки аккаунта: `node scripts/prepare-apple-review.mjs --env=handoff/app.env --accounts=handoff/accounts.json --expect-project=bdkrihsiprkmukyjyspv`. По умолчанию только план; `--apply` создаёт/проверяет собственные демо-объекты, не сбрасывает существующие пароли и не удаляет данные.

## Источники требований

- https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-workflow/
