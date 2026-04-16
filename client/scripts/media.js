import { showModalNotify, showModalConfirm, waitForNotificationSuppression, getBrowserFingerprint, generateObjectId, requestClearLogs, getDifferenceInTime, getFormattedDateString, getAvailableDiskSpace, saveBlobToFile } from './common.js';
import { getCurrentDateString, setReadyToUploadContainer, parseDateString } from "./common.js";
import { logClientAction, flushLogs, checkAndCleanLogs, prepareLogs } from './logger.js';

import settings from '../settings.json' with { type: "json" };

const video_settings = settings.video_settings;
const session_settings = settings.session_settings;

console.log(settings, video_settings)

var streams = {
    screen: null,
    microphone: null,
    camera: null,
    combined: null
};

var recorders = {
    combined: null,
    camera: null
};

var noStreamConfirm = {
    microphone: false,
    camera: false
}

var readyToUploadContainer = document.querySelector('.ready-to-upload-container');

var combinedPreview = document.querySelector('.combined__preview');
var cameraPreview = document.querySelector('.camera__preview');

var previewButton = document.getElementById('preview-toggle-btn');
var isRecording = false;
var isPreviewEnabled = false;

var combinedFileName = null;
var cameraFileName = null;
var combinedFileHandle = null;
var cameraFileHandle = null;
var forceTimeout = null;
var startTime = undefined;
var endTime = undefined;

var notifications_flag = true;
var invalidStop = undefined;
var bState = undefined;

async function need_init() {
    console.log((await chrome.storage.local.get("session_status"))["session_status"]);
    const session_status = (await chrome.storage.local.get("session_status"))["session_status"] || "need_init";
    return session_status === "need_init";
}

class Metadata {
    constructor() {
        this.metadata = this._templateMeta();
    }

    _templateMeta() {
        return {
            session_client_start: undefined,
            session_client_end: undefined,
            session_client_duration: undefined,
            screen: {
                session_client_mime: undefined,
                session_client_resolution: undefined,
                session_client_size: undefined // MB
            },
            camera: {
                session_client_mime: undefined,
                session_client_resolution: undefined,
                session_client_size: undefined // MB
            },
            recording_sessions: [],
        };
    }

    async useSaved() {
        this.metadata = (await chrome.storage.local.get("metadata"))["metadata"] || this._templateMeta();
    }

    setMetadatasRecordOn(startTime, streams, recorders) {
        if (this.metadata.recording_sessions.length == 0) {
            this.metadata.session_client_start = getCurrentDateString(startTime);

            this.metadata.screen.session_client_mime = recorders.combined.mimeType;
            const [screenVideoTrack] = streams.screen.getVideoTracks();
            const screenSettings = screenVideoTrack.getSettings();
            this.metadata.screen.session_client_resolution = `${screenSettings.width}×${screenSettings.height}`;

            if (recorders.camera) {
                this.metadata.camera.session_client_mime = recorders.camera.mimeType;
                const [cameraVideoTrack] = streams.camera.getVideoTracks();
                const cameraSettings = cameraVideoTrack.getSettings();
                this.metadata.camera.session_client_resolution = `${cameraSettings.width}×${cameraSettings.height}`;
            }
        }

        logClientAction({ action: "Set metadata record on" });
    };

    async setMetadatasRecordOff(endTime) {
        this.metadata.session_client_end = getCurrentDateString(endTime);
        startTime = parseDateString(this.metadata.session_client_start);
        this.metadata.session_client_duration = getDifferenceInTime(endTime, startTime);

        const screenFile = await combinedFileHandle.getFile();
        this.metadata.screen.session_client_size = (screenFile.size / 1000000).toFixed(3);
        if (cameraFileHandle){
            const cameraFile = await cameraFileHandle.getFile();
            this.metadata.camera.session_client_size = (cameraFile.size / 1000000).toFixed(3);
        }

        logClientAction({ action: "Set metadata record off" });
    };

    appendRecordingSession(recordingStart, recordingEnd) {
        this.metadata.recording_sessions.push([getCurrentDateString(new Date(recordingStart)), getCurrentDateString(new Date(recordingEnd))]);
    }

    async save() {
        await chrome.storage.local.set({"metadata": this.metadata});
    }
}

var metadata = undefined;

combinedPreview.addEventListener('contextmenu', e => e.preventDefault(), {capture: true});

const stopStreams = () => {
    Object.entries(streams).forEach(([stream, value]) => {
        if (value) {
            value.getTracks().forEach(track => track.stop());
            streams[stream] = null;
        }
    });
    logClientAction({ action: "Stop streams" });
};

