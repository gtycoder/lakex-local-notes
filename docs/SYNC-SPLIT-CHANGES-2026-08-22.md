# 桌面同步拆分修改对照文档（供 GPT 审计）

> 日期：2026-08-22 ｜ 分支：`refactor/sync-split-desktop` ｜ 目的：逐条对照"原逻辑 → 新位置"，审计行为零变化
> **原逻辑可追溯**：
> - 原版完整文件：`git show master:electron/sync.ts`（1152 行，未拆分）
> - 当前分支 Step A 前：`git show 5270143:electron/sync.ts`（1152 行）
> - 当前分支现状：`electron/sync.ts` 945 行 + `src/core/{syncUtils,syncDecisions,sha256Sync}.ts`（新增）
> - master 的 src/core 无新文件（拆分产物只在 refactor/sync-split-desktop 分支，合入时带入）

## 0. 提交清单

| 提交 | 内容 |
|---|---|
| `b37e5ef` | Step A：14 纯逻辑函数 + 常量 + S3Settings 下沉 `src/core/syncUtils.ts` + `sha256Sync.ts` |
| `ccd9a9c` | Step B：6 判定 + G1 条目构造 + G2 记账 + G5 行映射 下沉 `src/core/syncDecisions.ts`；sync.ts 内联改调；noteQueries 映射走 core |
| `73d493d` | 双设备集成测试 + syncNow `createRemote` 注入钩子 |

## 1. Step A 逐函数对照（原：master electron/sync.ts；新：src/core/syncUtils.ts 或 sha256Sync.ts）

| # | 函数 | 原行号 | 新文件 | 适配点（行为等价依据） | 等价测试 |
|---|---|---|---|---|---|
| 1 | `syncSnapshot` | 30-46 | syncUtils | 无（原样迁移） | syncUtils.test（间接经 sync 测试） |
| 2 | `S3Settings` 类型 | 48-54 | syncUtils | 无（类型迁移） | — |
| 3 | `MANIFEST_VERSION` | 95 | syncUtils | 原值 4 不变 | — |
| 4 | `MAX_MANIFEST_BYTES/NOTES/FOLDERS` | 114-118 | syncUtils | 原值不变（20MB/200k/50k） | parseLakeManifest 超限测试 |
| 5 | `parseLakeManifest` | 121-136 | syncUtils | **Buffer→Uint8Array + TextDecoder**（默认替换与 Buffer.toString 一致） | 合法/非法 JSON/超限 4 例 |
| 6 | `GZIP_MAGIC`/`isGzip` | 138-140 | syncUtils | Uint8Array 魔数比较 | — |
| 7 | `objectKey` | 142 | syncUtils | 原样 | 格式测试 |
| 8 | `collectManifestRefs` | 856-864 | syncUtils | 原样 | — |
| 9 | `normalizeEndpoint` | 991-1003 | syncUtils | 原样 | — |
| 10 | `validateS3Settings` | 1005-1016 | syncUtils | 原样（re-export 保 quickNotesSync） | — |
| 11 | `errorMessage` | 1018-1024 | syncUtils | 原样（与 logger.ts 同名独立） | — |
| 12 | `isNoSuchKey` | 1026-1031 | syncUtils | 原样 | — |
| 13 | `sha256Hex` | 1033-1035 | syncUtils→sha256Sync | **node:crypto → 纯 JS 同步 SHA-256**（FIPS 180-4；输出一致） | sha256Sync.test 10 例（FIPS 向量/padding 边界/node:crypto/subtle） |
| 14 | `mimeTypeFor` | 1037-1045 | syncUtils | **node:path.extname → extnameLikeNode 纯 JS 复刻** | extname 13 边界用例 vs path.extname |
| 15 | `SAFE_KEY_RE`/`assertSafeKey` | 1048-1051 | syncUtils | 原样 | — |
| 16 | `chunkArray` | 1053-1057 | syncUtils | 原样 | — |
| 17 | `validateManifest` | 1060-1115 | syncUtils | 原样（上限参数注入） | validateManifest 6 例（版本/数组/超限/hash/墓碑放行/folders） |

**Step A 行为保持要点**：
- 全部是"移动代码位置"，原函数体逐行迁移；仅 3 处平台适配（#5/#13/#14），各有等价测试证明输出一致
- 常量随迁（#3/#4/#6/#15），sync.ts 改 import（原值不变）
- re-export 保外部调用方（quickNotesSync 依赖 S3Settings/mimeTypeFor/sha256Hex/validateS3Settings/isSafeSegment）

## 2. Step B 逐函数对照（原：sync.ts 内联判定；新：src/core/syncDecisions.ts）

