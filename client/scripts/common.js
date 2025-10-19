import { logClientAction } from "./logger.js";

export const getAvailableDiskSpace = async () => {
    const estimate = await navigator.storage.estimate();
    const freeSpace = estimate.quota - estimate.usage;
    logClientAction({ action: "Check available disk space", freeSpace });
    return freeSpace;
};

export const getFormattedDateString = (date) => {
    logClientAction({ action: "Generate human-readable date string" });

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${hours}:${minutes}:${seconds}, ${day}.${month}.${year}`;
};

export const getDifferenceInTime = (date1, date2) => {
    const diff = Math.abs(Math.floor(date2.getTime() / 1000) - Math.floor(date1.getTime() / 1000)); // ms
    const totalSeconds = Math.floor(diff);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // Для удобного представления
    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');

    logClientAction({ action: "Calculate difference in time" });
    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
};

export function generateObjectId() {
    const bytes = new Uint8Array(12);
    const timestamp = Math.floor(Date.now() / 1000);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, timestamp, false);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes.subarray(4));
    } else {
      for (let i = 4; i < 12; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    logClientAction({ action: "Generate ObjectId" });

    return Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
}

export function getBrowserFingerprint() {
    const fingerprint = {
        browserVersion: navigator.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || 'unknown',
        userAgent: navigator.userAgent,
        language: navigator.language || navigator.userLanguage || 'unknown',
        cpuCores: navigator.hardwareConcurrency || 'unknown',
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        availableScreenResolution: `${window.screen.availWidth}x${window.screen.availHeight}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
        timestamp: new Date().toISOString(),
        cookiesEnabled: navigator.cookieEnabled ? 'yes' : 'no',
        windowSize: `${window.innerWidth}x${window.innerHeight}`,
        doNotTrack: navigator.doNotTrack || window.doNotTrack || 'unknown'
    };

    logClientAction({ action: "Get browser fingerprint", fingerprint});

    return fingerprint;
}

export async function requestClearLogs() {
    await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "clearLogs" }, (response) => {
            if (response.success) {
                //ЗДЕСЬ НЕ НАДО ЛОГГИРОВАТЬ
                //logClientAction({ action: "Clear logs" });
                console.log("Логи очищены перед завершением");
            } else {
                //logClientAction({ action: "Error while clearing logs", error: response.error });
                console.error("Ошибка очистки логов:", response.error);
            }
            resolve();
        });
    });
}

export async function saveBlobToFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    filename = filename.replaceAll(":", "_");

    try {
        await chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        });
        
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('Download failed:', error);
        URL.revokeObjectURL(url);
    }
}

export async function deleteFilesFromTempList() {
    const tempFiles = (await chrome.storage.local.get('tempFiles'))['tempFiles'] || [];
    if (tempFiles.length > 0) {
        const root = await navigator.storage.getDirectory();
        logClientAction({ action: "Start delete temporary files", fileCount: tempFiles.length });
        for (const file of tempFiles) {
            try {
                await root.removeEntry(file);
                logClientAction({ action: "Delete temp file", fileName: file });
            } catch (e) {
                console.log(e);
                logClientAction({ action: "Fail to delete temp file", fileName: file, error: String(e) });
            }
        }
        chrome.storage.local.remove('tempFiles');
    }
}

export async function showModalNotify(messages, title = "Уведомление", showOnActiveTab = false, mediaIntependent=false) {
    chrome.runtime.sendMessage({ action: "closePopup" });

    logClientAction({ action: "showModalNotify", showOnActiveTab});

    if (!Array.isArray(messages)) {
        messages = [messages];
    }

    if (showOnActiveTab) {
        try {
            return await sendModalNotifyToActiveTab(messages, title);
        } catch (error) {
            // console.warn('[sendModalNotifyToActiveTab] Ошибка отправки сообщения:', error.message);
            logClientAction({ action: "sendModalNotifyToActiveTab", error: error.message});
            const blockedErrors = [
                'Receiving end does not exist',
                'Could not establish connection',
                'No matching service worker',
                'The message port closed before a response was received.'
            ];

            const isBlocked = blockedErrors.some(e => error.message.includes(e));
            if (isBlocked) {
                // console.warn('[showModalNotify] Модальное уведомление не доступно на текущей вкладке. Открываем media.html');
                logClientAction({ action: "showModalNotify", info: "Modal notification is not available on the current tab. Open media.html."});
                return await showModalNotify(messages, title, false, mediaIntependent);
            }
            throw error;
        }
    } else {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: "gotoMediaTab",
                mediaExtensionUrl: chrome.runtime.getURL("pages/media.html") }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Error send gotoMediaTab', chrome.runtime.lastError.message);
                        logClientAction({ action: "Error send gotoMediaTab", message: chrome.runtime.lastError.message});
                    }
                    else {
                        // console.log('Response gotoMediaTab', response);
                        logClientAction({ action: "Response gotoMediaTab", response});
                    }
                });

            if (!mediaIntependent) {
                const existingOverlay = document.getElementById('custom-modal-overlay');
                if (existingOverlay) existingOverlay.remove();

                const overlay = document.createElement('div');
                overlay.id = 'custom-modal-overlay';

                const modal = document.createElement('div');
                modal.id = 'custom-modal';

                modal.innerHTML = `
                    <h2>${title}</h2>
                    <div class="modal-content">
                        ${messages.map(msg => `<p>${msg}</p>`).join('')}
                    </div>
                    <button id="modal-close-btn">Хорошо. Я прочитал(а).</button>
                `;

                modal.querySelector('#modal-close-btn').addEventListener('click', () => {
                    overlay.remove();
                    document.body.style.overflow = '';
                    resolve();
                });

                document.body.style.overflow = 'hidden';
                overlay.appendChild(modal);
                document.body.appendChild(overlay);
            } else {
                
                chrome.runtime.sendMessage({
                    type: "showModalNotifyOnMedia",
                    messages: messages,
                    title: title
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        logClientAction({ action: "showModalNotifyOnMedia", error: chrome.runtime.lastError.message});
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
    
                    if (typeof response === 'undefined') {
                        logClientAction({ action: "showModalNotifyOnMedia", error: "Media didn't respond"});
                        return reject(new Error("Media не ответил"));
                    }
    
                    logClientAction({ action: "showModalNotifyOnMedia"});
    
                    resolve(response);
                });
            }
        });
    }
}

