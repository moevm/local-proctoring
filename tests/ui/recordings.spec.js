import { test, expect } from '../fixtures/recovery.js';
import { RecordingsPage } from '../pages/recordings.js';
import { withDownloadFailure } from '../support/browser/download-faults.js';
import { withStorageFailure } from '../support/browser/storage-faults.js';

test('empty recordings list refreshes when a local recording appears', async ({ app, session }) => {
  const recordings = new RecordingsPage(session);
  const page = await recordings.open();
  await expect(page.getByText('Файлов: 0', { exact: true })).toBeVisible();

  await app.storage.seedPendingRecording();
  await recordings.refresh();

  await expect(page.getByText('Файлов: 1', { exact: true })).toBeVisible();
  expect(await app.storage.files()).toHaveLength(1);
});

test('failed viewer download preserves the file and allows retry with reveal', async ({
  recovery,
  app,
  session,
}) => {
  const recordings = new RecordingsPage(session);
  const page = await recordings.open();
  const before = await app.storage.files();
  const download = recordings
    .row(recovery.fileName)
    .getByRole('button', { name: 'Скачать', exact: true });
  await withDownloadFailure(page, async () => {
    await download.click();
    await expect(download).toBeEnabled();
    await expect(
      recordings.row(recovery.fileName).getByRole('button', { name: 'Показать в папке' }),
    ).toHaveCount(0);
  });

  const revealCalls = await page.evaluateHandle(() => {
    const calls = [];
    chrome.downloads.show = (id) => calls.push(id);
    return calls;
  });
  try {
    const saved = await recordings.download(recovery.fileName);
    await recordings
      .row(recovery.fileName)
      .getByRole('button', { name: 'Показать в папке' })
      .click();
    expect(await revealCalls.jsonValue()).toEqual([saved.id]);
    expect(saved.state).toBe('complete');
    expect(await app.storage.files()).toEqual(before);
  } finally {
    await revealCalls.dispose();
  }
});

test('unreadable recording is reported without deleting it', async ({ recovery, app, session }) => {
  const recordings = new RecordingsPage(session);
  const page = await recordings.open();
  await withStorageFailure(page, 'getFile', async () => {
    await recordings.refresh();
    await expect(page.getByText(/не удалось прочитать; файл не удалён/)).toBeVisible();
    expect((await app.storage.files()).map((file) => file.name)).toEqual([recovery.fileName]);
  });
});

test('storage access failure is visible and preserves recordings', async ({
  recovery,
  app,
  session,
}) => {
  const recordings = new RecordingsPage(session);
  const page = await recordings.open();
  const rollback = await page.evaluateHandle(() => {
    const original = navigator.storage.getDirectory;
    navigator.storage.getDirectory = async () => {
      throw new Error('Injected root failure');
    };
    return () => {
      navigator.storage.getDirectory = original;
    };
  });
  try {
    await recordings.refresh();
    await expect(
      page.getByText(/Не удалось открыть хранилище: Injected root failure/),
    ).toBeVisible();
    expect((await app.storage.files()).map((file) => file.name)).toEqual([recovery.fileName]);
  } finally {
    await rollback.evaluate((restore) => restore());
    await rollback.dispose();
  }
});
