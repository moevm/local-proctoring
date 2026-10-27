import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadEnvironment } from '../support/unit/upload-environment.js';
let environment;
beforeEach(async () => {
  environment = await createUploadEnvironment();
});
import { id, names, settings } from '../support/unit/upload-environment.js';
test('OPFS files are sent with explicit MIME video/webm and correct API field names', async () => {
  const form = await environment.client.buildPayload(names, id, {}, '[]');
  assert.equal(form.get('screen_video').type, 'video/webm');
  assert.equal(form.get('camera_video').type, 'video/webm');
  assert.equal(form.get('id'), id);
});

test('authentication uses cookies and 401 rejects instead of reporting success', async () => {
  environment.fetch = async (url, options) => {
    assert.equal(options.credentials, 'include');
    return { ok: false, status: 401, json: async () => ({}) };
  };
  await assert.rejects(environment.client.requestJSON('https://example.test'), /Войдите/);
});

test('upload failure preserves all OPFS files, metadata and session ID', async () => {
  let calls = 0;
  environment.fetch = async () =>
    ++calls === 1
      ? { ok: true, json: async () => ({ videosSaved: false }) }
      : {
          ok: false,
          status: 503,
          json: async () => ({ videosSaved: true, error: 'Queue failed' }),
        };
  await assert.rejects(environment.client.uploadSession(settings));
  assert.equal(environment.state.sessionId, id);
  assert.equal(environment.disk.size, 2);
  assert.ok(environment.state.metadata);
});

test('retry after saved response loss checks status and does not upload twice', async () => {
  let calls = 0;
  environment.state.uploadAttempt = {
    sessionId: id,
    server: settings.server_url,
    files: names.map((name) => ({ name, size: environment.disk.get(name).size })),
  };
  environment.fetch = async (url) => {
    calls++;
    assert.ok(url.includes('/status/'));
    return { ok: true, json: async () => ({ videosSaved: true, processingStarted: true }) };
  };
  await environment.client.uploadSession(settings);
  assert.equal(calls, 1);
  assert.equal(environment.disk.size, 0);
  assert.equal(environment.state.sessionId, undefined);
});

test('saved videos with failed queue are retained locally and not uploaded again', async () => {
  environment.fetch = async () => ({
    ok: true,
    json: async () => ({ videosSaved: true, processingStarted: false }),
  });
  await assert.rejects(environment.client.uploadSession(settings), /преподавателя/);
  assert.equal(environment.disk.size, 2);
  assert.equal(environment.state.sessionId, id);
});

test('HTTP 200 without an explicit saved confirmation never deletes originals', async () => {
  let calls = 0;
  environment.fetch = async () => ({
    ok: true,
    json: async () => (++calls === 1 ? { videosSaved: false } : { success: false }),
  });
  await assert.rejects(environment.client.uploadSession(settings), /подтвердил/);
  assert.equal(environment.disk.size, 2);
  assert.equal(environment.state.sessionId, id);
});

test('explicit successful upload allows cleanup', async () => {
  let calls = 0;
  environment.fetch = async () => ({
    ok: true,
    json: async () =>
      ++calls === 1 ? { videosSaved: false } : { success: true, videosSaved: true },
  });
  await environment.client.uploadSession(settings);
  assert.equal(environment.disk.size, 0);
  assert.equal(environment.state.sessionId, undefined);
});

test('cancelled download rejects and keeps local-only recordings', async () => {
  environment.interrupted = true;
  await assert.rejects(
    environment.client.uploadSession({
      ...settings,
      local_video_saving: true,
      server_connection: false,
    }),
    /прервано/,
  );
  assert.equal(environment.disk.size, 2);
  assert.equal(environment.state.sessionId, id);
  assert.equal(environment.changes.size, 0);
});

test('confirmed local downloads allow cleanup only after completion', async () => {
  await environment.client.uploadSession({
    ...settings,
    local_video_saving: true,
    server_connection: false,
  });
  assert.equal(environment.disk.size, 0);
  assert.equal(environment.state.sessionId, undefined);
  assert.equal(environment.changes.size, 0);
});

test('unknown saved upload never deletes originals', async () => {
  environment.fetch = async () => ({
    ok: true,
    json: async () => ({ videosSaved: true, processingStarted: true }),
  });
  await assert.rejects(environment.client.uploadSession(settings), /состав/);
  assert.equal(environment.disk.size, 2);
  assert.equal(environment.state.sessionId, id);
});

test('new segment after upload attempt is retained and recording cannot resume', async () => {
  environment.state.uploadAttempt = {
    sessionId: id,
    server: settings.server_url,
    files: names.map((name) => ({ name, size: 5 })),
  };
  await assert.rejects(environment.client.assertCanResume(), /Сначала/);
  const extra = 'proctoring_screen_new.webm';
  environment.state.tempFiles.push(extra);
  environment.disk.set(extra, new Blob(['new']));
  environment.fetch = async () => ({
    ok: true,
    json: async () => ({ videosSaved: true, processingStarted: true }),
  });
  await assert.rejects(environment.client.uploadSession(settings), /изменились/);
  assert.equal(environment.disk.size, 3);
});

