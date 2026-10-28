import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const API_PREFIX = '/api/remoteSessions';
const SESSION_COOKIE = 'mock_session=student';
const validVersion = (value) =>
  typeof value === 'string' &&
  /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(value) &&
  value.split('.').every((part) => Number(part) <= 65535);
const compare = (left, right) => {
  const a = left.split('.').map(Number),
    b = right.split('.').map(Number);
  for (let i = 0; i < 4; i++)
    if ((a[i] || 0) !== (b[i] || 0)) return Math.sign((a[i] || 0) - (b[i] || 0));
  return 0;
};
function defaultPolicy(version) {
  return {
    latestVersion: version,
    minimumVersion: null,
    blockedVersions: [],
    requireVersion: false,
    blockOutdated: false,
    blockUnknown: false,
    blockUnsupported: true,
  };
}
function blocksVersion(policy, version) {
  if (!version) return policy.requireVersion;
  const has = (list) => (list || []).some((item) => compare(item, version) === 0);
  const unsupported =
    has(policy.blockedVersions) ||
    (policy.minimumVersion && compare(version, policy.minimumVersion) < 0);
  const outdated =
    has(policy.deprecatedVersions) ||
    (policy.latestVersion && compare(version, policy.latestVersion) < 0);
  const unknown =
    has(policy.unknownVersions) || (policy.knownVersions?.length && !has(policy.knownVersions));
  return (
    (unsupported && policy.blockUnsupported !== false) ||
    (outdated && policy.blockOutdated) ||
    (unknown && policy.blockUnknown)
  );
}

