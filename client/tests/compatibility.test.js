import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, createPublicKey } from 'node:crypto';
import { attachRecorderWriter } from '../scripts/recorder-writer.js';
import { downloadBlob } from '../scripts/download.js';

test('unpacked distribution keeps the shared extension ID', async () => {
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    const der = Buffer.from(manifest.key, 'base64');
    assert.equal(createPublicKey({ key: der, type: 'spki', format: 'der' }).asymmetricKeyType, 'rsa');
    const id = [...createHash('sha256').update(der).digest().subarray(0, 16)]
        .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
    assert.equal(id, 'nlhjjbgkbfkopkigkbkojpkbffbkeohg');
});

const nativeInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
let state = {}, disk = new Map(), changes = new Set(), interrupted = false, removeFailures = new Set();
const storage = {
    get(keys, callback) {
        const result = keys === null ? { ...state } : Object.fromEntries([].concat(keys).map(key => [key, state[key]]));
        if (callback) callback(result);
        return Promise.resolve(result);
    },
    set(values, callback) { Object.assign(state, values); callback?.(); return Promise.resolve(); },
    remove(keys, callback) { [].concat(keys).forEach(key => delete state[key]); callback?.(); return Promise.resolve(); }
};
globalThis.chrome = {
    runtime: {}, storage: { local: storage },
    alarms: { get(name, callback) { callback(); } },
    downloads: {
        onChanged: { addListener: fn => changes.add(fn), removeListener: fn => changes.delete(fn) },
        async download() {
            setTimeout(() => changes.forEach(fn => fn({ id: 1, state: { current: interrupted ? 'interrupted' : 'complete' } })), 1);
            return 1;
        },
        async search() { return [{ id: 1, state: 'in_progress' }]; }
    }
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => ({
    getFileHandle: async name => ({ getFile: async () => { if (!disk.has(name)) throw new Error('Missing file'); return disk.get(name); } }),
    removeEntry: async name => { if (removeFailures.has(name)) throw new Error('Disk error'); disk.delete(name); }
}) } } });
const { uploadSession, buildPayload, requestJSON, assertCanResume } = await import('../scripts/upload.js');
globalThis.setInterval = nativeInterval;
const id = '123456789012345678901234';
const names = ['proctoring_screen_2026-10-15T10:00:00.001Z.webm', 'proctoring_camera_2026-10-15T10:00:00.001Z.webm'];
const settings = { server_connection: true, local_video_saving: false, server_url: 'https://example.test/api/remoteSessions' };
function reset() {
    state = { sessionId: id, tempFiles: [...names], metadata: {}, extension_logs: '[]' };
    disk = new Map(names.map(name => [name, new Blob(['video'])]));
    interrupted = false; removeFailures.clear();
}
test('OPFS files are sent with explicit MIME video/webm and correct API field names', async () => {
    reset(); const form = await buildPayload(names, id, {}, '[]');
    assert.equal(form.get('screen_video').type, 'video/webm');
    assert.equal(form.get('camera_video').type, 'video/webm');
    assert.equal(form.get('id'), id);
});
test('authentication uses cookies and 401 rejects instead of reporting success', async () => {
    globalThis.fetch = async (url, options) => { assert.equal(options.credentials, 'include'); return { ok: false, status: 401, json: async () => ({}) }; };
    await assert.rejects(requestJSON('https://example.test'), /Войдите/);
});
test('upload failure preserves all OPFS files, metadata and session ID', async () => {
    reset(); let calls = 0;
    globalThis.fetch = async () => ++calls === 1 ?
        { ok: true, json: async () => ({ videosSaved: false }) } :
        { ok: false, status: 503, json: async () => ({ videosSaved: true, error: 'Queue failed' }) };
    await assert.rejects(uploadSession(settings));
    assert.equal(state.sessionId, id); assert.equal(disk.size, 2); assert.ok(state.metadata);
});
test('retry after saved response loss checks status and does not upload twice', async () => {
    reset(); let calls = 0;
    state.uploadAttempt = { sessionId: id, server: settings.server_url, files: names.map(name => ({ name, size: disk.get(name).size })) };
    globalThis.fetch = async url => { calls++; assert.ok(url.includes('/status/')); return { ok: true, json: async () => ({ videosSaved: true, processingStarted: true }) }; };
    await uploadSession(settings);
    assert.equal(calls, 1); assert.equal(disk.size, 0); assert.equal(state.sessionId, undefined);
});
test('saved videos with failed queue are retained locally and not uploaded again', async () => {
    reset(); globalThis.fetch = async () => ({ ok: true, json: async () => ({ videosSaved: true, processingStarted: false }) });
    await assert.rejects(uploadSession(settings), /преподавателя/);
    assert.equal(disk.size, 2); assert.equal(state.sessionId, id);
});
test('HTTP 200 without an explicit saved confirmation never deletes originals', async () => {
    reset(); let calls = 0;
    globalThis.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { videosSaved: false } : { success: false } });
    await assert.rejects(uploadSession(settings), /подтвердил/);
    assert.equal(disk.size, 2); assert.equal(state.sessionId, id);
});
test('explicit successful upload allows cleanup', async () => {
    reset(); let calls = 0;
    globalThis.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { videosSaved: false } : { success: true, videosSaved: true } });
    await uploadSession(settings);
    assert.equal(disk.size, 0); assert.equal(state.sessionId, undefined);
});
test('cancelled download rejects and keeps local-only recordings', async () => {
    reset(); interrupted = true;
    await assert.rejects(uploadSession({ ...settings, local_video_saving: true, server_connection: false }), /прервано/);
    assert.equal(disk.size, 2); assert.equal(state.sessionId, id); assert.equal(changes.size, 0);
});
test('confirmed local downloads allow cleanup only after completion', async () => {
    reset(); await uploadSession({ ...settings, local_video_saving: true, server_connection: false });
    assert.equal(disk.size, 0); assert.equal(state.sessionId, undefined); assert.equal(changes.size, 0);
});
test('writer serializes overlapping chunks and waits for the final chunk on stop', async () => {
    class Recorder extends EventTarget {
        state = 'recording';
        data(text) { const e = new Event('dataavailable'); e.data = new Blob([text]); this.dispatchEvent(e); }
        stop() { this.state = 'inactive'; setTimeout(() => { this.data('final'); this.dispatchEvent(new Event('stop')); }, 1); }
    }
    let content = '', writing = false;
    const handle = { getFile: async () => ({ size: content.length }), createWritable: async () => {
        assert.equal(writing, false); writing = true;
        return { async write({ data, position }) { assert.equal(position, content.length); await new Promise(r => setTimeout(r, 2)); content += await data.text(); },
            async close() { writing = false; }, async abort() { writing = false; } };
    } };
    const recorder = new Recorder(), writer = attachRecorderWriter(recorder, () => handle);
    recorder.data('first'); recorder.data('second');
    const stopping = writer.stop(); assert.equal(stopping, writer.stop()); await stopping;
    assert.equal(content, 'firstsecondfinal');
});
test('write failure rejects finalization instead of silently losing data', async () => {
    const recorder = new EventTarget(); recorder.state = 'inactive';
    const writer = attachRecorderWriter(recorder, () => ({ getFile: async () => { throw new Error('Disk full'); } }));
    const event = new Event('dataavailable'); event.data = new Blob(['data']); recorder.dispatchEvent(event);
    await assert.rejects(writer.stop(), /Disk full/);
});
test('downloads remain alive until completion and remove their listeners', async () => {
    interrupted = false; await downloadBlob(new Blob(['data']), 'test.webm'); assert.equal(changes.size, 0);
});
test('popup delegates upload; update and alarm do not erase recording storage', async () => {
    const popup = await readFile(new URL('../scripts/index.js', import.meta.url), 'utf8');
    const background = await readFile(new URL('../scripts/background.js', import.meta.url), 'utf8');
    assert.ok(popup.includes("action: 'uploadRecord'")); assert.ok(!popup.includes('/upload_video'));
    assert.ok(!background.includes('storage.local.clear(')); assert.ok(!background.includes('await deleteFilesFromTempList()'));
});


