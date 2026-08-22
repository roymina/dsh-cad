import { parentPort } from 'node:worker_threads';
import { DwgReader, DxfReader } from '@node-projects/acad-ts';
if (!parentPort)
    throw new Error('CAD parse worker requires parentPort.');
parentPort.on('message', (message) => {
    const warnings = [];
    const notify = (_sender, event) => warnings.push(String(event && typeof event === 'object' && 'message' in event ? event.message : event));
    try {
        const document = message.format === 'dwg'
            ? DwgReader.readFromStream(message.buffer, notify)
            : DxfReader.readFromStream(new Uint8Array(message.buffer), notify);
        if (message.format === 'dwg') {
            parentPort.postMessage({ format: 'dwg', buffer: message.buffer, warnings }, [message.buffer]);
        }
        else {
            parentPort.postMessage({ format: 'dxf', buffer: message.buffer, warnings }, [message.buffer]);
        }
    }
    catch (cause) {
        parentPort.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
    }
});
