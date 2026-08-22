# 桌面同步拆分详细方案（SYNC-SPLIT-PLAN v2，供第三方审计）

> 分支：`refactor/sync-split-desktop`（master `df29fa7` + 计划文档）
> 审计对象：`electron/sync.ts`（1152 行，v4 协议基准实现）——**拆分源，语义权威**
> 原则（用户确认）：从桌面按移动端需求拆分（需要哪个拆哪个，拆时不改行为），拆完两端同一套存储机制。
> 前置：`src/core/` 已有 V5 Phase 1 决策纯函数（lakeReconcile/decideUpload/syncDecision/manifestTypes）+ master 新增 assetUrl。

---

## 1. sync.ts 编排段全景（327-848，实测行号）

```
syncNow(store, onProgress)
├─ 0 连接+拉manifest    (330-342)  settings/validate/ObjectStore/test/getOptional/parseLakeManifest
├─ 1 零变更早退          (344-358)  commitId + hasLocalPendingNotes + tombstoneSignature（store 强耦合）
├─ 2 下载阶段            (360-599)
│   ├─ 2.0 准备           (372-383)  tombstoned Map / localById / baseInfo（3 个 store 批量查询）
│   ├─ 2.1 folders 导入   (384-390)  importRemoteFolder + isSafeSegment + validParents
│   ├─ 2.2 逐条循环       (394-597)
│   │   ├─ (a) id/asset 路径校验   (398-403) isSafeSegment
│   │   ├─ (b) effectiveParent     (404-405) validParents 兜底 → defaultNotebook
│   │   ├─ (c) purge 分支          (409-424) applyRemotePurge / rememberDeleted / restore-pending 例外
│   │   ├─ (d) 本地墓碑 LWW        (426-441) revokeLocalDeletion / 本地删除较新 continue
│   │   ├─ (e) TRASH 交叉          (446-473) move-to-trash(留档+superseded) / restore / keep-trash
│   │   ├─ (f) 正文相同分支        (474-516) 锁 LWW + 元数据 LWW + 记账去重
│   │   ├─ (g) 下载正文            (517-525) getOptional + B 方案 warning
│   │   ├─ (h) 下载资源            (526-552) runPool + size/sha256 校验 + AssetMissingError
│   │   ├─ (i) reconcile 判定      (553-578) lakeReconcile（已有）+ local-wins 记账
│   │   └─ (j) remote-wins         (579-596) createHistorySnapshot(superseded) + importRemoteNote
│   └─ 2.3 收尾           (598)
├─ 3 上传阶段            (601-709)
│   ├─ 3.0 purged skip   (627)
│   ├─ 3.1 trash-yield   (630-638)  远端恢复较新 → 本端删除让位
│   ├─ 3.2 skip-fast     (639-660)  decideUpload（已有）+ 缓存 hash + 远端 assets 复用
│   ├─ 3.3 资源扫描      (661-683)  fs 读目录 + currentRefs + sha256
│   ├─ 3.4 资源上传      (686-689)  runPool + remote.put
│   ├─ 3.5 .lake 上传    (692-699)
│   └─ 3.6 manifestNotes (700-706)
├─ 3.5 墓碑上传          (711-745)  listDeletedNotesForSync + LWW + 读 .lake 算 hash + put + deleted 条目
├─ 4 写 manifest         (747-779)  排序 + folders + commit/latest(gzip) + pruneOldManifests
├─ 4.1 记账              (781-799)  setLastUploadedHash + setBaseHash + markSyncedIfUnchanged + markFolderSynced
├─ 4.5 GC 标记/撤销      (801-825)  addS3GcPending / removeS3GcPending / getProtectedRefs
├─ 4.6 purge 删除        (827-836)  deletePrefix + markPurgeSynced
└─ 5 收尾                (838-847)  markSyncComplete / recordSyncResult / setLastSeenCommitId / setLastTombstoneSig
```

## 1.5 共享友好设计原则（核心目的：拆分产物必须方便两端共享）

拆出的每个模块/函数必须满足（否则不算拆成功）：

1. **纯函数形态**：无副作用、无平台依赖（core 边界检查强制：禁 electron/node:/react/Buffer/DOM）；输入输出全是普通数据类型（string/number/boolean/null/接口对象）。
2. **不绑定任何端的数据形态**：函数参数是"状态快照"（普通对象，如 `{ id, parentId, trashedAt, syncState }`），不接收 store 实例 / Buffer / fs 句柄——桌面从 store 读状态传入，移动端从 sql.js 读同样的状态传入，**同一函数、两种调用方**。
3. **独立测试**：每个拆出函数带表驱动测试（mock 输入，不依赖桌面环境）——移动端直接复用同一批测试（语义等价护栏）。
4. **移动端可直接 import**：移动端执行壳 import 的决策函数 = 桌面 syncNow import 的同一批（同一实例，不是复制）；改动 core 一处，两端生效。
5. **天然可抽包**：无依赖纯函数 + 独立测试 → 未来加 package.json/exports 即成独立 workspace 包（V5 §10 的 npm workspaces 路径），工程迁移零逻辑改动。

