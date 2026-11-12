# 21 · S3 多端混合验收（移动↔桌面）· A–F 阶段

> 时间：2026-11-12 17:5x–18:0x（Asia/Shanghai）。**A–F 已跑；G–K 待跑**。
> 真实七牛桶 + **唯一前缀 `audit-261112-mob-1112175712`**（三端逐字相同）；凭据只从 `/tmp/lake5/creds.env` 读取，不落仓库、不打印。
> 设备/实例：
> - **M1** = emulator-5556（AVD lake_gate），CDP **9336**；
> - **M2** = emulator-5558（AVD lake_tab），CDP **9337**；
> - **D1** = 隔离桌面（`LAKE_USER_DATA=/tmp/lake5/m72`、`LAKE_ASSET_PORT=19884`、CDP **9237**，dev server 1421）。
> 构建：APK 42,304,273 B（当前源码包），`pm clear` 后安装/启动；两台移动都完成配置与 `testS3Connection`（移动端只暴露 {}，以同步实测为准）。

## 0. 方法与脚本

- 驱动：`/tmp/scenario72.mjs`（不入库；用 `scripts/multi-end-sync/cdpclient.mjs` 连三端，用 `@aws-sdk/client-s3` 直读本前缀 pointer/索引；凭据来自 creds.env）。
- 断言原则：三端最终一致 + 云端索引状态 + 无整轮失败；**真缺陷只登记不改语义**。
- 三端 API 差异（driver 已适配）：移动 `createNote(title)` / `trashNote` / `purgeTreeItem` / `listTrashed` / `readNote().editLocked`；桌面 `createNoteIn` / `deleteNote` / `purgeTrash` / `listTrash` / `readNote().isEditLocked`。

## 1. 结果总表（A–F）

| 场景 | 断言 | 结果 |
| --- | --- | --- |
| A | M1 新建文档+图片 → 同步 → 云端索引含该文档；D1 拉到正文+图片卡；M2 拉到；云端存在该文档资产对象 | **PASS**（4/4）：A-body-v1 + image 卡三端一致；`assets/<noteId>/` 对象数 = 1 |
| B | D1 编辑正文 + 移动到另一笔记本 → M1 同步：正文更新且**位置不回滚** | **PASS**（2/2）：M1 body=`B-v2-edited`；M1 parent == D1 目标笔记本 id |
| C | M1 移入回收站（未同步）+ D1 编辑并同步 → M1 同步不抛错、正文应用、仍在回收站、位置发布；D1/M2 跟随进回收站；云端 `trashedAt` 非空 | **PASS**（5/5）：M1 无异常；body=`C-v2-by-D1`；M1 仍在回收站；D1/M2 都在回收站；云端 `trashedAt=2026-11-12T09:59:42Z` |
| D | D1 彻底删除（purge）→ M1/M2 保留「云端已删除（仅本地）」只读副本、可恢复、不回传；云端索引不含该 id | **FAIL（2 项中 1 项）**：云端索引不含该 id ✅；**M1/M2 副本不存在** ❌（详见 §2） |
| E | M1 恢复历史版本 → 只改正文、**不把文档移出回收站** | **PASS**（2/2）：body v2→`E-v1`；文档仍在 M1 回收站 |
| F | D1 加编辑锁 → M1/M2 同步后只读（`editLocked/isEditLocked=true`、`editLockedAt` 一致）+ 保存被拒且正文零改动 | **PASS**（2/2）：M1/M2 `readNote().editLocked=true`、`getNoteInfo().isEditLocked=true`、`editLockedAt=2026-11-12T10:00:05.978Z` 三端一致；M1 保存抛「文档已锁定（只读），保存被拒绝；请先在桌面端解锁后再编辑」，正文仍 `<p>F-v1</p>`；只读横幅/编辑入口 toast 的 UI 证据由 task-63 a 项同一代码路径覆盖（`task63-a1/a2`） |

脚本退出码 0（失败只登记）；明细见运行日志 `/tmp/mob72-AF5.out`（可在证据目录复查，见 §4）。

## 2. FAIL 明细：D（桌面 purge → 移动端未保留回收站副本）

