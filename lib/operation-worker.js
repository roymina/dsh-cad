import { parentPort, workerData } from 'node:worker_threads';
if (!parentPort)
    throw new Error('CAD operation worker requires parentPort.');
const payload = workerData;
try {
    const module = await import('./index.js');
    const config = { ...payload.config, workerMode: true };
    const result = payload.operation === 'inspect'
        ? await module.inspectCad(payload.args.path, config)
        : payload.operation === 'extract'
            ? await module.extractCad(payload.args, config)
            : payload.operation === 'compare'
                ? await module.compareCad(payload.args.firstPath, payload.args.secondPath, config)
                : await module.exportCad(payload.args, config);
    parentPort.postMessage({ result });
}
catch (cause) {
    parentPort.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
}
