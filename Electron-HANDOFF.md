# Lake Notes Electron 会话交接文档（多端删除链路已验收提交 + 重构交接）

> 写给完全没有上下文的新会话。**开始工作前先通读本文**，再按需读：
> `docs/REFACTOR-TRASH-NOTEBOOK-HANDOFF.md`（**重构方案交接，当前最重要**）、`AGENTS.md`（项目长期记忆）、`docs/S3-GC-DESIGN.md`（v4.1）、`docs/GC-TEST-REPORT.md`（GC 测试报告）、`docs/TODO.md`，
> 对照代码：`electron/sync.ts`、`electron/store.ts`、`electron/quickNotesSync.ts`、`electron/logger.ts`、`electron/main.ts`、`src/App.tsx`、`src/components/*`、`src/features/editor/*`。

项目目录：`/Users/admin/file/local-lake/lake-notes-electron`

---

## 0. 任务目标

Lake Notes 是**本地优先**笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 内核），带 S3 同步（七牛 Kodo S3 兼容 API）。**本地是真相，S3 只是镜像。**

**当前状态**：多端删除链路（软删 → 恢复 → purge → GC 对账 → 深度清理）已测试验收并**提交**到 `feat/s3-storage-rw-delete`（未合并 master）。GC 测试报告见 `docs/GC-TEST-REPORT.md`。

**下一阶段主线（重构）**：**隐藏回收站笔记本重构（删除 = 移动语义）**——把删除从"墓碑特殊状态"改为"移入隐藏回收站笔记本"，统一同步逻辑，根治墓碑机制的补丁与缺陷。**完整方案、起因经过、原则、计划见 `docs/REFACTOR-TRASH-NOTEBOOK-HANDOFF.md`，独立分支实施。**

**排期约定（用户明确）**：重构（隐藏回收站笔记本）之后，再启动 Electron 升级 33 → 42。

当前分支：`feat/s3-storage-rw-delete`，**已提交、未合并 master**。重构另起独立分支（建议 `feat/trash-notebook`）。

---

## 1. 当前快照

| 项目 | 信息 |
| --- | --- |
| 目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| 分支 | `feat/s3-storage-rw-delete`（未合并） |
| 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| Node | **必须优先 Node 24**：`$HOME/.nvm/versions/node/v24.18.0/bin` |
| Electron | **33.4.11**（升级 42 已列入 TODO，排期在删除链路之后） |
| 基线 | `npx tsc --noEmit` 通过；`npm test -- --run` = **188 passed**；`node node_modules/vite/bin/vite.js build` 通过；`git diff --check` 干净 |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`（可重建） |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`（**禁止触碰**） |
| 运行状态 | **项目已停止**（设备 A/B、vite 均已退出，multidev 残留已清） |

> ⚠️ 当前有 30+ 文件未提交（上一阶段 + 最近会话的全部改动）。**不要擅自提交/合并**，等用户验收。

### 开发版固定 S3 配置（已写入 `electron/main.ts`，仅 dev 首次启动 seed）
- Endpoint: `https://s3.cn-north-1.qiniucs.com`
- Region: `cn-north-1`
- Bucket: `local-lake-hebei`
- 对象前缀: `lake-notes`
- AK/SK: 已硬编码在 dev seed 中（**勿外泄**；仅 dev）
- `forcePathStyle: false`（virtual-host，七牛证书要求）

> 用户最初给的 Endpoint 是 `https://local-lake-hebei.s3.cn-north-1.qiniucs.com`、Bucket `local-lake`，实测是 bucket/region 映射写反了；正确如上。

---

## 2. 已完成内容

### 2.1 早期阶段（已在分支上，历史遗留）
- S3 GC v4.1（M0–M9）：回收站恢复 vs 远端墓碑、ObjectStore 扩展（list/delete/deleteMany/deletePrefix/put）、manifest v4（prevCommitId 链、对象键 `objects/{noteId}-{contentHash}.lake`）、历史引用资源不上传、purge（先写 manifest 后 `deletePrefix`）、GC 对账（`s3_gc_pending`/`s3_gc_log`/`runGcReconcile`）、小记回收站 + 深度清理、Lake 深度清理（scoped 到 `objects/`+`assets/`+`manifests/`，不碰 `quick-notes/`）、历史分层 `selectHistoryDrops`、回收站提醒。
- 文档历史/快照：15 分钟自动 + 手动 + 恢复前留档 + 孤儿清理（`note_history` 表 + `history/{noteId}/` 目录）。