**现象（已核实，两台移动一致）**：D1 建文档 `D-purge` → 三端同步 → D1 移入回收站并同步 → D1 `purgeTrash` 并同步 → M1/M2 各同步两轮。结果：
- 云端索引已不含该 id（符合预期）；
- M1/M2 `readNote(id)` = **null**、`getNoteInfo(id)` = null、`listTrashed()` **不含**该 id；
- 两台模拟器 DB 直查（`run-as ... sqlite3 databases/lakex-local-notes-mobileSQLite.db`）：`SELECT id,title,is_locked,trashed_at,cloud_deleted,deleted_from_parent_id FROM notes WHERE id='3dc9713d-…'` → **0 行**（行已被物理删除，不是软删副本）。

**与契约冲突**：AGENTS §3#5「被他端判定缺失的本地副本保留在回收站（可恢复、只读、不参与 S3）」。桌面端语义（`electron/store.ts` 收敛删除只 `deleteNote` 软删）符合；移动端 `src/mobile/v3/mobilePlatformPort.ts` 的 `purgeLocalNote`（旧移动语义：写 `deleted_notes` 墓碑 + 删行 + 删正文）在「state 中缺失」的收敛路径被 core 调用 ⇒ **移动端直接物理删除**，副本不可恢复。

**最小复现**（三端已按 §0 配置好，前缀任意隔离）：
1. D1 `createNoteIn(nb,'D-purge')` + `saveNote(...,'<p>D-body</p>')` → `syncNow`；
2. M1/M2 `syncNow`（副本到位）；
3. D1 `deleteNote(id)` → `syncNow`；再 `purgeTrash(id)` → `syncNow`；
4. M1/M2 `syncNow` ×2 → `readNote(id)` 应为「回收站只读副本」，实测 null；DB `notes` 无行。
（复现命令与断言见 `/tmp/scenario72.mjs` 的 D 段；本轮 id `3dc9713d-b9e6-444b-805a-e533c6e95b81`。）

**建议**：只登记、不改语义。修复方向（供新建任务）：移动端「远端缺席 + 本地有基线副本」的收敛路径应产出 **软删副本**（`trashed_at` + `cloud_deleted=1`）而不是 `purgeLocalNote` 物理删除；或由 core 明确区分「本地用户 purge」与「远端缺席软删」两类（`docs/SYNC-PROTOCOL.md` §9.6 调用方分类 U/I/R/M/S）。

## 3. 与 task-63 的关系（已并入，不重复跑构建）

task-63 的 b/c/e 已在本套设备同一包上验证（见 `docs/audit-261112/evidence/mobile-20261112-173013/task63-acceptance.md`）：回收站只读预览+横幅 ✅、小记陈旧保存拒绝（composer 内联错误「保存失败：小记已在回收站或被删除…」，不复活）✅、恢复历史不改生命周期 ✅；a（锁只读/横幅/保存拦截）✅。d（同步 warning 逐项）因本实例 S3 在 task-63 时未配置而 BLOCKED，本任务已配置 S3，后续可在 G–K 间隙补（制造一次 apply 跳过即可）。

## 4. 证据与现场状态

- 驱动与日志（临时，未入库）：`/tmp/scenario72.mjs`、`/tmp/mob72-AF5.out`、`/tmp/mob72-state.json`；本次前缀记录 `/tmp/lake5/mob72-prefix`。
- 截图（本目录 shots）：`task63-a1-lock-banner.png`、`task63-a2-lock-edit-toast.png`、`task63-b1-trash-preview.png`、`task63-c1-stale-editor.png`、`task63-c2-stale-save-rejected.png`、`task63-e1-history-restored-still-trash.png`（task-63 复用证据）。
- 现场（**未清理，供 G–K 续跑**）：M1/M2 已装包并保留测试数据；D1（9237）运行中；前缀 `audit-261112-mob-1112175712` 保留。
- 收尾（G–K 完成后执行）：`DELPREFIX=audit-261112-mob-1112175712 node scripts/multi-end-sync/delprefix.mjs` → ListObjectsV2 复核 0 残留；按 CDP 端口 PID 关 D1（`lsof -nP -iTCP:9237 -sTCP:LISTEN -t` → kill）；两台模拟器 `pm clear`；`rm -rf /tmp/lake5/m72`；未 stub file input、未在画布作画（无桩/笔迹需还原）。

