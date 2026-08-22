# dsh-cad 剩余开发任务清单（TODO）

> 来源：`NEXT_PLAN.md`（dsh-cad-plugin 后续改进计划）。
> 约定：每完成一条任务，即在下方勾选对应复选框（`- [ ]` → `- [x]`）并执行一次 `git commit`，提交信息引用 TODO 编号。详见 `AGENTS.md`。

## 阶段一：准确性热修复（P0/P1 阻断项）

- [x] 1.1 修复 DXF 中文编码（P0）：改用 `@node-projects/acad-ts` 字节输出接口，使实际编码与 `$DWGCODEPAGE` 一致；或将输出升级为支持 Unicode 的 DXF 版本并同步修改 Header。
- [x] 1.2 转换后重新打开输出文件执行语义校验；返回 `conversionValidation`、`lossRisk` 与无法保真的对象类型；存在严重警告时不得仅返回笼统的 `ok: true`。
- [x] 1.3 避免把完整 DXF 先积累为字符串数组再 `join`，降低峰值内存占用。
- [x] 1.4 修复图层 Frozen 判断（P1）：改用 `layerFlags & LayerFlags.Frozen`，不再使用不存在的 `isFrozen` 属性。
- [x] 1.5 修复预览统计语义（P0）：`renderedPrimitiveCount` 与实际 SVG 图元一致；新增 `renderedPrimitiveCount` / `unsupportedEntityTypes` / `previewCompleteness`，不再把筛选后实体数当作已渲染数。
- [x] 1.6 增加参数运行时约束：`limit >= 0`（拒绝负数导致的 `slice(0, -n)`）、PNG width/height/总像素范围、非空路径、合法背景色、非空且合法的输出文件名。
- [x] 1.7 限制警告（按类型去重、分类、限制明细数量，如返回前 50 条 + 总数 + 类型统计）与模型响应大小。
- [x] 1.8 阶段一回归测试：中文往返、图层状态、预览统计全部通过（对应 `NEXT_PLAN.md` §13 完成标准）。

## 阶段二：预览保真

- [x] 2.1 评估并封装 `@node-projects/acad-ts` 自带的 `SvgWriter`（含 Arc、Ellipse、Hatch、Insert、Dimension、颜色、线型、文字转换）；不满足则建立按实体类型分派的 renderer，而非在单个 `map` 中继续追加条件。
- [x] 2.2 支持 Insert 展开：平移、旋转、缩放、阵列、嵌套块与循环引用深度限制。
- [x] 2.3 支持 Arc、Ellipse、Spline、Hatch。
- [x] 2.4 支持 Dimension、Leader、MLeader、RasterImage、Wipeout、Solid、Point、Mesh，或显式分类为不支持（不允许静默遗漏）。
- [x] 2.5 支持块属性与纸空间（Paper Space / Layout）内容。
- [x] 2.6 修复闭合折线真正闭合、Polyline bulge 弧段按弧绘制（不再画成直线）。
- [x] 2.7 应用文字旋转、对齐、宽度因子、字体与 MText 格式。
- [x] 2.8 应用实体颜色与线型；冻结、关闭、不打印图层不再显示。
- [x] 2.9 图层过滤后重新计算局部 bounds；不支持的 Insert 或其他实体位置不参与 bounds 计算。
- [x] 2.10 分别统计源实体、实际 SVG 图元、被跳过实体与块展开后的实体（对齐 `NEXT_PLAN.md` §3.2 建议输出结构）。
- [x] 2.11 增加视觉回归测试（SVG 结构快照、受控 PNG golden/感知差异），并同时校验 unsupported 统计。

## 阶段三：运行时加固（数据模型 / 资源 / 安全）

- [ ] 3.1 消除 `any` 与私有字段依赖：使用库公开类型（`CadDocument`、`Entity`、`Layer`、`BlockRecord`），改用稳定 `objectName`、`Color.index` / `getRgb()`、`TextEntity.value` / `height`、`Circle.radius` 等公开接口；建立规范化层与显式判别联合 `{ ok: true, ... } | { ok: false, error: ... }`。
- [x] 3.2 改善元数据语义：`version` 返回 `{ code, name, productRange }`，`units` 返回 `{ code, name }`；Handle 返回十六进制字符串。
- [x] 3.3 明确检查范围：拆分模型空间 / 各 Paper Space / 块定义 / 展开实例化实体数、Insert 数与每个块使用次数、嵌套块最大深度与循环引用、Xref/图片/字体/代理对象统计、可见/隐藏/冻结/关闭/不打印统计。
- [x] 3.4 改善 bounds：同时返回 Header 声明 bounds 与基于 `getBoundingBox()` 的实际 bounds、两者不一致标记、所选图层/Layout/空间窗口局部 bounds、无法计算 bounds 的实体类型及数量。
- [ ] 3.5 将 CAD 解析与 PNG 渲染移入 Worker Thread 或隔离子进程；支持硬超时、终止 Worker 与最大并发数；PNG/SVG 导出不无控制并行。
- [x] 3.6 增加资源限制：总顶点数、单实体最大顶点数、块展开实例数与最大递归深度、SVG 最大字节数、PNG 最大宽/高与总像素数、单条文本与最终 JSON/CSV 最大字节数。
- [x] 3.7 在读取、解析、规范化、渲染、写入各阶段之间检查 `AbortSignal`。
- [x] 3.8 输入路径权限：增加 `allowedInputRoots`（默认限制到工作区）、canonical path 归属检查、区分 `ENOENT` / `EACCES` / 非法路径 / 读取失败、明确符号链接策略并补测试。
- [x] 3.9 原子无覆盖输出：使用 `flag: 'wx'` 或同目录临时文件 + 原子 rename；默认输出名增加短哈希/唯一后缀；失败时清理本次调用产生的临时文件；可增加输出目录容量与保留期限策略。
- [x] 3.10 SVG 安全：校验 `background` 颜色格式（`transparent`、受控命名色、`#RGB`、`#RRGGBB`、`#RRGGBBAA`）；统一转义 XML 属性值；删除 XML 1.0 非法控制字符；禁止 `url(...)` 外部资源网络访问。
- [x] 3.11 CSV 安全：对 `=`、`+`、`-`、`@` 开头单元格做公式注入防护；增加 UTF-8 BOM 选项；限制最大行数、单元格长度与输出字节数。
- [x] 3.12 性能优化：基于 canonical path + mtime + size 的有界 LRU 缓存（最大条目/内存估算/失效策略），并为大图提供一次完成多项分析的组合接口。