const stopStream = (stream) => {
    const value = streams[stream];
    if (value) {
        value.getTracks().forEach(track => track.stop());
        streams[stream] = null;
    }
    logClientAction({ action: `Stop stream ${stream}` });
};

async function checkOpenedPopup() {
    let a = await chrome.runtime.getContexts({contextTypes: ['POPUP']});
    const isPopupOpen = a.length > 0;
    logClientAction({ action: "Check if popup is open", popupOpen: isPopupOpen.toString() });
    return isPopupOpen;
}

function updateMicFill(level) {
    const fill = document.querySelector('.mic-fill');
    if (!fill) return;
    const boosted = Math.sqrt(level * 16); // коэффициент отвечающий за чувствительность
    const clamped = Math.min(1, Math.max(0, boosted));
    const percent = (1 - clamped) * 100;
    fill.style.transform = `translateY(${percent}%)`;
}

async function sendButtonsStates(state) {
    if (state === 'readyToUpload' && (!session_settings.server_connection && !session_settings.local_video_saving)) {
        state = 'needPermissions';
        logClientAction({ action: "Update buttons states due to missing server connection" });
    }
    if (await checkOpenedPopup()) chrome.runtime.sendMessage({action: 'updateButtonStates', state: state}, (response) => {
        if (chrome.runtime.lastError) {
            logClientAction(`Message with state: ${state} failed. Error: ${chrome.runtime.lastError.message}`);
            buttonsStatesSave(state);
        } else {
            if (!response || !response.hasOwnProperty('status') || response.status !== 'success') {
                buttonsStatesSave(state);
            }
            logClientAction(`Message with state: ${state} sent successfully`);
        }
    });
    else {
        buttonsStatesSave(state);
        logClientAction(`sendButtonsStates ${state} else`);
    }
}

async function updateInvalidStopValue(flag) {
    invalidStop = flag;
    await chrome.storage.local.set({ 'invalidStop': flag });
}

async function buttonsStatesSave(state) {
    bState = state;
    localStorage.setItem("bState", bState); // для восстановления данных
	await chrome.storage.local.set({'bState': state});

    logClientAction({ action: "Save buttons states"});
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes.invalidStop) {
        invalidStop = changes.invalidStop.newValue;
        logClientAction({ action: "Update invalidStop value", invalidStop: invalidStop.toString() });
    }
});

function createScreenMediaRecorder() {
    return new MediaRecorder(
        streams.combined, 
        {
            mimeType: video_settings.screen.mime_type,
            audioBitsPerSecond: video_settings.screen.audio_bits_per_second,
            videoBitsPerSecond: video_settings.screen.video_bits_per_second,
        }
    );
}

function createCameraMediaRecorder() {
    return new MediaRecorder(
        streams.camera, 
        {
            mimeType: video_settings.camera.mime_type,
            videoBitsPerSecond: video_settings.camera.video_bits_per_second,
        }
    );
}

function createScreenFileName(id) {
    return `proctoring_screen_${id}.${video_settings.screen.file_extention}`
}

function createCameraFileName(id) {
    return `proctoring_camera_${id}.${video_settings.camera.file_extention}`
}

