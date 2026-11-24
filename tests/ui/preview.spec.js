import { probeMedia } from '../support/browser/media-probe.js';
import { test, expect } from '../fixtures/browser.js';
test('preview stays visible after recording starts', async ({ recording }) => {
  const media = await recording.grantPermissions();
  await expect(media.locator('.combined__preview')).toBeVisible();
  await recording.start();
  await expect(media.locator('.combined__preview')).toBeVisible();
  await recording.stop();
});
test('audio toggle controls preview audio and saves preference', async ({ app, recording }) => {
  const media = await recording.grantPermissions();
  const preview = media.locator('.combined__preview');
  const audioToggle = media.locator('#audio-toggle-checkbox');
  await expect(audioToggle).toBeChecked();
  expect(await preview.evaluate((video) => video.srcObject.getAudioTracks().length)).toBe(1);
  expect(await preview.evaluate((video) => video.muted)).toBe(false);
  await audioToggle.uncheck();
  expect(await preview.evaluate((video) => video.muted)).toBe(true);
  expect(await preview.evaluate((video) => video.srcObject.getAudioTracks()[0].enabled)).toBe(true);
  expect((await app.storage.read()).previewAudioEnabled).toBe(false);
  await audioToggle.check();
  expect(await preview.evaluate((video) => video.muted)).toBe(false);
  expect(await preview.evaluate((video) => video.srcObject.getAudioTracks()[0].enabled)).toBe(true);
  expect((await app.storage.read()).previewAudioEnabled).toBe(true);
});

test('hiding preview mutes audio and restores selected audio setting', async ({ recording }) => {
  const media = await recording.grantPermissions();
  const preview = media.locator('.combined__preview');
  const audioToggle = media.locator('#audio-toggle-checkbox');
  await recording.start();
  await expect(audioToggle).toBeChecked();
  expect(await preview.evaluate((video) => video.muted)).toBe(false);
  await media.locator('#preview-toggle-btn').click();
  await expect(preview).toBeHidden();
  expect(await preview.evaluate((video) => video.muted)).toBe(true);
  await media.locator('#preview-toggle-btn').click();
  await expect(preview).toBeVisible();
  await expect(audioToggle).toBeChecked();
  expect(await preview.evaluate((video) => video.muted)).toBe(false);
  await recording.stop();
});

test('recording start and stop do not reset audio preference', async ({ app, recording }) => {
  const media = await recording.grantPermissions();
  const preview = media.locator('.combined__preview');
  const audioToggle = media.locator('#audio-toggle-checkbox');
  await audioToggle.uncheck();
  await audioToggle.check();
  expect((await app.storage.read()).previewAudioEnabled).toBe(true);
  expect(await preview.evaluate((video) => video.muted)).toBe(false);
  await recording.start();
  await expect(audioToggle).toBeChecked();
  expect(await preview.evaluate((video) => video.muted)).toBe(false);
  expect((await app.storage.read()).previewAudioEnabled).toBe(true);
  await recording.stop();
  await expect(audioToggle).toBeChecked();
  expect((await app.storage.read()).previewAudioEnabled).toBe(true);
});

test('preview audio works without camera', async ({ createScenario }) => {
  const scenario = await createScenario({
    faults: {
      camera: 'NotAllowedError',
    },
  });
  const { app, api, recording } = scenario;
  const media = await recording.requestPermissions();
  await media.locator('#modal-confirm-yes').click();
  await media.locator('#modal-close-btn').click();
  await app.media.dismissDialog('Готово к записи');
  await expect.poll(async () => (await app.storage.read()).bState).toBe('readyToRecord');
  const preview = media.locator('.combined__preview');
  const cameraPreview = media.locator('.camera__preview');
  const audioToggle = media.locator('#audio-toggle-checkbox');
  await expect(preview).toBeVisible();
  await expect(cameraPreview).toBeHidden();
  await expect(audioToggle).toBeChecked();
  expect(await preview.evaluate((video) => video.srcObject.getVideoTracks().length)).toBe(1);
  expect(await preview.evaluate((video) => video.srcObject.getAudioTracks().length)).toBe(1);
  await recording.start();
  await audioToggle.uncheck();
  expect(await preview.evaluate((video) => video.muted)).toBe(true);
  expect(await preview.evaluate((video) => video.srcObject.getAudioTracks()[0].enabled)).toBe(true);
  await media.locator('#preview-toggle-btn').click();
  await expect(preview).toBeHidden();
  expect(await preview.evaluate((video) => video.muted)).toBe(true);
  expect(await preview.evaluate((video) => video.srcObject.getAudioTracks()[0].enabled)).toBe(true);
  await recording.stop();
  const page = await app.popup.open();
  await page.locator('.record-section__button_upload').click();
  await expect
    .poll(() => api.uploads.length === 1, {
      message: 'upload received',
      timeout: 15000,
    })
    .toBeTruthy();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'ACK cleanup',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(api.uploads[0].files.length).toBe(1);
  const streams = probeMedia(api.uploads[0].files[0].file).streams;
  expect(streams.filter((stream) => stream.codec_type === 'video').length).toBe(1);
  expect(streams.filter((stream) => stream.codec_type === 'audio').length).toBe(1);
  expect((await app.storage.files()).length).toBe(0);
});

test('preview works without microphone', async ({ createScenario }) => {
  const scenario = await createScenario({
    faults: {
      microphone: 'NotAllowedError',
    },
  });
  const { app, recording } = scenario;
  const media = await recording.requestPermissions();
  await media.locator('#modal-confirm-yes').click();
  await media.locator('#modal-close-btn').click();
  await app.media.dismissDialog('Готово к записи');
  await expect.poll(async () => (await app.storage.read()).bState).toBe('readyToRecord');
  const preview = media.locator('.combined__preview');
  const cameraPreview = media.locator('.camera__preview');
  const audioToggle = media.locator('#audio-toggle-checkbox');
  await expect(preview).toBeVisible();
  await expect(cameraPreview).toBeVisible();
  expect(await preview.evaluate((video) => video.srcObject.getVideoTracks().length)).toBe(1);
  expect(await preview.evaluate((video) => video.srcObject.getAudioTracks().length)).toBe(0);
  await expect(audioToggle).toBeDisabled();
  await recording.start();
  await expect(preview).toBeVisible();
  await recording.stop();
});
