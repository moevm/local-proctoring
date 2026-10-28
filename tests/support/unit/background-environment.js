import { loadClientModule } from './load-client-module.js';
import { createChromeEvent, createChromeStorage } from './fake-chrome.js';
async function createBackgroundEnvironment(initial = {}, options = {}) {
  const saved = createChromeStorage(initial),
    sent = [],
    cleared = [],
    updates = [],
    removed = [];
  let tabs = options.tabs || [],
    timer;
  const chrome = {
    storage: { local: saved.local },
    runtime: {
      id: 'trusted',
      getManifest: () => ({ version: '3.1.0' }),
      getURL: (name) => 'chrome-extension://trusted/' + name,
      onStartup: createChromeEvent(),
      onInstalled: createChromeEvent(),
      onMessage: createChromeEvent(),
      sendMessage(message) {
        sent.push(message);
        return Promise.resolve(options.response ?? { accepted: true });
      },
    },
    alarms: {
      onAlarm: createChromeEvent(),
      create() {},
      clear(name) {
        cleared.push(name);
      },
    },
    tabs: {
      onUpdated: createChromeEvent(),
      onRemoved: createChromeEvent(),
      query(query, callback) {
        callback?.(tabs);
        return Promise.resolve(tabs);
      },
      async create() {
        if (options.createFails) throw new Error('Cannot open recording tab');
        return { id: 9 };
      },
      async get() {
        return { id: 9, status: options.loading ? 'loading' : 'complete' };
      },
      async update(id, values) {
        updates.push({ id, values });
      },
      async remove(id) {
        removed.push(id);
      },
    },
  };
  await loadClientModule(
    'background.js',
    {
      chrome,
      setTimeout(callback) {
        timer = callback;
        return 1;
      },
      clearTimeout() {},
    },
    {
      './common.js': { buttonsStatesSave: (value) => saved.local.set({ bState: value }) },
      './logger.js': { logClientAction() {}, clearLogs: async () => {} },
    },
  );
  async function message(value, sender = { id: 'trusted' }) {
    let reply;
    const results = chrome.runtime.onMessage.fire(value, sender, (response) => {
      reply = response;
    });
    for (let i = 0; i < 15 && reply === undefined; i++) await Promise.resolve();
    return { reply, results };
  }
  return {
    saved: saved.state,
    chrome,
    sent,
    cleared,
    updates,
    removed,
    message,
    timeout: () => timer(),
  };
}
export { createBackgroundEnvironment };
