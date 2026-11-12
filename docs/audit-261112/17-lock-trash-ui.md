# 17 · 桌面「只读 / 回收站 / 云端已删除 / 保存被拒 / 冲突 / 同步 warning」UI 一致性审计

> 只读审计（未改产品代码/未跑设备门禁/未重烤快照）。证据均为当前 HEAD 源码 file:line，标注【核实】= 直接读到代码；【推断】= 由代码结构推得、未实机复现。
> 范围 = 任务清单 6 个表面 + 相邻的「正文文件缺失」面板（同为只读原因，作为对照）。
> 判定基准（语义已定稿，不在此重开讨论）：回收站 = 特殊笔记本（软删、可恢复）；删除 = 移动；编辑锁 = 本机只读标记且随 v3 索引传播；apply 单篇失败 = 降级跳过、不整轮失败、下轮重试。

---

## 0. 方法与证据

- 读源码：`src/features/editor/{EditorTab,MultiTabEditor,TabItemVisual}.tsx`、`src/components/app/{TrashPanel,SyncStatusPopover,SyncConflictBadge,SyncConflictsPanel,SaveConflictDialog,DesktopStatusBar}.tsx`、`src/components/model/documentStatusModel.ts`、`src/core/{noteInfo,sharedTypes,syncDecisions,cloudState,s3v3Report}.ts`、相关 CSS（`styles/components.css`、`styles/chrome.css`、`styles/app/{dialogs,tabs,panels}.css`、`styles/document-status.css`、`components/app/syncConflictsPanel.css`）。
- 令牌核对：逐条核上述表面用到的颜色/字号（目标选择器 grep `color:|background:|font-size:`）→ 全部 `--lake-*`，例外见 I-10。
- 同步 warning 链路：`src/core/sharedTypes.ts`（SyncWarning/SyncWarningKind）→ `electron/s3v3/desktopSync.ts`（并入 SyncResult.warnings）→ `src/lib/types.ts`（SyncResult/SyncStatusInfo）→ `SyncStatusPopover`（stats.warnings 渲染）。
- 未做：实机截图、设备门禁、构建；不评价"观感好不好"，只评价"同一语义是否一套说法/一套档位"。

---

## 1. 状态定义（审计用编号）

| 编号 | 状态 | 语义（定稿） | 关键判据 |
| --- | --- | --- | --- |
| S1 | 本机锁定（只读） | 编辑锁 = 本机只读标记，随同步传播 | `lockedNoteIds` / `isEditLocked` |
| S2 | 回收站（软删/副本） | 删除 = 移入回收站笔记本，正文/附件/索引都在 | `isGoneNote`（parentId/syncState） |
| S3 | 云端已删除（仅本地） | 远端已 purge，本地副本进回收站、可恢复并重新上传 | `cloudDeleted` / `cloud_deleted` |
| S4 | 他端彻底删除（本机仍有副本） | 账本记 remote_purged；本地副本保留在回收站 | `TrashItem.purged` |
| S5 | 正文文件缺失 | 正文文件被外部删除；只读、不写盘、不上传空正文 | `bodyMissing` |
| S6 | 同步 warning | 远端对象/资源缺失或本机正文异常 ⇒ 跳过该项、其余继续 | `SyncWarning`（7 kind） |
| S7 | 保存被拦（blocked） | S2/S3/S4 时点保存被管线拦下（无内容可存） | `useSavePipeline` openTab.deleted |
| S8 | 保存版本冲突 | 磁盘正文被外部/他端改过 ⇒ 不写盘、三选一 | `saveConflicts` / SAVE_CONFLICT_MESSAGE |
| S9 | 同步记录（账本） | 本机审计账本：远端覆盖本地 / 他端删除 / 保存时磁盘被改 | `SyncConflictKind` |

> S1 与 S2/S3/S4 都是「只读」但原因不同：S1 = 用户主动 + 可一键解锁；S2/S3/S4 = 数据事实 + 必须恢复。当前 UI 对后三者在部分表面已区分（S3/S4），部分表面完全不分（标签徽标，见 I-2）。

---

## 2. 状态 × 表面矩阵

图例：`●` = 有专门呈现；`◐` = 有呈现但不区分该状态（合并说法）；`—` = 不出现。

