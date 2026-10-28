# Проверки клиента

## Согласование документации — 28.10.2026

- Инструкции сверены с текущими Docker/Compose, тестовыми entrypoints и CI.
  Добавлена [карта документов](README.md); исторические отчёты отделены от текущего запуска.
- Проверены локальные Markdown-ссылки и whitespace diff. Код приложения, env,
  рабочие сервисы и данные не менялись; тесты приложений повторно не запускались.

## Финализация перед коммитом — 28.10.2026

- Ссылки на основной прокторинг и ML заменены GitHub-ссылками. В рабочем коде,
  скриптах, тестах и Docker / CI нет путей к реальным соседним checkout.
  Unit-тест независимости версий создаёт только временные каталоги.
- README, CHANGELOG и AGENTS согласованы с текущими кодом и тестовой средой.
- Проверены полный diff, локальные Markdown-ссылки, Compose-конфигурация,
  отсутствие секретов и генерируемых файлов среди изменений, git diff --check.
- Полный `docker compose run --build --rm -e CI=true tests`: Prettier, ESLint,
  VERSION / key / ID, **65/65 unit**, **10/10 contract**, **64/64 UI**.
- Backend / ML, production HTTPS и удалённый GitHub Actions в этом прогоне
  не проверялись. Push и публикация релиза не выполнялись.

## Единая тестовая архитектура — 27.10.2026

- Весь тестовый код переведён на ESM .js. Unit, HTTP contract и UI имеют отдельные
  каталоги и команды; CommonJS / MJS файлов внутри исходников tests больше нет.
- Page objects, RecordingFlow, Chrome session и mock API разделены. Fixtures отвечают
  за ресурсы, диагностику и teardown. Recovery не хранит helper-функции / данные в window.
- Unit исполняет неизменённый ESM-граф в отдельном VM-контексте; процессные globals
  и import cache не подменяются. Нативный VM-флаг включён в npm-команду и Docker.
- Полный `docker compose run --rm -e CI=true tests` прошёл: Prettier, ESLint,
  VERSION / key / ID, **65/65 unit**, **10/10 contract**, **64/64 UI**, без skips.
- Два последовательных UI-прогона без retries: **128/128**, 4,3 минуты.
- Дополнительно проверены выбор unit/upload.test.js (25/25), UI-фильтр 403 и
  затронутые сохранность / crash / deadline-сценарии (5/5).
- Составная проверка viewer разделена на четыре; число UI-сценариев выросло 61 → 64.
  Assertions сохранности проверяют имена и непустые оригиналы. OPFS-listing учитывает
  только WebM-записи, не временные swap-файлы браузера.
- Проверены актуальные Markdown-ссылки, Compose-конфигурация и git diff --check.
  Удалённый GitHub Actions не запускался; коммит / push не выполнялись.

Среда: тот же Dockerfile, Node 24.22.1, Chrome for Testing 156.0.8078.47,
Playwright 1.64.1; ESLint 9.39.1 и Prettier 3.6.2 закреплены lock-файлом.
Отчёты — tests/reports/{results.json,junit.xml,html/}; stdout — architecture-full.log,
architecture-repeat.log и architecture-selected.log в том же игнорируемом каталоге.
Инструкция с разбором существующего сценария: [tests/README.md](../tests/README.md).

## Docker / Compose — 26.10.2026

- Docker 29.9.2, Compose 5.6.1: `docker compose build tests` и запуск
  `docker compose run --rm tests` прошли. В контейнере — форматирование, VERSION,
  **75/75 unit** и **61/61 UI**.
- Полный набор также прошёл с `CI=true`, UID / GID 1001 и без внешней сети.
  Для Chrome заданы записываемые XDG-каталоги в /tmp; HOME не переопределяется.
- Проверена замена CMD: отдельный unit-файл (2/2), UI по `--grep` (1/1).
  Команда `exit 23` возвращает на хост код 23.
- `docker compose config --quiet` и `git diff --check` проходят.
- Образ содержит Node 24.22.1, Chrome for Testing 156.0.8078.47, Xvfb, ffprobe
  и зависимости из npm lock-файла. Хосту нужны только Docker / Compose.
- CI собирает тот же Dockerfile и запускает Compose-сервис. Удалённый workflow
  пока не запускался; коммит / push не выполнялись.

