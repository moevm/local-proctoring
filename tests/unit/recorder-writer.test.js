import test from 'node:test';
import assert from 'node:assert/strict';
import { attachRecorderWriter } from '../../client/scripts/recorder-writer.js';
test('writer serializes overlapping chunks and waits for the final chunk on stop', async () => {
  class Recorder extends EventTarget {
    state = 'recording';
    data(text) {
      const e = new Event('dataavailable');
      e.data = new Blob([text]);
      this.dispatchEvent(e);
    }
    stop() {
      this.state = 'inactive';
      setTimeout(() => {
        this.data('final');
        this.dispatchEvent(new Event('stop'));
      }, 1);
    }
  }
  let content = '',
    writing = false;
  const handle = {
    getFile: async () => ({ size: content.length }),
    createWritable: async () => {
      assert.equal(writing, false);
      writing = true;
      return {
        async write({ data, position }) {
          assert.equal(position, content.length);
          await new Promise((r) => setTimeout(r, 2));
          content += await data.text();
        },
        async close() {
          writing = false;
        },
        async abort() {
          writing = false;
        },
      };
    },
  };
  const recorder = new Recorder(),
    writer = attachRecorderWriter(recorder, () => handle);
  recorder.data('first');
  recorder.data('second');
  const stopping = writer.stop();
  assert.equal(stopping, writer.stop());
  await stopping;
  assert.equal(content, 'firstsecondfinal');
});

test('write failure rejects finalization instead of silently losing data', async () => {
  const recorder = new EventTarget();
  recorder.state = 'inactive';
  const writer = attachRecorderWriter(recorder, () => ({
    getFile: async () => {
      throw new Error('Disk full');
    },
  }));
  const event = new Event('dataavailable');
  event.data = new Blob(['data']);
  recorder.dispatchEvent(event);
  await assert.rejects(writer.stop(), /Disk full/);
});
