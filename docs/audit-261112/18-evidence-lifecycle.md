# 18 · 三条生命周期缺口的实测复核（M1/M2/M3 + apply warning UI）

> 只读复现（不改产品代码）· 2026-11-12 · 基线 = **HEAD 8fe1124f**（含 task-44 3fad8821）。
> 设备：**emulator-5556**（App 私有沙箱、debug 包 v1.1.0，17:15 由 HEAD 源码 ```bash scripts/android-build.sh --sync --install``` 装入）。
> 桌面：**未起桌面实例**（见 §0.3）；不碰正式数据目录；不配 S3 / 不碰真实桶。
> 入口报告：`docs/audit-261112/15-readonly-gates-warning.md`（本文是它的「实测复核」；结论有修正，见 §5）。

---

## 0. 方法与等价性边界（先读这段）

### 0.1 手段
- 移动端：CDP（`node scripts/css-audit/drive.mjs 9351 ...` / `scripts/cdp-eval.mjs 9351 ...`）驱动**真实点按**（`Input.dispatchMouseEvent`；输入用 `Input.insertText`），截图一律 `adb exec-out screencap -p`（MOBILE-OPS §3/§6）。
- DB 读数：`adb shell run-as com.lakexlocalnotes.android sqlite3 databases/lakex-local-notes-mobileSQLite.db "SELECT ..."`（**只读**；仅写入两处受控测试状态，见 §0.2）。
- 证据文件：`docs/audit-261112/evidence/`（截图 `shots/`、SQL/日志 `sql/` `logs/`、驱动脚本 `drivers/`）。

### 0.2 为什么用「状态注入」而不是跨端同步
本机**未配置 S3**（不碰真实桶、不碰正式数据），因此无法真的「桌面删 → 云 → 手机」。采用**同字段等价复现**：
- 桌面删除文档在同步 wire 上的落地结果 = 手机端 `notes.trashed_at` 非空（远端 tombstone 应用，见 `src/core/s3v3/state/deviceStore.ts` 的 trashedAt 分支与 `mobile/v3/mobilePlatformPort.ts` 的直写）；
- 桌面加锁落地 = 手机端 `notes.is_locked=1 / locked_at`（`src/mobile/v3/mobilePlatformPort.ts:374-379` 就是同步 apply 写这两列）；
- 因此用**产品 API**（`trashNote`）或**App 停止时离线 SQL**（仅 is_locked / folders.space 两列）把被测端置成与"同步后"完全相同的字段值，再启动 App 走真实 UI。
- 所有 DB 写入只发生在 emulator-5556 的**测试实例**；正式数据目录（`~/Library/Application Support/lakex-local-notes`）未触碰。

### 0.3 未起桌面实例
M1/M3 的"桌面侧动作"由**删除/加锁的产品语义 + 同步落地字段**等价替代（上面 0.2），并给出桌面侧代码位置；实测集中在**消费端（手机）**的真实行为——这正是三条缺口的判据所在。桌面 UI（浮层/诊断）的通路按源码与 HEAD 对照核算（§4），未起 Electron（本批 worktree 有他人未提交改动，起实例会混入非 HEAD 行为）。

---

## 1. M1 实测：桌面删日记 → 手机日记页点该天 —— **不可复现（15 号报告 M1 需降级为防御性建议）**

准备（产品 API + 一列离线标记）：
- `createNotebook('日记审计')` → `5cdd9880-…`；`createNote('2026-11-12', nb)` → `922d3fc2-…`；`trashNote(922d3fc2)`；
- 移动端没有"标记日记本"的 UI/API ⇒ 离线 `UPDATE folders SET space='diary'`（等价桌面把某本标为日记；用户裁决的日记=普通文档+folders.space）。

测点 1（日记页是否列出已删条目）：点「日记」dock → 页面「日记 **0 篇** … 还没有日记。点上面「写今天」写下第一篇。」
- 该条**没有出现在列表**：entries 来自 active 子树，SQL 带 `trashed_at IS NULL`（`src/mobile/diary/diaryRepository.ts:155`）。
- 证据：`evidence/shots/M1-01-diary-page.png`、`evidence/logs/M1-diary-gone.txt`。

测点 2（点「写今天」会不会打开已删的那篇）：点「写今天」→ **新建了同日活跃文档** `4392cfc5-…`（parent=月分组），并打开它的编辑器（标题可编辑、正文可输入——这是新文档，正常）；已删的 `922d3fc2` 仍是 trashed，没有被打开。
- 原因：`ensureDiaryNote` 的候选集同样只取 active 节点（`diaryRepository.ts:158-168`）+ `planDiaryOpen`。
- 证据：`evidence/shots/M1-03-diary-after-write-today.png`；DB 对照见 logs 文件（同标题两行：一 trashed、一活跃）。

**结论（实测）**：日记页不存在"打开已删日记"的入口 ⇒ 15 号报告 M1 的复现路径（"点该天 → 可编辑无横幅 → 保存报错"）**不成立**，应降级为**防御性建议**（移动 `openDiaryEntry` 自身无 gone 判据；若日后列表/入口改为包含回收站条目，会立刻回归）。附带实测观测：同一天已有"已删日记"时，写今天会再建一篇同日活跃文档（产品允许一天多篇，属预期；但用户会看到"旧的那篇不见了、又出现新的"）。

