/** Reads real extension storage and OPFS through a stable page of the extension origin. */
export class ExtensionStorage {
  constructor(page) {
    this.page = page;
  }
  read() {
    return this.page.evaluate(() => chrome.storage.local.get(null));
  }
  set(values) {
    return this.page.evaluate((values) => chrome.storage.local.set(values), values);
  }
  /** List WebM recordings, excluding transient browser-owned swap files. */
  files() {
    return this.page.evaluate(async () => {
      const root = await navigator.storage.getDirectory(),
        files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file' && name.endsWith('.webm'))
          files.push({ name, size: (await handle.getFile()).size });
      }
      return files.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  /** Sentinel bytes, not a valid WebM: used for storage/listing preservation, never playback. */
  seedPendingRecording() {
    return this.page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('proctoring_screen_preserved.webm', { create: true });
      const writer = await handle.createWritable();
      await writer.write('synthetic preserved bytes');
      await writer.close();
      await chrome.storage.local.set({
        tempFiles: ['proctoring_screen_preserved.webm'],
        sessionId: 'ffffffffffffffffffffffff',
        metadata: { preserve: true },
        uploadAttempt: { preserve: true },
        bState: 'failedUpload',
      });
    });
  }
}
