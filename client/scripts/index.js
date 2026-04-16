import { buttonsStatesSave, deleteFiles, getCurrentDateString, showModalNotify, saveBlobToFile } from "./common.js";
import { logClientAction, checkAndCleanLogs, clearLogs, prepareLogs } from "./logger.js";

import settings from '../settings.json' with { type: "json" };

const session_settings = settings.session_settings;

const noPatronymicCheckbox = document.querySelector('#no_patronymic_checkbox');
const permissionsStatus = document.querySelector('#permissions-status');
const startDate = document.querySelector('#start-date');
const recordTime = document.querySelector('#record-time')

let timerInterval = null;
let startTime = null;
let invalidStop = (chrome.storage.local.get('invalidStop'))['invalidStop'] || false;

async function updateInvalidStopValue(flag) {
    invalidStop = flag;
    await chrome.storage.local.set({ 'invalidStop': flag });
}

const inputElements = {
	group: document.querySelector('#group_input'),
	name: document.querySelector('#name_input'),
	surname: document.querySelector('#surname_input'),
	patronymic: document.querySelector('#patronymic_input'),
	work_title: document.querySelector('#work_title_input')
};

const buttonElements = {
	permissions: document.querySelector('.record-section__button_permissions'),
	start: document.querySelector('.record-section__button_record-start'),
	stop: document.querySelector('.record-section__button_record-stop'),
	upload: document.querySelector('.record-section__button_upload'),
    help: document.querySelector('.help-button'),
};

if (!session_settings.server_connection && !session_settings.local_video_saving) {
    // TODO: менять кнопки в зависимости от session_settings.server_connection и session_settings.local_video_saving
    buttonElements.upload.style.display = 'None';
    buttonElements.permissions.style.width = '368px';
}

const bStates = {
	'needPermissions': {
		permissions: 1,
		start: 0,
		stop: 0,
		upload: 0
	},
	'readyToRecord': {
		permissions: 0,
		start: 1,
		stop: 0,
		upload: 0
	},
	'recording': {
		permissions: 0,
		start: 0,
		stop: 1,
		upload: 0
	},
	'readyToUpload': {
		permissions: 0,
		start: 0,
		stop: 0,
		upload: 1
	},
	'failedUpload': {
		permissions: 1,
		start: 0,
		stop: 0,
		upload: 1
	}
}

const validationStringRegExp = /^[А-ЯЁ][а-яёА-ЯЁ -]*$/;

const validationRules = {
    group: {
        regex: /^\d{4}$/, 
        message: "Группа должна содержать ровно 4 цифры. Пример: '1234'"
    },
    name: {
        regex: validationStringRegExp,
        message: "Имя должно начинаться с заглавной буквы и содержать только кириллицу и тире/пробел. Пример: 'Иван'"
    },
    surname: {
        regex: validationStringRegExp,
        message: "Фамилия должна начинаться с заглавной буквы и содержать только кириллицу и тире/пробел. Пример: 'Иванов'"
    },
    patronymic: {
        regex: validationStringRegExp,
        message: "Отчество должно начинаться с заглавной буквы и содержать только кириллицу и тире/пробел. Пример: 'Иванович'"
    },
    work_title: {
        regex: /.+/,
        message: "Название работы не должно быть пустым."
    }
};

buttonElements.help.addEventListener('click', () => {
    const url = chrome.runtime.getURL('pages/help.html');

    chrome.tabs.query({}, (tabs) => {
        const existingTab = tabs.find(tab => tab.url === url);
        if (existingTab) {
            chrome.tabs.update(existingTab.id, { active: true });
        } else {
            chrome.tabs.create({ url });
        }
    });
});

function validateInput(input) {
    const rule = validationRules[input.id.replace('_input', '')];
    const messageElement = input.nextElementSibling;

    input.classList.remove('input-valid', 'input-invalid');
    messageElement.classList.remove('message-error');
    input.dataset.emptyChecked = '';

    if (!input.value.trim()) {
        messageElement.textContent = rule.message;
        return;
    }

    if (!rule.regex.test(input.value)) {
        messageElement.textContent = rule.message;
        input.classList.add('input-invalid');
        messageElement.classList.add('message-error');
    } else {
        messageElement.textContent = "";
        input.classList.add('input-valid');
    }
}

