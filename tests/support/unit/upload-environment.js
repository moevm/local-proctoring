import { loadClientModule } from './load-client-module.js';
export const id = '123456789012345678901234';
export const names = [
  'proctoring_screen_2026-10-15T10:00:00.001Z.webm',
  'proctoring_camera_2026-10-15T10:00:00.001Z.webm',
];
export const settings = {
  server_connection: true,
  local_video_saving: false,
  server_url: 'https://example.test/api/remoteSessions',
};

// Unit-only Chrome/OPFS doubles. Browser tests use real Chrome and the HTTP mock API.
export async function createUploadEnvironment() {
  const env = {
    state: {},
    disk: new Map(),
    changes: new Set(),
    interrupted: false,
    removeFailures: new Set(),
    reset() {
      this.state = { sessionId: id, tempFiles: [...names], metadata: {}, extension_logs: '[]' };
      this.disk = new Map(names.map((name) => [name, new Blob(['video'])]));
      this.interrupted = false;
      this.removeFailures.clear();
    },
  };
  env.reset();
  const chrome = {
    runtime: {},
    storage: {
      local: {
        get(keys, callback) {
          const result =
            keys === null
              ? { ...env.state }
              : Object.fromEntries([].concat(keys).map((key) => [key, env.state[key]]));
          callback?.(result);
          return Promise.resolve(result);
        },
        set(values, callback) {
          Object.assign(env.state, values);
          callback?.();
          return Promise.resolve();
        },
        remove(keys, callback) {
          [].concat(keys).forEach((key) => delete env.state[key]);
          callback?.();
          return Promise.resolve();
        },
      },
    },
    alarms: {
      get(name, callback) {
        callback();
      },
    },
    downloads: {
      onChanged: {
        addListener: (fn) => env.changes.add(fn),
        removeListener: (fn) => env.changes.delete(fn),
      },
      async download() {
        setTimeout(
          () =>
            env.changes.forEach((fn) =>
              fn({ id: 1, state: { current: env.interrupted ? 'interrupted' : 'complete' } }),
            ),
          1,
        );
        return 1;
      },
      async search() {
        return [{ id: 1, state: 'in_progress' }];
      },
    },
  };
  const navigator = {
    storage: {
      getDirectory: async () => ({
        getFileHandle: async (name) => ({
          getFile: async () => {
            if (!env.disk.has(name)) throw new Error('Missing file');
            return env.disk.get(name);
          },
        }),
        removeEntry: async (name) => {
          if (env.removeFailures.has(name)) throw new Error('Disk error');
          env.disk.delete(name);
        },
      }),
    },
  };
  env.fetch = async () => {
    throw new Error('Set environment.fetch before a network operation');
  };
  const globals = { chrome, navigator, fetch: (...args) => env.fetch(...args) };
  env.client = await loadClientModule('upload.js', globals);
  const downloads = await loadClientModule('download.js', globals);
  env.downloadBlob = downloads.downloadBlob;
  return env;
}
