export async function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    let id, settle, rejectDownload;
    const done = new Promise((resolve, reject) => { settle = resolve; rejectDownload = reject; });
    const check = item => {
        if (item.id !== id) return;
        const state = typeof item.state === 'string' ? item.state : item.state?.current;
        if (state === 'complete') settle();
        if (state === 'interrupted') rejectDownload(new Error('Скачивание отменено или прервано. Исходные записи сохранены.'));
    };
    chrome.downloads.onChanged.addListener(check);
    try {
        id = await chrome.downloads.download({ url, filename: filename.replaceAll(':', '_'), saveAs: true });
        (await chrome.downloads.search({ id })).forEach(check);
        await done;
        return id;
    } finally {
        chrome.downloads.onChanged.removeListener(check);
        URL.revokeObjectURL(url);
    }
}
