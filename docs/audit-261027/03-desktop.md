# 03 桌面端审计

> 范围：`src/App.tsx`、`src/components/**`、`src/features/**`（editor / usheet / bitable / board / ink / outline / ai / quickNotes / attachment）、`src/hooks/**`、`src/lib/**`、`src/styles/**`、`src/desktop/**`、`index.html`、`src/lib/native.ts`（渲染侧 IPC 封装）。
> 只读审计：**未修改任何代码/配置/依赖**，唯一写入 = 本文件。未执行 vite build / Electron / gradle / npm install / 任何 git 写操作。
> 读取时间：**2026-10-27 21:29–21:40（Asia/Shanghai）**；行号以该时段读取内容为准（工作树可能已被其他会话改动，故每条证据同时给「文件 + 符号名」）。
> 基线：`HEAD = 41def9f0`（已提交基线）。工作树在读取开始时有 49 项、结束时 54 项在途改动（其他会话在审计期间仍在改），其中落在本范围的只有一处特性：**「上次标签会话恢复」**（`src/App.tsx`、`src/hooks/useBootstrap.ts`、`src/lib/settings.ts`、`src/components/app/SettingsPanel.tsx`、`src/components/model/settingsSearch.ts` 各 +1~18 行，新文件 `src/desktop/tabSession.ts`(53) + `.test.ts`(36)，均未提交）。本报告除 DT-15 外全部针对**已提交基线**。

---

## 0. 结论摘要（按严重度）

> **261028 晚注**：本节是审计当时（2026-10-27）的结论快照，**不代表当前状态**；逐条当前状态以文末「修复状态（261028）」表 + `13-audit-status.md` 为准（本文状态表已按工作树代码对齐）。

1. **DT-01 [P1]** 五种编辑器宿主里，**只有 doc（唯一挂闭源 Lake 内核的 kind）没有 `EditorErrorBoundary`**——内核渲染异常会直接打穿整个 React 根，而不是只坏一个标签。
2. **DT-02 [P1]** 桌面仍有 **11 处 `window.confirm`/`window.alert`**（含「彻底删除文档/清空回收站/云端恢复」等不可逆动作），同步阻塞渲染线程、视觉脱离自有设计系统，而仓库里已有 `ConfirmDelete` + `Overlay.Dialog` 原语。
3. **DT-03 [P1]** **9 处浮层定位把硬编码估算尺寸喂给 `clampPopoverPosition`**（含顶栏「工作空间」「文档操作」两个菜单），正是 AGENTS §3#14 / HANDOFF §4 明令禁止的「估算高度自己夹」老坑。
4. **DT-04 [P1]** 桌面 UI **没有可执行测试**：`vitest.config.ts` 只收 `.test.ts` 且 `environment: "node"`，全仓 **0 个 `.test.tsx`**；33 个文件 / 334 例是「读 .tsx 源码断言字符串」，五种宿主的 mount/capture/save 行为零执行级护栏。
5. **DT-05 [P1]** 小记页**全量 IPC + 全量渲染**：`list_quick_notes` 返回每条小记的 `text+body+images+tags`，前端一次性 `setItems` 并全量 map；目标量级是 **2 万小记**（AGENTS §1）。
6. **DT-06 [P2]** 五种 kind 的宿主契约分裂：**5 套 prop 词表**（`visible/focused/pane` vs `active/paneVisible`）、**2 套 capture 机制**（`capturesRef` vs `editorsRef`）、`capture` 类型重复声明 **10 处**、靠 `DesktopInkPad` 适配层翻译。
7. **DT-07 [P2]** 巨石函数/巨石组件：`createLakeDocument` 单函数 **≈920 行**（`lakeRuntime.ts` 1752 行）；`QuickNotesWorkspace` **39 个 `useState`**、`SettingsPanel` **44 个**（含 10 组手写 `busy/msg`）、`BitableEditor` **47 个**。
8. **DT-08 [P2]** 日志两套并行：`docs/LOGGING.md` + `rlog` 分级体系已建但只用了 **8 处**，热路径仍有 **42 处裸 `console.*`**（`[sync-tab]` 每轮同步 `JSON.stringify`），另有 **126 处空 `catch`**。
9. **DT-09 [P2]** `App.tsx` 把同一个 `DesktopTopBarLeading` 渲染 **4 份**（4 个工作空间各一份、靠 `visible`+条件 ref 打补丁），`Sidebar` **34 props**、`DesktopOverlays` **54 props**、`MultiTabEditor` 38 props 的 props 打洞。
10. **DT-10~DT-16 [P2]** 三个零引用死模块（`core/editorHost.ts` 25 行、`desktop/treeRepositoryAdapter.ts`+test 116 行、`lib/imageConverter.worker.ts` 46 行）、ink 导出两个永久 disabled 占位行、dead-CSS 工具桌面 6/6 假阳性、菜单定位双轨（13 文件用 hook / 9 处手写 pos）、三套行内重命名、设置页 8 类挤一文件、`any` 53 处（42 在 lakeRuntime）。
11. **本范围未发现 P0**（无数据丢失/安全越权级问题）；上表按 P1×5 → P2×11 排序。

---

## 1. 现状盘点

### 1.1 规模与模块清单（`find src`，不含 `src/mobile`）

| 区域 | 文件数 | 行数 | 说明 |
| --- | --- | --- | --- |
| `src/App.tsx` | 1 | 855 | 壳层装配（状态/hooks/渲染），已大幅外移 |
| `src/components/` | 64 | 10,345 | `app/`(25/7,184) `ui/`(20/2,074) `model/`(17/780) `hooks/`(2/307) |
| `src/features/` | 208 | 33,199 | editor 76/12,379 · bitable 51/9,944 · quickNotes 13/2,416 · outline 11/1,804 · board 10/1,546 · usheet 18/1,709 · ai 12/1,484 · ink 11/1,275 · attachment 6/642 |
| `src/hooks/` | 35 | 3,208 | 27 个 hook + 9 个测试 |
| `src/lib/` | 48 | 6,201 | `lakeEmojis.ts`(1,425)+`emojiZhKeywords.ts`(1,188) 占 42% |
| `src/styles/` | 42 | 7,602 | `app/shell.css`(872) `chrome.css`(729) `kit.css`(707) `app/quick-notes.css`(502) … |
| `src/desktop/` | 10 | 1,048 | `useDesktopShell`(206) `DesktopTopBar`(196) `DesktopOverlays`(175) `DesktopLibrary`(123) `tabSession`(53，在途) |
| `index.html` | 1 | 22 | CSP 由 vite 插件注入 `%VITE_CSP%`；1 条内联脚本需 CSP sha256 |
| **桌面合计（含 core 供参考）** | **625** | **86,445** | core 213 文件/23,873（他人范围，仅作依赖引用） |

**最大文件（行数）**：`features/bitable/BitableEditor.tsx` 2,072 · `features/editor/lakeRuntime.ts` 1,752 · `components/app/QuickNotesWorkspace.tsx` 1,457 · `components/app/Sidebar.tsx` 1,212 · `features/bitable/bitableCells.tsx` 1,389 · `features/editor/EditorTab.tsx` 1,114 · `components/app/SettingsPanel.tsx` 1,071 · `features/editor/MultiTabEditor.tsx` 868 · `components/app/AssetsBrowser.tsx` 714 · `features/usheet/UniverSheetEditor.tsx` 695。

### 1.2 关键入口与状态架构