### 2.2 多端联调 + 同步可用性（最近两个会话）
#### S3 连接兼容
- `ObjectStore.test()` 从 HeadBucket 改为 **ListObjectsV2**（七牛 HeadBucket 对存在的桶也返回 404/UnknownError）。
- dev 首次启动自动写入上述 S3 配置。

#### 同步进度与状态
- `SyncProgress` 增加 `assetCurrent/assetTotal`（资源子进度）、`supersededNotes`、`error`。
- Lake 上传/下载资源、小记上传/下载图片都上报子进度；`SyncPanel` 展示主进度 + 资源子进度 + 最后同步时间 + Lake/小记计数。
- 状态栏统一云同步状态：云同步关闭 / 同步中 / 同步失败 / 待云更新 / 已同步 / 冲突（`src/App.tsx` 的 `cloudStatus`）。
- `markSynced()` 同时更新 `notes.sync_state` 和 `tree_nodes.sync_state`（否则状态栏永远显示"待云更新"）。

#### 云同步开关 + 自动/手动同步
- `SyncSettings { enabled, autoMode: "manual"|"interval"|"onOpenClose", autoIntervalMinutes }`，存本地 settings 表，**不上云**。
- `enabled=false`：不跑 GC/自动/手动同步；关闭前做最后一次对齐（`runFullSync`），失败则保持开启并报错；重新开启后立即后台对齐一次。
- 主进程 `runFullSync()`：Lake → 小记，`syncInFlight` 单飞 + `enqueueMaintenance` 串行；自动同步（interval / onOpenClose / 退出前）都走 `runFullSync`。

#### 目录树同步（重要）
- manifest 增加**必填** `folders[]`：`{ id,title,parentId,sortOrder,nodeType:"notebook"|"group",icon,updatedAt }`。
- 下载阶段先导入 folders，再导入 notes，保证父目录存在；正文相同但元数据变化时 `applyRemoteNoteMeta` 对账（标题/父目录/排序/图标）；文件夹 icon 用 `updatedAt` LWW。

#### 小记同步（quick notes）
- `quick-notes/` 独立前缀，独立小记库 `quick-notes/metadata.sqlite3`，独立上传/下载图片子进度。

### 2.3 最近会话新增（打开 tab 刷新增强 + 日志 + 冲突留档修复）

#### 打开中 tab 的刷新增强（参考 VSCode lake-editor 插件的"外部变更检测"思路）
- **远端删除检测**：新增 `store.getNoteDigest(id)` + IPC `get_note_digest`（`types.ts`/`main.ts`/`preload.cjs`/`native.ts` 四处同步）。同步 done 后 digest 为 null/purge 或 `deleted=true` → tab 标记 `deleted`（红字 + 删除线 + 徽标，正文保留），保存被拦截；回收站恢复/重新打开自动重载清除标记。
- **冲突提示可点击**：notice 升级为 `NoticeState`（带 action 按钮），冲突 → "查看历史"，仅删除 → "查看回收站"。
- **digest 预检**：同步后先比对 `title+updatedAt`（只读 DB 不读文件），未变化跳过全量 `readNote`；本地保存成功更新 `lastDigest`，减少无谓的 tab 全量重载。

#### 统一日志系统（electron-log@5.4.4，新增依赖）
- `electron/logger.ts`：scope 分类（sync/s3/history/gc/quick/store/renderer/perf），落盘 `userData/logs/lake-notes.log`（多端 LAKE_USER_DATA 隔离），5MB 轮转，格式 `[y-m-d h:i:s.ms] [level] (scope) text`。
- 渲染层：main.ts `console-message` 转发（兼容 Electron 33 新式 `(event)` 签名）；逻辑埋点带 `[sync-tab]`/`[editor-perf]` 前缀。
- 耗时统一 `[perf] <label> Xms` 格式。埋点覆盖：S3 每次调用、同步各 phase+每笔记、快照/恢复/purge/importRemoteNote、GC/深度清理、tab 刷新循环、EditorTab init。
- vitest 自动静音（`process.versions.electron` 不存在时关 transports）。