function handleFocus(event) {
    const input = event.target;
    const rule = validationRules[input.id.replace('_input', '')];
    const messageElement = input.nextElementSibling;
    
    if (!input.value.trim()) {
        messageElement.textContent = rule.message;
        input.classList.remove('input-valid', 'input-invalid');
        messageElement.classList.remove('message-error');
        input.dataset.emptyChecked = '';
    }
}

function handleBlur(event) {
    const input = event.target;
    const messageElement = input.nextElementSibling;
    
    if (!input.value.trim()) {
        messageElement.textContent = "";
    } else {
        validateInput(input);
    }
}

async function saveInputValues() {
    await chrome.storage.local.set({
        'inputElementsValue': {
            group: inputElements.group.value,
            name: inputElements.name.value,
            surname: inputElements.surname.value,
            patronymic: inputElements.patronymic.value,
            noPatronymicChecked: noPatronymicCheckbox.checked,
            work_title: inputElements.work_title.value
        }
    });
    logClientAction({ action: "Save input values" });
}

function formatDateTime(date) {
    logClientAction({action: "formatDateTime", date});
    return date.toLocaleString('ru-RU', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

function updateStartDateDisplay(dateStr) {
    logClientAction({ action: "updateStartDateDisplay", dateStr});
    startDate.textContent = dateStr || '-';
}

function updateRecordTimer() {
    if (!startTime) return;

    const now = new Date();
    const diffMs = now - startTime;

    const seconds = Math.floor((diffMs / 1000) % 60);
    const minutes = Math.floor((diffMs / 1000 / 60) % 60);
    const hours = Math.floor(diffMs / 1000 / 60 / 60);

    const timeStr = `${hours.toString().padStart(2, '0')}:` +
        `${minutes.toString().padStart(2, '0')}:` +
        `${seconds.toString().padStart(2, '0')}`;

    recordTime.textContent = timeStr;
}

// Проверка разрешений камеры, микрофона, экрана
async function updatePermissionsStatus() {
    let micStatus = '✗ Микрофон';
    let camStatus = '✗ Камера';
    let screenStatus = '✗ Экран';

    try {
        const micPermission = await navigator.permissions.query({ name: 'microphone' });
        micStatus = micPermission.state === 'granted' ? '✓ Микрофон' : '✗ Микрофон';
    } catch (e) {
        console.log('Microphone permission check failed:', e);
        logClientAction({ action: 'Microphone permission check failed:', e});
    }

    try {
        const camPermission = await navigator.permissions.query({ name: 'camera' });
        camStatus = camPermission.state === 'granted' ? '✓ Камера' : '✗ Камера';
    } catch (e) {
        console.log('Camera permission check failed:', e);
        logClientAction({ action: 'Camera permission check failed:', e});
    }

    try {
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'getScreenCaptureStatus' }, (response) => {
                resolve(response);
            });
        });

        if (response?.active) {
            screenStatus = '✓ Экран';
        }
    } catch (e) {
        console.log('Screen status check failed:', e);
        logClientAction({ action: 'Screen status check failed:', e});
    }

    permissionsStatus.textContent = `${micStatus} | ${camStatus} | ${screenStatus}`;

    logClientAction("updatePermissionsStatus" + `${micStatus} | ${camStatus} | ${screenStatus}`)
}

function savePatronymic() {
    chrome.storage.local.set({
        'savedPatronymic': inputElements.patronymic.value
    });
    logClientAction({ action: "Save patronymic value" });
}

noPatronymicCheckbox.addEventListener('change', async () => {
    if (noPatronymicCheckbox.checked) {
        savePatronymic();
        inputElements.patronymic.value = '';
        inputElements.patronymic.disabled = true;
        inputElements.patronymic.nextElementSibling.textContent = "";
        inputElements.patronymic.style.backgroundColor = "#f7c2ae";
        inputElements.patronymic.style.opacity = 0.5;
        inputElements.patronymic.placeholder = "";

        inputElements.patronymic.classList.remove('input-valid', 'input-invalid');
        inputElements.patronymic.dataset.emptyChecked = '';
    } else {
        let storedData = await chrome.storage.local.get('savedPatronymic');
        inputElements.patronymic.value = storedData.savedPatronymic || "";
        inputElements.patronymic.disabled = false;
        inputElements.patronymic.style.backgroundColor = "";
        inputElements.patronymic.placeholder = "Введите отчество";
        inputElements.patronymic.style.opacity = 1;
        validateInput(inputElements.patronymic);
    }
    saveInputValues();
    logClientAction({ action: "Toggle no patronymic checkbox", checked: noPatronymicCheckbox.checked });
});