| 表面（组件 / 落点） | S1 锁定 | S2 回收站 | S3 云端已删除 | S4 他端删除 | S5 正文缺失 | S6 warning | S7 保存被拦 | S8 保存冲突 | S9 同步记录 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 编辑器本体 `EditorTab.tsx:36-37,68` | ●（切 Viewer，无内联说明） | ●（切 Viewer） | ●（切 Viewer） | ●（切 Viewer） | — | — | — | — | — |
| E2 标签徽标 `TabItemVisual.tsx:36-39` | — | ◐「已删除」 | ◐「已删除」 | ◐「已删除」 | — | — | — | — | — |
| E3 标签顶部横幅 `MultiTabEditor.tsx:653-658` | — | ● | ◐（也说「在回收站中」） | ◐ | — | — | — | — | — |
| E4 文档状态栏胶囊 `DesktopStatusBar.tsx:90-96` + `documentStatusModel.ts:24-36` | —（锁是独立胶囊 E5） | —（文档自身状态照旧显示） | ●「云端已删除（仅本地）」 | — | — | — | —（只闪 notice） | — | — |
| E5 状态栏锁胶囊 `DesktopStatusBar.tsx:64-80,93-101` | ●「已锁定」+ 解锁浮层 | — | — | — | — | — | — | — | — |
| E6 侧栏树行/右键 `sidebar/TreeRowFace.tsx:45` / `sidebar/ContextMenu.tsx:80` | ● 锁图标「已锁定（只读）」/ 菜单「锁定（只读）·解锁」 | — | — | — | — | — | — | — | — |
| E7 顶栏/多维表菜单 `DesktopOverlays.tsx:169` / `BitableEditor.tsx:932` | ● | — | — | — | — | — | — | — | — |
| E8 属性弹窗 `core/noteInfo.ts:57`（`NoteInfoDialog.tsx:130` 渲染） | ●「，已锁定」后缀 | ●「已同步/待同步…」 | ●「云端已删除（仅本地）」 | — | — | — | — | — | ●「，有冲突副本」 |
| E9 回收站面板 `TrashPanel.tsx:63-68,317,371` | — | ● 整页语义 | ● badge--warn「云端已删除（仅本地）」 | ● badge--error「已被他端删除」 | ● badge--muted「正文已删」 | — | — | — | — |
| E10 同步状态浮层 `SyncStatusPopover.tsx:235-258` | — | — | — | — | — | ◐ 只显示计数（I-8） | — | ●「已保留历史快照（N 份）」 | ◐ 只给入口+摘要 |
| E11 同步记录面板/角标 `SyncConflictBadge.tsx:3-7` | — | — | ◐ hint 文案含「云端已删除·仅本地」 | ●「他端已删除」kind | — | — | — | — | ● |
| E12 notice / 错误横幅 `App.tsx:232,1016` | — | ●（blocked 时 3s notice） | ◐（同「回收站中」） | ◐ | ●（打开时一次性 notice，`useTabLifecycle.ts:72-77`） | — | ● | — | — |
| E13 保存冲突对话框 `SaveConflictDialog.tsx:30-47` | — | — | — | — | — | — | — | ● 三选一 | — |

主要结论：S2/S3/S4 在 E2/E3 被合并成一个词（「已删除」/「回收站中」），在 E4/E9 却被区分（S3「云端已删除（仅本地）」、S4「已被他端删除」）⇒ 同一分类信息只覆盖一半表面；S1 有 4 个入口但**编辑器内无解释**；S6 数据齐全但只显示计数。

---

## 3. 文案与视觉档位明细（逐表面）

### E2 标签徽标 `TabItemVisual.tsx:36-39` / `MultiTabEditor.tsx:542,634`
- 文案「已删除」；tooltip 三处近似不同：
  - `TabItemVisual.tsx:37`「文档在回收站中：只读、编辑不会保存，恢复后才能继续写」
  - `MultiTabEditor.tsx:542,552`「该侧文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写」
  - `MultiTabEditor.tsx:634`「文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写」
- 档位：`.tab-deleted-badge`（`styles/app/dialogs.css:48-56`）→ `background: var(--lake-status-error-soft); color: var(--lake-status-error)`（红）；字号 `--lake-font-size-nano`。

### E3 标签顶部横幅 `MultiTabEditor.tsx:653-658`
- 文案「该文档在回收站中：只读、编辑不会保存。需要继续写请先恢复。」+ 按钮「打开回收站」（`onOpenTrash` 由 `App.tsx:1037` → `DesktopLibrary.tsx:109` 接通【核实】）。
- 档位：`.tab-gone-banner`（`styles/components.css:187-210`）→ `color: var(--lake-status-pending); background: var(--lake-status-pending-soft)`（琥珀）；按钮 = 透明底 + `inset 0 0 0 .6px var(--lake-accent)`。