## 5. G–K（第二轮，同三端同前缀）

| 场景 | 断言 | 结果 |
| --- | --- | --- |
| G | M1 建分组+子分组+子文档 → D1 的 child.parent=sub、sub.parent=grp；D1 移动分组到新笔记本 → M1 跟随 | **PASS（3/3）** |
| H | M1 小记快路径（`syncQuickNote` → `pushed`）→ D1 拉到；M1 删除 → D1 活跃列表不含；M1 建→D1 删→M1 陈旧保存被拒（「小记已在回收站或被删除（可能在其它设备删除）…」）且首页不复活 | **PASS（6/6，分两轮）** |
| I | 资产双向：M1 上传图像卡 → D1 `workspace-default/note-assets/<id>/` 落盘；D1 追加图像卡 → 同步 + `ensureNoteAssets([id])` 后 M1 `files/note-assets/<id>/` 两个 png 齐全 | **PASS（2/2，含语义说明见下）** |
| J | M1 关 Wi-Fi 改 3 篇 → 开网后 `syncNow` 不失败（warnings=0）→ D1/M2 两轮后三端 3 篇正文逐字节一致 | **PASS（2/2）** |
| K | D1 建 → M1 改 → M2 删 → 三端各两轮：三端都在回收站、云端 `trashedAt` 非空、M1 回收站副本保留最后一次本地编辑正文 | **PASS（3/3）** |

- **I 的语义备注（不是缺陷）**：移动端 `deferAssets=true`（按需下载附件）⇒ 普通轮不预拉资产，打开/预览/显式 `ensureNoteAssets(ids: string[])` 才拉。首轮核对时我误传单字符串导致 `e.filter is not a function`；用正确签名后两端目录均齐全。**教训**：移动端"资产已传输"的验收必须在 `ensureNoteAssets([id])` 之后断言（或先关 deferAssets）。
- H 的桌面侧建小记接口是 `createQuickNote({text, draftId, stagedImageIds})`（不是 text 字符串）；移动侧是 `createQuickNote(text)`。本报告 H 的跨端删除/复活用 **M1 建** 避开两端签名差异（结论不受影响）。

## 6. d（同步 warning 逐项可见）设备取证：**PASS（故障注入复现）**

- 首版结论是 PARTIAL/未复现（删正文文件碰运气 3 次未命中）⇒ 按 lead 指示改用**故障注入**，不再靠删文件。
- 装置（task-67 ⑤）：2 台模拟器（`emulator-5554` lake_mobile = 发布端，`emulator-5558` lake_tab = 接收端）+ 真实桶前缀 `audit-261112-d2-191416`（发布端 5 文档 + 4 小记；接收端全新空库拉取）。
- 注入方式（**不改产品代码**）：① 发布端 `run-as + sqlite3` 写一条**合法格式**的文档标签关系（`t_aaaaaaaaaaaaaaaa`）后同步；② 接收端同法建触发器 `audit261112_tag_fail`（`BEFORE INSERT ON tag_links`，命中目标 note id 时 `RAISE(ABORT,'audit261112 tag fault injection')`）⇒ 单篇 apply 的标签写失败，走 core 的「单篇 apply 失败降级」路径。
- 结果：整轮同步**成功**（回执 `v3 同步完成：↑0 ↓0`），`warnings` 含 1 条 `kind=apply_skipped`、`noteId=c8d1bf7e…`、`title=夹具文档 1`、`message=应用远端更新失败（已跳过，下一轮重试）：Run: audit261112 tag fault injection (code 1811)`。
- 设置页（设备截图）：摘要 `同步有 1 项被跳过（可重试 1）`；逐项 `夹具文档 1` + label `本篇本轮未应用` + hint `已跳过这篇（本地内容未改动），下次同步会重试；其它文档照常同步。`
- 重启保持：`am force-stop` + `am start` 后重开设置页，同一 warning/摘要仍在（`localStorage lastSync.warnings = [apply_skipped:夹具文档 1]`、`warningSummary={total:1,needsAction:0,retryable:1}`）。
- 证据：`evidence/mobile-20261112-173013/shots/task67-d-apply-skipped-1.png`（注入后）、`task67-d-apply-skipped-2-restart.png`（重启后）。
- 收尾：触发器与假标签已删（`type='trigger'` 0 条、`tags` 0 行、`tag_links` 0 行）；前缀删 **15** 对象、ListObjectsV2 **残留 0**；5554 已关、5554/5558 `pm clear`。截图已滚到「跳过项」区块（S3 凭证字段滚出视口，不入库）。