document.querySelectorAll('input').forEach(input => {
    input.setAttribute('autocomplete', 'off');
});

async function updateButtonsStates() {
	let bState = (await chrome.storage.local.get('bState'))['bState'];
	if (!bState) {
		bState = 'needPermissions';
	}
	Object.entries(bStates[bState]).forEach(function([key, state]) {
		if (state === 0) {
			buttonElements[key].classList.add('record-section__button_inactive');
			buttonElements[key].setAttribute('disabled', true);
			buttonElements[key].classList.remove(`record-section__button_inprogress`);
			buttonElements[key].classList.remove(`record-section__button_active_${key}`);
		}
		else if (state === 1) {
			buttonElements[key].classList.add(`record-section__button_active_${key}`);
			buttonElements[key].removeAttribute('disabled');
			buttonElements[key].classList.remove('record-section__button_inactive');
			buttonElements[key].classList.remove('record-section__button_inprogress');
		}
		else if (state === 2) {
			buttonElements[key].classList.add(`record-section__button_inprogress`);
			buttonElements[key].classList.remove(`record-section__button_active_${key}`);
			buttonElements[key].classList.remove('record-section__button_inactive');
			buttonElements[key].setAttribute('disabled', true);
		}
	});
    logClientAction({ action: "Update button states" });
}

window.addEventListener('load', async () => {
	logClientAction({ action: "Open popup" });

	await checkAndCleanLogs();
	logClientAction('Old logs cleaned due to 24-hour inactivity');

    let inputValues = await chrome.storage.local.get('inputElementsValue');
    inputValues = inputValues.inputElementsValue || {};    
    for (const [key, value] of Object.entries(inputValues)) {
        if (key === 'noPatronymicChecked') {
            noPatronymicCheckbox.checked = value;
            if (value) {
                inputElements.patronymic.value = "";
                inputElements.patronymic.setAttribute('disabled', '');
                inputElements.patronymic.nextElementSibling.textContent = "";
                inputElements.patronymic.style.backgroundColor = "#f7c2ae";
                inputElements.patronymic.style.opacity = 0.5;
                inputElements.patronymic.placeholder = "";
            }
        } else {
            const input = inputElements[key];
            input.value = value;
            if (value.trim()) { 
                validateInput(input);
            } else {
                input.nextElementSibling.textContent = "";
            }
        }
    }

    Object.values(inputElements).forEach(input => {
        input.addEventListener('input', () => {
            input.value = input.value.trim()
            validateInput(input);
            saveInputValues();
        });
        input.addEventListener('focus', handleFocus);
        input.addEventListener('blur', handleBlur);
    });

	updateButtonsStates();
    
    updatePermissionsStatus();
    setInterval(updatePermissionsStatus, 2000); // Обновление каждые 2 секунды

    chrome.storage.local.get(['lastRecordTime', 'bState', 'timeStr'], (result) => {
        if (result.lastRecordTime) {
            startTime = new Date(result.lastRecordTime);
            updateStartDateDisplay(formatDateTime(startTime));

            if (result.bState === 'recording') {
                updateRecordTimer();

                if (timerInterval) {
                    clearInterval(timerInterval);
                }

                timerInterval = setInterval(updateRecordTimer, 1000);
            } else if (result.timeStr) {
                recordTime.textContent = result.timeStr;
            } else {
                recordTime.textContent = '-';
            }
        } else {
            updateStartDateDisplay('-');
            recordTime.textContent = '-';
        }
    });
});

buttonElements.permissions.addEventListener('click', async () => {
    let bState;
    chrome.storage.local.get('bState').then(result => {
        bState = result.bState;
        logClientAction({"action": "Get bState when click button permissions", bState});
        if (bState == 'failedUpload') {
            logClientAction({ action: "Link should be cleared" });
        }
        else {
            logClientAction({ action: `Link shouldn't be cleared  - current state is ${bState}` });
        }
    }).catch(error => {
        logClientAction({"action": "Error getting bState when click button permissions", "error": error.message});
    });

    logClientAction({ action: "Click permissions button" });
    chrome.runtime.sendMessage({
        action: "getPermissions",
        activateMediaTab: true
    });
    logClientAction({ action: "Send message", messageType: "getPermissions" });
});

