import { readFile, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ACadVersion, DwgReader, DxfReader, DxfWriter, LayerFlags } from '@node-projects/acad-ts'
import { Resvg } from '@resvg/resvg-js'

export const name = 'dsh-cad-plugin'
export const inject = ['tools']

export interface Config {
  outputDir: string
  maxFileSizeMB: number
  maxEntities: number
  maxExtractItems: number
  maxImageDimension: number
  maxImagePixels?: number
  maxWarningSamples?: number
  maxBlockDepth?: number
  maxBlockInstances?: number
}

export const Config: Schema<Config> = Schema.object({
  outputDir: Schema.string().default('./cad-output'),
  maxFileSizeMB: Schema.number().default(50),
  maxEntities: Schema.number().default(200_000),
  maxExtractItems: Schema.number().default(10_000),
  maxImageDimension: Schema.number().default(8192),
  maxImagePixels: Schema.number().default(64_000_000),
  maxWarningSamples: Schema.number().default(50),
  maxBlockDepth: Schema.number().default(16),
  maxBlockInstances: Schema.number().default(10_000),
})

type CadEntity = Record<string, any>
type CadDocument = Record<string, any>
type Warning = { code: string; message: string }
type WarningSummary = { total: number; byCode: Record<string, number>; samples: Warning[]; truncated: boolean }
type CadResult = { document: CadDocument; inputPath: string; format: 'dwg' | 'dxf'; warnings: Warning[] }
type ErrorResult = { ok: false; error: { code: string; message: string; details?: Record<string, any> } }
type SemanticSnapshot = { texts: string[]; entityTypes: Record<string, number>; layers: string[] }

const text = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: text }

function error(code: string, message: string, details?: Record<string, any>): ErrorResult {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } }
}