### E4 文档状态栏胶囊 `DesktopStatusBar.tsx:90-96` + `documentStatusModel.ts:24-36`
| kind | 文案 | 颜色（`styles/chrome.css:66-74`） | 图标（`DesktopStatusBar.tsx:31-44`） |
| --- | --- | --- | --- |
| saving | 保存中 | status-sync | LoaderCircle spin |
| dirty | 待保存 | status-pending | Save |
| save-error | 保存失败 | status-error | AlertTriangle |
| cloud-deleted | 云端已删除（仅本地） | status-pending | CloudOff |
| local-only | 仅本地 | text-3 / bg-block | WifiOff |
| conflict | 有冲突 | status-error | AlertTriangle |
| synced-history | 已同步，历史 N | status-ok | History |
| pending | 待同步 | status-pending | Upload |
| synced | 已同步 | status-ok | CheckCircle2 |

关键顺序（`documentStatusModel.ts:25-33`）：saving → dirty → save-error → cloud-deleted → !cloudEnabled → isConflict（historyCount>0 时显示绿色「已同步，历史 N」）→ dirty → synced。

### E5 状态栏锁胶囊 `DesktopStatusBar.tsx:64-80,93-101`
- 有 onUnlock：按钮「已锁定」（title「点击解锁」，Lock 图标，`--lake-accent-text`），点开浮层「本文档已锁定（只读）/ 锁定期间编辑与工具栏被禁用。/ 解锁」；无 onUnlock：静态 span，title「文档已锁定（只读）」。
- 档位：`.document-statusbar-lock`（`styles/chrome.css:72` accent-text；`styles/document-status.css:95-96` 浮层内距）。

### E6/E7 侧栏与菜单
- `sidebar/TreeRowFace.tsx:45` 锁图标 title「已锁定（只读）」；色 `--lake-text-3`（`styles/chrome.css:618`）。
- `sidebar/ContextMenu.tsx:80`「解锁」/「锁定（只读）」；`DesktopOverlays.tsx:169`「解锁当前文档」/「锁定当前文档（只读）」；`BitableEditor.tsx:932` 同款（Lock/LockOpen）【核实：三处同义同措辞，仅「当前文档」有无之差】。

### E8 属性弹窗 `core/noteInfo.ts:57`（两端共用）
- 状态行：`云端已删除（仅本地）` / 「已彻底删除」/「待同步」/「已同步」+「，有冲突副本」+「，已锁定」（可叠加）。
- 注意：这是**唯一**把 S1/S3/S9 三态拼进一行文本的表面，无颜色/图标（纯文本），与状态栏形状完全不同。

### E9 回收站面板 `TrashPanel.tsx`
- 行徽标（63-68）：`badge--muted`「日记」、`badge--error`「已被他端删除」、`badge--warn`「云端已删除（仅本地）」、`badge--muted`「正文已删」、`badge--warn/--muted`「N 天后清除」。
- 顶部说明（317）「回收站会随云同步到所有设备。被删文档下的分组和文档会一起显示（可展开），恢复时整棵恢复，子项也可单独彻底删除。」
- 过期提示（322-324）「开启自动过期（N 天）：部分条目将在 7 天内自动彻底删除（含云端）。需要保留请在到期前恢复。」
- 恢复回执（236-249）「正在从 S3 拉取缺失数据…」/ 云未启用 → `cloudStateHint`（`core/cloudState.ts:39-43`）/「已恢复，但有 N 个资源未能下载（可能云端也没有）：附件/图片会显示为空，下次同步会自动重试。」
- 档位：`.badge` 族（`styles/components.css:286-299`，全 --lake-*）；`.trash-panel-hint`（text-4）、`.trash-panel-notice`（status-pending）、`.trash-error`（status-error）（`styles/app/panels.css:5-14`）。

### E10/E11 同步浮层与记录
- 浮层抬头（`SyncStatusPopover.tsx:220-224`）「云端同步」/ `buildSyncStatusModel` 六档（`syncStatusModel.ts:23-39`：「仅本地保存」「云同步未配置」「同步中」「同步失败」「待同步」「已同步」）。
- 冲突快照块（235-247）「已保留历史快照（N 份）」/「检测到远端版本差异，已保留历史快照」+「查看历史」；色 = `.sync-status-history-note`（status-pending，`components.css:23-28`）。
- 同步记录块（111-129）「最近有 N 条记录（远端覆盖本地 / 他端已删除 / 保存时磁盘被改）」+「多为另一窗口或浏览器端改过这篇正文；不处理不会丢数据，可在记录里查看并恢复本地版。」+「知道了」「查看同步记录」。
- 角标 `SyncConflictBadge`（`syncConflictsPanel.css:5-20`）= accent 蓝圆点数字；组件注释写「未读小圆点」。
---

