# dsh-cad-plugin 后续改进计划

## 1. 审计结论

当前插件已经具备可实际使用的 MVP 能力：可以读取 DWG/DXF，提供检查、提取、预览与 DWG 转 DXF 三类工具；输入图纸保持只读；输出目录有初步隔离；TypeScript 严格检查、现有测试和打包检查均通过，生产依赖审计未发现已知漏洞。

在作为可靠 CAD 分析插件发布前，需要优先解决两个准确性阻断项：

1. DWG 转 DXF 会破坏中文文本编码。
2. 预览会静默遗漏大量实体，同时错误地将筛选后的实体数报告为已渲染实体数。

## 2. 已验证的关键问题

| 优先级 | 问题 | 实测证据 | 影响 |
| --- | --- | --- | --- |
| P0 | DXF 中文编码损坏 | 原始“贵州省”转换后重读为“璐靛窞鐪�” | 转换结果不可交付 |
| P0 | 预览静默丢实体 | 第二个样本共 518 个实体，当前渲染器真正识别绘制的约 351 个，却返回 `renderedEntityCount: 518` | 严重误导模型和用户 |
| P1 | 图层冻结状态错误 | 样本中两个图层的 flags 为 `65`，包含 Frozen 标记，但插件返回 `isFrozen: false` | 检查结果错误 |
| P1 | PNG 资源消耗和取消失效 | 约 1 MB DWG 导出 1600 px PNG，单次约 7.3 秒、RSS 增长约 111 MB | 大图或并发时可能阻塞或 OOM |
| P1 | 输出注入与文件竞争 | `background` 原样插入 SVG；输出采用“先检查、后写入” | 恶意 SVG、并发覆盖风险 |
| P2 | LLM 输出可能过大 | 默认可返回 10,000 条记录和全部警告；保存文件时仍回传全部记录 | token、内存和上下文浪费 |

## 3. P0：必须首先修复

### 3.1 修复 DXF 中文编码

问题位置：`src/index.ts` 中的 DXF 导出逻辑先通过 `DxfWriter` 生成 JavaScript 字符串，再使用 UTF-8 写入文件，但 DXF Header 仍声明原图的 `gb2312`。外部 CAD 软件或插件重新读取时，会按 GB2312 解码 UTF-8 字节，导致中文乱码。

改进方案：

- 使用 `@node-projects/acad-ts` 的字节输出接口，使实际输出编码与 `$DWGCODEPAGE` 一致。
- 或明确将输出升级到支持 Unicode 的 DXF 版本和编码，同时同步修改 Header。
- 避免把完整 DXF 先积累为字符串数组再 `join`，减少峰值内存。
- 转换后重新打开输出文件并执行语义校验。
- 返回 `conversionValidation`、`lossRisk` 和无法保真的对象类型；严重警告存在时，不应只返回笼统的 `ok: true`。

验收标准：

- 两个现有样本的全部文本在 DWG → DXF → 读取后逐字相同。
- 转换前后模型空间实体类型和数量、图层、块引用、关键 bounds 一致或明确报告差异。
- 至少覆盖 GB2312、UTF-8 和 ANSI-1252 测试样本。
- 输出文件能被至少一种插件以外的 CAD 工具正确打开并显示中文。

### 3.2 修复预览完整性和统计语义

当前手写渲染器只处理：

- Line
- LwPolyline、Polyline2D、Polyline3D
- Circle
- TextEntity、MText

当前会静默忽略：

- Insert 和嵌套块
- Arc、Ellipse、Spline
- Hatch
- Dimension、Leader、MLeader
- RasterImage、Wipeout
- Solid、Point、Mesh
- 块属性和纸空间内容

同时存在以下几何和样式问题：

- 闭合折线没有真正闭合。
- Polyline bulge 弧段被画成直线。
- 文字旋转、对齐、宽度因子、字体和 MText 格式未应用。
- 所有实体强制使用相同颜色。
- 冻结、关闭、不打印图层仍可能显示。
- 选择单一图层时仍使用整个图纸的 Header bounds，目标内容可能非常小。
- 不支持的 Insert 或其他实体位置仍可能参与 bounds 计算。
- `renderedEntityCount` 实际是筛选后的实体数，不是产生 SVG 图元的数量。

