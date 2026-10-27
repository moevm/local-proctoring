import { probeMedia } from '../support/browser/media-probe.js';
import { test, expect } from '../fixtures/browser.js';
test('cancelled screen selection leaves permissions retryable and no recording files', async ({
  createScenario,
}) => {
  const { app, api, recording } = await createScenario({ faults: { cancelScreen: true } });

  await recording.requestPermissions();
  await app.media.dismissDialog('Ошибка');
  await expect
    .poll(async () => (await app.storage.read()).bState === 'needPermissions', {
      message: 'cancel recovery',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(await app.storage.files()).toEqual([]);
  expect(api.sessions.size).toBe(0);
  expect(
    await (await app.popup.open()).locator('.record-section__button_permissions').isEnabled(),
  ).toBe(true);
});

for (const [label, faults] of [
  ['camera denied', { camera: 'NotAllowedError' }],
  ['microphone missing', { microphone: 'NotFoundError' }],
  ['both devices busy', { camera: 'NotReadableError', microphone: 'NotReadableError' }],
])
  test(
    label + ' can record after explicit consent, with correct saved audio tracks',
    async ({ createScenario }) => {
      const { app, api, recording } = await createScenario({ faults });

      await recording.requestPermissions();
      for (const kind of ['microphone', 'camera'])
        if (faults[kind]) {
          await app.media.dismissDialog('Подтверждение', 'yes');
          await app.media.dismissDialog('Уведомление');
        }
      await app.media.dismissDialog('Готово к записи');
      await recording.start();
      await recording.stop();
      const meta = (await app.storage.read()).metadata;
      expect(meta.no_stream_confirm.camera).toBe(Boolean(faults.camera));
      expect(meta.no_stream_confirm.microphone).toBe(Boolean(faults.microphone));
      await (await app.popup.open()).locator('.record-section__button_upload').click();
      await expect
        .poll(() => api.uploads.length === 1, { message: 'upload', timeout: 15000 })
        .toBeTruthy();
      await expect
        .poll(async () => !(await app.storage.read()).tempFiles?.length, {
          message: 'cleanup',
          timeout: 15000,
        })
        .toBeTruthy();
      expect(api.uploads[0].files.length).toBe(faults.camera ? 1 : 2);
      for (const file of api.uploads[0].files) {
        const audio = probeMedia(file.file).streams.filter((s) => s.codec_type === 'audio').length;
        expect(audio).toBe(
          !faults.microphone && (faults.camera || file.field === 'camera_video') ? 1 : 0,
        );
      }
    },
  );

for (const kind of ['camera', 'microphone'])
  test(
    'refusing to continue without ' + kind + ' releases devices without starting a session',
    async ({ createScenario }) => {
      const { app, api, recording } = await createScenario({
        faults: { [kind]: 'NotAllowedError' },
      });

      await recording.requestPermissions();
      await app.media.dismissDialog('Подтверждение', 'no');
      await expect
        .poll(async () => (await app.storage.read()).bState === 'needPermissions', {
          message: 'refused permissions',
          timeout: 15000,
        })
        .toBeTruthy();
      expect(api.sessions.size).toBe(0);
      expect(await app.storage.files()).toEqual([]);
      expect(await app.media.streamsReleased()).toBe(true);
    },
  );

test('insufficient disk space rejects start without creating OPFS files', async ({
  createScenario,
}) => {
  const { app, recording } = await createScenario({ faults: { lowSpace: true } });

  await recording.grantPermissions();
  await app.popup.fillForm();
  await (await app.popup.open()).locator('.record-section__button_record-start').click();
  await app.media.dismissDialog('Ошибка');
  expect(await app.storage.files()).toEqual([]);
  expect((await app.storage.read()).bState).toBe('needPermissions');
});

for (const kind of ['screen', 'camera', 'microphone'])
  test(
    kind + ' track loss stops recording and retains readable committed video',
    async ({ app, recording }) => {
      await recording.grantPermissions();
      await recording.start();
      const before = await app.storage.files();
      await app.media.endTrack(kind);
      const title = {
        screen: 'Доступ к экрану потерян!',
        camera: 'Доступ к камере потерян!',
        microphone: 'Доступ к микрофону потерян!',
      }[kind];
      await app.media.dismissDialog(title);
      await recording.waitForStopped();
      const after = await app.storage.files();
      expect(after.map((file) => file.name)).toEqual(before.map((file) => file.name));
      expect(after.every((file) => file.size > 0)).toBeTruthy();
      expect((await app.storage.read()).metadata.recording_sessions.length >= 1).toBeTruthy();
    },
  );