| 函数 | 原逻辑位置（master 行号） | 原实现要点 | 新纯函数 | 行为等价依据 |
|---|---|---|---|---|
| `decidePurge` | 365-380 | rn.deleted：本地有→restore-pending 例外/applyRemotePurge；本地无→rememberDeleted | `(local, isRestorePending) → skip/apply-purge/remember-deleted` | 三态表驱动 3 例；sync.ts 改调后执行留在原处 |
| `decideLocalTombstone` | 382-397 | tombAt 判定：远端新→revoke；本地新→continue | `(remoteUpdatedAt, tombAt) → none/revoke/keep-local-delete` | 四态（含时间相等边界）4 例 |
| `decideTrashCross` | 402-429 | localInTrash vs remoteInTrash：远端入回收站（restore-pending 例外/留档+move）；远端恢复（updatedAt LWW） | `(local, rn, isRestorePending) → no-cross/move-to-trash/restore/keep-trash/skip-restore-pending` | 六态 6 例（含 LWW 边界） |
| `decideMetaApply` | 454-459 | lastMeta null 或远端新→应用远端 | `(remoteUpdatedAt, lastMeta) → boolean` | 3 例 |
| `decideTrashYield` | 580-588 | 本地回收站 vs 远端 active 更新→让位 | `(note, remoteActive) → boolean` | 4 例 |
| `decideTombstoneYield` | 668-675 | 远端 active 更新→墓碑让位 | `(deletedAt, remoteNote) → boolean` | 4 例 |
| `buildUploadEntry` | 601-608（skip-fast）/650-656（正常） | v4 编码：parentId/trashedAt/deletedFromParentId/isLocked/lockedAt/icon；TRASH 才有 trashedAt 字段 | `(note, contentHash, assets, trashedAt?, deletedFromParentId?) → ManifestNote` | 4 例（含 v4 编码逐字段断言：非 TRASH 无 trashedAt/deleted 字段） |
| `buildTombstoneEntry` | 688-693 | deleted:true + deletedAt，不携带资源 | `(deleted, tombHash) → ManifestNote` | 1 例 |
| `computeBookkeeping` | 712-725 | deleted 墓碑跳过；快照=manifest 字段 | `(manifestNotes) → BookkeepingItem[]` | 2 例（墓碑跳过/快照字段） |
| `rowToLocalState`（G5） | noteQueries.ts 177-190 | SyncNoteRow → SyncNote（snake_case 映射） | `(row) → LocalNoteState` | 1 例（字段映射全断言） |

**Step B 行为保持要点**：
- 判定逻辑从 sync.ts 内联提取为纯函数（输入=状态快照，不依赖 store）；**store 写操作留在 sync.ts 原处**，由判定结果驱动——执行与判定分离，行为不变
- sync.ts 改调点：purge 分支/墓碑 LWW/TRASH 交叉/元数据 LWW/trash-yield/tombstone-yield/条目构造×3/记账——每处替换后 tsc + 全量测试验证
- noteQueries.listNotesForSync 行映射 → core rowToLocalState（字段一一对应）

## 3. 验证证据（全量 510 passed 构成）

| 类别 | 数量 | 说明 |
|---|---|---|
| 原测试基线 | 416 | 拆分前后全绿（行为零变化核心证据） |
| sha256Sync 等价 | +10 | 纯 JS vs node:crypto vs subtle |
| syncUtils 等价 | +28 | extname 13 边界/parseLakeManifest/validateManifest |
| syncDecisions 表驱动 | +30 | 6 判定 + G1/G2/G5 |
| 双设备集成 | +6 | 真实 Store×2 + mock S3：建/编辑/删除传播/恢复/冲突/防复活 |
| 合计 | 510 passed + 1 skipped | tsc ✅ / 边界检查 0 违规 ✅ |

## 4. 审计核对建议

1. **逐函数对照 §1/§2 表**：`git show master:electron/sync.ts`（原）vs 当前 `src/core/*`（新）——原函数体应逐行可对
2. **三处平台适配**：#5 TextDecoder、#13 纯 JS SHA-256、#14 extname——等价测试是最强证据（与 node 实现输出一致）
3. **判定函数**：§2 表的"原实现要点"与 syncDecisions 纯函数逻辑逐一比对
4. **执行留在原处**：sync.ts 改调后 store 写/S3 IO 位置未变（git diff 可查）
5. **git diff 汇总**：`git diff 5270143..HEAD --stat`（总改动面）

## 5. 明确未改

- manifest 协议（v4 编码不变，§2 build* 逐字段断言）
- 桌面 GC（runGcReconcile/runDeepCleanup 原样保留）
- quickNotesSync（独立实现，仅依赖 re-export）
- store 写入路径（applyRemote* 等原样）
