
export const pluginVersion = () => chrome.runtime.getManifest().version;
const valid = v => typeof v === 'string' && /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(v) && v.split('.').every(n => Number(n) <= 65535);
export function compareVersions(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return Math.sign((x[i] || 0) - (y[i] || 0));
    return 0;
}
export function assessPolicy(policy, version) {
    if (!policy || typeof policy.requireVersion !== 'boolean' || !Array.isArray(policy.blockedVersions) ||
        !valid(version) || [policy.latestVersion, policy.minimumVersion, ...policy.blockedVersions].some(v => v !== null && !valid(v))) {
        throw new Error('Некорректная политика версий сервера. Обратитесь к преподавателю.');
    }
    const has = versions => versions.some(v => compareVersions(v, version) === 0);
    for (const key of ['knownVersions', 'unknownVersions', 'deprecatedVersions']) {
        if (policy[key] !== undefined && (!Array.isArray(policy[key]) || policy[key].some(v => !valid(v)))) throw new Error('Некорректная политика версий сервера.');
    }
    for (const key of ['blockOutdated', 'blockUnsupported', 'blockUnknown']) {
        if (policy[key] !== undefined && typeof policy[key] !== 'boolean') throw new Error('Некорректная политика версий сервера.');
    }
    const outdated = has(policy.deprecatedVersions || []) || Boolean(policy.latestVersion && compareVersions(version, policy.latestVersion) < 0);
    const unsupported = has(policy.blockedVersions) || Boolean(policy.minimumVersion && compareVersions(version, policy.minimumVersion) < 0);
    const unknown = has(policy.unknownVersions || []) || Boolean(policy.knownVersions?.length && !has(policy.knownVersions));
    return { blocked: Boolean((unsupported && policy.blockUnsupported !== false) || (outdated && policy.blockOutdated) || (unknown && policy.blockUnknown)),
        outdated, unsupported, unknown };
}
export async function fetchPluginPolicy(settings) {
    if (!settings.server_connection) return null;
    const { requestJSON } = await import('./upload.js');
    return requestJSON(settings.server_url.replace(/\/$/, '') + '/plugin_policy', {
        cache: 'no-store', timeoutMs: 10000
    });
}
export async function checkPluginPolicy(settings, notify) {
    if (!settings.server_connection) return;
    let policy;
    try {
        policy = await fetchPluginPolicy(settings);
    } catch (error) {
        throw new Error('Не удалось проверить версию расширения. Запись не начата. ' + error.message);
    }
    const version = pluginVersion();
    const result = assessPolicy(policy, version);
    if (result.blocked || result.outdated || result.unsupported || result.unknown) {
        await notify([
            `Установлена версия ${version}. Актуальная версия: ${policy.latestVersion || 'уточните у преподавателя'}.`,
            result.blocked ? 'Эта версия запрещена. Обновите расширение перед началом записи.' :
                result.unknown ? 'Версия не найдена в списке выпущенных. Установите официальный архив.' :
                result.unsupported ? 'Версия не поддерживается. Обновите расширение.' : 'Обновите расширение: установленная версия устарела.',
            ...(typeof policy.downloadUrl === 'string' && policy.downloadUrl.startsWith('https://') ? ['Архив обновления: ' + policy.downloadUrl] : []),
            'Перед обновлением завершите запись и выгрузите оставшиеся видео. Сохраняйте ID и данные расширения.'
        ], result.blocked ? 'ЗАПИСЬ ЗАБЛОКИРОВАНА — ОБНОВИТЕ РАСШИРЕНИЕ' : 'ОБНОВИТЕ РАСШИРЕНИЕ');
    }
    if (result.blocked) {
        const error = new Error('Версия расширения запрещена сервером. Требуется обновление.');
        error.notified = true;
        throw error;
    }
}