async function getMediaDevices() {
    return new Promise(async (resolve, reject) => {
        let streamLossSource = null;
        try {
            logClientAction({ action: "Request screen media" });
            await showModalNotify(["Пожалуйста, предоставьте доступ к экрану, микрофону и камере. " +
                        "Не отключайте эти разрешения до окончания записи. " +
                        "Это необходимо для корректной работы системы прокторинга."],
                        "Разрешения для прокторинга");
            chrome.desktopCapture.chooseDesktopMedia(['screen'], async (streamId) => {
                if (!streamId) {
                    logClientAction({ action: "User cancels screen selection" });
                    console.error('Пользователь отменил выбор экрана');
                    reject('Пользователь отменил выбор экрана');
                    await showModalNotify(["Пользователь отменил выбор экрана!", "Выдайте заново разрешения в расширении во всплывающем окне по кнопке Разрешения."], "Ошибка");
                    return;
                }

                try {
                    logClientAction({ action: "User grants screen access" });

                    streams.screen = await navigator.mediaDevices.getUserMedia({
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: streamId,
                                width: { 
                                    ideal: video_settings.screen.width.ideal, 
                                    max: Math.min(video_settings.screen.width.max, screen.width),
                                    min: Math.min(video_settings.screen.width.min, screen.width)
                                },
                                height: { 
                                    ideal: video_settings.screen.height.ideal,
                                    max: Math.min(video_settings.screen.height.max, screen.height),
                                    min: Math.min(video_settings.screen.height.min, screen.height)
                                },
                                frameRate: { 
                                    ideal: video_settings.screen.frameRate.ideal,
                                    max: video_settings.screen.frameRate.max,
                                    min: video_settings.screen.frameRate.min
                                }
                            }
                        },
                    });

                    if (!streams.screen || streams.screen.getVideoTracks().length === 0) {
                        logClientAction({ action: "Screen stream not available" });
                        throw new Error('Не удалось получить видеопоток с экрана');
                    }

                    chrome.runtime.sendMessage({ type: 'screenCaptureStatus', active: true });

                    let micPermissionDenied = false;
                    let camPermissionDenied = false;

                    try {
                        streams.microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
                        logClientAction({ action: "User grants microphone access" });
                    } catch (micError) {
                        if (micError.name === 'NotAllowedError') {
                            micPermissionDenied = true;
                            logClientAction({ action: "Microphone permission denied", error: "NotAllowedError" });
                            //await showModalNotify("Ошибка при доступе к микрофону: NotAllowedError", "Ошибка");
                        } else {
                            logClientAction({ action: "Microphone permission denied" });
                            //await showModalNotify('Ошибка при доступе к микрофону: ' + micError.message, "Ошибка");
                        }
                        let userAnswer = await showModalConfirm("При доступе к микрофону возникла ошибка, хотите продолжить без него?")
                        if (userAnswer) {
                            noStreamConfirm.microphone = true;
                            logClientAction({ action: "User've confirm work without a microphone" })
                            await showModalNotify("Запись будет осуществлена без микрофона.");
                            stopStream('microphone');
                        }
                        else {
                            stopStreams();
                            reject(micError);
                        }

                    }

                    if (!micPermissionDenied) {
                        const audioCtx = new AudioContext();
                        const micSourceNode = audioCtx.createMediaStreamSource(streams.microphone);
                        const analyser = audioCtx.createAnalyser();
                        analyser.fftSize = 256;
                        micSourceNode.connect(analyser);

                        const dataArray = new Uint8Array(analyser.frequencyBinCount);
                        const micIcon = document.getElementById('mic-fill');

                        function updateMicFillLoop() {
                            analyser.getByteTimeDomainData(dataArray);

                            let sum = 0;
                            for (let i = 0; i < dataArray.length; i++) {
                                const v = dataArray[i] / 128 - 1;
                                sum += v * v;
                            }
                            const rms = Math.sqrt(sum / dataArray.length);

                            updateMicFill(rms);

                            requestAnimationFrame(updateMicFillLoop);
                        }

                        requestAnimationFrame(updateMicFillLoop);
                    }

                    try {
                        streams.camera = await navigator.mediaDevices.getUserMedia({ 
                            video: {
                                width: { ideal: video_settings.camera.width.ideal },
                                height: { ideal: video_settings.camera.height.ideal },
                                frameRate: { 
                                    ideal: video_settings.camera.frameRate.ideal,
                                    max: video_settings.camera.frameRate.max,
                                    min: video_settings.camera.frameRate.min 
                                }
                            }, 
                            audio: false 
                        });
                        logClientAction({ action: "User grants camera access" });
                    } catch (camError) {
                        if (camError.name === 'NotAllowedError') {
                            logClientAction({ action: "Camera permission denied", error: "NotAllowedError" });
                            //await showModalNotify("Ошибка при доступе к камере: NotAllowedError", "Ошибка");
                            camPermissionDenied = true;
                        } else {
                            logClientAction({ action: "Camera permission denied" });
                            //await showModalNotify('Ошибка при доступе к камере: ' + camError.message, "Ошибка");
                        }

                        let userAnswer = await showModalConfirm("При доступе к камере возникла ошибка, хотите продолжить без неё?")
                        if (userAnswer) {
                            noStreamConfirm.camera = true;
                            logClientAction({ action: "User've confirm work without a camera" })
                            await showModalNotify("Запись будет осуществлена без камеры.");
                            stopStream('camera');
                        }
                        else {
                            stopStreams();
                            reject(camError);
                        }
                    }

                    if ((!noStreamConfirm.microphone && !noStreamConfirm.camera) && (micPermissionDenied || camPermissionDenied)) {
                        stopStreams();
                        const extensionId = chrome.runtime.id;
                        const settingsUrl = `chrome://settings/content/siteDetails?site=chrome-extension://${extensionId}`;

                        logClientAction({ action: "Prompt permission settings" });

                        await showModalNotify(['Не предоставлен доступ к камере или микрофону.',
                            'Сейчас откроется вкладка с настройками доступа для этого расширения.',
                            'Пожалуйста, убедитесь, что камера и микрофон разрешены, а затем нажмите во всплывающем окне расширения кнопку Разрешения.']);

                        const mediaExtensionUrl = chrome.runtime.getURL("pages/media.html");

                        // Закрытие вкладки media.html c открытием вкладки с настройками разрешений расширения
                        chrome.runtime.sendMessage({
                            action: 'closeTabAndOpenTab',
                            mediaExtensionUrl: mediaExtensionUrl,
                            settingsUrl: settingsUrl
                        });

                        logClientAction({ action: "Redirect to permission settings" });
                        reject('Доступ к устройствам не предоставлен');
                        return;
                    }

                    // Обработка потери доступа
                    if (streams.camera) {
                        streams.camera.oninactive = async function () {
                            if (streamLossSource) return;
                            streamLossSource = 'camera';
                            logClientAction('Camera stream inactive');

                            if (!recorders.combined && !recorders.camera) return;

                            if (recorders.combined.state === 'inactive' && recorders.camera.state === 'inactive') {
                                await sendButtonsStates('needPermissions');
                                await showModalNotify(["Разрешение на камеру отозвано.",
                                    "Дайте доступ заново в расширении во всплывающем окне по кнопке Разрешения."], "Доступ к камере потерян!");
                                stopStreams();
                            } else {
                                stopDuration(startTime);
                                await sendButtonsStates('failedUpload');
                                await showModalNotify(["Текущие записи завершатся. Чтобы продолжить запись заново, выдайте разрешения во всплывающем окне по кнопке Разрешения и начните запись."], "Доступ к камере потерян!");
                                // updateInvalidStopValue(true);
                                stopRecord();
                            }
                        };
                    }

                    streams.screen.getVideoTracks()[0].onended = async function () {
                        chrome.runtime.sendMessage({ type: 'screenCaptureStatus', active: false });
                        if (streamLossSource) return;
                        streamLossSource = 'screen';
                        logClientAction('Screen stream ended');

                        if (!recorders.combined || recorders.combined.state === 'inactive') {
                            await sendButtonsStates('needPermissions');
                            await showModalNotify(["Разрешение на захват экрана отозвано.", 
                                "Дайте доступ заново в расширении во всплывающем окне по кнопке Разрешения."], "Доступ к экрану потерян!");
                            stopStreams();
                        } else {
                            stopDuration(startTime);
                            await sendButtonsStates('failedUpload');
                            await showModalNotify(["Текущие записи завершатся. Чтобы продолжить запись заново, выдайте разрешения в расширении во всплывающем окне по кнопке Разрешения и начните запись."], "Доступ к экрану потерян!");
                            // updateInvalidStopValue(true);
                            stopRecord();
                        }
                    };

                    let combinedStreams = [streams.screen.getVideoTracks()[0]]

                    if (streams.microphone) {
                        streams.microphone.getAudioTracks()[0].onended = async function () {
                            if (streamLossSource) return;
                            streamLossSource = 'microphone';
                            logClientAction('Microphone stream ended');

                            if (!recorders.combined || recorders.combined.state === 'inactive') {
                                await sendButtonsStates('needPermissions');
                                await showModalNotify(["Разрешение на микрофон отозвано.",
                                    "Дайте доступ заново в расширении во всплывающем окне по кнопке Разрешения."], "Доступ к микрофону потерян!");
                                stopStreams();
                            } else {
                                stopDuration(startTime);
                                await sendButtonsStates('failedUpload');
                                await showModalNotify(["Текущие записи завершатся. Чтобы продолжить запись заново, выдайте разрешения в расширении во всплывающем окне по кнопке Разрешения и начните запись."], "Доступ к микрофону потерян!");
                                // updateInvalidStopValue(true);
                                stopRecord();
                            }
                        };
                        combinedStreams.push(streams.microphone.getAudioTracks()[0])
                    }

                    streams.combined = new MediaStream(combinedStreams);

                    combinedPreview.srcObject = streams.combined;
                    cameraPreview.srcObject = streams.camera;

                    combinedPreview.onloadedmetadata = function () {
                        combinedPreview.width = combinedPreview.videoWidth > 1280 ? 1280 : combinedPreview.videoWidth;
                        combinedPreview.height = combinedPreview.videoHeight > 720 ? 720 : combinedPreview.videoHeight;
                    };

                    cameraPreview.onloadedmetadata = function () {
                        cameraPreview.width = 320;
                        cameraPreview.height = 240;
                    };

                    cameraPreview.style.display =  streams.camera ? 'block' : 'none';
                    combinedPreview.style.display = 'block';

                    combinedPreview.muted = false;

                    recorders.combined = createScreenMediaRecorder();

                    logClientAction({ action: "Create combined recorder" });
                    
                    recorders.camera = streams.camera ? createCameraMediaRecorder() : null;

                    logClientAction({ action: "Create camera recorder" });

                    // записывать время последней записи
                    recorders.combined.ondataavailable = async (event) => {
                        if (event.data.size > 0) {
                            const combinedWritableStream =  await combinedFileHandle.createWritable({ keepExistingData: true });

                            const file = await combinedFileHandle.getFile();
                            const size = file.size;

                            console.log("combinedFileHandle", size);

                            await combinedWritableStream.write({
                                type: "write",
                                position: size,
                                data: event.data
                            });

                            await combinedWritableStream.close();

                            await chrome.storage.local.set({"recording_end": (new Date()).toISOString()});
                        }
                    };

                    if (recorders.camera)
                            recorders.camera.ondataavailable = async (event) => {
                            if (event.data.size > 0) {
                                const cameraWritableStream =  await cameraFileHandle.createWritable({ keepExistingData: true });

                                const file = await cameraFileHandle.getFile();
                                const size = file.size;

                                console.log("cameraFileHandle", size);

                                await cameraWritableStream.write({
                                    type: "write",
                                    position: size,
                                    data: event.data
                                });

                                await cameraWritableStream.close();

                                await chrome.storage.local.set({"recording_end": (new Date()).toISOString()});
                            }
                        };

                    resolve();
                } catch (error) {
                    logClientAction({ action: "Error during screen capture setup", error: error.message });
                    stopStreams();
                    reject(error);
                }
            });
        } catch (error) {
            logClientAction({ action: "General error in getMediaDevices", error: error.message });
            reject(error);
        }
    });
}