const namedBackgrounds = new Set(['black', 'white', 'gray', 'silver', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta'])

function validPath(value: string) {
  return value.trim().length > 0
}

function validOutputName(value: string) {
  return value.trim().length > 0 && value !== '.' && value !== '..' && path.basename(value) === value && !/[<>:"/\\|?*\u0000-\u001F]/.test(value)
}

function validBackground(value: string) {
  return value === 'transparent' || namedBackgrounds.has(value.toLowerCase()) || /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(value)
}

function invalidPath(pathValue: string) {
  return !validPath(pathValue) ? error('INVALID_ARGUMENT', 'path must be a non-empty string.') : undefined
}

function isErrorResult(value: CadResult | ErrorResult): value is ErrorResult {
  return 'ok' in value && value.ok === false
}

function summarizeWarnings(warnings: Warning[], maxSamples = 50): WarningSummary {
  const byCode: Record<string, number> = {}
  const unique = new Map<string, Warning>()
  for (const warning of warnings) {
    byCode[warning.code] = (byCode[warning.code] ?? 0) + 1
    unique.set(`${warning.code}\u0000${warning.message}`, warning)
  }
  const samples = Array.from(unique.values()).slice(0, maxSamples)
  return { total: warnings.length, byCode, samples, truncated: unique.size > samples.length }
}

function entityName(entity: CadEntity) {
  return entity?.constructor?.name ?? 'UnknownEntity'
}

function entityLayer(entity: CadEntity) {
  return entity?.layer?.name ?? entity?._layer?.name ?? '0'
}

function point(value: any) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: Number(value.x), y: Number(value.y), z: Number(value.z ?? 0) }
    : undefined
}

function entities(document: CadDocument): CadEntity[] {
  return Array.from(document.entities ?? []) as CadEntity[]
}

function blocks(document: CadDocument): CadEntity[] {
  return Array.from(document.blockRecords ?? []) as CadEntity[]
}

function semanticSnapshot(document: CadDocument): SemanticSnapshot {
  const entityTypes: Record<string, number> = {}
  const textValues: string[] = []
  for (const entity of entities(document)) {
    const kind = entityName(entity)
    entityTypes[kind] = (entityTypes[kind] ?? 0) + 1
    if (['TextEntity', 'MText', 'AttributeEntity'].includes(kind)) textValues.push(String(entity.value ?? entity._value ?? ''))
  }
  return {
    texts: textValues,
    entityTypes,
    layers: Array.from(document.layers ?? []).map((layer: any) => String(layer.name)).sort(),
  }
}

function equalRecords(left: Record<string, number>, right: Record<string, number>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return Array.from(keys).every(key => left[key] === right[key])
}

function validateConversion(source: SemanticSnapshot, converted: SemanticSnapshot) {
  const textValuesMatch = JSON.stringify(source.texts) === JSON.stringify(converted.texts)
  const entityTypesMatch = equalRecords(source.entityTypes, converted.entityTypes)
  const layersMatch = JSON.stringify(source.layers) === JSON.stringify(converted.layers)
  const unpreservedObjectTypes = Array.from(new Set([...Object.keys(source.entityTypes), ...Object.keys(converted.entityTypes)]))
    .filter(type => source.entityTypes[type] !== converted.entityTypes[type])
  const differences: string[] = []
  if (!textValuesMatch) differences.push('Text values differ after conversion.')
  if (!entityTypesMatch) differences.push('Entity type counts differ after conversion.')
  if (!layersMatch) differences.push('Layer names differ after conversion.')
  return {
    status: differences.length === 0 ? 'passed' as const : 'failed' as const,
    checks: { textValuesMatch, entityTypesMatch, layersMatch },
    differences,
    unpreservedObjectTypes,
  }
}

function layerRows(document: CadDocument) {
  return Array.from(document.layers ?? []).map((layer: any) => ({
    name: layer.name,
    isOn: layer.isOn !== false,
    isFrozen: (layer.layerFlags & LayerFlags.Frozen) !== 0,
    colorIndex: layer.color?._color ?? layer._color?._color ?? null,
  }))
}

function bounds(document: CadDocument) {
  const min = point(document.header?.modelSpaceExtMin)
  const max = point(document.header?.modelSpaceExtMax)
  return min && max && Number.isFinite(min.x + min.y + max.x + max.y) && (min.x !== max.x || min.y !== max.y)
    ? { min, max }
    : null
}

async function loadCad(input: string, config: Config, signal?: AbortSignal): Promise<CadResult | ReturnType<typeof error>> {
  if (signal?.aborted) return error('CANCELLED', 'Operation was cancelled before reading the drawing.')
  const inputPath = path.resolve(input)
  let stat
  try {
    stat = await lstat(inputPath)
  } catch {
    return error('FILE_NOT_FOUND', 'The CAD file does not exist.', { path: inputPath })
  }
  if (!stat.isFile()) return error('NOT_A_FILE', 'The CAD path must point to a regular file.', { path: inputPath })
  if (stat.size > config.maxFileSizeMB * 1024 * 1024) {
    return error('FILE_TOO_LARGE', 'The CAD file exceeds the configured size limit.', { bytes: stat.size, maxFileSizeMB: config.maxFileSizeMB })
  }
  const format = path.extname(inputPath).toLowerCase().slice(1)
  if (format !== 'dwg' && format !== 'dxf') return error('UNSUPPORTED_FORMAT', 'Only DWG and DXF input files are supported.', { path: inputPath })
  const warnings: Warning[] = []
  try {
    const bytes = await readFile(inputPath)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const notify = (_sender: unknown, event: any) => warnings.push({ code: 'PARSER_WARNING', message: String(event?.message ?? event) })
    const document = format === 'dwg'
      ? DwgReader.readFromStream(buffer, notify)
      : DxfReader.readFromStream(new Uint8Array(buffer), notify)
    const entityCount = entities(document).length
    if (entityCount > config.maxEntities) {
      return error('ENTITY_LIMIT_EXCEEDED', 'The drawing exceeds the configured entity limit.', { entityCount, maxEntities: config.maxEntities })
    }
    return { document, inputPath, format, warnings }
  } catch (cause) {
    return error('PARSE_FAILED', 'The CAD drawing could not be parsed.', { path: inputPath, message: cause instanceof Error ? cause.message : String(cause) })
  }
}

function inspect(document: CadDocument, inputPath: string, format: string, warnings: Warning[], maxWarningSamples: number) {
  const all = entities(document)
  const byType: Record<string, number> = {}
  const byLayer: Record<string, number> = {}
  for (const entity of all) {
    byType[entityName(entity)] = (byType[entityName(entity)] ?? 0) + 1
    byLayer[entityLayer(entity)] = (byLayer[entityLayer(entity)] ?? 0) + 1
  }
  return {
    ok: true,
    inputPath,
    format,
    version: document.header?.version ?? null,
    codePage: document.header?.codePage ?? null,
    units: document.header?.insUnits ?? null,
    bounds: bounds(document),
    entityCount: all.length,
    entityTypes: byType,
    layers: layerRows(document),
    entityCountByLayer: byLayer,
    blocks: blocks(document).map((block: any) => ({ name: block.name, entityCount: Array.from(block.entities ?? []).length })),
    textCount: all.filter(entity => ['TextEntity', 'MText', 'AttributeEntity'].includes(entityName(entity))).length,
    warnings: summarizeWarnings(warnings, maxWarningSamples),
  }
}

function entityRecord(entity: CadEntity) {
  const kind = entityName(entity)
  const base = { handle: entity.handle ?? null, type: kind, layer: entityLayer(entity), invisible: Boolean(entity.isInvisible) }
  if (kind === 'TextEntity' || kind === 'MText' || kind === 'AttributeEntity') {
    return { ...base, text: entity.value ?? entity._value ?? entity.text ?? '', position: point(entity.insertPoint ?? entity.location), height: entity.height ?? entity._height ?? null, rotation: entity.rotation ?? 0 }
  }
  if (kind === 'Line') return { ...base, start: point(entity.startPoint), end: point(entity.endPoint) }
  if (kind === 'Circle') return { ...base, center: point(entity.center), radius: entity.radius ?? entity._radius ?? null }
  if (kind === 'LwPolyline' || kind === 'Polyline2D' || kind === 'Polyline3D') {
    return { ...base, vertices: Array.from(entity.vertices ?? []).map((vertex: any) => point(vertex.location ?? vertex)).filter(Boolean), closed: Boolean(entity.isClosed ?? (entity._flags & 1)) }
  }
  if (kind === 'Insert') return { ...base, block: entity.block?.name ?? entity.block?.record?.name ?? null, position: point(entity.insertPoint), rotation: entity.rotation ?? 0 }
  return base
}

function extract(document: CadDocument, section: string, layers: string[] | undefined, entityTypes: string[] | undefined, limit: number) {
  const all = entities(document)
  const filtered = all.filter(entity => (!layers?.length || layers.includes(entityLayer(entity))) && (!entityTypes?.length || entityTypes.includes(entityName(entity))))
  const source = section === 'texts' ? filtered.filter(entity => ['TextEntity', 'MText', 'AttributeEntity'].includes(entityName(entity)))
    : section === 'layers' ? Array.from(document.layers ?? [])
    : section === 'blocks' ? blocks(document)
    : filtered
  const records = source.slice(0, limit).map((item: any) => section === 'layers'
    ? { name: item.name, isOn: item.isOn !== false, isFrozen: (item.layerFlags & LayerFlags.Frozen) !== 0, colorIndex: item.color?._color ?? item._color?._color ?? null }
    : section === 'blocks' ? { name: item.name, entityCount: Array.from(item.entities ?? []).length }
    : entityRecord(item))
  return { ok: true, section, total: source.length, returned: records.length, truncated: records.length < source.length, records }
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!))
}