---

## 2. M2 实测：手机陈旧编辑器保存已删小记 —— **静默复活成立（P1 确认）**

对象：`quick_notes.id = 7c145fc0-9466-4010-b44d-c5f752cac19f`（夹具小记 3）。

| 步骤 | 操作（真实点按/API） | 读数 |
| --- | --- | --- |
| 1 | 首页点卡片打开编辑器 | `.quick-note-editor` 存在；截图 `shots/M2-01-editor-open.png` |
| 2 | 编辑器**保持打开**，API `deleteQuickNote(id)` | `getQuickNotePage` 不含该条（3 条）；DB `deleted_at=2026-11-12T09:19:22.270Z`；`quick_note_deleted` 无行；编辑器仍在（截图 `shots/M2-02-editor-open-note-deleted.png`） |
| 3 | 在编辑器里输入 " [M2审计编辑]" → 点「保存」 | 编辑器关闭；首页列表**重新出现**该条（"夹具小记 3 [M2审计编辑] 今天 17:20"）；**没有任何"已删除"提示**（截图 `shots/M2-03-after-stale-save.png`） |
| 4 | 保存后查 DB | `SELECT deleted_at,is_dirty,restore_pending_at` → **deleted_at 空**、is_dirty=1、restore 空；`getQuickNotePage` 再次包含该条 |

**结论（实测）**：删除后仅靠"陈旧编辑器保存"即可把 `deleted_at` 清空、行回到活跃列表；用户无感知、无显式恢复。
- 代码：`src/mobile/data/quickNotesRepository.ts:240-245`（upsert 无条件 `deleted_at=NULL` + `DELETE quick_note_deleted`；被三个保存 API 共用 265/296/311）。
- 对照桌面：同场景 `UPDATE` 不触碰 `deleted_at`（`electron/quickNotes/savePipeline.ts:150-152`）；行不存在则 `readRow` 抛 NotFound。
- 跨端"撤销他端删除"：**推断**（复活行 is_dirty=1，下一轮同步会作为活跃条目发布）——未配置 S3，未实测。

---

## 3. M3 实测：桌面锁定 → 手机可编辑/可保存/无标识 —— **P1 确认**

对象：`notes.id = 7b6b59ef-e238-44d5-ac7c-5082381dc734`（标题 M3锁定测试）。
注入（App 停止时，等价同步落地）：`UPDATE notes SET is_locked=1, locked_at='2026-11-12T09:25:00.000Z'` → 重启后仍为 1。

| 步骤 | 操作 | 读数 |
| --- | --- | --- |
| 1 | 打开该文档（工作区 → 文档树胶囊 → 行） | 标题只读；**可见 DOM 无任何「锁定/只读」标识**（hit-test 过滤后 lockSrc=[]）；截图 `shots/M3-01-locked-doc-opened.png` |
| 2 | 顶栏点「编辑」 | 标题变可编辑、出现 `contenteditable .ne-engine`、顶栏变「完成」；输入 " [M3审计编辑]" 生效；截图 `shots/M3-02-editing-locked-doc.png` |
| 3 | 点「完成」（触发保存） | DB `updated_at=2026-11-12T09:29:03`、`readNote().content` 含 "M3审计编辑"（len=173）⇒ **保存成功**；`is_locked` 仍为 1（未被破坏）；截图 `shots/M3-03-after-save.png` |

**结论（实测）**：移动端不消费 `isEditLocked`（仅数据层出现：`mobile/v3/mobilePlatformPort.ts:187,374-379`、`bridge/notes.ts:155`；UI 层 0 处）⇒ 锁定文档可编辑可保存、无标识；锁标志本身没被改写（因为没有读写它的代码）。桌面侧 `lockedNoteIds` → `readOnly` 生效（`hooks/desktopDerivedState.ts:82`、`MultiTabEditor.tsx:688`）。

---

## 4. task-44「单篇 apply 失败降级」的 UI 通达（HEAD 8fe1124f + 工作树 task-56）

