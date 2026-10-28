import { test as browserTest } from './browser.js';
import { RecoveryRecording } from '../support/browser/recovery-recording.js';

export { expect } from './browser.js';
export const test = browserTest.extend({
  recovery: async ({ app, api, session }, use) => {
    await use(await RecoveryRecording.create(app, api, session));
  },
});
