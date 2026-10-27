/** Serialized by Playwright and executed in Chrome. Produces a real, short WebM. */
export async function recordSyntheticVideo() {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext('2d');
  context.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(10);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  const drawing = setInterval(() => {
    context.fillStyle = context.fillStyle === '#008000' ? 'blue' : 'green';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, 40);
  try {
    const result = new Promise((resolve) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    // This is the duration of generated media, not a synchronization delay.
    setTimeout(() => recorder.stop(), 1000);
    return Array.from(new Uint8Array(await (await result).arrayBuffer()));
  } finally {
    clearInterval(drawing);
    stream.getTracks().forEach((track) => track.stop());
  }
}
