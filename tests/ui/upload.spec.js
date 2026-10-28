import { probeMedia } from '../support/browser/media-probe.js';
import { withDownloadFailure } from '../support/browser/download-faults.js';
import { test, expect } from '../fixtures/browser.js';

test('offline full UI recording downloads both videos and clears only after completion', async ({
  createScenario,
}) => {
  const { app, api, session, recording } = await createScenario({
    settings: { server_connection: false, local_video_saving: true },
  });

  await recording.grantPermissions();
  await recording.start();
  await recording.stop();
  expect((await app.storage.read()).sessionId).toMatch(/^[a-f0-9]{24}$/);
  await app.popup.save();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'offline downloads and cleanup',
      timeout: 15000,
    })
    .toBeTruthy();
  const downloads = await session.controlPage.evaluate(() => chrome.downloads.search({}));
  expect(
    downloads.filter((d) => d.filename.endsWith('.webm') && d.state === 'complete').length,
  ).toBe(2);
  for (const d of downloads.filter((d) => d.filename.endsWith('.webm')))
    expect(probeMedia(d.filename).streams.some((s) => s.codec_type === 'video')).toBe(true);
  expect(api.requests.filter((c) => c.method === 'POST').length).toBe(0);
});

for (const status of [401, 403])
  for (const phase of ['start', 'status', 'upload'])
    test(`${status} ${phase} failure remains recoverable through UI`, async ({
      app,
      api,
      recording,
    }) => {
      await recording.grantPermissions();
      if (phase === 'start') {
        api.faults.startStatus = status;
        await app.popup.fillForm();
        await (await app.popup.open()).locator('.record-section__button_record-start').click();
        await app.media.dismissDialog('Ошибка');
        await expect
          .poll(async () => (await app.storage.read()).bState === 'needPermissions', {
            message: 'start refusal',
            timeout: 15000,
          })
          .toBeTruthy();
        expect(await app.storage.files()).toEqual([]);
        return;
      }
      await recording.start();
      await recording.stop();
      api.faults[phase === 'status' ? 'statusStatus' : 'uploadStatus'] = status;
      const before = await app.storage.files();
      await app.popup.save();
      await app.media.dismissDialog('Не удалось завершить сохранение');
      expect(await app.storage.files()).toEqual(before);
      expect((await app.storage.read()).bState).toBe('failedUpload');
      api.faults.statusStatus = 200;
      api.faults.uploadStatus = 200;
      await app.popup.save();
      await expect
        .poll(async () => !(await app.storage.read()).tempFiles?.length, {
          message: 'retry after login',
          timeout: 15000,
        })
        .toBeTruthy();
    });

test('closing popup after Save does not interrupt delayed upload or erase files before ACK', async ({
  app,
  api,
  recording,
}) => {
  await recording.grantPermissions();
  await recording.start();
  await recording.stop();
  api.faults.delayUpload = true;
  const page = await app.popup.open();
  await page.locator('.record-section__button_upload').click();
  await expect
    .poll(() => page.isClosed(), { message: 'popup closes after Save', timeout: 15000 })
    .toBeTruthy();
  await expect
    .poll(() => api.uploads.length === 1, { message: 'delayed upload arrived', timeout: 15000 })
    .toBeTruthy();
  expect((await app.storage.files()).length > 0).toBeTruthy();
  expect((await app.storage.read()).bState).toBe('uploading');
  api.releaseUpload();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'delayed ACK',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(api.uploads.length).toBe(1);
});

test('duplicate Start, Stop and Save actions create one session, fragment and upload', async ({
  app,
  api,
  session,
  recording,
}) => {
  const mediaPage = await recording.grantPermissions();
  await recording.start({ doubleClick: true });
  expect(api.sessions.size).toBe(1);
  await (await app.popup.open())
    .locator('.record-section__button_record-stop')
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await recording.waitForStopped(mediaPage);
  expect((await app.storage.read()).metadata.recording_sessions.length).toBe(1);
  api.faults.delayUpload = true;
  const replies = await session.controlPage.evaluate(() =>
    Promise.all([
      chrome.runtime.sendMessage({ action: 'uploadRecord' }),
      chrome.runtime.sendMessage({ action: 'uploadRecord' }),
    ]),
  );
  await expect
    .poll(() => api.uploads.length === 1, { message: 'one concurrent upload', timeout: 15000 })
    .toBeTruthy();
  expect((await app.storage.files()).length > 0).toBeTruthy();
  expect(replies.filter((reply) => reply.accepted).length).toBe(1);
  expect(replies.filter((reply) => reply.success === false).length).toBe(1);
  api.releaseUpload();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'single ACK cleanup',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(api.uploads.length).toBe(1);
});

test('malformed upload ACK keeps originals and permits a successful retry', async ({
  app,
  api,
  recording,
}) => {
  await recording.grantPermissions();
  await recording.start();
  await recording.stop();
  api.faults.invalidACK = true;
  const before = await app.storage.files();
  await app.popup.save();
  await app.media.dismissDialog('Не удалось завершить сохранение');
  expect(await app.storage.files()).toEqual(before);
  api.faults.invalidACK = false;
  await app.popup.save();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'valid retry ACK',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(api.uploads.length).toBe(2);
});

test('combined local and server saving keeps originals when the second download fails', async ({
  createScenario,
}) => {
  const { app, api, recording } = await createScenario({
    settings: { server_connection: true, local_video_saving: true },
  });

  const mediaPage = await recording.grantPermissions();
  await recording.start();
  await recording.stop();
  const before = await app.storage.files();
  await withDownloadFailure(
    mediaPage,
    async () => {
      await app.popup.save();
      await app.media.dismissDialog('Не удалось завершить сохранение');
      expect(await app.storage.files()).toEqual(before);
      expect(api.uploads).toHaveLength(0);
    },
    { at: 2 },
  );
  await app.popup.save();
  await expect
    .poll(async () => !(await app.storage.read()).tempFiles?.length, {
      message: 'combined retry',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(api.uploads.length).toBe(1);
});

test('disabled saving configuration neither uploads nor deletes pending videos', async ({
  createScenario,
}) => {
  const { app, api } = await createScenario({
    settings: { server_connection: false, local_video_saving: false },
  });

  await app.storage.seedPendingRecording();
  const before = await app.storage.files();
  const page = await app.popup.open();
  await page.reload();
  expect(await page.locator('.record-section__button_upload').isVisible()).toBe(false);
  expect(await app.storage.files()).toEqual(before);
  expect(api.uploads.length).toBe(0);
});
