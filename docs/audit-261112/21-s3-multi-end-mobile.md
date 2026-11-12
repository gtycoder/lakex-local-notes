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

## 5. 后续

G–K 未跑（嵌套分组/小记快路径·删除传播·不静默复活/附件双向/离线恢复/三端交错），按同前缀、同三端续跑后补入本报告 §1 表与 §2 FAIL 明细。
