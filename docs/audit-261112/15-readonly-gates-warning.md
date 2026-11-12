# 15 · 只读门禁（isGoneNote）与同步 warning 通路

> 只读审计（未改任何产品代码；本文件是唯一写入）· 2026-11-12 · 基线 = **HEAD `c418186b`**。
> 工作树另有 **task-44 的在途修复**（`git status` 见附录 A）：`electron/noteContentRepository.ts`、`electron/s3v3/*`、`src/core/s3v3/{plan,state}/*`、`src/mobile/v3/{sync,mobileDeviceStore,mobilePlatformPort}.ts` 等；本文凡涉 apply warning 处均标注 **HEAD / 工作树** 两种状态。
> 背景：真实 S3 P0 的根因是「**用户级守卫下沉到共用写函数**」（写路径越界，详见 `docs/audit-261112/13-write-guard-sweep.md`）。本文回答三个问题：① 打开入口是否都先判 gone；② 只读态三类文案是否一套；③ apply 降级 warning 有没有出口。

---

## 0. 方法与口径

- 手段：源码通读 + `git show HEAD:` 对照工作树 + `grep` 全量枚举；**未跑 App/设备、未跑真实 S3、未改代码**。
- 判定口径（严格按 AGENTS §3#16）：打开入口合规 = 在**第一次可写操作之前**已有 gone 判据，且用户可感知三件事：**只读宿主 + 横幅 + 保存被拦要明说**。只做其中一两件 = 部分合规。
- "类比 F04 的第二处" 判定口径 = 共用写/共用读函数里夹带**用户语义策略**（某个入口才该有的拒绝/放行），导致其它调用方被静默改变语义。
- 证据标记：**[核实]** = 本次读过对应源码；**[推断]** = 结构推理、未运行时验证。

---

## 1. 一页结论

| 问题 | 结论 | 关键证据 |
| --- | --- | --- |
| ① 打开入口 gone 判据 | **桌面：合规（单一 funnel）**；**移动：主路径合规，但存在 2 处判定缺口（M1 入口漏判 / M2 共用写放行）+ 1 处判据完全不生效（M3 编辑锁）** | 桌面 `useTabLifecycle.ts:67-91,94,111-124,177-188`；移动 `MobileApp.tsx:707-712`；缺口见 §3 |
| ② 三类只读文案是否一套 | **不是**。回收站 4 处文案、云端已删除 6 处（两种标点：`（仅本地）` vs `·仅本地`）、编辑锁 4 处桌面 + **移动 0 处**；无统一「只读原因」模型 | §4 矩阵 |
| ③ apply 降级 warning 出口 | **HEAD 无降级**（单篇失败=整轮失败）；**task-44 新增了降级与结构化出口**，但桌面无逐项展示（只有计数）、诊断报告未纳入、移动未持久化且**复用 `remote_incomplete` 语义会让文案说谎** | §5 |
| 是否发现 F04 同类第二处 | **发现 1 处（移动小记保存）**：共用保存函数无条件清 `deleted_at` + 删墓碑 ⇒ 陈旧编辑器保存可**静默复活已删小记**（并撤销他端删除），且绕过恢复标记 | `src/mobile/data/quickNotesRepository.ts:240-245`；需裁决（§7） |

---

## 2. ① 桌面打开入口 × 判据（全部 funnel 到一处）[核实]

桌面唯一的 tab 构造器 = `openTabFromNote`（`useTabLifecycle.ts:67-91`），其中 `deleted: isGoneNote(note)`（`:83`）；`openNote`（`:94`）与 `restoreTabs`（`:177-188`，重启恢复标签）都走它 ⇒ **"打开即判定"单一来源**。已存在的 tab 在 `existing.deleted` 时会重读落库状态再重算（`:111-124`）；同步期间由 `useSyncRefresh.ts:103` 重算。