## 4. 不一致清单

> 每条：证据 → 问题（真实代价）→ 建议根位置。**不改代码，只给落点。**

### I-1 同一「只读原因」用了两档颜色（红 vs 琥珀），切换面无规则
- 证据：回收站文档在标签徽标 = `--lake-status-error` 红（`styles/app/dialogs.css:52-53`）；同一文档在顶部横幅 = `--lake-status-pending` 琥珀（`styles/components.css:194-195`）；状态栏 cloud-deleted = 琥珀（`styles/chrome.css:71`）；回收站面板「云端已删除」= badge--warn 琥珀、「已被他端删除」= badge--error 红（`TrashPanel.tsx:64-65`）。
- 代价：本仓红色语义 = 「保存失败/冲突」（`chrome.css:69` 两条 error 档 + 状态栏「保存失败」「有冲突」均红）⇒ 回收站徽标抢用错误色；同一"只读"事实在编辑器里又变琥珀，用户无法从颜色建立稳定预期。
- 建议根位置：`styles/app/dialogs.css` 的 `.tab-deleted-badge` 改用与横幅/状态栏一致的 pending 三件套（**只改一处来源**）。S4「已被他端删除」保持红是对的（确实更严重）；建议在 DESIGN 或 CSS 头注释写明「红 = 需人工处理/不可本地撤销；琥珀 = 可恢复」。

### I-2 S2/S3/S4 在标签徽标/横幅里合并成「已删除/回收站」，在状态栏/回收站面板里却区分
- 证据：E2/E3 只有「已删除」「该文档在回收站中」（`TabItemVisual.tsx:38`、`MultiTabEditor.tsx:656`）；E4 有「云端已删除（仅本地）」（`documentStatusModel.ts:29`）；E9 有三种徽标（`TrashPanel.tsx:64-65,371`）。
- 代价：云端已删除的文档在标签条看起来和普通回收站一样；按「恢复」时的语义不同（S3 = 重新上传，S2 = 移出回收站），入口却没有区分。
- 建议根位置：E3 横幅（`MultiTabEditor.tsx:653-658`）按 cloudDeleted/purged 分支出第二句；数据来源【推断】当前 `TabInfo`（`MultiTabEditor.tsx:38-52`）只有 `deleted/bodyMissing`，需由 `App.tsx` 把 `cloudDeletedNoteIds`（已存在，`useWorkspaceState` 侧）并入 tab 状态；E2 tooltip 用已有的 `deletedTitle` 入参分别传（调用点 `MultiTabEditor.tsx:542,634`）。

### I-3 「云端已删除（仅本地）」写法不统一 + 违反「界面文案不用中点」红线
- 证据：`core/noteInfo.ts:57`、`components/model/documentStatusModel.ts:29`、`TrashPanel.tsx:65,371` 用「（仅本地）」；`components/app/syncConflicts.ts:26` 用「云端已删除·仅本地」（**界面可见** hint 文案）。
- 代价：既不一致，也触 AGENTS §3#14 观感红线「界面文案不用中点『·』作分隔符」（261029 定型）。
- 建议根位置：`syncConflicts.ts:26` 改「（仅本地）」；若后续抽公共常量，放 `src/core/` 侧单一来源（不要每处各写一遍）。

### I-4 同义提示三份措辞（回收站只读）
- 证据：banner（`MultiTabEditor.tsx:656`）「该文档在回收站中：只读、编辑不会保存。需要继续写请先恢复。」；blocked notice（`App.tsx:232`）「文档已在回收站中，编辑不会保存；恢复后才能继续写。」；tooltip（`TabItemVisual.tsx:37` / `MultiTabEditor.tsx:542,634`）「文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写」。
- 代价：同一事实三句（「需要继续写请先恢复」vs「恢复后才能继续写」），改一处漏两处；notice 对 S3 也说「回收站中」（丢云端已删除信息）。
- 建议根位置：抽 1 个常量（建议 `src/core/trashCopy.ts`，或并入 `core/noteInfo.ts` 既有文案区）供 E2/E3/E12 共用；S3 分支走 I-2 的补充句。

