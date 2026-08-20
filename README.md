# dsh-cad-plugin

DeepSeek Harness tools for read-only DWG/DXF inspection, information extraction, image export, and DWG-to-DXF conversion.

The first implementation targets DWG and DXF files through `@node-projects/acad-ts`. It never edits the input drawing.

From this package directory, install into a Harness profile with:

```sh
dsh plugin --profile dshcadtest add .
dsh --profile dshcadtest --dump-config
```

Outputs are written below the configured `outputDir` (default `./cad-output`).

The plugin registers three native tools:

- `cad_inspect` — drawing metadata, bounds, layers, blocks, and entity counts.
- `cad_extract` — texts, layers, blocks, or entities; optional JSON/CSV report.
- `cad_export` — simple SVG/PNG preview or DXF conversion.

The preview renderer focuses on common 2D lines, polylines, circles, and text. It preserves the source drawing and reports parser warnings for unsupported or malformed CAD objects.