| 入口 | 触发 | 路径 / 判据 | 结论 |
| --- | --- | --- | --- |
| 目录树行 / 置顶 / 搜索命中（文档） | 单击 | `App.tsx` onSelect → `openNote` → `openTabFromNote:83` | ✅ |
| 同步记录「打开笔记」 | 点击 | `App.tsx:942` → `openNote` | ✅ |
| 文档引用卡（noteRef）「访问」 | 点击 | `noteRefCard.tsx:290,328` → host `openNote`；卡片自身按 `isNoteRefGone`（`noteRef.ts:80`）标失效 | ✅（判据与打开同源） |
| 日记页 / 日记 tab / 年历「今天」 | 点击 | `App.tsx:1185,1242,1289,594` → `openNote(...,"diary")` | ✅ |
| AI 写作「已生成文档 → 打开」 | 点击 | `AiWritingWorkspace.tsx:121` → `onOpenNote` → `openNote` | ✅ |
| 小记转文档后的打开 | 自动 | `App.tsx:566,571` → `openNote` | ✅ |
| 重启恢复标签 / 启动自动打开 | 自动 | `restoreTabs:177` / `useBootstrap` → `openTabFromNote:83` | ✅ |
| 回收站 / 历史 / 文档属性 / 标签空间预览 | 单击 | 只读预览（显式例外：`NoteDocPreview` / `HistorySnapshotPreview`），恢复是显式动作 | ✅ 例外 |
| **小记（桌面）**：列表卡编辑 / 标签空间编辑 / 搜索命中 | 单击 | 无 gone 判据；靠**列表投影/搜索在 SQL 层过滤**（`electron/searchRepository.ts:159,197,210` 排除 trashed；小记列表 `quickNotes/index.ts:185-194` 带 `deletedAt` 供 UI） | ⚠️ 上游过滤（见 §3-W2 的共享写风险） |

**只读态三件套（桌面，gone 时）**：
- 只读宿主：`MultiTabEditor.tsx:688/702/720/734/747` `readOnly={locked || tab.deleted}` → `EditorTab` 重建为 Viewer；
- 横幅：`MultiTabEditor.tsx:653-658` `.tab-gone-banner`「该文档在回收站中：只读、编辑不会保存。需要继续写请先恢复。」+ 标签徽标 `TabItemVisual.tsx:37`；
- 保存被拦明说：`useSavePipeline.ts:102` 返回 `{ok:false,blocked:true}` → `App.tsx:232` `showNotice("文档已在回收站中，编辑不会保存；恢复后才能继续写。")`。
⇒ **桌面合规**（三件齐全）。

---

## 3. ① 移动打开入口 × 判据 + 缺口清单 [核实]

主路径：`MobileApp.tsx:707-712` 先 `bridge.noteGoneState` → `isGoneNote` ⇒ **Q04B 语义**：不拒绝打开，而是 `setTrashPreviewId(id)` 进 `TrashPreviewPage`（只读预览 + 显式恢复）。该页横幅 `TrashPreviewPage.tsx:74-76`「只读预览：该文档在回收站，编辑与保存会被拦截…」+ `LakeEditor mode="viewer" interaction="preview"`（`:88-96`）⇒ 三件齐全 ✅。

| 入口 | 触发 | 路径 | 结论 |
| --- | --- | --- | --- |
| 文档树 / 搜索（文档）/ 首页置顶 / 引用卡 / 同步记录「打开笔记」 | 点击 | → `openNote`（`MobileApp.tsx:707`） | ✅ |
| 回收站文档预览 / 恢复 | 点击 | 同上 → `TrashPreviewPage` | ✅ |
| **日记条目 / 年历 / 「今天」** | 点击 | `DiaryPage.tsx:117,152` → `MobileApp.openDiaryEntry`（`:743`）→ `setRoute({kind:"notebook", initialNoteId})`，**不经 `openNote` / 无 isGoneNote** | ❌ 缺口 M1 |
| 小记卡编辑 / 标签详情编辑 / 搜索命中 → 首页定位 | 单击 | 首页/标签/搜索的**列表与搜索 SQL 已过滤**（`quickNotesRepository.ts:130`、`quickNotesSearch.ts:117,186`）⇒ 正常情况打不开已删小记；**但保存路径会复活**（见 M2） | ⚠️ M2 |
| 编辑锁（桌面锁定的文档） | 打开 | `isEditLocked` 只在数据层出现（`mobile/v3/mobilePlatformPort.ts:187,374-379`、`bridge/notes.ts:155`），`MobileApp`/`notebook`/`editor`/`ui` **0 处消费** | ❌ 缺口 M3 |