function hideMutePreviews() {
    cameraPreview.style.display = 'none';
    combinedPreview.style.display = 'none';
    combinedPreview.muted = true;

    logClientAction({ action: "Hide and mute previews" });
}

previewButton.addEventListener('click', () => {
    if (!isRecording) {
        logClientAction({ action: "Ignore preview toggle click - not recording" });
        return;
    }

    combinedPreview.muted = true;

    isPreviewEnabled = !isPreviewEnabled;

    const displayValue = isPreviewEnabled ? 'block' : 'none';
    cameraPreview.style.display = displayValue;
    combinedPreview.style.display = displayValue;

    logClientAction(isPreviewEnabled ? { action: "Enable preview mode" } : { action: "Disable preview mode" });

    updatePreviewButton();
});

function updatePreviewButton() {
    if (!isRecording) {
        previewButton.disabled = true;
        previewButton.textContent = 'Включить';
        previewButton.classList.remove('enabled', 'disabled');
        logClientAction({ action: "Update preview button - not recording" });
        return;
    }

    previewButton.disabled = false;
    previewButton.textContent = isPreviewEnabled ? 'Выключить' : 'Включить';
    previewButton.classList.toggle('enabled', !isPreviewEnabled);
    previewButton.classList.toggle('disabled', isPreviewEnabled);

    logClientAction({ action: "Update preview button", previewEnabled: isPreviewEnabled.toString() });
}