- **入口**：`src/main.tsx` -> `App`（`src/App.tsx:53`）-> 12 个壳层 hook（`useWorkspaceState` / `useDesktopShell` / `useTabLifecycle` / `useNoteLifecycle` / `useSavePipeline`(+Glue) / `useSyncProgress` / `useSyncController` / `useSyncRefresh` / `useDesktopLifecycle` / `useTreeActions` / `useNoteActions` / `useBootstrap`）-> `DesktopLibrary`（123 行，纯装配）-> `MultiTabEditor`（kind 分发）-> 5 种宿主。
- **状态范式**：**没有全局 store**。唯一「controller + `useSyncExternalStore`」是**大纲**（`features/outline/OutlineController.ts:57`，订阅方 `OutlineSidebar.tsx:54,58`、`OutlineList.tsx:55`、`useDesktopShell.ts:58`）；其余靠 `useState` 提升 + props 下发。所以「controller/useSyncExternalStore 模式」在本仓只覆盖 1 个子系统，不是全局范式。
- **编辑器宿主 5 种**：`doc`->`EditorTab.tsx`（Lake 内核）；`usheet`->`UniverSheetEditor`；`bitable`->`BitableEditor`（+ `useBitableSession`）；`board`->`BoardEditor`（懒加载 `DrawnixBoardCore`）；`ink`->`DesktopInkPad`->`InkPad`。分发点唯一：`MultiTabEditor.tsx:679–757`。
- **保存链路**：`useSavePipeline`（`SavePipelineCore`：串行队列 + revision 竞态保护）-> `persistTab` -> `native.saveNote`；正文抓取见 DT-06（双轨 capture）。

### 1.3 构建与包体（读 `dist/`，未重新构建）

| 项 | 数值 | 预算/门禁 |
| --- | --- | --- |
| `index-*.js`（入口 chunk） | 6.97 MB raw / **1.90 MB gzip** | 预算 2.90 MB gzip => 已用 **66%** |
| 入口 modulepreload | 25 条 / 0.16 MB gzip | 入口静态图合计 **≈1.98 MB gzip** |
| 入口静态子 chunk | 20 个（含 react-dom 41 KB gz、`chunk-WYO6CB5R` 31 KB gz、`chunk-ZGVPDNZ5` 24 KB gz） | — |
| 懒加载边界 | `UniverSheetEditor`、`BitableEditor`、`DrawnixBoardCore`(708 KB/221 KB gz)、`drawnix`(724 KB/226 KB gz) | 正确懒加载 |
| `dist/assets` | 479 个文件 / 43 MB | — |
| 入口含内容判据 | 入口 chunk 内命中 `ne-table-hole`(偏移 5.42MB)、`katex`、`ne-editor`、`antd`、`drawnix`、`plait`、`rough` | 内核+antd+katex 在入口（doc 必须）；**画板系依赖（rough/plait）也在入口静态图** |
| `check-bundle-budget` | 3 项全部通过 | app-js 1,904,572 / 2,900,000 gzip |

### 1.4 门禁与设计系统度量（本次实跑，均为只读脚本）

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **0 错误**（`noUnusedLocals/Parameters` 已开） |
| `node scripts/ui-metrics.mjs` | **通过**：非主题颜色 0 / 字号字面量 0 / 入口 b3 import 0 / `!important` **10**（允许清单 11）/ 跨文件重复组 **12**（基线 13）；⚠ 清单里「`styles/compat.css display`」已找不到（失效项） |
| `scripts/css-audit/audit-lookalike.mjs 0.62` | 原语 39 个，命中 **259**（默认阈值 0.6 时 481）；其中**桌面 157 条 / 27 个文件**，其余为移动端（两端本就不共享样式） |
| `scripts/css-audit/audit-primitives.mjs` | 扫 79 个 CSS，规则体重复族 **58 组**（最大族 5 身份/6 次出现） |
| `scripts/css-audit/audit-dead-css.mjs` | CSS 70 / 规则 2,772 / 类名 1,653；桌面候选 **6**、移动 6 —— **桌面 6 条全是假阳性**（见 DT-11） |
| 内联 `style={}` | 桌面 **46 处**（`noteRefIcon` 12、`BitableEditor` 8、`lockedTextIcon` 6…）；抽样：绝大多数是**数据驱动几何/颜色**（列宽、笔色、缩进、连接线坐标），符合 DESIGN.md:318 的「动态几何例外」；**2 处越界**：`BitableEditor.tsx:1945/2030` 的 `?? "#e8e8e8"` 字面量兜底 |
| CSS 颜色字面量（themes 外） | **0**（命中的 `kernel-theme.css`/`shell.css`/`base.css` 全在注释里） |
| TS/TSX 内 hex 字面量 | 44 处，合理来源 = `lib/notebookIcons.tsx`（SVG 图标配色）、`core/mdToHtml.ts`（导出 HTML 内联样式）、`core/colorPalette.ts`+旧色键、`LakeColorBoard`/`colorMemory`（内核色映射） |
| emoji/系统字形当图标 | **0**（命中的全是注释里的 ⚠/📌 说明） |
| 单侧色条 | **0**（唯一 `border-right+bottom` 是 `.ln-dialog__resize` 手柄） |
| Web Worker | 全仓 **0 个 `new Worker(`** => `lib/imageConverter.worker.ts` 为孤儿（DT-10） |

### 1.5 测试结构与覆盖

- 测试文件 **453** 个（`.test.ts` 453 / `.test.tsx` **0**），桌面侧 **312** 个；`it()` 用例 **2,141**。
- `vitest.config.ts:22-27`：`include: ["electron/**/*.test.ts", "src/**/*.test.ts"]`、`environment: "node"` => **组件级渲染测试既没写也没跑**，且 `.test.tsx` 即使写了也不会被收集。
- 33 个桌面测试文件（**334 例**，≈16% 用例）用 `readFileSync(new URL("./X.tsx"))` **读源码断言字符串**；代表：`features/usheet/usheetOpenReadOnly.test.ts:19`（锁「打开=只读」三件套）、`features/bitable/bitableEditorMount.test.ts`(1,209 行)、`features/editor/splitView.test.ts`、`components/app/quickNoteSyncGate.test.ts`。
- 结论：桌面 UI 的行为护栏 = **①源码字符串断言 ②整页快照装置（需 Electron+CDP，42 态）③`scripts/e2e-*.mjs`（不在 `npm test` 内）④人工走查**。真正执行组件逻辑的测试为 0。

### 1.6 已定稿、本次不再提（防重复上报）

目录树窗口化（HANDOFF §3#3/#22「不做目录窗口化」）· 非活动宿主 `visibility->opacity`+inert（§3#9，261012 暂不做）· toast 合一（§3#10 暂缓）· 顶栏 `.toolbar__item` 并入 `.ln-btn`（§3#10 维持不做）· `.protyle-breadcrumb__item`/`.quick-note-index-main` 并入 `.ln-row`（AGENTS §3#14 已结案）· 分屏候选①②④⑤⑥（§3#21）· vendor/依赖侧死代码清理（AGENTS §3#18）· 移动端 usheet 未接 `normalizeUsheetWorkbook`（AGENTS §4 已知，属移动端写域）· 表格 P4/P5 与单元格保护语义（HANDOFF §0 待用户裁决③）· 大表格粘贴内核侧分批（§3#16 C 明确不做）· 桌面/移动抽公共 usheet runtime（§3#17③ 不做）· 表格公式栏（§3#15① 保持隐藏）· 搜索命中定位 DOM 启发式（§3#5 已知）。

---

## 2. 问题清单

### DT-01 [P1] 文档（doc）标签是唯一没有错误边界的宿主

- **证据**：`src/features/editor/MultiTabEditor.tsx` 的 kind 分发（读取于 21:33）：`usheet`->`<EditorErrorBoundary key="us-…">`(680)、`bitable`(694)、`board`(712)、`ink`(726) 四支都包了；**`doc` 的默认分支（738–757）直接 `<EditorTab …/>`，无任何边界**。`EditorErrorBoundary.tsx:9` 的类注释明确写「第三方内核渲染/状态异常不应连累整窗」，但唯一挂内核的 kind 恰好被漏掉。全仓 grep「EditorErrorBoundary / 错误边界」在 `docs/`+`AGENTS.md` = 0 命中 => **不是已定豁免，是漏项**。
- **影响**：Lake 内核在 render 阶段抛错（大表格/公式/图片水合都走过内核）=> React 18 卸载整棵树 => 白屏，其余标签的未落盘编辑只能靠草稿日志；而 sheet/board 崩溃只坏一格。**风险面最大的 kind 反而没有隔离**。
- **建议**：① 激进：把 5 支统一收进一个 `<EditorHost>`（见 DT-06），边界在 Host 内一次性给全；② 保守：给 738 行那支套一层 `<EditorErrorBoundary key={"doc-"+tab.noteId+"-"+(tab.reloadKey??0)}>`（4 行改动）。
- **成本**：S（保守）/ M（激进）
- **状态**：新发现

