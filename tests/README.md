# Тесты расширения

Весь код тестов — **ES modules в `.js`**. В package.json задан `type: module`.
Unit и API-контракт запускает `node:test`; браузерные сценарии — Playwright Test.
Docker одинаково используется локально и в CI. Устанавливать Node или Chrome на хост не нужно.

## Запустить и найти нужный тест

Команды выполняются из корня репозитория:

```sh
# Полный набор: формат, lint, VERSION, unit, HTTP-контракт, браузер.
docker compose run --build --rm tests

# Один уровень проверки.
docker compose run --build --rm tests npm run test:unit
docker compose run --build --rm tests npm run test:contract
docker compose run --build --rm tests npm run test:ui

# Один файл или сценарий. Рабочий каталог контейнера — /workspace/tests.
docker compose run --build --rm tests node --experimental-vm-modules --test unit/upload.test.js
docker compose run --build --rm tests npm run test:ui -- recording.spec.js
docker compose run --build --rm tests npm run test:ui -- --grep '403'
docker compose run --build --rm tests npm run test:ui:list
```

`--build` учитывает изменения файлов, установка зависимостей кешируется.
Команда после `tests` заменяет Dockerfile CMD `npm test`. Можно также задать
Compose `command: ["npm", "run", "test:unit"]`.
Linux-пользователь с UID/GID не 1000 задаёт `export TEST_UID=$(id -u) TEST_GID=$(id -g)`.
В образе закреплены Node / Chrome; npm-зависимости закреплены lock-файлом.
Внешняя сеть у тестового контейнера выключена.

## Три уровня проверки

| Каталог | Что проверяет | Настоящее / подмена |
| --- | --- | --- |
| `unit/` | Функции production-кода: версия, upload, writer, логи, background | Настоящий JS; Chrome / OPFS / fetch — объекты в памяти |
| `contract/` | Поведение нашего mock API: cookie, формы, HTTP-коды, ACK, статусы | Настоящий HTTP на loopback; backend, Mongo и ML отсутствуют |
| `ui/` | Действия пользователя, диалоги, восстановление и сохранность видео | Настоящие Chrome, MediaRecorder, OPFS, downloads; веб-прокторинг заменён mock API |