buttonElements.upload.addEventListener('click', async () => {
    logClientAction({ action: "Click upload button" });

    const files = (await chrome.storage.local.get('tempFiles'))['tempFiles'];

    if (!files) {
        logClientAction({ action: "No files have found to upload" });
        buttonsStatesSave('needPermissions');
        updateButtonsStates();
    } else {
        logClientAction({ action: "Start uploading video" });
        uploadVideo(files)
        .then(() => {
            buttonsStatesSave('needPermissions');
            updateButtonsStates();
        })
        .catch(() => {
            buttonsStatesSave('failedUpload');
            updateButtonsStates();
        });
    }
});

async function startRecCallback() {
    logClientAction({ action: "Click start record button" });
    let allValid = true;
    Object.values(inputElements).forEach(input => {
        if (input !== inputElements.patronymic || !noPatronymicCheckbox.checked) {
            validateInput(input);
            const valueIsEmpty = !input.value.trim();
            const hasInvalidClass = input.classList.contains('input-invalid');

            if (valueIsEmpty) {
                allValid = false;

                // Если еще не была проверка на пустоту — пометить
                if (!input.dataset.emptyChecked) {
                    input.classList.add('input-invalid');
                    const rule = validationRules[input.id.replace('_input', '')];
                    input.nextElementSibling.textContent = rule.message;
                    input.nextElementSibling.classList.add('message-error');
                    input.dataset.emptyChecked = 'true';
                }
            } else if (hasInvalidClass) {
                allValid = false;
            }
        }
    });
    if (!allValid) {
        logClientAction({ action: "Block recording due to validation errors" });
        return;
    }

    buttonElements.start.setAttribute('disabled', '');
    buttonElements.stop.removeAttribute('disabled');
    saveInputValues();

    const now = new Date();
    startTime = now;
    updateStartDateDisplay(formatDateTime(now));

    updateRecordTimer();

    if (timerInterval) {
        clearInterval(timerInterval);
    }

    timerInterval = setInterval(updateRecordTimer, 1000);

    const formData = {
        group: inputElements.group.value,
        name: inputElements.name.value,
        surname: inputElements.surname.value,
        patronymic: noPatronymicCheckbox.checked ? "Без_отчества" : inputElements.patronymic.value.trim(),
        work_title: inputElements.work_title.value
    };

    chrome.runtime.sendMessage({
        action: "startRecord",
        formData: formData,
        activateMediaTab: false
    });
    logClientAction({ action: "Send message", messageType: "startRecord" });
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "disableButtons") {
        buttonElements.start.removeAttribute('disabled');
        buttonElements.stop.setAttribute('disabled', '');
        logClientAction({ action: "Receive message", messageType: "disableButtons" });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'stopRecordSignal') {
        console.log('Received stopRecordSignal');

        clearInterval(timerInterval);

        chrome.storage.local.get(['timeStr'], (result) => {
            const timeStr = result.timeStr;
            recordTime.textContent = timeStr;
            sendResponse({status: 'stopRecordSignalProcessed'});
        });

        sendResponse({status: 'stopRecordSignalProcessed'});
        return true;
    }
});

async function stopRecCallback() {
    logClientAction({ action: "Click stop record button" });
	buttonElements.stop.setAttribute('disabled', '');
	buttonElements.start.removeAttribute('disabled');
	await chrome.runtime.sendMessage({action: "stopRecord", activateMediaTab: false}, async (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error send stopRecord', chrome.runtime.lastError.message);
            logClientAction({ action: "Error send stopRecord", message: chrome.runtime.lastError.message});
        }
        else {
            updateInvalidStopValue(false);
        }
    });

    logClientAction({ action: "Send message", messageType: "stopRecord" });
}

buttonElements.start.addEventListener('click', startRecCallback);
buttonElements.stop.addEventListener('click', stopRecCallback);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateButtonStates') {
        chrome.storage.local.set({ bState: message.state }, () => {
            updateButtonsStates();
            sendResponse({ status: 'success' });
        });
        return true;
    }
    return false;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "closePopup") {
        window.close();
        logClientAction({ action: "Receive message", messageType: "updateButtonStates" });
    }
});

