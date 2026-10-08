# Univer 作为表格（kind="sheet"）新内核 —— 技术验证结论（261009）

> 分支 `spike/univer-sheet`，**只读验证：未接入应用、未合并 master**。可运行 spike + 自动断言脚本都在本分支。
> 背景：语雀"表格"用的是自研闭源 LakeSheet（拿不到）；Lake 内核的表格卡在 ~5500 行粘贴下会卡死 30s。
> 所以表格要做成主力，必须自己选一个能承载大表、可主题化、能从 CSP 过关的内核。本文回答 Univer 是否可行。

## 1. 方法

- 依赖：`@univerjs/presets` + `@univerjs/preset-sheets-core` **1.0.3**（Apache-2.0）。
- 独立页面 [spike-univer.html](../spike-univer.html) + [vite.spike.config.ts](../vite.spike.config.ts)，**复用 [vite.config.ts](../vite.config.ts) 的真实 `PROD_CSP`**（`script-src 'self' 'sha256-…'`，无 `unsafe-eval`）。
- headless Chrome（同 Chromium 引擎）+ CDP 逐步断言：[scripts/spike-univer-cdp.mjs](../scripts/spike-univer-cdp.mjs)。
- 源码扫描：15 个 `@univerjs/*` 包 dist 的 `new Function(` = 0、`eval(` = 0。

## 2. 结果矩阵（主线程 / worker 两种模式结果一致）

