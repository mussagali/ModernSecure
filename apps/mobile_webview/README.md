# Android и iOS: весь сайт в приложении

Две нативные оболочки используют существующие страницы и серверные права: Android WebView (Java), iOS WKWebView (Swift). Старый `apps/client_mobile` сохранён, но не используется для этой сборки.

## Согласованный объём

- Все роли и весь сайт, включая клиентский кабинет и рабочие пространства сотрудников.
- Регистрация открыта всем. После подтверждения email администратор активирует клиентов, юристов и менеджеров; администраторов назначает только главный администратор. До активации доступны ожидание, поддержка и выход. Старые привязанные аккаунты сохраняют доступ.
- Клиент и сотрудник — отдельные типы доступа; автоматического назначения роли по email или приглашению нет.
- Push добровольный. На экране блокировки только общий текст, без документов и содержания переписки. Переход по уведомлению повторно проверяет вход, MFA и текущий доступ.
- Файлы до 20 МиБ; существующие ограничения пакетной загрузки сохранены. На Vercel байты загружаются напрямую в закрытый временный Supabase Storage, сервер проверяет владельца билета, права, размер, тип и содержимое перед сохранением.

## Что готово и что ещё нужно

Редизайн от 28 октября 2026 года объединяет веб и оболочки: светлая палитра с зелёным акцентом, постоянная мобильная навигация, компактные формы, списки и чаты. Android получил новые иконку, системные панели, индикатор загрузки и экран повторной попытки; соответствующие исходники iOS обновлены. Android-экран кабинета и состояние без соединения проверены в эмуляторе. Снимки этой проверки находятся в `.impeccable/review/redesign/`; заполненные дела и переписка не создавались ради демонстрации.

Android debug APK собран и проверен на Pixel 7 / Android API 36. Проверены вход, ожидание активации, сохранение сессии при пересоздании Activity и закрытый доступ к кабинету. Пройдены Android unit tests и lint. Полный набор веб-проверок: 41 скрипт, ESLint и production build.

Реальная загрузка и скачивание 6 МиБ через подписанные Storage URL проверены с совпадением SHA-256. Тестовые объекты удалены. Это проверка транспорта, не полного сценария каждого вида документа.

iOS-проект сгенерирован XcodeGen, Swift-файлы прошли синтаксический разбор. Полного Xcode/iOS SDK на этом Mac нет: сборка IPA и работа на iPhone **не проверены**.

Рабочий HTTPS-домен: `https://modernsecure.shpshka.work`. Проверяемый debug APK собран с `-PsiteUrl=https://modernsecure.shpshka.work` и запущен в Android-эмуляторе. Без параметра `siteUrl` debug-сборка использует `http://localhost:3000`. Firebase пока не настроен, push отключён конфигурацией. Фактическая доставка push, фоновые переходы по уведомлениям, загрузка/скачивание файлов на физических телефонах и выпуск в магазины ещё не проверены. Заготовка не считается готовым релизом App Store / Google Play.

## Запуск готового APK на этом Mac

