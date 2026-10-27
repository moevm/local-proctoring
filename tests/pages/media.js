import { expect } from '@playwright/test';

/** DOM and browser-boundary actions of the long-lived recording tab. */
export class MediaPage {
  constructor(session) {
    this.session = session;
  }

  async page() {
    const url = this.session.url + '/pages/media.html';
    await expect
      .poll(() => this.session.context.pages().some((page) => page.url() === url), {
        message: 'Recording tab opened',
        timeout: 15000,
      })
      .toBe(true);
    return this.session.context.pages().find((page) => page.url() === url);
  }

  async dismissDialog(title, answer = 'close') {
    const page = await this.page();
    await page.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 15000 });
    await page
      .locator(answer === 'close' ? '#modal-close-btn' : '#modal-confirm-' + answer)
      .click();
  }

  async endTrack(kind) {
    await (
      await this.page()
    ).evaluate((kind) => {
      const stream = window.__testStreams[kind];
      const track = kind === 'microphone' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      track.stop();
      track.dispatchEvent(new Event('ended'));
    }, kind);
  }

  async fireStopDeadline() {
    await (
      await this.page()
    ).evaluate(() => {
      if (window.__testTimers.length !== 1) throw new Error('Expected one four-hour stop timer');
      window.__testTimers[0]();
    });
  }

  async streamsReleased() {
    return (await this.page()).evaluate(() =>
      Object.values(window.__testStreams).every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
    );
  }
}
