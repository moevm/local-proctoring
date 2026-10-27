import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { installMediaControls } from './media-controls.js';
import { CLIENT_ROOT, MANIFEST, EXTENSION_URL } from '../paths.js';

/** Owns a Chrome process and an unpacked copy. It does not click UI or own the HTTP mock. */
export async function launchExtensionSession(directory, api, { settings = {}, faults = {} } = {}) {
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath)
    throw new Error('CHROME_PATH is required. Run tests through Docker Compose.');
  const extensionPath = path.join(directory, 'client');
  const profilePath = path.join(directory, 'profile');
  const downloadsPath = path.join(directory, 'downloads');
  await fs.mkdir(downloadsPath, { recursive: true });
  await fs.cp(CLIENT_ROOT, extensionPath, { recursive: true });
  const settingsFile = path.join(extensionPath, 'settings.json');
  const config = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  Object.assign(config.session_settings, {
    server_url: api.url,
    server_connection: true,
    local_video_saving: false,
    ...settings,
  });
  config.video_settings.video_saving_interval = 200;
  for (const kind of ['screen', 'camera'])
    Object.assign(config.video_settings[kind], {
      width: { ideal: 320, min: 160, max: 640 },
      height: { ideal: 240, min: 90, max: 480 },
      frameRate: { ideal: 10, min: 5, max: 10 },
    });
  await fs.writeFile(settingsFile, JSON.stringify(config));
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1000, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-sandbox',
      '--ozone-platform=x11',
      '--enable-unsafe-extension-debugging',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const errors = [];
    context.setDefaultTimeout(10000);
    context.on('page', (page) => {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => dialog.accept());
    });
    await context.addCookies([api.cookie]);
    await context.addInitScript(installMediaControls, faults);
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadsPath,
    });
    await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    // Stable origin page for storage access; reading state must never reopen or focus the popup.
    const controlPage = await context.newPage();
    await controlPage.goto(EXTENSION_URL + '/pages/help.html');
    return {
      context,
      cdp,
      controlPage,
      extensionPath,
      profilePath,
      url: EXTENSION_URL,
      version: MANIFEST.version,
      errors,
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