// One instance per test. No Mongo, Docker, production credentials or external requests.
async function createMockProctoringApi({ version, directory, port = 0 }) {
  const sockets = new Set(),
    activeUploads = new Set(),
    pendingUploads = new Set();
  const api = {
    policy: defaultPolicy(version),
    faults: {
      policyStatus: 200,
      policyResponse: 'json',
      startStatus: 200,
      statusStatus: 200,
      uploadStatus: 200,
      delayUpload: false,
      invalidACK: false,
      loseUploadResponse: false,
      processingStarted: true,
    },
    requests: [],
    uploads: [],
    sessions: new Map(),
    errors: [],
    createSession(values = {}) {
      const id = values.id || (api.sessions.size + 1).toString(16).padStart(24, '0');
      api.sessions.set(id, { owner: 'student', saved: false, processingStarted: false, ...values });
      return id;
    },
    releaseUpload() {
      for (const resolve of pendingUploads) resolve();
      pendingUploads.clear();
    },
  };
  function reply(response, status, data) {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    });
    response.end(JSON.stringify(data));
  }
  function findSession(id, owner, response) {
    if (!/^[a-f0-9]{24}$/.test(id || '')) {
      reply(response, 400, { error: 'Invalid session ID' });
      return;
    }
    const session = api.sessions.get(id);
    if (!session) {
      reply(response, 404, { error: 'Session not found' });
      return;
    }
    if (session.owner !== owner) {
      reply(response, 403, { error: 'Session access denied' });
      return;
    }
    return session;
  }
  async function formData(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) throw new Error('Mock request exceeds 32 MiB test limit');
      chunks.push(chunk);
    }
    return new Request('http://mock.test', {
      method: 'POST',
      headers: request.headers,
      body: Buffer.concat(chunks),
    }).formData();
  }
  async function handle(request, response) {
    const url = new URL(request.url, 'http://mock.test');
    api.requests.push({
      method: request.method,
      path: url.pathname,
      cookie: request.headers.cookie || '',
    });
    if (url.pathname === '/' && request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body><h1>Synthetic page</h1></body></html>');
      return;
    }
    const route = url.pathname.startsWith(API_PREFIX + '/')
      ? url.pathname.slice(API_PREFIX.length)
      : '';
    if (!route) return reply(response, 404, { error: 'Unknown route' });
    const owner = /(?:^|;\s*)mock_session=(student|other)(?:;|$)/.exec(
      request.headers.cookie || '',
    )?.[1];
    if (!owner) return reply(response, 401, { error: 'Login required' });
    if (request.method === 'GET' && route === '/plugin_policy') {
      if (api.faults.policyResponse === 'hang') return;
      if (api.faults.policyResponse === 'hang-body') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write('{');
        return;
      }
      if (api.faults.policyResponse === 'malformed') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{');
        return;
      }
      return reply(response, api.faults.policyStatus, api.policy);
    }
    if (request.method === 'GET' && route.startsWith('/status/')) {
      const session = findSession(route.slice('/status/'.length), owner, response);
      if (!session) return;
      return reply(response, api.faults.statusStatus, {
        videosSaved: session.saved,
        processingStarted: session.processingStarted,
      });
    }
    if (request.method !== 'POST' || !['/start_session', '/upload_video'].includes(route))
      return reply(response, 404, { error: 'Unknown route' });
    let form;
    try {
      form = await formData(request);
    } catch {
      return reply(response, 400, { error: 'Invalid multipart body' });
    }
    if (route === '/start_session') {
      if (api.faults.startStatus !== 200)
        return reply(response, api.faults.startStatus, { error: 'Synthetic start refusal' });
      const version = form.get('plugin_version');
      if (version !== null && !validVersion(version))
        return reply(response, 400, { error: 'Invalid plugin_version' });
      if (blocksVersion(api.policy, version))
        return reply(response, 426, {
          error: 'Update required',
          code: 'PLUGIN_UPDATE_REQUIRED',
          policy: api.policy,
        });
      for (const key of ['group', 'surname', 'name', 'title', 'patronymic']) {
        const value = form.get(key) ?? '';
        if (
          typeof value !== 'string' ||
          value.length > 1000 ||
          (key !== 'patronymic' && !value.trim())
        )
          return reply(response, 400, { error: 'Invalid session field: ' + key });
      }
      return reply(response, 201, {
        id: api.createSession({ owner, form: Object.fromEntries(form) }),
      });
    }
    const id = form.get('id'),
      session = findSession(id, owner, response);
    if (!session) return;
    if (session.saved || activeUploads.has(id))
      return reply(response, 409, {
        error: 'Session already uploaded or upload in progress',
        videosSaved: session.saved,
      });
    let metadata;
    try {
      metadata = JSON.parse(form.get('metadata') || '{}');
    } catch {
      return reply(response, 400, { error: 'Invalid metadata JSON' });
    }
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object')
      return reply(response, 400, { error: 'Invalid metadata' });
    const screens = form.getAll('screen_video'),
      cameras = form.getAll('camera_video');
    if (
      !screens.length ||
      (!cameras.length && metadata.no_stream_confirm?.camera !== true) ||
      [...screens, ...cameras].some((file) => !(file instanceof Blob) || !file.size)
    )
      return reply(response, 400, {
        error: 'Expected screen video and camera unless explicitly absent',
      });
    if (form.has('logs')) {
      try {
        const entry = form.get('logs');
        const logs = JSON.parse(entry instanceof Blob ? await entry.text() : entry);
        if (!Array.isArray(logs) || logs.length > 20000) throw new Error('Invalid logs');
      } catch {
        return reply(response, 400, { error: 'Invalid logs JSON' });
      }
    }
    activeUploads.add(id);
    try {
      const files = [];
      for (const [field, value] of form)
        if (['screen_video', 'camera_video'].includes(field)) {
          const file = path.join(directory, `upload-${api.uploads.length}-${files.length}.webm`);
          fs.writeFileSync(file, Buffer.from(await value.arrayBuffer()));
          files.push({ field, file, name: value.name });
        }
      api.uploads.push({ id, files, metadata });
      if (api.faults.delayUpload) await new Promise((resolve) => pendingUploads.add(resolve));
      if (api.faults.uploadStatus !== 200)
        return reply(response, api.faults.uploadStatus, {
          error: 'Synthetic upload refusal',
          videosSaved: false,
        });
      if (api.faults.invalidACK) return reply(response, 200, { success: false });
      session.saved = true;
      session.processingStarted = api.faults.processingStarted;
      if (api.faults.loseUploadResponse) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write('{');
        setTimeout(() => response.destroy(), 20);
        return;
      }
      if (!session.processingStarted)
        return reply(response, 503, {
          error: 'Videos saved; processing could not start',
          videosSaved: true,
        });
      return reply(response, 200, { success: true, videosSaved: true, id });
    } finally {
      activeUploads.delete(id);
    }
  }
  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      api.errors.push(error.message);
      if (!response.headersSent) reply(response, 500, { error: 'Mock failure' });
      else response.destroy();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  api.baseUrl = `http://127.0.0.1:${server.address().port}`;
  api.url = api.baseUrl + API_PREFIX;
  api.cookie = { name: 'mock_session', value: 'student', url: api.baseUrl };
  api.close = async () => {
    api.releaseUpload();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  };
  return api;
}
export { createMockProctoringApi, defaultPolicy, SESSION_COOKIE, API_PREFIX };
