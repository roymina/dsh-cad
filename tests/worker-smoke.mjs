import assert from 'node:assert/strict'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportCad, inspectCad } from '../lib/index.js'

const config = { outputDir: '.', maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 500, maxImageDimension: 8192 }
const fixture = 'testfiles/抓图-130局部.dwg'

const temp = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-worker-'))
try {
  const parsed = await inspectCad(fixture, config)
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error.message)

  const timeoutFixture = path.join(temp, 'timeout.dwg')
  await copyFile(fixture, timeoutFixture)
  const timedOut = await inspectCad(timeoutFixture, { ...config, maxWorkerTimeMs: 1 })
  assert.equal(timedOut.ok, false)
  if (!timedOut.ok) assert.equal(timedOut.error.code, 'TIMEOUT')

  const rendered = await exportCad({ path: fixture, format: 'png', outputName: 'worker.png', width: 32 }, { ...config, outputDir: temp })
  assert.equal(rendered.ok, true, rendered.ok ? undefined : rendered.error.message)
  const renderTimedOut = await exportCad({ path: fixture, format: 'png', outputName: 'worker-timeout.png', width: 32 }, { ...config, outputDir: temp, maxWorkerTimeMs: 1 })
  assert.equal(renderTimedOut.ok, false)
  if (!renderTimedOut.ok) assert.equal(renderTimedOut.error.code, 'TIMEOUT')

  const controller = new AbortController()
  controller.abort()
  const cancelled = await inspectCad(path.join(temp, 'cancelled.dwg'), config, controller.signal)
  assert.equal(cancelled.ok, false)
  if (!cancelled.ok) assert.equal(cancelled.error.code, 'CANCELLED')

  console.log('worker smoke: parse, timeout, and cancellation passed')
} finally {
  await rm(temp, { recursive: true, force: true })
}
