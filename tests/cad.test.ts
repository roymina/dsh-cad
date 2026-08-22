import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { apply, exportCad, extractCad, inspectCad } from '../src/index.js'

const fixture = path.resolve('testfiles', '抓图-于城镇.dwg')
const secondFixture = path.resolve('testfiles', '抓图-130局部.dwg')

describe('DWG support', () => {
  it('inspects the AC1018 DWG fixture', async () => {
    const result = await inspectCad(fixture, { outputDir: '.', maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entityCount).toBeGreaterThan(0)
      expect(result.warnings).toEqual(expect.objectContaining({ total: expect.any(Number), byCode: expect.any(Object), samples: expect.any(Array), truncated: expect.any(Boolean) }))
    }
  })

  it('inspects and converts the second DWG fixture', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    const config = { outputDir, maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 }
    try {
      const inspected = await inspectCad(secondFixture, config)
      expect(inspected.ok).toBe(true)
      if (inspected.ok) expect(inspected.layers.some(layer => layer.isFrozen)).toBe(true)
      const svg = await exportCad({ path: secondFixture, format: 'svg', outputName: 'second.svg' }, config)
      expect(svg.ok).toBe(true)
      if (svg.ok) {
        expect(svg.layout).toBe('Model')
        const document = await readFile(svg.outputPath, 'utf8')
        const svgPrimitiveCount = (document.match(/<(?:line|polyline|polygon|circle|path|text)\b/g) ?? []).length
        expect(svg.renderedPrimitiveCount).toBe(svgPrimitiveCount)
        expect(document).toMatch(/<text[^>]+text-anchor=[^>]+alignment-baseline=/)
        expect(document).toContain('stroke="rgb(')
        expect(svg.sourceEntityCount).toBe(svg.renderedPrimitiveCount + Object.values(svg.unsupportedEntityTypes).reduce((sum, count) => sum + count, 0))
        expect(svg.previewCompleteness).toBe(svg.renderedPrimitiveCount / svg.sourceEntityCount)
        expect(svg.unsupportedEntityTypes.Insert ?? 0).toBe(0)
      }
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

  it('rejects invalid runtime arguments', async () => {
    const config = { outputDir: '.', maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192, maxImagePixels: 1_000_000 }
    await expect(extractCad({ path: fixture, section: 'texts', limit: -1 }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(exportCad({ path: fixture, format: 'svg', background: 'url(https://example.test)' }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(exportCad({ path: fixture, format: 'png', width: 0 }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(exportCad({ path: fixture, format: 'png', width: 2000, outputName: '../preview' }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(exportCad({ path: fixture, format: 'svg', layout: 'missing-layout' }, config)).resolves.toMatchObject({ ok: false, error: { code: 'LAYOUT_NOT_FOUND' } })
  })

  it('renders closed bulge polylines as SVG arcs', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    const inputPath = path.join(outputDir, 'bulge.dxf')
    const config = { outputDir, maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 }
    await writeFile(inputPath, '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n2\n70\n1\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n0\nENDSEC\n0\nEOF\n')
    try {
      const result = await exportCad({ path: inputPath, format: 'svg', outputName: 'bulge.svg' }, config)
      expect(result.ok).toBe(true)
      if (result.ok) expect(await readFile(result.outputPath, 'utf8')).toMatch(/<path[^>]+ A /)
    } finally { await rm(outputDir, { recursive: true, force: true }) }
  })
})
