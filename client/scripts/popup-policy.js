import { assessPolicy, fetchPluginPolicy, pluginVersion } from './plugin-policy.js';

// Informational only: recording and upload state belongs to the recording tab.
export async function showPopupPolicy(settings, container) {
    const document = container.ownerDocument;
    function show(title, message, state = 'info', downloadUrl = null) {
        container.dataset.state = state;
        const heading = document.createElement('strong');
        heading.textContent = title;
        const text = document.createElement('p');
        text.textContent = message;
        container.replaceChildren(heading, text);
        if (downloadUrl) {
            try {
                const url = new URL(downloadUrl);
                if (url.protocol !== 'https:' || url.username || url.password) return;
                const link = document.createElement('a');
                link.textContent = 'Скачать обновление';
                link.href = url.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                container.append(link);
            } catch { /* An invalid download link must not hide the notice. */ }
        }
    }

    if (!settings.server_connection) {
        show('Автономный режим', 'Проверка обновлений доступна при подключении к серверу.');
        return;
    }
    show('Проверяем обновления…', `Установлена версия ${pluginVersion()}.`);
    try {
        const policy = await fetchPluginPolicy(settings);
        const version = pluginVersion();
        const result = assessPolicy(policy, version);
        if (result.blocked || result.outdated || result.unsupported || result.unknown) {
            const title = result.blocked ? 'Обновите расширение: начало записи запрещено'
                : result.outdated ? 'Доступна новая версия расширения'
                : result.unsupported ? 'Версия расширения не поддерживается'
                : 'Версия расширения не найдена среди выпущенных';
            show(title, `Установлена версия ${version}. Актуальная: ${policy.latestVersion || 'уточните у преподавателя'}. ` +
                'Перед обновлением завершите запись и выгрузите видео. Не удаляйте расширение и его данные.',
                'warning', policy.downloadUrl);
        } else {
            show(policy.latestVersion ? 'Новая версия не требуется' : 'Проверка обновлений',
                `Установлена версия ${version}. ` + (policy.latestVersion
                    ? `Актуальная на сервере: ${policy.latestVersion}.`
                    : 'Сервер не указал актуальную версию.'));
        }
    } catch {
        show('Не удалось проверить обновления',
            'Проверьте подключение и вход на сайт прокторинга, затем откройте расширение ещё раз.');
    }
}