#### 冲突留档补漏（P0，A/B 联调发现）
- 根因：sync.ts 下载分支中 `localChanged=false`（本地相对基线无改动）被远端覆盖走 else 分支直接接受、不留档 → A 上传后未编辑的版本被静默丢弃。
- 修复：else 分支只要 `local` 存在就 `createHistorySnapshot(force)` + push superseded。
- 回归测试："本地已同步但远端被其他设备改 → 接受远端 + 留档 + superseded"。

#### 快照去重语义修正
- 系统自动留档（云端覆盖 superseded、恢复前留档）改 `force=true` → `false`（24h 同 hash 去重，保留旧时间点 T1，不新建不改时间）；**手动创建快照保持 force=true**。
- 安全：去重基于 note_history 表实时查，手动删掉后重建不丢。
- 新增测试：覆盖留档去重 + 恢复前留档去重。

#### 工具与性能实测
- `scripts/s3-ls.mjs`：云端对象查看工具（`--note <id>` / `--prefix` / `--count` / `--json`）。
- 性能实测：note_history 5 万行（1000×50）下 `hasRecentDuplicate` 走索引 `(note_id, created_at DESC)`，单次 **0.017ms**，1000 文档同时创建 ≈16ms，无需改。
- purge 清理历史：确认 `purgeTrashItem` 已删 note_history 行 + `history/{noteId}/` 目录，补了回归测试。
- SQLite 删行后表文件不物理缩小（空闲页自动复用，VACUUM 才回收）已向用户解释清楚。

---

## 3. 当前问题

1. **（未复现，待排查）历史快照恢复 → 上传 S3 卡 30s**：用户此前在 A/B 联调中提到过，本轮说"暂时没发现"。日志埋点已全部就绪，复现后 `grep '\[perf\]'` 两端日志定位。
2. **（已修复，注意回归）冲突留档补漏**：见 2.3，A/B 联调发现的"被覆盖端不留档导致永久丢改动"已修复并加回归测试，多端删除测试时要顺带回归该场景。
3. **（进行中）多端删除链路尚未完整测试**：用户正在规划，见下一步计划 §5.1。

---

## 4. 架构与关键代码地图

```
electron/
├── main.ts             # 窗口/生命周期/IPC handle/S3 seed/console-message 转发
├── store.ts            # better-sqlite3 数据层（notes/tree_nodes/deleted_notes/note_history/sync_base…）
├── sync.ts             # S3 同步核心（manifest/冲突四分支/superseded/GC 对账）
├── quickNotesSync.ts   # 小记同步（quick-notes/ 前缀）
├── logger.ts           # electron-log 封装（scope + [perf] 耗时）
├── assetServer.ts      # 本地资源端口服务（LAKE_ASSET_PORT）
└── preload.cjs         # IPC bridge（invoke 封装）
src/
├── App.tsx             # 状态栏 cloudStatus / 云同步开关 / 全局同步
├── lib/native.ts       # IPC 类型安全封装（加方法必须同步改）
├── lib/types.ts        # 共享类型（SyncProgress/NoticeState…）
├── components/         # SyncPanel/SettingsPanel/TrashPanel/HistoryPanel/QuickNotesWorkspace
├── features/editor/    # MultiTabEditor/EditorTab/lakeRuntime（tab 刷新/删除标记）
└── styles.css
scripts/
├── multidev.sh         # 同机多端（A/B）启动脚本
└── s3-ls.mjs           # 云端对象查看工具
```

### 同步协议要点
- 冲突判定四分支见 `sync.ts` 下载阶段；`baseHash + lastUploadedHash` 都在本地 `sync_base`，**绝不上 manifest**。
- `supersededNotes`：本地改动被远端覆盖时，先强制 `createHistorySnapshot` 留档，再接受远端（见 2.3 P0 修复）。
- `folders[]` 必填；手动同步只发回触发窗口；自动同步广播本进程所有窗口。