### M1【P1｜漏判】移动日记入口绕过 gone 判据

- 证据：`src/mobile/MobileApp.tsx:743-751`（`openDiaryEntry` 直接 `setRoute`）；`src/mobile/diary/DiaryPage.tsx:117,152`（`mode:"editor"` / `"viewer"`）；`src/mobile/notebook/useWorkspaceSession.ts` **无任何 gone/trashed 判断**（其保存走 `bridge.saveNote`，`bridge/notes.ts:89-99` 才拒绝）。
- 用户可见后果：某天日记文档在桌面被删除（进回收站）后，手机「日记」页点该天 → 进入**正常编辑工作区**（不是回收站预览），没有横幅/只读标记；用户编辑后保存，只得到一条错误 toast「笔记已在回收站或已被删除，保存被拒绝；请先显式恢复」——**判据放在了写函数而不是打开入口**，正是 §3#16 与 F04 同一形状的"下游兜底"。
- 复现：桌面把 2026-11-10 日记文档移入回收站 → 手机打开 App → 日记页点 11-10 → 工作区可编辑（顶栏无标记）→ 输入并保存 → 弹错误 toast，内容与结论均不落在"这篇被删了"的预期上。
- 修复方向（不改代码，落点建议）：`openDiaryEntry` 复用 `openNote` 的前置判据（或抽 `guardOpenNote(id)` 单一入口供两者共用）；命中 gone 时 `setTrashPreviewId(id)` 走同一只读预览页。

### M2【P1｜F04 同类第二处】移动小记保存会静默「复活」已删小记

- 证据：`src/mobile/data/quickNotesRepository.ts:240-245` —— 共用保存函数 `persistQuickNoteContent` 的 upsert 里 **无条件** `deleted_at=NULL`、并 `DELETE FROM quick_note_deleted WHERE id=?`（注释写明「活跃写入统一清删除墓碑」）。该函数被 **三个**保存 API 共用（`:265,296,311` → `bridge/quickNotes.ts:80-140`），即所有「用户编辑既有小记」的路径。
- 语义后果：① 小记在打开编辑后被（本机回收站 / 他端）删除 ⇒ 保存直接把行复活，**没有恢复标记 `restore_pending_at`**（AGENTS §3#4 的唯一显式例外被绕过），也删掉了删除墓碑 ⇒ 下一轮同步会把它当活跃条目重新发布，**他端的删除被撤销**；② 与 AGENTS §3#3「删除压编辑」相反（文档路径是"删除压编辑 + 强制历史"）。
- 对照：桌面同一场景不会复活 —— 小记 `UPDATE` 不触碰 `deleted_at`（`electron/quickNotes/savePipeline.ts:150-152`）；若行已不存在则 `updateQuickNote` 先 `readRow` 抛 NotFound（`:63-66`）。⇒ **两端语义相反**。
- 复现（推断，需真机/双端确认）：A 手机编辑某小记不保存 → B（桌面）把这条小记移入回收站并同步 → A 点保存 → 该小记在 A 回到列表（未显式恢复），同步后 B/云端重新出现。
- 判定：这是"共用写函数夹带用户语义（活跃写入优先）"的越界，与 F04 同形但方向相反（F04 是守卫下沉导致整轮卡死；这里是"放行下沉"导致删除被撤销）。**修法涉及删除 vs 编辑语义 ⇒ 需用户裁决（§7-Q1）**，不建议审计人自定。

### M3【P1｜判据不生效】移动端完全不消费编辑锁（isEditLocked）