### I-5 锁定（S1）在编辑器内没有任何说明
- 证据：`EditorTab.tsx:36-37` readOnly 只切 Viewer；`MultiTabEditor.tsx:331-332,653` 的横幅只对 `activeTabGone` 渲染，锁定态无横幅；解释只在 E5（`DesktopStatusBar.tsx:93-101` 点开浮层）与 E6/E7 tooltip。
- 代价：用户从编辑态切到锁定看到"像阅读器但不知道怎么了"；而回收站有横幅 ⇒ 两个只读态解释成本不对等。
- 建议根位置：`MultiTabEditor.tsx` 横幅分支加 `readOnly && !deleted`（复用 `.tab-gone-banner` 原语 + 「解锁」按钮，数据 @@lockedNoteIds@@ / @@onToggleNoteLock@@ 已传入）。

### I-6 「冲突」一词被三个概念共用；且文档冲突会被绿色盖住
- 证据：(a) 文档内容冲突 `isConflict` → 状态栏「有冲突」error 红（`documentStatusModel.ts:33`），但 **historyCount>0 时改显示绿色「已同步，历史 N」**（`documentStatusModel.ts:31-32`）⇒ 有历史快照的冲突文档在状态栏是"健康色"；(b) 同步记录账本角标叫 `SyncConflictBadge` / @@.sync-conflict-badge@@（`SyncConflictBadge.tsx:1-7`、`syncConflictsPanel.css:5`），语义却是"未读同步记录"（`syncConflicts.ts:49-56`），颜色 accent 蓝；(c) 属性弹窗「有冲突副本」（`noteInfo.ts:57`）与浮层「已保留历史快照」（`SyncStatusPopover.tsx:239`）又是第三/第四说法。
- 代价：用户看到蓝色数字角标会以为是文档冲突，点开却是账本；真正有冲突的文档在状态栏可能显示绿色。
- 建议根位置：`documentStatusModel.ts:31-33` 把 `isConflict` 提到 historyCount 分支之前（冲突永远红，或红 + 「，有历史 N」后缀）；角标改名（`SyncConflictBadge` → SyncLedgerBadge，类名同步）或文案改成「同步记录未读 N」；「有冲突副本/历史快照」统一为一套说法。

### I-7 保存被拦（S7）只有 3 秒 notice，没有留痕
- 证据：`App.tsx:232` `showNotice("文档已在回收站中，编辑不会保存；恢复后才能继续写。")`；管线 `useSavePipeline.ts:102` 返回 `{ok:false, blocked:true}`；状态栏（E4）此时显示文档自身 saveState（通常 idle → 「已同步」或「仅本地」），**不显示"只读/被拦"**；错误横幅只接 `handleSaveError`（`useSavePipelineGlue.ts:47` → `App.tsx:1016` error-banner）。
- 代价：用户看到「已同步」却存不进去；notice 3 秒后消失，之后无持久解释（S2 有横幅兜底；S3/S4 是否也命中横幅取决于 deleted 标记，【推断】是，需实测）。
- 建议根位置：先按 I-5 把横幅分支做成「只读原因横幅」（S1/S2/S3/S4 共用），S7 复用同一横幅；状态栏在 blocked 时给一次 error 档或 notice 加「查看回收站」动作。

### I-8 S6 同步 warning：只计数、不列项、通用文案误导（详见 §5）
- 证据：`SyncStatusPopover.tsx:250-258`；`onOpenNote` 只在账本行使用（`:275`）；7 kind 无文案映射（`core/sharedTypes.ts:30-53`）。

### I-9 保存冲突对话框（S8）的 BEM 类名没有样式
- 证据：`SaveConflictDialog.tsx:30,32,36,39` 使用 @@.save-conflict-dialog@@ / @@__head@@ / @@__file@@ / @@__actions@@；`grep -rn "save-conflict-dialog" src --include=*.css` = **0 命中**。
- 代价：标题/文件行/动作行全走浏览器默认（h3/p 默认 margin），与 `.ln-dialog` 内距 + 0.5px 观感口径脱节；"写了钩子却没落样式"的残留。
- 建议根位置：`styles/app/dialogs.css` 加 3 条（head 色/字重、file 行 text-3 + 省略、actions 复用 .ln-dialog__actions 排布），或直接把 JSX 改用 ln-dialog 内件并删自定义类。