**验收硬指标**：每个拆出函数在"移动端检出"可 import + mock 输入跑通（无桌面依赖）；移动端执行壳与桌面 syncNow 引用同一批函数实例。

---

## 2. 关键事实：store 耦合清单（拆分粒度的决定性约束）

syncNow 直接调用 **store 方法 30+**（非全部，抽样）：

```text
批量读：listNotesForSync / listDeletedNotesForSync / allSyncBaseInfo / listFoldersForSync /
        listPurgedNotesForSync / hasLocalPendingNotes / tombstoneSignature / getLastSeenCommitId
单条读：baseHash / lastUploadedHash / contentHash / getCurrentContentRefs / isRestorePending /
        notePathFor / noteAssetsPathFor / getProtectedRefs / getS3Settings
写入：importRemoteFolder / importRemoteNote / applyRemotePurge / applyRemoteMoveToTrash /
      applyRemoteRestore / applyRemoteLock / applyRemoteNoteMeta / revokeLocalDeletion /
      rememberDeleted / createHistorySnapshot / setBaseHash / setLastUploadedHash /
      markSyncedIfUnchanged / markFolderSynced / markPurgeSynced / markSyncComplete /
      recordSyncResult / setLastSeenCommitId / setLastTombstoneSig / addS3GcPending / removeS3GcPending
```

**结论**：把整个 syncNow 循环端口化进 core = `SyncDbPort` 覆盖 30+ 方法 ≈ **把 store 也抽出去**（那是另一层级的工程，且移动端 sql.js 要对齐 30+ 方法语义）。**必须区分"决策层"与"执行层"的拆分粒度**。

## 3. 拆分粒度设计：决策层共享（X） vs 执行层端口化（Y）

### 方案 X（推荐先做）：决策/纯逻辑共享，执行各自

- **进 core**：纯逻辑函数 + **分支决策纯函数**（sync.ts 内联判定抽成纯函数，输入状态 → 动作枚举）
- **留桌面**：syncNow 执行编排（store 方法调用 + S3 IO），改为调用拆出的决策函数
- **移动端**：用自己的执行壳（sql.js + CapacitorHttp），调用同一批决策函数——**语义单源，执行各自**
- 符合"需要哪个拆哪个"：先拆移动端真正需要的（决策 + 校验 + 类型）

### 方案 Y（后置评估）：连执行循环也端口化

- `SyncDbPort` 覆盖 30+ store 方法，syncNow 整段搬进 core
- 桌面/移动端共用完整循环（执行也单源）
- 代价：端口接口巨大、移动端 sql.js adapter 工作量翻倍、store 事务边界/并发语义要对齐——**高风险，等方案 X 稳定后按需评估**

**建议**：方案 X 先行（Step A/B），方案 Y 作为可选项（Step C/D）——先证明决策共享价值，再决定执行是否也单源。

## 4. 分步实施（每步 408 测试全绿 + 边界检查 + 独立表驱动测试）

### Step A：纯逻辑段下沉 core（零风险，先做）

从 sync.ts 搬 13 个函数到 `src/core/syncUtils.ts`（或并入现有文件），sync.ts 改 import + re-export：

| 函数 | 行 | 去向 | 说明 |
|---|---|---|---|
| `syncSnapshot` | 30 | core | 记账快照纯函数（已依赖 core 类型） |
| `parseLakeManifest` | 121 | core | manifest 字节解析 |
| `isGzip` | 138 | core | gzip 魔数检测 |
| `collectManifestRefs` | 856 | core | GC refs（纯 Set 运算） |
| `normalizeEndpoint` | 991 | core | endpoint 规范化 |
| `validateS3Settings` | 1005 | core | S3 配置校验 |
| `errorMessage` | 1018 | core | 错误消息提取 |
| `isNoSuchKey` | 1026 | core | 404 判定 |
| `mimeTypeFor` | 1037 | core | 文件名→MIME |
| `assertSafeKey` | 1049 | core | S3 键安全 |
| `chunkArray` | 1053 | core | 分块 |
| `validateManifest` | 1060 | core | **manifest 校验（审计 C3）** |
| `sha256Hex` | 1033 | core（决策） | Buffer 版 vs crypto.subtle 版：输出一致（SHA-256 确定性），桌面 re-export 保留 Buffer 版 |

**验收**：git diff 仅"移动 + re-export"；408 全绿；边界检查 0 违规；validateManifest 带表驱动测试（畸形清单/超上限/路径注入）。
**共享形态**：全部纯函数 + 普通类型参数（`parseLakeManifest(bytes: Uint8Array)`、`validateManifest(obj: unknown, limits)`、`mimeTypeFor(name: string)` 等）——移动端 manifest 解析/校验直接 import 调用。

