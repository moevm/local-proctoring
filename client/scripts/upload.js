import { saveBlobToFile, deleteFiles, buttonsStatesSave } from './common.js';
import { flushLogs, prepareLogs } from './logger.js';

export async function requestJSON(url, options = {}) {
    const { timeoutMs = 30000, signal, ...request } = options;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
    const response = await fetch(url, { ...request, signal: controller.signal, credentials: 'include' });
    let data;
    try { data = await response.json(); }
    catch {
        if (response.ok) throw new Error('Сервер не вернул JSON-подтверждение. Локальные записи сохранены.');
        data = {};
    }
    if (!response.ok) {
        const text = response.status === 401 ? 'Войдите в аккаунт на сайте прокторинга и повторите отправку.' :
            response.status === 403 ? 'Нет доступа: проверьте аккаунт и FRONTEND_ORIGINS для ID расширения.' :
            (data.error || 'Ошибка сервера: ' + response.status);
        const error = new Error(text);
        error.videosSaved = data.videosSaved === true;
        throw error;
    }
    return data;
    } catch (error) {
        if (controller.signal.aborted) throw new Error('Запрос прерван или превышено время ожидания. Локальные записи сохранены; повторите отправку.');
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

export async function buildPayload(files, sessionId, metadata, logs) {
    if (!Array.isArray(files) || !files.length || !/^[a-f0-9]{24}$/i.test(sessionId)) throw new Error('Нет файлов или ID сессии');
    const form = new FormData();
    const root = await navigator.storage.getDirectory();
    let screens = 0;
    for (const name of files) {
        if (typeof name !== 'string' || !/_(screen|camera)_.*\.webm$/.test(name)) throw new Error('Неизвестный файл записи');
        const file = await (await root.getFileHandle(name)).getFile();
        // Empty artifacts from a failed start carry no frames; do not let
        // them poison a later recovered segment. Originals remain until ACK.
        if (!file.size) continue;
        const screen = name.includes('_screen_');
        screens += Number(screen);
        // OPFS File.type is often empty; backend validates video/webm.
        form.append(screen ? 'screen_video' : 'camera_video', new File([file], name, { type: 'video/webm' }));
    }
    if (!screens) throw new Error('Нет видео экрана');
    form.append('id', sessionId);
    form.append('metadata', JSON.stringify(metadata || {}));
    form.append('logs', new Blob([JSON.stringify(prepareLogs(logs) || [])], { type: 'application/json' }), 'extension_logs.json');
    return form;
}

export async function assertCanResume() {
    const { uploadAttempt } = await chrome.storage.local.get('uploadAttempt');
    if (uploadAttempt) throw new Error('Отправка этой записи уже начиналась. Сначала завершите её повторной отправкой. Локальные записи доступны в разделе «Мои записи».');
}

async function inventory(names, allowMissing = false) {
    const root = await navigator.storage.getDirectory();
    return Promise.all(names.map(async name => {
        try {
            const file = await (await root.getFileHandle(name)).getFile();
            return { name, size: file.size, lastModified: file.lastModified };
        } catch (error) {
            if (allowMissing && error.name === 'NotFoundError') return { name, missing: true };
            throw error;
        }
    }));
}

export async function uploadSession(settings) {
    await flushLogs();
    const { tempFiles = [], sessionId, extension_logs, metadata = {}, uploadAttempt } =
        await chrome.storage.local.get(['tempFiles', 'sessionId', 'extension_logs', 'metadata', 'uploadAttempt']);
    if (!settings.server_connection && !settings.local_video_saving) throw new Error('Не выбран способ сохранения');
    if (!/^[a-f0-9]{24}$/i.test(sessionId)) throw new Error('Нет ID сессии');
    await buttonsStatesSave('uploading');
    let confirmed = false;
    let snapshot;
    if (settings.server_connection) {
        const base = settings.server_url.replace(/\/$/, '');
        // Recover the server ACK before opening any local files or downloading again.
        const status = await requestJSON(base + '/status/' + sessionId);
        if (typeof status.videosSaved !== 'boolean') throw new Error('Несовместимый ответ API статуса');
        if (status.videosSaved) {
            if (!status.processingStarted) throw new Error('Видео уже сохранены. Попросите преподавателя запустить обработку; локальные записи сохранены.');
            if (!uploadAttempt || uploadAttempt.sessionId !== sessionId || uploadAttempt.server !== base) {
                throw new Error('Видео уже есть на сервере, но состав отправленных файлов неизвестен. Локальные записи сохранены; скачайте их в разделе «Мои записи».');
            }
            snapshot = uploadAttempt.files;
            const current = await inventory(tempFiles, true);
            if (current.some(file => !snapshot.some(old => old.name === file.name &&
                (file.missing || (old.size === file.size && old.lastModified === file.lastModified))))) {
                throw new Error('После отправки локальные файлы изменились. Они сохранены; скачайте их в разделе «Мои записи».');
            }
            confirmed = true;
        }
    }
    if (!confirmed) {
        snapshot = await inventory(tempFiles);
        const form = await buildPayload(tempFiles, sessionId, metadata, extension_logs);
        if (settings.local_video_saving) {
            for (const [name, file] of form) {
                if (file instanceof Blob) await saveBlobToFile(file, name === 'logs' ? 'extension_logs_' + sessionId + '.json' : file.name);
            }
        }
        if (settings.server_connection) {
            const base = settings.server_url.replace(/\/$/, '');
            await chrome.storage.local.set({ uploadAttempt: { sessionId, server: base, files: snapshot } });
            const result = await requestJSON(base + '/upload_video', { method: 'POST', body: form, timeoutMs: 900000 });
            if (result.success !== true || result.videosSaved !== true) throw new Error('Сервер не подтвердил сохранение. Локальные файлы не удалены.');
        }
    }
    await deleteFiles(snapshot.map(file => file.name));
    const remaining = await chrome.storage.local.get('tempFiles');
    if (remaining.tempFiles?.length) throw new Error('Остались неотправленные файлы. Локальные записи сохранены.');
    await chrome.storage.local.remove(['metadata', 'sessionId', 'fileNames', 'recording_start', 'recording_end', 'uploadAttempt']);
    await chrome.storage.local.set({ session_status: 'need_init', invalidStop: false });
    await buttonsStatesSave('needPermissions');
}