- 证据：`isEditLocked` 在 `src/mobile` 仅出现在数据/同步层（`v3/mobilePlatformPort.ts:187,374-379` 写入 `notes.is_locked`；`bridge/notes.ts:155` 建文档默认 false），**UI 层 0 处读取**。桌面则完整：`hooks/desktopDerivedState.ts:82` `lockedNoteIds` → `MultiTabEditor` `readOnly`（`:688` 等）+ `DesktopStatusBar.tsx:61-78` + 侧栏锁标识。
- 后果：桌面锁定的文档在手机上可正常编辑与保存（同步层不会拦），且界面无任何「已锁定」标识（只有「属性」抽屉的状态行 `core/noteInfo.ts:57` 会拼出「，已锁定」，属于**事后信息**）。
- 复现：桌面锁定某文档 → 手机打开 → 可编辑并保存成功（两端 `is_locked` 数据仍在，但移动 UI 不消费）。
- 修复方向：`openNote` 读 `noteGoneState/readNote` 时一并取 `isEditLocked` → 按 gone 同一形态进「只读 + 横幅」；或最小方案：工作区 `editing` 初值置 false + 顶栏锁标记。判据来源复用 `core/noteInfo` 已有的 locked 语义，不新造。

### M4【P2｜边界】移动回收站只读预览只覆盖 doc

- `TrashPreviewPage.tsx:80-90`：`kind !== "doc"` 时只给「该类型暂不支持在移动端预览」；usheet/bitable/board/ink 的回收站文档**没有只读预览**，但有显式「恢复」（安全，不丢数据）。属已知差距（02 报告 §1.2 M3）；Q03 只要求 doc，记录不作为缺口。

---

## 4. ② 只读态三类横幅/文案：不是一套 [核实]

### 4.1 矩阵

| 语义 | 桌面 | 移动 | 文案变体 |
| --- | --- | --- | --- |
| **回收站 / 已删除**（打开中） | `MultiTabEditor.tsx:653-658` `.tab-gone-banner`；`TabItemVisual.tsx:37` / `MultiTabEditor.tsx:542,552,634` `.tab-deleted-badge`（title）；同步到点提示 `useSyncProgress.ts:181-190` | `TrashPreviewPage.tsx:74-76` `.mobile-status-msg`（整页） | 至少 **4 句**：「该文档在回收站中：只读、编辑不会保存。需要继续写请先恢复。」/「文档在回收站中：只读、编辑不会保存，恢复后才能继续写」/「N 个打开的文档已被删除（已移入回收站）」/「只读预览：该文档在回收站，编辑与保存会被拦截；点右上角「恢复」后可继续编辑。」 |
| **云端已删除·仅本地** | `TrashPanel.tsx:65,371` badge；`documentStatusModel.ts:28-29`（状态栏 label）；`core/noteInfo.ts:57`（属性）；`syncConflicts.ts:26`（同步记录） | `TrashList.tsx:98` badge；`TrashPreviewPage.tsx:72` 横幅 | **6 处、两种标点**：`云端已删除（仅本地）`（5 处） vs `（云端已删除·仅本地）`（`syncConflicts.ts:26`，与 AGENTS/docs 用「·」一致） |
| **编辑锁** | `DesktopStatusBar.tsx:61-78` chip「已锁定」+ `:101-110` popover「本文档已锁定（只读）」；侧栏 `Sidebar.tsx:107` / `SidebarPinnedSection.tsx:109` tooltip「已锁定（只读）」；顶栏菜单 `DesktopOverlays.tsx:169`「锁定当前文档（只读）」 | **0 处**（M3） | 桌面 4 处措辞近似但不统一（有「已锁定」「本文档已锁定（只读）」「已锁定（只读）」） |

### 4.2 判定

- **不是一套**：三类状态由三套独立数据源驱动 —— `tab.deleted`（bool，来自 isGoneNote）、`cloudDeletedNoteIds`（`desktopDerivedState.ts:84`）、`lockedNoteIds`（`:82`），没有「只读原因」的统一模型；现有 `components/model/documentStatusModel.ts` 只覆盖 cloud-deleted，**不含 trashed / locked**。
- 用户可见后果：同一篇文档在不同界面收到不同措辞；「仅本地」与「·仅本地」两种标点混用；移动端锁完全无提示。
- **收敛建议（不改代码）**：新增 `src/core/capabilities/readonlyReason.ts`（纯函数：由行字段 `trashedAt/isPurged/cloudDeleted/isEditLocked/bodyMissing` → `ReadonlyReason`）＋一张文案表（两端口径各自渲染，**样式不共享**）；先只让 ①②③ 的**判定与文案**同源，组件仍各端自有（符合 AGENTS §3#14）。落点与验收见 §6-B。

