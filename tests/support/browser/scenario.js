import fs from 'node:fs/promises';
import { MANIFEST } from '../paths.js';
import { createMockProctoringApi } from '../../mocks/proctoring-api.js';
import { launchExtensionSession } from './session.js';
import { ExtensionStorage } from './storage.js';
import { PopupPage } from '../../pages/popup.js';
import { MediaPage } from '../../pages/media.js';
import { RecordingFlow } from '../../flows/recording.js';

export async function createBrowserScenario(directory, options = {}) {
  await fs.mkdir(directory, { recursive: true });
  const api = await createMockProctoringApi({ version: MANIFEST.version, directory });
  let session;
  try {
    session = await launchExtensionSession(directory, api, options);
    const app = {
      popup: new PopupPage(session),
      media: new MediaPage(session),
      storage: new ExtensionStorage(session.controlPage),
    };
    // All tests begin with an open popup, as when the user opens the extension.
    await app.popup.open();
    return {
      api,
      session,
      app,
      recording: new RecordingFlow(app),
      async close() {
        try {
          await session.close();
        } finally {
          await api.close();
        }
      },
    };
  } catch (error) {
    try {
      await session?.close();
    } finally {
      await api.close();
    }
    throw error;
  }
}
