# UI-PRIMITIVES-PHASE1-260926.md — 原语收敛（Overlay / Button / Switch）设计与迁移清单

> 状态：**设计稿，待评审**。本批**不改生产代码**（Phase 0 的 4 个 bug 已在 `f15687a` 修掉）。
> 关联：`AGENTS.md §3 #14` · `docs/PANEL-CONTRACT.md` · 规格源 `/Users/admin/file/local-lake/ui-design-inputs/out/design-system/`（`COMPONENTS 01/04/05/09` · `STATES §2` · `TOKENS`）
> 底账全部来自仓库实测（`rg` 可复算），不是估算。

## 0. 一句话

Phase 0 修的是**症状**；本设计解决「症状会不断长出来」的**结构**：把**浮层 / 按钮 / 开关**三个角色各自收敛成**一个原语**，并把「手抄选择器清单」的统一方式换成「**单一 base + 唯一性门禁**」。

## 1. 问题定性（实测底账）

### 1.1 浮层：手写 `createPortal` 遍布 12 个文件，表面来源 3 套

`createPortal(` 实测 21 处（下表按类型分组）；另有若干非 portal 的浮层（内联 `role=menu/dialog`）需要一并收编。

| # | 位置 | 当前根类 / 结构 | 遮罩 | Esc | 目标原语 |
|---|---|---|---|---|---|
| 1 | `Sidebar.tsx:898` ConfirmDelete | `.modal-backdrop` + `.confirm-dialog` | ✅ | ⚠️ 靠 App | Dialog |
| 2 | `NoteInfoDialog.tsx:171` | `.modal-backdrop` + `.ln-dialog` | ✅ | ⚠️ | Dialog |
| 3 | `AssetRenameDialog.tsx:31` | `.modal-backdrop` + `.ln-dialog` | ✅ | ⚠️ | Dialog |
| 4 | `SearchPanel.tsx:87` | `.search-panel-backdrop` + `.search-panel` | ✅ | ⚠️ 靠 App | Dialog（命令面板型，顶对齐） |
| 5 | `TrashPanel.tsx:359` | `.trash-panel-backdrop` + `.floating-dialog` | ✅ | ⚠️ | Dialog（可拖/可缩放） |
| 6 | `HistoryPanel.tsx:227` | `.history-panel-backdrop` + `.floating-dialog` | ✅ | ⚠️ | Dialog（可拖/可缩放） |
| 7 | `Sidebar.tsx:663` | `.create-menu` | ❌ | ✅ 自建 | Menu |
| 8 | `Sidebar.tsx:862` | `.context-menu` | ❌ | ⚠️ | Menu |
| 9 | `CardContextMenu.tsx:77` | `.context-menu` | ❌ | ✅ 自建 | Menu |
| 10 | `CardContextMenu.tsx:133` | `.context-menu` | ❌ | ✅ 自建 | Menu |
| 11 | `MultiTabEditor.tsx:381` | `.tab-switcher-menu` | ❌ | ⚠️ | Menu（可调宽） |
| 12 | `MultiTabEditor.tsx:576` | `.context-menu` | ❌ | ⚠️ | Menu |
| 13 | `DesktopOverlays.tsx:114` | `.top-menu` | ❌ | ⚠️ | Menu（锚定） |
| 14 | `DesktopOverlays.tsx:128` | `.top-menu` | ❌ | ⚠️ | Menu（锚定） |
| 15 | `Sidebar.tsx:924` | `.emoji-picker-backdrop` + `.emoji-picker` | 透明 | ⚠️ | Popover（可缩放） |
| 16 | `kernelUiAtoms.tsx:39/163` | `.selection-toolbar__tip` | ❌ | ❌ | Popover（非交互 tooltip） |
| 17 | `bitableCells.tsx:66` | `.bt-popover` | ❌ | ✅ 自建 | Popover |
| 18 | `bitableCells.tsx:295` | `.bt-text-expand` | ❌ | ✅ 自建 | Popover（可拖） |
| 19 | `BitableEditor.tsx:894` | `.bt-menu-backdrop` + `.bt-row-menu` | 局部 | ⚠️ | Menu |
| 20 | `ImageLightbox.tsx:99` | `.image-lightbox` | ✅ 自带 | ⚠️ | Lightbox |
| 21 | `AttachmentPreview.tsx:65` | `.attachment-preview` | ✅ 自带 | ✅ 自建 | Lightbox |

