# 桌面同步拆分详细方案（SYNC-SPLIT-PLAN v3，含第三方审计 G1-G6 吸收）

> 分支：`refactor/sync-split-desktop`（master `1ffe0c2`）
> 审计：`doc_share/SYNC-SPLIT-PLAN-AUDIT-2026-08-22.md`（结论：方案合理可执行；G1-G6 已吸收）
> 原则：从桌面 sync.ts 按移动端需求拆分（需要哪个拆哪个，拆时不改行为），拆完两端同一套存储机制；
> **共享友好**：拆出函数纯函数形态 + 状态快照参数 + 独立测试 + 两端同一批实例 + 天然可抽包。

---

## 1. sync.ts 编排段全景（327-848，实测行号）

```
syncNow(store, onProgress)
├─ 0 连接+拉manifest    (330-342)  settings/validate/ObjectStore/test/getOptional/parseLakeManifest
├─ 1 零变更早退          (344-358)  commitId + hasLocalPendingNotes + tombstoneSignature
├─ 2 下载阶段            (360-599)
│   ├─ 2.0 准备           (372-383)  tombstoned / localById / baseInfo（3 个批量查询）
│   ├─ 2.1 folders 导入   (384-390)  importRemoteFolder + validParents
│   ├─ 2.2 逐条循环       (394-597)  (a)路径校验 (b)effectiveParent (c)purge (d)本地墓碑LWW
│   │                              (e)TRASH交叉 (f)正文相同→锁/元数据LWW (g)下载正文 (h)下载资源
│   │                              (i)reconcile (j)remote-wins(superseded留档)
├─ 3 上传阶段            (601-709)  purged-skip / trash-yield / skip-fast / 资源扫描上传 / .lake上传
├─ 3.5 墓碑上传          (711-745)  LWW + 读.lake算hash + 携带删除前内容
├─ 4 写 manifest         (747-779)  排序 + folders + commit/latest(gzip) + prune
├─ 4.1 记账              (781-799)  setLastUploadedHash + setBaseHash + markSyncedIfUnchanged + markFolderSynced
├─ 4.5 GC 标记/撤销      (801-825)
├─ 4.6 purge 删除        (827-836)
└─ 5 收尾                (838-847)
```

## 1.5 共享友好设计原则（核心目的：拆分产物必须方便两端共享）

1. **纯函数形态**：无副作用、无平台依赖（core 边界检查强制：禁 electron/node:/react/Buffer/DOM）。
2. **不绑定任何端的数据形态**：参数是"状态快照"（普通对象），不接收 store 实例 / Buffer / fs 句柄——桌面从 store 读状态传入，移动端从 sql.js 读同样的状态传入，**同一函数、两种调用方**。
3. **独立测试**：每个拆出函数带表驱动测试（mock 输入，不依赖桌面环境）——移动端直接复用同一批测试（语义等价护栏）。
4. **同一批实例**：移动端执行壳 import 的决策函数 = 桌面 syncNow import 的同一批（不是复制）；改动 core 一处，两端生效。
5. **天然可抽包**：无依赖纯函数 + 独立测试 → 未来加 package.json/exports 即成独立 workspace 包（V5 §10 路径），工程迁移零逻辑改动。

**验收硬指标**（挂进每个 Step 的验收）：拆出函数在移动端检出可 import + mock 输入跑通（无桌面依赖）；两端引用同一批函数实例。

---

## 2. 拆分粒度（决策+条目构造+记账+映射 共享；执行时序各端）

**store 耦合事实**：syncNow 调用 30+ store 方法 → 全循环端口化 = SyncDbPort 膨胀失控。
**结论（v3）**：共享**语义载体**（判定 + 条目构造 + 记账决策 + 行映射），执行**时序**各端实现 + 双端 A/B 强验。

### 共享语义载体（进 core，全表驱动测试）

| 类别 | 函数 | 来源行 | 输入 → 输出 |
|---|---|---|---|
| 纯逻辑 | 14 个（见 Step A） | 30-1060 | 见 Step A 表 |
| 分支判定 | `decidePurge` | 409-424 | (local, rn, isRestorePending) → apply-purge \| remember-deleted \| skip |
| | `decideLocalTombstone` | 426-441 | (remoteUpdatedAt, tombAt) → revoke \| keep-local-delete |
| | `decideTrashCross` | 446-473 | (localInTrash, remoteInTrash, rn, trashedAt, isRestorePending) → move-to-trash \| restore \| keep-trash \| skip |
| | `decideMetaApply` | 498-503 | (rn, lastSyncedMetaAt) → boolean |
| | `decideTrashYield` | 630-638 | (note, remoteActive) → boolean |
| | `decideTombstoneYield` | 718-725 | (deleted, remoteNote) → boolean |
| **条目构造（G1）** | `buildUploadEntry` | 651-658/700-706 | (note, remoteEntry?, hash, assets) → ManifestNote（v4 编码：parentId/trashedAt/deletedFromParentId/isLocked/icon） |
| | `buildTombstoneEntry` | 738-744 | (deleted, tombHash) → ManifestNote（deleted:true + deletedAt，**不携带资源**） |
| **记账决策（G2）** | `computeBookkeeping` | 781-794 | (manifestNotes) → 每笔记 { setLastUploadedHash?, setBaseHash?, markSyncedIfUnchanged? }（**deleted 墓碑跳过**；快照 = manifest 字段） |
| **行映射（G5）** | `rowToLocalState` | noteQueries.ts 30-85 | (row) → LocalState（SyncNote 形态：id/title/parentId/sortOrder/updatedAt/syncState/isLocked/lockedAt/icon/trashedAt/deletedFromParentId）——两端同一映射，避免"同一状态两种解读" |

