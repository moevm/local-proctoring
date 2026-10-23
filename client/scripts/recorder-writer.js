// Event callbacks do not await each other. Serialize every OPFS append and
// wait for the final dataavailable event plus all writes before reading files.
export function attachRecorderWriter(recorder, getHandle, afterWrite = async () => {}, onError = () => {}) {
    let pending = Promise.resolve();
    let failure;
    let started = false;
    let stopped;
    const finished = new Promise(resolve => { stopped = resolve; });
    recorder.addEventListener('start', () => { started = true; });
    recorder.addEventListener('stop', stopped, { once: true });
    recorder.addEventListener('dataavailable', event => {
        if (!event.data.size) return;
        pending = pending.then(async () => {
            const handle = getHandle();
            const file = await handle.getFile();
            const writer = await handle.createWritable({ keepExistingData: true });
            try {
                await writer.write({ type: 'write', position: file.size, data: event.data });
                await writer.close();
            } catch (error) { await writer.abort().catch(() => {}); throw error; }
            await afterWrite();
        }).catch(error => { if (!failure) { failure = error; onError(error); } });
    });
    let stopping;
    return {
        stop() {
            if (stopping) return stopping;
            stopping = (async () => {
                const active = recorder.state !== 'inactive';
                if (active) recorder.stop();
                if (active || started) await finished;
                await pending;
                if (failure) throw failure;
            })();
            return stopping;
        }
    };
}