function drawingPoints(entity: CadEntity): Array<{ x: number; y: number }> {
  const kind = entityName(entity)
  if (kind === 'Line') return [point(entity.startPoint), point(entity.endPoint)].filter(Boolean) as Array<{ x: number; y: number }>
  if (kind === 'LwPolyline' || kind === 'Polyline2D' || kind === 'Polyline3D') return Array.from(entity.vertices ?? []).map((v: any) => point(v.location ?? v)).filter(Boolean) as Array<{ x: number; y: number }>
  if (kind === 'Circle') {
    const center = point(entity.center); const radius = Number(entity.radius ?? entity._radius)
    return center && Number.isFinite(radius) ? [{ x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y + radius }] : []
  }
  const location = point(entity.insertPoint ?? entity.center)
  return location ? [location] : []
}

type SvgRenderer = (entity: CadEntity, color: string) => string

const svgRenderers: Record<string, SvgRenderer> = {
  Line(entity, color) {
    const a = point(entity.startPoint); const b = point(entity.endPoint)
    return a && b ? `<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" stroke="${color}"/>` : ''
  },
  LwPolyline: renderPolyline,
  Polyline2D: renderPolyline,
  Polyline3D: renderPolyline,
  Circle(entity, color) {
    const center = point(entity.center); const radius = Number(entity.radius ?? entity._radius)
    return center && Number.isFinite(radius) ? `<circle cx="${center.x}" cy="${-center.y}" r="${radius}" fill="none" stroke="${color}"/>` : ''
  },
  Arc: renderCurve,
  Ellipse: renderCurve,
  Spline: renderCurve,
  Hatch: renderHatch,
  Point: renderPoint,
  Solid: renderSolid,
  Leader: renderLeader,
  TextEntity: renderText,
  MText: renderText,
}

