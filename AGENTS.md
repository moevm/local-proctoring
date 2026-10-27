# AGENTS — local-proctoring

## Область

- Рабочий код — только client/, распакованное MV3-расширение Google Chrome.
  Старый server/ удалён. Не изменяйте playground/ в рамках обычной поддержки.
  Рабочий API: [proctoring](https://github.com/OSLL/proctoring). Для тестов используйте tests/mocks.
- Читайте README.md, CHANGELOG.md, client/API-COMPATIBILITY.md и
  docs/versioning.md. Иллюстрации client/README.md частично исторические.
- [proctoring-ml](https://github.com/OSLL/proctoring-ml) получает задания от backend, не напрямую от расширения.

## Безопасность и сохранность

- Сохраняйте текущую архитектуру MV3 / служебная вкладка / OPFS. Исправляйте точечно.
- Не сбрасывайте worktree, storage.local, OPFS или пользовательские записи.
  Не трогайте незакоммиченные изменения соседних проектов.
- Не коммитьте, не пушьте и не публикуйте tags / releases / архивы без прямого запроса.
- manifest key и ID nlhjjbgkbfkopkigkbkojpkbffbkeohg должны сохраняться.
  При смене ID данные не мигрируют автоматически; сначала нужна выгрузка старых записей.
- Не удаляйте расширение / профиль с непереданными данными ради теста.
  Используйте отдельный Chrome-профиль и тестовые камеру / микрофон.
- Не помещайте пользовательские JWT, пароли или ML_SERVICE_KEY в настройки / исходники.

## Контракты

- server_url ведёт в /api/remoteSessions основного прокторинга; локально 127.0.0.1.
  host_permissions должен соответствовать origin, FRONTEND_ORIGINS backend — точному extension origin.
  Не обходите checkOrigin wildcard или отключением проверки.
- Вход — cookie того же профиля Chrome с credentials: include.
  Закрытие popup не должно прерывать отправку из служебной вкладки.
- Остановка ожидает stop / последний dataavailable / все OPFS write и close.
  Ошибка квоты, диска или download interrupted не считается сохранением.
- После потери ответа сначала GET status/:id. Уже сохранённые файлы нельзя перезаписывать.
  При videosSaved=true и ошибке очереди требуется повтор ML на backend, не новый upload.
- Удалять локальные оригиналы можно только после проверенного подтверждения API /
  предусмотренного подтверждённого локального сохранения. HTTP 200 сам по себе недостаточен.
- pagehide не гарантирует сохранение последнего чанка при уничтожении вкладки.
  Не обещайте подлинность видео или непрерывность контроля от локального клиента.

## Проверки и версии

- Используйте Google Chrome; другие Chromium требуют отдельной проверки.
- Из корня: docker compose run --build --rm tests (полный набор).
  Реальный E2E должен включать OPFS, скачивание, upload, ML и /teach/:id.
- Номер меняется в собственном VERSION; локальный скрипт синхронизирует только manifest,
  version_name не нужен. Соседние проекты не являются источником номера.
  Не меняйте key при повышении версии. Обновление выполняйте вне активной записи / отправки.
- Записывайте фактические проверки / ограничения в docs/validation.md; повышайте свою версию
  независимо от соседних проектов, без автоматических действий на GitHub.

## Ветки и единый номер

- Схема основных веток: main / dev / pre-release / release. Подготовка комплекта идёт в pre-release;
  имя ветки не является номером версии и не разрешает commit / push / публикацию.
- Единственный редактируемый номер — VERSION в этом проекте. Из его корня запускайте
  node scripts/sync-release-version.js, затем node scripts/check-release-version.js.
  Скрипты работают только внутри этого репозитория; соседние версии не читаются и не меняются.
- Не дублируйте текущий номер в README / инструкциях: используйте ссылки на VERSION.
  Номера исторических разделов CHANGELOG при следующем повышении не заменяются.

## Карта client и полная проверка

- manifest.json подключает background, content и popup. pages/media.html —
  долгоживущая служебная вкладка; scripts/media.js управляет записью.
- recorder-writer.js сериализует OPFS-запись; upload.js проверяет ACK и очистку;
  download.js ждёт завершения скачивания; recordings.js открывает «Мои записи».
- plugin-policy.js проверяет версию; common.js и logger.js используются несколькими
  контекстами Chrome. Проверяйте также ссылки из HTML и runtime messages.
- Встроенная справка: client/assets/help/readme.html; пользовательская инструкция:
  client/README.md. При изменении поведения обновляйте обе.
- Сборки / npm install у client нет: Chrome загружает каталог напрямую.
  Проверка версии: node scripts/check-release-version.js;
  регрессии синхронизации: docker compose run --build --rm tests node --test unit/release-version.test.js.
- Тестовая среда — tests/Dockerfile и compose.yaml: Node / Chrome / Xvfb / ffprobe
  устанавливаются в образ. Не требуйте их установки на хост; CI использует тот же образ.
- Набор выбирается заменой CMD: docker compose run --build --rm tests npm run test:unit;
  UI-фильтр: docker compose run --build --rm tests npm run test:ui -- --grep '403'.
- tests/reports монтируется на хост; исходники и npm-зависимости входят в образ.
  После изменений запускайте с --build. Для другого Linux UID / GID задавайте TEST_UID / TEST_GID.
- В tests используется только ESM .js, package.json содержит type: module.
  unit/*.test.js — node:test; contract/*.test.js — HTTP-контракт mock;
  ui/*.spec.js — Playwright Test. Не возвращайте cjs / mjs / require.
- fixtures/browser.js владеет ресурсами и teardown. app — page objects / storage,
  recording — пользовательские flow, api — HTTP mock, session — Chrome/CDP.
  pages знает DOM, flows — порядок действий, support — окружение и fault injection.
- Chrome-зависимые unit используют support/unit: нативный ESM-граф в отдельном VM
  без переписывания исходников и изменения процессного globalThis. VM-флаг входит в npm-команду.
- Mock HTTP-отказы задаются через api.faults. Устройства — через createScenario({ faults }).
  API-контракт проверяется tests/contract/proctoring-api.test.js; это не реальная ML-интеграция.
- Перед сдачей: docker compose run --build --rm tests.
  После изменения fixtures / изоляции заменяйте команду на npm run test:ui:repeat.
  Один worker обязателен для общего Xvfb; retries=0, CI запрещает .only.
- Результаты: tests/reports/{results.json,junit.xml,html/}; сырые профили / медиа
  находятся в /tmp контейнера и не публикуются. Инструкция, трассировка существующего сценария и примеры — tests/README.md.
- Полный цикл расширения / backend / ML — [инструкция интеграционных тестов](https://github.com/OSLL/proctoring/blob/pre-release/tests/extension/README.md);
  он проверяет интеграцию с настоящими backend и ML, которую mock не воспроизводит.
- Локальные env, профили Chrome, видео и raw-артефакты не коммитятся.
  Результаты / ограничения записывайте в docs/validation.md, историю — в CHANGELOG.
- Перед разрешённым commit: все клиентские тесты, проверка VERSION и неизменности
  key / ID, git diff --check и staged diff. Push без force в запрошенную ветку.
