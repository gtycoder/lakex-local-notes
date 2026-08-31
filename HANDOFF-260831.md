# HANDOFF-260831 · 下一会话交接：同步性能三大高收益项

> 交接自 260831 会话（同步 UI 对齐思源 + 字体栈清理，已合并 master 并推送）。
> 本文档供新会话直接承接 P3-1 / P3-3 / P4-1 三个大改动高收益任务。

## 0. 当前基线（新会话开工前的状态）

- **master = 35a2857**，与 origin/master 同步；audit/code-review 分支同点，本任务建议从 master 拉新分支（如 `perf/sync-batch3`）
- **质量门槛：750 passed | 1 skipped（751），tsc 全绿，桌面 vite build 全绿**
- 上轮审计已完成项（勿重做）：P1-2a/P1-2b、P1-3、P2-3~P2-7、P3-2（SHA 注入）、P3-3c（commitId 复用）、P4-2（2 字搜索仅标题）
- 完整审计背景见 `PERF-260828.md`（性能）与 `AUDIT-260828.md`（代码审查）

## 1. P3-1 同步 O(N²)【最高收益，预计占同步阻塞 80%】

### 现状链条（⚠️ 行号基于 35a2857，PERF 文档中的行号已漂移，按函数名定位）

- `electron/syncAdapters.ts` `getNote`：`store.listNotesForSync().find(x => x.id === id)` —— 每次调用 = 全表 SQL（notes LEFT JOIN tree_nodes）+ O(N) find + 非 synced 笔记 contentHash 读盘 + `readFileSync` 全文
- `getAllNotes`：全表 + **每条 readFileSync 全文**
- 调用方放大（均在 `src/core/syncEngine.ts`）：
  - 下载环每条远端笔记调一次 `db.getNote` → **O(N²) SQL**
  - `validParents` 构建调 `getAllNotes` —— 只需要 id 集合，却读全库全文
  - 上传环再调一次 `getAllNotes`（第二次全量读盘）；上传环内 `remote?.notes.find(n => n.id === local.id)`（搜 "远端条目缺失" 注释附近）也是 O(N²)，墓碑环节已是 Map 模式可参照
  - 无上传分支记账再来一轮 getNote ×N；记账路径 markSyncedIfUnchanged/markLocalNoteSynced 各自又全表 + find
- 合计：**3-4N 次全文 readFileSync + O(N²) 全表查询**。N=2000、均 50KB → 单次同步主进程阻塞秒级-十秒级

### 修法（PERF-260828.md §P3-1 已论证，要点）

1. engine 侧：下载环开始建 `localById = new Map(...)`（一次全表、只含元数据），循环内 `localById.get(rn.id)`；上传环 `remote?.notes.find` 改 Map（参照墓碑环节 remoteById）；`next.notes.findIndex` 改先建 nextById
2. adapter 侧：`getAllNotes`/`getNote` 不再无条件 readFileSync——`LocalNoteRow.contentHash` 桌面已有（synced 走 baseHash 缓存），**只有真正需要 content 的分支才读文件**（ownEdit 留档、上传队列 push、applyRemote 前比较，共少数几处，engine 显式 `db.getNote(id)` 时读）
3. 新端口方法 `getAllNoteIds()`（validParents 用，一条 `SELECT id FROM notes WHERE deleted_at IS NULL`）——**移动端 bridge.ts（sql.js）也要实现**，或做成可选方法（`typeof db.getAllNoteIds === "function"` 回退 getAllNotes）
4. `listNotesForSync` prepared statement 缓存（better-sqlite3 prepare 复用）

### 审计重点（必须人工核对）

content 读取时机推迟后，engine 内所有读 `local.content` 的分支（ownEditOf、createHistorySnapshot 留档、上传队列 push content）是否仍拿到同一内容；移动端 bridge 端口是否受影响。

## 2. P3-3 同步杂项（剩余两项）

| 项 | 位置 | 要点 |
| --- | --- | --- |
| downloadAssets 串行下载 | `src/core/syncEngine.ts` `downloadAssets`（约 L39-60） | 小并发批（3-4）。⚠️ 本会话刚加了 `report.downloadedBytes += bytes.length`（下载字节统计），并发化后**字节累计与 warnings 顺序需保持确定性**（建议按条目索引归位结果后再统一记账） |
| 15min 自动快照 gzip 冻结 | `electron/store.ts`（搜 gzip） | 改 `zlib.gzip` 异步：先异步压缩 → 回调内事务写 INSERT（时序不能反过来） |

（readLatestCommitId 全量 GET 一项已由 P3-3c 完成：`syncEngineController.ts` 的 `publishedCommitId ?? await readLatestCommitId(...)`，勿重做。）

## 3. P4-1 启动全库 FTS rebuild → 增量

- 位置：`electron/store.ts`（启动调用处）→ `src/core/searchRepository.ts` rebuild（约 L65-88）
- 现状：每次启动 DELETE 全部 + 逐条重插；缺 text_cache 的文档逐篇读盘转换
- 修法：FTS 表加 `UNINDEXED updated_at` 列或旁表记账，启动只重建缺失/过期条目
- **可动 FTS schema**：开发版数据可删库重建（lake-notes-dev），无迁移负担；搜索语义不变

## 4. 硬约束（重申，违反即返工）

1. `src/core/` 禁止 node: 导入（双端共享层）；平台差异走注入（参照 P3-2 的 sha256 注入模式、SyncDbPort/S3Store）
2. 本地是 source of truth，S3 只是镜像；不改同步协议语义、不改 DB 写入行为
3. 开发数据目录用 **lake-notes-dev**（可删库重建）；绝不碰 lake-notes-electron 正式数据
4. 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`
5. 不为旧数据写兼容/迁移代码；能删重建就删重建
6. 质量门槛：`npx tsc --noEmit` + `npx vitest run`（≥750 passed）+ `npx vite build` 全绿才算完成；语义等价性（P3-1）需重点自测
7. Node 用 `$HOME/.nvm/versions/node/v24.18.0/bin`
8. 本会话已验证：本环境可直接 `git push origin master`（Gitee，SSH 免密）——如遇认证问题再交用户终端

## 5. 验收命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npx tsc --noEmit && npx vitest run && npx vite build
```