## 7. task-74 修复 + 场景 D 复跑（移动端保留「云端已删除（仅本地）」副本）

**修复（移动端单侧，未改 core/桌面）**：
1. `src/mobile/v3/mobilePlatformPort.ts`：`purgeLocalNote` 语义改为**软删保副本** —— `trashed_at` 置位、`deleted_from_parent_id` 记原父、`cloud_deleted=1`、`is_dirty=0`、清 `restore_pending`；**不再写 `deleted_notes` 墓碑、不再删行/正文**。该端口方法只在 core「本机有、本轮状态没有」的**远端驱动收敛**路径被调用；本机显式 purge 仍走 UI 的 `trashRepository.purgeTreeItem`（物理删 + 墓碑）。
2. `src/mobile/data/trashRepository.ts`：显式恢复（单篇 + 子树批量）清 `cloud_deleted=0`（恢复是唯一显式例外，随 `restore_pending` 重传）。
3. 回归（移动侧，未占用 `deviceConformance.mobile.test.ts`）：`src/mobile/v3/purgeSoftDelete.test.ts` 2 例 —— ① 软删后行仍在、trashed/cloud_deleted/deleted_from 正确、正文可读、无墓碑；② 显式恢复清三列、父级归位、restore_pending 置位、正文仍可读。

**门禁**：`npx tsc --noEmit` 0 error；`src/mobile/v3/purgeSoftDelete.test.ts` 2/2、移动相关 5 文件 18 例全绿（未跑完整 vitest，按 lead 要求由 features 收尾统一跑）。

**设备复跑（同三端同前缀，新 APK 已装两台移动）**：9/9 PASS —— D1 create→sync；M1/M2 副本到位；D1 trash→传播两端；D1 purge→云端索引无该 id；**M1/M2 回收站保留副本 + `cloudDeleted=true` + 正文可读**；多轮同步不回传；M1 显式恢复→local-wins 重新上传；D1 拉回恢复后的文档。

## 8. 移动快照门禁（10 态）

- 口径：本批**无 CSS 改动**（只有移动 TS 逻辑）⇒ 在 M1 `pm clear` + 重灌 `gate-fixture`（5 文档 + 4 小记）+ `emu-cdp.sh 9336`，再跑 `node scripts/mobile-audit/check-mobile-snap.mjs --port 9336`（两轮去抖）。
- 首跑结果：**9/10 态 0 差异；1 态差异**：home-doc：元素数 **2085 → 2085（相同）**，指纹 1x55dog → 1yn5hoz，**两轮一致**。
- **节点级 diff（基线 warm 快照 `.css-audit/snap/gate-warm2.json` × 本次 mob-after.json，含 rows）只有 6 行，两类数据漂移**：
  1. `ne-p$<docId>-body` **一进一出**（hash 相同）：内核段落宿主 id = 文档 id，`pm clear` + 重灌夹具后文档是新 id；
  2. `span.qn-card__date#0..#3` 4 条：夹具小记的日期标签按**生成当日 HH:mm** 写；把 4 个标签临时改回基线那批的「今天 14:09」，4 条指纹可**逐条复现基线**、其余 2079 行 0 差异 ⇒ 唯一变量是日期文本宽度（该离屏分页走 MiSans、`tabular-nums` 不生效）。