function renderPolyline(entity: CadEntity, color: string) {
  const values = drawingPoints(entity).map(point => `${point.x},${-point.y}`).join(' ')
  return values ? `<polyline points="${values}" fill="none" stroke="${color}"/>` : ''
}

function renderText(entity: CadEntity, color: string) {
  const at = point(entity.insertPoint); const value = String(entity.value ?? entity._value ?? ''); const size = Number(entity.height ?? entity._height ?? 2.5)
  return at ? `<text x="${at.x}" y="${-at.y}" font-size="${size}" fill="${color}">${escapeXml(value)}</text>` : ''
}

function svgPath(points: unknown[], closed = false) {
  const values = points.map(point).filter(Boolean) as Array<{ x: number; y: number }>
  return values.length > 1 ? `M ${values.map((value, index) => `${index === 0 ? '' : 'L '}${value.x} ${-value.y}`).join(' ')}${closed ? ' Z' : ''}` : ''
}

function renderCurve(entity: CadEntity, color: string) {
  const points = entity.polygonalVertexes?.(96) ?? entity.tryPolygonalVertexes?.(96)?.points ?? []
  const path = svgPath(points, Boolean(entity.isClosed))
  return path ? `<path d="${path}" fill="none" stroke="${color}"/>` : ''
}

function renderHatch(entity: CadEntity, color: string) {
  const path = (entity.paths ?? []).map((boundary: CadEntity) => svgPath(boundary.getPoints?.(96) ?? [], true)).filter(Boolean).join(' ')
  return path ? `<path d="${path}" fill="${entity.isSolid ? color : 'none'}" fill-rule="evenodd" stroke="${color}"/>` : ''
}

function renderPoint(entity: CadEntity, color: string) {
  const location = point(entity.location)
  return location ? `<circle cx="${location.x}" cy="${-location.y}" r="1" fill="${color}"/>` : ''
}

function renderSolid(entity: CadEntity, color: string) {
  const points = [entity.firstCorner, entity.secondCorner, entity.thirdCorner, entity.fourthCorner].map(point).filter(Boolean) as Array<{ x: number; y: number }>
  const values = points.map(value => `${value.x},${-value.y}`).join(' ')
  return values ? `<polygon points="${values}" fill="${color}" stroke="${color}"/>` : ''
}

function renderLeader(entity: CadEntity, color: string) {
  const path = svgPath(entity.vertices ?? [])
  return path ? `<path d="${path}" fill="none" stroke="${color}"/>` : ''
}

