# S3 存储与 GC 契约

> 当前实现：`electron/s3Store.ts`（传输）· `electron/s3Maintenance.ts`（keep 集、对账、深度清理、manifest prune）· `src/core/gcPolicy.ts` / `src/core/gcDecisions.ts`（纯策略）。
> 本地是唯一真相，S3 只是镜像；GC 最坏只丢云端冗余，随后可由本地重新上传自愈。

## 1. 对象与 Manifest
- Lake 正文：`objects/{noteId}-{contentHash}.lake`（内容寻址）。
- Lake 资产：`assets/{noteId}/{filename}`（文件名不可变，内容用 size+sha256 校验）。
- Lake Manifest：`version=2`（V1 可读用于升级；V2 正式支持 `kind="ink"`），`manifests/latest.json` 指向当前 commit。
- 历史 commit：`manifests/{commitId}.json`；保留 `MANIFEST_CHAIN_KEEP=3` 条 `prevCommitId` 链。
- 小记独立空间：`quick-notes/objects/*`、`quick-notes/assets/*`、`quick-notes/manifests/*`。

> ⚠️ **别把两个「历史」混起来**（261012 用户核对时问到，此处补一条名词区分）：
> · `manifests/{commitId}.json` = **清单的版本链**（在云端，保留 3 代）—— 用来做 GC 对账与回滚保护，**不是**文档历史；
> · `history/{noteId}/*.body.gz`（261019 前为 `*.lake.gz`）+ `note_history` 表 = **文档历史快照**，属 **L3 纯本机**（判据见 `docs/STORAGE-LAYERS.md`
>   §分层表与 FAQ）—— **不上传、不进 manifest**，每端独立；
> · 它与 S3 的唯一关系是本节 §2 第 4 条：**本机**历史引用到的资产（那些字节本就在 S3 上，属文档资产）
>   在 GC 时被 **best-effort 保护** —— 方向是「别删我引用的」，不是「把我的历史传上去」。

## 2. 权威 keep 集
云端对象可删当且仅当它不被任何在留引用闭包保护。Lake keep 集来源：
1. `manifests/latest.json`；
2. latest 清单中的 notes、folders、正文和 assets；
3. `prevCommitId` 链上保留的历史 manifest 及其引用；
4. 本机历史快照 `getProtectedRefs()` 引用的资源（best effort）。

小记 GC 使用独立 keep 集。共享函数 `buildGcKeepSet` 是唯一引用闭包实现，UI 诊断与真实删除必须共用。

## 3. 待回收与对账
- 同步发布新 manifest 后，旧正文/资源若不再被 latest 引用，登记到 `s3_gc_pending`。
- `runGcReconcile` 逐行处理 pending：
  - 已过窗口且不在 keep → 删除对象并清 pending；
  - 已过窗口但重新进入 keep → 清 pending，不删对象；
  - 窗口内或时间戳非法 → 保守保留。
- 手动对账可显式忽略保留窗口；自动对账遵守 `gcRetentionDays`。

## 4. 深度清理
`runDeepCleanup` 扫描 Lake 的全部 `objects/`、`assets/`、`manifests/`，差集删除：
- 不存在的 → 忽略；
- 在 keep 集 → 永不删；
- 不在 keep 集且已过窗口 → 删除并写 `s3_gc_log`；
- `dryRun` 只返回候选。

小记深度清理使用独立入口，不与 Lake 结果混算。

## 5. Manifest 裁剪
`pruneOldManifests` 采用滞后水位：文件数未超过 `2 + KEEP + SLACK` 时只做一次 list；超过后沿 `prevCommitId` 计算 keep 集并删除链外旧 commit。删除失败不阻断同步，下轮重试。

## 6. 安全红线
- 禁止逐对象 HEAD/GET 探测资产存在性；资产存在性以远端清单声明差集为准。
- `manifest.assets` 永远全量声明，不能只声明本次上传项。
- 禁止使用本机持久缓存推断云端对象仍存在。
- GC 只能删除“不在权威 keep 集”且满足窗口保护的对象。
- purge 必须无条件写永久墓碑；`purged_at` 只是前缀删除工作标记。
- 所有 GC/深度清理共用串行维护队列，避免与同步并发互删。