Отчёты: tests/reports/{results.json,junit.xml,html/}; логи контейнерных прогонов:
`tests/reports/docker-run.log`, `tests/reports/docker-ci-run.log`.

## Реорганизация тестов и mock API — 26.10.2026

- Чистая установка `npm --prefix tests ci --ignore-scripts` и `format:check` проходят.
- `test:unit`: **75/75**, без skips, на Node 20.20.2 и Node 24.
  Состав: 60 клиентских, 5 VERSION / ID, 10 HTTP contract-тестов mock API.
- `test:ui:repeat`: **122/122**, два полных прогона 61 сценария без retries
  и фильтров, 3,7 минуты на Node 20.20.2.
- Дополнительный полный UI-прогон на Node 24: **61/61**, 1,8 минуты.
- Среда: Linux, Google Chrome 156.0.8078.47, Playwright Test 1.64.1, Xvfb, ffprobe.
- Проверен автономный mock CLI на случайном loopback-порту и cookie-доступ к policy.
- VERSION / manifest / ID, ссылки актуальной документации, YAML CI и
  `git diff --check` проходят. Release ZIP содержит runtime, без тестов и Markdown;
  `unzip -tq` проходит.

Итоговый Playwright-отчёт: `tests/reports/results.json`, `junit.xml`, `html/index.html`.
Логи двукратного и unit-прогона: `tests/reports/repeat-run.log`, `unit-run.log`.
Это локальные игнорируемые артефакты. CI публикует HTML / JSON / JUnit; удалённый
GitHub Actions в этой работе не запускался. Коммит / push не выполнялись.

Во время переноса выявилась нестабильная граница reload-теста: снимок мог совпасть
с незавершённым write. Теперь crash / reload явно приостанавливают MediaRecorder
и дожидаются OPFS close перед снимком. Проверяются зафиксированные байты, без
обещания восстановить последний незафиксированный чанк.

Стандартный runner заменил три самописных; все 61 действующий UI-сценарий сохранены.
Удалены старый Flask server / compose, Python-тесты, shell-runners и одна проверка
строк исходника, дублировавшая настоящие unit / UI-проверки поведения.
Рабочий веб-прокторинг и ML для текущего набора не нужны. Mock повторяет используемый
API-контракт; реальные ML / callbacks, production HTTPS, физические устройства,
Windows и многочасовая запись остаются отдельными интеграционными проверками.

Инструкция для новых участников: [tests/README.md](../tests/README.md).

## До реорганизации: unit, UI и CI — 26.10.2026

- `npm --prefix tests run test:unit`: 61/61 client и 5/5 version, без skips.
- `npm --prefix tests ci --ignore-scripts`: собственный lock-файл устанавливается;
  зависимости соседнего proctoring не используются.
- Полный `xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp' npm --prefix tests run test:ui`:
  11/11 popup, 8/8 recovery, 42/42 новых UI-сценария, без фильтров.
- Среда: Linux, Google Chrome 156.0.8078.47, Node 24.22.1, Playwright 1.64.1,
  Xvfb и ffprobe. Камера / микрофон синтетические, захват экрана выделенный.
- Проверены настоящие WebM / OPFS / downloads, ffprobe дорожек; двойные действия,
  ошибки устройств / API / download, offline, reload / close media tab,
  stop / wake MV3 worker, Browser.crash с новым процессом и обновление тестовой копии.
- Исправлены найденные ошибки логирования и преждевременно доступное сохранение
  во время остановки. Новое состояние finalizing блокирует кнопки до завершения.
- Unit-набор также проходит на Node 20.20.2. Из команды удалён старый
  --experimental-default-type: Node 24 больше не принимает этот флаг.
- Workflow tester.yml проверен как YAML; команды и зависимости воспроизведены локально.
  Старый server / Python из CI исключены. Удалённый GitHub Actions не запускался:
  коммит и push не выполнялись.
- VERSION / manifest / стабильный ID и git diff --check проходят.