function hasCircularBlockReference(block: CadEntity, blockStack = new Set<string>()): boolean {
  const blockName = String(block?.name ?? '')
  if (!blockName || blockStack.has(blockName)) return true
  const nextStack = new Set(blockStack).add(blockName)
  const childEntities = Array.from(block.entities ?? []) as CadEntity[]
  return childEntities.some(entity => entityName(entity) === 'Insert' && hasCircularBlockReference(entity.block, nextStack))
}

function expandInsert(insert: CadEntity, maxDepth: number, maxInstances: number, depth = 0, blockStack = new Set<string>()): CadEntity[] {
  const blockName = String(insert.block?.name ?? '')
  if (!blockName || depth >= maxDepth || blockStack.has(blockName) || hasCircularBlockReference(insert.block)) return []
  const nextStack = new Set(blockStack).add(blockName)
  const rows = Math.max(1, Number(insert.rowCount ?? 1))
  const columns = Math.max(1, Number(insert.columnCount ?? 1))
  const total = Math.min(rows * columns, maxInstances)
  const expanded: CadEntity[] = []
  for (let index = 0; index < total; index++) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const instance = insert.clone() as CadEntity
    const rotation = Number(instance.rotation ?? 0)
    const localX = column * Number(instance.columnSpacing ?? 0) * Number(instance.xScale ?? 1)
    const localY = row * Number(instance.rowSpacing ?? 0) * Number(instance.yScale ?? 1)
    const insertPoint = instance.insertPoint
    insertPoint.x += localX * Math.cos(rotation) - localY * Math.sin(rotation)
    insertPoint.y += localX * Math.sin(rotation) + localY * Math.cos(rotation)
    for (const entity of instance.explode() as Iterable<CadEntity>) {
      if (entityName(entity) === 'Insert') expanded.push(...expandInsert(entity, maxDepth, maxInstances - expanded.length, depth + 1, nextStack))
      else expanded.push(entity)
      if (expanded.length >= maxInstances) return expanded
    }
  }
  return expanded
}

function makeSvg(document: CadDocument, selectedLayers?: string[], background = 'white', maxBlockDepth = 16, maxBlockInstances = 10_000) {
  const source = entities(document).filter(entity => !entity.isInvisible && (!selectedLayers?.length || selectedLayers.includes(entityLayer(entity))))
  const drawing = source.flatMap(entity => entityName(entity) === 'Insert' ? expandInsert(entity, maxBlockDepth, maxBlockInstances) : [entity])
  const points = drawing.flatMap(drawingPoints)
  const declared = bounds(document)
  const minX = declared?.min.x ?? Math.min(...points.map(p => p.x), 0)
  const minY = declared?.min.y ?? Math.min(...points.map(p => p.y), 0)
  const maxX = declared?.max.x ?? Math.max(...points.map(p => p.x), 100)
  const maxY = declared?.max.y ?? Math.max(...points.map(p => p.y), 100)
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const unsupportedEntityTypes: Record<string, number> = {}
  const primitives: string[] = []
  for (const entity of drawing) {
    const color = '#202020'
    const kind = entityName(entity)
    const primitive = svgRenderers[kind]?.(entity, color) ?? ''
    if (primitive) primitives.push(primitive)
    else unsupportedEntityTypes[kind] = (unsupportedEntityTypes[kind] ?? 0) + 1
  }
  const content = primitives.join('')
  const bg = background === 'transparent' ? '' : `<rect x="${minX}" y="${-maxY}" width="${width}" height="${height}" fill="${background}"/>`
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${width} ${height}">${bg}<g stroke-width="${Math.max(width, height) / 2500}">${content}</g></svg>`,
    bounds: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } },
    sourceEntityCount: drawing.length,
    renderedPrimitiveCount: primitives.length,
    unsupportedEntityTypes,
    previewCompleteness: drawing.length === 0 ? 1 : primitives.length / drawing.length,
  }
}

