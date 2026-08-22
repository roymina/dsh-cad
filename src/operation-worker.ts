import { parentPort, workerData } from 'node:worker_threads'

if (!parentPort) throw new Error('CAD operation worker requires parentPort.')

const payload = workerData as {
  operation: 'inspect' | 'extract' | 'export' | 'compare'
  args: unknown
  config: Record<string, unknown>
}

try {
  const module = await import('./index.js')
  const config = { ...payload.config, workerMode: true } as Parameters<typeof module.inspectCad>[1] & { workerMode: true }
  const result = payload.operation === 'inspect'
    ? await module.inspectCad((payload.args as { path: string }).path, config)
    : payload.operation === 'extract'
      ? await module.extractCad(payload.args as Parameters<typeof module.extractCad>[0], config)
      : payload.operation === 'compare'
        ? await module.compareCad((payload.args as { firstPath: string; secondPath: string }).firstPath, (payload.args as { firstPath: string; secondPath: string }).secondPath, config)
        : await module.exportCad(payload.args as Parameters<typeof module.exportCad>[0], config)
  parentPort.postMessage({ result })
} catch (cause) {
  parentPort.postMessage({ error: cause instanceof Error ? cause.message : String(cause) })
}