> 已有共享：lakeReconcile / decideUpload / mergeLockState / manifestTypes / assetUrl / syncDecision。

## 3. 分步实施（每步 408 全绿 + 边界检查 + 表驱动测试 + §1.5 硬指标）

### Step A：纯逻辑段下沉 core（14 个，零风险）

| 函数 | 行 | 说明（含审计 G6 修正） |
|---|---|---|
| `syncSnapshot` | 30 | 记账快照纯函数 |
| `parseLakeManifest` | 121 | **改 TextDecoder 解析**（core 禁 Buffer；输入 Uint8Array） |
| `isGzip` | 138 | gzip 魔数检测（Uint8Array） |
| `objectKey` | 142 | **补入清单（G6）**：objects 键构造 |
| `collectManifestRefs` | 856 | GC refs（纯 Set 运算） |
| `normalizeEndpoint` | 991 | endpoint 规范化 |
| `validateS3Settings` | 1005 | S3 配置校验 |
| `errorMessage` | 1018 | 错误消息提取 |
| `isNoSuchKey` | 1026 | 404 判定 |
| `mimeTypeFor` | 1037 | 文件名→MIME |
| `assertSafeKey` | 1049 | S3 键安全 |
| `chunkArray` | 1053 | 分块 |
| `validateManifest` | 1060 | **manifest 校验（审计 C3）**，上限参数注入 |
| `sha256Hex` | 1033 | 输出一致（SHA-256 确定性）；core 用 Uint8Array（crypto.subtle），桌面 re-export Buffer 版（内部转 Uint8Array） |

**验收**：git diff 仅"移动 + re-export"；408 全绿；边界检查 0 违规；validateManifest/parseLakeManifest 表驱动测试；**§1.5 硬指标**（移动端检出 import + mock 跑通）。

### Step B：语义载体纯函数化（核心：6 判定 + G1 条目 + G2 记账 + G5 映射）

按 §2 表逐个抽纯函数，syncNow 改调；每个函数带表驱动测试（覆盖 LWW 时间边界/例外分支/v4 编码字段断言）。

**G1 表驱动断言重点**：`buildUploadEntry` 在 skip-fast/正常/回收站三态下的 `parentId`/`trashedAt`/`deletedFromParentId`/`deleted` 字段与桌面 651-658/700-706 逐字段一致（防旧 C1 编码漂移复发）。
**G2 断言重点**：deleted 墓碑不产生 lastUploadedHash；快照 = manifest 字段（V5 §5.2）。

**验收**：全部表驱动绿 + syncNow 改调后 408 全绿（行为零变化）+ §1.5 硬指标。

### Step C/D（可选）：执行循环端口化评估

移动端实际需要的 SyncDbPort 方法子集（~15 个）列出后对比全量：若子集可满足语义等价 → 执行层保持各端（方案 X 成立）；否则评估全端口化（方案 Y）。

### Step E：移动端接线 + 双端真机 A/B（强制验收）

- 移动端 adapter（S3Store + SyncDbPort 子集）+ 执行壳：调 Step A/B 拆出的同一批函数
- C2 修复（saveNote 置 local）从 mobile-capacitor 带入
- **G3 显式决策**（见 §4）
- **G4 双端真机场景清单**（见 §5）

## 4. G3：superseded 历史快照的移动端策略（显式决策）

桌面语义：本地编辑被远端覆盖 → `createHistorySnapshot` 强制留档（协议 §4.2）。

**选项 A（推荐）：sql.js 轻量历史表对齐**
- 移动端 notes 旁加 `history` 表（note_id/content/created_at/ref_count 简化版），superseded 时存被覆盖前 content
- 成本低（一张表 + 写路径），语义与桌面对齐（被覆盖内容可找回）
- 验收：双端"被覆盖留档"行为一致（真机 A/B）

**选项 B：明确降级**
- 移动端不做历史快照，仅 supersededNotes 提示（UI 提醒"本地版本已被覆盖"）
- 风险：本地编辑被覆盖后不可找回——违反协议 §4.2"强制留档"语义
- 需产品裁决（用户接受降级才可选）

**本方案默认选 A**（对齐语义），若产品裁决选 B 需在计划中显式标注。

## 5. G4：措辞修正 + 双端真机场景清单

**修正**：目标终态从「语义演进只改 core 一处」改为「**语义判定/条目构造/记账决策单源（core）**；执行时序各端实现，由**双端真机 A/B 强制验收**保证行为一致」。