改进方案：

- 优先评估并封装 `@node-projects/acad-ts` 自带的 `SvgWriter`。该实现已包含 Arc、Ellipse、Hatch、Insert、Dimension、颜色、线型和文字转换逻辑。
- 如果 `SvgWriter` 无法满足要求，再建立按实体类型分派的 renderer，而不是继续在单个 `map` 中追加条件。
- Insert 展开必须支持平移、旋转、缩放、阵列、嵌套块和循环引用深度限制。
- 对不支持实体进行显式分类，不允许静默遗漏。
- 分别统计源实体、实际 SVG 图元、被跳过实体和块展开后的实体。
- 图层过滤后重新计算局部 bounds。

建议输出：

```json
{
  "sourceEntityCount": 518,
  "renderedPrimitiveCount": 351,
  "unsupportedEntityTypes": {
    "INSERT": 115,
    "IMAGE": 23,
    "HATCH": 15,
    "ELLIPSE": 10,
    "WIPEOUT": 4
  },
  "previewCompleteness": 0.678
}
```

验收标准：

- `renderedPrimitiveCount` 与实际生成的 SVG 图元一致。
- 所有未渲染实体均出现在 `unsupportedEntityTypes` 中。
- 现有两个样本的 Insert、Ellipse、Hatch 和旋转文字能够正确表现，或被明确报告为不支持。
- 支持闭合折线和 bulge 弧段。
- 图层过滤后的预览自动缩放到所选内容。

## 4. P1：数据模型和检查准确性

### 4.1 消除 `any` 和私有字段依赖

当前实现大量使用 `Record<string, any>`、`constructor.name` 以及 `_layer`、`_color`、`_radius`、`_value`、`_height` 等私有字段。这会隐藏类型错误，并使插件容易受依赖升级影响。

已发现的实际错误：`Layer` 没有 `isFrozen` 属性，冻结状态位于 `layerFlags & LayerFlags.Frozen`，所以当前插件始终返回未冻结。

改进方案：

- 使用库公开的 `CadDocument`、`Entity`、`Layer`、`BlockRecord` 等类型。
- 使用实体稳定的 `objectName`（如 `LWPOLYLINE`、`TEXT`），而不是 `constructor.name`。
- 使用 `Color.index`、`getRgb()`、`TextEntity.value`、`TextEntity.height`、`Circle.radius` 等公开接口。
- 建立小型规范化层，将库对象转换为稳定的插件输出结构。
- 为成功和失败结果定义显式判别联合：`{ ok: true, ... } | { ok: false, error: ... }`。

### 4.2 改善元数据语义

当前输出的 `version: 25` 和 `units: 4` 对模型与用户不够直观。

建议返回：

```json
{
  "version": {
    "code": 25,
    "name": "AC1018",
    "productRange": "AutoCAD 2004-2006"
  },
  "units": {
    "code": 4,
    "name": "Millimeters"
  }
}
```

Handle 建议返回 CAD 常用的十六进制字符串，以保持表达习惯并避免大整数问题。

### 4.3 明确检查范围

当前 `entityCount` 实际只代表模型空间顶层实体，却容易被理解为整张图纸实体总数。建议拆分为：

- 模型空间实体数
- 每个 Paper Space/Layout 的实体数
- 块定义实体数
- 展开块后的实例化实体数
- Insert 数和每个块的使用次数
- 嵌套块最大深度和循环块引用
- 外部引用、图片、字体、代理对象统计
- 可见、隐藏、冻结、关闭、不打印实体统计

### 4.4 改善 bounds

Header 中的 extents 可能过期或与筛选内容不一致。建议同时返回：

- Header 声明的 bounds
- 基于实体 `getBoundingBox()` 计算的实际 bounds
- 两者是否明显不一致
- 所选图层、Layout 或空间窗口的局部 bounds
- 无法计算 bounds 的实体类型及数量

## 5. P1：资源限制、取消和并发

当前实体数量限制在完整解析之后检查，无法阻止复杂或恶意 DWG 在解析阶段耗尽内存。AbortSignal 只在读取前检查，无法中断同步解析和 PNG 渲染。