### DT-02 [P1] 11 处原生 `window.confirm`/`window.alert` 绕过自有浮层原语（含不可逆动作）

- **证据**（读取于 21:35，`grep -rn "window.confirm|window.alert" src --include=*.tsx` 排除 mobile/test）：
  - `components/app/TrashPanel.tsx:226`（彻底删除小记）、`:234`（恢复）、`:259`（彻底删除文档）、`:272`（**清空回收站**）
  - `components/app/SettingsPanel.tsx:230`（**从云端恢复**：隔离本地+清空+重启）、`:235`（`window.alert` 报隔离路径）
  - `components/app/QuickNotesWorkspace.tsx:543`（放弃未保存小记）、`:745`（批量删小记）
  - `components/app/HistoryPanel.tsx:174`（恢复历史覆盖当前）
  - `features/quickNotes/QuickNoteTagManager.tsx:63,69`（删标签/合并标签）
  - 对照：仓库已有 `desktop/DesktopOverlays.tsx:112-115` 的 `<ConfirmDelete>` 与 `components/ui/Overlay.tsx` 的 `Dialog`；AGENTS §3#14 明确「浮层表面 = Overlay.tsx（**不要手写 createPortal**）」。
- **影响**：① `window.confirm` **同步阻塞渲染线程**——自动保存/同步在途时点确认，主线程被 modal 卡住，内核与同步回调全停；② 4 个不可逆动作（彻底删除 x3、清空回收站、云端恢复）用的是 Chromium 系统对话框，与设计系统完全脱节，且**不支持结构化文案/危险色**；③ 与「拦截保存必须可见原因和出口」（HANDOFF §4）不是同一套出口样式，用户认知不一致。
- **建议**：① 激进：做一个 `useConfirm()`（`Overlay.Dialog` + 危险态 + Promise 化），把 11 处全换掉，顺带统一「不可逆动作必须列清后果」；② 保守：先换 4 个不可逆动作（TrashPanel x3 + SettingsPanel 云端恢复），其余留待下批。
- **成本**：M（激进，11 处 + 新 hook + 测试）/ S（保守，5 处）
- **状态**：新发现

### DT-03 [P1] 9 处浮层定位用硬编码估算尺寸，违反「禁止估算高度」红线

- **证据**：`hooks/topMenuPosition.ts` 的 `placeVertical`（:48-59）注释写明「调用方**必须**传真实尺寸（量出来的），不要用估算高度，否则压不住裁切（历史上就是靠猜高度：48/90/300…）」，`clampPopoverPosition`(143) 是它的包装。实际调用点：
  - `desktop/DesktopOverlays.tsx:122` `{width:220,height:260}`（顶栏「工作空间」菜单）、`:135` `{width:236,height:200}`（顶栏「文档操作」菜单）
  - `components/app/QuickNotesWorkspace.tsx:860/889/897/905/913` `{140x84} {200x360} {220x320} {160x170} {150x216}`（排序/更多/标签/筛选/行菜单）
  - `features/outline/OutlineSidebar.tsx:249` `{132x220}`、`components/app/SyncStatusPopover.tsx:109` `{width,height:380}`
  - 对照：同一批交互里另有 **13 个文件 / 48 处**用测量式 `usePopoverPosition`（`hooks/usePopoverPosition.ts`）。
- **影响**：估算比真实高度小 => 贴底时按错误高度判定「放得下」=> 菜单被视口裁掉；估算偏大 => 提前翻转、离锚点很远。顶栏更多菜单的行集随 `activeKind` 变化（doc 有锁定/AI/导出…，board 另算），**固定 200px 必然在某些 kind 下错**。这正是 HANDOFF §4 记录的反复出现的老坑。
- **建议**：① 激进：让 `clampPopoverPosition` 接受「元素或 measure 回调」、内部量真实尺寸后重排（一次改 API，9 个调用点各自去掉字面量；或直接把 9 处并入 `usePopoverPosition`）；② 保守：只改顶栏两个菜单（出现频率最高）+ QN 五处，其余登记为已知偏差。
- **成本**：M
- **状态**：新发现（红线被违反；HANDOFF §4 记录的是同类**历史事故**，不是「本条已定不做」）

### DT-04 [P1] 桌面 UI 零执行级测试：334 例是「读源码断言字符串」

- **证据**：`vitest.config.ts:22-27`（`include` 只含 `.test.ts`、`environment:"node"`）；`find src electron -name '*.test.tsx' | wc -l` = **0**；33 个文件用 `readFileSync(new URL("./X.tsx", import.meta.url))` 断源码字符串（例：`features/usheet/usheetOpenReadOnly.test.ts:19-60` 断言 `baselineSettledRef`/`contentInputRef` 出现在某个正则窗口里；`features/bitable/bitableEditorMount.test.ts` 1209 行）。宿主组件本身（`EditorTab` 1114 行 / `MultiTabEditor` 868 / `UniverSheetEditor` 695 / `BitableEditor` 2072）没有一次真实渲染。
- **影响**：① 这类断言**不校验行为**——把 `if (!a) { if (!b) return; }` 改成等价逻辑、或把函数体整体挪走，断言就假红；真正的回归（capture 顺序、keep-alive flush、分屏槽位）不会被它挡住。② 五种宿主的「打开=只读 / flush / capture / 卸载」这类**最贵的行为**只被字符串守着，等于没有护栏——而 AGENTS §2 要求「不在没有测试护栏的情况下做大规模架构重写」，这使 DT-06/DT-07 的重构事实上被锁死。③ 没有 DOM 测试 => 每次 UI 改动只能靠 42 态快照（需 Electron+CDP）+ 手动走查，成本高、覆盖窄。
- **建议**：① 激进：给关键宿主引入**可执行的组件级测试**（需 `jsdom`/`happy-dom` —— 按 AGENTS §3#22 四问准入：先只为一个域试点（如 `useTabLifecycle` + `MultiTabEditor` 的 kind 分发/capture 注册），量清增量与退出成本；退一步用现有 CDP 装置把「宿主契约」写成 `scripts/e2e-*.mjs` 冒烟并挂进 `check:*`）；② 保守：把 33 个源码断言里**真正锁行为**的那部分（约 12 个：usheet 只读三件套、quickNote 内核回退、settings 搜索同步、CSS 层）保留，其余在文件头标注「结构提醒，不作为行为护栏」，并在 `docs/DEVELOPMENT.md` 写清桌面 UI 的验证口径。
- **成本**：L（激进，含依赖准入）/ S（保守，仅口径与标注）
- **状态**：新发现

### DT-05 [P1] 小记列表：全量 IPC + 全量渲染，与 2 万小记目标量级冲突

- **证据**：IPC 全量返回 —— `electron/ipc/registerQuickNotes.ts:30` `ipc.handle("list_quick_notes", () => quickNotes.listQuickNotes())` -> `electron/quickNotes.ts:289` -> `queries.list()`；类型 `src/lib/types.ts:346-359`：`QuickNoteDocument extends QuickNoteSummary { content: QuickNoteContent }`，而 `QuickNoteContent`(:333-344) 含 `text`、**`body`(Lake HTML)**、`images[]`、`tagIds`、`tags`。渲染侧 `components/app/QuickNotesWorkspace.tsx:258` `const nextItems = await native.listQuickNotes(); setItems(nextItems)`，列表按 `items` 全量 map（无 `slice`/分页/窗口化：该文件 `pageSize|visibleCount|virtual|Intersection` 0 命中）。目标量级见 AGENTS §1「硬上限 10 万文档 / **2 万小记**」。
- **影响**：① IPC 结构化克隆一次搬 N 条小记的 body+text+images 元数据（N=2 万时按每条 0.5–2 KB 估算 = **10–40 MB** 过桥 + 渲染进程常驻）；② 列表全量 DOM：每行含按钮/标签/时间戳，2 万行 => 数万节点，切页/筛选/搜索都是全量重排；③ `QuickNoteSummary` 里已经有 `previewText`/`imageCount` 这层「列表投影」，说明设计上本来就区分了 summary/document，只是列表路径没走它。
- **建议**：① 激进：新增 `list_quick_notes_page({cursor,limit})` 或 `listQuickNoteSummaries()`（只回 `QuickNoteSummary`），列表用 summary + 展开时按 id 取 document；配合 200–500 行有界窗口（可复用多维表行窗口思路，小记行更简单，可先做「只挂视口内 + 缓冲」）；② 保守：不动协议，先把 `body` 从列表投影里去掉（`queries.list()` 投影到 summary 形状），渲染层按需读单条 —— 单点改动即可砍掉最大的一块 payload。
- **成本**：L（激进）/ M（保守）
- **状态**：新发现（AGENTS §1 的 2 万量级是新事实，此前无专项台账）