async function outputPath(config: Config, name: string, extension: string) {
  if (!validOutputName(name)) throw new Error('outputName must be a non-empty filename without path segments or reserved characters.')
  const dir = path.resolve(config.outputDir)
  await mkdir(dir, { recursive: true })
  const realDir = await realpath(dir)
  const result = path.join(realDir, name.endsWith(`.${extension}`) ? name : `${name}.${extension}`)
  if (!result.startsWith(`${realDir}${path.sep}`)) throw new Error('Output path escapes outputDir.')
  try { await lstat(result); throw new Error('Output file already exists; choose a different outputName.') } catch (cause: any) { if (cause?.code !== 'ENOENT') throw cause }
  return result
}

function csv(records: Record<string, unknown>[]) {
  const columns = Array.from(new Set(records.flatMap(record => Object.keys(record))))
  const cell = (value: unknown) => `"${String(typeof value === 'object' ? JSON.stringify(value) : value ?? '').replaceAll('"', '""')}"`
  return [columns.join(','), ...records.map(record => columns.map(column => cell(record[column])).join(','))].join('\n')
}

export async function inspectCad(pathValue: string, config: Config, signal?: AbortSignal) {
  const invalid = invalidPath(pathValue)
  if (invalid) return invalid
  const loaded = await loadCad(pathValue, config, signal)
  if (isErrorResult(loaded)) return loaded
  return inspect(loaded.document, loaded.inputPath, loaded.format, loaded.warnings, config.maxWarningSamples ?? 50)
}

export async function extractCad(args: { path: string; section: 'texts' | 'layers' | 'blocks' | 'entities'; layers?: string[]; entityTypes?: string[]; limit?: number; saveAs?: 'json' | 'csv'; outputName?: string }, config: Config, signal?: AbortSignal) {
  const invalid = invalidPath(args.path)
  if (invalid) return invalid
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 0)) return error('INVALID_ARGUMENT', 'limit must be a non-negative integer.')
  if (args.outputName !== undefined && !validOutputName(args.outputName)) return error('INVALID_ARGUMENT', 'outputName must be a non-empty filename without path segments or reserved characters.')
  const loaded = await loadCad(args.path, config, signal)
  if (isErrorResult(loaded)) return loaded
  const result = extract(loaded.document, args.section, args.layers, args.entityTypes, Math.min(args.limit ?? config.maxExtractItems, config.maxExtractItems))
  if (!args.saveAs) return result
  try {
    const output = await outputPath(config, args.outputName ?? `${path.parse(loaded.inputPath).name}-${args.section}`, args.saveAs)
    await writeFile(output, args.saveAs === 'json' ? JSON.stringify(result, null, 2) : csv(result.records as Record<string, unknown>[]), 'utf8')
    return { ...result, outputPath: output }
  } catch (cause) {
    return error('OUTPUT_FAILED', cause instanceof Error ? cause.message : String(cause))
  }
}

