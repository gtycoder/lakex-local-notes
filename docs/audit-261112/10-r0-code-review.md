# 10 · R0 代码批次交叉复核（只读复核报告）

> 复核者：audit-preview（task-14 执行者）· 复核时间：**2026-11-12 12:42–12:48 CST**（工作区 108→109 个改动文件，仍在并行推进）
> 复核方式：**只读**看 `git diff` / 源码 / 运行相关测试与门禁；**未修改任何被复核批次的文件**。
> 复核对象：task-9（仓库卫生）、task-10（小记同步文案 + AI 作用域 + 死开关）、task-11（日期/kind/长按/常量）、task-12（桌面死声明 + 门禁 + 移动小项）。
> 口径：§3 每条给 file:line；「已核实」= 本次看代码或跑命令确认，「推断」= 结构推断未实机。

---

## 1. 结论（先看这段）

| 批次 | 结论 | 一句话 |
| --- | --- | --- |
| task-10 F-04 小记同步文案 | ✅ **通过** | 4 个理由从 core 一路透传到两端 UI，无折叠、无遗留旧值、单一文案来源 + 测试覆盖 |
| task-10 F-03 AI 作用域 | ✅ **通过** | 5 宿主全部带 data-note-id；选择器与「宿主存活」判据各一处；16 条新测试绿 |
| task-10 K14 IPC 第四面 | ✅ **通过（本批刚落地）** | ipcChannelParity.test.ts 增加 native.ts 包装侧提取器，preload↔native 双向全等 |
| task-11 K12 kind 私抄 | ✅ **通过**（14/14） | 清单内 14 文件 0 残留 kind 字面量；第 15 个（TagPreviewBody）由我 task-14 删除分支后自然消失 |
| task-11 K8 长按 | ✅ **通过** | InkPagesPanel 改用 createLongPressTimer，3 条长按/取消/吞 click 测试绿 |
| task-11 K2 日期单一来源 | ✅ **通过** | 6 处迁移 + 3 条 lint 测试；SettingsPanel 有登记豁免且注释说明 |
| task-12 桌面死声明 + 门禁 | ✅ **通过（待视觉门禁）** | 4 个文件删被压死声明 + kit 删 0 调用原语；ui-metrics 21/21、跨文件重复 66/66、cssLayers 3 tests 绿；**视觉快照未跑**（见 §5） |
| task-12 移动小项（M2-2/3） | ⏳ **未完成** | `--mb-radius-xl` 仍悬空、`mobile.html` 仍两处 theme-color（见 §3 F-2） |
| task-9 仓库卫生 | ✅ **通过** | 删脚本无 package.json 引用残留（0 missing）；.gitignore 与「内核已 vendored」矛盾已修 |
| 我 task-14 预览死路径 | ✅ **已完成** | 见 §4 |

**需修（都不阻塞发布，但建议 R0 内收掉）**：F-1（AI_DIALOG_GAP 双源，P2）、F-2（M2 两项未做，P2）。其余为观察项。

---

## 2. 逐批复核明细

### 2.1 task-10 · F-04「保存并同步」4 理由文案

**链路（已核实，全部串起来看）**

| 层 | 落点 | 结论 |
| --- | --- | --- |
| 词表 + 文案单一来源 | `src/core/quickNoteSyncTypes.ts:26-39`（`QuickNoteFullSyncReason` + `QUICK_NOTE_FULL_SYNC_TEXT`） | ✅ 4 个理由 = pipeline 真实集合；4 句互不相同 |
| 桌面适配层 | `electron/s3v3/desktopSync.ts:290`（`reason: result.reason`） | ✅ 不再折叠 |
| 移动适配层 | `src/mobile/bridge/sync.ts:213`（`reason: result.reason`） | ✅ 不再折叠 |
| 桌面 UI | `src/components/app/QuickNotesWorkspace.tsx:555-557`（`QUICK_NOTE_FULL_SYNC_TEXT[outcome.reason]`） | ✅ 取单一来源；remote-deleted 才收编辑态 |
| 移动 UI | `src/mobile/home/QuickNoteComposer.tsx:359-361`（同来源 + error 档） | ✅ 两端同一份文案 |
| 过期注释 | `QuickNotesWorkspace.tsx:540-544`、`quickNoteSyncTypes.ts:8-16` | ✅ 已改为单条快路径口径 |
| 护栏 | `src/components/app/quickNoteSyncGate.test.ts:35-81` | ✅ 钉词表、钉两端取同一来源、钉折叠值不再出现 |

