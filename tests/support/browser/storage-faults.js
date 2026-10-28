/** Temporarily replace a browser API; the original function stays in a remote closure, not window. */
export async function withStorageFailure(page, method, action) {
  const rollback = await page.evaluateHandle((method) => {
    const prototype =
      method === 'removeEntry'
        ? FileSystemDirectoryHandle.prototype
        : FileSystemFileHandle.prototype;
    const original = prototype[method];
    const errorName = {
      createWritable: 'QuotaExceededError',
      getFile: 'NotReadableError',
      removeEntry: 'UnknownError',
    }[method];
    if (!errorName) throw new Error('Unsupported OPFS fault: ' + method);
    prototype[method] = async () => {
      throw new DOMException('Injected OPFS failure', errorName);
    };
    return () => {
      prototype[method] = original;
    };
  }, method);
  try {
    return await action();
  } finally {
    try {
      await rollback.evaluate((restore) => restore());
    } finally {
      await rollback.dispose();
    }
  }
}