- **产生与出口（HEAD）**：core 单篇失败记 warning 后 `continue`（`src/core/s3v3/state/deviceStore.ts:673-681`）→ 桌面收集并并入 `SyncResult.warnings`（`electron/s3v3/desktopStoreAdapter.ts:88-96`、`electron/s3v3/desktopSync.ts:193-201`，kind 复用 `remote_incomplete`）→ 落 `device_state.last_sync_result`（`electron/main.ts:205`）；移动并入 `report.warningDetails`（`mobile/v3/sync.ts:66-71`）。
- **桌面展示（HEAD）**：浮层**只到计数**（`SyncStatusPopover.tsx:250-257`："同步有 N 项被跳过；逐项原因见设置→同步诊断"）；而诊断报告 `report.warnings` 仍只取 `r.warningDetails`（`desktopSync.ts:203-214`）⇒ **apply 跳过原因在桌面没有逐项出处**（仅主进程日志 :178 / last_sync_result 原文）。
- **移动展示（HEAD）**：设置页能**逐项列**（`SettingsDrawer.tsx:521-545`），但是当次会话内存（`useSyncSettingsForm.ts:15,62`）；「上次同步」`syncStatusStore` 无 warnings 字段（`:14-30`）⇒ 重启即丢。
- **文案语义**：apply 失败复用 `remote_incomplete`（`core/sharedTypes.ts:30-42` 无 apply 类）；工作树 task-56 的 `core/syncWarningText.ts` 把该类写成「远端内容不完整」⇒ 对**本地写失败**因果写反（"本地内容未改动/下次重试"部分正确）。
- **工作树 task-56（未提交）**：桌面浮层已升级为逐项（最多 5 行 + 可点开文档 + 另 N 条去诊断，`SyncStatusPopover.tsx:251-301`），但诊断报告仍不含 applyWarnings ⇒ 超 5 条仍无逐项出口。
- **护栏**：HEAD 的 `electron/s3v3/trashRemoteDivergence.test.ts` 中 `warning` 计数 = 0；**没有测试断言"单篇 apply 失败 → 不抛整轮 + onApplyWarning 被调用 + 进 SyncResult.warnings"** ⇒ P0 修复无回归护栏。
- 证据/命令：`evidence/logs/task44-apply-warning-ui.txt`。

---

## 5. 对 15 号报告的修正

| 项 | 15 号报告 | 实测后 |
| --- | --- | --- |
| M1 日记入口 | P1「打开已删日记 ⇒ 可编辑、无横幅、保存才报错」 | **不可复现**：日记列表/ensure 都过滤 trashed（`diaryRepository.ts:155,158-168`）⇒ 降级为**防御性建议**（入口自身无 gone 判据，未来改口径会回归）；另记录"同日多篇"观测 |
| M2 小记复活 | P1（代码判据 + 推断复现） | **确认**：实测静默复活（DB deleted_at 清空、列表回归、无提示）；跨端撤销仍为推断（无 S3） |
| M3 移动锁 | P1（代码判据） | **确认**：实测可编辑/可保存/无标识；锁标志未破坏 |

---

## 6. 残余风险与未覆盖

1. **未配 S3**：三条缺口的"跨端传播"后果（复活撤销他端删除 / 锁定跨端一致）未实测，只按字段与同步 apply 代码推断。
2. **未起桌面实例**：桌面浮层/诊断的实测渲染未做；HEAD 与工作树（task-56）的差异按源码对比，未截图。
3. **状态注入的等价性**：M3 的 `is_locked`、M1 的 `folders.space` 用离线 SQL 置入；与产品/同步写入的列与值一致，但不是端到端同步产生——审阅时请按 §0.2 的等价性论证判读。
4. **测试实例残留数据**：emulator-5556 留下 `M3锁定测试`、`日记审计` 笔记本（1 活跃 + 1 回收站日记）、被复活的"夹具小记 3"（含 " [M2审计编辑]"）。均在测试 AVD，不涉及正式数据；如需干净状态按 MOBILE-OPS §5.2 `pm clear` + 重灌夹具 + 重烤基线。
5. 我误建的空库 `databases/lakexlocal-notes-mobileSQLite.db` 已删除（与真库 `lakex-local-notes-mobileSQLite.db` 不同名）。

---

## 附录 A · 证据文件
- 截图：`evidence/shots/M1-01-diary-page.png`、`M1-03-diary-after-write-today.png`、`M2-01-editor-open.png`、`M2-02-editor-open-note-deleted.png`、`M2-03-after-stale-save.png`、`M3-01-locked-doc-opened.png`、`M3-02-editing-locked-doc.png`、`M3-03-after-save.png`
- 读数/日志：`evidence/sql/M2-quick-note-resurrection.txt`、`evidence/sql/M3-lock-injection.txt`、`evidence/logs/M1-diary-gone.txt`、`evidence/logs/task44-apply-warning-ui.txt`
- 驱动脚本（复现用）：`evidence/drivers/m2_step1_open.mjs`、`m2_step2_save_stale.mjs`、`m3_edit.mjs`、`m3_done.mjs`、`m3_open_final.mjs` 等

## 附录 B · 复现命令（节选）
```bash
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
export ANDROID_SERIAL=emulator-5556
bash scripts/android-build.sh --sync --install     # 当前 HEAD 的 debug 包（约 1 分钟）
bash scripts/emu-cdp.sh 9351                        # 独立端口，避开门禁 9336
node scripts/css-audit/drive.mjs 9351 docs/audit-261112/evidence/drivers/m2_step1_open.mjs
node scripts/css-audit/drive.mjs 9351 docs/audit-261112/evidence/drivers/m2_step2_save_stale.mjs
adb shell 'run-as com.lakexlocalnotes.android sqlite3 databases/lakex-local-notes-mobileSQLite.db \
  "SELECT id,deleted_at,is_dirty FROM quick_notes WHERE id='"'"'7c145fc0-9466-4010-b44d-c5f752cac19f'"'"';"'
```