test('unknown saved upload never deletes originals', async () => {
    reset(); globalThis.fetch = async () => ({ ok: true, json: async () => ({ videosSaved: true, processingStarted: true }) });
    await assert.rejects(uploadSession(settings), /состав/);
    assert.equal(disk.size, 2); assert.equal(state.sessionId, id);
});
test('new segment after upload attempt is retained and recording cannot resume', async () => {
    reset(); state.uploadAttempt = { sessionId: id, server: settings.server_url, files: names.map(name => ({ name, size: 5 })) };
    await assert.rejects(assertCanResume(), /Сначала/);
    const extra = 'proctoring_screen_new.webm';state.tempFiles.push(extra);disk.set(extra,new Blob(['new']));
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ videosSaved: true, processingStarted: true }) });
    await assert.rejects(uploadSession(settings), /изменились/);assert.equal(disk.size,3);
});
test('request timeout preserves local state', async () => {
    reset();globalThis.fetch = (url, options) => new Promise((resolve,reject) => options.signal.addEventListener('abort',()=>reject(new Error('Aborted'))));
    await assert.rejects(requestJSON('https://example.test', { timeoutMs: 10 }), /время ожидания/);
    assert.equal(disk.size,2);assert.equal(state.sessionId,id);
});

test('partial cleanup failure preserves remaining index and metadata; retry is safe', async () => {
    reset(); removeFailures.add(names[1]); let calls=0;
    globalThis.fetch=async()=>({ok:true,json:async()=>++calls===1?{videosSaved:false}:{success:true,videosSaved:true}});
    await assert.rejects(uploadSession(settings), /Индекс восстановления/);
    assert.deepEqual(state.tempFiles,[names[1]]);assert.equal(state.sessionId,id);assert.ok(state.uploadAttempt);
    removeFailures.clear();globalThis.fetch=async()=>({ok:true,json:async()=>({videosSaved:true,processingStarted:true})});
    await uploadSession(settings);assert.equal(disk.size,0);assert.equal(state.sessionId,undefined);
});