### I-10 非令牌/硬编码（核对结果）
- 已核【核实】：上述表面**颜色/字号全部 --lake-***（.tab-gone-banner / .tab-deleted-badge / .badge--* / .document-statusbar-state.* / .trash-* / .sync-status-* / .document-lock-popover 逐条读到令牌）。
- 例外 2 条：
  1) `styles/components.css:206` @@box-shadow: inset 0 0 0 .6px var(--lake-accent)@@ —— .6px 既非 0.5px 观感红线口径也无令牌；同文件其它描边均 0.5px 或令牌。
  2) `components/app/syncConflictsPanel.css:9-11` 角标 @@min-width/height/line-height: 12px@@、@@border-radius: 6px@@（6px 已有 `--lake-radius-xs` 可用）。
- 其余小几何（.badge 的 padding 1px 6px、.tab-deleted-badge 的 0 4px）属既有小件惯例，不算漂移。

### I-11 状态栏优先级让"存不了"的原因不可见
- 证据：`documentStatusModel.ts:25-29` 顺序 saving→dirty→save-error→cloud-deleted→…：S3 文档一旦有保存错误会显示「保存失败」而非「云端已删除（仅本地）」；S1 锁定时状态栏不提示"只读"，只在 E5 独立胶囊。
- 代价：与 I-7 叠加 ⇒ 用户最可能问的「为什么不能编辑/保存」在最显眼处答不上来。
- 建议根位置：同一函数把"只读原因"（cloud-deleted / 已锁定）提为独立档（或新增"只读"胶囊位与 E5 并列），不要塞进 saveState 优先级链。

---

## 5. 同步 warning：SyncStatusPopover 能力评估 + 最小改法

### 5.1 结论（先给答案）
**能列出 warning 的计数，但不能列出 warning 本身**：没有 code→人话映射、没有 title/filename、没有点击定位；单篇 apply 降级**能被计数看到**（已并入 SyncResult.warnings），但用户无法从浮层知道是哪篇、为什么、该如何处理。

### 5.2 数据链路（已具备，无需改协议）
1. core/应用层产出 `SyncWarning`（`src/core/sharedTypes.ts:43-53`）：字段 `{ kind, noteId?, title?, filename?, message }@@；
   `SyncWarningKind` 共 **7 种**（`sharedTypes.ts:30-41`）：@@remote_incomplete / asset_missing / local_body_missing / body_suspicious_external_change / local_body_restored / asset_kept_remote / asset_invalid_name@@。
2. 主进程并入结果：`electron/s3v3/desktopSync.ts:193-199` —— `r.warningDetails` + 单篇 apply 失败（`PlanWarning`，`desktopStoreAdapter.ts:88-98` 的 @@drainApplyWarnings@@）合并为 `SyncResult.warnings`（`src/lib/types.ts:240`）；apply 失败固定映射 `kind:"remote_incomplete"@@ 且带 `id/title/detail@@。
3. 渲染层读取：`getSyncStatus().lastResult`（`SyncStatusInfo`，`types.ts:577-581`）→ 浮层打开时写入 `lastResult`（`SyncStatusPopover.tsx:121-124`）→ `stats.warnings`。
4. 浮层入口：`onOpenNote@@ prop 已存在（`SyncStatusPopover.tsx:34`），目前**只被账本行使用**（`:275`）。

### 5.3 现状（唯一渲染点）
`SyncStatusPopover.tsx:250-258` 只有一个区块：
- 标题「同步有 N 项被跳过」；
- 正文「本地内容未改动，下次同步会重试；逐项原因见「设置 → 同步诊断」。」
- 无列表、无按钮（连「打开诊断」都没有；只能靠 footer 的「同步设置」自己找）。
- 逐项信息只在设置页「同步诊断」的**纯文本**里（`formatS3v3Diagnostics`，`core/s3v3Report.ts:265-303`：警告那行直接 join message，最多 8 条）。

### 5.4 缺口（对照任务要求：code + 人话 + 可点击定位）
| 要求 | 现状 | 证据 |
| --- | --- | --- |
| code 展示 | 无（kind 字符串不进 UI，只进诊断文本） | @@sharedTypes.ts:30-41@@ vs 浮层代码 |
| 人话文案 | 只有一句通用文案，且「下次同步会重试」对 3 类不成立（见下） | @@SyncStatusPopover.tsx:255@@ |
| 可点击定位 | 无（@@onOpenNote@@ 已接好但未用） | @@SyncStatusPopover.tsx:34,275@@ |
| 区分严重度 | 无（7 kind 一律"被跳过"） | @@sharedTypes.ts:30-41@@ |
| apply 单篇降级可见 | 只进计数 | @@desktopSync.ts:193-199@@ |