- 全仓 `no-remote-manifest` 残留只剩注释与测试断言（已核实 grep），**运行期 0 处**。
- 实跑：`npx vitest run src/components/app/quickNoteSyncGate.test.ts src/core/s3v3/quickPush/pipeline.test.ts` → **15 tests passed**。
- 观察（P3，不建议现在动）：UI 文案进了 `core/`。仓里有先例（`core/cloudState.ts` 的 `cloudStateHint()`），且当前无 i18n 层 ⇒ 可接受；若以后引 i18n，记得把这些字符串一起收。

### 2.2 task-10 · F-03 AI 作用域

| 判据 | 落点 | 结论 |
| --- | --- | --- |
| 5 宿主统一带 `data-note-id` | `EditorTab.tsx:1019`、`UniverSheetEditor.tsx:656`、`BitableEditor.tsx:1060`、`BoardEditor.tsx:546`、`InkPad.tsx:1442` | ✅ 逐行 grep 确认 |
| 活动宿主选择器 | `src/features/ai/aiAssistantSession.ts:31` → `[data-active="true"][data-note-id]` | ✅ 与 `activeEditor.ts` 同属性族，不再绑 doc 类名 |
| 宿主存活判据（单一来源） | `aiAssistantSession.ts:41-47`（`EDITOR_HOST_SELECTOR` + `isNoteHostAlive()`） | ✅ 原 Dialog 里的私有 querySelectorAll 已改为调用它（`AiAssistantDialog.tsx:160-163`） |
| 护栏 | `src/features/ai/aiAssistantScope.test.ts`（16 tests） | ✅ 行为（5 宿主 × 作用域）+ 源码契约（5 宿主必须写 data-note-id）双覆盖 |

- 实跑：16 tests passed。
- 残余风险（推断）：`EDITOR_HOST_SELECTOR` 是「宿主类名清单」，新增第 6 种 kind 时需要改这一处 + 5 宿主处；测试的源码断言会红（好），但提醒「新增 kind 清单」目前仍散落在 `MultiTabEditor` 分派 + 本文件 + `HistorySnapshotPreview` 三处（与 06 报告 §1.3 同一结论，属 R0-4 护栏范畴，不是本批缺陷）。

### 2.3 task-10 · K14 IPC 第四面

- `electron/ipc/ipcChannelParity.test.ts:64-70` 新增 `nativeWrapperMethods()`（扫 `api().X(` / `host.X(`），`:120-135` 断言 preload 暴露 ↔ native 包装双向全等，事件订阅走显式 `PRELOAD_EVENT_SUBSCRIPTIONS`。
- 结论：✅ 实现与 261016 事故的教训一致（三方 + 第四面）。观察（P3）：`PRELOAD_EVENT_SUBSCRIPTIONS` 是手写清单，新增事件订阅必须登记（测试失败会明说，注释已写）。

### 2.4 task-11 · K12 / K8 / K2

**K12（kind 私抄）**：清单 14 文件全部 `import type { NoteKind }`，literal union 残留 = **0**（逐文件 grep 计数：missingBody / coldStartNote / sharedTypes / tagsModel / MultiTabEditor / desktopTypes / DesktopOverlays / DesktopStatusBar / TrashPreviewPage / useWorkspaceActions / saveConflictCopy / desktopDerivedState / lib/types / lib/native）。
- 另：`src/components/app/Sidebar.tsx:70`、`src/hooks/useTreeActions.ts:43` 仍有 `notebook | group | note | ...` 字面量 —— 这是 **CreateKind（树创建语义）**，不是 `NoteKind`，**不是漏迁**；建议在 06 报告里加一句注明，避免下一轮误判（P3）。
- 第 15 个文件 `features/tags/TagPreviewBody.tsx:20` 的 kind 字面量随我 task-14 删分支一并消失（见 §4）。

**K8（长按唯一实现）**：`src/features/ink/InkPagesPanel.tsx:20,133,204` 已改用 `createLongPressTimer({ ms: 300, moveCancelPx: 8 })` + `consumeClickSuppression()`；`inkPagesPanel.render.test.tsx` 新增「到点拖拽 / 吞 click / 8px 取消」3 条。实跑 **11 tests passed**。

**K2（日期单一来源）**：`src/lib/dateFormatUsage.test.ts`（3 tests）扫描桌面渲染层，禁 `toLocaleDateString/TimeString` 与 `new Date(...).toLocaleString`；6 处已迁移（SearchPanel / AssetsBrowser / DraftRecoveryDialog / RebuildDataBlock / DiaryWorkspace / tablePasteGuard）；`components/app/SettingsPanel.tsx` 在允许清单里且注释写明「迁移后可直接删行」。实跑 3 tests passed。

### 2.5 task-12 · 桌面死声明 + kit 死原语

