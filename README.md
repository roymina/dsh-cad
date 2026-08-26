# dsh-cad-plugin

[English](./README.md) · [中文](./README.zh.md)

Read-only DWG/DXF tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): inspect, extract and export CAD drawings — including SVG/PNG previews and DWG-to-DXF conversion — without ever modifying the input file.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

- **Three native tools** — `cad_inspect`, `cad_extract`, `cad_export`.
- **Read-only by design** — the source drawing is never edited; outputs go to a separate directory.
- **Resource-guarded** — file size, entity, vertex, image and output-byte limits, plus worker-thread isolation and hard timeouts.
- **Round-trip validated** — DXF output is reopened and checked for text, entity-type and layer mismatches.

## Installation

From the [dsh-market](https://github.com/dsh-market/dsh-market) plugin market: open the market, find **dsh-cad-plugin** and click install. Or install by name from the command line:

```sh
dsh plugin --profile <your-profile> add dsh-cad-plugin
```

To install from a local checkout (development):

```sh
dsh plugin --profile dshcadtest add .
dsh --profile dshcadtest --dump-config
```

## Usage

Once installed, the three CAD tools are available to the model. Put a `.dwg` or `.dxf` file in the profile's **workspace** (the session working directory) and ask about it in natural language — the model resolves the file path and calls the right tool for you:

> "Inspect `plan.dwg` and summarize its layers and blocks."
> "Extract all texts from `./drawings/floorplan.dxf` to CSV."
> "Render an SVG preview of `plan.dwg` (Model layout, white background)."

Paths may be absolute (`C:\drawings\plan.dwg`) or relative to the workspace (`plan.dwg`, `./plan.dwg`).

> **Note on attaching files:** the DeepSeek Harness Web composer's attachment button currently accepts images only. To work with a CAD file, reference it by path or filename as shown above rather than attaching it.

## Tools

| Tool | Purpose |
|------|---------|
| `cad_inspect` | Drawing metadata, units, bounds, layers, blocks and entity statistics. |
| `cad_extract` | Extract texts, layers, blocks or entities; optional JSON/CSV report. |
| `cad_export` | SVG or PNG preview, or DXF conversion. |

All tools return JSON: a successful result, or `{ ok:false, error:{ code, message, details } }`.

### Parameters

- `cad_inspect` — `path` (required).
- `cad_extract` — `path`, `section` (`texts`\|`layers`\|`blocks`\|`entities`, required); optional `layers`, `entityTypes`, `limit`, `offset`, `search`, `handle`, `window`, `nearest`, `summary`, `saveAs` (`json`\|`csv`), `outputName`.
- `cad_export` — `path`, `format` (`svg`\|`png`\|`dxf`, required); optional `layers`, `layout`, `width`, `height`, `background`, `outputName`.

## Examples

```json
{"path":"./plan.dwg"}
```

`cad_inspect` returns version/unit objects, header and actual bounds, layer flags, model/paper-space and block statistics, resource counts and a bounded warning summary.

```json
{"path":"./plan.dwg","section":"texts","limit":200,"saveAs":"csv","bom":true}
```

`cad_extract` supports `texts`, `layers`, `blocks` and `entities`; filters and limits are applied before records are returned. CSV cells beginning with `=`, `+`, `-` or `@` are protected against formula injection.

```json
{"path":"./plan.dwg","format":"svg","layout":"Model","background":"#ffffff"}
```

`cad_export` supports SVG, PNG and validated Unicode binary DXF. SVG/PNG results include output bytes, SHA-256, bounds, source/expanded/rendered/skipped counts, unsupported-type counts and preview completeness. DXF conversion reopens the output and compares text, entity types and layers; severe mismatches return `CONVERSION_VALIDATION_FAILED`.

## Configuration

All values are optional; the defaults below apply unless overridden in the plugin config.

| Key | Default | Meaning |
|-----|---------|---------|
| `outputDir` | `./cad-output` | Directory for exported reports and previews. |
| `maxFileSizeMB` | `50` | Maximum input file size. |
| `maxEntities` | `200000` | Maximum parsed entities. |
| `maxExtractItems` | `500` | Default record limit for extraction. |
| `maxImageDimension` | `8192` | Maximum PNG width/height in pixels. |
| `maxImagePixels` | `64000000` | Maximum total PNG pixels. |
| `maxWarningSamples` | `50` | Warning samples returned per run. |
| `maxBlockDepth` | `16` | Maximum nested-block expansion depth. |
| `maxBlockInstances` | `10000` | Maximum expanded block instances. |
| `maxConcurrent` | `2` | Maximum concurrent CAD jobs. |
| `maxWorkerTimeMs` | `30000` | Hard timeout for worker-isolated parse/render. |
| `maxSvgBytes` | `20000000` | Maximum SVG output bytes. |
| `maxCsvBytes` | `20000000` | Maximum CSV output bytes. |
| `maxTextLength` | `1000000` | Maximum single text length. |
| `maxTotalVertices` | `5000000` | Maximum total vertices. |
| `maxEntityVertices` | `500000` | Maximum vertices per entity. |
| `allowedInputRoots` | *(unset)* | Optional allow-list of input roots; when set, paths outside it return `INPUT_OUTSIDE_ALLOWED_ROOTS`. |

Outputs are isolated from inputs, and existing files are never overwritten.

## Error codes

Input and access — `FILE_NOT_FOUND`, `PERMISSION_DENIED`, `NOT_A_FILE`, `READ_FAILED`, `UNSUPPORTED_FORMAT`, `INPUT_OUTSIDE_ALLOWED_ROOTS`.

Limits — `FILE_TOO_LARGE`, `ENTITY_LIMIT_EXCEEDED`, `TEXT_LIMIT_EXCEEDED`, `GEOMETRY_LIMIT_EXCEEDED`, `RENDER_LIMIT_EXCEEDED`, `OUTPUT_LIMIT_EXCEEDED`, `OUTPUT_EXISTS`.

Arguments and parse — `INVALID_ARGUMENT`, `LAYOUT_NOT_FOUND`, `PARSE_FAILED`.

Conversion and export — `CONVERSION_FAILED`, `CONVERSION_VALIDATION_FAILED`, `EXPORT_FAILED`, `OUTPUT_FAILED`.

Runtime — `CANCELLED`, `TIMEOUT`.

## Preview fidelity

The SVG/PNG preview renders lines, circles, arcs, ellipses, splines, hatches, polylines (including closed/bulge paths), text/MText/attributes, inserts with nested transforms and arrays, points, solids and leaders. Raster images, wipeouts, meshes and unsupported proxy entities are reported in `unsupportedEntityTypes`. Paper Space is selected with `layout`; `Model` is the default.

## License

[MIT](./LICENSE)