---

## 5. ③ 同步 warning 通路

### 5.1 现状（HEAD，c418186b）

| 层 | 事实 | 证据 |
| --- | --- | --- |
| core 计划 | 计划级 warnings 已有（`remote_incomplete` / `conflict_kept_history` 等），并入 `runSyncRound.warnings` | `src/core/s3v3/plan/plan.ts:90,148,184,269`；`commit/runSyncRound.ts:84,107` |
| core apply | **单篇失败不降级**：整轮 `throw`（`saveState 失败(id)`）⇒ 设备可能永久卡死（13 报告 G1/G3） | HEAD `src/core/s3v3/state/deviceStore.ts:619` |
| engine 结构化 | `S3v3SyncReport.warningDetails: SyncWarning[]`（asset/body 类） | `src/core/s3v3Engine.ts:88-91,196,230,340` |
| 桌面出口 | HEAD 只把 `r.warningDetails` 放进 `SyncResult.warnings` | HEAD `electron/s3v3/desktopSync.ts:190` |
| 桌面展示 | `SyncStatusPopover.tsx:250-257` 只显示**计数** + 「逐项原因见设置→同步诊断」；读数来自 `getSyncStatus().lastResult`（`:79,123`），落盘 `device_state.last_sync_result`（`electron/main.ts:205` → `syncReconciliation.ts:428`）⇒ 重启后仍可显示计数 | 同左 |
| 桌面诊断 | 设置→同步诊断 = 最近 3 轮 `sync_v3_reports`（`useSettingsPanelScope.tsx:202-206,506`、`SyncSection.tsx:122-135`）；报告里的 `warnings` 仅来自 `r.warningDetails` | HEAD `desktopSync.ts:203` |
| 移动出口/展示 | `bridge.syncNow` 返回 `warnings: v3.warningDetails`（`mobile/bridge/sync.ts:452,468`）→ `useSyncSettingsForm.ts:15,62` 存内存 → `SettingsDrawer.tsx:521-532` 逐项展示；**「上次同步」`syncStatusStore` 字段无 warnings**（`:14-30`）⇒ 重启即丢 | 同左 |

### 5.2 工作树（task-44，未提交）：apply 降级 + 结构化出口

- core：`src/core/s3v3/state/deviceStore.ts:673-681` 单篇 apply 失败改为 **记 warning 后 `continue`**（不再抛整轮）；`deps.onApplyWarning`（`:169,677`）。
- 桌面：`desktopStoreAdapter.ts:88-96` 收集 + `desktopSync.ts:177-178` 日志、`:193-201` **并入 `SyncResult.warnings`（`kind:"remote_incomplete"`）**。
- 移动：`mobile/v3/mobileDeviceStore.ts:107-115` + `mobile/v3/sync.ts:66-71` 并入 `report.warningDetails`（同样复用 `remote_incomplete`）。
- ⇒ task-44 合入后：**桌面 popover 会多出「N 项被跳过」计数**、**移动设置页会多出逐项条目**。

### 5.3 缺口（W1–W4）