function sendModalNotifyToActiveTab(messages, title) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                logClientAction({ action: "sendModalNotifyToActiveTab", error: chrome.runtime.lastError.message});
                return reject(new Error(chrome.runtime.lastError.message));
            }

            const tab = tabs[0];
            if (!tab || !tab.id) {
                logClientAction({ action: "sendModalNotifyToActiveTab", error: "Active tab not found"})
                return reject(new Error('Активная вкладка не найдена'));
            }

            chrome.tabs.sendMessage(tab.id, {
                type: 'showModalNotifyOnActiveTab',
                title,
                messages
            }, (response) => {
                if (chrome.runtime.lastError) {
                    logClientAction({ action: "showModalNotifyOnActiveTab", error: chrome.runtime.lastError.message});
                    return reject(new Error(chrome.runtime.lastError.message));
                }

                if (typeof response === 'undefined') {
                    logClientAction({ action: "showModalNotifyOnActiveTab", error: "Content script didn't respond"});
                    return reject(new Error('Контент-скрипт не ответил'));
                }

                logClientAction({ action: "showModalNotifyOnActiveTab"});

                resolve(response);
            });
        });
    });
}

export function waitForNotificationSuppression(timeout = 300) {
    return new Promise((resolve) => {
        // Создаём временный слушатель сообщений для получения сигнала от background.js
        function messageListener(message, sender, sendResponse) {
            if (message.action === 'suppressModalNotifyAT') {
                logClientAction("waitForNotificationSuppression suppressModalNotifyAT")
                chrome.runtime.onMessage.removeListener(messageListener);
                resolve(true);
            }
        }
        chrome.runtime.onMessage.addListener(messageListener);

        // Если сигнал не придёт за timeout мс, считаем, что уведомление нужно показать
        setTimeout(() => {
            logClientAction("waitForNotificationSuppression suppressModalNotifyAT timeout")
            chrome.runtime.onMessage.removeListener(messageListener);
            resolve(false);
        }, timeout);
    });
}

export function setReadyToUploadContainer(container, files) {
    container.innerHTML = "";

    const titleElement = document.createElement("div");
    titleElement.id = "ready-to-upload-container-title";
    titleElement.innerHTML = `Файлов, доступных для выгрузки: ${files.length}`;

    container.appendChild(titleElement);

    if (files.length > 0) {
        const filesElement = document.createElement("div");
        filesElement.id = "ready-to-upload-container-files";

        files.forEach((fileName, index) => {
            const el = document.createElement("div");
            el.innerHTML = `${index + 1}. ${fileName}`;

            filesElement.appendChild(el);
        })

        container.appendChild(filesElement);
    }
}

export function buttonsStatesSave(state) {
	chrome.storage.local.set({'bState': state});
    logClientAction({ action: "Save buttons states"});
}

export async function deleteFiles() {
    await deleteFilesFromTempList();
    chrome.alarms.get('dynamicCleanup', (alarm) => {
        if (alarm) {
            chrome.alarms.clear('dynamicCleanup');
        }
        logClientAction({ action: "Delete temp files succeeds" });    
    });
}

export function getCurrentDateString(date) {
    logClientAction({ action: "Generate current date string" });
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T` + 
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export function parseDateString(str) {
    const [datePart, timePart] = str.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hours, minutes, seconds] = timePart.split(":").map(Number);

    return new Date(year, month - 1, day, hours, minutes, seconds);
}