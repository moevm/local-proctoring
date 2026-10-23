import { downloadBlob } from './download.js';
const list = document.querySelector('#files');
const status = document.querySelector('#status');
let urls = [];
async function refresh() {
    urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
    list.replaceChildren(); status.textContent = 'Чтение файлов…';
    try {
        const root = await navigator.storage.getDirectory();
        let count = 0;
        for await (const [name, handle] of root.entries()) {
            if (handle.kind !== 'file') continue;
            const row = document.createElement('article');
            const title = document.createElement('p'); title.textContent = name; row.append(title); list.append(row);
            try {
                const file = await handle.getFile();
                const size = document.createElement('p'); size.textContent = `${(file.size / 1048576).toFixed(2)} MiB`; row.append(size);
                if (name.endsWith('.webm') && file.size) {
                    const video = document.createElement('video'); video.controls = true; video.preload = 'metadata';
                    const url = URL.createObjectURL(new Blob([file], { type: 'video/webm' })); urls.push(url); video.src = url; row.append(video);
                }
                const download = document.createElement('button'); download.textContent = 'Скачать';
                download.onclick = async () => {
                    download.disabled = true;
                    try {
                        const id = await downloadBlob(await handle.getFile(), name);
                        const reveal = document.createElement('button'); reveal.textContent = 'Показать в папке';
                        reveal.onclick = () => chrome.downloads.show(id); row.append(reveal);
                        status.textContent = 'Файл скачан. Оригинал остаётся в расширении.';
                    } catch (error) { status.textContent = error.message; }
                    finally { download.disabled = false; }
                };
                row.append(download); count++;
            } catch { title.textContent += ' — не удалось прочитать; файл не удалён'; }
        }
        status.textContent = `Файлов: ${count}`;
    } catch (error) { status.textContent = `Не удалось открыть хранилище: ${error.message}`; }
}
document.querySelector('#refresh').onclick = refresh;
window.addEventListener('pagehide', () => urls.forEach(url => URL.revokeObjectURL(url)));
refresh();
