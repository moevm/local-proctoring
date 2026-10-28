import { expect } from '@playwright/test';

/** User journeys spanning popup, recording tab and storage; assertions stay in tests. */
export class RecordingFlow {
  constructor(app) {
    this.app = app;
  }

  async requestPermissions() {
    await this.app.popup.requestPermissions();
    await this.app.media.dismissDialog('Разрешения для прокторинга');
    return this.app.media.page();
  }

  async grantPermissions() {
    await this.requestPermissions();
    await this.app.media.dismissDialog('Готово к записи');
    await expect.poll(async () => (await this.app.storage.read()).bState).toBe('readyToRecord');
    return this.app.media.page();
  }

  async start({ doubleClick = false } = {}) {
    await this.app.popup.fillForm();
    if (doubleClick)
      await (await this.app.popup.open())
        .locator('.record-section__button_record-start')
        .evaluate((button) => {
          button.click();
          button.click();
        });
    else await this.app.popup.start();
    await expect.poll(async () => (await this.app.storage.read()).bState).toBe('recording');
    await expect
      .poll(async () => {
        const files = await this.app.storage.files();
        return files.length > 0 && files.every((file) => file.size > 0);
      })
      .toBe(true);
    await this.app.media.dismissDialog('Идёт запись');
    return this.app.media.page();
  }

  async waitForStopped() {
    await this.app.media.dismissDialog('Запись завершена, статистика:');
    await this.app.media.dismissDialog('Отправка записи');
    await expect.poll(async () => (await this.app.storage.read()).bState).toBe('failedUpload');
    await expect.poll(() => this.app.media.streamsReleased()).toBe(true);
  }

  async stop() {
    await this.app.popup.stop();
    await this.waitForStopped();
  }

  async pauseAtCommittedBoundary() {
    const page = await this.app.media.page();
    await page.evaluate(async () => {
      await Promise.all(
        Object.values(window._debug.recorders)
          .filter(Boolean)
          .map((recorder) => {
            if (recorder.state !== 'recording') return;
            return new Promise((resolve) => {
              recorder.addEventListener('pause', resolve, { once: true });
              recorder.pause();
            });
          }),
      );
    });
    await expect.poll(() => page.evaluate(() => window.__pendingOPFSWrites)).toBe(0);
  }
}