### DT-06 [P2] 五种宿主的契约分裂：5 套 prop 词表、2 套 capture、capture 类型重复 10 处

- **证据**：
  - **prop 词表**：doc/usheet/bitable/board 用 `visible / focused / pane / readOnly`；`ink` 的 `InkPad` 用 `active / paneVisible / variant`（`features/ink/InkPad.tsx:91`），因此必须有一层 `features/ink/DesktopInkPad.tsx:5-12` 把 `visible/focused` 翻译成 `active/paneVisible`；`DesktopInkPad` **不接收 `noteId`**，而其余 4 个都接收（`MultiTabEditor.tsx:681/695/713/727/739`）。
  - **两套 capture**：`useSavePipelineGlue.ts:45-59` —— `capturesRef`（sheet/bitable/board/ink 注册的 `() => string | null`，优先）+ `editorsRef`（doc 走 `editor.getDocument("text/lake")` 兜底）；同一件事两条路径，且 :45 的注释「sheet/board 不在此注册」已与 :48 的实现相反（注释过期）。
  - **类型重复**：`capture: (() => string | null) | null` 在 7 个文件的 Props/接口里各写一遍（`MultiTabEditor.tsx:72`、`InkPad.tsx:31`、`UniverSheetEditor.tsx:195`、`BitableEditor.tsx:145`、`useBitableSession.ts:27`、`BoardEditor.tsx:55`、`DesktopLibrary.tsx:52`），grep 全文该字面量出现 **10 次**。
  - **生命周期不齐**：`usheet`/`board` 有 `everVisible` 懒挂载 + 隐藏即 flush；`bitable`/`ink` 立即挂载；doc 走 `EditorTab` 的双缓冲（`is-outgoing`）+ 自愈重建。
- **影响**：加第 6 种 kind（或改 capture 语义）要改 6 处类型 + 6 个宿主 + 1 个适配层 + 2 条 capture 分支；「同一交互（可见性/只读/抓正文）」在 5 个实现里各自演化，回归面指数增长（DT-01 的漏项、DT-14 的 Suspense 文案都是这种分裂的产物）。
- **建议**：① 激进：定义 `EditorHostProps`（`noteId/visible/focused/pane/readOnly/onChange/onDirty/onCapture`）+ `EditorCapture` 类型（单一来源 `core/editorHost.ts`——现成但是空文件，见 DT-10），`MultiTabEditor` 用 `HOSTS: Record<NoteKind, ComponentType<EditorHostProps>>` 注册表分发，`DesktopInkPad` 适配层随之删除；② 保守：抽 `EditorCapture` 类型 + 把 `InkPad` 的 `active/paneVisible` 重命名为 `focused/visible`，删掉适配层（小步、不碰内核侧）。
- **成本**：L（激进，需 DT-04 的护栏先补）/ M（保守）
- **状态**：新发现

### DT-07 [P2] 巨石函数与巨石组件：`createLakeDocument` ≈920 行、单组件 39–47 个 `useState`

- **证据**：
  - `features/editor/lakeRuntime.ts:702–1623` = `createLakeDocument`，**单函数 921 行**；内部按序做 15 类事：内核配置合并、卡片注册（bookmark 降级、文档引用、加密文本）、katex/mhchem 顺序注入、上传适配器（视频/音频/附件/小记空间）、工具栏白名单（`QUICK_NOTE_TOOLBAR_ITEMS`）、虚拟渲染开关、TOC watcher 替换、audio 卡 20s 重试、块悬浮手柄、浮动工具栏、选区/浮层判定（`isTargetCard/getController/selectionInside/overlayOpened`）、perf 订阅（`docInitPerf`）…（同段注释可逐条对应）。
  - `components/app/QuickNotesWorkspace.tsx`：`useState` **39**、`useEffect` 10、`useRef` 5；13 个 `*Open/Pos` 状态（sort/filter/tag/more/row/…）逐个手写。
  - `components/app/SettingsPanel.tsx`：`useState` **44**，8 类设置（editor/appearance/shortcuts/history/sync/trash/browser/logs/ai/about）全部渲染在一个文件（:579-1049）。
  - `features/bitable/BitableEditor.tsx`：`useState` **47**、`useCallback` 45、`useMemo` 15（2,072 行）。
- **影响**：① 任何一处改动都要在 900 行函数里读懂 40+ 条件分支的上下文，回归面无法靠测试兜（DT-04）；② `createLakeDocument` 里混着「重试 20s 的 audio 兜底」「注入 script」这类**有副作用与计时器**的逻辑，只能靠 `__disposeExtras` 人工清理，泄漏点不可枚举；③ 39/44 个 state 让「一次交互改几个 state」的时序不可推理（QN 的 `draftsRef`/`pendingDeleteIdRef` 就是在给 state 组合打补丁）。
- **建议**：① 激进：`lakeRuntime` 按职责拆 5 个模块（config / cards / assets / viewport(toc+blockhandle+floating) / perf），`createLakeDocument` 只做编排；QN 的 5 组菜单状态抽 `useAnchoredMenu`、设置页按 category 拆文件 + `useAsyncAction`（DT-13）；② 保守：只把**有计时器/重试/全局副作用**的四段（katex 注入、audio 重试、TOC watcher、perf 订阅）提成独立模块并各自带 dispose，其余不动。
- **成本**：L（激进）/ M（保守）
- **状态**：新发现

### DT-08 [P2] 日志双轨：`rlog` 体系只用 8 处，热路径 42 处裸 `console`；126 处空 catch

- **证据**：`src/lib/log.ts`（261023 建的分级日志，`debug` 生产静默、`perf` 生产保留）+ `docs/LOGGING.md`；实际使用 `rlog.*` 桌面侧 **8 处**。裸 `console.*`（非 test、非 mobile、排除 log.ts）**42 处**：`features/editor/lakeRuntime.ts` 9、`hooks/useSyncProgress.ts` 7（:86/104/118/135/139/145/150，**每轮同步都 `JSON.stringify`**）、`features/usheet/UniverSheetEditor.tsx` 7、`hooks/useSyncRefresh.ts` 3、`hooks/useTabLifecycle.ts:78` 等。空 `catch`（`catch { /* 忽略 */ }` 形态）桌面 **126 处**。
- **影响**：① 正式环境里 `[sync-tab]` 系列会随每次自动同步/标签刷新落到日志文件（无级别、无 scope 规范、无法按 `LAKE_LOG_LEVEL` 关掉），排查反而被噪音淹没；② 两套格式让「按 scope grep」失效（`docs/LOGGING.md` 的规范只覆盖 rlog）；③ 126 处静默 catch 里混着真实失败路径（如 `useTabLifecycle.ts:85` 的 `catch { /* 尚未恢复，保持标记 */ }`），与「静默失败最坏」的项目红线相邻。
- **建议**：① 激进：`[sync-tab]` 全部改 `rlog.debug("sync-tab", …)`（生产静默、需要时开 `LAKE_LOG_LEVEL=debug`），并给空 catch 加「必须带 scope 注释或 rlog.debug」的 lint 约定（无新依赖，用现有 lint）；② 保守：只把 `useSyncProgress`/`useSyncRefresh`/`useTabLifecycle` 的 11 处改 rlog，其余保留。
- **成本**：S（保守）/ M（激进，含 lint 规则）
- **状态**：新发现


### DT-09 [P2] `App.tsx` 同一顶栏渲染 4 份 + props 打洞（34 / 54 / 38 props）