> 非 portal 但同类、也要收编：`SyncStatusPopover.tsx:160`（`.sync-status-popover`，role=dialog）、`QuickNotesWorkspace.tsx:704/726/766`（`.quick-notes-sort-menu` / `.quick-note-row-menu`）、`ExportSubmenuItem.tsx:58`（子菜单）、`QuickNotesWorkspace.tsx:830`（`.quick-note-convert-dialog`）。

### 1.2 按钮：45 处 `b3-button` vs 13 处 `ln-btn`

`b3-button` 分布（12 文件）：`SettingsPanel.tsx 22` · `QuickNotesWorkspace.tsx 7` · `NoteInfoDialog.tsx 4` · `HistoryPanel.tsx 2` · `Sidebar.tsx 2` · `AssetRenameDialog.tsx 2` · 其余 7 文件各 1。变体：`--outline 32` · `--cancel 3`（另用 `.ft__error / .danger-button` 语义类）。
`ln-btn` 13 处**全在移动端**（`SettingsDrawer 9` · `NotebookWorkspace 2` · `mobile/ui/ConfirmDialog 2`）。
两套都已被各自 CSS 映射到设计规格（`kit.css:426` 把 `.b3-button` 映射为按钮规格），但**同名不同源**：改一处按钮观感要动两处。

### 1.3 开关：新件已有，旧件在用

- 设置页 6 个 `<Switch>`（`SettingsPanel.tsx:535/536/537/649/687/849`）走 `settingsPrimitives.tsx:43`，渲染 `<input class="b3-switch">` + `::after` 伪元素滑块。
- `ln-switch`（`kit.css:237`，`<button role=switch aria-checked>` + `__knob`）**0 处引用**。
- 结论：**新件已建、旧件没迁**；Phase 0 只把旧件的滑块基线补回来了。

### 1.4 三个根因

| 代号 | 根因 | 证据 |
|---|---|---|
| R1 | 统一靠「选择器清单」：`overlay.css` 手抄 `.top-menu/.context-menu/.create-menu/...` | 不在清单 = 无表面（Phase 0 的 `.confirm-dialog`/`.emoji-picker` 正是这样坏的） |
| R2 | 同一样式多处定义 | `.ln-dialog` 在 `kit.css:144` + `dialog.css:5` + `overlay.css:18` 各定义一次；全仓 `z-index: 数字` 67 处 |
| R3 | 无「必入口」/无门禁 | `ln-modal/ln-scrim` 0 引用、`ln-switch` 0 引用；`cssLayers.test.ts` 只卡声明数量，不卡「浮层是否有表面」 |

## 2. 必须先认账的结构 bug（与 Phase 0 同源）

| 代号 | 问题 | 证据 |
|---|---|---|
| B1 | `.modal-backdrop` 的 `z-index:30` **低于**侧栏 250 / 顶栏 400 ⇒ 用它的三个对话框（属性 / 重命名 / 删除确认）遮罩盖不住外壳 | `dialog.css:2` vs `themes/base.css` 的 `--lake-z-sidebar:250` / `--lake-z-topbar:400` |
| B2 | kit 的 `--lake-z-scrim:200 / --lake-z-dialog:210 / --lake-z-tooltip:400` 都在 shell 之下，`.ln-dialog` 直接全屏用会被侧栏/顶栏盖 | `themes/base.css` + `kit.css:143/154` |
| B3 | `.ln-dialog` 三处定义（kit / dialog / overlay） | 同 R2 |
| B4 | `.modal-backdrop` 同时定义在 `dialog.css:2`（布局+z）与 `overlay.css:11`（底色）、`app/dialogs.css:411`（动画+毛玻璃） | 三处 |
| B5 | 无焦点圈闭 / 无滚动锁：全仓无 `inert` / focusTrap；Esc 由各组件各写一遍 | `rg `Escape` src`：~20 处各自 `addEventListener` |