Contract-тесты проверяют заглушку, а не совместимость с развёрнутым backend.
Внешний API сверялся с [remoteSessions.js](https://github.com/OSLL/proctoring/blob/pre-release/backend/routes/remoteSessions.js); при изменении
контракта нужно обновить [mock](mocks/README.md) и contract-тесты.

## Как устроен браузерный сценарий

Каждый UI-тест получает собственную временную папку, HTTP mock, копию client и
профиль Chrome. Общего storage и зависимости от предыдущего теста нет.
Файл [fixtures/browser.js](fixtures/browser.js) создаёт эти ресурсы, передаёт их
тесту, прикладывает диагностику, затем закрывает Chrome / mock и удаляет временные файлы.
Это аналог pytest yield fixture; вручную закрывать обычный `app` не нужно.

| Fixture | Роль и пример |
| --- | --- |
| `app` | Страницы и хранилище: `app.popup.save()`, `app.media.dismissDialog(...)`, `app.storage.files()` |
| `recording` | Последовательности через несколько страниц: `grantPermissions()`, `start()`, `stop()` |
| `api` | Только mock веб-прокторинга: `api.faults.uploadStatus = 403`, `api.uploads`, `api.sessions` |
| `session` | Низкий уровень Chrome: context, CDP, пути профиля; нужен главным образом lifecycle-тестам |
| `createScenario(options)` | Та же изоляция с другими настройками / отказом устройства; возвращает эти четыре объекта |
| `recovery` | Дополнительная fixture из `fixtures/recovery.js`: настоящая готовая WebM-запись и серверная сессия без нового захвата экрана |

Обычный тест использует только нужные fixtures. Например, сценарий отказа upload
в [ui/upload.spec.js](ui/upload.spec.js) проходит следующие шаги:

1. `recording.grantPermissions()` нажимает кнопку в popup и закрывает диалоги служебной вкладки.
2. `recording.start()` заполняет форму, нажимает Start, ждёт настоящих OPFS-чанков.
3. `recording.stop()` нажимает Stop и ждёт финализации файлов / освобождения устройств.
4. `api.faults.uploadStatus = 403` меняет ответ локального HTTP mock.
5. `app.popup.save()` вызывает production-обработчик кнопки. Сервер отвечает 403.
6. Тест проверяет сообщение пользователю и сравнивает файлы до / после отказа.

Страницы и flow **не подменяют запись или upload**. Они выполняют настоящие DOM-действия
и ожидают их завершения. Ожидаемый результат проверяется в самом тесте.

## Куда вносить изменение

| Изменение | Файл / каталог |
| --- | --- |
| Новая проверка конкретного поведения | Существующий тематический файл `unit/`, `contract/` или `ui/` |
| Изменился селектор или действие на одной странице | `pages/popup.js`, `pages/media.js`, `pages/recordings.js` |
| Повторяется пользовательская последовательность из нескольких страниц | `flows/recording.js` |
| Запуск Chrome, профиль, загрузка распакованного расширения | `support/browser/session.js` |
| Ошибка устройства / диска / download на границе браузерного API | `support/browser/media-controls.js`, `storage-faults.js`, `download-faults.js` |
| Ответ или состояние веб-прокторинга | `mocks/proctoring-api.js`; проверки — `contract/proctoring-api.test.js` |
| Chrome-зависимая unit-подготовка | Соответствующий `support/unit/*-environment.js` |

`pages/` знает DOM, `flows/` — порядок действий, `support/` — окружение.
`fixtures/` управляет временем жизни этих объектов. Не переносите assertions результата
в fixture и не добавляйте отдельный универсальный helper ради одной строки.

## Добавить unit-тест

Для чистой функции достаточно импорта production-модуля. Например, в
`unit/plugin-policy.test.js` можно добавить новую проверку сравнения версий:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../../client/scripts/plugin-policy.js';

test('trailing zero does not change the version', () => {
  assert.equal(compareVersions('3.1', '3.1.0'), 0);
});
```

Chrome-зависимая функция получает окружение из `support/unit/`.
В `unit/logger.test.js` готовая фабрика даёт реальные `flushLogs` / `logClientAction`
и отдельный fake storage. В `unit/upload.test.js` `beforeEach` создаёт новое окружение,
`environment.client` — production upload-модуль, `environment.fetch` задаёт ответ сети.

Загрузчик `support/unit/load-client-module.js` использует нативные VM-модули Node:
читает исходник без замен, связывает настоящий граф импортов и создаёт отдельные
module state / globals для каждого окружения. Периодический flush в unit выключен;
тест вызывает его явно. `--experimental-vm-modules` уже входит в npm-команду,
runtime Node закреплён в Docker. Процессный `globalThis` не изменяется.

## Добавить UI-сценарий

Сначала найдите файл поведения: `popup-form`, `devices`, `recording`, `upload`,
`policy`, `recordings`, `help-and-notifications`, `lifecycle` или `recovery`.
Дополняйте существующую параметризацию, если меняется только входное значение.
Например, HTTP-ошибки start/status/upload в `upload.spec.js` заданы таблицей кодов и фаз.

Каркас самостоятельной проверки:

```js
import { test, expect } from '../fixtures/browser.js';

test('upload refusal keeps the original recordings', async ({ app, api, recording }) => {
  await recording.grantPermissions();
  await recording.start();
  await recording.stop();
  const before = await app.storage.files();
  api.faults.uploadStatus = 403;

  await app.popup.save();
  await app.media.dismissDialog('Не удалось завершить сохранение');

  expect(await app.storage.files()).toEqual(before);
  expect((await app.storage.read()).bState).toBe('failedUpload');
});
```

Это разбор уже существующего сценария 403, а не предложение добавить его дубликат.
Для другого режима создайте сценарий явно:

```js
const { app, recording } = await createScenario({
  settings: { server_connection: false, local_video_saving: true },
});
```

Для отказа камеры: `createScenario({ faults: { camera: 'NotAllowedError' } })`.
Для HTTP-отказа меняйте `api.faults`, а не устройство. Для восстановления готового файла
импортируйте `test` из `fixtures/recovery.js`; `recovery.upload()` вызывает настоящий
upload-модуль в Chrome, данные не хранятся в скрытых `window.seed/state/upload`.

Порядок теста: подготовка → действие → assertions. Для DOM используйте
`await expect(locator).toBeVisible()` / `toBeEnabled()`; для асинхронного состояния —
`expect.poll`. Не синхронизируйте действия произвольным sleep.
В fault-сценарии проверяйте сохранность файлов / metadata, а не только текст ошибки.

## Проверить перед сдачей

```sh
docker compose run --build --rm tests
# После изменений fixtures: два прогона без retries.
docker compose run --build --rm tests npm run test:ui:repeat
# Применить единое форматирование к исходникам на хосте.
docker compose run --build --rm -v "$PWD/tests:/workspace/tests" tests npm run format
```

CI проверяет Prettier и ESLint, запрещает неопределённые / неиспользуемые имена.
Один UI-worker обязателен из-за общего Xvfb-дисплея; retries=0, `.only` запрещён в CI.
Отчёты на хосте: `tests/reports/results.json`, `junit.xml`, `html/index.html`.
JSON / HTML содержат имя теста, ошибку и сводку browser/API; профили и видео не публикуются.
Список тестов `test:ui:list` не перезаписывает результаты последнего прогона.

Mock не выполняет ML / callbacks. Физические устройства, production HTTPS, Windows
и многочасовая запись — отдельные проверки. Четырёхчасовой stop проверяется вызовом
его callback. Crash/reload проверяет уже зафиксированные байты после паузы записи,
а не восстановление последнего незаписанного чанка.
Фактические результаты: [validation.md](../docs/validation.md).