- **证据**：`src/App.tsx:568-599`（读取于 21:31）连续 4 个 `<DesktopTopBarLeading {...topBarLeadingProps} visible={desktopWorkspace === "x"} wsMenuWrapRef={…: undefined} syncBtnRef={…: undefined} />`，x = library/quick-notes/trash/resources —— **只有 `visible` 与两个 ref 有差别**；`topBarLeadingProps`(:555) 是每次渲染新建的对象字面量（无 memo）。`App.tsx:732-754` 里 trash/resources 两个工作空间又各自手写一遍顶栏骨架（`<header class="tab-bar">`+`tabbar-leading`+`tab-items`+`tabbar-trailing`）。props 数：`Sidebar.tsx:31-74` **34 个**、`DesktopOverlays.tsx:23-91` **54 个**、`MultiTabEditorProps` **38 个**（`MultiTabEditor.tsx:27-106`）；`App.tsx:657` 单行传 30+ 个 prop 给 Sidebar。
- **影响**：① keep-alive 下 4 份顶栏同时在 DOM 里（各自含按钮/状态灯/菜单锚点），ref 只能靠「条件传 undefined」避免冲突——加第 5 个工作空间就要再复制一段；② 54 props 的 `DesktopOverlays` 一次性渲染 8 类浮层，任何一处改动牵动全部（它同时是 DT-03 估算定位的所在）；③ `topBarLeadingProps` 每渲染新建 => 4 个 leading 组件每次都重渲染，打字/滚动路径上白白损耗。
- **建议**：① 激进：顶栏拆成「一个 `DesktopTopBar` 常驻 + `workspace` 只切内容区」，删掉 4 份复制与 trash/resources 的手写骨架；`DesktopOverlays` 按浮层拆成 4–5 个独立组件（各自从 `useDesktopShell` 订阅）；② 保守：把 `topBarLeadingProps` `useMemo` 化，并把 4 份复制收成一个 `map(WORKSPACES)` 循环。
- **成本**：M（保守）/ L（激进）
- **状态**：新发现

### DT-10 [P2] 三个零引用死模块 + ink 导出永久占位 + 失效 allowlist 项

- **证据**：
  - `src/core/editorHost.ts`（25 行，`EditorDocumentAdapter`/`EditorViewportAdapter` 只有声明）：`grep -rn "editorHost|EditorDocumentAdapter|EditorViewportAdapter" src electron` = **只命中自身**。注释自称「V5 Phase 4 窄端口」，实际从未接线。
  - `src/desktop/treeRepositoryAdapter.ts`（60 行 `DesktopTreeRepository`）+ `treeRepositoryAdapter.test.ts`（56 行）：唯一引用是**它自己的测试**；`src/core/ports.ts:16` 的注释声称「两端各自实现」，但桌面产品路径并不使用。
  - `src/lib/imageConverter.worker.ts`（46 行）：全仓 **0 处 `new Worker(`**、0 处 `imageConverter` 引用（图片转换已走主进程 sharp）。
  - `src/components/ui/ExportSubmenuItem.tsx:68-71`：ink 文档的导出子菜单里两行 `<button disabled title="开发中">PNG 导出（开发中）/ PDF 导出（开发中）</button>`；同文件 :8 注释「ink 的导出尚未实现」。
  - `scripts/ui-metrics.mjs` 的 `IMPORTANT_ALLOWLIST` 有一条 `styles/compat.css display` 已找不到（运行输出：`⚠ 清单里但已找不到（请同步删表项）: styles/compat.css display`）。
- **影响**：① 死模块被 tsc 收录、被读者当「架构意图」（`editorHost` 的接口会误导后来者以为存在宿主适配层，实际是实现碎片）；② 用户每次打开手写板文档点「导出」都看到两个永远点不动的「开发中」项——半成品入口；③ allowlist 失效项让「只许降」的棘轮失去准确性。
- **建议**：① 激进：三处模块直接删除（并把 `core/ports.ts` 里仅被死适配器使用的 `TreeRepository` 一并清理，若移动端也不引用——本次 grep 显示移动端只用 `SecretStore/CachePort/AppInfoPort`）；ink 导出两行删除（产品未定 v1 导出），或补 `boardExport` 同款 PNG 导出；allowlist 项删除；② 保守：先删三个死模块 + allowlist 项，ink 占位保留但在 `docs/INK-PAD.md` 标注「v1 不做导出」。
- **成本**：S
- **状态**：新发现（死代码类，非「依赖侧冗余」，不触 AGENTS §3#18）

### DT-11 [P2] dead-CSS 工具桌面 6/6 假阳性：漏判「模板串中间拼接」

- **证据**：`node scripts/css-audit/audit-dead-css.mjs` 输出「候选（桌面）= 6」，全部是 `.toc-minimap__item--d1`…`--d6`（`features/outline/outline.css:82-87`）。实际施加方是 `features/outline/OutlineMinimap.tsx:19` 的模板串 `toc-minimap__item--d` + `depth` 变量拼接 —— **模板字面量中间拼接**。AGENTS §3#14 要求「动态拼接类名（**串中间的拼接也要算**）」，工具漏了这种形态。
- **影响**：① 桌面 dead-CSS 的「可删清单」目前 **100% 是误报**，谁照单删除就会把大纲 minimap 的深度线宽删掉（视觉立刻退化）；② 报告本身消耗下一位审计者的判断力（本次就花了核对成本）。
- **建议**：① 激进：给 audit-dead-css 增加「`xxx--` + 变量/模板串」的模板串前缀识别（在引用源扫描里加一类模式），并用这条已知样本自证（AGENTS §7#21 同一纪律）；② 保守：在报告输出里把这 6 条标成 KNOWN-FP 并附 `OutlineMinimap.tsx:19` 出处。
- **成本**：S
- **状态**：新发现（同时是 §5 的度量口径问题）

### DT-12 [P2] 菜单状态与行内重命名各有 3–5 套手写实现

- **证据**：
  - `QuickNotesWorkspace.tsx` 里 5 组「open + pos」：`sortOpen/sortMenuPos`(:193/195)、`filterOpen/filterMenuPos`(:196/197)、`tagMenuOpen/tagMenuPos`(:199/200)、`moreOpen/moreMenuPos`(:205/206)、`rowMenuId/rowMenuPos/rowMenuAnchor`(:208-210)；而仓库已有测量式定位原语 `usePopoverPosition`（13 文件 / 48 处）与 `Overlay.Menu`。
  - **行内重命名**三套：`Sidebar.tsx`（`editingId/editingTitle/pendingRenameId`，11 处引用）、`QuickNotesWorkspace.tsx`（9 处）、`features/quickNotes/QuickNoteTagManager.tsx`（3 处），各自处理 Enter/Esc/blur/空名兜底。
  - `OutlineSidebar.tsx:67/70` 与 `MultiTabEditor.tsx:170/213` 也各自手写 `open+pos`。
- **影响**：同一交互（「锚在按钮上的菜单」「行内改名」）有 5+3 套时序；改一处行为（例如加「点外部关闭」或「Esc 取消并还原」）要改 N 处，且已有实现之间的细微差异会被当成 bug 反复报（QN 的 `rowMenuAnchor` 就是为了修一次锚点丢失加出来的）。
- **建议**：① 激进：抽 `useAnchoredMenu()`（返回 `anchorProps/open/close/Menu 元素`，内部用 `usePopoverPosition`）与 `<InlineRenameInput>`（Enter/Esc/blur/空名策略单一来源），把 5+3 处迁过去；② 保守：只在 QN 内把 5 组迁到 `useAnchoredMenu`（一次收敛 10 个 state），重命名暂时保留。
- **成本**：M
- **状态**：新发现

### DT-13 [P2] 设置页：44 个 `useState`，其中 10 组手写 `busy/msg` 异步态，8 类设置挤一个文件