## 3. 原语设计

### 3.1 Overlay（统一浮层）

**目录**：`src/components/ui/Overlay.tsx`（低层）+ 预设 `Dialog.tsx / Menu.tsx / Popover.tsx`。

**低层 `<Overlay>` API 草案**

| prop | 类型 | 语义 |
|---|---|---|
| `open` | boolean | 由调用方的状态驱动；原语不持状态 |
| `kind` | `dialog \| menu \| popover` | 决定默认职责（见下表） |
| `onDismiss` | `() => void` | 外点 / Esc 统一回调 |
| `anchor` | element / point / rect | 菜单/气泡定位；缺失时用 `point` |
| `label` | string | 映射 `aria-label` |
| `initialFocus` | ref / selector | dialog 打开后的首焦点（默认首个可操作项） |
| `trapFocus` | boolean | 默认 `kind=dialog` 为 true |
| `lockScroll` | boolean | 默认 `kind=dialog` 为 true |
| `layer` | token | 覆盖默认层（一般不用） |
| `className` | string | 只允许加「内容级」类，不允许自造表面 |

**职责矩阵（谁负责什么）**

| 职责 | dialog | menu | popover | 实现位置 |
|---|---|---|---|---|
| portal 到 body | ✅ | ✅ | ✅ | Overlay |
| 层序（z 令牌） | ✅ | ✅ | ✅ | Overlay |
| 遮罩 `.ln-scrim` | ✅ | ❌ | ❌ | Overlay |
| 外点关闭 | ✅（点遮罩） | ✅ | ✅ | Overlay |
| Esc 关闭 `*.ln-menu-item` | ✅ 关闭对话框 | ✅ 关闭菜单 | ✅ | Overlay |
| 焦点圈闭 `*.ln-menu-item` | ✅ | ❌（用 roving focus） | ❌ | Overlay |
| 滚动锁 | ✅ | ❌ | ❌ | Overlay |
| 进出动效 | ✅（STATES §2） | ✅ | ✅ | Overlay + 层 CSS |
| 表面（底/边/圆角/阴影） | `.ln-dialog` | `.ln-menu` | `.ln-popover` | 层 CSS（唯一来源） |

**层序提案（overlay 段必须整体高于 shell `topbar:400`）**

| 令牌 | 现有 | 提案 | 说明 |
|---|---|---|---|
| `--lake-z-menu` | （`dropdown:100`） | 600 | 菜单 / 下拉 / 气泡 |
| `--lake-z-scrim` | 200 | 700 | 对话框遮罩 |
| `--lake-z-dialog` | 210 | 710 | 对话框 |
| `--lake-z-lightbox` | — | 720 | 图片 / 附件预览 |
| `--lake-z-toast` | 300 | 800 | 提示条 |
| `--lake-z-tooltip` | 400 | 900 | 气泡提示 |

**表面单一来源**：只保留三支 `.ln-dialog / .ln-menu / .ln-popover`；删除 `overlay.css` 的手抄清单与 `app/*.css` 里的同名重复；每个浮层根带 `data-overlay="dialog|menu|popover"`，用属性选择器命中表面（比类名清单更难漏）。

**内核边界**：lakex 注入的浮层（内核工具栏 / 卡片菜单 / antd portal）**不纳入**本原语，继续走内核自己的层；我们的 overlay 段取 600+ 以稳超内核常见层值。

### 3.2 Button

- 目标：单一来源 `ln-btn`（变体 primary/secondary/ghost/danger × 尺寸 md/sm）；`IconButton` 同理。
- 存量 `b3-button`（45）：**不做全量 find/replace**；改为「接触即迁 + 新代码只用 ln-btn」，计数归零后删 `.b3-button` 规则。
- `.config-block__actions` 补「按钮组」子规则（间距 / 换行 / 危险项靠右的优先级档次）。
- 对齐 COMPONENTS 01：高 27、横距 11、图标 14。

### 3.3 Switch