async function cleanup() {
    if (forceTimeout) clearTimeout(forceTimeout);
    stopStreams();
    combinedPreview.srcObject = null;
    cameraPreview.srcObject = null;
    recorders.combined = null;
    recorders.camera = null;
    console.log('Все потоки и запись остановлены.');
    logClientAction({ action: "Complete cleanup" });
}

async function addFileToTempList(fileName) {
    const tempFiles = (await chrome.storage.local.get('tempFiles'))['tempFiles'] || [];
    if (!tempFiles.includes(fileName)) {
        logClientAction({ action: "Add file to temp list", fileName });
        const updatedFiles = [ ...tempFiles, fileName ];
        return (await chrome.storage.local.set({ 'tempFiles': updatedFiles }));
    } else {
        logClientAction({ action: "File already exists in temp list", fileName });
    }
}

// системное ограничение браузера позволяет выводить пользовательское уведомление только после алерта (в целях безопасности)
const beforeUnloadHandler = (event) => {
    logClientAction({ action: "Trigger beforeunload warning" });
    showModalNotify(["Не закрывайте вкладку расширения при записи!", 
        "Не обновляйте вкладку расширения при записи!",
        "Не закрывайте браузер при записи!", 
        "При закрытии или обновлении вкладки расширения (речь не о всплывающем окне расширения), а также закрытии самого браузера запись будет прервана!"], "Внимание!");
    event.preventDefault();
    event.returnValue = true;
};