test('request timeout preserves local state', async () => {
  environment.reset();
  environment.fetch = (url, options) =>
    new Promise((resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('Aborted'))),
    );
  await assert.rejects(
    environment.client.requestJSON('https://example.test', { timeoutMs: 10 }),
    /время ожидания/,
  );
  assert.equal(environment.disk.size, 2);
  assert.equal(environment.state.sessionId, id);
});

test('partial cleanup failure preserves remaining index and metadata; retry is safe', async () => {
  environment.removeFailures.add(names[1]);
  let calls = 0;
  environment.fetch = async () => ({
    ok: true,
    json: async () =>
      ++calls === 1 ? { videosSaved: false } : { success: true, videosSaved: true },
  });
  await assert.rejects(environment.client.uploadSession(settings), /Индекс восстановления/);
  assert.deepEqual(environment.state.tempFiles, [names[1]]);
  assert.equal(environment.state.sessionId, id);
  assert.ok(environment.state.uploadAttempt);
  environment.removeFailures.clear();
  environment.fetch = async () => ({
    ok: true,
    json: async () => ({ videosSaved: true, processingStarted: true }),
  });
  await environment.client.uploadSession(settings);
  assert.equal(environment.disk.size, 0);
  assert.equal(environment.state.sessionId, undefined);
});

for (const status of [401, 403, 500])
  for (const phase of ['status', 'upload']) {
    test(`${status} during ${phase} preserves originals and never confirms upload`, async () => {
      let posts = 0;
      environment.fetch = async (url, options) => {
        if (options.method === 'POST') posts++;
        return phase === 'upload' && url.includes('/status/')
          ? { ok: true, json: async () => ({ videosSaved: false }) }
          : { ok: false, status, json: async () => ({ error: 'Synthetic refusal' }) };
      };
      await assert.rejects(environment.client.uploadSession(settings));
      assert.equal(environment.disk.size, 2);
      assert.equal(environment.state.sessionId, id);
      assert.equal(posts, phase === 'upload' ? 1 : 0);
    });
  }

test('invalid configuration and session ID fail before any network request or file deletion', async () => {
  environment.fetch = async () => assert.fail('Unexpected request');
  await assert.rejects(
    environment.client.uploadSession({
      ...settings,
      server_connection: false,
      local_video_saving: false,
    }),
    /способ/,
  );
  environment.state.sessionId = '../outside';
  await assert.rejects(environment.client.uploadSession(settings), /ID/);
  assert.equal(environment.disk.size, 2);
});

test('empty, camera-only and malformed file payloads are rejected without deleting files', async () => {
  await assert.rejects(environment.client.buildPayload([], id, {}, []));
  await assert.rejects(environment.client.buildPayload([names[1]], id, {}, []), /экрана/);
  await assert.rejects(
    environment.client.buildPayload(['../escape.webm'], id, {}, []),
    /Неизвестный/,
  );
  environment.disk.set(names[0], new Blob([]));
  await assert.rejects(environment.client.buildPayload([names[0]], id, {}, []), /экрана/);
  assert.equal(environment.disk.size, 2);
});

test('combined local/server mode cancels before POST and retains files if a download is interrupted', async () => {
  environment.interrupted = true;
  let posts = 0;
  environment.fetch = async (url, options) => {
    if (options.method === 'POST') posts++;
    return { ok: true, json: async () => ({ videosSaved: false }) };
  };
  await assert.rejects(
    environment.client.uploadSession({ ...settings, local_video_saving: true }),
    /прервано/,
  );
  assert.equal(posts, 0);
  assert.equal(environment.disk.size, 2);
  assert.equal(environment.state.sessionId, id);
});

test('ACK from another session or server never authorizes local cleanup', async () => {
  for (const wrong of [
    { server: 'https://different.test' },
    { sessionId: 'ffffffffffffffffffffffff' },
  ]) {
    environment.reset();
    environment.state.uploadAttempt = {
      sessionId: id,
      server: settings.server_url,
      files: [],
      ...wrong,
    };
    environment.fetch = async () => ({
      ok: true,
      json: async () => ({ videosSaved: true, processingStarted: true }),
    });
    await assert.rejects(environment.client.uploadSession(settings), /состав/);
    assert.equal(environment.disk.size, 2);
  }
});

test('changed file timestamp after an uncertain upload prevents cleanup even at the same size', async () => {
  environment.state.uploadAttempt = {
    sessionId: id,
    server: settings.server_url,
    files: names.map((name) => ({ name, size: environment.disk.get(name).size, lastModified: 1 })),
  };
  for (const file of environment.disk.values()) file.lastModified = 2;
  environment.fetch = async () => ({
    ok: true,
    json: async () => ({ videosSaved: true, processingStarted: true }),
  });
  await assert.rejects(environment.client.uploadSession(settings), /изменились/);
  assert.equal(environment.disk.size, 2);
});

test('invalid JSON and an already aborted signal reject without confirmation', async () => {
  environment.fetch = async () => ({
    ok: true,
    json: async () => {
      throw new Error('Bad JSON');
    },
  });
  await assert.rejects(environment.client.requestJSON(settings.server_url), /JSON/);
  const controller = new AbortController();
  controller.abort();
  environment.fetch = async (url, options) => {
    assert.equal(options.signal.aborted, true);
    throw new Error('Aborted');
  };
  await assert.rejects(
    environment.client.requestJSON(settings.server_url, { signal: controller.signal }),
    /прерван/,
  );
  assert.equal(environment.disk.size, 2);
});
