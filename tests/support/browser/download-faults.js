/** Reject exactly one download at the browser boundary, then always restore the native API. */
export async function withDownloadFailure(page, action, { at = 1 } = {}) {
  const rollback = await page.evaluateHandle((at) => {
    const original = chrome.downloads.download;
    let calls = 0;
    chrome.downloads.download = (options, callback) => {
      if (++calls === at) {
        callback(undefined);
        return;
      }
      return original.call(chrome.downloads, options, callback);
    };
    return () => {
      chrome.downloads.download = original;
    };
  }, at);
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
