// Runs inside the test browser, before production media.js. Only browser boundaries are replaced.
const installMediaControls = (faults) => {
  window.__testStreams = {};
  window.__testFaults = { ...faults };
  window.__testTimers = [];
  const nativeTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, milliseconds, ...args) => {
    if (milliseconds === 14400000) window.__testTimers.push(fn);
    return nativeTimeout(fn, milliseconds, ...args);
  };
  if (!location.pathname.endsWith('/media.html')) return;
  // Observe real OPFS writes so lifecycle tests can select a committed boundary.
  window.__pendingOPFSWrites = 0;
  const createWritable = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (...args) {
    window.__pendingOPFSWrites++;
    let released = false;
    const release = () => {
      if (!released) window.__pendingOPFSWrites--;
      released = true;
    };
    try {
      const writer = await createWritable.apply(this, args);
      for (const method of ['close', 'abort']) {
        const original = writer[method].bind(writer);
        writer[method] = async (...values) => {
          try {
            return await original(...values);
          } finally {
            release();
          }
        };
      }
      return writer;
    } catch (error) {
      release();
      throw error;
    }
  };
  const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const kind = constraints.video?.mandatory
      ? 'screen'
      : constraints.video
        ? 'camera'
        : 'microphone';
    const fault = window.__testFaults[kind];
    if (fault) throw new DOMException('Synthetic ' + kind + ' failure', fault);
    const stream = await get(constraints);
    window.__testStreams[kind] = stream;
    return stream;
  };
  if (faults.cancelScreen)
    chrome.desktopCapture.chooseDesktopMedia = (sources, callback) => {
      queueMicrotask(() => callback(''));
      return 0;
    };
  if (faults.lowSpace) navigator.storage.estimate = async () => ({ quota: 1024, usage: 1024 });
};
export { installMediaControls };
