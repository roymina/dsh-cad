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
      expect(result.version).toEqual(expect.objectContaining({ code: expect.any(Number), name: expect.any(String), productRange: expect.any(String) }))
      expect(result.units).toEqual(expect.objectContaining({ code: expect.any(Number), name: expect.any(String) }))
      expect(result.scope).toEqual(expect.objectContaining({ modelSpace: expect.any(Object), paperSpaces: expect.any(Array), insertCount: expect.any(Number), visibility: expect.any(Object) }))
      expect(result.bounds).toEqual(expect.objectContaining({ header: expect.anything(), actual: expect.anything(), unableTypes: expect.any(Object) }))
      expect(result.bounds.normalizedMillimeters).toEqual(expect.objectContaining({ units: 'Millimeters' }))
      expect(result.geometryMetrics).toEqual(expect.objectContaining({ totalLength: expect.any(Number), perimeter: expect.any(Number), area: expect.any(Number) }))
      expect(result.layerUsage).toEqual(expect.objectContaining({ layers: expect.any(Array), emptyLayers: expect.any(Array) }))
      expect(result.qualityChecks).toEqual(expect.objectContaining({ duplicateHandles: expect.any(Array), zeroLengthLines: expect.any(Number), invalidRadii: expect.any(Number), openPolylines: expect.any(Number), closedContours: expect.any(Number) }))
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
        expect(svg.expandedEntityCount).toBe(svg.renderedPrimitiveCount + svg.skippedEntityCount)
        expect(svg.skippedEntityCount).toBe(Object.values(svg.unsupportedEntityTypes).reduce((sum, count) => sum + count, 0))
        expect(svg.previewCompleteness).toBe(svg.renderedPrimitiveCount / svg.expandedEntityCount)
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
    await expect(extractCad({ path: fixture, section: 'texts', offset: -1 }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(extractCad({ path: fixture, section: 'texts', summary: true }, config)).resolves.toMatchObject({ ok: true, total: expect.any(Number), returned: expect.any(Number) })
    await expect(exportCad({ path: fixture, format: 'svg', background: 'url(https://example.test)' }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(exportCad({ path: fixture, format: 'png', width: 0 }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(exportCad({ path: fixture, format: 'png', width: 2000, outputName: '../preview' }, config)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(exportCad({ path: fixture, format: 'svg', layout: 'missing-layout' }, config)).resolves.toMatchObject({ ok: false, error: { code: 'LAYOUT_NOT_FOUND' } })
    await expect(inspectCad(fixture, { ...config, allowedInputRoots: [os.tmpdir()] })).resolves.toMatchObject({ ok: false, error: { code: 'INPUT_OUTSIDE_ALLOWED_ROOTS' } })
    const existing = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    try {
      await writeFile(path.join(existing, 'same.svg'), 'keep')
      await expect(exportCad({ path: fixture, format: 'svg', outputName: 'same' }, { ...config, outputDir: existing })).resolves.toMatchObject({ ok: false, error: { code: 'OUTPUT_EXISTS' } })
    } finally { await rm(existing, { recursive: true, force: true }) }
    const controller = new AbortController(); controller.abort()
    await expect(inspectCad(fixture, config, controller.signal)).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    await expect(inspectCad(fixture, { ...config, maxTotalVertices: 0 })).resolves.toMatchObject({ ok: false, error: { code: 'GEOMETRY_LIMIT_EXCEEDED' } })
    await expect(exportCad({ path: fixture, format: 'png', width: 2000 }, { ...config, maxImagePixels: 100_000 })).resolves.toMatchObject({ ok: false, error: { code: 'RENDER_LIMIT_EXCEEDED' } })
    const concurrentDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    try {
      const results = await Promise.all([
        exportCad({ path: fixture, format: 'svg', outputName: 'concurrent' }, { ...config, outputDir: concurrentDir }),
        exportCad({ path: fixture, format: 'svg', outputName: 'concurrent' }, { ...config, outputDir: concurrentDir }),
      ])
      expect(results.filter(result => result.ok)).toHaveLength(1)
      expect(results.filter(result => !result.ok && result.error.code === 'OUTPUT_EXISTS')).toHaveLength(1)
    } finally { await rm(concurrentDir, { recursive: true, force: true }) }
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

  it('escapes XML controls and protects CSV formulas', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    const inputPath = path.join(outputDir, 'safe.dxf')
    const config = { outputDir, maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 }
    await writeFile(inputPath, '0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n1\n1\n=1+1\u0001\n0\nENDSEC\n0\nEOF\n')
    try {
      const result = await extractCad({ path: inputPath, section: 'texts', saveAs: 'csv', outputName: 'safe.csv' }, config)
      expect(result.ok).toBe(true)
      if (result.ok) expect(await readFile(result.outputPath, 'utf8')).toContain("'=1+1")
    } finally { await rm(outputDir, { recursive: true, force: true }) }
  })

  it('keeps SVG and PNG preview structure stable', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-cad-'))
    const config = { outputDir, maxFileSizeMB: 50, maxEntities: 200_000, maxExtractItems: 10_000, maxImageDimension: 8192 }
    try {
      const svg = await exportCad({ path: secondFixture, format: 'svg', outputName: 'visual.svg' }, config)
      const png = await exportCad({ path: secondFixture, format: 'png', outputName: 'visual.png', width: 320 }, config)
      expect(svg.ok).toBe(true)
      expect(png.ok).toBe(true)
      if (svg.ok) {
        const source = await readFile(svg.outputPath, 'utf8')
        const tags = [...source.matchAll(/<([a-z]+)\b/g)].map(match => match[1]).filter(tag => tag !== 'svg')
        expect({
          viewBox: source.match(/viewBox="([^"]+)"/)?.[1],
          tags: Object.fromEntries([...new Set(tags)].sort().map(tag => [tag, tags.filter(value => value === tag).length])),
          hasRgbColor: source.includes('stroke="rgb('),
          hasTextAlignment: source.includes('text-anchor=') && source.includes('alignment-baseline='),
          unsupported: svg.unsupportedEntityTypes,
        }).toMatchSnapshot()
      }
      if (png.ok) {
        const bytes = await readFile(png.outputPath)
        expect({ signature: bytes.subarray(0, 8).toString('hex'), byteLength: bytes.length }).toMatchSnapshot()
      }
    } finally { await rm(outputDir, { recursive: true, force: true }) }
  }, 30_000)
})