### Step B：分支决策纯函数化（核心，两端共享语义）

把 syncNow 内联判定抽成 core 纯函数（输入本地/远端状态 + 基线 → 动作），syncNow 改调；移动端执行壳复用：

| 决策函数 | 来源行 | 输入 → 输出 | 关键语义 |
|---|---|---|---|
| `decidePurge(local, rn, isRestorePending)` | 409-424 | → "apply-purge" \| "remember-deleted" \| "skip(restore-pending)" | purge 不广播强制删除；本地有副本保留 purged；restore-pending 例外 |
| `decideLocalTombstone(remoteUpdatedAt, tombAt)` | 426-441 | → "revoke" \| "keep-local-delete" | 删除 vs 远端恢复按 updatedAt LWW |
| `decideTrashCross(localInTrash, remoteInTrash, rn, trashedAt, isRestorePending)` | 446-473 | → "move-to-trash" \| "restore" \| "keep-trash" \| "skip(restore-pending)" | 删除压编辑（本地留档 superseded）；恢复 vs 删除 LWW |
| `decideMetaApply(local, rn, lastSyncedMetaAt)` | 498-503 | → boolean（是否应用远端 meta） | 先同步者胜：远端 updatedAt 新于已确认版本 → 应用 |
| `decideTrashYield(note, remoteActive, now)` | 630-638 | → boolean（上传侧让位） | 本地回收站 vs 远端已恢复较新 → 删除让位 |
| `decideTombstoneYield(deleted, remoteNote)` | 718-725 | → boolean（墓碑让位） | 远端恢复较新 → 墓碑不覆盖 |

> 锁 LWW 已共享（`mergeLockState`）；正文 reconcile/上传 skip 已共享（`lakeReconcile`/`decideUpload`）。
> **注意**：这些函数带 `isRestorePending` 等**状态谓词参数**（不依赖 store），纯函数化输入由执行层提供。

**验收**：每个决策函数表驱动测试（覆盖 LWW 时间边界/例外分支）；syncNow 改调后 408 全绿（行为零变化——纯函数输出与原内联判定一致）。
**共享形态**：`decidePurge(local: LocalState | null, rn: ManifestNote, isRestorePending: boolean)` 等——`LocalState` 是普通状态对象（id/parentId/trashedAt/syncState/isLocked/lockedAt...），桌面从 store 行映射，移动端从 sql.js 行映射；`isRestorePending` 等谓词由执行层传入（不依赖 store 方法）。

### Step C（可选，方案 Y）：下载循环端口化评估

- 若移动端需要"执行也单源"：`SyncDbPort` 扩展（30+ 方法），下载段搬 `src/core/syncDownload.ts`
- **评估门槛**：Step B 稳定后，列出移动端实际需要的 SyncDbPort 方法子集（POC 只需要 ~15 个），对比全量——若子集即可满足语义等价，则执行层**保持各自**（方案 X 成立）；否则评估全端口化

### Step D（可选）：上传/发布/记账端口化（同 C 评估）

### Step E：移动端接线

- 移动端 adapter：`S3Store`（CapacitorHttpHandler，已有）+ `SyncDbPort`（sql.js，按 Step C 定界）
- 移动端执行壳：调 Step A/B 拆出的函数（语义与桌面一致），不再有自研引擎
- C2 修复（saveNote 置 sync_state='local'）从 mobile-capacitor 带入

## 5. 验收标准（整体）

1. `src/core` 含全部纯逻辑 + 决策函数（Step A/B 产物），边界检查 0 违规
2. 桌面 408 测试全程全绿（每步）+ 移动端决策函数表驱动测试绿
3. 双端真机 A/B（gzip manifest、删除/恢复/墓碑、purge、图片）行为一致
4. 语义演进只改 `src/core` 决策函数一处（执行层各端不承载语义）

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 决策函数抽离改变判定次序（如 restore-pending 检查位置） | 表驱动测试覆盖原内联路径的输入输出；408 全绿为护栏 |
| sha256 双版本 | 输出一致；测试断言 hash 相等 |
| 执行层两端行为差异（store 事务/并发 vs sql.js） | 双端 A/B 真机验证为强制验收 |
| 与并行会话冲突（master 图片方案/其他） | 独立分支；合入前 rebase |
| Step C 端口膨胀失控 | 以移动端实际需要定界（子集优先），全量仅按需评估 |

## 7. 明确不做（本阶段）

- 不合并 GC（runGcReconcile/DeepCleanup 留桌面）
- 不改 manifest 协议（v4 不变）、不引入 CAS
- 不预先设计完整共享引擎（需要哪个拆哪个）
- Step C/D（执行端口化）**不是默认必做**——以移动端需求为准（方案 X 优先）