async function getSessionFormData(files, sessionId, extension_logs) {
    const formData = new FormData();
    const rootDirectory = await navigator.storage.getDirectory();

    for (const filename of files) {
        const blob = await (await rootDirectory.getFileHandle(filename, {create: false})).getFile();

        if (filename.includes('screen')) {
            formData.append('screen_video', blob, filename);
        } else {
            formData.append('camera_video', blob, filename);
        }
    }
    
    formData.append("id", sessionId);
    const metadata = (await chrome.storage.local.get('metadata'))['metadata'] || {};
    formData.append("metadata", JSON.stringify(metadata));

    // logClientAction({ action: "Prepare upload payload", sessionId: sessionId, fileNames: [combinedFileName, cameraFileName] });

    if (extension_logs) {
        let logs = prepareLogs(extension_logs);
        const logsBlob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        formData.append("logs", logsBlob, "extension_logs.json");
    }

    return formData;
}

async function saveFormDataFilesLocally(formData, sessionId) {
    for (const [key, value] of formData.entries()) {

        if (!(value instanceof Blob)) continue;

        let filename = null;

        if (key === "screen_video" || key === "camera_video") {
            filename = value.name;
        }

        else if (key === "logs") {
            filename = `extension_logs_${sessionId}_${getCurrentDateString(new Date())}.json`;
        }

        if (!filename) {
            filename = value.name || `${key}_${Date.now()}`;
        }

        await saveBlobToFile(value, filename);
        console.log(`Saved FormData file locally: ${filename}`);
    }
}

async function uploadFormDataToServer(formData, sessionId) {
    logClientAction({ action: "Send upload request", sessionId: sessionId, messageType: "upload_video" });

    const eventSource = new EventSource(`http://127.0.0.1:5000/progress/${sessionId}`);

    const steps = 7;

    eventSource.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.step == steps) {
            logClientAction({ action: "Data transfer completed" });
            eventSource.close();
            // TODO Fix notify showing #142, ибо если закрыть popup здесь ничего не произойдет
            await showModalNotify([`Статус: ${data.message}`,
                `Отправка завершена на 100 %`], "Записи успешно отправлены", true, true);
        } else {
            await showModalNotify([`Статус: ${data.message}`,
                `Отправка завершена на ${data.step * Math.floor(100 / steps)} %`], "Идёт отправка...", true, true);
        }
    };
    
    // Срабатывает когда не удаётся установить соединение с источником событий
    // TODO Наполнить err полезной информацией
    eventSource.onerror = async (err) => {
        logClientAction({ action: `An error occurred while trying to connect to the server: ${JSON.stringify(err)}` });
        eventSource.close();
        await showModalNotify([`Произошла ошибка при попытке соединения с сервером!`,
            "Попробуйте отправить запись ещё раз!",
            "Свяжитесь с преподавателем, если не удалось отправить три раза!",
        ], 'Ошибка при соединении', true, true);
    };

    try {
        const response = await fetch('http://127.0.0.1:5000/upload_video', {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Ошибка при загрузке видео: ${response.status}`);
        }

        const result = await response.json();
        console.log("Видео успешно отправлено:", result);

        logClientAction({ action: "Upload video succeeds", sessionId });

        return true;
    } catch (error) {
        console.error("Ошибка при отправке видео:", error);

        buttonsStatesSave('failedUpload');
        updateButtonsStates();

        logClientAction({ action: "Upload video fails", error: error.message, sessionId });

        return false;
    }
}

async function uploadVideo(files) {
    chrome.storage.local.get(['sessionId', 'extension_logs'], async ({ sessionId, extension_logs }) => {
        if (!sessionId) {
            console.error("Session ID не найден в хранилище");
            logClientAction({ action: `Upload fails due to missing session ID ${sessionId}` });
            return;
        }

        console.log(files);
        if (!files.length) {
            logClientAction("Ошибка при поиске записей");
            throw new Error(`Ошибка при поиске записей`);
        }

        const formData = await getSessionFormData(files, sessionId, extension_logs);

        let success = true;

        if (session_settings.local_video_saving) {
            await saveFormDataFilesLocally(formData, sessionId);
        }

        if (session_settings.server_connection) {
            let res = await uploadFormDataToServer(formData, sessionId);
            success &= res;
        }
        
        if (success) {
            await updateInvalidStopValue(false);
            await chrome.storage.local.set({ 'sessionId': null });

            await deleteFiles();
            await clearLogs();
            logClientAction({ action: "Clear logs after upload video" });

            await chrome.storage.local.remove("metadata");
            await chrome.storage.local.set({"session_status" : "need_init"});

            inputElements.work_title.value = "";
            inputElements.work_title.classList.remove('input-valid', 'input-invalid');
            await saveInputValues();
            logClientAction("Clear work title field");
        }
    });
}