- 删除范围（已核实 diff）：`styles/app/dialogs.css`（context-menu 被 kit 压死的 display/align/gap/font-size/border/background 等）、`shell.css`（create-menu 同款 + sidebar-floating/collapsed 被 shell 层压死的 height/box-shadow/z-index）、`tabs.css`（tab-switcher-menu 的 z-index:500 → 由 `.ln-overlay-surface` 的 `--lake-z-overlay-menu` 给）、`document-status.css`（synced-history 的 color/background → 由 `src/styles/chrome.css:67` 给）。
- `.create-menu` 在 JSX **0 消费者**（只有 `create-menu-wrap`），`.ln-modal*`/`.ln-drawer*` 在 JSX **0 消费者**（已核实 grep）⇒ kit.css 那 8 条死原语删除安全；kit 基线 708→674，各处基线同步下调并注明（`cssLayers.test.ts` diff）。
- 赢家抽查（已核实）：`.context-menu > button` 现在全部带 `ln-menu__item`（抽查 `TabContextMenu.tsx:38`）；`.ln-overlay-surface` 提供 z-index（`overlay.css:110-123`）；`.document-statusbar-state.synced-history` 视觉在 `chrome.css:67`。
- 门禁（实跑）：
  - `node scripts/ui-metrics.mjs` → 被上层压掉的声明 **21 / 基线 21**（新 shadowedDecls 门禁已生效，只许降）、跨文件重复 **66 / 66**、`!important` 9/9、移动 19/19、颜色字面量 0。
  - `npx vitest run src/styles/cssLayers.test.ts` → **3 tests passed**。
  - CI 已挂 `ui-metrics`（`.github/workflows/pr.yml:47`）⇒ 新门禁不会漏跑。

---

## 3. 发现（需处理的按 P 排序）

### F-1【P2｜单一来源】`AI_DIALOG_GAP` 现在有**两份定义**

- 事实（已核实）：`src/features/ai/aiLayout.ts:12` `export const AI_DIALOG_GAP = 8;`，而 `src/features/ai/AiAssistantDialog.tsx:35` **仍然** `export const AI_DIALOG_GAP = 8;`，且该组件自己在 `:247` 用本地那份；`SelectionToolbar.tsx:30` 用 aiLayout 那份。
- 为什么是问题：K13 的目标是消除 editor→ai 组件的假耦合（已达成），但**值出现了两个来源**；以后调 gap 只改一处 ⇒ AI 面板与选区浮栏的偏移不一致（正是 K13 想防的几何漂移）。当前无测试钉住。
- 建议（小，5 分钟）：`AiAssistantDialog.tsx` 改为 `import { AI_DIALOG_GAP } from "./aiLayout"`（如需保持旧导出，用 `export { AI_DIALOG_GAP } from "./aiLayout"`），并在 `aiAssistantScope.test.ts` 或新小测试里断言「全仓只有一处 `= 8` 定义」。
- 归属：task-11 / task-10（两者都碰了 ai 目录；**不在我 scope**，我只报不改）。

### F-2【P2｜未完成项】M2-2/M2-3 仍未做

- `--mb-radius-xl`：`src/mobile/mobile.css:520`（`.mb-sel-actions`）仍在用，全仓 **0 定义**（`grep -rn '\-\-mb-radius-xl' src --include='*.css'` 只有这 1 处使用）⇒ 多选操作条圆角实际为 0（悬空 var 失效）。
- `mobile.html`：仍有 **2 处** `theme-color`（`:6` `#f5f6f8` 与 `:11` `#ededf1`）——双值会让 WebView 状态栏底色随匹配顺序变化，且与 `capacitor.config.ts` 三处不同源。
- 建议：按 00 方案 M2-2/M2-3 收掉（改 `var(--lake-radius-xl)` 或补定义；theme-color 留一处 + 内联首帧底色同源）。若决定不做，请在 HANDOFF §3 明确登记为「已知未做」，不要静默留着。
- 归属：task-12（audit-desktop-ui）。

### F-3【P3｜文档一致性】06 报告 §1.3 的「15 文件 kind 私抄」清单已过期

- 现状：14 文件已迁 + TagPreviewBody 分支已删 = 清单应改为 14，并注明 `Sidebar.tsx`/`useTreeActions.ts` 的 `CreateKind` **不算** NoteKind 私抄。
- 影响：下轮审计若照旧清单复核会误报 2 处「漏迁」。建议在 06 报告或 HANDOFF 加一行（**文档不属于我本轮 scope**，由 lead 决定是否指派）。

### F-4【P3｜观察】F-04 文案进 core

- 见 §2.1 观察项：有 `cloudStateHint()` 先例，可接受；建议在文件头注明「用户可见文案，i18n 层引入时一并迁移」。

---

## 4. 我（task-14）本轮的改动与验证