| # | 缺口 | 证据 | 用户可见后果 |
| --- | --- | --- | --- |
| W1 | **kind 语义复用**：apply 失败（本地写失败、已跳过）复用 `remote_incomplete`（原义"远端缺对象/资源"）。移动端该 section 的固定说明是「远端缺少对象/资源或文件名不合法的条目已跳过；**本地内容未改动**」 | `core/sharedTypes.ts:30-42`；`mobile/v3/sync.ts:69`；`SettingsDrawer.tsx:521-525` | 用户读到「远端缺资源/文件名不合法」「本地内容未改动」，而真实原因是"本地写失败、这篇没落地"。**新的用户级误导**（正是本批要防的类型） |
| W2 | 桌面**无逐项出口**：popover 只给计数；诊断报告 `warnings` 用的是 `r.warningDetails`，**不含 task-44 的 applyWarnings**（`desktopSync.ts:213`） | 同左 | 桌面用户只能看到"N 项"，看不到"哪一篇、为什么"；排障只能翻主进程日志（`:178`） |
| W3 | 移动 warning **不持久化**：`syncStatusStore` 无 warnings；「上次同步」行只看 ok/message/细分 | `mobile/sync/syncStatusStore.ts:14-30`、`useSyncSettingsForm.ts:17,62` | 重启/重进设置页后，跳过项列表消失（只剩「上次同步」结果行）；用户无法回顾 |
| W4 | 桌面 §5.1 的计数**只覆盖 `warningDetails` 的类别**；plan-level `warnings`（一行式）里若有未结构化项（如"上传失败"），只进日志不进 UI | `desktopSync.ts:175`（HEAD :175 / WT :178）与 `:190` 的差集 | 少数类别静默（不新增，但与"同步要看得见"不一致） |

> 补充（非缺口）：warning 的**下次重试**语义成立 —— apply 跳过不推进基线，下一轮重新计划（`deviceStore.ts:673-681` 注释）。数据不会因 warning 丢失。

---

## 6. 建议处置（不改产品代码，仅给落点与验收）

**A. 打开入口判据（补 M1/M3）**
- A1 `MobileApp.openDiaryEntry`（`:743`）复用 `openNote` 的前置判据：抽 `guardOpenNote(id): {gone, isEditLocked}` 单函数，`openNote`/`openDiaryEntry` 共用；gone ⇒ `setTrashPreviewId`。验收：新增 render/逻辑测试「日记文档在回收站 ⇒ 打开落 TrashPreviewPage」，并跑 `src/mobile/trash/*.test`。
- A2 同函数返回 `isEditLocked`；M3 最小实现 = 工作区 `editing` 初始 false + 顶栏锁标识 + 保存前置说明（复用 `core/noteInfo` 文案）。验收：桌面锁定文档在移动端打开 ⇒ 默认只读且有「已锁定」。

**B. 只读文案收敛（§4）**
- B1 新增 `src/core/capabilities/readonlyReason.ts`（纯函数 + 文案表单一来源，含标点规范「·仅本地」）；先让 ①②③ 的判定与文案同源，组件仍两端自有。
- B2 移动端补锁的只读横幅（与 B1 同表）；桌面三处锁文案收成同表引用。
- 验收：`readonlyReason.test.ts` 表驱动（6 种组合），并加一条源码断言「三类文案不再出现第二套字面量」。

**C. warning 通路（W1–W4）**
- C1（先做，最小）新增 `SyncWarningKind` = `apply_skipped`（`core/sharedTypes.ts`），task-44 两端改用它；移动 `SettingsDrawer` 文案按 kind 分派（`apply_skipped` ⇒「本地写入失败、已跳过，下轮重试；本轮其它条目已正常同步」）。
- C2 桌面诊断报告纳入 applyWarnings：`desktopSync.ts:213` 改为 `warnings: [...r.warningDetails, ...applyWarnings.map(...)]`（与 :193-201 的合并保持同一映射函数，避免两处漂移）。
- C3 桌面 popover 增加"查看逐项"入口（复用现有诊断弹窗/复制诊断，不新增浮层种类）。
- C4 移动 `syncStatusStore` 增 `warnings: Array<{kind, noteId?, title?}>`（只存摘要，上限 20 条），「上次同步」行显示「N 项被跳过」并可展开；不动 `bridge.syncNow` 的写入点唯一性。
- 验收：两端各一条「apply 跳过 → 结构化 warning → UI 可见（含重启后）」测试；kind 映射表测试。

---

## 7. 需用户裁决

