import { test, expect } from '../fixtures/browser.js';
test('preview stays visible after recording starts', async ({ recording }) => {
  const media = await recording.grantPermissions();
  expect(await media.locator('.combined__preview').isVisible()).toBe(true);
  await recording.start();
  expect(await media.locator('.combined__preview').isVisible()).toBe(true);
  await recording.stop();
});
test('audio toggle controls mic indicator visibility and saves preference', async ({
  app,
  recording,
}) => {
  const media = await recording.grantPermissions();
  await expect(media.locator('#audio-toggle-checkbox')).toBeChecked();
  await expect(media.locator('.mic-indicator')).toBeVisible();
  await media.locator('#audio-toggle-checkbox').uncheck();
  await expect(media.locator('.mic-indicator')).toBeHidden();
  expect((await app.storage.read()).previewAudioEnabled).toBe(false);
  await media.locator('#audio-toggle-checkbox').check();
  await expect(media.locator('.mic-indicator')).toBeVisible();
  expect((await app.storage.read()).previewAudioEnabled).toBe(true);
});

test('hiding preview preserves user audio preference', async ({ recording }) => {
  const media = await recording.grantPermissions();
  await recording.start();
  await media.locator('#audio-toggle-checkbox').uncheck();
  await expect(media.locator('.mic-indicator')).toBeHidden();
  await media.locator('#preview-toggle-btn').click();
  await expect(media.locator('.combined__preview')).toBeHidden();
  await expect(media.locator('#audio-toggle-checkbox')).not.toBeChecked();
  await media.locator('#preview-toggle-btn').click();
  await expect(media.locator('.combined__preview')).toBeVisible();
  await expect(media.locator('#audio-toggle-checkbox')).not.toBeChecked();
  await expect(media.locator('.mic-indicator')).toBeHidden();
  await recording.stop();
});

test('recording start and stop do not reset audio preference', async ({ app, recording }) => {
  const media = await recording.grantPermissions();
  await media.locator('#audio-toggle-checkbox').uncheck();
  expect((await app.storage.read()).previewAudioEnabled).toBe(false);
  await recording.start();
  await expect(media.locator('#audio-toggle-checkbox')).not.toBeChecked();
  await recording.stop();
  await expect(media.locator('#audio-toggle-checkbox')).not.toBeChecked();
  expect((await app.storage.read()).previewAudioEnabled).toBe(false);
});