window.addEventListener('beforeunload', beforeUnloadHandler);

window.addEventListener('unload', () => {
    if (recorders.camera || recorders.screen) {
        if (bState == 'readyUpload' || bState == 'failedUpload') {
            logClientAction({ action: `Tab media.html unload - but current state is ${bState}` });
        }
    }
    else {
        buttonsStatesSave('needPermissions');
    }

    if (bState == 'readyToRecord') {
        buttonsStatesSave('needPermissions');
    }

    logClientAction({ action: `Tab media.html unload - current state is ${bState}` });
})

window.addEventListener('load', async () => {
    console.log(await need_init());
    logClientAction({ action: "Load media.html tab" });

    await buttonsStatesSave(localStorage.getItem("bState"));
    await updateInvalidStopValue(bState === "recording");

    if ((bState == 'readyToRecord' || bState == 'needPermissions') && (await need_init())) {
        await buttonsStatesSave('needPermissions');
    }
    else {
        await buttonsStatesSave('failedUpload');
    }

    await sendButtonsStates(bState);

    logClientAction({ action: `Tab media.html load - current state is ${bState}` });

    const tempFiles = (await chrome.storage.local.get('tempFiles'))['tempFiles'] || [];
    setReadyToUploadContainer(readyToUploadContainer, tempFiles);

    if (invalidStop) {
        metadata = new Metadata();
        await metadata.useSaved();
        const recordingStart = (await chrome.storage.local.get("recording_start"))["recording_start"];
        const recordingEnd = (await chrome.storage.local.get("recording_end"))["recording_end"];
        metadata.appendRecordingSession(recordingStart, recordingEnd);
        metadata.save();

        console.log("invalid_stop:", metadata.metadata);
        console.log(tempFiles);

        await updateInvalidStopValue(false);
    }
});

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.action === 'stopRecording') {
        logClientAction({ action: "Receive message", messageType: "stopRecording" });
        if (recorders.combined || recorders.camera) {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            stopRecord();
            await sendButtonsStates('readyToUpload');
        }
    }
    else if (message.action === 'getPermissionsMedia') {
        logClientAction({ action: "Receive message", messageType: "getPermissionsMedia" });
        getMediaDevices()
        .then(async () => {
            logClientAction({ action: "Get media devices success" });
            await sendButtonsStates('readyToRecord');
            await showModalNotify(["Разрешения получены. Теперь вы можете начать запись.",
                "Нажмите на кнопку «Начать запись» во всплывающем окне " +
                "расширения прокторинга, когда будете готовы.",
                "",
                "Для удобства уведомление о доступе к вашему экрану можно скрыть или передвинуть. НЕЛЬЗЯ НАЖИМАТЬ НА «Закрыть доступ».",
                "НЕЛЬЗЯ ОБНОВЛЯТЬ, ЗАКРЫВАТЬ СЛУЖЕБНУЮ ВКЛАДКУ во время записи! НЕЛЬЗЯ ЗАКРЫВАТЬ БРАУЗЕР во время записи!",
                "Предпросмотр будет отключен. Его можно включить по кнопке на служебной вкладке расширения. По умолчанию звук выключен и включается в плеере.",
,],
                "Готово к записи");
        })
        .catch(async () => {
            logClientAction({ action: "Get media devices failed" });
            await sendButtonsStates('needPermissions');
        });
    }
    else if (message.action === 'startRecording') {
        if (await need_init()) await checkAndCleanLogs();

        logClientAction({ action: "Receive message", messageType: "startRecording" });

        const formData = new FormData();
        formData.append('group', message.formData.group || '');
        formData.append('name', message.formData.name || '');
        formData.append('surname', message.formData.surname || '');
        formData.append('patronymic', message.formData.patronymic || '');
        formData.append('work_title', message.formData.work_title || '');

        function formDataToObject(formData) {
            const obj = {};
            for (const [key, value] of formData.entries()) {
                obj[key] = value;
            }
            return obj;
        }

        logClientAction({
            action: "Receive startRecording formData",
            formData: formDataToObject(formData),
        });

        if (await need_init()) {
            if (session_settings.server_connection) {
                await initSession(formData);
            } else {
                getBrowserFingerprint();

                await chrome.storage.local.set({ 'lastRecordTime': new Date().toISOString() });

                const sessionId = generateObjectId();
                await chrome.storage.local.set({ 'sessionId': sessionId });
                logClientAction({ action: "Generate session ID locally", sessionId });
            }
        }

        startRecord()
        .then(async () => {
            logClientAction({ action: "Start recording succeeds" });
            await sendButtonsStates('recording');
            // После остановки записи ждём либо подтверждения подавления, либо, по истечении таймаута, выполняем уведомление
            waitForNotificationSuppression().then(async (suppress) => {
                if (!suppress) {
                    await showModalNotify(
                        ["Запись экрана, микрофона и камеры началась. " +
                        "Во всплывающем окне разрешения доступна информация о времени начала записи и её продолжительности.",
                        "Не отключайте разрешения этим элементам до окончания записи.",
                        "Чтобы завершить запись, нажмите кнопку «Остановить запись» во всплывающем окне расширения прокторинга."],
                        "Идёт запись",
                        true
                    );
                }
            });
        })
        .catch(async (error) => {
            // В startRecord есть свой обработчик ошибок
            await sendButtonsStates('needPermissions');
            await showModalNotify(["Ошибка при запуске записи:", error], "Ошибка");
        });
    }
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.action === 'suppressModalNotifyAT') {
        notifications_flag = false;
        console.log('notifications_flag = ', notifications_flag);
        logClientAction(`notifications_flag = ${notifications_flag}`)
    }
});

