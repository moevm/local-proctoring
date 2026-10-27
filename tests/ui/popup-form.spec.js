import { test, expect } from '../fixtures/browser.js';
test('real form validates all fields, empty submission and restores values', async ({
  app,
  api,
  recording,
}) => {
  await recording.grantPermissions();
  const page = await app.popup.open();
  await page.locator('.record-section__button_record-start').click();
  expect(await page.locator('.input-invalid').count()).toBe(5);
  expect(api.requests.filter((c) => c.path.endsWith('/start_session')).length).toBe(0);
  for (const [field, bad, good] of [
    ['group', '12a4', '1234'],
    ['name', 'invalid', 'Иван'],
    ['surname', 'smith', 'Иванов'],
    ['patronymic', '123', 'Иванович'],
  ]) {
    const input = page.locator('#' + field + '_input');
    await input.fill(bad);
    await input.blur();
    expect(await input.getAttribute('class')).toMatch(/input-invalid/);
    await input.fill(good);
    await input.blur();
    expect(await input.getAttribute('class')).toMatch(/input-valid/);
  }
  await page.locator('#title_input').fill('Synthetic saved title');
  await page.locator('#no_patronymic_checkbox').check();
  expect(await page.locator('#patronymic_input').isDisabled()).toBe(true);
  await page.reload();
  expect(await page.locator('#group_input').inputValue()).toBe('1234');
  expect(await page.locator('#title_input').inputValue()).toBe('Synthetic saved title');
  expect(await page.locator('#no_patronymic_checkbox').isChecked()).toBe(true);
  await page.locator('#no_patronymic_checkbox').uncheck();
  expect(await page.locator('#patronymic_input').isEnabled()).toBe(true);
});

test('all popup control states and timer survive reopening', async ({ app, session }) => {
  const expected = {
    needPermissions: ['permissions'],
    readyToRecord: ['record-start'],
    recording: ['record-stop'],
    finalizing: [],
    uploading: [],
    failedUpload: ['permissions', 'upload'],
  };
  for (const [state, enabled] of Object.entries(expected)) {
    await session.controlPage.evaluate(
      (state) =>
        chrome.storage.local.set({
          bState: state,
          lastRecordTime: new Date(Date.now() - 5000).toISOString(),
          timeStr: '00:00:05',
        }),
      state,
    );
    const page = await app.popup.open();
    await page.reload();
    await expect
      .poll(
        async () =>
          await page
            .locator('.record-section__button')
            .evaluateAll(
              (buttons, enabled) =>
                buttons.every(
                  (b) =>
                    enabled.some((name) =>
                      b.classList.contains('record-section__button_' + name),
                    ) === !b.disabled,
                ),
              enabled,
            ),
        { message: 'control matrix ' + state, timeout: 15000 },
      )
      .toBeTruthy();
    expect((await page.locator('#record-time').innerText()).includes(':')).toBeTruthy();
  }
});
