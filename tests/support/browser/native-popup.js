export async function openNativePopup(session) {
  const { context, cdp, controlPage: observer, url: extension } = session;
  await observer.bringToFront();
  await context.serviceWorkers()[0].evaluate(() => chrome.action.openPopup());
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((t) => t.url === extension + '/pages/index.html' && !t.attached);
  if (!target) throw new Error('Native Chrome popup target was not created');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  });
  let sequence = 0;
  async function evaluate(expression) {
    const id = ++sequence;
    let listener, timer;
    const response = new Promise((resolve, reject) => {
      listener = (event) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id === id)
          message.error ? reject(Error(message.error.message)) : resolve(message.result);
      };
      cdp.on('Target.receivedMessageFromTarget', listener);
      timer = setTimeout(() => reject(Error('Native popup evaluation timed out')), 5000);
    });
    try {
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      });
      const result = await response;
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
      return result.result.value;
    } finally {
      clearTimeout(timer);
      cdp.off('Target.receivedMessageFromTarget', listener);
    }
  }
  return { targetId: target.targetId, evaluate };
}
