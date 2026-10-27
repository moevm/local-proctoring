/** Minimal Chrome event implementation: tests explicitly deliver events with fire(). */
export function createChromeEvent() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    fire(...args) {
      return [...listeners].map((listener) => listener(...args));
    },
    get size() {
      return listeners.size;
    },
  };
}

/** Chrome storage callback and Promise forms, backed by one fresh object per test. */
export function createChromeStorage(initial = {}) {
  const state = structuredClone(initial);
  return {
    state,
    local: {
      get(keys, callback) {
        const values =
          keys === null
            ? { ...state }
            : Object.fromEntries([].concat(keys).map((key) => [key, state[key]]));
        callback?.(values);
        return Promise.resolve(values);
      },
      set(values, callback) {
        Object.assign(state, values);
        callback?.();
        return Promise.resolve();
      },
      remove(keys, callback) {
        [].concat(keys).forEach((key) => delete state[key]);
        callback?.();
        return Promise.resolve();
      },
    },
  };
}