export async function exportCad(args: { path: string; format: 'svg' | 'png' | 'dxf'; outputName?: string; layers?: string[]; width?: number; height?: number; background?: string }, config: Config, signal?: AbortSignal) {
  const invalid = invalidPath(args.path)
  if (invalid) return invalid
  if (args.outputName !== undefined && !validOutputName(args.outputName)) return error('INVALID_ARGUMENT', 'outputName must be a non-empty filename without path segments or reserved characters.')
  if (args.background !== undefined && !validBackground(args.background)) return error('INVALID_ARGUMENT', 'background must be transparent, a supported named color, or a #RGB/#RRGGBB/#RRGGBBAA color.')
  if (args.width !== undefined && (!Number.isInteger(args.width) || args.width < 1 || args.width > config.maxImageDimension)) return error('INVALID_ARGUMENT', `width must be an integer between 1 and ${config.maxImageDimension}.`)
  if (args.height !== undefined && (!Number.isInteger(args.height) || args.height < 1 || args.height > config.maxImageDimension)) return error('INVALID_ARGUMENT', `height must be an integer between 1 and ${config.maxImageDimension}.`)
  if (args.width !== undefined && args.height !== undefined) return error('INVALID_ARGUMENT', 'Specify either width or height for PNG output, not both.')
  const loaded = await loadCad(args.path, config, signal)
  if (isErrorResult(loaded)) return loaded
  try {
    const output = await outputPath(config, args.outputName ?? `${path.parse(loaded.inputPath).name}-preview`, args.format)
    if (args.format === 'dxf') {
      const source = semanticSnapshot(loaded.document)
      const conversionWarnings: Warning[] = []
      // Binary DXF avoids the ASCII reader's line trimming and writes encoded
      // bytes directly. Mark the output as Unicode so readers decode text as
      // UTF-8 rather than using the source DWG code page (for example GB2312).
      loaded.document.header.version = Math.max(loaded.document.header.version, ACadVersion.AC1021)
      loaded.document.header.codePage = 'UTF-8'
      const fileStream = createWriteStream(output, { flags: 'wx' })
      fileStream.on('error', () => {})
      let opened = false
      fileStream.once('open', () => { opened = true })
      try {
        DxfWriter.writeToStream({
          write: (value: Uint8Array) => { fileStream.write(value) },
          flush: () => {},
          close: () => { fileStream.end() },
        }, loaded.document as any, true, undefined, (_sender: unknown, event: any) => {
          conversionWarnings.push({ code: 'DXF_WRITER_WARNING', message: String(event?.message ?? event) })
        })
        await finished(fileStream)
      } catch (cause) {
        fileStream.destroy()
        if (opened) await rm(output, { force: true })
        throw cause
      }
      const converted = await loadCad(output, config, signal)
      if (isErrorResult(converted)) {
        return {
          ok: false,
          error: { code: 'CONVERSION_VALIDATION_FAILED', message: 'The exported DXF could not be parsed for validation.', details: converted.error },
          format: 'dxf', outputPath: output,
          conversionValidation: { status: 'failed', checks: { textValuesMatch: false, entityTypesMatch: false, layersMatch: false }, differences: ['The exported DXF could not be parsed.'], unpreservedObjectTypes: Object.keys(source.entityTypes) },
          lossRisk: { level: 'severe', reasons: ['The exported DXF could not be parsed.'] },
          warnings: summarizeWarnings([...loaded.warnings, ...conversionWarnings], config.maxWarningSamples ?? 50),
        }
      }
      const conversionValidation = validateConversion(source, semanticSnapshot(converted.document))
      const lossRisk = {
        level: conversionValidation.status === 'failed' ? 'severe' as const : conversionWarnings.length > 0 ? 'warning' as const : 'none' as const,
        reasons: [...conversionValidation.differences, ...conversionWarnings.map(warning => warning.message)],
      }
      if (conversionValidation.status === 'failed') {
        return {
          ok: false,
          error: { code: 'CONVERSION_VALIDATION_FAILED', message: 'The exported DXF did not pass semantic validation.', details: { differences: conversionValidation.differences } },
          format: 'dxf', outputPath: output, conversionValidation, lossRisk,
          unpreservedObjectTypes: conversionValidation.unpreservedObjectTypes,
          warnings: summarizeWarnings([...loaded.warnings, ...conversionWarnings, ...converted.warnings], config.maxWarningSamples ?? 50),
        }
      }
      return {
        ok: true, format: 'dxf', outputPath: output, conversionValidation, lossRisk,
        unpreservedObjectTypes: conversionValidation.unpreservedObjectTypes,
        warnings: summarizeWarnings([...loaded.warnings, ...conversionWarnings, ...converted.warnings], config.maxWarningSamples ?? 50),
      }
    }
    const drawing = makeSvg(loaded.document, args.layers, args.background, config.maxBlockDepth ?? 16, config.maxBlockInstances ?? 10_000)
    if (args.format === 'svg') await writeFile(output, drawing.svg, 'utf8')
    else {
      const drawingWidth = drawing.bounds.max.x - drawing.bounds.min.x
      const drawingHeight = drawing.bounds.max.y - drawing.bounds.min.y
      const targetWidth = args.width ?? (args.height ? Math.max(1, Math.round(args.height * drawingWidth / drawingHeight)) : 1600)
      const targetHeight = args.height ?? Math.max(1, Math.round(targetWidth * drawingHeight / drawingWidth))
      const maxPixels = config.maxImagePixels ?? 64_000_000
      if (targetWidth > config.maxImageDimension || targetHeight > config.maxImageDimension || targetWidth * targetHeight > maxPixels) {
        return error('RENDER_LIMIT_EXCEEDED', 'The requested PNG dimensions exceed the configured limits.', { width: targetWidth, height: targetHeight, maxImageDimension: config.maxImageDimension, maxImagePixels: maxPixels })
      }
      const rendered = new Resvg(drawing.svg, { fitTo: args.height ? { mode: 'height', value: targetHeight } : { mode: 'width', value: targetWidth }, background: args.background === 'transparent' ? undefined : args.background ?? 'white' }).render()
      if (rendered.width * rendered.height > maxPixels) return error('RENDER_LIMIT_EXCEEDED', 'The rendered PNG exceeds the configured pixel limit.', { width: rendered.width, height: rendered.height, maxImagePixels: maxPixels })
      const png = rendered.asPng()
      await writeFile(output, png)
    }
    return {
      ok: true, format: args.format, outputPath: output, bounds: drawing.bounds,
      sourceEntityCount: drawing.sourceEntityCount, renderedPrimitiveCount: drawing.renderedPrimitiveCount,
      unsupportedEntityTypes: drawing.unsupportedEntityTypes, previewCompleteness: drawing.previewCompleteness,
      warnings: summarizeWarnings(loaded.warnings, config.maxWarningSamples ?? 50),
    }
  } catch (cause) {
    return error('EXPORT_FAILED', cause instanceof Error ? cause.message : String(cause))
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'cad_inspect', description: 'Inspect a DWG or DXF drawing without modifying it. Returns file metadata, units, bounds, layers, blocks and entity statistics.',
    parameters: { path: { type: 'string', required: true, description: 'Absolute or working-directory-relative DWG/DXF path.' } }, output: jsonOutput,
    async execute(args, exec) { return inspectCad(args.path, config, exec.signal) as any },
  }))
  ctx.tools.register(defineTool({
    name: 'cad_extract', description: 'Extract texts, layers, blocks, or entities from a DWG/DXF drawing. Optionally write JSON or CSV below the configured output directory.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or working-directory-relative DWG/DXF path.' },
      section: { type: 'string', required: true, enum: ['texts', 'layers', 'blocks', 'entities'], description: 'Information section to extract.' },
      layers: { type: 'array', items: { type: 'string' }, description: 'Optional layer-name filter.' }, entityTypes: { type: 'array', items: { type: 'string' }, description: 'Optional entity-type filter.' },
      limit: { type: 'integer', description: 'Maximum records to return.' }, saveAs: { type: 'string', enum: ['json', 'csv'], description: 'Optional file format for a saved report.' }, outputName: { type: 'string', description: 'Output filename only; directories are not allowed.' },
    }, output: jsonOutput,
    async execute(args, exec) { return extractCad(args as any, config, exec.signal) as any },
  }))
  ctx.tools.register(defineTool({
    name: 'cad_export', description: 'Export a DWG/DXF drawing as a simple SVG or PNG preview, or convert it to DXF. The source file is never changed.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or working-directory-relative DWG/DXF path.' },
      format: { type: 'string', required: true, enum: ['svg', 'png', 'dxf'], description: 'Export format.' }, outputName: { type: 'string', description: 'Output filename only; directories are not allowed.' },
      layers: { type: 'array', items: { type: 'string' }, description: 'Optional layer-name filter for SVG/PNG.' }, width: { type: 'integer', description: 'PNG width in pixels; must be at least 1 and within the configured maximum.' }, height: { type: 'integer', description: 'Alternative PNG height in pixels; must be at least 1, within the configured maximum, and cannot be combined with width.' }, background: { type: 'string', description: 'SVG/PNG background: transparent, a supported named color, or #RGB/#RRGGBB/#RRGGBBAA.' },
    }, output: jsonOutput,
    async execute(args, exec) { return exportCad(args as any, config, exec.signal) as any },
  }))
}
