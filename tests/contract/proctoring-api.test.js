import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMockProctoringApi, SESSION_COOKIE } from '../mocks/proctoring-api.js';

let api, directory;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mock-api-contract-'));
  api = await createMockProctoringApi({ version: '3.1.0', directory });
});
afterEach(async () => {
  await api.close();
  await fs.rm(directory, { recursive: true, force: true });
});
function request(route, options = {}) {
  return fetch(api.url + route, {
    ...options,
    headers: { Cookie: SESSION_COOKIE, ...options.headers },
  });
}
function sessionForm(values = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    group: '9999',
    surname: 'Тестовый',
    name: 'Студент',
    title: 'Mock contract test',
    plugin_version: '3.1.0',
    ...values,
  }))
    form.set(key, value);
  return form;
}
function videoForm(id, { camera = true, metadata = {} } = {}) {
  const form = new FormData();
  form.set('id', id);
  form.set('metadata', JSON.stringify(metadata));
  form.append(
    'screen_video',
    new Blob(['synthetic screen'], { type: 'video/webm' }),
    'screen.webm',
  );
  if (camera)
    form.append(
      'camera_video',
      new Blob(['synthetic camera'], { type: 'video/webm' }),
      'camera.webm',
    );
  form.append('logs', new Blob(['[]'], { type: 'application/json' }), 'logs.json');
  return form;
}

test('mock requires the session cookie and rejects another owner', async () => {
  assert.equal((await request('/plugin_policy', { headers: { Cookie: '' } })).status, 401);
  const id = api.createSession({ owner: 'other' });
  assert.equal((await request('/status/' + id)).status, 403);
  assert.equal(
    (await request('/status/' + id, { headers: { Cookie: 'mock_session=other' } })).status,
    200,
  );
});

test('mock returns policy with no-store and rejects unknown routes or sessions', async () => {
  const policy = await request('/plugin_policy');
  assert.match(policy.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await policy.json(), api.policy);
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/status/ffffffffffffffffffffffff')).status, 404);
  assert.equal((await request('/status/not-an-id')).status, 400);
});

test('multipart start returns 201 and a 24-character ID with an unsaved status', async () => {
  const response = await request('/start_session', { method: 'POST', body: sessionForm() });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.match(id, /^[a-f0-9]{24}$/);
  assert.deepEqual(await (await request('/status/' + id)).json(), {
    videosSaved: false,
    processingStarted: false,
  });
});

test('start validates required fields, field limits and plugin version', async () => {
  for (const values of [
    { title: '' },
    { name: 'a'.repeat(1001) },
    { plugin_version: 'not-a-version' },
  ]) {
    assert.equal(
      (await request('/start_session', { method: 'POST', body: sessionForm(values) })).status,
      400,
    );
  }
  assert.equal(api.sessions.size, 0);
});

test('server policy blocks starting with 426 but permits existing-session status', async () => {
  const id = api.createSession();
  api.policy.blockedVersions = ['3.1'];
  const response = await request('/start_session', { method: 'POST', body: sessionForm() });
  assert.equal(response.status, 426);
  assert.equal((await response.json()).code, 'PLUGIN_UPDATE_REQUIRED');
  assert.equal((await request('/status/' + id)).status, 200);
});

test('valid multipart upload returns ACK and prevents overwriting saved video', async () => {
  const id = api.createSession();
  const response = await request('/upload_video', { method: 'POST', body: videoForm(id) });
  assert.deepEqual(await response.json(), { success: true, videosSaved: true, id });
  assert.deepEqual(await (await request('/status/' + id)).json(), {
    videosSaved: true,
    processingStarted: true,
  });
  assert.equal(api.uploads[0].files.length, 2);
  assert.equal(
    (await request('/upload_video', { method: 'POST', body: videoForm(id) })).status,
    409,
  );
  assert.equal(api.uploads.length, 1);
});

test('screen-only upload requires an explicit no-camera confirmation', async () => {
  const id = api.createSession();
  assert.equal(
    (await request('/upload_video', { method: 'POST', body: videoForm(id, { camera: false }) }))
      .status,
    400,
  );
  assert.equal(
    (
      await request('/upload_video', {
        method: 'POST',
        body: videoForm(id, { camera: false, metadata: { no_stream_confirm: { camera: true } } }),
      })
    ).status,
    200,
  );
});

test('queue failure returns 503 with saved videos and does not allow re-upload', async () => {
  const id = api.createSession();
  api.faults.processingStarted = false;
  const response = await request('/upload_video', { method: 'POST', body: videoForm(id) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).videosSaved, true);
  assert.deepEqual(await (await request('/status/' + id)).json(), {
    videosSaved: true,
    processingStarted: false,
  });
  assert.equal(
    (await request('/upload_video', { method: 'POST', body: videoForm(id) })).status,
    409,
  );
});

test('lost response still commits server state for status-based recovery', async () => {
  const id = api.createSession();
  api.faults.loseUploadResponse = true;
  const response = await request('/upload_video', { method: 'POST', body: videoForm(id) });
  await assert.rejects(response.json());
  assert.deepEqual(await (await request('/status/' + id)).json(), {
    videosSaved: true,
    processingStarted: true,
  });
});

test('parallel upload is rejected while the first request waits for its ACK', async () => {
  const id = api.createSession();
  api.faults.delayUpload = true;
  const pending = request('/upload_video', { method: 'POST', body: videoForm(id) });
  try {
    for (let i = 0; i < 100 && api.uploads.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(api.uploads.length, 1);
    assert.equal(
      (await request('/upload_video', { method: 'POST', body: videoForm(id) })).status,
      409,
    );
  } finally {
    api.releaseUpload();
    await pending;
  }
});
