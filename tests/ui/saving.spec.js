import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect } from '../fixtures/browser.js';
import { probeMedia } from '../support/browser/media-probe.js';
import { RecordingsPage } from '../pages/recordings.js';

const scenarios = [
  { name: 'fully offline', connected: false, upload: true },
  { name: 'connected without video upload', connected: true, upload: false },
  { name: 'server error without video upload', connected: true, upload: false, serverError: true },
  {
    name: 'network unavailable without video upload',
    connected: true,
    upload: false,
    offline: true,
  },
  { name: 'local download and server upload', connected: true, upload: true },
  { name: 'server error with video upload', connected: true, upload: true, serverError: true },
  { name: 'network interrupted before upload', connected: true, upload: true, interrupt: true },
  { name: 'lost upload confirmation', connected: true, upload: true, lostResponse: true },
];
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

for (const scenario of scenarios) {
  test(`recording and saving: ${scenario.name}`, async ({ createScenario }) => {
    const { app, api, session, recording } = await createScenario({
      settings: {
        server_connection: scenario.connected,
        server_video_upload: scenario.upload,
        local_video_saving: true,
      },
    });
    let originals;
    await test.step('record both streams without relying on server availability', async () => {
      if (scenario.serverError) {
        api.faults.policyStatus = 503;
        api.faults.startStatus = 503;
      }
      if (scenario.offline) await session.context.setOffline(true);
      await recording.grantPermissions();
      await recording.start();
      expect(api.sessions.size).toBe(0);
      await recording.stop();
      originals = await app.storage.files();
      expect(originals).toHaveLength(2);
      expect(originals.every((file) => file.size > 0)).toBe(true);
    });
    const failed =
      scenario.upload &&
      scenario.connected &&
      (scenario.serverError || scenario.interrupt || scenario.lostResponse);
    let downloaded;
    await test.step('download both playable originals before any server upload', async () => {
      if (scenario.interrupt) await session.context.setOffline(true);
      if (scenario.lostResponse) api.faults.loseUploadResponse = true;
      await app.popup.save();
      if (failed) await app.media.dismissDialog('Не удалось завершить сохранение');
      await expect
        .poll(async () => {
          const items = await session.controlPage.evaluate(() => chrome.downloads.search({}));
          return items.filter(
            (item) => item.filename.endsWith('.webm') && item.state === 'complete',
          ).length;
        })
        .toBe(2);
      downloaded = (await session.controlPage.evaluate(() => chrome.downloads.search({}))).filter(
        (item) => item.filename.endsWith('.webm') && item.state === 'complete',
      );
      for (const item of downloaded) {
        const streams = probeMedia(item.filename).streams;
        expect(streams.some((stream) => stream.codec_type === 'video')).toBe(true);
      }
    });
    if (failed) {
      await test.step('retain readable local files after server failure and recover without duplicate publication', async () => {
        expect(await app.storage.files()).toEqual(originals);
        const viewer = new RecordingsPage(session);
        await viewer.open();
        for (const file of originals) await expect(viewer.row(file.name)).toBeVisible();
        await viewer.page.close();
        await session.context.setOffline(false);
        api.faults.policyStatus = 200;
        api.faults.startStatus = 200;
        api.faults.loseUploadResponse = false;
        await app.popup.save();
      });
    }
    await test.step('clean local storage only after confirmed saving', async () => {
      await expect.poll(async () => (await app.storage.read()).tempFiles || []).toHaveLength(0);
      expect(await app.storage.files()).toHaveLength(0);
      if (scenario.connected && scenario.upload) {
        expect(api.sessions.size).toBe(1);
        expect(api.uploads).toHaveLength(1);
        expect(api.uploads[0].files.map((file) => file.field).sort()).toEqual([
          'camera_video',
          'screen_video',
        ]);
        expect(api.uploads[0].files.map((file) => hash(file.file)).sort()).toEqual(
          downloaded.map((file) => hash(file.filename)).sort(),
        );
      } else {
        expect(api.uploads).toHaveLength(0);
        expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
        if (!scenario.connected) expect(api.requests).toHaveLength(0);
      }
    });
  });
}
