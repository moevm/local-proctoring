import { test, expect } from '../fixtures/browser.js';
test('damaged logs do not break real form initialization and help navigation', async ({
  app,
  session,
}) => {
  await app.storage.set({ extension_logs: '{broken' });
  const page = await app.popup.open();
  await page.reload();
  await page.locator('#group_input').fill('1234');
  await expect
    .poll(
      async () =>
        (await page.locator('#group_input').getAttribute('class')).includes('input-valid'),
      { message: 'form initialized', timeout: 15000 },
    )
    .toBeTruthy();
  await page.locator('#help-button').click();
  const help = session.controlPage;
  await help.getByRole('heading', { name: 'Запись экзамена', exact: true }).waitFor();
  await expect
    .poll(async () => await help.evaluate(() => document.visibilityState === 'visible'), {
      message: 'existing help tab activated',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(await help.locator('#ext-version').innerText()).toBe(session.version);
});

test('content notification escapes untrusted text and resolves only after closing', async ({
  api,
  session,
}) => {
  const page = await session.context.newPage();
  await page.goto(api.baseUrl);
  const response = await session.controlPage.evaluateHandle((base) => {
    const result = { reply: null };
    chrome.tabs
      .query({ url: base + '/*' })
      .then(([tab]) =>
        chrome.tabs.sendMessage(tab.id, {
          type: 'showModalNotifyOnActiveTab',
          title: '<img src=x onerror=alert(1)>',
          messages: ['<script>window.injected=true</script>', 'A & B'],
        }),
      )
      .then((reply) => {
        result.reply = reply;
      });
    return result;
  }, api.baseUrl);
  try {
    await page.locator('#custom-modal-overlay').waitFor();
    expect(await page.locator('#custom-modal h2').innerText()).toBe('<img src=x onerror=alert(1)>');
    expect(await page.locator('#custom-modal img, #custom-modal script').count()).toBe(0);
    expect(await response.evaluate((result) => result.reply)).toBe(null);
    await page.locator('#modal-close-btn').click();
    await expect
      .poll(async () => (await response.evaluate((result) => result.reply))?.confirmed, {
        message: 'notification confirmation',
        timeout: 15000,
      })
      .toBeTruthy();
    expect(await page.locator('body').evaluate((body) => body.style.overflow)).toBe('');
  } finally {
    await response.dispose();
  }
});
