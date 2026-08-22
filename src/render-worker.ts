import { parentPort } from 'node:worker_threads'
import { Resvg } from '@resvg/resvg-js'

if (!parentPort) throw new Error('PNG render worker requires parentPort.')

parentPort.on('message', (message: { svg: string; mode: 'width' | 'height'; value: number; background?: string }) => {
  try {
    const rendered = new Resvg(message.svg, { fitTo: { mode: message.mode, value: message.value }, background: message.background }).render()
    parentPort!.postMessage({ width: rendered.width, height: rendered.height, png: rendered.asPng() }, [])
  } catch (cause) {
    parentPort!.postMessage({ error: cause instanceof Error ? cause.message : String(cause) })
  }
})
