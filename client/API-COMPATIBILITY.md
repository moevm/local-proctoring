# Контракт API расширения

Сервер: [proctoring](https://github.com/OSLL/proctoring).
Базовый URL: `session_settings.server_url`, путь `/api/remoteSessions`.
Локальная настройка — `http://127.0.0.1:8000/api/remoteSessions`, production — HTTPS.
Host разрешается manifest host_permissions; backend проверяет extension origin.

| Метод и путь | Доступ и назначение |
| --- | --- |
| GET /plugin_policy | Публичная политика версий, no-store |
| POST /start_session | Cookie login-session; создание сессии перед отправкой |
| POST /upload_video | Login-session и владелец; multipart с WebM и метаданными |
| GET /status/:id | Login-session и доступ; videosSaved / processingStarted |

`server_connection` включает серверные функции; `server_video_upload` управляет
отправкой видео (по умолчанию false). При `server_connection=false` запросов нет.
Без server_video_upload=true видео на сервер не отправляются.

Запись начинается локально без API-запросов. Данные формы хранятся до регистрации
серверной сессии. Popup показывает политику информационно; start_session проверяет
plugin_version и возвращает 426 при запрете. Версия не подтверждает подлинность клиента.
Отправка использует credentials: include; нужен вход на сайт в том же профиле Chrome.
Таймаут API и upload — 120 секунд.

При local_video_saving=true скачивание выполняется до сетевых операций.
«Мои записи» скачивает оригиналы независимо от сервера. Отмена скачивания,
ошибка сети и отказ API не разрешают удаление файлов. После потери ответа
проверяется status/:id; удаление требует подтверждённых success/videosSaved
и соответствия состава файлов отправленной попытке.

При videosSaved=true и processingStarted=false нужен повтор ML на backend,
а не повтор upload. Обновление расширения выполняется после выгрузки записей,
без смены key/ID и очистки данных.

Backend сохраняет одиночный WebM без remux; несколько фрагментов склеиваются
по времени в именах. SHA-256 вычисляется по сохраняемому файлу. Длительность
может отсутствовать до подготовки контейнера в ML.
Лимиты: 8 GiB на файл, 16 GiB на запрос; ML по умолчанию скачивает до 4 GiB на видео.

Настройка: [README](../README.md). Полный серверный контракт:
[совместимость](https://github.com/OSLL/proctoring/blob/main/docs/local-proctoring-compatibility.md).
Результаты проверок: [validation](../docs/validation.md).
