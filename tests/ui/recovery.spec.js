import fs from 'node:fs';
import { test, expect } from '../fixtures/recovery.js';
import { withStorageFailure } from '../support/browser/storage-faults.js';
import { RECOVERY_FILE } from '../support/browser/recovery-recording.js';
import { RecordingsPage } from '../pages/recordings.js';

test('lost upload response preserves originals; retry recovers ACK without a second POST', async ({
  recovery,
  api,
  app,
}) => {
  api.faults.loseUploadResponse = true;

  expect(await recovery.attemptUpload()).toBeTruthy();
  expect(api.uploads).toHaveLength(1);
  expect((await app.storage.read()).uploadAttempt).toBeTruthy();
  expect((await app.storage.read()).tempFiles).toHaveLength(1);

  api.faults.loseUploadResponse = false;
  await recovery.upload();

  expect(api.uploads).toHaveLength(1);
  expect((await app.storage.read()).tempFiles).toHaveLength(0);
});

test('an uncertain upload blocks resume and retains a new unexpected fragment', async ({
  recovery,
  api,
  app,
  session,
}) => {
  api.faults.loseUploadResponse = true;
  await recovery.attemptUpload();
  api.faults.loseUploadResponse = false;

  expect(await recovery.resumeError()).toMatch(/Сначала/);
  const media = await session.context.newPage();
  await media.goto(session.url + '/pages/media.html');
  const reply = await session.controlPage.evaluate(() =>
    chrome.runtime.sendMessage({ action: 'startRecording', formData: {} }),
  );
  expect(reply.success).toBe(false);
  expect(reply.error).toMatch(/Сначала/);
  await media.close();

  await recovery.addFile('proctoring_screen_extra.webm', { indexed: true });
  expect(await recovery.attemptUpload()).toMatch(/изменились/);
  expect((await app.storage.read()).tempFiles).toHaveLength(2);
  expect(await app.storage.files()).toHaveLength(2);
});

test('deletion failure retains recovery metadata; retry completes cleanup', async ({
  recovery,
  app,
}) => {
  await withStorageFailure(recovery.page, 'removeEntry', async () => {
    expect(await recovery.attemptUpload()).toMatch(/Индекс восстановления/);
    const state = await app.storage.read();
    expect(state.sessionId).toBeTruthy();
    expect(state.metadata).toBeTruthy();
    expect(state.tempFiles).toHaveLength(1);
  });

  await recovery.upload();
  expect((await app.storage.read()).sessionId).toBeUndefined();
});

test('missing OPFS file does not prevent recovering a saved server ACK', async ({
  recovery,
  api,
  app,
}) => {
  api.faults.loseUploadResponse = true;
  await recovery.attemptUpload();
  api.faults.loseUploadResponse = false;
  await recovery.removeFile(RECOVERY_FILE);

  await recovery.upload();

  expect((await app.storage.read()).sessionId).toBeUndefined();
});

test('quota failure rejects recorder finalization and preserves committed bytes', async ({
  recovery,
  app,
}) => {
  const result = await withStorageFailure(recovery.page, 'createWritable', () =>
    recovery.attemptRecorderStop(),
  );

  expect(result.error).toBe('QuotaExceededError');
  expect(result.before).toBeGreaterThan(0);
  expect(result.after).toBe(result.before);
  expect((await app.storage.read()).tempFiles).toHaveLength(1);
});

test('OPFS read failure prevents POST and keeps the recovery index', async ({
  recovery,
  api,
  app,
}) => {
  await withStorageFailure(recovery.page, 'getFile', async () => {
    expect(await recovery.attemptUpload()).toBeTruthy();
    expect(api.uploads).toHaveLength(0);
    expect((await app.storage.read()).tempFiles).toHaveLength(1);
  });
});

test('response and JSON-body timeouts preserve the local recording', async ({
  recovery,
  api,
  app,
}) => {
  for (const mode of ['hang', 'hang-body']) {
    api.faults.policyResponse = mode;
    expect(await recovery.requestError()).toMatch(/время ожидания/);
  }
  expect((await app.storage.read()).tempFiles).toHaveLength(1);
});

test('orphan WebM plays and downloads without deleting its local original', async ({
  recovery,
  session,
  app,
}) => {
  await recovery.addFile('orphan.webm');
  const recordings = new RecordingsPage(session);
  const page = await recordings.open();
  await expect(page.getByText('Файлов: 2', { exact: true })).toBeVisible();
  const video = page.locator('video').first();
  await video.evaluate(async (player) => {
    player.muted = true;
    player.loop = true;
    await player.play();
  });
  await expect.poll(() => video.evaluate((player) => player.currentTime)).toBeGreaterThan(0);

  const download = await recordings.download('orphan.webm');

  expect(download.state).toBe('complete');
  expect(fs.statSync(download.filename).size).toBeGreaterThan(0);
  expect((await app.storage.read()).tempFiles).toHaveLength(1);
  expect(await app.storage.files()).toHaveLength(2);
});
