import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures/browser.js';
import { chromium } from '@playwright/test';
test('stopped MV3 worker wakes with capture status and recording files intact', async ({
  app,
  session,
  recording,
}) => {
  await recording.grantPermissions();
  await recording.start();
  const before = await app.storage.files(),
    versions = [],
    cdp = await session.context.newCDPSession(session.controlPage);
  cdp.on('ServiceWorker.workerVersionUpdated', (event) => versions.push(...event.versions));
  await cdp.send('ServiceWorker.enable');
  await expect
    .poll(
      () =>
        versions.some(
          (v) =>
            v.runningStatus === 'running' && v.scriptURL === session.url + '/scripts/background.js',
        ),
      { message: 'running worker', timeout: 15000 },
    )
    .toBeTruthy();
  const version = versions.find(
    (v) => v.runningStatus === 'running' && v.scriptURL === session.url + '/scripts/background.js',
  );
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  expect(
    (
      await session.controlPage.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'getScreenCaptureStatus' }),
      )
    ).active,
  ).toBe(true);
  const after = await app.storage.files();
  for (const file of before)
    expect(after.some((saved) => saved.name === file.name && saved.size >= file.size)).toBeTruthy();
  expect((await app.storage.read()).bState).toBe('recording');
  await recording.stop();
});

test('Chrome crash and fresh process preserve committed recordings in the same test profile', async ({
  app,
  session,
  recording,
}) => {
  await recording.grantPermissions();
  await recording.start();
  await recording.pauseAtCommittedBoundary();
  const before = await app.storage.files(),
    sessionId = (await app.storage.read()).sessionId;
  const browser = session.context.browser();
  void session.cdp.send('Browser.crash').catch(() => {});
  await expect
    .poll(() => !browser.isConnected(), { message: 'test Chrome crashed', timeout: 10000 })
    .toBeTruthy();
  const restarted = await chromium.launchPersistentContext(session.profilePath, {
    executablePath: process.env.CHROME_PATH,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--no-sandbox', '--ozone-platform=x11', '--enable-unsafe-extension-debugging'],
  });
  try {
    const cdp = await restarted.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: session.extensionPath });
    const page = await restarted.newPage();
    await page.goto(session.url + '/pages/index.html');
    await expect
      .poll(() => page.locator('.record-section__button_upload').isEnabled(), {
        message: 'Save after browser crash',
        timeout: 15000,
      })
      .toBeTruthy();
    const saved = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory(),
        files = [];
      for await (const [name, handle] of root.entries())
        files.push({ name, size: (await handle.getFile()).size });
      return { files, state: await chrome.storage.local.get(null) };
    });
    expect(saved.state.sessionId).toBe(sessionId);
    expect(saved.state.bState).toBe('failedUpload');
    for (const file of before)
      expect(
        saved.files.some((item) => item.name === file.name && item.size >= file.size),
      ).toBeTruthy();
  } finally {
    await restarted.close();
  }
});

for (const operation of ['reload', 'close'])
  test(
    operation + ' recording tab retains committed OPFS chunks and recovery controls',
    async ({ app, recording }) => {
      const mediaPage = await recording.grantPermissions();
      await recording.start();
      await recording.pauseAtCommittedBoundary();
      const before = await app.storage.files();
      expect(before.length > 0).toBeTruthy();
      if (operation === 'reload') await mediaPage.reload();
      else await mediaPage.close();
      await expect
        .poll(async () => (await app.storage.read()).bState === 'failedUpload', {
          message: 'recovery state',
          timeout: 15000,
        })
        .toBeTruthy();
      const after = await app.storage.files();
      for (const file of before)
        expect(
          after.some((saved) => saved.name === file.name && saved.size >= file.size),
        ).toBeTruthy();
      if (operation === 'close') expect((await app.storage.read()).invalidStop).toBe(true);
      const page = await app.popup.open();
      await page.reload();
      await expect
        .poll(() => page.locator('.record-section__button_upload').isEnabled(), {
          message: 'recovery Save',
          timeout: 15000,
        })
        .toBeTruthy();
    },
  );

test('cleanup alarm leaves pending recordings, metadata and upload inventory intact', async ({
  app,
  session,
}) => {
  await app.storage.seedPendingRecording();
  const before = await app.storage.read(),
    files = await app.storage.files();
  await session.controlPage.evaluate(() =>
    chrome.alarms.create('dynamicCleanup', { when: Date.now() + 100 }),
  );
  await expect
    .poll(
      async () => !(await session.controlPage.evaluate(() => chrome.alarms.get('dynamicCleanup'))),
      { message: 'cleanup alarm delivered', timeout: 15000 },
    )
    .toBeTruthy();
  const after = await app.storage.read();
  for (const key of ['tempFiles', 'sessionId', 'metadata', 'uploadAttempt'])
    expect(after[key]).toEqual(before[key]);
  expect(await app.storage.files()).toEqual(files);
});

test('real extension update preserves pending OPFS files and upload inventory', async ({
  app,
  session,
}) => {
  await app.storage.seedPendingRecording();
  const before = await app.storage.read(),
    files = await app.storage.files();
  const file = path.join(session.extensionPath, 'manifest.json'),
    manifest = JSON.parse(fs.readFileSync(file));
  const parts = manifest.version.split('.').map(Number);
  parts[parts.length - 1]++;
  manifest.version = parts.join('.');
  fs.writeFileSync(file, JSON.stringify(manifest));
  expect(
    (await session.cdp.send('Extensions.loadUnpacked', { path: session.extensionPath })).id,
  ).toBe(session.url.split('://')[1]);
  const page = await session.context.newPage();
  await page.goto(session.url + '/pages/help.html');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => chrome.storage.local.get('version'))).version ===
        manifest.version,
      { message: 'update migration', timeout: 15000 },
    )
    .toBeTruthy();
  const after = await page.evaluate(() => chrome.storage.local.get(null));
  for (const key of ['tempFiles', 'sessionId', 'metadata', 'uploadAttempt'])
    expect(after[key]).toEqual(before[key]);
  expect(after.bState).toBe('failedUpload');
  expect(
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory(),
        result = [];
      for await (const [name, handle] of root.entries())
        result.push({ name, size: (await handle.getFile()).size });
      return result;
    }),
  ).toEqual(files);
});
