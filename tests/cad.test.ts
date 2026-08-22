import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { apply, exportCad, extractCad, inspectCad } from '../src/index.js'

const fixture = path.resolve('testfiles', '抓图-于城镇.dwg')
const secondFixture = path.resolve('testfiles', '抓图-130局部.dwg')

describe('DWG support', () => {
  it('inspects the AC1018 DWG fixture', async () => {
    const result = await inspectCad(fixture, { outputDir: '.', maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entityCount).toBeGreaterThan(0)
  })

  it('inspects and converts the second DWG fixture', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    const config = { outputDir, maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 }
    try {
      const inspected = await inspectCad(secondFixture, config)
      expect(inspected.ok).toBe(true)
      if (inspected.ok) expect(inspected.layers.some(layer => layer.isFrozen)).toBe(true)
      const dxf = await exportCad({ path: secondFixture, format: 'dxf', outputName: 'second.dxf' }, config)
      expect(dxf.ok).toBe(true)
      if (dxf.ok) expect((await readFile(dxf.outputPath, 'utf8')).includes('SECTION')).toBe(true)
      if (dxf.ok) {
        const converted = await inspectCad(dxf.outputPath, config)
        expect(converted.ok).toBe(true)
        if (converted.ok) expect(converted.entityCount).toBeGreaterThan(0)
      }
    } finally { await rm(outputDir, { recursive: true, force: true }) }
  }, 20_000)

  it('converts the DWG fixture to DXF and exports PNG', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    const config = { outputDir, maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 }
    try {
      const sourceTexts = await extractCad({ path: fixture, section: 'texts', limit: 10_000 }, config)
      expect(sourceTexts.ok).toBe(true)
      const dxf = await exportCad({ path: fixture, format: 'dxf', outputName: 'fixture.dxf' }, config)
      expect(dxf.ok).toBe(true)
      if (dxf.ok) {
        expect(dxf.conversionValidation).toEqual(expect.objectContaining({ status: 'passed' }))
        expect(dxf.lossRisk).toEqual(expect.objectContaining({ level: 'none' }))
        expect(dxf.unpreservedObjectTypes).toEqual([])
      }
      if (dxf.ok) expect((await readFile(dxf.outputPath, 'utf8')).includes('SECTION')).toBe(true)
      const png = await exportCad({ path: fixture, format: 'png', outputName: 'fixture.png', width: 640 }, config)
      expect(png.ok).toBe(true)
      if (png.ok) expect((await readFile(png.outputPath)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const texts = await extractCad({ path: fixture, section: 'texts', limit: 20 }, config)
      expect(texts.ok).toBe(true)
      if (dxf.ok && sourceTexts.ok) {
        const converted = await inspectCad(dxf.outputPath, config)
        expect(converted.ok).toBe(true)
        if (converted.ok) expect(converted.codePage).toBe('UTF-8')
        const convertedTexts = await extractCad({ path: dxf.outputPath, section: 'texts', limit: 10_000 }, config)
        expect(convertedTexts).toEqual(expect.objectContaining({ ok: true, total: sourceTexts.total }))
        if (convertedTexts.ok) expect(convertedTexts.records.map(record => record.text)).toEqual(sourceTexts.records.map(record => record.text))
      }
    } finally { await rm(outputDir, { recursive: true, force: true }) }
  }, 20_000)

  it('registers the three Harness tools', () => {
    const registered: any[] = []
    apply({ tools: { register: (definition: any) => { registered.push(definition); return () => undefined } } } as any, {
      outputDir: '.', maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192,
    })
    expect(registered.map(tool => tool.name)).toEqual(['cad_inspect', 'cad_extract', 'cad_export'])
  })
})
