import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundEnvironment } from '../support/unit/background-environment.js';

for (const lifecycle of ['onStartup', 'onInstalled'])
  for (const state of ['recording', 'finalizing', 'uploading', 'readyToRecord']) {
    test(`${lifecycle} preserves pending recordings and ACK inventory from ${state}`, async () => {
      const environment = await createBackgroundEnvironment({
        version: '2.0.0',
        bState: state,
        tempFiles: ['unsent.webm'],
        sessionId: 'keep',
        metadata: { keep: true },
        uploadAttempt: { files: ['unsent.webm'] },
      });
      environment.chrome.runtime[lifecycle].fire();
      assert.equal(environment.saved.bState, 'failedUpload');
      assert.deepEqual(environment.saved.tempFiles, ['unsent.webm']);
      assert.equal(environment.saved.sessionId, 'keep');
      assert.deepEqual(environment.saved.metadata, { keep: true });
      assert.deepEqual(environment.saved.uploadAttempt, { files: ['unsent.webm'] });
      assert.equal(environment.saved.invalidStop, ['recording', 'finalizing'].includes(state));
    });
  }
test('startup without pending files returns to permissions without fabricating a recording', async () => {
  const environment = await createBackgroundEnvironment({ version: '2.0.0', bState: 'uploading' });
  environment.chrome.runtime.onStartup.fire();
  assert.equal(environment.saved.bState, 'needPermissions');
  assert.equal(environment.saved.screenCaptureActive, false);
});
test('cleanup alarm clears itself but retains recordings, metadata and upload attempt', async () => {
  const initial = {
    tempFiles: ['keep.webm'],
    metadata: { keep: true },
    uploadAttempt: { sessionId: 'keep' },
  };
  const environment = await createBackgroundEnvironment(initial);
  environment.chrome.alarms.onAlarm.fire({ name: 'dynamicCleanup' });
  for (const key of Object.keys(initial)) assert.deepEqual(environment.saved[key], initial[key]);
  assert.deepEqual(environment.cleared, ['dynamicCleanup']);
});
test('worker restart restores persisted capture status and stop updates it', async () => {
  const environment = await createBackgroundEnvironment({ screenCaptureActive: true });
  assert.equal((await environment.message({ type: 'getScreenCaptureStatus' })).reply.active, true);
  await environment.message({ action: 'stopRecord' });
  assert.equal(environment.saved.screenCaptureActive, false);
  assert.equal(environment.sent.at(-1).action, 'stopRecording');
});
test('foreign sender cannot start, stop or upload through background routing', async () => {
  const environment = await createBackgroundEnvironment();
  for (const action of ['startRecord', 'stopRecord', 'getPermissions', 'uploadRecord']) {
    assert.equal((await environment.message({ action }, { id: 'foreign' })).reply, undefined);
  }
  assert.deepEqual(environment.sent, []);
});
test('existing recording tab is activated and upload is delegated once', async () => {
  const environment = await createBackgroundEnvironment({}, { tabs: [{ id: 4, active: false }] });
  const { reply } = await environment.message({ action: 'uploadRecord', activateMediaTab: true });
  assert.equal(reply.accepted, true);
  assert.equal(environment.sent.length, 1);
  assert.equal(environment.sent[0].action, 'uploadRecording');
  assert.equal(environment.updates[0].id, 4);
});
test('recording-tab refusal reaches popup without pretending upload started', async () => {
  const environment = await createBackgroundEnvironment(
    {},
    { tabs: [{ id: 4, active: true }], response: { accepted: false, error: 'Busy recording' } },
  );
  const { reply } = await environment.message({ action: 'uploadRecord' });
  assert.equal(reply.success, false);
  assert.match(reply.error, /Busy/);
});
test('failure to create recording tab reaches popup', async () => {
  const environment = await createBackgroundEnvironment({}, { createFails: true });
  const { reply } = await environment.message({ action: 'uploadRecord' });
  assert.equal(reply.success, false);
  assert.match(reply.error, /Cannot open/);
});
test('recording-tab load timeout removes the listener and returns a retryable failure', async () => {
  const environment = await createBackgroundEnvironment({}, { loading: true });
  let reply;
  environment.chrome.runtime.onMessage.fire(
    { action: 'uploadRecord' },
    { id: 'trusted' },
    (value) => {
      reply = value;
    },
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(environment.chrome.tabs.onUpdated.size, 2);
  environment.timeout();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(environment.chrome.tabs.onUpdated.size, 1);
  assert.equal(reply.success, false);
  assert.deepEqual(environment.sent, []);
});
test('duplicate recording tab is closed and original tab activated', async () => {
  const environment = await createBackgroundEnvironment({}, { tabs: [{ id: 4 }, { id: 5 }] });
  await Promise.all(
    environment.chrome.tabs.onUpdated.fire(
      5,
      { url: 'chrome-extension://trusted/pages/media.html' },
      { id: 5 },
    ),
  );
  assert.deepEqual(environment.removed, [5]);
  assert.equal(environment.updates[0].id, 4);
});
