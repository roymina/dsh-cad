# dsh-cad-plugin

[English](./README.md) · [中文](./README.zh.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的只读 DWG/DXF 工具集：查看、提取和导出 CAD 图纸——支持 SVG/PNG 预览与 DWG→DXF 转换，全程不修改输入文件。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

- **三个原生工具** —— `cad_inspect`、`cad_extract`、`cad_export`。
- **只读设计** —— 源图纸永不被编辑；输出写入独立目录。
- **资源受控** —— 文件大小、实体、顶点、图像与输出字节数均有限额，并带 Worker 线程隔离与硬超时。
- **往返校验** —— DXF 输出会被重新打开，核对文字、实体类型与图层；严重不一致时返回 `CONVERSION_VALIDATION_FAILED`。

## 安装

在 [dsh-market](https://github.com/dsh-market/dsh-market) 插件市场中打开市场，找到 **dsh-cad-plugin** 并点击安装。也可以从命令行按名称安装：

```sh
dsh plugin --profile <你的-profile> add dsh-cad-plugin
```

从本地目录安装（开发用）：

```sh
dsh plugin --profile dshcadtest add .
dsh --profile dshcadtest --dump-config
```

## 使用方法

安装后，三个 CAD 工具即可被模型调用。把 `.dwg` 或 `.dxf` 文件放到该 profile 的**工作区**（会话工作目录）里，直接用自然语言提问即可——模型会自动解析文件路径并调用对应工具：

> 「查看 `plan.dwg`，总结它的图层和块。」
> 「把 `./drawings/floorplan.dxf` 里的所有文字提取为 CSV。」
> 「把 `plan.dwg` 导出 SVG 预览（Model 布局，白色背景）。」

路径可以是绝对路径（`C:\drawings\plan.dwg`），也可以是相对工作区的相对路径（`plan.dwg`、`./plan.dwg`）。

> **关于附件：** DeepSeek Harness Web 输入框的附件按钮目前仅支持图片。处理 CAD 文件时请用路径或文件名引用（如上所示），而不是把文件当附件上传。

## 工具

| 工具 | 用途 |
|------|------|
| `cad_inspect` | 图纸元数据、单位、边界、图层、块与实体统计。 |
| `cad_extract` | 提取文字、图层、块或实体；可选输出 JSON/CSV 报告。 |
| `cad_export` | 导出 SVG 或 PNG 预览，或转换 DXF。 |

所有工具都返回 JSON：成功结果，或 `{ ok:false, error:{ code, message, details } }`。

### 参数

- `cad_inspect` —— `path`（必填）。
- `cad_extract` —— `path`、`section`（`texts`\|`layers`\|`blocks`\|`entities`，必填）；可选 `layers`、`entityTypes`、`limit`、`offset`、`search`、`handle`、`window`、`nearest`、`summary`、`saveAs`（`json`\|`csv`）、`outputName`。
- `cad_export` —— `path`、`format`（`svg`\|`png`\|`dxf`，必填）；可选 `layers`、`layout`、`width`、`height`、`background`、`outputName`。

## 示例

```json
{"path":"./plan.dwg"}
```

`cad_inspect` 返回版本/单位对象、Header 与实际边界、图层标志、模型空间/图纸空间与块统计、资源计数，以及有上限的警告摘要。

```json
{"path":"./plan.dwg","section":"texts","limit":200,"saveAs":"csv","bom":true}
```

`cad_extract` 支持 `texts`、`layers`、`blocks` 和 `entities`；过滤与限额在返回记录前生效。CSV 中以 `=`、`+`、`-`、`@` 开头的单元格会做公式注入防护。

```json
{"path":"./plan.dwg","format":"svg","layout":"Model","background":"#ffffff"}
```

`cad_export` 支持 SVG、PNG 与经校验的 Unicode 二进制 DXF。SVG/PNG 结果包含输出字节数、SHA-256、边界、源/展开/渲染/跳过计数、不支持类型计数与预览完整度。DXF 转换会重新打开输出并比对文字、实体类型与图层；严重不一致返回 `CONVERSION_VALIDATION_FAILED`。

## 配置

所有配置项均为可选；未覆盖时采用下列默认值。

| 配置项 | 默认值 | 含义 |
|--------|--------|------|
| `outputDir` | `./cad-output` | 导出报告与预览的输出目录。 |
| `maxFileSizeMB` | `50` | 输入文件大小上限。 |
| `maxEntities` | `200000` | 解析实体数量上限。 |
| `maxExtractItems` | `500` | 提取记录的默认条数上限。 |
| `maxImageDimension` | `8192` | PNG 宽/高像素上限。 |
| `maxImagePixels` | `64000000` | PNG 总像素上限。 |
| `maxWarningSamples` | `50` | 每次返回的警告样例数。 |
| `maxBlockDepth` | `16` | 嵌套块展开最大深度。 |
| `maxBlockInstances` | `10000` | 展开块实例上限。 |
| `maxConcurrent` | `2` | 最大并发 CAD 任务数。 |
| `maxWorkerTimeMs` | `30000` | Worker 隔离解析/渲染的硬超时。 |
| `maxSvgBytes` | `20000000` | SVG 输出字节上限。 |
| `maxCsvBytes` | `20000000` | CSV 输出字节上限。 |
| `maxTextLength` | `1000000` | 单条文字长度上限。 |
| `maxTotalVertices` | `5000000` | 总顶点数上限。 |
| `maxEntityVertices` | `500000` | 单实体顶点数上限。 |
| `allowedInputRoots` | *(未设置)* | 可选输入根目录白名单；设置后，根目录之外的路径返回 `INPUT_OUTSIDE_ALLOWED_ROOTS`。 |

输出与输入相互隔离，已有文件永不被覆盖。

## 错误码

输入与访问 —— `FILE_NOT_FOUND`、`PERMISSION_DENIED`、`NOT_A_FILE`、`READ_FAILED`、`UNSUPPORTED_FORMAT`、`INPUT_OUTSIDE_ALLOWED_ROOTS`。

限额 —— `FILE_TOO_LARGE`、`ENTITY_LIMIT_EXCEEDED`、`TEXT_LIMIT_EXCEEDED`、`GEOMETRY_LIMIT_EXCEEDED`、`RENDER_LIMIT_EXCEEDED`、`OUTPUT_LIMIT_EXCEEDED`、`OUTPUT_EXISTS`。

参数与解析 —— `INVALID_ARGUMENT`、`LAYOUT_NOT_FOUND`、`PARSE_FAILED`。

转换与导出 —— `CONVERSION_FAILED`、`CONVERSION_VALIDATION_FAILED`、`EXPORT_FAILED`、`OUTPUT_FAILED`。

运行时 —— `CANCELLED`、`TIMEOUT`。

## 预览保真度

SVG/PNG 预览支持直线、圆、圆弧、椭圆、样条、填充、折线（含闭合/凸度路径）、文字/MText/属性、带嵌套变换与阵列的插入块、点、实体（solid）与引线。光栅图像、区域覆盖（wipeout）、网格与不支持的代理实体会在 `unsupportedEntityTypes` 中显式列出。图纸空间通过 `layout` 选择；默认为 `Model`。

## 许可证

[MIT](./LICENSE)