- 判定：**数据依赖，非视觉回归**（无 CSS/几何/元素集合变化；同日 home-quicknotes 可见态 0 差异）。符合 AGENTS §3#21③「重灌夹具 ⇒ 必须先重烤基线」。
- 处置：以重灌后的暖态 `mob-warm` 按 `--from <warm>.json --write-baseline` **重烤移动 10 态基线**（原因：夹具重灌 + 小记日期标签/内核 prose id 属数据依赖）；重烤后**现场重跑一遍：10/10 态 0 差异**。
- 装置说明：在 `scripts/mobile-audit/README.md` 的就近条目补记两条数据依赖（原只记了 prose id），避免下次误判回归。
- 产物：临时快照（`.css-audit/snap/mob-warm.json` / `mob-verify.json` / `mob-post67.json`，gitignored，已清理）；基线 `scripts/mobile-audit/baseline/mobile-snap.json` 已更新（待 lead 提交）。
- 复核（task-67 改动装包后）：新 APK 装到 lake_gate 后重跑一次，**10/10 态 0 差异**（本批 warning/只读文案改动不进这 10 态）。

## 9. 收尾清理（已执行）

- 只删本任务前缀：`DELPREFIX=audit-261112-mob-1112175712 node scripts/multi-end-sync/delprefix.mjs` → **deleted 136**；ListObjectsV2 复核 **RESIDUAL=0**。
- 桌面实例按 CDP 端口 PID 关：9237 PID 75066 → kill；两台模拟器 `pm clear com.lakexlocalnotes.android` 均 Success；`rm -rf /tmp/lake5/m72` 成功（保留 `/tmp/lake5/creds.env`）。
- CDP 未 stub `input[type=file]`（全程未用文件选择桩）；未在画布作画（无合成笔迹需清理）。
- 临时证据（未入库）：清理输出、快照日志 /tmp/snap-72b.out；本目录截图是唯一入库证据。

## 10. task-67（本批代码改动，未 commit；lead 复核后提交）

**目标**：同步 warning 摘要重启不丢 + apply 跳过 kind 对齐桌面 + 三处「N 项被跳过」与三处手写只读文案收口到 core 单一来源。

1. **持久化精简摘要**（`src/mobile/sync/syncStatusStore.ts`）：`MobileSyncStatus` 增 `warnings?`（**上限 20 条**，字段精简、message 截 200 字、未知 kind 丢弃）与 `warningSummary`（按**完整列表**算的 total/needsAction/retryable，保证截断后摘要不撒谎）；`bridge.syncNow()` 成功写状态时带上本轮 warningDetails；设置页（`useSyncSettingsForm` / `SettingsDrawer`）冷启动先读落盘摘要，摘要行优先用落盘的完整分组计数。
2. **apply 跳过 kind 对齐**（`src/mobile/v3/sync.ts`）：applyWarnings 映射由 `remote_incomplete` 改为 `apply_skipped`（桌面 task-66 同口径，非 wire 字段）。
3. **三处手写「N 项被跳过」改 core 摘要**：`HomePage.tsx` / `useWorkspaceSync.ts` 的 toast 追加 `syncWarningSummaryText(syncWarningSummary(warnings))`；`bridge/sync.ts` 状态行不再拼手写计数（摘要由 toast / 设置页统一生成，避免同一句出现两遍）。
4. **三处手写只读文案改 core 判据**：新增移动薄封装 `src/mobile/lib/readonlyText.ts`（原因/标题取 `core/capabilities/readonlyReason`，仅把「解除动作」换成移动端可执行措辞——移动端不提供解锁，锁只能桌面端解除）；接线到 `NotePaneHost.tsx`（只读横幅）、`NotebookWorkspace.tsx` / `useWorkspaceSession.ts`（点编辑的提示）、`bridge/notes.ts`（保存被拒）。

**回归/门禁**：`npx tsc --noEmit` 0 error；`src/mobile/sync/syncStatusStore.test.ts`（新增 3 例：上限 20 + 完整计数 + message 截断 / 重新解析容错 / 失败轮不残留）、`src/mobile/sync/syncWarningWiring.test.ts`（新增 4 例接线）、`lockedNoteWiring.test.ts` 更新后全绿；移动子集（notebook/settings/sync/home/bridge/v3/lib）**115 文件 553 例全绿**；lead 串行全量门禁 **906 文件 / 5712 用例 0 failed**。新 APK 装到 lake_gate 后移动快照 **10/10 态 0 差异**。d 设备证据见 §6。