Отчёты полного Chrome-прогона:
`/tmp/plugin-popup-updates-qAYHp9/report.json`,
`/tmp/plugin-recovery-AmsFKK/report.json`,
`/tmp/plugin-ui-report-du24dU/report.json`.
Unit / coverage: `/tmp/plugin-node24-unit.log`; Chrome stdout: `/tmp/plugin-node24-ui.log`.
Дополнительный полный прогон с Node 20: `/tmp/plugin-final-ui.log` (61/61).

Полный backend / ML E2E сегодня не запускался: mongod и готовый ML-образ отсутствуют.
Не проверены Windows, физические устройства, production HTTPS и многочасовая
устойчивость. Callback четырёхчасового предела проверен без ожидания четырёх часов.
Матрица проверок и оставшиеся границы: [test-coverage.md](test-coverage.md).

## Упаковка GitHub Release — 26.10.2026

- Проверены реальные шаги последнего завершённого job: из 53 секунд 44 занимали
  установка инструментов / минификация, из них около 40 — apt. ZIP создавался
  менее секунды. Текущий на момент проверки запуск задержался на этом же шаге.
- Локальный замер: исходный ZIP 66 254 байта; без тестов и Markdown 53 874 байта;
  минификация рабочих JS и settings уменьшает его ещё лишь на 6 067 байт.
- Новый workflow проверен локальным исполнением его shell-шагов: VERSION / ID
  корректны, ZIP 52 106 байт / 27 рабочих файлов, проверка и упаковка около 0,04 с.
  Это локальный замер без checkout, запуска runner и загрузки на GitHub.
- Все рабочие файлы в ZIP побайтно совпадают с исходниками, manifest key и настройки
  сохранены. YAML разобран, `unzip -tq` и `git diff --check` прошли.
- Новая GitHub job / публикация не запускалась. Текущий удалённый job не отменялся;
  локальная правка не меняет уже запущенный workflow. Коммит / push не выполнялись.

## Открытие popup — 25.10.2026

- Клиентские Node-тесты: 20/20; VERSION / manifest / ID: проверка пройдена.
- Настоящий Chrome и HTTP-сервер политик: 11/11. Проверены уведомление без старта,
  повторное открытие, запрет версии, безопасная ссылка, 401 / 503 / JSON / timeout,
  автономный режим и повторная проверка политики перед стартом.
- Состояние текущей записи и синтетический файл OPFS сохраняются. Нижние кнопки
  доступны прокруткой при viewport popup 390×600.
- Использованы копии client и отдельные профили /tmp; рабочий сервер не затронут.
  Полный захват / upload / ML после этой правки не повторялся: проверен popup и
  повторная проверка перед стартом, без запуска новой записи.
- Команда и ограничения: [текущая инструкция](../tests/README.md).
  Изменения не коммитились и не отправлялись в remote.

## Финальная проверка — 23.10.2026

### Выполнено

- Клиентские Node-тесты: 20/20; скрипты версии: 5/5.
- Проверка VERSION / manifest и стабильного ID: пройдена.
- Chrome / OPFS / MediaRecorder: 8/8 сценариев восстановления после сетевых
  ошибок, потери ACK, ошибок чтения / удаления / квоты; просмотр и скачивание
  файла без индекса. HTTP-сервер этого набора синтетический.
- Настоящий полный цикл через основной backend и ML: 15/15. Запись двух потоков,
  скачивание, upload / ACK / очистка, две ML-задачи done, GridFS / callbacks,
  OCR и воспроизведение на teach. Политика версий и права Admin также проверены.

Отдельной сборки client нет: Chrome загружает каталог напрямую.
Удалены невызываемые функции / импорты логов и иллюстрации прежней справки.
README и встроенная справка описывают актуальные запись, отправку и восстановление.
manifest key / ID, API и OPFS сохранены. server / playground не очищались.

### Ограничения

Проверка выполнена в Linux Google Chrome на отдельных профилях /tmp и тестовых
устройствах. Windows / macOS, физические камера / микрофон, production HTTPS,
многочасовая запись и все варианты аварийного закрытия не проверялись заново.
Локальные видео и сырые результаты не включаются в commit.

Команды: [текущие тесты](../tests/README.md),
[полный цикл](https://github.com/OSLL/proctoring/blob/pre-release/tests/extension/README.md).
Общий отчёт: [proctoring validation](https://github.com/OSLL/proctoring/blob/pre-release/docs/validation.md).
