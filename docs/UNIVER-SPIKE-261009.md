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

**关键坑（已实测）**：`@univerjs/preset-sheets-core/worker` **只导出工厂、不自举线程**——直接拿它当 worker 入口会"worker 空转、公式恒 null"。必须自建入口调 `createUniver({ presets: [UniverSheetsCoreWorkerPreset()] })`，见 [src/spike/univer-worker.ts](../src/spike/univer-worker.ts)。

## 3. 体积（gzip）

| 组成 | raw | gzip |
| --- | --- | --- |
| Univer 主 chunk | 6.19 MB | **1.63 MB** |
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

- **Android 真机/模拟器只读实测**：引擎级 `setEditable(false)` 已验证；Univer 是纯 web、无原生依赖，移动端 CSP 另含 `unsafe-eval`，但仍需真机确认 IME/触摸/内存。
- **plugin 模式瘦身**（去掉 preset 里的 network/rpc/docs-ui 等未用插件）到具体数字。
- **正文 v3 转换器**（FortuneSheet `sheets[]` ↔ `IWorkbookData`）与 `UniverSheetEditor` 组件、灰度开关。
- **真实 Electron `lake://app`（scheme）复验**：本次用同一 `PROD_CSP` 的 headless Chromium，行为等价但非 Electron 本体。