| 目标 | 结果 | 证据 |
| --- | --- | --- |
| 严格 CSP | ✅ | 渲染成功；`securitypolicyviolation` = **0**；唯一网络报错是 favicon 404 |
| 多标签 keep-alive | ✅ | **单 Univer 实例多 workbook** + `focusUnit` 切换；两本数据隔离（A1=100 / 777） |
| 三主题令牌 | ✅ | `--lake-*` → Univer `Theme`；light `#3f5fa0` / warm `#d45500` / dark `#9aabce`+canvas `#1e1f23`，三张截图 hash 互异 |
| JSON 正文快照 | ✅ | `fWorkbook.save()` → `IWorkbookData`（含 `f`/`v`/`t`）→ `createWorkbook()` 还原 |
| 公式 / 删行列 | ✅ | `=SUM(A1:A2)`：删行后 **150ms 重算 11→1**；改值 → 100。**对照 FortuneSheet [#650](https://github.com/ruilisi/fortune-sheet/issues/650) 至今未修** |
| 只读（移动端底座） | ✅（引擎级） | `setEditable(false)` → 禁用控件 11 → **53** |
| worker 路径 | ✅ | `?worker=1`：公式同样算出；worker chunk 在 `worker-src 'self' blob:` 下无违规 |
| 图片（单元格图 / 浮动图） | ✅ | `FRange.insertCellImageAsync(url)` 与 `FWorksheet.insertImage(url,col,row)` 均返回 true 并渲染；**单元格图存在格内富文本 `p.drawings`（`layoutType:0`）、浮动图进 workbook `resources`**；`source` 直接支持 URL（可用我们的资产服务器，无需 base64）。需加 `@univerjs/preset-sheets-drawing` |
| 移动端渲染 / 只读 | ✅（模拟器 Chrome） | Pixel 6 / API36 的 Chrome 打开 spike 成功渲染、`=SUM(A1:A2)` 算出 C1=11；`?readonly=1` 下工具栏控件置灰。⚠️ **只读仍会自动聚焦并拉起软键盘（IME）**，正式接入需 `disableAutoFocus` / 只读不聚焦输入框 |

**关键坑（已实测）**：`@univerjs/preset-sheets-core/worker` **只导出工厂、不自举线程**——直接拿它当 worker 入口会"worker 空转、公式恒 null"。必须自建入口调 `createUniver({ presets: [UniverSheetsCoreWorkerPreset()] })`，见 [src/spike/univer-worker.ts](../src/spike/univer-worker.ts)。

## 3. 体积（gzip）

| 组成 | raw | gzip |
| --- | --- | --- |
| Univer 主 chunk（core preset） | 6.19 MB | **1.63 MB** |
| + drawing preset（图片） | 6.79 MB | **1.80 MB** |
| preset CSS | 132 KB | 20 KB |
| worker chunk（可选） | 7.01 MB | **1.66 MB** |

⇒ 主线程模式 ≈ 1.65 MB gzip；开 worker ≈ **3.3 MB gzip**（且 worker 与主 chunk 内容大量重叠）。
对照：现 FortuneSheet 懒加载 chunk ≈ 0.55 MB gzip。**体积是 Univer 最大的代价**，正式接入必须用 plugin 模式 + 按需 locale 瘦身，并新增 `check:bundle` 预算项。

## 4. 结论

**可行，且引擎级硬约束全部通过。** 相对现状的关键收益：

1. **公式在结构性改动后重算**（FortuneSheet 的长期 open bug）；
2. **主题是一等公民**（`Theme` API + canvas 一起跟随），不再需要 patch core 的 canvas 常量；
3. **单实例多 workbook** 天然匹配我们的多标签 keep-alive，避开 FortuneSheet 的模块级单例串台（[#757](https://github.com/ruilisi/fortune-sheet/issues/757)）；
4. 活跃维护（2026-10 仍在日更）+ Apache-2.0。

代价：体积约 3 倍；需要新的正文格式（v3 = `IWorkbookData`）与组件封装。

## 5. 未覆盖（属正式接入阶段，不在本次 spike 范围）

- **Capacitor WebView 内实测**：本次已在模拟器 **Chrome** 里验证渲染 + 只读（引擎级 `setEditable(false)`）；正式端是 Capacitor WebView（系统 WebView），接入后需复验一次 IME/触摸/内存。只读下的软键盘问题已在上表记录。
- **plugin 模式瘦身**（去掉 preset 里的 network/rpc/docs-ui 等未用插件）到具体数字。
- **正文 v3 转换器**（FortuneSheet `sheets[]` ↔ `IWorkbookData`）与 `UniverSheetEditor` 组件、灰度开关。
- **真实 Electron `lake://app`（scheme）复验**：本次用同一 `PROD_CSP` 的 headless Chromium，行为等价但非 Electron 本体。

## 6. 应用内接入（261009，已落地：与旧 sheet 并存）

新增文档类型 **`kind="usheet"`**，与 `kind="sheet"`（FortuneSheet）**并存**，老实现不动：

| 层 | 落点 |
| --- | --- |
| 正文 | `usheets/{id}.usheet.json` = `{kind:"usheet",version:1,workbook:IWorkbookData}`（[core/usheetDoc.ts](../src/core/usheetDoc.ts)，桌面/移动共享） |
| 编辑器 | [features/usheet/UniverSheetEditor.tsx](../src/features/usheet/UniverSheetEditor.tsx)（首次可见挂载 / 主题桥 / 只读 / 命令防抖 + 正文 diff 自动保存 / drawing preset 图片） |
| 主题桥 | [features/usheet/univerTheme.ts](../src/features/usheet/univerTheme.ts)：`--lake-*` → Univer `Theme`，跟随 `data-theme` |
| 管线 | noteKind / store（bodyPath + createUsheetIn + 建 `usheets/`）/ IPC+preload+native+webApiServer / useNoteLifecycle / useTreeActions / Sidebar「新建表格（新）」/ MultiTabEditor 分支 / 状态栏与 noteRef 文案 / noteSearchText / historyPreview / 导出映射 |
| 移动端 | `normalizeDocKind` 把 usheet 归为「非 doc 只读占位」（复用 sheet 占位，**绝不**交给 Lake 编辑器） |

**真实 Electron 实测**（scheme 模式 + 隔离 userData + CDP）：新建 → `kind/treeKind=usheet`、正文落盘 →
打开渲染（主 canvas 1054×639、工具栏 开始/插入/公式/视图）→ 点「粗体」触发内核命令 → 自动保存写入
`cellData` + `styles`；与旧 `sheet` **同时挂载**并可互相切换；状态栏显示「表格（新）」。

**已知取舍（后续批次）**：一个编辑器一个 Univer 实例（未做共享实例多 workbook）；未接 xlsx 导出、大表压测、
Capacitor WebView 复验；正文 v3 转换器（把旧 FortuneSheet 表迁到 usheet）**明确不做**（都是测试数据，可删可重建）。

## 7. 附件/图片独立资产管线（261009 优先项）

**口径**：图片一律落成 note-assets/{noteId}/ 资产文件，**正文只存 filename**（与 kind=sheet / 画板同一套资产协议）。

| 环节 | 做法 |
| --- | --- |
| 遍历 | [core/usheetDoc.ts](../src/core/usheetDoc.ts) 的 mapUsheetImageSources：覆盖单元格图（cellData[].p.drawings）与浮动图（workbook.resources 里 SHEET_DRAWING_PLUGIN 的 JSON）；只在真的改了才写回（不重排 JSON） |
| 打开 | filename → 资产服务器 URL（renderSource），喂给 createWorkbook 渲染 |
| 插入/保存 | data: / blob: / 外部 http 图片经 uploadLakeResource 提升成资产（同会话按源缓存，避免重复上传）；本地资产 URL → filename；正文绝不出现 URL/base64 |
| 声明/GC | 正文存 filename ⇒ ASSET_NAME_RE / extractAssetRefs / detectOrphans **天然识别**，同步/GC 侧零改动 |
| 样式 | 合并 @univerjs/preset-sheets-drawing 的 zh-CN locale（否则插图按钮显示 sheets-drawing-ui.title） |

**实测**（真实 Electron + CDP）：打开「正文只含 filename」的表 → 单元格图经资产 URL **渲染成功**；
点「粗体」触发命令后，落盘正文 source **仍是 filename**（hasHttp=false / hasBase64=false），
且 listOrphanAssets **不**把它列为孤儿 ⇒ 声明与引用检测生效。

**未自动验证**：文件选择器插入（OS 原生弹窗，CDP 无法喂文件）→ 走 blob: 提升那条路径；
代码已实现，建议手动插一张本地图片后检查 note-assets/{noteId}/ 是否出现文件、正文是否只有 filename。

## 8. blob 与内存收口（261009 续）

**问题**：Univer 的"本地文件插图"内部用 URL.createObjectURL 生成 blob:，字节在文档卸载/revoke 前一直占内存；我们此前只把落盘快照换成 filename，活跃模型仍持有 blob。

**改动**：
- **插入即上传**：自建文件选择器 → uploadLakeResource 落资产 → insertImage / insertCellImageAsync 资产 URL。用 ICommandService.registerCommand + univerAPI.updateMenuConfig 把「插入 → 图片」的两项（sheet.command.insert-float-image / insert-cell-image）指到我们的命令 ⇒ **从源头不产生 blob:**。data:/blob:/外部 http → 资产的 promote 仍保留作兜底（粘贴/拖拽）。
- **不活动标签释放**：隐藏时先 doFlush（正文落 lastBodyRef）再 setReady(false)，由挂载 effect 的 cleanup 调 univer.dispose()；显示时量高重挂、按 lastBodyRef 重建。多标签下不活动标签不再常驻 Univer 实例。

**实测（真实 Electron + CDP，两表 A/B）**：
| 动作 | 结果 |
| --- | --- |
| 切到表B | 表A 的 .usheet-univer-root 子节点/canvas = 0（实例已释放）；表B = 3 canvas |
| 切回表A | 表A 重新挂出 3 canvas |
| 表A「粗体」→ 切走 → 切回 | 落盘正文仍含 styles/cellData.s（无丢失），hasBlob=false |

**仍未自动验证**：文件选择器本身是 OS 原生弹窗，CDP 喂不了文件 ⇒ "插入即上传"的实际点击路径需你手动插一张图确认（预期：note-assets 出新文件、正文只有 filename、且不会出现 blob: 中间态）。

## 9. 大表压测（261009，真实 Electron + CDP）

脚本 [scripts/usheet-stress.mjs](../scripts/usheet-stress.mjs)：页内生成 cellData → saveNote → reload → 点行开表量 openMs/DOM/堆 → 关标签并在**强制 GC 后**再量堆。列固定 20。

| 行×列 | 单元格 | 正文 | saveNote | 开表 | DOM 节点 | 堆(GC后) | 关标签后堆 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 500×20 | 1 万 | 165 KB | 10 ms | 803 ms | 2889 | 59 MB | 51 MB |
| 1000×20 | 2 万 | 338 KB | 11 ms | 530 ms | 2889 | 61 MB | 53 MB |
| 2000×20 | 4 万 | 691 KB | 18 ms | 551 ms | 2889 | 65 MB | 53 MB |
| 5000×20 | 10 万 | 1.7 MB | 39 ms | 582 ms | 2889 | 71 MB | 54 MB |

（base 堆 GC 后 29 MB；heap 含应用自身。）

**结论**：
- **开表时间基本不随规模增长**（1 万 → 10 万格都是 ~0.5–0.8s）；Univer 是 canvas 渲染，DOM 恒定 ~2889 节点，没有"每格一个 DOM"。这正是它相对 FortuneSheet（DOM/全量渲染）的根性优势。
- **内存**：表格本体约 30 MB(1 万格) → 42 MB(10 万格)，≈ 0.13 KB/格，增量温和。
- **释放有效**：关标签后 canvas=0、堆回到 base+~22 MB（dispose-on-hide 那套生效）。
- **真正的天花板是正文 32 MiB 上限**：10 万格正文 1.7 MB ⇒ 约 180 万格触顶；内存 100 万格约 +130 MB。
- 建议软目标：单表 ≤ 5000 行 × 100 列（50 万格）；更大走"表格文档 + 文档引用"或分表，保留 32 MiB 护栏。

## 10. plugin 瘦身 / Capacitor / xlsx 评估（261009）

### 10.1 plugin 模式瘦身：**不做**
- 现状：UniverSheetEditor 懒加载分包 **1.65 MB gzip**（preset 模式）。
- 可裁包（插件模式相对 preset 省下的）：@univerjs/network 8.4KB + rpc 6.4KB + protocol 5.2KB + telemetry 0.5KB + presets 0.7KB ≈ **21 KB gzip（约 1%）**。
- 大头都是不可裁的核心：sheets-ui 456KB、engine-render 335KB、engine-formula 289KB、docs-ui 260KB、core 215KB、sheets 120KB。
- 结论：**plugin 模式重构收益 ~1%、维护成本高（逐包版本对齐 / CSS / locale / 升级回归）⇒ 不做**（AGENTS §3#17）。真正有效的体积杠杆是 **不开 worker**（省第二个 1.66 MB gzip 分包）与**精简 locale 分包**，并给该懒加载分包加 check:bundle 预算项守住。

### 10.2 Capacitor / WebView：**可行，暂缓实现**
- Univer 纯 web（canvas + worker，无原生依赖）；已在 Android 模拟器 Chrome 实测渲染 + 只读置灰（见 §2）。
- 移动端 CSP 本就含 unsafe-eval；障碍只是体积（+1.65MB）与"移动端表格只读"的定位。
- 结论：**可行**；当前移动端把 usheet 归为非 doc 只读占位（零成本）。要开只读渲染就复用 UniverSheetEditor 的 readOnly 分支，单独立项 + 模拟器验收。

### 10.3 xlsx 导入导出：**不做**
- Univer OSS 不含 xlsx（在 Pro）；本项目口径本就是"结构化存储 + 简单公式，真 Excel 挂附件"。
- 结论：**不做**；将来若要，走 ExcelJS（MIT）桥，或继续挂附件。
