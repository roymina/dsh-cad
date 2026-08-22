import { readFile, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ACadVersion, DwgReader, DxfReader, DxfWriter, LayerFlags } from '@node-projects/acad-ts';
import { Resvg } from '@resvg/resvg-js';
export const name = 'dsh-cad-plugin';
export const inject = ['tools'];
export const Config = Schema.object({
    outputDir: Schema.string().default('./cad-output'),
    maxFileSizeMB: Schema.number().default(50),
    maxEntities: Schema.number().default(200_000),
    maxExtractItems: Schema.number().default(10_000),
    maxImageDimension: Schema.number().default(8192),
    maxImagePixels: Schema.number().default(64_000_000),
    maxWarningSamples: Schema.number().default(50),
    maxBlockDepth: Schema.number().default(16),
    maxBlockInstances: Schema.number().default(10_000),
});
const text = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];
const jsonOutput = { schema: { type: 'json' }, render: text };
function error(code, message, details) {
    return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}
const namedBackgrounds = new Set(['black', 'white', 'gray', 'silver', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta']);
function validPath(value) {
    return value.trim().length > 0;
}
function validOutputName(value) {
    return value.trim().length > 0 && value !== '.' && value !== '..' && path.basename(value) === value && !/[<>:"/\\|?*\u0000-\u001F]/.test(value);
}
function validBackground(value) {
    return value === 'transparent' || namedBackgrounds.has(value.toLowerCase()) || /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(value);
}
function invalidPath(pathValue) {
    return !validPath(pathValue) ? error('INVALID_ARGUMENT', 'path must be a non-empty string.') : undefined;
}
function isErrorResult(value) {
    return 'ok' in value && value.ok === false;
}
function summarizeWarnings(warnings, maxSamples = 50) {
    const byCode = {};
    const unique = new Map();
    for (const warning of warnings) {
        byCode[warning.code] = (byCode[warning.code] ?? 0) + 1;
        unique.set(`${warning.code}\u0000${warning.message}`, warning);
    }
    const samples = Array.from(unique.values()).slice(0, maxSamples);
    return { total: warnings.length, byCode, samples, truncated: unique.size > samples.length };
}
function entityName(entity) {
    return entity?.constructor?.name ?? 'UnknownEntity';
}
function entityLayer(entity) {
    return entity?.layer?.name ?? entity?._layer?.name ?? '0';
}
function point(value) {
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
        ? { x: Number(value.x), y: Number(value.y), z: Number(value.z ?? 0) }
        : undefined;
}
function entities(document) {
    return Array.from(document.entities ?? []);
}
function blocks(document) {
    return Array.from(document.blockRecords ?? []);
}
function semanticSnapshot(document) {
    const entityTypes = {};
    const textValues = [];
    for (const entity of entities(document)) {
        const kind = entityName(entity);
        entityTypes[kind] = (entityTypes[kind] ?? 0) + 1;
        if (['TextEntity', 'MText', 'AttributeEntity'].includes(kind))
            textValues.push(String(entity.value ?? entity._value ?? ''));
    }
    return {
        texts: textValues,
        entityTypes,
        layers: Array.from(document.layers ?? []).map((layer) => String(layer.name)).sort(),
    };
}
function equalRecords(left, right) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return Array.from(keys).every(key => left[key] === right[key]);
}
function validateConversion(source, converted) {
    const textValuesMatch = JSON.stringify(source.texts) === JSON.stringify(converted.texts);
    const entityTypesMatch = equalRecords(source.entityTypes, converted.entityTypes);
    const layersMatch = JSON.stringify(source.layers) === JSON.stringify(converted.layers);
    const unpreservedObjectTypes = Array.from(new Set([...Object.keys(source.entityTypes), ...Object.keys(converted.entityTypes)]))
        .filter(type => source.entityTypes[type] !== converted.entityTypes[type]);
    const differences = [];
    if (!textValuesMatch)
        differences.push('Text values differ after conversion.');
    if (!entityTypesMatch)
        differences.push('Entity type counts differ after conversion.');
    if (!layersMatch)
        differences.push('Layer names differ after conversion.');
    return {
        status: differences.length === 0 ? 'passed' : 'failed',
        checks: { textValuesMatch, entityTypesMatch, layersMatch },
        differences,
        unpreservedObjectTypes,
    };
}
function layerRows(document) {
    return Array.from(document.layers ?? []).map((layer) => ({
        name: layer.name,
        isOn: layer.isOn !== false,
        isFrozen: (layer.layerFlags & LayerFlags.Frozen) !== 0,
        colorIndex: layer.color?._color ?? layer._color?._color ?? null,
    }));
}
function bounds(document) {
    const min = point(document.header?.modelSpaceExtMin);
    const max = point(document.header?.modelSpaceExtMax);
    return min && max && Number.isFinite(min.x + min.y + max.x + max.y) && (min.x !== max.x || min.y !== max.y)
        ? { min, max }
        : null;
}
async function loadCad(input, config, signal) {
    if (signal?.aborted)
        return error('CANCELLED', 'Operation was cancelled before reading the drawing.');
    const inputPath = path.resolve(input);
    let stat;
    try {
        stat = await lstat(inputPath);
    }
    catch {
        return error('FILE_NOT_FOUND', 'The CAD file does not exist.', { path: inputPath });
    }
    if (!stat.isFile())
        return error('NOT_A_FILE', 'The CAD path must point to a regular file.', { path: inputPath });
    if (stat.size > config.maxFileSizeMB * 1024 * 1024) {
        return error('FILE_TOO_LARGE', 'The CAD file exceeds the configured size limit.', { bytes: stat.size, maxFileSizeMB: config.maxFileSizeMB });
    }
    const format = path.extname(inputPath).toLowerCase().slice(1);
    if (format !== 'dwg' && format !== 'dxf')
        return error('UNSUPPORTED_FORMAT', 'Only DWG and DXF input files are supported.', { path: inputPath });
    const warnings = [];
    try {
        const bytes = await readFile(inputPath);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const notify = (_sender, event) => warnings.push({ code: 'PARSER_WARNING', message: String(event?.message ?? event) });
        const document = format === 'dwg'
            ? DwgReader.readFromStream(buffer, notify)
            : DxfReader.readFromStream(new Uint8Array(buffer), notify);
        const entityCount = entities(document).length;
        if (entityCount > config.maxEntities) {
            return error('ENTITY_LIMIT_EXCEEDED', 'The drawing exceeds the configured entity limit.', { entityCount, maxEntities: config.maxEntities });
        }
        return { document, inputPath, format, warnings };
    }
    catch (cause) {
        return error('PARSE_FAILED', 'The CAD drawing could not be parsed.', { path: inputPath, message: cause instanceof Error ? cause.message : String(cause) });
    }
}
function inspect(document, inputPath, format, warnings, maxWarningSamples) {
    const all = entities(document);
    const byType = {};
    const byLayer = {};
    for (const entity of all) {
        byType[entityName(entity)] = (byType[entityName(entity)] ?? 0) + 1;
        byLayer[entityLayer(entity)] = (byLayer[entityLayer(entity)] ?? 0) + 1;
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
        blocks: blocks(document).map((block) => ({ name: block.name, entityCount: Array.from(block.entities ?? []).length })),
        textCount: all.filter(entity => ['TextEntity', 'MText', 'AttributeEntity'].includes(entityName(entity))).length,
        warnings: summarizeWarnings(warnings, maxWarningSamples),
    };
}
function entityRecord(entity) {
    const kind = entityName(entity);
    const base = { handle: entity.handle ?? null, type: kind, layer: entityLayer(entity), invisible: Boolean(entity.isInvisible) };
    if (kind === 'TextEntity' || kind === 'MText' || kind === 'AttributeEntity') {
        return { ...base, text: entity.value ?? entity._value ?? entity.text ?? '', position: point(entity.insertPoint ?? entity.location), height: entity.height ?? entity._height ?? null, rotation: entity.rotation ?? 0 };
    }
    if (kind === 'Line')
        return { ...base, start: point(entity.startPoint), end: point(entity.endPoint) };
    if (kind === 'Circle')
        return { ...base, center: point(entity.center), radius: entity.radius ?? entity._radius ?? null };
    if (kind === 'LwPolyline' || kind === 'Polyline2D' || kind === 'Polyline3D') {
        return { ...base, vertices: Array.from(entity.vertices ?? []).map((vertex) => point(vertex.location ?? vertex)).filter(Boolean), closed: Boolean(entity.isClosed ?? (entity._flags & 1)) };
    }
    if (kind === 'Insert')
        return { ...base, block: entity.block?.name ?? entity.block?.record?.name ?? null, position: point(entity.insertPoint), rotation: entity.rotation ?? 0 };
    return base;
}
function extract(document, section, layers, entityTypes, limit) {
    const all = entities(document);
    const filtered = all.filter(entity => (!layers?.length || layers.includes(entityLayer(entity))) && (!entityTypes?.length || entityTypes.includes(entityName(entity))));
    const source = section === 'texts' ? filtered.filter(entity => ['TextEntity', 'MText', 'AttributeEntity'].includes(entityName(entity)))
        : section === 'layers' ? Array.from(document.layers ?? [])
            : section === 'blocks' ? blocks(document)
                : filtered;
    const records = source.slice(0, limit).map((item) => section === 'layers'
        ? { name: item.name, isOn: item.isOn !== false, isFrozen: (item.layerFlags & LayerFlags.Frozen) !== 0, colorIndex: item.color?._color ?? item._color?._color ?? null }
        : section === 'blocks' ? { name: item.name, entityCount: Array.from(item.entities ?? []).length }
            : entityRecord(item));
    return { ok: true, section, total: source.length, returned: records.length, truncated: records.length < source.length, records };
}
function escapeXml(value) {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}
function drawingPoints(entity) {
    const kind = entityName(entity);
    if (kind === 'Line')
        return [point(entity.startPoint), point(entity.endPoint)].filter(Boolean);
    if (kind === 'LwPolyline' || kind === 'Polyline2D' || kind === 'Polyline3D')
        return Array.from(entity.vertices ?? []).map((v) => point(v.location ?? v)).filter(Boolean);
    if (kind === 'Circle') {
        const center = point(entity.center);
        const radius = Number(entity.radius ?? entity._radius);
        return center && Number.isFinite(radius) ? [{ x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y + radius }] : [];
    }
    const location = point(entity.insertPoint ?? entity.center);
    return location ? [location] : [];
}
const svgRenderers = {
    Line(entity, color) {
        const a = point(entity.startPoint);
        const b = point(entity.endPoint);
        return a && b ? `<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" stroke="${color}"/>` : '';
    },
    LwPolyline: renderPolyline,
    Polyline2D: renderPolyline,
    Polyline3D: renderPolyline,
    Circle(entity, color) {
        const center = point(entity.center);
        const radius = Number(entity.radius ?? entity._radius);
        return center && Number.isFinite(radius) ? `<circle cx="${center.x}" cy="${-center.y}" r="${radius}" fill="none" stroke="${color}"/>` : '';
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
    AttributeEntity: renderText,
};
function renderPolyline(entity, color) {
    const vertices = Array.from(entity.vertices ?? []);
    const points = vertices.map(vertex => point(vertex.location ?? vertex)).filter(Boolean);
    if (points.length < 2)
        return '';
    let path = `M ${points[0].x} ${-points[0].y}`;
    const segmentCount = entity.isClosed ? points.length : points.length - 1;
    for (let index = 0; index < segmentCount; index++) {
        const end = points[(index + 1) % points.length];
        const bulge = Number(vertices[index]?.bulge ?? 0);
        if (Number.isFinite(bulge) && bulge !== 0) {
            const start = points[index];
            const chord = Math.hypot(end.x - start.x, end.y - start.y);
            const angle = 4 * Math.atan(bulge);
            const radius = chord / (2 * Math.sin(Math.abs(angle) / 2));
            path += Number.isFinite(radius) ? ` A ${radius} ${radius} 0 ${Math.abs(angle) > Math.PI ? 1 : 0} ${bulge < 0 ? 1 : 0} ${end.x} ${-end.y}` : ` L ${end.x} ${-end.y}`;
        }
        else
            path += ` L ${end.x} ${-end.y}`;
    }
    if (entity.isClosed)
        path += ' Z';
    return `<path d="${path}" fill="none" stroke="${color}"/>`;
}
function renderText(entity, color) {
    const aligned = Number(entity.horizontalAlignment ?? 0) !== 0 || Number(entity.verticalAlignment ?? 0) !== 0;
    const at = point(aligned ? entity.alignmentPoint ?? entity.insertPoint : entity.insertPoint);
    const value = String(entity.plainText ?? entity.value ?? entity._value ?? '');
    const size = Number(entity.height ?? entity._height ?? 2.5);
    if (!at)
        return '';
    const attachment = entity.attachmentPoint;
    const horizontal = Number(entity.horizontalAlignment ?? 0);
    const vertical = Number(entity.verticalAlignment ?? 0);
    const anchor = attachment !== undefined
        ? [3, 6, 9].includes(Number(attachment)) ? 'end' : [2, 5, 8].includes(Number(attachment)) ? 'middle' : 'start'
        : [2, 3].includes(horizontal) ? 'end' : [1, 4].includes(horizontal) ? 'middle' : 'start';
    const baseline = attachment !== undefined
        ? [1, 2, 3].includes(Number(attachment)) ? 'hanging' : [4, 5, 6].includes(Number(attachment)) ? 'middle' : 'baseline'
        : vertical === 3 ? 'hanging' : vertical === 2 ? 'middle' : 'baseline';
    const rotation = -Number(entity.rotation ?? 0) * 180 / Math.PI;
    const widthFactor = Number(entity.widthFactor ?? 1);
    const transform = rotation || widthFactor !== 1 ? ` transform="translate(${at.x} ${-at.y}) rotate(${rotation}) scale(${widthFactor} 1) translate(${-at.x} ${at.y})"` : '';
    const fontFamily = entity.style?.filename ? ` font-family="${escapeXml(String(entity.style.filename).replace(/\.[^.]+$/, ''))}"` : '';
    return `<text x="${at.x}" y="${-at.y}" font-size="${size}" text-anchor="${anchor}" alignment-baseline="${baseline}"${fontFamily}${transform} fill="${color}">${escapeXml(value)}</text>`;
}
function svgPath(points, closed = false) {
    const values = points.map(point).filter(Boolean);
    return values.length > 1 ? `M ${values.map((value, index) => `${index === 0 ? '' : 'L '}${value.x} ${-value.y}`).join(' ')}${closed ? ' Z' : ''}` : '';
}
function renderCurve(entity, color) {
    const points = entity.polygonalVertexes?.(96) ?? entity.tryPolygonalVertexes?.(96)?.points ?? [];
    const path = svgPath(points, Boolean(entity.isClosed));
    return path ? `<path d="${path}" fill="none" stroke="${color}"/>` : '';
}
function renderHatch(entity, color) {
    const path = (entity.paths ?? []).map((boundary) => svgPath(boundary.getPoints?.(96) ?? [], true)).filter(Boolean).join(' ');
    return path ? `<path d="${path}" fill="${entity.isSolid ? color : 'none'}" fill-rule="evenodd" stroke="${color}"/>` : '';
}
function renderPoint(entity, color) {
    const location = point(entity.location);
    return location ? `<circle cx="${location.x}" cy="${-location.y}" r="1" fill="${color}"/>` : '';
}
function renderSolid(entity, color) {
    const points = [entity.firstCorner, entity.secondCorner, entity.thirdCorner, entity.fourthCorner].map(point).filter(Boolean);
    const values = points.map(value => `${value.x},${-value.y}`).join(' ');
    return values ? `<polygon points="${values}" fill="${color}" stroke="${color}"/>` : '';
}
function renderLeader(entity, color) {
    const path = svgPath(entity.vertices ?? []);
    return path ? `<path d="${path}" fill="none" stroke="${color}"/>` : '';
}
function hasCircularBlockReference(block, blockStack = new Set()) {
    const blockName = String(block?.name ?? '');
    if (!blockName || blockStack.has(blockName))
        return true;
    const nextStack = new Set(blockStack).add(blockName);
    const childEntities = Array.from(block.entities ?? []);
    return childEntities.some(entity => entityName(entity) === 'Insert' && hasCircularBlockReference(entity.block, nextStack));
}
function expandInsert(insert, maxDepth, maxInstances, depth = 0, blockStack = new Set()) {
    const blockName = String(insert.block?.name ?? '');
    if (!blockName || depth >= maxDepth || blockStack.has(blockName) || hasCircularBlockReference(insert.block))
        return [];
    const nextStack = new Set(blockStack).add(blockName);
    const rows = Math.max(1, Number(insert.rowCount ?? 1));
    const columns = Math.max(1, Number(insert.columnCount ?? 1));
    const total = Math.min(rows * columns, maxInstances);
    const expanded = [];
    for (let index = 0; index < total; index++) {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const instance = insert.clone();
        const rotation = Number(instance.rotation ?? 0);
        const localX = column * Number(instance.columnSpacing ?? 0) * Number(instance.xScale ?? 1);
        const localY = row * Number(instance.rowSpacing ?? 0) * Number(instance.yScale ?? 1);
        const insertPoint = instance.insertPoint;
        insertPoint.x += localX * Math.cos(rotation) - localY * Math.sin(rotation);
        insertPoint.y += localX * Math.sin(rotation) + localY * Math.cos(rotation);
        for (const entity of instance.explode()) {
            if (entityName(entity) === 'Insert')
                expanded.push(...expandInsert(entity, maxDepth, maxInstances - expanded.length, depth + 1, nextStack));
            else
                expanded.push(entity);
            if (expanded.length >= maxInstances)
                return expanded;
        }
    }
    return expanded;
}
function layoutEntities(document, layoutName) {
    if (!layoutName || layoutName.toLowerCase() === 'model')
        return entities(document);
    const layout = Array.from(document.layouts ?? []).find((item) => String(item.name).toLowerCase() === layoutName.toLowerCase());
    return layout ? Array.from(layout.associatedBlock?.entities ?? []) : undefined;
}
function makeSvg(document, selectedLayers, background = 'white', maxBlockDepth = 16, maxBlockInstances = 10_000, layoutName) {
    const source = (layoutEntities(document, layoutName) ?? []).filter(entity => !entity.isInvisible && (!selectedLayers?.length || selectedLayers.includes(entityLayer(entity))));
    const drawing = source.flatMap(entity => entityName(entity) === 'Insert' ? expandInsert(entity, maxBlockDepth, maxBlockInstances) : [entity]);
    const points = drawing.flatMap(drawingPoints);
    const declared = bounds(document);
    const minX = declared?.min.x ?? Math.min(...points.map(p => p.x), 0);
    const minY = declared?.min.y ?? Math.min(...points.map(p => p.y), 0);
    const maxX = declared?.max.x ?? Math.max(...points.map(p => p.x), 100);
    const maxY = declared?.max.y ?? Math.max(...points.map(p => p.y), 100);
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const unsupportedEntityTypes = {};
    const primitives = [];
    for (const entity of drawing) {
        const color = '#202020';
        const kind = entityName(entity);
        const primitive = svgRenderers[kind]?.(entity, color) ?? '';
        if (primitive)
            primitives.push(primitive);
        else
            unsupportedEntityTypes[kind] = (unsupportedEntityTypes[kind] ?? 0) + 1;
    }
    const content = primitives.join('');
    const bg = background === 'transparent' ? '' : `<rect x="${minX}" y="${-maxY}" width="${width}" height="${height}" fill="${background}"/>`;
    return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${width} ${height}">${bg}<g stroke-width="${Math.max(width, height) / 2500}">${content}</g></svg>`,
        bounds: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } },
        sourceEntityCount: drawing.length,
        renderedPrimitiveCount: primitives.length,
        unsupportedEntityTypes,
        previewCompleteness: drawing.length === 0 ? 1 : primitives.length / drawing.length,
    };
}
async function outputPath(config, name, extension) {
    if (!validOutputName(name))
        throw new Error('outputName must be a non-empty filename without path segments or reserved characters.');
    const dir = path.resolve(config.outputDir);
    await mkdir(dir, { recursive: true });
    const realDir = await realpath(dir);
    const result = path.join(realDir, name.endsWith(`.${extension}`) ? name : `${name}.${extension}`);
    if (!result.startsWith(`${realDir}${path.sep}`))
        throw new Error('Output path escapes outputDir.');
    try {
        await lstat(result);
        throw new Error('Output file already exists; choose a different outputName.');
    }
    catch (cause) {
        if (cause?.code !== 'ENOENT')
            throw cause;
    }
    return result;
}
function csv(records) {
    const columns = Array.from(new Set(records.flatMap(record => Object.keys(record))));
    const cell = (value) => `"${String(typeof value === 'object' ? JSON.stringify(value) : value ?? '').replaceAll('"', '""')}"`;
    return [columns.join(','), ...records.map(record => columns.map(column => cell(record[column])).join(','))].join('\n');
}
export async function inspectCad(pathValue, config, signal) {
    const invalid = invalidPath(pathValue);
    if (invalid)
        return invalid;
    const loaded = await loadCad(pathValue, config, signal);
    if (isErrorResult(loaded))
        return loaded;
    return inspect(loaded.document, loaded.inputPath, loaded.format, loaded.warnings, config.maxWarningSamples ?? 50);
}
export async function extractCad(args, config, signal) {
    const invalid = invalidPath(args.path);
    if (invalid)
        return invalid;
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 0))
        return error('INVALID_ARGUMENT', 'limit must be a non-negative integer.');
    if (args.outputName !== undefined && !validOutputName(args.outputName))
        return error('INVALID_ARGUMENT', 'outputName must be a non-empty filename without path segments or reserved characters.');
    const loaded = await loadCad(args.path, config, signal);
    if (isErrorResult(loaded))
        return loaded;
    const result = extract(loaded.document, args.section, args.layers, args.entityTypes, Math.min(args.limit ?? config.maxExtractItems, config.maxExtractItems));
    if (!args.saveAs)
        return result;
    try {
        const output = await outputPath(config, args.outputName ?? `${path.parse(loaded.inputPath).name}-${args.section}`, args.saveAs);
        await writeFile(output, args.saveAs === 'json' ? JSON.stringify(result, null, 2) : csv(result.records), 'utf8');
        return { ...result, outputPath: output };
    }
    catch (cause) {
        return error('OUTPUT_FAILED', cause instanceof Error ? cause.message : String(cause));
    }
}
export async function exportCad(args, config, signal) {
    const invalid = invalidPath(args.path);
    if (invalid)
        return invalid;
    if (args.outputName !== undefined && !validOutputName(args.outputName))
        return error('INVALID_ARGUMENT', 'outputName must be a non-empty filename without path segments or reserved characters.');
    if (args.background !== undefined && !validBackground(args.background))
        return error('INVALID_ARGUMENT', 'background must be transparent, a supported named color, or a #RGB/#RRGGBB/#RRGGBBAA color.');
    if (args.width !== undefined && (!Number.isInteger(args.width) || args.width < 1 || args.width > config.maxImageDimension))
        return error('INVALID_ARGUMENT', `width must be an integer between 1 and ${config.maxImageDimension}.`);
    if (args.height !== undefined && (!Number.isInteger(args.height) || args.height < 1 || args.height > config.maxImageDimension))
        return error('INVALID_ARGUMENT', `height must be an integer between 1 and ${config.maxImageDimension}.`);
    if (args.width !== undefined && args.height !== undefined)
        return error('INVALID_ARGUMENT', 'Specify either width or height for PNG output, not both.');
    const loaded = await loadCad(args.path, config, signal);
    if (isErrorResult(loaded))
        return loaded;
    if (args.layout && !layoutEntities(loaded.document, args.layout))
        return error('LAYOUT_NOT_FOUND', 'The requested layout does not exist.', { layout: args.layout });
    try {
        const output = await outputPath(config, args.outputName ?? `${path.parse(loaded.inputPath).name}-preview`, args.format);
        if (args.format === 'dxf') {
            const source = semanticSnapshot(loaded.document);
            const conversionWarnings = [];
            // Binary DXF avoids the ASCII reader's line trimming and writes encoded
            // bytes directly. Mark the output as Unicode so readers decode text as
            // UTF-8 rather than using the source DWG code page (for example GB2312).
            loaded.document.header.version = Math.max(loaded.document.header.version, ACadVersion.AC1021);
            loaded.document.header.codePage = 'UTF-8';
            const fileStream = createWriteStream(output, { flags: 'wx' });
            fileStream.on('error', () => { });
            let opened = false;
            fileStream.once('open', () => { opened = true; });
            try {
                DxfWriter.writeToStream({
                    write: (value) => { fileStream.write(value); },
                    flush: () => { },
                    close: () => { fileStream.end(); },
                }, loaded.document, true, undefined, (_sender, event) => {
                    conversionWarnings.push({ code: 'DXF_WRITER_WARNING', message: String(event?.message ?? event) });
                });
                await finished(fileStream);
            }
            catch (cause) {
                fileStream.destroy();
                if (opened)
                    await rm(output, { force: true });
                throw cause;
            }
            const converted = await loadCad(output, config, signal);
            if (isErrorResult(converted)) {
                return {
                    ok: false,
                    error: { code: 'CONVERSION_VALIDATION_FAILED', message: 'The exported DXF could not be parsed for validation.', details: converted.error },
                    format: 'dxf', outputPath: output,
                    conversionValidation: { status: 'failed', checks: { textValuesMatch: false, entityTypesMatch: false, layersMatch: false }, differences: ['The exported DXF could not be parsed.'], unpreservedObjectTypes: Object.keys(source.entityTypes) },
                    lossRisk: { level: 'severe', reasons: ['The exported DXF could not be parsed.'] },
                    warnings: summarizeWarnings([...loaded.warnings, ...conversionWarnings], config.maxWarningSamples ?? 50),
                };
            }
            const conversionValidation = validateConversion(source, semanticSnapshot(converted.document));
            const lossRisk = {
                level: conversionValidation.status === 'failed' ? 'severe' : conversionWarnings.length > 0 ? 'warning' : 'none',
                reasons: [...conversionValidation.differences, ...conversionWarnings.map(warning => warning.message)],
            };
            if (conversionValidation.status === 'failed') {
                return {
                    ok: false,
                    error: { code: 'CONVERSION_VALIDATION_FAILED', message: 'The exported DXF did not pass semantic validation.', details: { differences: conversionValidation.differences } },
                    format: 'dxf', outputPath: output, conversionValidation, lossRisk,
                    unpreservedObjectTypes: conversionValidation.unpreservedObjectTypes,
                    warnings: summarizeWarnings([...loaded.warnings, ...conversionWarnings, ...converted.warnings], config.maxWarningSamples ?? 50),
                };
            }
            return {
                ok: true, format: 'dxf', outputPath: output, conversionValidation, lossRisk,
                unpreservedObjectTypes: conversionValidation.unpreservedObjectTypes,
                warnings: summarizeWarnings([...loaded.warnings, ...conversionWarnings, ...converted.warnings], config.maxWarningSamples ?? 50),
            };
        }
        const drawing = makeSvg(loaded.document, args.layers, args.background, config.maxBlockDepth ?? 16, config.maxBlockInstances ?? 10_000, args.layout);
        if (args.format === 'svg')
            await writeFile(output, drawing.svg, 'utf8');
        else {
            const drawingWidth = drawing.bounds.max.x - drawing.bounds.min.x;
            const drawingHeight = drawing.bounds.max.y - drawing.bounds.min.y;
            const targetWidth = args.width ?? (args.height ? Math.max(1, Math.round(args.height * drawingWidth / drawingHeight)) : 1600);
            const targetHeight = args.height ?? Math.max(1, Math.round(targetWidth * drawingHeight / drawingWidth));
            const maxPixels = config.maxImagePixels ?? 64_000_000;
            if (targetWidth > config.maxImageDimension || targetHeight > config.maxImageDimension || targetWidth * targetHeight > maxPixels) {
                return error('RENDER_LIMIT_EXCEEDED', 'The requested PNG dimensions exceed the configured limits.', { width: targetWidth, height: targetHeight, maxImageDimension: config.maxImageDimension, maxImagePixels: maxPixels });
            }
            const rendered = new Resvg(drawing.svg, { fitTo: args.height ? { mode: 'height', value: targetHeight } : { mode: 'width', value: targetWidth }, background: args.background === 'transparent' ? undefined : args.background ?? 'white' }).render();
            if (rendered.width * rendered.height > maxPixels)
                return error('RENDER_LIMIT_EXCEEDED', 'The rendered PNG exceeds the configured pixel limit.', { width: rendered.width, height: rendered.height, maxImagePixels: maxPixels });
            const png = rendered.asPng();
            await writeFile(output, png);
        }
        return {
            ok: true, format: args.format, outputPath: output, bounds: drawing.bounds,
            layout: args.layout ?? 'Model', sourceEntityCount: drawing.sourceEntityCount, renderedPrimitiveCount: drawing.renderedPrimitiveCount,
            unsupportedEntityTypes: drawing.unsupportedEntityTypes, previewCompleteness: drawing.previewCompleteness,
            warnings: summarizeWarnings(loaded.warnings, config.maxWarningSamples ?? 50),
        };
    }
    catch (cause) {
        return error('EXPORT_FAILED', cause instanceof Error ? cause.message : String(cause));
    }
}
export function apply(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'cad_inspect', description: 'Inspect a DWG or DXF drawing without modifying it. Returns file metadata, units, bounds, layers, blocks and entity statistics.',
        parameters: { path: { type: 'string', required: true, description: 'Absolute or working-directory-relative DWG/DXF path.' } }, output: jsonOutput,
        async execute(args, exec) { return inspectCad(args.path, config, exec.signal); },
    }));
    ctx.tools.register(defineTool({
        name: 'cad_extract', description: 'Extract texts, layers, blocks, or entities from a DWG/DXF drawing. Optionally write JSON or CSV below the configured output directory.',
        parameters: {
            path: { type: 'string', required: true, description: 'Absolute or working-directory-relative DWG/DXF path.' },
            section: { type: 'string', required: true, enum: ['texts', 'layers', 'blocks', 'entities'], description: 'Information section to extract.' },
            layers: { type: 'array', items: { type: 'string' }, description: 'Optional layer-name filter.' }, entityTypes: { type: 'array', items: { type: 'string' }, description: 'Optional entity-type filter.' },
            limit: { type: 'integer', description: 'Maximum records to return.' }, saveAs: { type: 'string', enum: ['json', 'csv'], description: 'Optional file format for a saved report.' }, outputName: { type: 'string', description: 'Output filename only; directories are not allowed.' },
        }, output: jsonOutput,
        async execute(args, exec) { return extractCad(args, config, exec.signal); },
    }));
    ctx.tools.register(defineTool({
        name: 'cad_export', description: 'Export a DWG/DXF drawing as a simple SVG or PNG preview, or convert it to DXF. The source file is never changed.',
        parameters: {
            path: { type: 'string', required: true, description: 'Absolute or working-directory-relative DWG/DXF path.' },
            format: { type: 'string', required: true, enum: ['svg', 'png', 'dxf'], description: 'Export format.' }, outputName: { type: 'string', description: 'Output filename only; directories are not allowed.' },
            layers: { type: 'array', items: { type: 'string' }, description: 'Optional layer-name filter for SVG/PNG.' }, layout: { type: 'string', description: 'Model (default) or a Paper Space layout name for SVG/PNG.' }, width: { type: 'integer', description: 'PNG width in pixels; must be at least 1 and within the configured maximum.' }, height: { type: 'integer', description: 'Alternative PNG height in pixels; must be at least 1, within the configured maximum, and cannot be combined with width.' }, background: { type: 'string', description: 'SVG/PNG background: transparent, a supported named color, or #RGB/#RRGGBB/#RRGGBBAA.' },
        }, output: jsonOutput,
        async execute(args, exec) { return exportCad(args, config, exec.signal); },
    }));
}
