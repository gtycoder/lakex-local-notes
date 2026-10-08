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
Capacitor WebView 复验；正文 v3 转换器（把旧 FortuneSheet 表迁到 usheet）尚未做。
