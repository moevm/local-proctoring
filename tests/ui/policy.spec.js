import { openNativePopup } from '../support/browser/native-popup.js';
import { test, expect } from '../fixtures/browser.js';

async function reopenWithPolicy(app, api, policy) {
  api.policy = { ...api.policy, ...policy };
  const popup = await app.popup.open();
  await popup.setViewportSize({ width: 390, height: 600 });
  await popup.reload();
  return popup;
}

async function seedOngoingRecording(app) {
  await app.storage.seedPendingRecording();
  await app.storage.set({ bState: 'recording' });
}

test('opening popup checks authenticated policy and shows the update link', async ({
  app,
  api,
}) => {
  const popup = await reopenWithPolicy(app, api, {
    latestVersion: '999.0.0',
    downloadUrl: 'https://updates.example.test/plugin.zip',
  });
  const notice = popup.locator('#plugin-update-notice');
  await expect(notice).toContainText('Доступна новая версия расширения');
  await expect(notice).toContainText('999.0.0');
  await expect(notice.getByRole('link')).toHaveAttribute('href', api.policy.downloadUrl);
  await expect(notice.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(
    api.requests
      .filter((call) => call.path.endsWith('/plugin_policy'))
      .every((call) => call.cookie.includes('mock_session=student')),
  ).toBe(true);
  await expect(popup.locator('.record-section__button_permissions')).toBeEnabled();
  const stop = popup.locator('.record-section__button_record-stop');
  await stop.scrollIntoViewIfNeeded();
  const box = await stop.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
});

test('reopening popup removes the stale update notice after policy changes', async ({
  app,
  api,
  session,
}) => {
  let popup = await reopenWithPolicy(app, api, { latestVersion: '999.0.0' });
  await expect(popup.locator('#plugin-update-notice')).toContainText('Доступна новая версия');
  await popup.close();
  api.policy.latestVersion = session.version;
  popup = await app.popup.open();
  await expect(popup.locator('#plugin-update-notice')).toContainText('Новая версия не требуется');
  await expect(popup.locator('#plugin-update-notice a')).toHaveCount(0);
});

test('blocked version preserves the ongoing recording and OPFS bytes', async ({ app, api }) => {
  await seedOngoingRecording(app);
  const before = await app.storage.files();
  const popup = await reopenWithPolicy(app, api, {
    latestVersion: '999.0.0',
    blockOutdated: true,
  });
  await expect(popup.locator('#plugin-update-notice')).toContainText('начало записи запрещено');
  expect((await app.storage.read()).bState).toBe('recording');
  expect(await app.storage.files()).toEqual(before);
  await expect(popup.locator('.record-section__button_record-stop')).toBeEnabled();
});

test('missing latest version is not described as up to date', async ({ app, api }) => {
  const popup = await reopenWithPolicy(app, api, { latestVersion: null });
  await expect(popup.locator('#plugin-update-notice')).toContainText(
    'Сервер не указал актуальную версию',
  );
});

test('untrusted download URL and malformed policy do not inject HTML', async ({ app, api }) => {
  const popup = await reopenWithPolicy(app, api, {
    latestVersion: '999.0.0',
    downloadUrl: 'javascript:alert(1)',
  });
  await expect(popup.locator('#plugin-update-notice')).toContainText('Доступна новая версия');
  await expect(popup.locator('#plugin-update-notice a')).toHaveCount(0);
  api.policy.latestVersion = '<img src=x onerror=alert(1)>';
  await popup.reload();
  await expect(popup.locator('#plugin-update-notice')).toContainText(
    'Не удалось проверить обновления',
  );
  await expect(popup.locator('#plugin-update-notice img')).toHaveCount(0);
});

for (const failure of ['401', '503', 'JSON', 'timeout']) {
  test(`policy failure ${failure} preserves recording and controls`, async ({
    app,
    api,
    session,
  }) => {
    await seedOngoingRecording(app);
    const before = await app.storage.files();
    if (failure === '401') await session.context.clearCookies();
    if (failure === '503') api.faults.policyStatus = 503;
    if (failure === 'JSON') api.faults.policyResponse = 'malformed';
    if (failure === 'timeout') api.faults.policyResponse = 'hang-body';
    const popup = await app.popup.open();
    await popup.reload();
    await expect(popup.locator('#plugin-update-notice')).toContainText(
      'Не удалось проверить обновления',
    );
    await expect(popup.locator('.record-section__button_record-stop')).toBeEnabled();
    expect(await app.storage.files()).toEqual(before);
    expect((await app.storage.read()).sessionId).toBe('ffffffffffffffffffffffff');
  });
}

test('pre-start check fetches policy again and rejects a new block', async ({
  app,
  api,
  session,
}) => {
  const popup = await reopenWithPolicy(app, api, { latestVersion: session.version });
  await expect(popup.locator('#plugin-update-notice')).toContainText('Новая версия не требуется');
  api.policy.blockedVersions = [session.version];
  const before = api.requests.length;
  const result = await session.controlPage.evaluate(async (url) => {
    const { checkPluginPolicy } = await import('../scripts/plugin-policy.js');
    const notices = [];
    try {
      await checkPluginPolicy(
        { server_connection: true, server_url: url },
        async (messages, title) => notices.push(title),
      );
      return { blocked: false, notices };
    } catch (error) {
      return { blocked: error.notified === true, notices };
    }
  }, api.url);
  expect(result.blocked).toBe(true);
  expect(result.notices).toHaveLength(1);
  expect(result.notices[0]).toContain('ЗАПИСЬ ЗАБЛОКИРОВАНА');
  expect(api.requests.length).toBe(before + 1);
});

test('offline popup makes no policy request', async ({ createScenario }) => {
  const { app, api } = await createScenario({
    settings: { server_connection: false, local_video_saving: true },
  });
  const popup = await app.popup.open();
  await expect(popup.locator('#plugin-update-notice')).toContainText('Автономный режим');
  expect(api.requests).toHaveLength(0);
});

test('native Chrome action popup checks updates and closes on focus loss without losing OPFS', async ({
  app,
  api,
  session,
}) => {
  await app.storage.seedPendingRecording();
  const before = await app.storage.files();
  api.policy.latestVersion = '999.0.0';
  const count = api.requests.length,
    popup = await openNativePopup(session);
  await expect
    .poll(
      async () =>
        /999\.0\.0/.test(
          await popup.evaluate('document.querySelector("#plugin-update-notice").textContent'),
        ),
      { message: 'native popup update notice', timeout: 15000 },
    )
    .toBeTruthy();
  expect(
    api.requests.slice(count).some((call) => call.path.endsWith('/plugin_policy')),
  ).toBeTruthy();
  await session.controlPage.bringToFront();
  await expect
    .poll(
      async () =>
        !(await session.cdp.send('Target.getTargets')).targetInfos.some(
          (t) => t.targetId === popup.targetId,
        ),
      { message: 'native popup closes on blur', timeout: 15000 },
    )
    .toBeTruthy();
  expect(await app.storage.files()).toEqual(before);
  expect((await app.storage.read()).bState).toBe('failedUpload');
});

test('policy request failure before real Start keeps files empty and explains refusal', async ({
  app,
  api,
  recording,
}) => {
  await recording.grantPermissions();
  await app.popup.fillForm();
  api.faults.policyStatus = 503;
  await (await app.popup.open()).locator('.record-section__button_record-start').click();
  await app.media.dismissDialog('Запись не начата');
  await expect
    .poll(async () => (await app.storage.read()).bState === 'needPermissions', {
      message: 'policy refusal state',
      timeout: 15000,
    })
    .toBeTruthy();
  expect(await app.storage.files()).toEqual([]);
  expect(api.sessions.size).toBe(0);
});

for (const kind of ['unknown', 'unsupported'])
  for (const blocked of [false, true])
    test(`${kind} version notice respects blocking switch ${blocked}`, async ({
      app,
      api,
      session,
    }) => {
      Object.assign(
        api.policy,
        kind === 'unknown'
          ? { knownVersions: ['999.0.0'], blockUnknown: blocked }
          : { blockedVersions: [session.version], blockUnsupported: blocked },
      );
      const page = await app.popup.open();
      await page.reload();
      const title = blocked
        ? 'Обновите расширение: начало записи запрещено'
        : kind === 'unknown'
          ? 'Версия расширения не найдена среди выпущенных'
          : 'Версия расширения не поддерживается';
      await page.locator('#plugin-update-notice strong').filter({ hasText: title }).waitFor();
      expect((await app.storage.read()).bState).toBe('needPermissions');
      expect(api.sessions.size).toBe(0);
    });