改进方案：

- 将 CAD 解析和 PNG 渲染移到 Worker Thread 或隔离子进程。
- 支持硬超时、终止 Worker 和最大并发数。
- PNG/SVG 导出不应无控制地并行。
- 除文件大小和实体数外，增加以下限制：
  - 总顶点数
  - 单实体最大顶点数
  - 块展开实例数和最大递归深度
  - SVG 最大字节数
  - PNG 最大宽度、高度和总像素数
  - 单条文本和最终 JSON/CSV 最大字节数
- 当前仅限制 PNG 宽度；应同时限制高度和总像素，避免极窄、极高图纸产生巨大位图。
- 读取、解析、规范化、渲染和写入之间都检查 AbortSignal。
- 警告按类型去重、分类并限制明细数量，例如返回前 50 条、总数和类型统计。

性能优化：

- Harness 常见流程会连续调用 inspect、extract、export，当前每次都会重新解析。
- 可使用基于 canonical path、mtime、size 的有界 LRU 缓存。
- 缓存必须有最大条目数、最大内存估算和失效策略。
- 对不适合缓存的大图，可提供一次完成多项分析的组合接口。

验收标准：

- 超时后解析或渲染任务可被真正终止，而不是仅返回迟到结果。
- 达到像素、顶点或块展开限制时返回稳定错误，不发生 OOM。
- 多个 PNG 导出并发时受配置的并发上限控制。

## 6. P1：路径、输出和内容安全

### 6.1 输入路径权限

当前工具允许读取任意绝对路径。这可能是预期功能，但必须明确安全边界。

建议：

- 增加 `allowedInputRoots` 配置。
- 默认限制到工作区；需要访问工作区外文件时显式配置或请求批准。
- 使用 canonical path 检查路径归属。
- 区分 `ENOENT`、`EACCES`、非法路径和读取失败；不要全部报告为 `FILE_NOT_FOUND` 或 `PARSE_FAILED`。
- 明确符号链接策略，并增加相关测试。

### 6.2 原子和无覆盖输出

当前采用 `lstat` 检查文件不存在，再调用 `writeFile`，存在 TOCTOU 并发竞争。

建议：

- 使用 `flag: 'wx'`，或写入同目录临时文件后原子 rename。
- 默认输出名增加短哈希或唯一后缀，避免重复调用必然失败。
- 保持默认不覆盖；如未来支持覆盖，应要求显式参数和授权。
- 写入失败时清理仅由本次调用产生的临时文件。
- 可增加输出目录总容量和保留期限策略，防止长期运行填满磁盘。

验收标准：两个并发调用写入同一文件名时，最多一个成功，且现有文件内容不会被覆盖或混写。

### 6.3 SVG 和 CSV 安全

SVG：

- `background` 当前未经转义直接进入 XML 属性。
- 只允许经过验证的颜色格式，如 `transparent`、受控命名色、`#RGB`、`#RRGGBB`、`#RRGGBBAA`。
- 所有 XML 属性值统一转义。
- 删除 XML 1.0 不允许的控制字符。
- 禁止通过 CSS `url(...)` 或外部资源产生网络访问。

CSV：

- 对以 `=、+、-、@` 开头的单元格进行公式注入防护。
- 增加 UTF-8 BOM 选项，改善中文 Excel 兼容性。
- 对最大行数、单元格长度和输出字节数设限。

## 7. P2：提取能力和 LLM 友好性

### 7.1 分页和过滤

建议增加：

- `offset` 或游标式分页，而不是一次返回最多 10,000 条。
- 文本包含、前缀、大小写不敏感和正则搜索。
- 按 Handle 查询单个实体。
- 按空间窗口/bounding box 查询。
- 按 Layout、模型空间、纸空间查询。
- 图层和实体类型过滤改为大小写不敏感。
- 使用稳定的 DXF 类型名，并在 inspect 结果中返回可用类型。

### 7.2 块和属性

建议支持：