「下次同步会重试」不适用的 3 类：
- `asset_invalid_name`（文件名非法 ⇒ 永远重试失败，需改名）；
- `local_body_missing`（本机正文缺失 ⇒ 重试也不会好，需历史/云端恢复）；
- `body_suspicious_external_change`（正文疑似被外部改坏 ⇒ 已停止上传并留历史，需人确认）。
另 `local_body_restored` 是"已自动恢复"，被归到"被跳过"也不准确。

### 5.5 最小改法（不改数据链路、不改协议）
**落点 1（新文件，单一来源）**：`src/core/syncWarningText.ts`
- `export const SYNC_WARNING_KIND_TEXT: Record<SyncWarningKind, { label: string; hint: string; retryable: boolean }>@@，建议文案（7 条，简洁、无中点）：
  - remote_incomplete：「远端内容不完整」/「已跳过这篇，本地内容未改动；下次同步重试」/ retryable=true
  - asset_missing：「附件在云端缺失」/「已跳过该文件；其它内容照常同步」/ true
  - local_body_missing：「本机正文文件缺失」/「未上传空正文；请从历史或云端恢复」/ **false**
  - body_suspicious_external_change：「正文疑似被外部改坏」/「已停止上传并保留历史；确认后再编辑」/ **false**
  - local_body_restored：「已从云端恢复正文」/「本机缺失的正文已拉回，可直接继续」/ true（信息类）
  - asset_kept_remote：「附件读不出」/「已保留云端声明，避免误删云端附件」/ true
  - asset_invalid_name：「文件名不合法」/「已跳过该文件；改名后下次同步」/ **false**
- `export function syncWarningTitle(w: SyncWarning): string@@（title → filename → noteId 截断 → 「未知条目」）；
- `export function syncWarningsSummary(rows: {kind}[])@@（「N 项被跳过（可重试 X，需处理 Y）」）。
- 纯函数、无 UI 依赖（与 `core/noteInfo.ts` 同姿势）；两端将来都能用。

**落点 2（改 1 段）**：`src/components/app/SyncStatusPopover.tsx:250-258`
- 把区块换成：标题（@@syncWarningsSummary@@）+ 列表（最多 5 行，按 retryable 排序：需处理在前）+ 「另 N 条见同步诊断」按钮（打开设置诊断，复用现有 `onOpenSettings@@ 或新增 `onOpenSyncDiagnostics@@）。
- 每行：kind 图标（TriangleAlert 需处理 / Info 可重试）+ `syncWarningTitle(w)@@ + label；行用既有原语（`.ln-row` 或 @@.ln-menu__item`，不新造样式）。
- `w.noteId && onOpenNote@@ 时行可点 → `onOpenNote(noteId)@@（prop 已存在，签名现成）。
- 删掉「下次同步会重试」绝对句，改用 §5.5 的分组摘要。

**护栏**：`src/core/syncWarningText.test.ts`（7 kind 全覆盖、每条有 label/hint、文案不含中点「·」、title 回退顺序）；`SyncStatusPopover.render.test.tsx` 增 1 例（有 warnings 时渲染 ≤5 行且点击行调用 @@onOpenNote@@ / 无 noteId 行不可点）。

**影响面**：新增 1 文件 + 改 popover 1 段 + 2 测试；@@electron/s3v3/desktopSync.ts@@ / core 协议**不动**（数据已带全字段）。

---

## 6. 最小改法建议（按性价比排序）

**P0（便宜、直接消除歧义；都是"改落点"而非补丁）**
1. I-6(a)：`documentStatusModel.ts:31-33` 冲突优先于 historyCount，让「有冲突」永远是红档（或红 + 「，有历史 N」）。
2. I-3：`syncConflicts.ts:26` 的中点改「（仅本地）」。
3. I-1：`styles/app/dialogs.css` 的 .tab-deleted-badge 改 pending 三件套（与横幅/状态栏一致），并在 CSS 头注释写明红/琥珀的语义分工。
4. I-10(1)：`styles/components.css:206` .6px → 0.5px（或与 --lake-focus-ring-width 同口径的令牌）。

**P1（体验缺口，需少量 JSX）**
5. I-5 + I-7：@@MultiTabEditor.tsx@@ 的横幅分支扩成「只读原因横幅」（S1/S2/S3/S4/S7 共用，按 kind 换第二句 + 动作按钮：解锁 / 打开回收站 / 恢复要求）；复用 .tab-gone-banner 原语，不新造样式。
6. §5.5：warning 列表化（含 onOpenNote 定位）。
7. I-1/I-2 延伸：E2 徽标按 S3/S4 分支（tab badge 文案「已删除 / 云端已删」两档或用不同色），需要先把 cloudDeleted/purged 透传到 @@TabInfo@@。

**P2（小样式/清理）**
8. I-9：给 .save-conflict-dialog__* 落样式，或改用 ln-dialog 内件。
9. I-2/I-10(2)：角标几何令牌化/加注释。
10. I-8：浮层「同步设置」footer 增加直达诊断的入口（当前只能去设置里找）。

---

## 7. 明确不做项

1. **不把「同步记录」与「文档冲突」合并成同一 UI/同一入口**：账本是审计事件流（可 ack、可恢复），文档冲突是文档状态（内容事实）；合并会丢"最近覆盖过什么"的审计价值。只统一措辞、不给同一个角标。
2. **不新造全局 banner/notice 组件**：.tab-gone-banner 已是本仓既有的"只读原因横条"原语（思源式提示条语言），扩分支即可；新组件会变成第二套横幅。
3. **不改回收站数据结构/协议**（S3/S4 判定已在 core 定稿）；本报告只动展示。
4. **不给锁定态加"伪只读"整页遮罩**：Viewer 已是真只读，缺的只是一句解释与出口（P1-5），不要用遮罩破坏阅读。
5. **不把 warning 明细全量塞进浮层**：浮层只列前 N 条 + 诊断入口；全量文本在设置页复制（既有设计）。

---

## 8. 需用户裁决

1. **回收站类统一琥珀，还是保持标签徽标红色？** 推荐统一琥珀（红留给"需处理/失败"）；若用户偏"删除必须醒目"，则反过来把横幅也改红——**二选一，只改一处来源**。
2. **锁定态解释条放编辑器顶部（占 ~27px 高）还是只增强状态栏锁胶囊？** 推荐放顶部（与回收站一致的解释位置，且解锁按钮顺手）；若担心占高，则增强 E5 浮层文案并保持不占高。
3. **warning 是否允许浮层直接列 5 条？** 推荐允许（否则"apply 单篇降级要能被看到"仍只能靠去设置）；若担心浮层膨胀，可只列「需处理」类（3 kind），可重试类只给计数。
4. **I-2 的 S3/S4 透传**：需要 App 把 @@cloudDeletedNoteIds@@ / purged 标记并入 tab 状态（新增字段），是否接受在 R1 内做？（属"补数据到 UI"，不涉协议。）

---

## 附录 · 证据与复核命令

`bash
cd <仓库根>
# 6 个表面的关键代码
rg -n "tab-deleted-badge|tab-gone-banner|activeTabGone" src/features/editor/
rg -n "云端已删除|已被他端删除|正文已删|N 天后清除" src/components/app/TrashPanel.tsx
rg -n "cloud-deleted|有冲突|已同步，历史|保存失败" src/components/model/documentStatusModel.ts
rg -n "已锁定|锁定（只读）|解锁当前文档" src/components/app/DesktopStatusBar.tsx src/components/app/sidebar/ src/desktop/DesktopOverlays.tsx
rg -n "同步有 .* 项被跳过|warnings" src/components/app/SyncStatusPopover.tsx src/lib/types.ts
rg -n "SyncWarningKind|interface SyncWarning" src/core/sharedTypes.ts
# 令牌核对
rg -n "status-error|status-pending|status-ok" src/styles/app/dialogs.css src/styles/components.css src/styles/chrome.css
# 非令牌例外（应各只 1 处）
rg -n "inset 0 0 0 .6px" src/styles/components.css
rg -n "min-width: 12px|border-radius: 6px" src/components/app/syncConflictsPanel.css
# 「保存冲突对话框」类名是否有样式（当前应为 0）
rg -n "save-conflict-dialog" src --include=*.css
`

> 复核提示：本报告只读；改任何一条时请按 AGENTS §3#14 的"改落点"执行——颜色/字号/圆角只动 themes/kit/对应层，不新增第二套；改完跑 @@node scripts/ui-metrics.mjs + src/styles/cssLayers.test.ts@@，动到视觉档位时按 §3#21② 只跑受影响态快照。
