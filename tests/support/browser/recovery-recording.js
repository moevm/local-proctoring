import { recordSyntheticVideo } from './synthetic-video.js';

export const RECOVERY_SESSION_ID = '123456789012345678901234';
export const RECOVERY_FILE = 'proctoring_screen_test.webm';

/** Pre-existing real WebM plus a server session. Calls the production upload module in Chrome. */
export class RecoveryRecording {
  constructor(app, api, session, video) {
    this.app = app;
    this.api = api;
    this.session = session;
    this.video = video;
    this.page = session.controlPage;
    this.fileName = RECOVERY_FILE;
  }

  static async create(app, api, session) {
    const video = await session.controlPage.evaluate(recordSyntheticVideo);
    const recording = new RecoveryRecording(app, api, session, video);
    api.createSession({ id: RECOVERY_SESSION_ID });
    await recording.addFile(RECOVERY_FILE);
    await app.storage.set({
      sessionId: RECOVERY_SESSION_ID,
      tempFiles: [RECOVERY_FILE],
      metadata: { recording_sessions: [], no_stream_confirm: { camera: true } },
      session_status: 'in_progress',
    });
    return recording;
  }

  addFile(name, { indexed = false } = {}) {
    return this.page.evaluate(
      async ({ name, bytes, indexed }) => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(name, { create: true });
        const writer = await handle.createWritable();
        await writer.write(new Uint8Array(bytes));
        await writer.close();
        if (indexed) {
          const { tempFiles = [] } = await chrome.storage.local.get('tempFiles');
          await chrome.storage.local.set({ tempFiles: [...tempFiles, name] });
        }
      },
      { name, bytes: this.video, indexed },
    );
  }

  removeFile(name) {
    return this.page.evaluate(
      async (name) => (await navigator.storage.getDirectory()).removeEntry(name),
      name,
    );
  }

  upload() {
    return this.page.evaluate(async (url) => {
      const client = await import('../scripts/upload.js');
      return client.uploadSession({
        server_connection: true,
        local_video_saving: false,
        server_url: url,
      });
    }, this.api.url);
  }

  attemptUpload() {
    return this.page.evaluate(async (url) => {
      const client = await import('../scripts/upload.js');
      try {
        await client.uploadSession({
          server_connection: true,
          local_video_saving: false,
          server_url: url,
        });
        return null;
      } catch (error) {
        return error.message;
      }
    }, this.api.url);
  }

  resumeError() {
    return this.page.evaluate(async () => {
      const client = await import('../scripts/upload.js');
      try {
        await client.assertCanResume();
        return '';
      } catch (error) {
        return error.message;
      }
    });
  }

  requestError(timeoutMs = 150) {
    return this.page.evaluate(
      async ({ url, timeoutMs }) => {
        const client = await import('../scripts/upload.js');
        try {
          await client.requestJSON(url, { timeoutMs });
          return '';
        } catch (error) {
          return error.message;
        }
      },
      { url: this.api.url + '/plugin_policy', timeoutMs },
    );
  }

  attemptRecorderStop() {
    return this.page.evaluate(async (name) => {
      const { attachRecorderWriter } = await import('../scripts/recorder-writer.js');
      const handle = await (await navigator.storage.getDirectory()).getFileHandle(name);
      const before = (await handle.getFile()).size;
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      canvas.getContext('2d').fillRect(0, 0, 160, 90);
      const stream = canvas.captureStream(10),
        recorder = new MediaRecorder(stream);
      const writer = attachRecorderWriter(recorder, () => handle);
      const drawing = setInterval(() => {
        const context = canvas.getContext('2d');
        context.fillStyle = context.fillStyle === '#008000' ? 'blue' : 'green';
        context.fillRect(0, 0, 160, 90);
      }, 20);
      try {
        const firstChunk = new Promise((resolve) =>
          recorder.addEventListener('dataavailable', resolve, { once: true }),
        );
        recorder.start(50);
        await firstChunk;
        let error;
        try {
          await writer.stop();
        } catch (failure) {
          error = failure.name;
        }
        return { error, before, after: (await handle.getFile()).size };
      } finally {
        clearInterval(drawing);
        stream.getTracks().forEach((track) => track.stop());
      }
    }, RECOVERY_FILE);
  }
}