| # | 事项 | 选项 | 推荐 | 代价 |
| --- | --- | --- | --- | --- |
| Q1 | 移动小记「陈旧编辑器保存 vs 已删」（M2） | A 维持现状（编辑压删除，静默复活）/ B 保存前判 deleted_at/purged ⇒ 结构化拒绝并提示「这条小记已被删除」/ C 按「显式恢复」语义：保存时写 `restore_pending_at` 再复活 | **B** | B 与 AGENTS §3#3「删除压编辑」一致，但会让「编辑到一半被删」的用户丢当前输入（提示后可从输入框复制）；C 是折中但引入"保存=隐式恢复"，违背 §3#4「恢复是唯一显式例外」 |
| Q2 | 移动编辑锁语义（M3） | A 只读 + 横幅 / B 允许编辑并提示"桌面已锁定" | **A** | A 与桌面一致；B 等于锁无意义 |
| Q3 | apply 跳过是否要让用户"逐项看见" | A 计数 + 诊断复制（现状式）/ B 逐项列表（桌面/移动） | **B（至少移动）** | B 需要新增 kind + 持久化摘要（C1/C4），约 1 天；A 保持最小但排障依赖日志 |
| Q4 | 「云端已删除·仅本地」标点统一为「·」还是「（）」 | A 统一「·」（与 AGENTS/文档一致）/ B 统一「（）」 | **A** | 纯文案，6 处；需同步 `documentStatusModel` 的 label 与 mobile 两处 |

---

## 附录 A · 复现命令（只读）

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
HEAD_SHA=$(/usr/bin/git rev-parse --short HEAD); echo "HEAD=$HEAD_SHA"

# ① 打开入口判据
grep -rn 'isGoneNote' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
grep -n 'openTabFromNote\|isGoneNote\|restoreTabs' src/hooks/useTabLifecycle.ts
grep -n 'noteGoneState\|setTrashPreviewId\|openDiaryEntry' src/mobile/MobileApp.tsx
grep -rn 'isGoneNote\|trashed\|gone' src/mobile/notebook src/mobile/editor | grep -v '\.test\.'   # 预期：无（M1 的证据）

# ② 只读文案
grep -rn '回收站中\|已在回收站\|只读预览' src/features/editor/*.tsx src/mobile/trash/*.tsx src/hooks/useSyncProgress.ts
grep -rn '云端已删除' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
grep -rn '已锁定' src/components/app/DesktopStatusBar.tsx src/components/app/Sidebar*.tsx src/desktop/DesktopOverlays.tsx
grep -rn 'isEditLocked' src/mobile --include='*.ts' --include='*.tsx' | grep -v '\.test\.'    # 预期：只有数据层（M3）

# ③ warning 通路（HEAD vs 工作树）
git show HEAD:src/core/s3v3/state/deviceStore.ts | grep -n 'saveState 失败\|onApplyWarning'
grep -n 'onApplyWarning\|查看本篇\|continue' src/core/s3v3/state/deviceStore.ts | head
grep -n 'applyWarnings\|warningDetails' electron/s3v3/desktopSync.ts electron/s3v3/desktopStoreAdapter.ts
grep -n 'warnings' src/components/app/SyncStatusPopover.tsx src/lib/types.ts src/mobile/sync/syncStatusStore.ts
grep -n 'warnings' src/mobile/bridge/sync.ts src/mobile/settings/useSyncSettingsForm.ts src/mobile/settings/SettingsDrawer.tsx

# 小记保存复活（M2）
sed -n '236,250p' src/mobile/data/quickNotesRepository.ts      # upsert 清 deleted_at + 删墓碑
sed -n '145,156p' electron/quickNotes/savePipeline.ts          # 桌面 UPDATE 不碰 deleted_at
```

## 附录 B · 未覆盖 / 下轮

- **task-44 未合入** ⇒ apply 降级的实际 UI 表现未实测（本文按 diff 判断；合入后需补「apply 跳过 ⇒ 两端可见」验收）。
- web 客户端（`electron/webApiServer.ts`）的打开/保存通道复用同一批 handler（与桌面同判据），未单独审计 UI。
- 小记单条快路径（`core/s3v3/quickPush`）的失败文案通路（F-04 已修）未并入本轮 warning 面。
- 历史恢复入口（`historyLifecycle`）是显式恢复，不在"打开即判"范围（13 报告 G16 已指出"回收站行不可达"）。
- 未跑设备门禁（只读纪律）；M2 的复活复现需双端实测确认（本文标 [推断]）。
