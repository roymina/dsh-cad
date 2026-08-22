# dsh-cad-plugin

DeepSeek Harness tools for read-only DWG/DXF inspection, information extraction, image export, and DWG-to-DXF conversion.

The first implementation targets DWG and DXF files through `@node-projects/acad-ts`. It never edits the input drawing.

From this package directory, install into a Harness profile with:

```sh
dsh plugin --profile dshcadtest add .
dsh --profile dshcadtest --dump-config
```

Outputs are written below the configured `outputDir` (default `./cad-output`).

## Configuration and limits

`outputDir` is isolated from input files and existing outputs are never overwritten. Resource defaults are: `maxFileSizeMB=50`, `maxEntities=200000`, `maxExtractItems=10000`, `maxImageDimension=8192`, `maxImagePixels=64000000`, `maxBlockDepth=16`, `maxBlockInstances=10000`, `maxConcurrent=2`, `maxSvgBytes=20000000`, and `maxCsvBytes=20000000`. Set `allowedInputRoots` to restrict canonical input paths; paths outside it return `INPUT_OUTSIDE_ALLOWED_ROOTS`.

The plugin registers three native tools:

- `cad_inspect` — drawing metadata, bounds, layers, blocks, and entity counts.
- `cad_extract` — texts, layers, blocks, or entities; optional JSON/CSV report.
- `cad_export` — simple SVG/PNG preview or DXF conversion.

All tools return JSON with either a successful result or `{ ok:false, error:{ code, message, details } }`. Common recovery codes include `FILE_NOT_FOUND`, `PERMISSION_DENIED`, `INPUT_OUTSIDE_ALLOWED_ROOTS`, `UNSUPPORTED_FORMAT`, `PARSE_FAILED`, `ENTITY_LIMIT_EXCEEDED`, `GEOMETRY_LIMIT_EXCEEDED`, `RENDER_LIMIT_EXCEEDED`, `OUTPUT_EXISTS`, `OUTPUT_LIMIT_EXCEEDED`, and `CONVERSION_VALIDATION_FAILED`.

## Examples

```json
{"path":"./plan.dwg"}
```

`cad_inspect` returns version/unit objects, header and actual bounds, layer flags, model/Paper Space and block statistics, resource counts, and a bounded warning summary.

```json
{"path":"./plan.dwg","section":"texts","limit":200,"saveAs":"csv","bom":true}
```

`cad_extract` supports `texts`, `layers`, `blocks`, and `entities`; filters and limits are applied before returning records. CSV cells beginning with `=`, `+`, `-`, or `@` are protected against formula injection.

```json
{"path":"./plan.dwg","format":"svg","layout":"Model","background":"#ffffff"}
```

`cad_export` supports SVG, PNG, and validated Unicode binary DXF. SVG/PNG results include output bytes, SHA-256, bounds, source/expanded/rendered/skipped counts, unsupported type counts, and preview completeness. DXF conversion reopens the output and compares text, entity types, and layers; severe mismatches return `CONVERSION_VALIDATION_FAILED`.

The preview supports lines, circles, arcs, ellipses, splines, hatches, polylines (including closed/bulge paths), text/MText/attributes, inserts with nested transforms and arrays, points, solids, and leaders. Raster images, wipeouts, meshes, and unsupported proxy entities remain explicit in `unsupportedEntityTypes`. Paper Space is selected with `layout`; `Model` is the default.

DWG input is read-only. DXF output uses the library byte writer with a UTF-8 code page and semantic round-trip validation. Parser and writer warnings are deduplicated and capped to a configurable sample count.

The preview renderer focuses on common 2D lines, polylines, circles, and text. It preserves the source drawing and reports parser warnings for unsupported or malformed CAD objects.