| 文件 | 改动 | 验证 |
| --- | --- | --- |
| `src/features/editor/imagePreview.ts` | 头注释改为「**正文解析 + 宿主挂载** → 共享 Lightbox；本构建 `allowClickToMaximize`/`previewImgs` 实测无效，列表必须由宿主从正文解析」；删掉「lakeRuntime envAdapter 调 open()」的过期设计描述 | tsc 0；文件内其余逻辑 0 改动 |
| `src/features/tags/TagPreviewBody.tsx` | 删除**不可达**的 doc / 非 doc 分支（唯一调用点 `TagsWorkspace.tsx:587` 只传 quickNote）；保留 `kind: "quickNote"` 契约 + 注释说明「恢复内嵌预览请复用 NoteDocPreview/HistorySnapshotPreview」；props 提为 `TagPreviewBodyProps` | tsc 0；连带从 K12 清单移出 1 个文件 |
| `src/components/app/tagsSpaceWiring.test.ts` | 两处同步：①删「PREVIEW 必须含 NoteDocPreview/HistorySnapshotPreview」旧断言（261106 三改后已过期），改为「**不得 import** 两个共用件」+ 断言 TagsWorkspace 用 `.tags-preview__open-doc`；②长按/ink 断言不变 | 12 tests passed |
| `src/components/app/NoteDocPreview.tsx` | `isMobileEnvironment()` 分支加注释：**当前移动端不 import 本组件**（走 NoteInfoSheet/TrashPreviewPage），该分支只在历史路径/未来复用时生效；逻辑保留 | tsc 0 |
| `src/components/app/HistorySnapshotPreview.tsx` | 同上（移动端历史 = WorkspaceOverlayHost 只读列表），逻辑保留 | tsc 0 |

- 说明（与 lead 指令的 1 处偏差）：指令要求「保留 `import type { NoteKind }`」，但该文件**原本就没有** NoteKind 引用，且删分支后不再需要；`tsconfig.json` 开了 `noUnusedLocals`/`noUnusedParameters`，加无用 import 会让 `tsc --noEmit` 直接失败 ⇒ **未加**，改为在注释里写明「恢复内嵌预览要复用哪两个共用件」。
- 实跑（本批）：`npx tsc --noEmit` = 0；`npx vitest run tagsSpaceWiring / NoteDocPreview.render / HistorySnapshotPreview.render / historySnapshotPreview / quickNotePreview` = **48 tests passed**；`git diff --check` = OK。

---

## 5. 未覆盖 / 必须在 R0-6 补的验证

1. **视觉快照**（本报告最大的盲区）：task-12 删了 58 条被压死声明 + 8 条 kit 死原语，**我只跑了静态门禁与源码判据，没有跑桌面 42 态 / 移动 10 态**（需夹具机 + 专用 AVD，按 AGENTS §3#21 只在发版前全量）。删的是「被上层压死的声明」，理论上零视觉差异，但 `.context-menu > button` 的 display/align/gap 依赖「所有子按钮都有 ln-menu__item」——我只抽查了 TabContextMenu；**建议 R0-6 把「目录右键 / 页签右键 / 卡片右键 / 标签行菜单 / 顶栏更多」5 个菜单各看一眼几何**。
2. **设备级**：M2 修完后移动端需 `check:mobilesnap`（10 态）+ 23 屏走查（多选操作条圆角那条态）。
3. **K14 新增提取器的稳定性**：属静态测试，已跑绿；未覆盖「preload 动态注册」等非常规写法（当前代码库无）。
4. 本报告是 **12:42–12:48 的快照**；之后若有新改动（工作区仍在动），以最终 `git diff` 为准。

---

## 6. 复核用命令（可复现）

```bash
# F-04
grep -rn 'no-remote-manifest' src electron --include='*.ts' --include='*.tsx' | grep -v test
npx vitest run src/components/app/quickNoteSyncGate.test.ts src/core/s3v3/quickPush/pipeline.test.ts
# F-03
grep -n 'data-note-id' src/features/editor/EditorTab.tsx src/features/usheet/UniverSheetEditor.tsx src/features/bitable/BitableEditor.tsx src/features/board/BoardEditor.tsx src/features/ink/InkPad.tsx
npx vitest run src/features/ai/aiAssistantScope.test.ts
# K12 / K8 / K2
npx vitest run src/features/ink/inkPagesPanel.render.test.tsx src/lib/dateFormatUsage.test.ts
# K13 双源（应只剩 aiLayout 一处定义）
grep -rn 'const AI_DIALOG_GAP' src
# 样式门禁
node scripts/ui-metrics.mjs && npx vitest run src/styles/cssLayers.test.ts
# M2 未完成项
grep -rn '\-\-mb-radius-xl' src/mobile --include='*.css'; grep -c 'theme-color' mobile.html
```