- Insert 属性提取。
- 块定义树和嵌套关系。
- 每个块的引用次数和插入位置。
- 动态块和匿名块的关联信息。
- 循环引用检测。
- 可选的块展开结果，受深度和实例数量限制。

### 7.3 控制模型上下文

- 将面向模型的默认返回条数降到更合理范围，例如 100-500 条。
- 文件报告上限和模型响应上限分开配置。
- `saveAs` 时默认只返回摘要、记录数、截断状态、路径和哈希，不重复返回所有记录。
- 大量警告返回汇总、分类和有限样本。
- 可提供 `summary` 模式，生成适合 LLM 的结构化图纸概览。

## 8. Harness 集成体验

当前三个工具都使用无约束 JSON 输出，失去了结果验证和更好的展示能力。

建议：

- 为成功和失败结果建立稳定输出 schema。
- 文档化所有错误码和可恢复建议。
- 参数增加运行时约束：
  - `limit >= 0`
  - PNG width 合法范围
  - 非空路径
  - 合法背景色
  - 非空且合法的输出文件名
- 负数 limit 当前会进入 `slice(0, -n)`，必须拒绝。
- `cad_export` 返回真实图像尺寸、输出字节数、哈希、支持/不支持统计和完整度。
- Harness 支持时直接展示 PNG/SVG 预览或可点击产物，而不是只返回本地绝对路径。
- 为长任务提供 read、parse、normalize、render、write 阶段进度。
- 明确工具的超时和并发安全策略。
- 在工具描述中列出合法实体类型、Layout 范围、预览局限和转换数据损失风险。

## 9. 错误处理和诊断

建议建立稳定错误分类：

- `FILE_NOT_FOUND`
- `PERMISSION_DENIED`
- `NOT_A_FILE`
- `INPUT_OUTSIDE_ALLOWED_ROOTS`
- `UNSUPPORTED_FORMAT`
- `FORMAT_SIGNATURE_MISMATCH`
- `FILE_TOO_LARGE`
- `READ_FAILED`
- `PARSE_FAILED`
- `ENTITY_LIMIT_EXCEEDED`
- `GEOMETRY_LIMIT_EXCEEDED`
- `RENDER_LIMIT_EXCEEDED`
- `CANCELLED`
- `TIMEOUT`
- `OUTPUT_EXISTS`
- `OUTPUT_FAILED`
- `CONVERSION_VALIDATION_FAILED`

解析器警告应保留以下信息：

- 严重级别
- 类型和稳定 code
- 相关 Handle/对象名称（如果可获得）
- 总数、去重后的计数和有限样本
- 是否可能造成转换数据损失

## 10. 测试计划

现有 4 个测试全部通过，但主要验证“能够运行”，断言不足以覆盖准确性和安全性。

### 10.1 单元测试

- 点和 bounds 规范化。
- 图层 flags、颜色、线型和可见性。
- 稳定实体类型映射。
- closed/bulge polyline。
- XML 文本和属性转义。
- CSV 引号、换行、中文和公式注入。
- limit、width、颜色等边界参数。
- 输出路径和文件名规则。

### 10.2 集成测试

- GB2312、UTF-8、ANSI-1252 文本往返。
- ASCII DXF 和 Binary DXF。
- DWG AC1014、AC1015、AC1018、AC1021、AC1024、AC1027、AC1032。
- Arc、Circle、Ellipse、Spline、Hatch、Dimension、MText、Insert、Attribute、RasterImage。
- 模型空间、多个纸空间和 Layout。
- 嵌套块、循环引用和阵列 Insert。
- 外部引用、代理对象和缺失资源。
- 损坏、截断、扩展名伪装和超限文件。

### 10.3 语义回归测试

转换前后比较：

- 全部文本值
- 模型空间和纸空间实体统计
- 图层及 flags
- 块定义和引用
- 关键几何坐标和 bounds
- 单位、版本和 code page
- 解析/写入警告

### 10.4 视觉回归测试

- 为小型合成图建立 SVG 结构快照。
- 对关键样本建立受控 PNG golden image 或感知差异测试。
- 单独验证旋转文字、颜色、线型、闭合折线、bulge、Insert 变换和 Hatch。
- 视觉测试应同时检查 unsupported 统计，避免仅凭“生成了 PNG”判定成功。