**真机 A/B 场景清单**（Step E 强制验收，逐一过）：
1. gzip manifest：桌面先同步发布 → 手机后同步拉取（manifest 压缩互读）
2. 删除传播：手机删 → 同步 → 桌面拉到回收站（软删编码一致）
3. 恢复例外：桌面恢复 → 同步 → 手机跟随恢复（restore-pending/LWW）
4. purge：桌面 purge → 同步 → 手机防复活（deleted 墓碑学习）
5. 图片：桌面有图笔记 → 手机 blob 显示；手机贴图 → 桌面 http 显示（H3 + assetUrl）
6. 锁/图标：桌面设锁 → 手机锁状态下一致（mergeLockState LWW）
7. 冲突：两端离线各改 → 先后同步 → superseded 留档 + 内容可找回（G3 决策生效）
8. 记账：双端各自编辑后同步 → lastUploadedHash/skip-fast 行为一致

## 6. 验收标准（整体）

1. `src/core` 含全部纯逻辑 + 语义载体（Step A/B 产物），边界检查 0 违规
2. 桌面 408 测试全程全绿（每步）+ 语义载体表驱动测试绿（含 v4 编码逐字段断言）
3. **§1.5 共享硬指标**：拆出函数移动端检出可 import + mock 跑通；两端同一批实例
4. 双端真机 A/B（§5 清单 8 场景）行为一致
5. 语义载体单源：改 core 一处两端生效（判定/条目/记账/映射）

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 决策函数抽离改变判定次序 | 表驱动测试覆盖原内联路径；408 全绿护栏 |
| 条目构造漂移（旧 C1 复发） | buildManifestEntry 表驱动逐字段断言（G1） |
| 记账语义漂移（旧 H1 复发） | computeBookkeeping 表驱动（G2） |
| 执行时序双份不一致 | 双端真机 A/B 8 场景强制验收（G4） |
| superseded 移动端策略未定 | §4 显式决策（默认 A 对齐） |
| 与并行会话冲突 | 独立分支；合入前 rebase master |

## 8. 明确不做（本阶段）

- 不合并 GC（runGcReconcile/DeepCleanup 留桌面）
- 不改 manifest 协议（v4 不变）、不引入 CAS
- 不预先设计完整共享引擎（需要哪个拆哪个）
- Step C/D（执行端口化）非默认必做

## 9. 执行顺序（审计建议，确认）

Step A（14 函数，含 objectKey）→ Step B（6 判定 + G1 条目 + G2 记账 + G5 映射，全表驱动）→ G3 决策确认（默认 A）→ Step C/D 按需评估 → Step E 接线 + 双端真机 A/B（§5 清单）为强制验收。

## 10. 执行记录（2026-08-22，分支 refactor/sync-split-desktop）

### Step A ✅（提交 b37e5ef）
- 14 纯逻辑函数 + 7 常量 + S3Settings 类型下沉 `src/core/syncUtils.ts` + `sha256Sync.ts`
- 等价测试 38 例（sha256 FIPS/边界、extname 13 边界、parseLakeManifest、validateManifest 抛错）
- sync.ts 1152→984 行；全量 474 passed

### Step B ✅（提交 ccd9a9c）
- `src/core/syncDecisions.ts`：6 判定（decidePurge/LocalTombstone/TrashCross/MetaApply/TrashYield/TombstoneYield）
  + G1 条目构造（buildUploadEntry v4 编码逐字段断言 / buildTombstoneEntry）+ G2 记账（computeBookkeeping）
  + G5 行映射（rowToLocalState）
- sync.ts 内联判定全部改调 core（执行留本地，判定单源）；noteQueries 映射走 rowToLocalState
- 30 表驱动测试；全量 504 passed

### Step C/D 评估结论：不执行（方案 X 成立）
- 移动端执行壳可直接调 core 决策函数（decide*/build*/compute*），无需全循环端口化
- 全端口化 = SyncDbPort 覆盖 30+ store 方法 → 膨胀失控，且移动端 sql.js adapter 工作量翻倍
- **执行层保持各端（方案 X）**：语义载体单源 + 执行时序双端真机 A/B 强验

### Step E（待执行）：移动端接线
1. 引入 `src/mobile/`（当前分支无——在 refactor/mobile-capacitor 分支；需 checkout 或 merge）
2. 移动端执行壳重写：调 core syncUtils/syncDecisions（废弃原 syncEngine 自研编排）
3. sql.js adapter（dbPort 思路）+ CapacitorHttp（s3Store 思路）对齐
4. C2 修复（saveNote 置 sync_state='local'）从 mobile-capacitor 带入
5. 双端真机 A/B（§5 清单 8 场景）强制验收
6. G3 决策确认（默认 sql.js 轻量历史表对齐 superseded）

### 已知待办（拆分之外）
- H3 assets 进端口契约（与图片方案 lake-asset/blob 联动，待图片方案落地）
- H4 folders 导入/发布（移动端）
- G3 superseded 移动端历史表