Готовый APK закоммичен в `public/downloads/modernsecure-debug.apk` и доступен по [прямой ссылке](https://modernsecure.shpshka.work/downloads/modernsecure-debug.apk). Он использует `https://modernsecure.shpshka.work`: локальный сервер, USB и `adb reverse` для работы сайта не нужны. Нужен интернет. Это debug-сборка для проверки, не подписанный релиз Google Play.

Запуск эмулятора и установка:

```sh
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
"$ANDROID_SDK_ROOT/emulator/emulator" -avd ModernSecure_API_36
```

В другом терминале из корня проекта:

```sh
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
"$ANDROID_SDK_ROOT/platform-tools/adb" -e install -r public/downloads/modernsecure-debug.apk
"$ANDROID_SDK_ROOT/platform-tools/adb" -e shell am start -n kz.modernsecure.app.debug/kz.modernsecure.app.MainActivity
```

На физическом Android установите этот APK. Для установки через ADB подключите USB, разрешите отладку и замените `-e` на `-d`; после установки USB не требуется.

Локальная сборка без `-PsiteUrl` использует `http://localhost:3000`. Только для неё нужны запущенный `npm run dev` и `adb reverse tcp:3000 tcp:3000`. Не распространяйте её как сборку с опубликованным сайтом.

## Сборка Android на другом компьютере

В репозитории есть весь Android-проект и Gradle Wrapper, включая `gradlew`, `gradlew.bat` и `gradle-wrapper.jar`. Для сборки этой WebView-оболочки не нужны Node.js, Flutter, локальный сайт, `.env`, пароли Supabase или доступ к Vercel. Приложение будет подключаться к опубликованному HTTPS-сайту. Первой сборке нужен интернет для загрузки Gradle и зависимостей.

1. Примите приглашение в приватный GitHub-репозиторий. Установите Git, Android Studio и JDK **21** — с ним эта версия проверена.
2. Скачайте исходники:

   ```sh
   git clone --branch main https://github.com/shpshka/ModernSecure.git
   cd ModernSecure
   ```

3. В Android Studio выберите **Open** и откройте папку `apps/mobile_webview/android`. Это текущая Android-оболочка; старый проект `apps/client_mobile` для этой сборки не используется.
4. В **SDK Manager** установите Android SDK Platform **36**, Android SDK Build-Tools **36.0.0** и Platform-Tools, примите лицензии. Android Studio создаст локальный `local.properties` с путём к SDK этого компьютера; этот файл в Git не добавляется.
5. В **Settings → Build, Execution, Deployment → Build Tools → Gradle** выберите установленный JDK 21. Для запуска команды из терминала также задайте `JAVA_HOME` на папку этого JDK и заново откройте терминал. Проверьте `gradlew --version`: JVM должна быть 21. Android Studio и терминал могут использовать разные настройки Java.
6. Откройте терминал в папке `apps/mobile_webview/android` и запустите команду для своей системы.

**Windows PowerShell:**

```powershell
.\gradlew.bat --version
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug "-PsiteUrl=https://modernsecure.shpshka.work"
```

**macOS / Linux:**

```sh
./gradlew --version
./gradlew assembleDebug testDebugUnitTest lintDebug -PsiteUrl=https://modernsecure.shpshka.work
```

Дождитесь `BUILD SUCCESSFUL`. Готовый файл от корня репозитория: `apps/mobile_webview/android/app/build/outputs/apk/debug/app-debug.apk`. Его можно скопировать на Android и установить. Ключ для debug-подписи создаётся автоматически. Наличие готового APK в `public/downloads` не требуется для пересборки из исходников.

Для следующих сборок выполните `git pull --ff-only origin main` из чистой рабочей копии и повторите команду. Если меняется только сайт, после его деплоя изменения доступны в приложении по тому же адресу. Изменения нативной оболочки или адреса сайта требуют нового APK.

APK: `app/build/outputs/apk/debug/app-debug.apk`. После успешной проверки скопируйте его в `../../../public/downloads/modernsecure-debug.apk`, обновите соседний файл `.sha256` и закоммитьте оба файла. После деплоя скачайте APK по публичной ссылке и сравните SHA-256 с проверенной сборкой. `artifacts/` остаётся локальной папкой и не попадает в Git. Для другого домена после развёртывания:

```sh
./gradlew assembleDebug -PsiteUrl=https://YOUR_DOMAIN
```

Укажите только origin, без пути. HTTP допускается только для локальной debug-сборки. Release требует HTTPS и отдельную конфигурацию подписи; release-keystore не создан. Для Google Play нужен подписанный AAB (`bundleRelease`), не текущий debug APK. Идентификатор release: `kz.modernsecure.app`, debug: `kz.modernsecure.app.debug`.

Основа команд: [сборка Android из командной строки](https://developer.android.com/build/building-cmdline), [выбор JDK для Android Studio и терминала](https://developer.android.com/build/jdks).

## Vercel и Supabase

На Vercel задайте переменные из `.env.local.example`; `APP_ORIGIN` — точный HTTPS-origin. В Supabase Auth настройте Site URL и разрешённые `<origin>/auth/callback`, `<origin>/auth/recovery`. Почтовая доставка должна быть настроена отдельно.

В текущей подключённой базе применены миграции `20261027008900` (активация всех ролей) и `20261027009000` (push). Четыре более ранние миграции 085–088 восстановлены из истории существующей базы в репозиторий. Другую базу обновляйте обычным проверяемым процессом миграций; установщик `supabase-upload` предназначен только для пустого проекта.

Временные загрузки нужно регулярно очищать: `npm run uploads:cleanup` сначала показывает план, `npm run uploads:cleanup -- --apply` удаляет просроченные объекты и билеты по правилам скрипта. Отдельный планировщик очистки пока не подключён.

## Push: подключение позже

Firebase не нужен для открытия сайта или сборки APK. Текущая реализация доставки использует FCM HTTP v1; на iOS FCM передаёт уведомления через APNs.

1. Создайте Firebase-проект. Добавьте Android-приложения с нужными package ID. Скачайте `google-services.json` в `android/app/`. Для debug нужен клиент с суффиксом `.debug`, для release — без него. Файл исключён из git.
2. Добавьте iOS-приложение `kz.modernsecure.app`, положите `GoogleService-Info.plist` в `ios/`, затем перегенерируйте проект. В Firebase настройте APNs-ключ из Apple Developer.
3. В окружение сервера добавьте `FIREBASE_SERVICE_ACCOUNT_JSON` с ключом сервисного аккаунта Firebase Messaging и случайный `CRON_SECRET`. Не помещайте сервисный ключ в мобильное приложение и не используйте префикс `NEXT_PUBLIC_`.
4. Подключите периодический HTTPS GET `/api/internal/push` с заголовком `Authorization: Bearer <CRON_SECRET>`. За один вызов обрабатывается до 20 доставок; частоту и лимиты выбирайте под хостинг. Готового расписания Vercel Cron в репозитории нет, пока не выбран тариф/планировщик.
5. Пересоберите приложения. Войдите активированным аккаунтом, включите уведомления и проверьте доставку на настоящем устройстве, выход из аккаунта, смену аккаунта и отзыв доступа.

Без конфигурации API отвечает 503, а оболочка не предлагает неработающее подключение. Отказ в системном разрешении показывает объяснение и кнопку настроек. Выход отключает доставку для сессии; перед отправкой проверяются актуальная сессия, роль, получатель и доступ к делу.

Источники: [Android FCM](https://firebase.google.com/docs/cloud-messaging/android/get-started), [iOS FCM/APNs](https://firebase.google.com/docs/cloud-messaging/ios/get-started), [HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

## iOS

Установите полный Xcode из App Store, выберите его как active developer directory, откройте проект:

```sh
cd apps/mobile_webview/ios
xcodegen generate
open ModernSecure.xcodeproj
```

В Xcode задайте Team и `SITE_HOST` / `SITE_SCHEME`. Debug использует `http://localhost:3000` для симулятора на этом Mac. Release-плейсхолдер `REPLACE_WITH_YOUR_DOMAIN` обязательно замените. Для физического iPhone нужен доступный HTTPS-домен. Push требует Apple Developer, capabilities и provisioning profile. Иконка добавлена; подпись, сведения для магазинов и проверка требований публикации — отдельный этап после проверки на устройствах.

## Проверки разработчика

```sh
npm test
npm run lint
npm run build
```

`android/app/src/androidTest/.../WebSessionTest.java` — инструментальный сценарий для отдельного подтверждённого, но ещё не активированного QA-аккаунта; логин/пароль передаются через instrumentation arguments `qaEmail` и `qaPassword`. Не используйте реальные пользовательские пароли в shell history. UI-скриншоты в `.impeccable/review/mobile` исключены из git. Две исправленные ошибки push-интерфейса проверены на моделируемых ответах нативного моста; это не подтверждение доставки через FCM/APNs.