### 10.5 安全与资源测试

- 非法背景色和 SVG 注入。
- CSV 公式注入。
- 路径穿越、符号链接、工作区外路径。
- 并发同名输出。
- Abort、硬超时和 Worker 终止。
- 大顶点数、深层块嵌套、极端长宽比和高像素 PNG。
- Windows、Linux 和支持的 Node 版本矩阵。

## 11. 发布、依赖和文档

### 11.1 发布流程

- 增加 `prepack`，自动执行 typecheck、test、build，避免 `lib` 与 `src` 不同步。
- CI 至少执行 typecheck、test、build、pack dry-run 和生产依赖审计。
- 增加 `exports`、Node `engines`、repository、keywords、publishConfig 和必要的 sideEffects 声明。
- 明确是否提交构建后的 `lib`；如果提交，CI 应验证构建后无 diff。

### 11.2 依赖管理

- `@deepseek-ai/dsh-tools` 被运行时静态导入，但 peer dependency 标记为 optional；需要确认 Harness 的安装保证，否则不应 optional。
- `@node-projects/acad-ts` 已有 3.0.2，可在建立回归测试后升级。
- 使用依赖更新机器人，并要求 CAD 语义回归测试通过后再合并 parser/writer 更新。
- 记录 `@resvg/resvg-js` 支持的平台和原生包安装要求。

### 11.3 README

补充：

- 所有配置项、默认值、范围和安全影响。
- 三个工具的完整调用示例和返回示例。
- 错误码及恢复方法。
- DWG/DXF 版本支持矩阵。
- 预览实体支持矩阵。
- DWG → DXF 的保真限制和警告语义。
- 模型空间、纸空间和块的统计范围。
- 输入文件访问范围和输出文件策略。
- 大文件性能、超时和资源上限。

测试样本应确认来源和授权；长期建议增加小型、匿名化、可生成的合成 CAD fixtures，以便精确覆盖实体类型和减少敏感工程数据风险。

## 12. 后续能力扩展

在准确性和安全性稳定后，可以增加：

- 空间窗口查询和最近实体查询。
- 距离、总长度、周长和面积统计。
- 闭合轮廓识别。
- 重复实体、零长度线、非法半径、开口轮廓检查。
- 图层使用率和空图层检测。
- 块使用、嵌套和重复定义分析。
- Xref、图片、字体和缺失资源报告。
- 单位归一化和坐标转换。
- 图纸差异比较。
- 面向 LLM 的工程摘要、异常摘要和问答上下文索引。

这些功能不应在 P0/P1 正确性问题修复前优先实现。

## 13. 推荐实施阶段

### 阶段一：准确性热修复

1. 修复 DXF 编码。
2. 修复图层 Frozen 判断。
3. 修复 `renderedEntityCount`，增加 unsupported 统计。
4. 增加参数最小值和颜色验证。
5. 限制警告和模型响应大小。

完成标准：中文往返、图层状态和预览统计的回归测试全部通过。

### 阶段二：预览保真

1. 评估并接入 `SvgWriter`，或建立完整实体 renderer。
2. 支持 Insert、Arc、Ellipse、Hatch、旋转文字、closed/bulge polyline。
3. 支持颜色、图层可见性和局部 bounds。
4. 增加视觉回归测试。

完成标准：现有样本不再静默遗漏关键实体，预览完整度可解释、可验证。

### 阶段三：运行时加固

1. Worker 隔离和硬超时。
2. 顶点、块展开、输出字节和总像素限制。
3. 原子输出和并发控制。
4. 输入根目录策略、SVG/CSV 安全。
5. 有界缓存和输出保留策略。

完成标准：恶意或极端输入不会阻塞主线程、覆盖文件或造成无界资源消耗。

### 阶段四：产品化

1. 强类型输出 schema 和 Harness 展示。
2. 分页、搜索、空间查询、Layout 和块属性。
3. CI、版本矩阵、发布校验和完整 README。
4. 增加高级 CAD 质量分析能力。

完成标准：插件可以稳定用于真实工程图纸的检查、提取、预览和受验证的格式转换。