- **证据**：`SettingsPanel.tsx:55-207`：`histBusy/histMsg`、`healthBusy`、`searchBusy/searchMsg`、`backupBusy/backupMsg`、`logBusy/logInfo/logKeyword`、`aiBusy/aiMsg/aiErr/aiDraft/aiKeyVisible/aiModels/aiManualModel/aiModelsBusy/aiForceSave`、`gcBusy`、`webBusy/webMsg`、`syncCfgBusy/syncMsg`、`diagMsg`。渲染侧 `category === "editor|appearance|shortcuts|history|sync|trash|browser|logs|ai|about"` 10 个分支同文件（:579-1049）。
- **影响**：① 10 组「按钮 busy + 结果消息 + 错误」的手写状态，任何一组漏 reset 就出现「永远转圈」或「上一条消息残留」（这类 bug 在设置页最容易被用户发现）；② 单文件 1,071 行 => 每加一行设置都要在 44 个 state 的作用域里找位置，且护栏 `settingsSearch.test.ts` 只保证「id 注册齐全」，不保证渲染与注册一致；③ 无 `useAsyncAction` 这类原语，跨页面的异步按钮（导出、同步、AI）各自实现。
- **建议**：① 激进：抽 `useAsyncAction<T>()`（`run/busy/message/error/reset`），先套 10 组；把 10 个分类拆成 `settings/<category>.tsx`（骨架 `.config-*` 与 `SETTING_ITEMS` 不动）；② 保守：先套 `useAsyncAction`，文件不拆。
- **成本**：M（保守）/ L（激进）
- **状态**：新发现

### DT-14 [P2] 模块边界倒置：1114 行组件模块对外导出「滚动记忆/搜索定位」；「纯计算」模块查 DOM；Suspense 文案单一

- **证据**：
  - `features/editor/EditorTab.tsx:78` `export function clearScrollMemory`、`:82` `export function locateEditorSearchHit`，模块级 `const scrollMemory = new Map<string, number>()`(:63)。被 `App.tsx:10`、`hooks/useTabLifecycle.ts:8`、`hooks/desktopDerivedState.ts:3`、`hooks/useNoteLifecycle.ts:6` 四个模块 import => **任何一处只想用 2 个纯函数，都要依赖整个 EditorTab 模块（含 lakeRuntime 依赖面）**。
  - `hooks/desktopDerivedState.ts:41` 注释「纯计算，从 App.tsx 抽出」，但函数体内 `document.querySelector`（`scrollActiveEditorToTop`）、返回闭包，并在 `App.tsx:548` **每次渲染都调用**。
  - `MultiTabEditor.tsx:670`：`<Suspense fallback={<div className="empty-workspace-hint">正在加载表格编辑器…</div>}>` —— 这个 fallback 对 **board / ink /（未来 kind）** 一视同仁 => 打开画板/手写板时提示「正在加载表格编辑器」。
- **影响**：① 模块图的叶子被依赖成枢纽（滚动记忆属于「编辑器视口」域，不该住在组件文件里），拆 chunk/懒加载时会被误拉进入口；② 「纯计算」模块含 DOM 读取 => 无法在 node 环境测（正好解释了 DT-04 为什么这些逻辑只有源码断言）；③ 文案错误是用户可见的质量问题（画板/手写板用户看到「表格编辑器」）。
- **建议**：① 激进：把 `scrollMemory`/`locateEditorSearchHit` 搬到 `features/editor/editorViewport.ts`（纯逻辑 + 可测），`desktopDerivedState` 拆成 `deriveDesktopView`（纯函数，出值）与 `useEditorScrollToTop`（副作用）；`Suspense` fallback 按 kind 给文案或统一「正在加载编辑器…」；② 保守：只改 fallback 文案 + 给 `desktopDerivedState` 的 DOM 部分加注释，其余登记。
- **成本**：S（保守）/ M（激进）
- **状态**：新发现

### DT-15 [P2][在途改动] 标签会话恢复：顺序 `readNote` + 逐次淘汰 => 启动变慢且静默截断

- **证据**：工作树（未提交）`src/hooks/useBootstrap.ts`（diff 段）新增：`const restored = sanitizeTabSession(savedSession, liveIds); … for (const id of restored.ids) { if (await openNote(id)) opened += 1; } if (opened > 0) { if (restored.activeId) await openNote(restored.activeId); return; }`；`src/App.tsx:288-294` 新增 effect 每次标签/活动页变化都 `writeTabSession`；`src/desktop/tabSession.ts`（新文件，53 行）只存 `ids + activeId`。`useTabLifecycle.openNote`（:60-120）每次都会 `await native.readNote(id)`，并调用 `evictTabsForLimit`（超 `settings.maxOpenTabs` 默认 **8** 时逐出，`src/lib/settings.ts:37`）。
- **影响**：① 恢复 N 个标签 = N 次串行 `readNote` IPC 后才走冷启动落点 => 首屏可用时间被线性拉长（同步侧已有「正文先出来」的同类教训）；② 会话存 12 个而 limit=8 => 前几个刚打开就被 `evictTabsForLimit` 淘汰（还会对 dirty 的走 `persistTab`），用户看到「上次的标签丢了几个」且无提示；③ 恢复的 id 若都在回收站，会逐个走 `existing.deleted` 分支再读一次。
- **建议**：① 激进：`readTabSession` 之后**只恢复最后 N=limit 个 id 且按最近顺序**，并把 `openNote` 的读盘并发化（`Promise.all` 后再一次性 `setOpenTabs`，避免途中淘汰）；② 保守：恢复前按 `maxOpenTabs` 截断 + 用 `chooseColdStartNoteId` 口径只激活一个。
- **成本**：S
- **状态**：在途改动复核（未提交；若按现状合入即成立，建议作者先补一条「恢复 N 个标签 = 批量读」的用例）

### DT-16 [P2] 类型面：`any` 53 处（42 在 lakeRuntime）、capture 类型 10 处重复、`native.ts` 内联匿名返回类型与 `types.ts` 双写

- **证据**：桌面 `as any` / `: any` **53 处**：`features/editor/lakeRuntime.ts` **42**、`selectionToolbar/kernelUiAtoms.tsx` 9、`aiResultOps.ts` 2（均在内核 API 无类型的边界，属已知代价，但集中度说明 lakeRuntime 是类型黑洞）；`@ts-ignore/@ts-expect-error` **0**（好）。`src/lib/native.ts` 里 `listNoteHistory`(:108-112)、`searchNotes`(:80)、`restoreMissingBodyFromCloud`(:25，`reason` 5 值联合) 等**内联匿名返回类型**与 `src/lib/types.ts` 中的同名形状双写；`capture` 类型重复见 DT-06。
- **影响**：IPC 形状是跨进程契约（AGENTS §7#6 要求「三处同步改」），内联匿名类型改一处忘另一处 => 编译不报错、运行时字段缺失（历史已踩过 syncState 类）。`any` 42 处让 lakeRuntime 里的错误（如 `editor.setDocument` 返回形状）只能靠运行时爆。
- **建议**：① 激进：`native.ts` 的返回类型统一从 `types.ts`/`core/*` 取（`HistorySnapshotMeta`、`SearchHit` 等命名类型），并用 `satisfies LakeNative` 校验实现；`EditorCapture` 单类型（随 DT-06）；② 保守：只把 `listNoteHistory/searchNotes/restoreMissing*` 三处抽命名类型。
- **成本**：S（保守）/ M（激进）
- **状态**：新发现

---


## 3. 删除 / 合并清单

> 判定口径：零引用（grep 全仓、含 electron/mobile）+ 无测试依赖 + 不触 AGENTS §3#18（vendor/依赖侧）与 §3#7（不写兼容）。