- 迁移 `Switch`（`settingsPrimitives.tsx:43`）到 `ln-switch`：`<button type="button" role="switch" aria-checked><span class="ln-switch__knob"/></button>`。
- **API 变更**：`onChange: (e: ChangeEvent<HTMLInputElement>) => void` → `onChange: (checked: boolean) => void`；6 个调用点从 `e.target.checked` 改为 `checked`。
- 备选：保留 `<input type=checkbox>` 只补视觉（`role=switch` 加在 input 上语义不标准）；推荐 button。

## 4. 门禁（防回归；优先静态、零新依赖）

| 代号 | 断言 | 实现 |
|---|---|---|
| G1 | `createPortal` 只允许出现在 `src/components/ui/` | 扫描 `src/**/*.tsx`（照 `zOrder.test.ts` 的读文件写法） |
| G2 | 每个 `data-overlay` 根必须命中 `.ln-dialog/.ln-menu/.ln-popover` 之一 | 同款 CSS 扫描 |
| G3 | `.ln-dialog/.ln-menu/.ln-popover` 各自在全量样式里**恰好定义一次** | 照 zOrder 的「唯一定义」断言 |
| G4 | overlay 段 z 顺序 + 除令牌/白名单外不得新增 `z-index: 数字` | 扩展 `zOrder.test.ts` |
| G5 | 视觉：每个原语一份手测清单（4 主题 × 三态 + 截图存档） | 不引快照框架 |

## 5. 迁移清单

| 批次 | 内容 | 条目 |
|---|---|---|
| 1a 基础设施 | Overlay + 三支表面 base + 层序令牌 + G1/G3/G4 | 新建 `src/components/ui/*`；改 `themes/base.css / overlay.css / kit.css / dialog.css` |
| 1b 对话框 | 6 个 | `ConfirmDelete` · `NoteInfoDialog` · `AssetRenameDialog` · `SearchPanel` · `TrashPanel` · `HistoryPanel` |
| 1c 菜单 | ~10 个 | `Sidebar` ×2 · `CardContextMenu` ×2 · `MultiTabEditor` ×2 · `DesktopOverlays` ×2 · `SyncStatusPopover` · `QuickNotesWorkspace` ×3 · `ExportSubmenuItem` · `BitableEditor` 行菜单 |
| 1d 气泡/预览 | 6 个 | `emoji-picker` · `selection-toolbar__tip` ×2 · `bt-popover` · `bt-text-expand` · `image-lightbox` · `attachment-preview` |
| 1e 开关 | 1 组件 + 6 调用点 | `settingsPrimitives.tsx` + `SettingsPanel.tsx` |
| 1f 按钮 | 45 处增量 | 按文件接触即迁 |

## 6. 非目标（明确不做）

- 不重写视觉语言 / 信息架构；不新增依赖；不动 lakex 注入的浮层；不清 vendor 死代码（`AGENTS #18`）；不做全量视觉快照框架（除非用户要）。

## 7. 粗估

1a 约 0.5–1 天；1b/1c/1d 各约 0.5–1 天；1e 约 0.5 天；1f 持续。每批走门禁 + CDP 点验；移动端单独线（沿用 `mobile-kit.css`，后续对齐）。

## 8. 待你拍板（逐条）

| 编号 | 问题 | 我的建议 |
|---|---|---|
| Q1 | 原语目录 `src/components/ui/`？ | 是 |
| Q2 | Overlay + 预设，还是直接三个组件？ | Overlay + 预设（职责不重复） |
| Q3 | z 令牌重排（overlay 段抬到 400 之上） | 是（同时修 B1/B2） |
| Q4 | Button 增量迁移（保留 alias 到归零） | 是（避免 45 处一次性改类） |
| Q5 | Switch 接受 `onChange` API 变更（改 6 个调用点） | 是（换来 `role=switch` 语义） |
| Q6 | B1（`.modal-backdrop` z=30）先作为 Phase 0.5 单独修，不等原语？ | 是 |
| Q7 | 视觉门禁只要手测清单，还是要快照？ | 先手测清单 |
| Q8 | 桌面优先、移动随后？ | 是 |
