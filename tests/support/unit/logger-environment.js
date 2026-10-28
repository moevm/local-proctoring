import { loadClientModule } from './load-client-module.js';
import { createChromeStorage } from './fake-chrome.js';
async function createLoggerEnvironment(initial = {}, flags = {}) {
  const saved = createChromeStorage(initial),
    chrome = { storage: { local: saved.local }, runtime: {} };
  const set = chrome.storage.local.set;
  chrome.storage.local.set = (values, callback) => {
    if (flags.writeError && 'extension_logs' in values) {
      chrome.runtime.lastError = { message: 'Synthetic storage quota failure' };
      callback?.();
      delete chrome.runtime.lastError;
      return Promise.resolve();
    }
    return set(values, callback);
  };
  const api = await loadClientModule('logger.js', {
    chrome,
    setTimeout: (fn) => {
      fn();
      return 0;
    },
  });
  return { ...api, state: saved.state, flags };
}
export { createLoggerEnvironment };