| # | 对象 | 证据 | 风险 / 备注 |
| --- | --- | --- | --- |
| 1 | `src/core/editorHost.ts`（25 行） | 全仓 0 引用（`editorHost/EditorDocumentAdapter/EditorViewportAdapter` 只命中自身） | 无。删后 `core/` 少一个「看起来是端口层」的诱饵；将来要抽宿主端口随 DT-06 一起建 |
| 2 | `src/desktop/treeRepositoryAdapter.ts`(60) + `.test.ts`(56) | 唯一 import 是自身测试；`core/ports.ts:16` 仅注释提及 | 低。删后顺带清理 `core/ports.ts` 的 `TreeRepository` 接口（移动端只用 `SecretStore/CachePort/AppInfoPort`，本次 grep 已核）与 `ports.test.ts` 对应断言 |
| 3 | `src/lib/imageConverter.worker.ts`（46） | 全仓 0 处 `new Worker(`；0 处 `imageConverter` 引用（图片转换在主进程 sharp） | 无。删后 `src/lib/` 少一个永不执行的线程入口 |
| 4 | ink 导出的两个永久 disabled 行 | `ExportSubmenuItem.tsx:68-71`（`PNG 导出（开发中）`/`PDF 导出（开发中）`），:8 注释「ink 的导出尚未实现」 | 低（用户可见项减少）。若要 PNG，可复用 `features/board/boardExport.ts` 的 canvas 导出思路，不建议 v1 顺手加 |
| 5 | `scripts/ui-metrics.mjs` 的 `IMPORTANT_ALLOWLIST` 失效项 `styles/compat.css display` | 实跑输出「清单里但已找不到」 | 无（门禁更严） |
| 6 | `BitableEditor.tsx:1945/2030` 的 `?? "#e8e8e8"` | 组件内颜色字面量；等价语义已存在于 `bitableDoc.ts` 的 `LEGACY_OPTION_COLOR_HEX.gray`（`optionColorHex("gray")`） | 无（视觉不变） |
| 7 | `App.tsx:568-599` 的 4 份 `DesktopTopBarLeading` -> 1 份 | 4 份只差 `visible` 与条件 ref | 中：顶栏是冻结构图（HANDOFF §3#10 顶栏几何优先），必须先过 `check-stylesnap` 相关态（1315/1060/760 三宽） |
| 8 | `QuickNotesWorkspace` 的 5 组 `open/pos` state -> `useAnchoredMenu` | DT-12 证据 | 低；需复核「点外部关闭/贴底翻转」两个行为 |
| 9 | 三套行内重命名 -> 1 个 `InlineRenameInput` | DT-12 证据 | 中（三处空名策略不同：Sidebar 回落原名、TagManager 拒空、QN 允许空）——合并前先把语义写清 |
| 10 | 注释过期 / 误导项 | `useSavePipelineGlue.ts:45`「sheet/board 不在此注册」（与 :48 相反）；`App.tsx:271-281/302-303/343-347/536-539` 只剩空注释块；`audit-lookalike.mjs:13` 注释写默认 0.62 而代码默认 0.6 | 无 |

---

## 4. 重构路线（分阶段，标注依赖与门禁）

> 门禁口径按 AGENTS §3#21：每次改动 = `npx tsc --noEmit` + 相关 vitest + `git diff --check`；动样式再加 `node scripts/ui-metrics.mjs` + `src/styles/cssLayers.test.ts`；动外壳几何/构成才跑快照（只跑受影响 1–2 态；全量 42 态只在发版前）；**顺序恒定为「先本地 -> 再定点 -> 最后全量」**。

**阶段 0（1 天，纯删除 + 小修，零视觉变化）**
- 删除 `core/editorHost.ts`、`desktop/treeRepositoryAdapter.ts(+test)`、`lib/imageConverter.worker.ts`、ink 导出两行、ui-metrics 失效项、`#e8e8e8` 字面量、过期注释（§3 #1–#6、#10）。
- 门禁：tsc + `npx vitest run`（全库）+ `node scripts/ui-metrics.mjs`。
- 依赖：无。收益：先证明「删除路径」安全，为后续大改建立信心。

**阶段 1（2–3 天，止血：崩溃隔离 / 阻塞对话框 / 浮层裁切 / 文案）**
- DT-01 给 doc 分支套错误边界（4 行）；DT-02 换掉 4 个不可逆动作的原生 confirm（TrashPanel x3 + SettingsPanel 云端恢复）+ 新增 `useConfirm`；DT-03 改顶栏两个菜单为测量式定位；DT-14 的 Suspense 文案。
- 门禁：tsc + vitest + `ui-metrics`；DT-02 涉及设置页/回收站 => 跑对应定点快照态（按脚本实际 state 名）；不得动顶栏几何（如需动先按 §3#21③ 重烤基线）。
- 依赖：DT-02 的 `useConfirm` 是阶段 2「确认语义统一」的前置。

**阶段 2（1–2 周，宿主契约收敛 —— 必须先补护栏）**
- 先做 DT-04 保守版（把「锁行为」的源码断言与「结构提醒」分开，写清桌面 UI 验证口径）+ 至少 1 条可执行的宿主契约测试（试点 `useTabLifecycle` + capture 注册；若引 jsdom 需先走 AGENTS §3#22 四问）。
- 然后 DT-06：`EditorHostProps`/`EditorCapture` 单类型 + `HOSTS` 注册表 + 删 `DesktopInkPad` 适配层；DT-01 的边界随注册表一次性给全。
- 门禁：tsc + vitest（含新增契约测试）+ `ui-metrics`/`cssLayers`；定点快照：usheet/bitable/board/ink 各 1 态。
- 依赖：阶段 1 完成（边界已有兜底）。

**阶段 3（2–3 周，可维护性拆解）**
- DT-07：`lakeRuntime` 拆 5 模块（保留 `createLakeDocument` 作编排，先搬「有计时器/副作用」的 4 段）；`SettingsPanel` 拆 10 个 category + `useAsyncAction`；QN 的 5 组菜单 -> `useAnchoredMenu`。
- DT-08：`[sync-tab]` 全量改 rlog；DT-09：顶栏 4->1、`topBarLeadingProps` memo 化。
- 门禁：每拆一块跑 tsc + 该域 vitest + `ui-metrics`/`cssLayers`；拆 QN 页/设置页后跑对应快照态；`git diff --check`。
- 依赖：阶段 2（类型与注册表稳定，避免二次搬家）。

**阶段 4（按需立项，需产品/实测证据）**
- DT-05：小记列表先做「summary 投影」保守版（去掉 body），再按真实数据量决定是否上窗口化/分页（当前无 2 万级实测，按 AGENTS §3#17 应先测量）。
- DT-11：dead-CSS 工具补模板串识别（顺手）。
- DT-15：由在途作者先补用例再合入。

---

## 5. 度量与复测方法

### 5.1 复测命令（全部只读）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes

npx tsc --noEmit                                  # 期望 0
npx vitest run                                    # 期望 0 failed（注意 .test.tsx 不被收集）
node scripts/ui-metrics.mjs                       # 期望 0 违规；!important <=10；重复组 <=12
node scripts/css-audit/audit-lookalike.mjs 0.62   # 桌面命中 157（27 文件）是本次基线，只许降
node scripts/css-audit/audit-primitives.mjs       # 规则体重复族 58（只许降）
node scripts/css-audit/audit-dead-css.mjs         # 桌面候选 6（全是假阳性 => 修工具后应为 0）
node scripts/check-bundle-budget.mjs              # app-js gzip 1,904,572 / 2,900,000
```

### 5.2 本次确立的「可量化回归指标」（建议写进各自 PR 描述）

| 指标 | 现状 | 目标 | 取数方式 |
| --- | --- | --- | --- |
| 无错误边界的 kind 数 | 1（doc） | 0 | `EditorErrorBoundary` 出现次数与 kind 分支数对照 |
| 桌面 `window.confirm`/`alert` | 11 | 0（不可逆动作优先） | `grep -rn -e "window.confirm" -e "window.alert" src --include=*.tsx` |
| 估算尺寸定位调用点 | 9 | 0 | `grep -rn "clampPopoverPosition(" src`，逐个看第三参是否字面量 |
| 裸 `console.*`（桌面非测试） | 42 | 0（全走 rlog） | 同上 grep 排除 `src/lib/log.ts` |
| `.test.tsx` 数 | 0 | >=1（试点域） | `find src -name '*.test.tsx'` |
| 源码字符串断言文件数 | 33 | 分类标注（锁行为 <=12） | `grep -rl "readFileSync(new URL" src --include=*.test.ts` |
| 零引用模块 | 3 | 0 | 见 §3 #1–#3 的 grep 复现 |
| `list_quick_notes` 全量文档路径 | 1 条 | 0（列表只走 summary） | `registerQuickNotes.ts` 处理器返回值类型 |
| 单函数 >500 行 | 1（`createLakeDocument` 921） | 0 | 脚本按函数边界量 |
| `any`（桌面非测试） | 53 | <=30（lakeRuntime 42 -> 目标减半） | `grep -rn -e "as any" -e ": any"` |
| 单组件 `useState` 峰值 | 47（BitableEditor） | <=20 | 逐文件 `grep -c "useState[<(]"` |

### 5.3 复测纪律（本次踩到的坑，供下次审计复用）

1. **`.test.tsx` 永远不会跑**：写组件测试前先确认 `vitest.config.ts` 的 `include` 与 `environment`，否则测试文件存在但永不执行（本次正是靠「453 个测试文件里 0 个 .tsx」才发现的）。
2. **结构断言的成败取决于字符串**：这类测试要「用已知会失败的样本自证」（AGENTS §7#21 同一纪律），否则改注释/改格式就假红。
3. **grep 统计要排除 test/mobile**：本报告的 42 处 console、46 处内联 style、53 处 any 都按「非移动端 + 非测试」口径，比较时必须同口径。
4. **dead-CSS 的「无人用」必须看动态拼接**：模板串中间拼接（`--d` + depth）当前会漏判（DT-11），看到候选先 grep 类名前缀。
5. **行号会漂**（本次期间工作树有 49 项改动）：以「文件 + 符号名」为准，行号只作定位提示。

---

## 附：本次未覆盖 / 建议他人接手的相邻项

- `src/core/**`（23,873 行）：本次只在「桌面调用面」引用（如 `bitableDoc` 的色板、`docStats`），未做 core 自身审计。
- `electron/**`（24,515 行）：只覆盖 `preload.cjs` 的 IPC 白名单与 `list_quick_notes` 处理器；主进程安全/同步不在本范围。
- `src/mobile/**`（42,041 行）：只在与桌面语义对照处引用（usheet normalize 缺口、图表/画板预览限制），未审计。

---

## 修复状态（261028，见 `08-ab-execution.md`）

> 261028 晚复核：逐条按**工作树代码**判定（行号为采样时点）；原表缺 DT-04/06/07/08/09/11/12/13/15/16，本轮补齐。
> 采样 = 2026-10-28 21:15–21:30（Asia/Shanghai）；完整对账见 `13-audit-status.md` §1。

| 条目 | 状态 | 证据（文件 : 符号）与残余 |
|---|---|---|
| DT-01 | ✅ 已修 | `features/editor/MultiTabEditor.tsx` 五条宿主分支各套 `EditorErrorBoundary`（L681 us / L695 bt / L713 bd / L727 ink / L743 doc） |
| DT-02 | ✅ 已修 | 新增 `src/hooks/useConfirm.tsx`（`window.confirm/alert` 的唯一替代入口）；实际调用 `window.confirm(/` 0、`window.alert(/` 0（剩余命中全是「替代 window.confirm」的注释）；11 处全换（08 §1） |
| DT-03 | ✅ 已修（第四轮） | 9 处改测量式 `usePopoverPosition`（08 §12-7）；`clampPopoverPosition` 生产调用 0（只剩定义 + 一处注释；`popoverMeasurement.test.ts:20` 断言四处不再出现调用）；顶栏两菜单合并 ref；无 CSS 改动 |
| DT-04 | ✅ 已修（按本轮判据；334 例源码字符串断言仍是主体，属后续扩面） | 试点 `src/features/editor/multiTabHost.render.test.tsx` **5→7 例**（新增：doc 子组件崩溃被 `EditorErrorBoundary` 接住 + 重试重建；capture 注册/注销打真实注册表）；新增 `src/hooks/useTabLifecycle.restore.render.test.tsx`、`src/hooks/useBootstrap.render.test.tsx`（DT-15 回归）⇒ 桌面 render 测试文件 3 个（移动侧另有 5 个）+ `vitest.config.ts` include `.render.test.tsx`；定向 45 文件/291 例绿 |
| DT-05 | ✅ 已修（第五轮） | `QuickNoteListSummary` 投影 + `read_quick_note`（IPC 135→136，preload/native/WEB_METHODS/parity 同步）+ 卡片进视口懒加载正文（08 §13-5） |
| DT-06 | ✅ 已修（第八轮） | `features/editor/editorHost.ts:31 EditorHostProps` 单一词表；5 宿主接入（`DesktopInkPad` / `UniverSheetEditor` / `BitableEditor` / `BoardEditor` / `EditorTab`） |
| DT-07 | ✅ 已修（第八轮） | `createLakeDocument` 921→330 行（`lakeRuntime.ts:726`，全文件 1524 行）；抽独立「返回 dispose」模块 `lakeAudioCardRetry` / `lakeKatexInjection` / `lakePerfSubscription` 并由 `addDispose`→`__disposeExtras` 汇总（`lakeRuntime.ts:712-720`） |
| DT-08 | ✅ 已修（第五/九轮） | `[sync-tab]` 11 处 console→rlog（08 §13-6）；lakeRuntime/UniverSheetEditor 15 处 console→rlog（08 §17-3）；采样：桌面产品代码 `console.log/debug/info` 仅剩 `resourceUpload.ts:23`+`fontTrial.ts:80`（调试/统计入口）+ `lib/log.ts`（logger 实现本身），rlog 47 处 |
| DT-09 | ✅ 已修（261029） | `src/App.tsx` 4 份 `<DesktopTopBarLeading>` 合并为**单一渲染点**：槽位 Provider（`src/desktop/desktopWorkspaceSlot.tsx`，不产 DOM）+ 纯函数 `topBarLeadingSlotView`；四态 visible/sharedRefs 归属逐项不变、DOM 构成不变；857→836 行（净 −21）；新 render 测试 5 例（含「App 单渲染点」棘轮）。桌面整页快照未跑（本机缺合成夹具缓存，见 HANDOFF） |
| DT-10 | ✅ 已修（08 §1） | 3 个零引用模块（`editorHost`/`treeRepositoryAdapter`/`imageConverter.worker`）已删；ink「开发中」置灰行已删；`ui-metrics` 10/10 无失效 allowlist 项 |
| DT-11 | ✅ 已修（第七轮） | `scripts/css-audit/audit-dead-css.mjs` 识别「模板串中间拼接」（L11-13 说明 + L60-79 已知样本 + `--selfcheck` 自证）；桌面候选 6→0（08 §15-7） |
| DT-12 | ✅ 已修（第六轮） | `src/hooks/useAnchoredMenu.ts` + `src/components/ui/InlineRenameInput.tsx`（各自带测试），接入 `Sidebar` / `QuickNotesWorkspace` / `QuickNoteTagManager` / `OutlineSidebar` |
| DT-13 | ✅ 已修（第六/九轮） | `src/hooks/useAsyncAction.ts`（10/10 组，08 §14-3 + §17-3）；`components/app/SettingsPanel.tsx` 的 `useState` 44→30（采样 grep 计数） |
| DT-14 | ✅ 已修（第四轮） | 新增 `features/editor/editorViewport.ts`；`desktopDerivedState` 变纯函数；Suspense 文案统一「正在加载编辑器…」（`MultiTabEditor.tsx:671`，render 测试断言） |
| DT-15 | ✅ 已修 | `src/desktop/tabSession.ts:53 restoreTabSessionForLimit`（按 `maxOpenTabs` 只留最近 N 个）+ `src/hooks/useBootstrap.ts` 改为调 `restoreTabs(planned.ids, planned.activeId)`（`useTabLifecycle.restoreTabs`：有界并发读 + **一次 `setOpenTabs`**）；旧「逐篇 openNote + 逐次淘汰」只保留在未注入 `restoreTabs` 的兼容分支 |
| DT-16 | ✅ 已修（261029） | 生产代码 `any` 35→**0**（lakeRuntime 21 / kernelUiAtoms 9 / lakeTocScrollFollow 3 / aiResultOps 2）；全仓 src+electron 生产代码 `: any\|as any\|<any>` = 0；新增 LakeRendererBus / LakeDocOpener / LakeCard* / KernelUiLib 等窄类型，无 as never/双重断言糊弄；定向 vitest 19 文件 259 例通过 |
| DT-05 小记列表全量 IPC/渲染 | ✅ 已修（261028 第五轮） | `list_quick_notes` 改回 `QuickNoteListSummary`（不读正文），新增 `read_quick_note`（IPC 135→136，三处同步）；卡片进视口懒加载正文；补列表无 body 测试 |