## 阶段四：产品化（Harness / 发布 / 文档）

- [x] 4.1 为成功与失败结果建立稳定输出 schema；文档化所有错误码（`NEXT_PLAN.md` §9）与可恢复建议。
- [x] 4.2 Harness 展示增强：`cad_export` 返回真实图像尺寸、输出字节数、哈希、支持/不支持统计与完整度；Harness 支持时直接展示 PNG/SVG 预览或可点击产物；提供 read/parse/normalize/render/write 阶段进度。
- [x] 4.3 工具描述中列出合法实体类型、Layout 范围、预览局限与转换数据损失风险。
- [x] 4.4 分页与过滤：`offset`/游标分页、文本/正则/大小写不敏感搜索、按 Handle 查询单实体、按空间窗口/bounding box 查询、按 Layout 查询、图层与实体类型过滤大小写不敏感、使用稳定 DXF 类型名并在 inspect 中返回可用类型。
- [x] 4.5 块与属性：Insert 属性提取、块定义树与嵌套关系、每个块引用次数与插入位置、动态块/匿名块关联信息、循环引用检测、受深度/实例限制的块展开。
- [x] 4.6 控制模型上下文：默认返回条数降至 100–500；文件报告上限与模型响应上限分开配置；`saveAs` 默认只返回摘要/记录数/截断状态/路径/哈希；提供 `summary` 模式生成结构化图纸概览。
- [x] 4.7 发布流程：增加 `prepack`（typecheck + test + build）、CI（typecheck/test/build/pack dry-run/生产依赖审计）、`exports`/Node `engines`/repository/keywords/publishConfig/sideEffects 声明，并明确 `lib` 是否提交。
- [x] 4.8 依赖管理：确认 `@deepseek-ai/dsh-tools` 的 optional peer 依赖是否成立；建立回归测试后升级 `@node-projects/acad-ts` 至 3.0.2；引入依赖更新机器人并要求 CAD 语义回归测试门禁；记录 `@resvg/resvg-js` 平台与原生包安装要求。
- [x] 4.9 完善 README：配置项/默认值/范围/安全影响、三工具完整调用与返回示例、错误码及恢复、DWG/DXF 版本支持矩阵、预览实体支持矩阵、DWG→DXF 保真限制与警告语义、统计范围、路径与输出策略、性能/超时/资源上限。

## 阶段五：测试计划（随各阶段同步推进）

- [x] 5.1 单元测试：点/bounds 规范化、图层 flags/颜色/线型/可见性、稳定实体类型映射、closed/bulge polyline、XML 文本与属性转义、CSV 引号/换行/中文/公式注入、limit/width/颜色等边界参数、输出路径与文件名规则。
- [ ] 5.2 集成测试：GB2312/UTF-8/ANSI-1252 文本往返、ASCII 与 Binary DXF、DWG AC1014–AC1032 版本矩阵、Arc/Circle/Ellipse/Spline/Hatch/Dimension/MText/Insert/Attribute/RasterImage、多 Layout、嵌套块/循环引用/阵列 Insert、Xref/代理对象/缺失资源、损坏/截断/扩展名伪装/超限文件。
- [x] 5.3 语义回归测试：转换前后比较全部文本值、模型/纸空间实体统计、图层及 flags、块定义与引用、关键几何坐标与 bounds、单位/版本/code page、解析/写入警告。
- [x] 5.4 视觉回归测试：小型合成图 SVG 结构快照、关键样本受控 PNG golden/感知差异、单独验证旋转文字/颜色/线型/闭合折线/bulge/Insert 变换/Hatch，并同时检查 unsupported 统计。
- [x] 5.5 安全与资源测试：非法背景色与 SVG 注入、CSV 公式注入、路径穿越/符号链接/工作区外路径、并发同名输出、Abort/硬超时/Worker 终止、大顶点数/深层嵌套/极端长宽比/高像素 PNG、跨平台与 Node 版本矩阵。
- [ ] 5.6 测试样本：确认来源与授权；长期建立小型、匿名化、可生成的合成 CAD fixtures。

## 阶段六：后续能力扩展（可选，须在 P0/P1 修复完成后进行）

- [x] 6.1 空间窗口查询与最近实体查询。
- [x] 6.2 距离、总长度、周长与面积统计。
- [x] 6.3 闭合轮廓识别。
- [x] 6.4 重复实体、零长度线、非法半径、开口轮廓检查。
- [x] 6.5 图层使用率与空图层检测。
- [x] 6.6 块使用、嵌套与重复定义分析。
- [x] 6.7 Xref、图片、字体与缺失资源报告。
- [x] 6.8 单位归一化与坐标转换。
- [x] 6.9 图纸差异比较。
- [x] 6.10 面向 LLM 的工程摘要、异常摘要与问答上下文索引。
