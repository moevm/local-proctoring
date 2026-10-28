# Mock API веб-прокторинга

`createMockProctoringApi({ version, directory, port })` создаёт изолированный HTTP-сервер
на `127.0.0.1`. По умолчанию порт случайный. UI-fixture запускает и закрывает его
автоматически внутри тестового контейнера; внешний веб-прокторинг и БД не нужны.

Контракт сверялся с [remoteSessions.js](https://github.com/OSLL/proctoring/blob/pre-release/backend/routes/remoteSessions.js). Mock реализует
только используемые расширением маршруты, а не весь веб-прокторинг. Его собственные
проверки находятся в `contract/proctoring-api.test.js`; при изменении backend сверяйте контракт
и обновляйте mock вместе с ними. Соседний checkout при запуске тестов не читается.

## Маршруты

Все пути начинаются с `/api/remoteSessions`.

| Метод / путь | Вход | Ответ |
| --- | --- | --- |
| GET `/plugin_policy` | Cookie | Политика версий, `Cache-Control: private, no-store` |
| POST `/start_session` | Multipart: group, surname, name, title, необязательные patronymic / plugin_version | 201 `{ id }`, ID из 24 hex-символов |
| GET `/status/:id` | Cookie владельца | `{ videosSaved, processingStarted }` |
| POST `/upload_video` | Multipart: id, metadata JSON, screen_video, camera_video, logs | `{ success: true, videosSaved: true, id }` |

Без `mock_session=student` или `mock_session=other` — 401. Чужая сессия — 403,
неизвестная — 404, некорректный ID / форма — 400. Заблокированная версия при старте —
426 с `code: PLUGIN_UPDATE_REQUIRED`. Повторный / одновременный upload — 409.

Камеру можно не присылать при `metadata.no_stream_confirm.camera === true`.
Успех upload сохраняет состояние сессии; status после потери ответа возвращает
сохранённый результат. При отказе очереди ответ 503 содержит `videosSaved: true`,
а status возвращает `processingStarted: false`; перезапись видео запрещена.

Mock сохраняет присланные синтетические файлы в каталог fixture. Он не объединяет
WebM через ffmpeg, не проверяет реальные права LDAP / роли, не выполняет ML и callbacks.
Для защиты тестового процесса multipart ограничен 32 MiB — это не production-лимит.
Устаревший SSE progress расширением не используется и в mock не реализован.

## Настройки сценария

В UI mock доступен как `api`. Каждый тест начинает с обычного успешного API.

| Свойство / метод | Назначение |
| --- | --- |
| `policy` | Поля latestVersion, minimumVersion, blockedVersions и переключатели блокировки |
| `faults.policyStatus`, `faults.startStatus`, `faults.statusStatus`, `faults.uploadStatus` | HTTP-отказ соответствующего маршрута; обычное значение 200, start при успехе отвечает 201 |
| `faults.policyResponse` | `json`, `malformed`, `hang`, `hang-body` |
| `faults.invalidACK = true` | Ответ upload `{ success: false }` без фиксации сохранения |
| `faults.loseUploadResponse = true` | Сохранить видео и оборвать JSON-ответ |
| `faults.delayUpload = true` / `releaseUpload()` | Задержать подтверждение до явного разрешения теста |
| `faults.processingStarted = false` | Сохранить видео и вернуть ошибку запуска очереди |
| `createSession({ id, owner, ... })` | Подготовить существующую серверную сессию для recovery |
| `sessions`, `uploads`, `requests` | Данные для assertions, не production storage |

Пример в сценарии записи:

```js
api.faults.uploadStatus = 403;
const before = await app.storage.files();
await app.popup.save();
await app.media.dismissDialog('Не удалось завершить сохранение');
expect(await app.storage.files()).toEqual(before);
```

## Проверка отдельно от UI

```sh
docker compose run --build --rm tests node --test contract/proctoring-api.test.js
```

Fixture сама запускает mock и ожидает готовности. Порты на хост не публикуются;
тестовый cookie не даёт доступа к настоящему сервису.
