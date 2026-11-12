# 03 · 桌面端 UI 与样式系统审计（发布前最后一次全面审计）

> 审计对象：LakexLocalNotes 仓库 `lakex-local-notes`，桌面端（Electron）UI 层与 `src/styles` 样式系统。
> 本文为**只读审计**结论，未修改任何产品代码/样式/配置/测试/文档。
> 证据标注：**【核实】** = 本次审计实际跑过脚本/grep/读源码；**【推断】** = 基于结构判断、未逐条实测。
> 时间基准：261112；仓库状态参考 `docs/HANDOFF.md` §1（HEAD `e19fa3da`）。

---

## 0. 方法与范围

**范围（覆盖）**
- `src/App.tsx`、`src/desktop/**`、`src/components/**`、`src/features/**` 的 `.tsx`/`.css`、`src/hooks/**` 中与 UI 直接相关者。
- `src/styles/**`（index/kit/chrome/feature/overlay/a11y/tokens/components/dialog/document-status/compat/kernel-theme/vendor-focus/window-chrome/themes/app/*/fonts/*）。
- 内联 `style={{}}`、`!important`、`@layer` 使用、跨文件同 (选择器, 属性) 重复、令牌缺口、公共原语与 hooks 的重复实现。

**范围（不覆盖，见 §8）**
- `src/mobile/**`（另一审计员）；`src/features/usheet|bitable|ink` 的内核渲染内部细节（只记跨域线索）；实机视觉走查（未跑 `check-stylesnap`）；`electron/**` 渲染侧以外的逻辑。

**复现命令（全部只读，可直接重跑）**
| 目的 | 命令 |
| --- | --- |
| 官方样式指标（既有门禁口径） | `node scripts/ui-metrics.mjs --json` |
| 逐文件声明/重复组棘轮 | `npx vitest run src/styles/cssLayers.test.ts`（本次**未跑**，见 §8） |
| 跨文件同 (选择器,属性) 重复明细 | 自建只读脚本（等价于 `ui-metrics.mjs` 的 `crossFileDupGroups`，但输出明细；算法见文末附录） |
| 被上层压掉的 legacy 声明 | 自建只读脚本：按 `src/styles/index.css` 的 `@import … layer()` 建层序表，按「同选择器 + 同 at-rule 上下文 + 同属性」比较，取最高层为胜者 |
| 原语消费者计数 | 对 `src/**/*.{ts,tsx}`（去 test）逐类名计数 `.ln-*` |

> 自建脚本只读 `src/**.css` 并在内存中比较；判据来自 `AGENTS.md` §3#14（层序即优先级）与 `scripts/ui-metrics.mjs` 的口径。脚本本身未写入仓库。

**关键前提（先说结论，避免误判）**：桌面样式系统**不是**"补丁堆叠"状态。既有门禁实测**【核实，`node scripts/ui-metrics.mjs --json`】**：
- 桌面非主题颜色字面量 **0**；字号字面量 **0**；`--b3-*` 引用 **0**；
- `!important` **9 条 = 允许清单 9 条**，清单外 **0**、失效登记 **0**；
- 未定义 `--lake-*` 引用 **0**、禁用别名引用 **0**；
- 同端跨文件重复组 **103**（基线 105，只许降）；移动端颜色字面量 0 / `!important` 19（棘轮）。

因此问题集中在**「已被上层压掉但仍留在 legacy 的声明」**（维护成本、改错文件风险）与**「少量重复实现/原语双份」**，未发现 P0 级样式缺陷。

---

## 1. 事实地图

### 1.1 样式文件清单（按层，桌面侧）

层序定义 **【核实】**：`src/styles/index.css:7` → `@layer vendor, legacy, tokens, kit, shell, feature, overlay, a11y;`。
两层例外必须记住：① `kernel-theme.css` **故意不 layered**（压内核注入的未分层 schema，见 `index.css:24`）；② 组件内 `import "./x.css"` 的样式**一律未分层 ⇒ 压过所有层**（`AGENTS.md` §7「壳层/渲染」条；`main.tsx:9-11` 仅 `vendor-focus.css`/`window-chrome.css` 走这条）。

**规模【核实】**：桌面 CSS **75 个文件 / 11,424 行**（`src/styles` 29 个非字体文件 6,493 行 + 字体 3 个 352 行 + `src/components`+`src/features` 43 个 4,579 行）；移动端 25 个 / 6,115 行（本报告不计）。桌面非测试 TS/TSX（App/components/features/desktop）**141 个 / 50,727 行**。

| 层 | 文件（行数） | 加载方式 | 职责 |
| --- | --- | --- | --- |
| tokens | `themes/base.css`(214, 144 令牌)、`light.css`(84, 60)、`dark.css`(100, 73)、`warm.css`(81, 60) | `@import … layer(tokens)` | 令牌唯一来源；base = 主题无关（几何/动效/层级/字体 + 少量品牌固定色），三套主题 = 调色板 |
| kit | `kit.css`(820) | `layer(kit)` | 101 个 `ln-*` 原语（按钮/菜单项/行/输入/页签/对话框内件/chip/日历…） |
| shell | `chrome.css`(795) | `layer(shell)` | 应用外壳：活动栏/目录栏头部/状态栏/浮层材质 |
| feature | `feature.css`(255)、`brand-launch.css`(10)、`features/aiWriting/aiWriting.css`、`fonts/font-overrides.css`(119) | `layer(feature)` | 功能域层：字体接线、S3 说明块、资源浏览器、AI 写作 |
| overlay | `overlay.css`(313)、`selectionToolbar.css` | `layer(overlay)` | 浮层：scrim/dialog/menu/popover/tip + 编辑器选区工具栏 |
| a11y | `a11y.css`(49) | `layer(a11y)` | reduced-motion 契约（最高层，不需要 `!important`） |
| legacy | `app/base|shell|editor|dialogs|tabs|vendor-board|settings|quick-notes|panels|misc`（约 2,800 行）、`compat.css`(193)、`tokens.css`(37)、`components.css`(380)、`document-status.css`(102)、`dialog.css`(107)、`features/outline/outline.css`、`image-lightbox.css`、`attachment-preview.css` | `layer(legacy)` | 迁移期旧实现：仍在生效的骨架 + **已被上层压掉的残留** |
| unlayered（故意） | `kernel-theme.css`(161) | 未分层 | 内核 lakex 主题变量映射 |
| unlayered（JS import） | `vendor-focus.css`、`window-chrome.css`、`components/**/*.css`（colorPalette/nodeIcon/noteTagRow/sidebarPinned/sidebarTagFilter/syncConflictsPanel/historySnapshotPreview/noteDocPreview）、`features/**/*.css`（bitable 15 / ink 3 / editor 4 / tags / diary / ai / aiWriting / board / usheet） | 组件内 `import` | 分包自有的**子作用域**样式（约定：不得出现裸标签选择器） |

判断方法沉淀（改样式前先问「它在哪一层、谁是胜者」）：
1. 若在 `styles/app/*`、`compat.css`、`components.css`、`tokens.css`、`dialog.css`、`document-status.css`，查 kit/chrome/feature/overlay 是否已为**同选择器**声明同属性 ⇒ 若是，改 legacy 不会生效；
2. 若在组件内 `import` 的 CSS，它未分层 ⇒ 赢了也不要放「全仓语义」的规则进去（会变成隐形最高层）；
3. `@media` / `@starting-style` 上下文必须一致才算「同一处」，否则不构成覆盖。

### 1.2 令牌体系（--lake-*）

**【核实】**
- **定义位置**：`src/styles/themes/base.css`（`:root`，144 个，主题无关）+ `light.css`/`dark.css`/`warm.css`（`[data-theme=…]`，调色板）。
- **分层干净**：`base ∩ light = 0`（base 不含任何主题调色板键，light 不含任何几何键）⇒ 不存在"同一语义两处定义"。
- **主题键集合一致**：light 60、warm 60（与 light 完全同键）；dark 73 = light 60 + 13 个深色重绘（`--lake-note-ref-icon-*` 9 + `--lake-locked-text-icon-*` 3 + `--lake-kernel-brand-green`）。
- **缺口检查**：`tokensGuard.undefinedLakeRefs = 0`、`forbiddenAliasRefs = 0` **【核实】**；没有"用了但没定义"的令牌，也没有 AGENTS 禁用的过渡别名。
- **命名一致性**：几何/层级/动效/字号统一 `--lake-` 前缀；控件档 `--lake-ctl-h`/`-sm`/`-settings`/`-settings-sm`（27/26/32/27），与 `docs/DESIGN.md:219,320,334` 完全一致 **【核实】**。
- **有意的"不随主题变"色**：`--lake-file-*`（10 类文件类型）、`--lake-media-*`、`--lake-board-canvas-*`、`--lake-ai-icon-*`、`--lake-ai-tag-*` 等 40+ 个定义在 `base.css` 且三套主题都不覆盖，**判据成立**（文件类型/画布底色/品牌 AI 绿属语义固定），**不作为问题**；唯一需留意见 §2 P2-c。

### 1.3 kit 原语清单与消费者数

**【核实】** `kit.css` 共 **101 个 `.ln-*` 类**（含变体）。消费者 Top（tsx 引用次数 / 文件数）：

| 原语 | 次数 | 文件数 | 原语 | 次数 | 文件数 |
| --- | --- | --- | --- | --- | --- |
| `.ln-btn` | 166 | 48 | `.ln-input__field` | 23 | 15 |
| `.ln-menu__item` | 138 | 22 | `.ln-input` | 21 | 13 |
| `.ln-iconbtn` | 90 | 25 | `.ln-row` | 20 | 10 |
| `.ln-ellipsis` | 84 | 35 | `.ln-chip` | 14 | 6 |
| `.ln-iconbtn--compact` | 80 | 25 | `.ln-tabs` / `.ln-tabs__item` | 14 / 14 | 9 / 8 |
| `.ln-btn--ghost` | 44 | 29 | `.ln-btn--outlined` | 44 | 4 |
| `.ln-empty` | 32 | 8 | `.ln-row2` | 5 | 3 |

- **按钮梯队落地良好**：`--primary` 26 次 / `--secondary` 39 / `--ghost` 44 / `--outlined` 44 / `--link` 5 / `--danger-text` 13，覆盖 48 个文件的基本盘。
- **22 个原语 0 消费者**：`.ln-modal` 5、`.ln-drawer` 3、`.ln-menu__hint/__sep/__sub/__submenu` 4、`.ln-form__row/__label/__desc/__control/__group-title` 5、`.ln-noscrollbar`、`.ln-row__indent`、`.ln-tag--status/--sync/--ok/--hoverable`、`.ln-tip__hint`。其中 `.ln-modal`/`.ln-drawer` 与既有单一来源冲突，见 §2 P2-a。
- **反例（已被正确处理，不要重开）**：`kit.css:289-291` 注释记录 `.ln-toast` 因零调用在 261006 删除；三处 toast 各自实现是被接受的决定（见 §5）。

### 1.4 两个"历史 JSX 契约"类族

**【核实】** 菜单历史类名仍在 9 个 tsx 里当 JSX 钩子：`Sidebar.tsx`(7 处)、`TreeSelectionContextMenu.tsx`(2)、`Overlay.tsx`(2)、`BitableEditor.tsx`(2)、`ExportSubmenuItem.tsx`/`AiWritingSidebar.tsx`/`DiaryWorkspace.tsx`/`TabContextMenu.tsx`/`TagsWorkspace.tsx` 各 1。
`kit.css:208-229` 明确把这批 legacy 选择器（`.top-menu > button` / `.context-menu > button` / `.context-menu-item` / `.context-menu-submenu > button` / `.create-menu > button`）**收编进 `.ln-menu__item` 同一份规则**，注释写明"legacy 仍作 JSX 钩子、几何/配色只有这一份"⇒ **这不是问题，是已定稿的收编方式**；真正的问题是 legacy 文件里**还留着同属性的旧声明**（下一节）。

---

## 2. 问题清单

### P0（阻断/真实缺陷）：无

**【核实】** 依据：§0 的 6 项门禁指标全绿；`!important` 清单外 0；无未定义令牌；颜色/字号字面量 0。桌面 UI 层未发现"改了不生效导致功能/视觉破坏"的现症。**注意**：这不等于"视觉已验收"——`check:stylesnap` 42 态已连续多批未跑（`HANDOFF §3` P0），属装置债，见 §4。

---

### P1-1（落点违规）25 处 legacy 声明已被上层压掉，改它不会生效

**问题真实存在？【核实】** 用「同选择器 + 同 at-rule 上下文 + 同属性，取最高层为胜者」扫桌面 CSS：共 **58 处被压掉的声明**，分布 **7 个 legacy 文件**；其中 **25 处取值与胜者不同**（改它不只无效，还会让人以为现行值是这个）。另有 33 处**取值相同**的纯双份。

**不做会付什么代价？** ① 下次改视觉的人（含 AI Agent）按 grep 命中第一处就改**必然改错文件**——`cssLayers.test.ts` 头注释记的就是这个坑（"改一处要同时改几个文件、跨宽度/跨主题另一边没跟上，用户报过多次"）；② 出现第二个"看起来的事实"，例如状态栏「已同步·历史」按 `document-status.css:30-33` 是 accent 色，实际生效是 `chrome.css:67` 的 status-ok 绿。

**清单（18 组 / 合计 25 条声明；按改动风险排序）**

| # | 被压掉的声明（file:line） | 现行胜者（file:line） | 处理 |
| --- | --- | --- | --- |
| 1 | `styles/app/dialogs.css:12` `.context-menu { z-index: 600 }` | `styles/overlay.css:183` `var(--lake-z-overlay-menu)` | 删 legacy 的 z-index |
| 2 | `dialogs.css:14` `.context-menu > button { display: grid }` | `styles/kit.css:209` `display: flex` | 删 display/gap/font-size |
| 3 | `dialogs.css:14` `.context-menu > button { gap: 9px }` | `kit.css:216` `gap: 8px` | 同上 |
| 4 | `dialogs.css:14` `.context-menu > button { font-size: …-tiny }` | `kit.css:228` `--lake-font-size-body` | 同上 |
| 5 | `dialogs.css:16` `.context-menu-item { font-size: …-tiny }` | `kit.css:228` | 删 |
| 6 | `dialogs.css:26` `.context-menu-submenu > button { display: block; font-size: …-tiny }` | `kit.css:209/228` | 删 |
| 7 | `styles/app/shell.css:17` `.create-menu { z-index: 1000 }` | `overlay.css:183` | 删 |
| 8 | `shell.css:19` `.create-menu > button { display: grid; min-height: 32px; padding: 4px 8px; color: var(--lake-text-2) }` | `kit.css:209/217/218/228`（flex / `--lake-ctl-h` / `0 8px` / `text-1`） | 删（4 条） |
| 9 | `shell.css:253` `.create-menu > button:hover, .context-menu > button:hover { background: var(--lake-neutral-veil-2) }` | `kit.css:182-188` `background: var(--lake-bg-selected)` | 删（旧 hover 语义已废） |
| 10 | `shell.css:220` `.sidebar.sidebar-collapsed { box-shadow: none }` | `chrome.css:293-315` `var(--lake-shadow-card)` | 删 |
| 11 | `shell.css:243` `.sidebar.sidebar-floating { border: 0 }` | `chrome.css:311` `0.5px solid var(--lake-border-strong)` | 删 |
| 12 | `shell.css:565` `.sidebar.sidebar-floating/-collapsed { height: calc(100vh - …) }` | `chrome.css:310` `var(--lake-dir-peek-height)` | 删（旧公式已被"贴底浮卡"取代） |
| 13 | `shell.css:867` `.note-row:active { filter: brightness(.95) }` | `chrome.css` 同选择器 `filter: none` | 删 |
| 14 | `shell.css:50` `.tree-row-actions:has(:focus-visible) { display: inline-flex }` | `chrome.css` 同选择器 `display: flex` | 删 |
| 15 | `styles/app/tabs.css:184` `.tab-switcher-menu { z-index: 500 }` | `overlay.css:183` | 删 |
| 16 | `styles/document-status.css:22` `.document-statusbar-stats/-state { gap: 7px }` | `chrome.css` 同选择器 `--lake-space-lg` / `5px` | 删 |
| 17 | `document-status.css:30-33` `.document-statusbar-state.synced-history { color: var(--lake-accent-text); background: color-mix(…accent 10%…) }` | `chrome.css:67` `--lake-status-ok` / `--lake-status-ok-soft` | **需裁决**（§6#1），默认删 legacy 副本、保留 chrome |
| 18 | `styles/app/quick-notes.css:387` `.quick-note-entry { background: var(--lake-bg-panel) }` | `styles/feature.css` 同选择器 `--lake-bg-canvas` | 删 |

（另有 33 处**同值**双份，风险低：菜单项 `align-items/border/background/text-align`（`dialogs.css:14,16,26`、`shell.css:19` ↔ `kit.css:208-229`）、`quick-note-entry` 的 border/radius/shadow（`quick-notes.css:149,387` ↔ `feature.css`）、`.sidebar-floating position:fixed`（`shell.css:210` ↔ `chrome.css:291`）、`.floating-dialog/.settings-panel/.search-panel background`（`shell.css:473` ↔ `overlay.css`）、`.tab-item/.note-row/.toolbar__item border-radius`（`shell.css:847` ↔ `chrome.css`）。可随 P1-1 一并删，不必单独排期。）

**应改在哪（根位置）**：**只删 legacy 侧声明，不动胜者**。胜者已是单一来源：菜单表面/层序 = `overlay.css:174-196`，菜单项 = `kit.css:208-262`，目录栏浮卡几何 = `chrome.css:288-315`，状态栏 = `chrome.css:60-80`，小记卡面 = `feature.css`。删完把 ui-metrics.mjs 的 BASELINE.crossFileDupGroups 按删掉的 (选择器,属性) 组逐项下调（本次 103 → 预计约 85–90，**以删除后实测为准**），并同步 `cssLayers.test.ts` 对应文件 `decls` 基线（只降）。

**影响面**：5 个 legacy 文件（dialogs / shell / tabs / document-status / quick-notes）约 40 行声明删除；零视觉变化（被压掉的声明删掉后胜者不变）；两个门禁数值下降。

---

### P2-a（原语双份）kit 的 .ln-modal* / .ln-drawer* 与 overlay 的 .ln-dialog* 同一语义两套，且前者 0 消费者

**【核实】** `kit.css:269-287` 定义 `.ln-modal` + 4 子件（宽 560 / 圆角 lg / 阴影 dialog / z-dialog / padding 14-16…）与 `.ln-drawer` 3 个；`overlay.css:48-107` 定义 `.ln-dialog` + 4 子件，被 **37 个 tsx 文件 / 114 处**使用；`grep -rl ln-modal src --include=*.tsx = 0`、`ln-drawer = 0`。
`AGENTS.md` §3#14 明确"浮层 = `components/ui/Overlay.tsx`"，`docs/DESIGN.md` §6 只写 `.ln-dialog`（`:294,357`），**没有 `.ln-modal`**。

**代价**：这是"第二套样式范式"的入口——新代码/AI 只要 grep `ln-modal` 就会以为它是对话框原语，写出一个既不进 scrim 也不吃 Overlay 定位的对话框；而仓库刚在 261006 用同样判据删了 `.ln-toast`（`kit.css:289-291`），标准不一致。
**根因修法**：删 `.ln-modal*`（5 条）与 `.ln-drawer*`（3 条）。**为什么是根位置**：kit 是"可用原语清单"，清单里放一个与文档冲突且无人使用的对话框 = 单一来源被稀释；调用点为 0，所以删在 kit 而不是各调用点。
**影响面**：8 条声明；`cssLayers.test.ts` 的 `kit.css` decls 708 → 700；零视觉变化。

---

### P2-b（行原语两套）.ln-row2 与 .ln-row 并存，且 DESIGN 未记载

**【核实】** `kit.css:149-201` = `.ln-row` 族（`__main/__actions/__icon`、`--notebook` 变体、hover/active/selected/disabled 全套、`is-selected` 走 `--lake-bg-selected`）；`kit.css:593-603` = `.ln-row2` 族（`padding xs/sm`、`border-radius --lake-ctl-rad`、hover、`.ln-list-item--focus`、`__main/__title/__meta`），消费者 = `HistoryPanel` / `SearchPanel` / `TrashPanel` / `DraftRecoveryDialog`（4 文件 5 处）。
`docs/DESIGN.md` §Rows（`:342-346`）只描述「通用行/菜单高 27px」= `.ln-row`，**没有 `.ln-row2`**；`ln-row2` 无 `min-height`，实际高度由内容撑（面板两行档）。

**代价**：同一"列表行"语义有两个平级基类，新面板选哪个靠口口相传；DESIGN 与实际不一致（文档缺项，非代码错）。
**根因修法（二选一，建议 A）**
- A（低风险）：`.ln-row2` 改名 `.ln-row--dense`（或保留名字但在 kit 注释与 DESIGN §Rows 登记为"面板两行密排档：xs/sm 内距、无固定高"），4 个调用点同步改类名 + `uiPrimitives.test`/`cssLayers` 提及处更新；
- B（不动代码）：只补 `DESIGN.md` §Rows。若担心改名引发 4 个面板回归，B 可接受——**这更像"文档欠账"而非代码缺陷**。
**为什么是根位置**：行档位定义权在 kit 的行原语段；调用点只决定"用哪一档"，不该用两个平级基类表达同一行族的两个密度。

---

### P2-c（令牌）主题固定色里有一处需确认，其余不缺

**【核实】** 令牌层无缺口（§1.2）。唯一可讨论点：`--lake-ai-icon-soft: #c7f0df`（`themes/base.css:6`，三套主题都不覆盖）作为 `AiSparkIcon` 填充（`src/features/ai/AiSparkIcon.tsx:11`）。浅薄荷绿是"压在浅色面板上的第二层"，深色主题下仍是浅色，与"文字/图形按实际铺到的最浅/最深表面标定"（§3#14）不是同一套判据。
**判据**：**推断**问题（无深色实机截图比对）；`--lake-ai-icon-ink`/`-star`/`--lake-ai-tag-*` 同批同性质。若确属"品牌图标固定色"，应写进注释；若确属"面板底衬"，dark 需覆盖。
**建议**：**不列入必修**；或在 `base.css` 该组加一行注释"品牌固定，深色不覆盖（有意）"，或 dark 补 `--lake-ai-icon-soft` 一档。**不要为它新增令牌机制。**

---

### P2-d（公共函数）日期时间有 7 处绕开单一来源 core/dateFormat

**【核实】** 单一来源存在且被宣布：`src/core/dateFormat.ts`（`formatHm/formatMd/formatMdHm/formatYmd/formatDateTime/formatListTime/sameLocalDay`），`src/lib/formatTime.ts:1-14` 头注释写"261017 从 toLocaleString 改为 core/dateFormat 单一来源 —— 原实现在不同系统会显示成 2026/8/4、含秒…"
**仍在绕开的调用点**：

| 位置 | 现状 | 应改为 |
| --- | --- | --- |
| `components/app/SearchPanel.tsx:31` | `toLocaleDateString("zh-CN",{month,day})` | `formatMd(date)` |
| `components/app/AssetsBrowser.tsx:544,579` | `toLocaleDateString("zh-CN")` | `formatYmd(date)` |
| `features/diary/DiaryWorkspace.tsx:92` | `toLocaleTimeString("zh-CN",{hour,minute,hour12:false})` | `formatHm(date)` |
| `components/app/DraftRecoveryDialog.tsx:27` | `toLocaleString("zh-CN",{hour12:false})` | `formatDateTime(date)` |
| `components/app/RebuildDataBlock.tsx:34` | `toLocaleString("zh-CN",{hour12:false})` | `formatDateTime` |
| `components/app/SettingsPanel.tsx:554` | `new Date().toLocaleString()`（**无 locale**） | `formatDateTime(new Date())` |
| `features/editor/tablePasteGuard.ts:104` | `toLocaleString("zh-CN")` | `formatDateTime` |

**代价**：同一应用里"日期长什么样"取决于 OS locale（正是 261017 修过的坑）；`SettingsPanel:554` 连 `zh-CN` 都没给，在英文系统上生成中文模板里的英文日期。
**根因修法**：7 个调用点换 core helper；不新增 helper、不改签名。**为什么是根位置**：格式化语义本来只有一处，绕开是**调用点违规**，不需要新抽象。

---

### P2-e（公共函数）剪贴板没有公共 helper：10 个写点、3 个无错误处理、5 处各写"已复制"反馈

**【核实】** `src/lib` 下无 clipboard helper。桌面 UI 的 `navigator.clipboard` 相关 **10 处**（`BitableEditor.tsx:832,838`(read)、`AiAssistantDialog.tsx:328`、`AiWritingWorkspace.tsx:87`、`EditorTab.tsx:1078`、`LakeEditor.tsx:195`、`QuickNotesWorkspace.tsx:668`、`S3ConfigImportDialog.tsx:30`(read)、`SettingsPanel.tsx:557,567`、`NoteInfoDialog.tsx:109`）；其中 **3 处既无 `.catch` 也无 `void`**（`QuickNotesWorkspace.tsx:668`、`SettingsPanel.tsx:557,567`）⇒ 剪贴板不可用/被拒时 unhandled rejection。
"已复制"反馈各写一份：`SafeModeBanner.tsx:40`、`QuickNotesWorkspace.tsx:669`、`SettingsPanel.tsx:558,568`、`NoteInfoDialog.tsx:42,109,190`（带 1200ms 复位 timer）、`AssetsBrowser.tsx:414`。

**代价**：① 失败路径不一致（有的静默、有的报"复制失败"、有的未捕获）；② 6 处反馈文案/时序各写一遍。
**根因修法**：新增 `src/lib/clipboard.ts`：`export async function copyText(text: string): Promise<boolean>`（`navigator.clipboard?.writeText` + try/catch + 布尔返回），需要反馈处用统一 `useCopiedFlag(ms = 1200)`。**只上收这两件**——`blockCopyBridge.ts` / `aiLakeClipboard.ts` 是富格式/自定义 MIME 的独立管线（`AGENTS.md` §4「复制/剪切 = 单一管线」），不并入。
**收益 > 复杂度？** 10 个调用点 + 3 个错误路径 + 5 处重复反馈 → 约 25 行收敛，符合 §3#17。若不想发布前动 10 个文件，可先只补 3 处 `.catch`（最小版）。

---

### P2-f（模块层）QuickNotesWorkspace 1317 行：控制器与视图混装（建议拆 3 个 hook）

**【核实】** `components/app/QuickNotesWorkspace.tsx` = **1317 行 / 28 个 useState / 40+ 内部函数**，单组件承担 4 类职责：
1. **数据加载**：`refreshItems`(255)、`ensureDetail`(242)、`cacheDetail`(236)、`refreshTags`(298)、`createTag`(304)；
2. **保存/上传管线**：`saveDraft`(449)、`saveDraftAndSync`(564)、`saveBeforeSwitch`(683)、`waitForPendingUploads`(690)、`settleAfterSave`(708)、`quickNoteUploader`(401)、`pushOneNote`(543)；
3. **视图状态**：`sortBy`(173)、`viewMode`(177)、`tagFilter`(192)、`timeFilter`(200)、`typeFilter`(202)、多选 `toggleSelected`(777)、`pendingDelete`(166)、`convertItems`(168)；
4. JSX（列表/写作卡/筛选/空态/标签管理/确认浮层）。

**拆分方案（按依赖独立度排序，每步可单独交付）**

| 步 | 抽出 | 输入/输出 | 风险 |
| --- | --- | --- | --- |
| 1 | `features/quickNotes/useQuickNoteList.ts` | (refresh) → {items, loading, refreshItems, ensureDetail, cacheDetail, prewarm} | 低（无 UI） |
| 2 | `features/quickNotes/useQuickNoteDraftSave.ts` | 现有 save 5 函数 + uploader → {saveDraft, saveDraftAndSync, saveBeforeSwitch, settleAfterSave} | 中（有 quickNoteSyncGate / quickNotePushPriority 护栏；别把 gate 判定挪出单一来源） |
| 3 | `features/quickNotes/useQuickNoteFilters.ts` | 5 个筛选 state + 持久化(readViewPref) + 过滤计算 | 低 |
| 4 | <QuickNoteFilterBar> / <QuickNoteListPane> 两个纯展示组件 | props 直传 | 中（QuickNotesVirtualList / QuickNoteCard 已在，属 JSX 搬运） |

**为什么是根位置**：40 个函数里只有 4 个是 React 状态驱动，其余是**纯管线**；放在组件内导致每次视图状态变化都穿过 1300 行闭包，也是 28 个 useState 的根因。抽 hook 后组件回到约 400 行视图。

---

### P2-g（模块层）Sidebar 1857 行 / SettingsPanel 1447 行

**【核实】** `Sidebar.tsx`：34 useState、17 useRef、45 useCallback、8 个模块级函数 + **7 个内部组件**（TreeRow 1462、TreeRowFace 1521、TreeRenameDialog 1656、CreateChildItems 1717、CreateMenu 1732、ContextMenu 1760、ConfirmDelete）。已抽出的邻近文件：`SidebarPinnedSection.tsx`、`SidebarTagFilter.tsx`、`TreeSelectionContextMenu.tsx`（拆分已开始，不是"要不要拆"）。
`SettingsPanel.tsx`：**40 个 useState**、单组件、所有设置分组 JSX 内联；已有 `components/ui/settingsPrimitives.tsx` 与 `components/model/settingsSearch.ts`（SETTING_ITEMS，`AGENTS.md` §3#14 要求"每加/改一行必须同步"）。

**建议（按性价比，不建议大重写）**
1. Sidebar：把 7 个内部组件搬成同目录文件（纯搬运，props 不变）；其中 TreeRenameDialog 与已有 `components/ui/InlineRenameInput.tsx` / `NamePromptDialog.tsx` 语义重叠，**先核对能否复用再搬**；TreeRowFace 可延后（与 TreeRow 共享 memo 边界，搬动有性能风险）。
2. SettingsPanel：按**设置分组**抽 `settings/sections/*.tsx`（每组一个组件，state 就近下沉），保留 SettingsPanel 做导航/搜索/布局。**必须同时改 settingsSearch.ts 的 SETTING_ITEMS 并跑 settingsSearch.test.ts**（AGENTS 红线）。
3. **不建议动 App.tsx**：虽 1445 行，但已下沉到 **30+ hook + 20 组件**（useWorkspaceState / useDesktopShell / useSavePipeline / useTabLifecycle …），useState 仅 9 个，属"编排层"；拆它只会把 30 个 hook 的返回类型在文件间搬来搬去（§3#17 的"收益只停在整洁"）。

---

### P2-h（DESIGN.md 与实际不一致）：2 处文档欠账

| # | DESIGN.md | 实际 | 判据 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | §Rows（:342-346）只写 .ln-row（27px 行） | kit.css:593-603 另有 .ln-row2 面板行档（无固定高） | 文档是规格、代码是事实；差异让"面板行该多高"无据可依 | **改文档**（补一行档位） |
| 2 | §6 只写 .ln-dialog（:294,357） | kit.css:269-287 另有 .ln-modal/.ln-drawer | "代码多一套、文档没写"的反向不一致 | **改代码**（删死原语，P2-a） |

其余抽查项**全部一致**【核实】：按钮 27/26 两档、设置档 32、圆角 8/10/4（菜单表面 10 − 内距 6）、0.5px 边框、250ms 单档动效、z-tooltip、.ln-tip 深墨底、--lake-* 命名；--lake-ctl-h* 实际值与 DESIGN 对齐。

---

## 3. 根因修法方案（"找根位置"速查）

**通用原则（与用户要求一致）**：一次 UI 改动只在**一个**文件落笔；若必须写第二条规则，先确认它是"新层压旧层"还是"旧层里的死声明"。

| 要改的东西 | 唯一根位置 | 不要改 |
| --- | --- | --- |
| 按钮高度/圆角/厚度档位 | `src/styles/themes/base.css` 的 --lake-ctl-h* / --lake-ctl-rad* | 任何 .ln-btn* 里写死 px |
| 按钮/图标钮/chip/菜单项/输入/行/页签/空态 | `src/styles/kit.css` 对应原语段 | 业务 CSS 复写 .ln-* 同属性；styles/app/** 同名声明 |
| 对话框/菜单/气泡/提示表面、层序、position | `src/styles/overlay.css:174-196`（菜单表面）/ `:48-107`（对话框） | styles/app/dialogs.css、styles/app/shell.css 同名规则（已死） |
| 目录栏/活动栏/状态栏外壳几何 | `src/styles/chrome.css` | styles/app/shell.css（同名规则已死） |
| 主题色/文字色阶/阴影 | `themes/light|dark|warm.css`（+ base 的品牌固定色组） | 其它 CSS / tsx 里的 hex |
| 浮层定位与夹取 | `hooks/usePopoverPosition` + `hooks/topMenuPosition.placeVertical` | 组件内估算高度 / 手写 position |
| 列表行（两行密排） | kit 行原语段（P2-b 收敛后） | 面板 CSS 自写行高/内距 |
| 功能域局部版面 | 该 feature 自己的 features/<域>/*.css（未分层） | styles/feature.css 再写同名（会被未分层压掉） |
| 设置页骨架 | compat.css 的 .config-* + settingsPrimitives.tsx | 新造第二套表单行 |

**逐项根因修法**
1. **P1-1**：删 legacy 死声明 → 同步下调 ui-metrics 的 crossFileDupGroups 与 cssLayers.test.ts per-file decls 基线。**新增护栏**（根因级，防复发）：ui-metrics.mjs 增 shadowedDecls 计数（层序比较 ~40 行），基线 = 本次实测 25，**只许降**。这样"往 legacy 再写一条会被压掉的规则"当场失败——比人工 review 可靠，也比 cssLayers 的 dup 计数更准（dup 不区分层序，a11y 的 reduced-motion 合法覆盖也被计入）。
2. **P2-a**：删 .ln-modal* / .ln-drawer*；kit 头注释加"对话框 = overlay 的 .ln-dialog，此处不再定义弹窗表面"。
3. **P2-b**：二选一（改名 .ln-row--dense 或补 DESIGN）。**不要**把面板行改成 27px（与"面板两行档"冲突且影响 4 个面板观感）。
4. **P2-c**：只加注释或 dark 补一档，不动机制。
5. **P2-d**：7 个调用点换 core/dateFormat。
6. **P2-e**：新增 lib/clipboard.ts + hooks/useCopiedFlag.ts，替换 10 个写点（富格式管线不并入）。
7. **P2-f/g**：按 §2 表逐步抽 hook/组件，**一步一交付、每步跑相关 render test**。

---

## 4. 迁移顺序与护栏（必须同时改测试/门禁）

**前置事实【核实】**：改样式必须跑 `src/styles/cssLayers.test.ts`（逐文件 decls/dupGroups 只许降）+ `node scripts/ui-metrics.mjs`（`AGENTS.md` §3#14）。BASELINE 调整规则写在测试头注释：**"按职责归并"可合法抬高接收方**，但同一批要把来源方调小。

**建议顺序（每批独立可回滚）**
1. **批 0（零风险）**：P2-d 日期 7 处 + P2-e 的 3 处 .catch。护栏：searchPanel* / assetsBrowser* / diaryWorkspace.render / settingsBackupObservability。
2. **批 1**：P1-1 删死声明（按表 1→18，先菜单后外壳）。同批改：ui-metrics.mjs BASELINE（105→实测）、cssLayers.test.ts 4 个 legacy 文件 decls、新增 shadowedDecls 护栏。验证：node scripts/ui-metrics.mjs + npx vitest run src/styles/cssLayers.test.ts src/styles/uiPrimitives.test.ts src/styles/selectionTokens.test.ts src/styles/motionContract.test.ts。**零视觉变化** ⇒ 不需要重烤快照。
3. **批 2**：P2-a 删死原语 + P2-b 补文档（若选改名则同批改 4 个面板 tsx 与 uiPrimitives.test）。护栏：cssLayers.test.ts 的 kit.css decls 708→700。
4. **批 3**：P2-f QuickNotesWorkspace 抽 hook，**一步一提交**，每步跑 QuickNotes*.render.test / quickNoteSyncGate / quickNotePushPriority / quickNoteDetailPrewarm。
5. **批 4**：P2-g Sidebar 内部组件外搬（纯搬运，先做 TreeRenameDialog 复用决策）+ SettingsPanel 分 section。**SettingsPanel 批必须同批改 settingsSearch.ts** 并跑 settingsSearch.test.ts。
6. **批 5（视觉验收）**：批 1–4 理论上零视觉变化；若批 2 选改名或批 4 动 JSX 结构，**必须**按 AGENTS.md §3#21② 跑受影响态 node scripts/check-stylesnap.mjs --states …；动外壳几何才需重烤基线（§3#21③）。**注意**：桌面 42 态已连续多批未跑（HANDOFF §3 P0），本机可能无合成夹具缓存 ⇒ 发布前应在有夹具机器补齐，否则"零视觉变化"只有代码级证据。

**护栏缺口（建议补，成本低）**
- shadowedDecls（见 §3.1）：把"改错文件"从 review 责任变成门禁。
- 剪贴板：若采纳 P2-e，加 clipboard 单测（分支：无 API / 拒绝 / 成功）。
- 日期：可加 lint 式测试 `grep -E "toLocaleDateString|toLocaleTimeString|toLocaleString"` 在桌面 UI 为 0（toLocaleLowerCase 不在其列）。

---

## 5. 明确不做项（避免把刻意差异误判成不统一）

1. **不做 Toast 统一**：.sync-toast（富状态：标题/正文/进度/动作/关闭，chrome.css:682）、.document-notice-toast（状态栏上方小提示，chrome.css:77 / document-status.css:35）、.quick-notes-toast（删除撤销，带按钮，dialogs.css:64）三者语义不同；kit.css:289-291 已记录 .ln-toast 因零调用被删。**再立项 = 重开已结案决定**。
2. **不把桌面与移动 UI/样式合并**：两端 UI 层刻意独立（AGENTS §3#14、§4）；ui-metrics 的 crossEndDupGroups = 641 是设计允许。**唯一可共享的是纯 TS**（core/dateFormat、core/colorPalette），已在共享。
3. **不把 .context-menu / .create-menu / .top-menu 的 JSX 类名改成 .ln-menu__item**：kit 已用"一个规则表列全部历史选择器"收编（kit.css:208-229）；批量改要动 9 个文件 + 依赖这些类名的测试（sidebarContextMenu.test.ts、useTopMenus.render.test.tsx 等），**代价大于收益**。
4. **不清理 58 处内联样式**：已逐类核对——2 处是 <use> shadow 树只能靠 CSS 变量继承的**有记录例外**（noteRefIcon.tsx / lockedTextIcon.tsx 头注释），其余是**动态几何**（Overlay/popover 坐标、多维表列宽、拖拽缩进、虚拟滚动位移）。无"静态样式写在 style 里"的违规。
5. **不为 tooltip / z-index 再造令牌**：zOrder.test.ts 已钉死层级，--lake-z-* 覆盖 20+ 档。
6. **不把 .ln-row2 面板行强行改成 27px**（见 §3.3）。
7. **不清理 22 个 0 消费者原语里的"变体类"**（.ln-menu__hint/__sep、.ln-form__*、.ln-tag--*、.ln-row__indent）：kit 是**设计词表**，死 CSS 审计明确排除 kit.css。**只处理与既有单一来源冲突的 .ln-modal/.ln-drawer**（P2-a）。
8. **不清理 vendor/ 内核冗余**（AGENTS §3#18 红线）。
9. **不动 kernel-theme.css 的"不 layered"**：未分层是压内核注入 schema 的手段，改分层即失效。
10. **不新增依赖**（Tailwind/Radix/Motion…）：本报告所有方案都是"删/搬/收编"，零新依赖。

---

## 6. 需用户裁决

| # | 事项 | 选项 | 代价/影响 |
| --- | --- | --- | --- |
| 1 | **状态栏「已同步·历史」颜色**（P1-1 #17） | A. 删 document-status.css:30-33，保留 chrome.css:67（现状 = 绿 status-ok）／B. 反过来把 chrome 改成 accent 色 | 两种色必须收敛；A 零视觉变化，B 改观感（绿→主题色）。**默认 A**，需认可"已同步"用状态绿 |
| 2 | **.ln-row2 是否改名收敛**（P2-b） | A. 改名 .ln-row--dense（4 面板 tsx + 测试）／B. 只补 DESIGN.md | A 更干净但要动 4 个面板；B 零风险但留两个平级基类 |
| 3 | **新增 shadowedDecls 门禁**（§4） | A. 加（~40 行脚本 + 基线 25 只降）／B. 不加，靠 review | A 把"改错文件"变成机器可拦；B 维持现状（本次这类问题正是 review 漏出来的） |
| 4 | **发布前是否补桌面 42 态快照** | A. 有夹具机器补跑／B. 接受"代码级零视觉变化"证据发布 | HANDOFF §3 已列 P0；批 1–2 确实零视觉变化，但批 2 若改名/批 4 动 JSX 就只有代码证据 |
| 5 | **.ln-modal/.ln-drawer 删还是留作"未来原语"**（P2-a） | A. 删（与 .ln-toast 同标准）／B. 保留但标注"禁止使用" | A 移除选错原语风险；B 保留草稿但需永久维护一致性 |

---

## 7. 交叉域线索（只记录，不深挖）

1. **JS 常量 vs CSS 变量的单一来源**：窗口/侧栏几何常量散在 `src/desktop/desktopTypes.ts`（SIDEBAR_MIN/MAX_WIDTH、OUTLINE_SIDEBAR_*），与 chrome.css 的 --lake-dir-peek-* / --sidebar-width 成对——geometrySources.test.ts 存在，跨域审计员可核对是否已完全覆盖（audit-core / audit-docs）。
2. **check:stylesnap 42 态 / check:windowsweep**：属"装置/门禁"域（audit-docs）。本报告未跑；若其它审计员报"门禁缺失"，本条可作交叉证据。
3. **features/usheet|bitable|ink 样式**：bitableEditor.css 等为未分层 JS import，bt-* 与 kit 原语混用（注释已声明"盒子/配色走 kit"）；**建议 audit-features 抽查 bitable/ink 内部是否自写按钮/行几何**（本报告只验证未出现裸标签选择器）。
4. **移动端**：src/mobile/** 不引桌面样式层，但 core/dateFormat / colorPalette / nodeIcons 是跨端共享 TS——本次发现桌面 7 处绕开 dateFormat，**移动端可能同样存在**（MobileUsheetViewer.tsx:504 有 toLocaleDateString("zh-CN")，属移动审计范围）。
5. **docs/ARCHITECTURE.md 过期**：不在本报告范围（audit-docs）；若其中描述"样式分层/kit 原语"，本报告 §1.1/§1.3 可作最新事实源。
6. **内联样式里 8 处 hex**：ColorPalette.tsx:157 / LakeColorBoard.tsx:19,59,60,76 / ink 默认墨色 #262626——属"原生色彩输入控件兜底值"，不是主题色；若关心"颜色字面量只允许 themes"，可登记为已知例外。

---

## 8. 未覆盖清单（交接时需说明）

1. **未跑任何门禁命令**（只读约束）：ui-metrics 跑了 --json（只读）；cssLayers.test.ts **未跑**、check:stylesnap 未跑、npx tsc --noEmit 未跑。数值来自源码静态分析，与门禁实跑可能有 ±1 差异（crossFileDupGroups 本次算出 103 = ui-metrics 报的 103，一致）。
2. **未做视觉走查**：所有"零视觉变化"结论都是**代码级推断**（被压掉 = 胜者不变），未截图比对。
3. **未覆盖**：features/bitable|ink|usheet 内部样式细节；src/desktop/** 全部 tsx（只抽查顶层引用）；guide/；src/mobile/**。
4. **未逐条审计 33 处同值双份**（只按簇汇总；P1-1 修完会一并消失）。
5. **未验证 reduced-motion / reduced-transparency 分支的实机行为**（a11y.css 与 tokens.css 的两条 !important 属允许清单）。

---

### 附：P1-1 明细的复现方式

```bash
cd lakex-local-notes
node scripts/ui-metrics.mjs --json | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["complianceGuard"]["crossFileDupGroups"])'   # 103 <= 105
# 被压掉的 legacy 声明（本文 §2 P1-1 的 58/25 条）：
#   1) 从 src/styles/index.css 解析 @import "..." layer(<层>) 得层序：vendor<legacy<tokens<kit<shell<feature<overlay<a11y
#   2) 组件内 import 的 css 记为 unlayered（最高）
#   3) 逐文件解析 (at-rule 上下文, 选择器列表拆分, 属性, 值)，按 (端, ctx, 选择器, 属性) 分组
#   4) 取层序最高者为胜者，低层同属性声明即"被压掉"；两值不同 = 高风险（25 条），相同 = 双份（33 条）
```