async function initSession(formData) {
    getBrowserFingerprint()

    try {
        const response = await fetch('http://127.0.0.1:5000/start_session', {
            method: 'POST',
            mode: 'cors',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Сервер вернул ${response.status}`);
        }

        const result = await response.json();
        const sessionId = result.id;

        await chrome.storage.local.set({ 'sessionId': sessionId });

        console.log('sessionId успешно сохранён!');
        logClientAction({ action: "Save session ID from server", sessionId });

        await chrome.storage.local.set({
            'lastRecordTime': new Date().toISOString()
        });
    } catch (error) {
        console.error("Ошибка инициализации сессии", error);
        await showModalNotify(["Ошибка инициализации сессии", error.message], "Ошибка")
        logClientAction({ action: "Session initialization failed", error: error.message });
        throw error;
    }
}

function stopDuration(startTime) {
    const durationMs = new Date() - startTime;

    const seconds = Math.floor((durationMs / 1000) % 60);
    const minutes = Math.floor((durationMs / 1000 / 60) % 60);
    const hours = Math.floor(durationMs / 1000 / 60 / 60);

    const timeStr = `${hours.toString().padStart(2, '0')}:` +
        `${minutes.toString().padStart(2, '0')}:` +
        `${seconds.toString().padStart(2, '0')}`;

    chrome.storage.local.set({
        'timeStr': timeStr
    }, function() {
        console.log('timeStr saved to storage');
        logClientAction("stopDuration timeStr saved to storage");
    });

    chrome.runtime.sendMessage({type: 'stopRecordSignal'}, function(response) {
        console.log('stopRecordSignal sent');
        logClientAction("stopDuration stopRecordSignal sent");
    });
}

async function stopRecord() {
    // TODO
    if (!invalidStop) stopDuration(startTime);
    chrome.runtime.sendMessage({ type: 'screenCaptureStatus', active: false });
  
    isRecording = false;
    isPreviewEnabled = false;
    hideMutePreviews();
    updatePreviewButton();

    endTime = new Date();

    console.log(metadata)

    await metadata.setMetadatasRecordOff(endTime);

    let combinedFileSize = 0;
    let cameraFileSize = 0;
    
    try {
        if (recorders.combined) {
            const file = await combinedFileHandle.getFile();
            combinedFileSize = file.size;

            if (recorders.combined.state !== 'inactive') {
                recorders.combined.stop();
            }
        }

        if (recorders.camera) {
            const file = await cameraFileHandle.getFile();
            cameraFileSize = file.size;

            if (recorders.camera.state !== 'inactive') {
                recorders.camera.stop();
            }
        }

        metadata.appendRecordingSession(startTime, endTime);
        await metadata.save();

        const tempFiles = (await chrome.storage.local.get('tempFiles'))['tempFiles'] || [];
        setReadyToUploadContainer(readyToUploadContainer, tempFiles);

        console.log("stop_record:", metadata.metadata);

        await buttonsStatesSave('failedUpload');
        await sendButtonsStates('failedUpload');

        logClientAction({ action: "Recording stopped and files saved" });

        const duration = getDifferenceInTime(endTime, startTime);

        const stats = [
            `Начало записи: ${getFormattedDateString(startTime)}`,
            `Конец записи: ${getFormattedDateString(endTime)}`,
            `Длительность записи: ${duration}`,
        ];
        logClientAction(stats);

        cleanup();

        await showModalNotify(
            stats,
            "Запись завершена, статистика:",
            true
        );

        if (session_settings.server_connection || session_settings.local_video_saving) {
            await showModalNotify(
                ["Для скачивания записи необходимо нажать кнопку «Сохранить» во всплывающем окне расширения прокторинга."],
                "Отправка записи",
                true
            );
        }
    } catch (error) {
        console.error("Ошибка при остановке записи:", error);
        logClientAction({ action: "Fail to stop recording", error: error.message });
        cleanup();
    };

    await delay(500);
    await flushLogs();
    await delay(100);

    logClientAction('Recording stopping');
}

async function startRecord() {
    if (getAvailableDiskSpace() < 2600000000) {
        console.log('На диске недостаточно места!');
        logClientAction({ action: "Fail to start recording", reason: "Insufficient disk space" });
        return;
    }
    if (!combinedPreview.srcObject) {
        console.log('Выдайте разрешения к экрану');
        logClientAction({ action: "Fail to start recording", reason: "Missing media permission for screen" });
        return;
    }

    if (!noStreamConfirm.camera && !cameraPreview.srcObject) {
        console.log('Выдайте разрешения на камеру');
        logClientAction({ action: "Fail to start recording", reason: "Missing media permission for camera" });
        return;
    }

    const rootDirectory = await navigator.storage.getDirectory();
    logClientAction({ action: "Access root directory" });

    startTime = new Date();
    await chrome.storage.local.set({"recording_start": startTime.toISOString()});

    let startRecordTime = getCurrentDateString(startTime);

    combinedFileName = createScreenFileName(startRecordTime);
    await addFileToTempList(combinedFileName);

    cameraFileName = null;
    if (cameraPreview.srcObject) {
        cameraFileName = createCameraFileName(startRecordTime);
        await addFileToTempList(cameraFileName);
    }

    try {
        combinedFileHandle = await rootDirectory.getFileHandle(combinedFileName, {create: true});
        logClientAction({ action: "Create file handle", fileType: "screen", fileName: combinedFileName });

        cameraFileHandle = null;
        if (cameraPreview.srcObject) {
            cameraFileHandle = await rootDirectory.getFileHandle(cameraFileName, {create: true});
            logClientAction({ action: "Create file handle", fileType: "camera", fileName: cameraFileName });
        }
        logClientAction('Files added to temp list');

        chrome.storage.local.set({
            'fileNames': {
                screen: combinedFileName,
                camera: cameraFileName
            }
        });
        logClientAction({ action: "Save fileNames to storage" });

        await chrome.runtime.sendMessage({
            action: 'scheduleCleanup',
            delayMinutes: 245
        });
        logClientAction({ action: "Send message", messageType: "scheduleCleanup" });

        forceTimeout = setTimeout(() => {
            console.log('Запись принудительно завершена спустя 4 часа!');
            stopRecord();
            logClientAction({ action: "Force stop recording after 4 hours" });
        }, 14400000);
        
        // startTime = new Date();
        recorders.combined.start(video_settings.video_saving_interval);
        if (recorders.camera)
            recorders.camera.start(video_settings.video_saving_interval);

        isRecording = true;
        isPreviewEnabled = false;
        hideMutePreviews();
        updatePreviewButton();

        console.log('Запись начата');
        logClientAction('recording_started');
        //chrome.runtime.sendMessage({ action: "closePopup" });

        window._debug = { combinedFileHandle, cameraFileHandle, recorders };
    } catch (error) {
        console.error('Ошибка при запуске записи:', error.message);
        logClientAction({ action: "Fail to start recording", error: error.message });
        cleanup();
        // Есть внешний обработчик ошибок
        // showVisualCue(["Ошибка при запуске записи:", error], "Ошибка");
        // await sendButtonsStates('needPermissions');
        throw error;
    }
    
    metadata = new Metadata();

    if (await need_init()) {
        metadata.setMetadatasRecordOn(startTime, streams, recorders);
        await metadata.save();
        await chrome.storage.local.set({"session_status": "in_progress"});
    } else {
        await metadata.useSaved();
    }

    console.log("start_record:", metadata.metadata);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadLogs(fileName) {
    const { extension_logs } = await chrome.storage.local.get('extension_logs');
    let logsToSave = [];

    if (extension_logs) {
        logsToSave = prepareLogs(extension_logs);
    }

    const logsBlob = new Blob([JSON.stringify(logsToSave, null, 2)], { type: 'application/json' });
    
    await saveBlobToFile(logsBlob, fileName);

    await requestClearLogs();
}

async function showModalNotifyMedia(messages, title) {
    return new Promise((resolve) => {
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
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'showModalNotifyOnMedia') {
        showModalNotifyMedia(message.messages, message.title).then(() => {
            sendResponse({ confirmed: true });
        });
        return true;
    }
});