### 多端启动（同机）
- 每个"设备"= 独立 `userData`（`LAKE_USER_DATA` 覆盖）+ 独立 `LAKE_ASSET_PORT` + 同一 S3 配置。
- 单实例锁按 userData 隔离，不同 userData 可同时跑；同一 userData 第二实例直接 quit。

---

## 5. 下一步计划

### 5.1 多端删除链路完整测试（**当前最优先**，用户正在规划）
链路：软删（文档/小记）→ 回收站恢复 → purge（云端立即删前缀）→ GC 对账（7 天窗口）→ 深度清理 → 小记删除。
**四层验证**：
1. **UI**：删除/恢复/清空回收站后的界面表现；
2. **本地 DB + 文件**：`deleted_notes`/`tree_nodes`/`note_history`/`s3_gc_pending`/`s3_gc_log` + `history/{noteId}/` 目录 + 正文文件；
3. **云端对象**：用 `scripts/s3-ls.mjs --count` 记录对象数变化（删前基线 → 删后 → purge 后 → GC 后）；
4. **日志**：`grep -E '\[(s3|gc|sync)\]'` 两端日志核对流程执行时间。
参考验证场景（A/B 两端）：A 编辑提交云 → B 同步 → 两端一致 → A 再编辑 → B 也编辑 → A 提交 → B 同步（被覆盖端留历史）→ B 恢复快照继续编辑提交 → A 同步应覆盖并留档（**重点回归 2.3 的 P0 修复**）。

