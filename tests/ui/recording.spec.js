import { probeMedia } from '../support/browser/media-probe.js';
import { test, expect } from '../fixtures/browser.js';
test('four-hour stop deadline invokes normal finalization without deleting video', async ({
  app,
  recording,
}) => {
  await recording.grantPermissions();
  await recording.start();
  const before = await app.storage.files();
  await app.media.fireStopDeadline();
  await recording.waitForStopped();
  const after = await app.storage.files();
  expect(after.map((file) => file.name)).toEqual(before.map((file) => file.name));
  expect(after.every((file) => file.size > 0)).toBeTruthy();
  expect((await app.storage.read()).bState).toBe('failedUpload');
});

test('actual recording, preview, stop button and upload preserve audio routing', async ({
  app,
  api,
  recording,
}) => {
  const media = await recording.grantPermissions();
  await recording.start();
  expect(await media.locator('.combined__preview').isVisible()).toBe(false);
  await media.locator('#preview-toggle-btn').click();
  expect(await media.locator('.combined__preview').isVisible()).toBe(true);
  expect(await media.locator('.combined__preview').evaluate((v) => v.muted)).toBe(true);
  await media.locator('#preview-toggle-btn').click();
  expect(await media.locator('.combined__preview').isVisible()).toBe(false);
  await recording.stop();
  const page = await app.popup.open();
  await page.locator('.record-section__button_upload').click();
  await expect
    .poll(() => api.uploads.length === 1, { message: 'upload received', timeout: 15000 })
    .toBeTruthy();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'ACK cleanup',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(api.uploads[0].files.length).toBe(2);
  for (const file of api.uploads[0].files) {
    const streams = probeMedia(file.file).streams;
    expect(streams.filter((stream) => stream.codec_type === 'video').length).toBe(1);
    expect(streams.filter((stream) => stream.codec_type === 'audio').length).toBe(
      file.field === 'camera_video' ? 1 : 0,
    );
  }
  expect((await app.storage.files()).length).toBe(0);
});

test('two real recording fragments keep one session and send all WebM files together', async ({
  app,
  api,
  recording,
}) => {
  await recording.grantPermissions();
  await recording.start();
  await recording.stop();
  const id = (await app.storage.read()).sessionId;
  await recording.grantPermissions();
  await recording.start();
  await recording.stop();
  expect((await app.storage.read()).sessionId).toBe(id);
  expect(api.sessions.size).toBe(0);
  expect((await app.storage.read()).metadata.recording_sessions.length).toBe(2);
  expect((await app.storage.files()).length).toBe(4);
  await (await app.popup.open()).locator('.record-section__button_upload').click();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'multi-fragment ACK',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(api.sessions.size).toBe(1);
  expect(api.uploads[0].files.length).toBe(4);
});

test('recording continues beyond eleven seconds with production chunk interval', async ({
  createScenario,
}) => {
  const { app, recording } = await createScenario({ recordingIntervalMs: 5000 });
  await recording.grantPermissions();
  await recording.start();
  await expect
    .poll(
      async () => {
        const state = await app.storage.read();
        return new Date(state.recording_end).getTime() - new Date(state.recording_start).getTime();
      },
      { timeout: 25000 },
    )
    .toBeGreaterThanOrEqual(14000);
  expect((await app.storage.read()).bState).toBe('recording');
  const media = await app.media.page();
  expect(
    await media.evaluate(() =>
      Object.values(window._debug.recorders)
        .filter(Boolean)
        .every((recorder) => recorder.state === 'recording'),
    ),
  ).toBe(true);
  await recording.stop();
  expect((await app.storage.files()).every((file) => file.size > 0)).toBe(true);
});

test('unexpected recorder stop reports its reason and retains local files', async ({
  app,
  recording,
}) => {
  await recording.grantPermissions();
  const page = await recording.start();
  await page.evaluate(() => window._debug.recorders.combined.stop());
  await expect.poll(async () => (await app.storage.read()).recordingFailure?.source).toBe('Экран');
  await recording.waitForStopped();
  const state = await app.storage.read();
  expect(state.recordingFailure.message).toContain('MediaRecorder');
  expect((await app.storage.files()).every((file) => file.size > 0)).toBe(true);
});

test('a progress metadata failure does not interrupt real recording', async ({
  app,
  recording,
}) => {
  await recording.grantPermissions();
  const page = await recording.start();
  await page.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    window.__progressFailureCount = 0;
    chrome.storage.local.set = (values, ...args) => {
      if (values.recording_end && window.__progressFailureCount++ === 0) {
        return Promise.reject(new DOMException('Metadata unavailable', 'QuotaExceededError'));
      }
      return original(values, ...args);
    };
  });
  await expect.poll(() => page.evaluate(() => window.__progressFailureCount)).toBeGreaterThan(2);
  expect((await app.storage.read()).bState).toBe('recording');
  expect((await app.storage.read()).recordingFailure).toBeNull();
  await recording.stop();
  expect((await app.storage.files()).every((file) => file.size > 0)).toBe(true);
});