### 5.2 Electron 升级 33 → 42（删除链路验收之后）
- 用户要求：**直接升级、不用过度、后续再详细评估方案**；已列入 `docs/TODO.md`。
- 参考：思源 [issue #18392](https://github.com/siyuan-note/siyuan/issues/18392) 把 Electron 升到 v42.7.1（Chromium 148 / Node 24.15），可参考但**不照搬**。
- 必做：better-sqlite3 按新 ABI 重编译、依赖兼容检查（electron-log、vite-plugin-electron 等）、全套回归（tsc + 188 测试 + build + 两端多端联调）。33→42 跨度大，建议分阶段小步升级并逐版回归。

### 5.3 其余
- 复现排查"历史快照恢复 → 上传 S3 卡 30s"（日志埋点已就绪）。
- 继续多端联调、UI 细节微调。
- 用户验收通过后，提交 `docs/S3-GC-DESIGN.md`、`HISTORY-DESIGN.md`、`TODO.md`、`Electron-HANDOFF.md` 及全部代码，再谈合并。

---

## 6. 踩过的坑（务必记住）

### 环境 / 进程
1. **vite dev server 会被 exec 会话回收**：必须用长驻 tty（`exec_command tty=true`）启动；vite-plugin-electron 会自动拉起 electron，手动控端前临时给 `vite.config.ts` 的 electron 入口加 `onstart: () => {}`，验证完必须还原（`git status` 不应有 vite.config.ts 改动；`vite.config.ts.multidev-bak` 是脚本备份）。
2. **`onstart` 的澄清**：它只是禁 vite-plugin-electron 自动拉起，不是"实现多端"的关键；多端 = 独立 `LAKE_USER_DATA` + 独立 `LAKE_ASSET_PORT` + 手动前台起。
3. **单实例锁按 userData 隔离**：不同 userData 可同时跑；同一 userData 第二实例直接 quit。资源端口 A=19876，B=19877。
4. **multidev.sh 的 device-b 没设 `LAKE_ASSET_PORT`**：起 B 端要手动补环境变量；且本环境 nohup 起不了 electron，A/B 都要手动前台 `tty=true` 起。
5. **CDP 截图**：窗口未激活时先 `Emulation.setFocusEmulationEnabled{enabled:true}` + `Page.setWebLifecycleState{state:"active"}`；截图在 `result.data`。
6. 结束 electron 只能 kill 具体 PID，**不要 `pkill -f Electron`**（机器上还有 Trae/SiYuan/VSCode 等 Electron）。

### 七牛 S3
7. **HeadBucket 不可用**：`ObjectStore.test()` 必须用 `ListObjectsV2`，否则永远报 `UnknownError`。
8. **配置映射**：正确 Endpoint=`https://s3.cn-north-1.qiniucs.com`、Region=`cn-north-1`、Bucket=`local-lake-hebei`、`forcePathStyle=false`。用户最初给的 `local-lake-hebei.s3...` + Bucket `local-lake` 是错的。

### 同步 / UI
9. **同步完成不刷新**：自动同步必须广播 `sync-progress`；否则打开 tab/状态栏/小记列表都不刷新。
10. **`markSynced` 只改 notes 不够**：状态栏读 `tree_nodes.sync_state`，两处都要更新。
11. **`contentCache` 会导致冲突后 tab 不刷新**：`reloadKey` 变化时先清缓存。
12. **`purged_at` 会被 `rememberDeleted` 的 INSERT OR REPLACE 清空**：墓碑 upsert 要保留 `purged_at`；purge 成功后 `markPurgeSynced` 清掉。
13. **文件夹图标用 `updatedAt` LWW**，不要用"本地非空优先"。
14. **IPC 三处同步**：加方法必须改 `main.ts`(handle) + `preload.cjs`(invoke) + `src/lib/native.ts`(类型+封装)。

### 日志 / 构建
15. **electron-log 必须 external**：`vite.config.ts` 的 electron 入口 `rollupOptions.external` 要写 `/^electron-log/`（子路径 `electron-log/main` 不会命中精确包名 `"electron-log"`）；否则 rolldown 把 CJS 包打进 ESM bundle，运行时报 `Calling require for "electron" in an environment that doesn't expose the require function`。
16. **渲染进程日志靠 `console-message` 事件转发**：Electron 33 签名是 `(event)`（`event.message`），旧版是 `(event, level, message)`，logger 已兼容两者。
17. **better-sqlite3 是 Electron ABI 编译**（Electron 内置 Node 20），系统 Node 24 跑不了；bench 等用 python3 sqlite3 代替。
18. **vitest 下 electron-log 要静音**：`process.versions.electron` 不存在时关 transports，否则测试输出被刷屏。

---

## 7. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run        # 188 个测试
node node_modules/vite/bin/vite.js build
git diff --check

# 起多端（vite 必须 tty=true 长驻；electron 手动前台 tty=true）
#   A: node_modules/.bin/electron --disable-gpu .
#   B: LAKE_USER_DATA="$TMPDIR/lake-device-b" LAKE_ASSET_PORT=19877 node_modules/.bin/electron --disable-gpu .

# 日志
tail -f "$HOME/Library/Application Support/lake-notes-dev/logs/lake-notes.log"
tail -f "$TMPDIR/lake-device-b/logs/lake-notes.log"
grep '\[perf\]' "$HOME/Library/Application Support/lake-notes-dev/logs/lake-notes.log"   # 耗时定位

# 云端对象验证
node scripts/s3-ls.mjs --count
node scripts/s3-ls.mjs --note <noteId>
node scripts/s3-ls.mjs --prefix <prefix>
```

### 只读检查开发库
```bash
DB="/Users/admin/Library/Application Support/lake-notes-dev/workspace-default/metadata.sqlite3"
sqlite3 "$DB" "SELECT id,title,node_type,parent_id,icon,sync_state,deleted_at FROM tree_nodes;"
sqlite3 "$DB" "SELECT id,title,sync_state,deleted_at,updated_at FROM notes;"
sqlite3 "$DB" "SELECT id,title,purged_at FROM deleted_notes;"
sqlite3 "$DB" "SELECT key,marked_at FROM s3_gc_pending;"
sqlite3 "$DB" "SELECT ts,action,reason,key FROM s3_gc_log ORDER BY id DESC LIMIT 20;"
sqlite3 "$DB" "SELECT note_id,created_at,size FROM note_history ORDER BY created_at DESC LIMIT 20;"
sqlite3 "$DB" "SELECT COUNT(*) FROM note_history;"
```
小记库：`.../workspace-default/quick-notes/metadata.sqlite3`。
