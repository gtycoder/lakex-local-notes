# 07 · RFC：收敛式同步内核 v4（Convergence Kernel）

| 项 | 值 |
|---|---|
| 状态 | Draft（待用户评审；本 RFC 通过后按 §12 拆 PR 实施） |
| 作者 | Lead（基于 `02`–`06` 审计） |
| 日期 | 2026-10-27 / 基线 `master @ ea576a80`（审计快照 41def9f0） |
| 关联 | `05-sync-data.md`（证据）、`06-redesign.md`（设计）、`AGENTS.md` §2–§4、`docs/S3-REDESIGN.md` §6/§15.1 |
| 影响面 | `src/core/s3v3*`、`electron/s3v3/*`、`src/mobile/v3/*`、`electron/store.ts`、`src/mobile/data/*`、桌面/移动同步 UI 契约 |
| 协议 | **wire format 不变**（pointer / 不可变索引 / 每篇资产声明 / 内容寻址对象） |

---

## 1. 摘要

v3 的**协议**是对的：内容寻址、单 pointer、无墓碑、三方合并、声明差集，这些不变量已被 54 个测试文件锁住，且通过了真实多端演练。问题在**编排层**：`src/core/s3v3Engine.ts` 1895 行 / 55 方法，`incrementalSync` 单方法约 515 行，把「意图判定 + 远端读取 + 正文/声明预取 + 逐条应用 + 上传 + 发布 + 清理」揉在一起；跨轮状态退化成 `DeviceState` 上 9 个可选账本（intents/pending/remotePurged/restorePending/quickDeletes/quickPurges/quickPurgeTimes/archived/pendingAssets），每个线上 bug 都新增一本账；双端设备存储各写一遍（481 + 809 行）并用 496 行 conformance 对账；协议之外还有 3 张 manifest 时代的死账本在被读（`sync_base` / `declared_assets` / `published_at`），直接导致「缺正文误判无备份」「待同步数永久挂起」。

本 RFC 提出 **v4：把「同步」从一堆补丁恢复成一次可推导的收敛计算**：

```
P  = plan(L, R, B, I, policy)   // 纯函数：无 IO、可序列化、可 dry-run、给出确定性总量
L' = apply(P)                    // 幂等、事务、原子写、有界并发
R' = commit(P.publish)           // 写索引 → 锁 → 读回 → 写 pointer（幂等）
B' = R' ; I' = gc(I, R')         // finalize：基线单点原子落盘
```

三条公理：**① 本地是真相；② 云端 = 不可变对象 + 唯一可变 pointer；③ 用户意图（删除/恢复/归档）是唯一必须跨轮记住的东西**。任何「待办/失败/待补」都不进入持久状态——能算的不要记。

**净收益**：9 本账 → 1 本意图日志；`pendingAssets/deferAssets/staging/markerPersist/raceRetries` 全部降为 plan 策略或 apply 原语；双端适配器 1290 行 + conformance 496 行 → 1 份实现 + 每端 ~80 行驱动；进度由 plan 给出确定性总量（桌面/移动同一描述器）；新增不变量 **I0「云端胜出不得删除本地」**，直接消灭 SD-01（P0）。

---

## 2. 动机（证据）

| 症状 | 现状补丁 | 架构缺陷 |
|---|---|---|
| 附件失败后永久缺失 | `pendingAssets` 账本 + `retryPendingAssets`（`s3v3Engine.ts` · `retryPendingAssets`） | 传输不是 plan 的输出，是一次性副作用 |
| 首拉 39 分钟 | 261026 后加的全局流水线（`runTransferPipeline`） | 编排没有「阶段 + 对象队列」模型 |
| 首拉内存线性增长 | `bodyCache` 全类无清理；`buildAndUploadAll` 攒全量正文才 flush | plan 携带字节而非引用；无背压 |
| 移动端 OOM | 正文 staging（只修写侧） | apply 缺统一原子落盘原语 |
| 标记清不掉/不落盘 | `persistSyncMarkers` 可选端口 | 状态写入多出口，无 Finalize 单点 |
| 首轮 pointer 竞态 | `sync()` 外层 `MAX_PUBLISH_RETRIES` 循环 | 发布协议没有「幂等提交 + 冲突后 re-plan」 |
| 双端语义漂移 | conformance 496 行 + `repositoryCapabilities` 对账表 | 契约过宽 + 双实现 |
| 删除/恢复 6 个概念 | `intents`/`pending`/`remotePurged`/`restorePending`/`quickPurges`/`quickPurgeTimes` | 意图没有单一模型 |
| **全量重拉永久删本地**（P0） | 无（`archived` 空壳） | 「应用远端」没有区分「删除意图」与「收敛归档」 |
| 缺正文「可云恢复」误判 | 读 v3 永不写的 `sync_base` | 判据未跟随协议迁移 |
| 待同步数永久挂起 | `published_at` 无人写 | 记账没有单一出口 |

完整证据：`05-sync-data.md` SD-01..13；状态机补丁清单见 `06-redesign.md` §2。

---

## 3. 目标与非目标

### 3.1 目标
1. **数据安全**：任何收敛路径都不得不可恢复地删除本地数据（I0）；删除只由用户显式动作触发。
2. **可推导**：稳态一轮的决策可以由纯函数算出并导出（dry-run / 台账 / 测试对拍）。
3. **单实现**：双端只实现 IO 驱动；同步语义、SQL 形状、状态机各只有一份。
4. **性能**：稳态 O(changed) 且零写；首拉内存 O(并发 × 单对象)；进度确定性。
5. **可观测**：plan 与 report 可落盘/导出；错误分类（retryable / action-required / fatal）被 UI 消费。
6. **可迁移**：协议不变；先止血、再对拍、后切换；任一步可回滚。

### 3.2 非目标
- 不改 wire format（pointer/index/declaration/key 布局全部不变）。
- 不引入 CRDT / 服务端 / 账号 / 实时协作。
- 不为旧数据写兼容迁移（AGENTS §3#7）；账本收敛也**断代**（不双写，见 §10/§13）。
- 不碰闭源内核（lakex）与 Univer 依赖。
- 不在本 RFC 内做「按篇增量索引」——它需要 5 万文档量级的实测证据（`05` SD-12），列为后续独立 RFC。

---

## 4. 术语与不变量

| 符号 | 含义 |
|---|---|
| L | 本地工作区：行（SQLite）+ 正文/资产/历史文件 + 内容 hash |
| R | 远端快照：pointer → 不可变索引 → 每篇资产声明 |
| B | 基线：上次成功收敛的 R（设备本地，绝不上云） |
| I | 意图日志：删除 / 彻底删除 / 恢复 / 归档（追加写，带 epoch+generation+时间） |
| P | SyncPlan：有序操作集 + 确定性总量 |

**不变量（验收标准）**

| ID | 不变量 | 说明 |
|---|---|---|
| **I0** | **云端胜出不得删除本地** | 收敛只能「应用远端 + 归档本地」；物理删除只由用户显式 purge 触发 |
| I1 | apply 幂等 | 同一 plan 重放任意次结果一致；每个 op 有「已存在即跳过」前置 |
| I2 | 先拉后推 | 同一轮先应用远端，再上传本地 |
| I3 | 删除 = 缺席 + 意图压制 | 不写墓碑；意图只在「更高 generation 且索引不含该 id」时清除 |
| I4 | 资产声明全量派生 | 声明 = 本地集合全量快照；PUT 只做差集；声明永不裁剪 |
| I5 | 冲突 = 先发布者胜 | 被覆盖方在同一事务内先写历史快照，再覆盖 |
| I6 | 恢复是唯一显式例外 | restore 意图 + local-wins；不受 I3 压制 |

> I0 是本次新增（v3 缺失，SD-01 的直接根因）；其余六条已存在于现有测试，v4 把它们从「散点断言」升级为 plan 的类型级约束。

---

## 5. 现状（as-is，供迁移对照）

```
syncWithV3 / mobile syncNow
  └─ S3v3SyncEngine.sync()            // 重试循环（PublishRetry / pointer-corrupt）
       └─ syncOnce()                  // 加载 state/baseline/pointer → 云状态分类
            ├─ pullAll()              // 无基线：远端索引整体替换 state（归档→saveState）
            ├─ initialUpload()        // 空云 + 用户选择上传
            └─ incrementalSync()      // ~515 行：意图让位/恢复合并/三方合并/正文预取/声明预取/
                                      //           逐条 apply/上传/发布/待删清理
```

关键度量（`05` §1.2 / 本机实测）：引擎 1895 行；`incrementalSync` ≈515 行；`DeviceState` 9 本账；同步层 34 生产文件 / 6127 行、58 测试文件 / 5694 行；空跑 2k/5k = 199/215ms（仍全量写 baseline）；改 10 篇 259–405ms；首传 500 篇 502ms（方差 3.2×）。

---

## 6. 目标架构

### 6.1 分层

```
Protocol  (纯)   keys / index / declaration / pointer 编解码 + 校验
Reconciler(纯)   plan(L,R,B,I,policy) -> SyncPlan
Applier          apply(plan)：幂等 · 事务 · 原子写 · 有界并发
Publisher        commit(publish)：写索引 → 锁 → 读回 → pointer（幂等）
Transfer         对象级流水线（背压、可流式：getToFile/putFromFile/getRange）
Ports            端只实现 IO：readWorld / applyPlan(或细分原语) / bodyIO / assetIO / ledger / remote
```

目录建议（v4 落地后）：

```
src/core/s3v3/
  protocol/   (keys.ts index.ts declaration.ts pointer.ts validate.ts)
  plan/       (reconciler.ts intents.ts assets.ts types.ts)
  apply/      (applier.ts transfer.ts atomic.ts progress.ts)
  commit/     (publisher.ts lock.ts errors.ts)
  ledger/     (intentLog.ts baseline.ts)
  ports.ts
  engine.ts   (~200 行：相位编排 + 事件)
```

### 6.2 SyncPlan（契约草案）

```ts
export interface SyncPlan {
  version: 4;
  /** 期望读取的远端对象（正文/声明/索引片段）。只带 key+hash+size，不携带字节。 */
  reads: Array<{ key: string; hash: string; size?: number; kind: "body" | "declaration" | "index" }>;
  /** 本地状态变更（应用远端 / 历史快照 / 归档 / 生命周期）。 */
  writes: Array<
    | { kind: "apply-remote"; id: string; space: Space; meta: EntryMeta; bodyHash: string | null }
    | { kind: "archive-local"; id: string; space: Space; reason: "remote-wins" | "cloud-absent" }
    | { kind: "set-lifecycle"; id: string; space: Space; lifecycle: Lifecycle }
  >;
  /** 双向传输（PUT/GET），可被策略标记 lazy（按需资产）。 */
  transfers: Array<{
    op: "put" | "get"; key: string; hash: string; size: number;
    id: string; space: Space; kind: "body" | "asset"; lazy?: boolean;
  }>;
  /** 删除（只含用户 purge 语义；收敛永不产生删除——I0）。 */
  deletes: Array<{ key?: string; prefix?: string; reason: "user-purge" }>;
  /** 本轮要发布的索引；null = 无变更（零写短路）。 */
  publish: { lake: LakeIndex; quickNotes: QuickNotesIndex } | null;
  /** 意图变更（新增/清除），决定 ledger 的唯一写入。 */
  intentChanges: Array<{ op: "add" | "clear"; intent: Intent }>;
  warnings: Array<{ code: WarningCode; id?: string; title?: string; detail?: string }>;
  /** 确定性总量：UI 进度分母；同一输入恒等。 */
  total: { ops: number; bytes: number };
}
```

约束：plan 只依赖输入快照；**禁止任何 `await`**；输出可 `JSON.stringify`；同一输入必须字节一致（可作快照测试）。

### 6.3 意图日志（IntentLog）

```ts
type Intent =
  | { kind: "delete";     id: string; space: Space; at: string; targetEpoch: string; targetGeneration: number }
  | { kind: "purge";      id: string; space: Space; at: string; purgedAt: string }
  | { kind: "restore";    id: string; space: Space; at: string }
  | { kind: "archive";    id: string; space: Space; at: string };
```

- 唯一写入点 = Finalize（或 apply 的显式 `intentChanges`），单一出口。
- 清除规则唯一：`delete/purge` 只在「看到更高 generation 且索引不含 id」时清除；`restore` 在发布成功后清除；`archive` 只在用户显式恢复/导入时清除。
- 与现状映射：`intents+pending→delete/purge`；`restorePending→restore`；`remotePurged→item.lifecycle=cloud-deleted`（不再用 id 数组）；`quickDeletes/quickPurges/quickPurgeTimes→IntentLog`；`archived→archive + item.lifecycle`。

### 6.4 生命周期与「云端已删除·仅本地」（I0 的载体，261028 已定）

- 每条目一个 `lifecycle` 字段：`active | trashed | cloud-deleted | archived`（以 DB 列为准，跨端投影）。
- **全量重拉/云端胜出**：本地独有条目 = 「其他端已删除并 purge」⇒ **软删进回收站 + `cloud_deleted` 标（「云端已删除·仅本地」）**，行/正文/资产/历史全部保留；不参与上传/合并；显式恢复时按 restore 意图 local-wins 重新上传。**不新制备份区**（用户 261028 定稿；A 批已实现）。
- 删除只由 `purge` 意图触发；purge 才允许删正文/资产/历史（且远端对象按 pending 清理）。

### 6.5 发布协议（commit）

1. 写不可变索引对象（内容寻址，PUT 幂等）。
2. 取锁（租约 TTL + owner；崩溃可抢占，无需人工清锁）。
3. 读回 pointer：`generation` 未变 → 写 pointer；变了 → 返回 `Replan`（不是异常）。
4. 释放锁；读回确认。
5. 失败：整体重试（plan 可原样重放）或 Replan（只重算 pointer 之后增量）。
- 幂等键：`(epoch, generation, lakeCommit, quickNotesCommit)`；重复写 pointer = no-op。
- **清理（pending deletes）与发布分离**：清理失败只降级为 warning，不把成功报成失败（SD-05）。

### 6.6 错误分类（UI 必须消费）

| 类 | 例子 | UI 动作 |
|---|---|---|
| retryable | 网络、5xx、限流 | 自动重试/下轮重试；进度条显示重试 |
| action-required | epoch-mismatch / rollback / fork / 空云 / **baseline-lost** | 弹「云端赢（本地独有→回收站+云端已删除标）/ 本地赢」二选一，接 `resetFromCloud` 与回收站 |
| fatal | 数据损坏、协议不兼容 | 停止同步 + 诊断导出 |

---

## 7. 性能模型与预算

| 场景 | 现状 | v4 目标 | 手段 |
|---|---|---|---|
| 零变更（2k/5k/20k） | 199/215ms / 无基准 | 2k <80ms；20k <300ms；**0 次 baseline 写** | plan 短路（commit 相等 + dirty 空）+ baseline 单次加载 |
| 改 10 篇（5k） | 400ms | <500ms | 去掉重复 state 反序列化；apply 批事务 |
| 首传 500 篇 | 502ms（方差 3.2×） | 保持并给出比值断言 | plan 分批 flush；基准带方差 |
| 首拉 600 篇 | 9.7s（真机） | 保持 | 对象级流水线 |
| 首拉 1.6GB | 39min → 目标 5–10min | 保持 | 分档并发 + 大对象 range |
| 移动端峰值内存 | 随字节线性（bodyCache 等） | O(并发 × 单对象) | plan 只给引用；native 流式；batch 100 |
| 进度 | 阶段手工映射回 V2 枚举 | 确定性 done/total | plan.total |

并发口径：总并发 12（用户定），池内按 size 分档（小对象 24 / 大对象 4×range），不突破上限。

---

## 8. 安全与信任边界（同步面）

- 远端不可信：index/declaration/pointer 全字段校验（沿用 `validatePointer/validateLakeIndex/validateAssetDeclaration`），id/filename 段白名单，size/hash 上限。
- 收敛不得产生本地删除（I0）；远端「缺席」只能让本地进入 cloud-deleted/归档。
- 凭据不进 plan/report/log；plan 可导出前必须脱敏。
- 锁/读回防回滚；跨端版本混用**不做兼容**（断代，§10）：旧端提示升级，新端不写双模型。

---

## 9. 端口与单实现 DeviceStore

### 9.1 端口（端只实现 IO）

```ts
interface WorkspaceReader { readWorld(): Promise<World> }            // 行 + hash 清单（不读正文）
interface PlanApplier    { applyPlan(plan: SyncPlan, tx: Tx): Promise<void> }
interface BodyIO         { read/writeAtomic/stat/list/remove }
interface AssetIO        { list/stat/read/writeAtomic/removeDir/nativePath }
interface Ledger         { loadBaseline/saveBaseline/loadIntents/appendIntents/clearIntents }
interface Remote         { get/put/list/deleteMany/deleteByPrefix/getToFile?/putFromFile?/getRange? }
```

### 9.2 单实现 DeviceStore

- 一份 schema + 一份 row↔model 映射；per-platform 只实现 `SqlDriver { exec/execBatch/all/tx }` 与 `FileDriver`。
- 桌面 better-sqlite3 驱动 ~60 行；移动 Capacitor SQLite 驱动 ~80 行（异步 + `executeSet` 批量，保住冷启动 185ms）。
- 删掉 `deviceConformance.ts` 的「双端对账」定位，改为「单实现契约测试」；双端只跑 fixture（同输入同输出）。

---

## 10. 迁移与灰度

| 阶段 | 内容 | 验收 | 回滚 |
|---|---|---|---|
| **M-1 止血**（已在本轮 A 实施） | 全量重拉归档不删（I0）、清理失败降级、待同步记账、可云恢复判据 | `pullAllSafety.test.ts`：删 baseline → 同步 → 本地独有文档仍在/历史不减/不上传 | 单点回滚 |
| **M0 对拍** | 新 `plan()` 与现引擎并行 dry-run，断言操作集一致（差异 = 0） | 54 个同步测试 + 对拍脚本 | 不切执行器 |
| **M1 切执行器** | apply 复用现有 IO；commit 用现有发布协议 | conformance 10 场景 + 现有回归 | 旧引擎留分支/tag |
| **M2 账本收敛** | IntentLog 接管 9 本账；**断代直接收敛**（不双写；state 形状变更一次性完成，旧字段删除） | 全端同版本回归 + 旧端启动时「请升级」提示 | git 可回；不做跨版本兼容 |
| **M3 单实现** | 桌面→移动依次切换 DeviceStore；回收站「云端已删除·仅本地」UI 收口 | 同数据同结果 + 冷启动 185ms | 旧适配器保留一版 |
| **M4 性能** | 零写短路、流式传输、分档并发 | §7 预算 | 开关降级 |
| **M5 删旧** | 删旧引擎/9 本账/conformance/进度枚举/死表 | grep 无引用 + 门禁 | git 可回 |

**跨端版本混合**：用户已决定**断代**（不做双写）。协议不变，但本地 state 形状会变 ⇒ 旧端不保证能读新 state，需在旧端启动/同步时提示升级（或直接要求同版本）。这是有意接受的成本（AGENTS §3#7）。

---

## 11. 测试策略

| 层 | 手段 |
|---|---|
| plan 纯函数 | 快照测试（同输入字节一致）+ 表驱动决策用例（把 `decideItem` 的 7 种动作 × 存在性组合全覆盖） |
| apply 幂等 | 重放/中断恢复用例：PUT 数不增、本地 hash 不变 |
| commit | 锁竞争、generation 变化、读回失败、重复提交（幂等） |
| 不变量矩阵 | I0–I6 × 场景（首拉/增量/删除/恢复/冲突/弱网/双端混版） |
| 性能 | 比值断言（相对基线 < 1.5×），500/2000 两档进门禁；5 万档手动归档 |
| 对拍 | M0 dry-run 差异 = 0（作为切换门槛） |
| 恢复演练 | 删 baseline / 删 state / 换桶 / 回收站 90 天过期 |

---

## 12. PR 拆分（供排期）

> 每个 PR 必须自带回归、过 `tsc + vitest + git diff --check`；动同步层的 PR 额外跑同步层定向套件。

| # | PR | 范围 | 依赖 | 规模 |
|---|---|---|---|---|
| E0-1 | **P0 止血**（本轮 A 已做） | `pullAll` 归档、adapter 不删、`pullAllSafety` 测试 | — | S |
| E0-2 | 同步语义三修（本轮 A 已做） | `executePending` 降级、`published_at` 记账、可云恢复判据 | — | S |
| E1-1 | 抽 `protocol/` | ✅ 已完成（261028）：`src/core/s3v3/protocol/` + barrel，33 文件 import 更新；未改行为 | E0 | M |
| E1-2 | 抽 `plan()` | ✅ 决策层完成（261028）：`plan/types.ts` + `plan/plan.ts · planSync()`（零 IO，复用 merge；资产 transfer/意图清除留 E1-2b）；9 例单测 | E1-1 | L |
| E1-3 | 对拍门禁 | ✅ 决策层通过（261028）：4 场景（零变更/远端更新/本地更新/冲突）pull/PUT/archive/publish 一致；delete/资产 transfer 对拍留 E2 前 | E1-2 | M |
| E2-1 | Applier | ✅ 已落 `s3v3/apply/applyPlan.ts`（261028）：只做 IO 不做决策；缺正文/hash 不符/坏字节/purge 五条数据安全不变量内建；13 例单测 + 与旧引擎副作用对拍 4 场景 | E1-3 | L |
| E2-1b | 发布集 + 资产段 | ✅ 已落（261028）：`SyncPlan.publishes`（补 metadata-only 上传盲区）；`apply/applyAssets.ts` 声明差集 PUT/GET + 空目录护栏 + 幂等 + defer | E2-1 | M |
| E2-2 | Committer | ✅ 完成（261028）：E2-2a 纯合成 `buildPublishIndex`（失败回退/资产 hash）；E2-2b `commitPlan`（锁+写前读回+写后读回+只删自己的锁+零变更不写）；端到端对拍与旧引擎发布同一索引 commit | E2-1b | M |
| E2-3 | 切换 + 清理 | ✅ **已完成（261028 晚–261029）**：引擎生产路径已改四相编排——`s3v3Engine` 委托 `runSyncRound` / `initialRound` / `pullRound`（`engineBridge` 纯映射 DeviceState↔PlanState），旧 `incrementalSync/pullAll/initialUpload/buildAndUploadAll` 与 `roundKernel` 开关已物理删除（仅历史注释/文档保留字样）；`executePending.ts` + `intentLog.ts` 已接入；门禁含 plan/apply/commit 端到端对拍与零变更轮 | E2-2 | M |
| E3-1 | IntentLog | 9 本账收敛（断代，不双写） | E2-3 | L |
| E3-2 | 生命周期 | `lifecycle` 列 + 回收站/「云端已删除·仅本地」徽标（**不新制备份区**，复用既有语义） | E3-1 | M |
| E4-1 | DeviceStore 单实现 | SqlDriver/FileDriver + 桌面迁移 | E3-1 | L |
| E4-2 | 移动迁移 | 移动驱动 + 冷启动校验 | E4-1 | M |
| E5 | 性能与台账 | 零写短路、流式、进度/台账 UI | E4-1 | M |
| E6 | 文档收口 | 新 `SYNC-PROTOCOL.md`；删 Manifest V2/过程文档；删死表 | E3/E4 | S |


> **版本口径（261029）**：v4 = 同步**内核/编排层**；wire format 仍是 v3（`S3V3_POINTER_VERSION = 3`，pointer/不可变索引/每篇声明/内容寻址对象布局全部不变）。不存在「S3 协议 v4」；设备间互操作仍按 v3 协议，v4 只是把编排从「9 本账 + 巨石 sync()」重写为 plan/apply/commit/finalize。

> **E1 收口裁决（261028）**：资产级 transfer 归 Apply（需声明字节，不能让 plan 依赖 IO 结果）；pending 对象删除归 Commit/Finalize（执行集依赖本轮新 commit + 门禁）。⇒ E1 决策层已闭合，E2 起照 08 §25.2 的 E2-1..E2-4 顺序施工（新增文件 + 对拍并行，**不做磁盘双写**）。

**关键卡点**：E2 之前必须完成 E1-3（对拍差异 0）；E3 按「断代」直接收敛（不做双写）；E5 的增量索引需独立 RFC（5 万文档证据）。

---

## 13. 决策与待决问题

**已决（261028 用户拍板）**
1. **全量重拉的「本机有、云上没有」= 回收站 + 「云端已删除·仅本地」标**（复用既有远端 purge 语义），**不新制备份区**。该语义已在 A 批落地（`pullAll` 软删进回收站 + `remotePurged`/cloud_deleted 投影）；v4 只是把它固定为 I0，不再引入 `archived`/备份区。
2. **断代，不做双写过渡**：所有端整体升级，不写旧字段兼容；本地 state 形状变更时直接删旧账本（符合 AGENTS §3#7「能删重建就不写兼容」）。需要最低版本提示（旧端同步前提示升级），但不保留双读/双写代码。
   - 影响：M2 从「双写一轮」改为「直接收敛 + 删旧字段」；迁移更快，但**不能跨版本混用**（一台旧 APK + 一台新桌面不做兼容保证，旧端会因 state 形状不符被要求升级/重置）。

3. **编辑器/小记共用「生命周期状态机 + 意图 + 判定函数」，但不共享存储/历史/保留策略**（用户 261028 同意）。core 提供 `LifecycleState`（active/trashed/cloud-deleted/purged）+ 转移守卫 + `restoreDecision()` + IntentLog 类型；按 space 用 policy 参数化：`hasHistory`（doc=true/quick=false）、`conflictCopy`（统一 newId，两端一致）、`backup`（doc/quick）、`trashRetentionDays`、`storage`（tree/flat）。小记冲突副本**两端统一建新副本**。
4. **已定（261028 用户意见）**：不做"详细台账面板"。云图标浮窗只放：状态、上次同步（含时长）、**上传/下载细分（文档/目录/小记/字节，用户要求保留）**、待同步数、失败/冲突的计数与入口；其余明细（逐项传输、阶段耗时、失败对象、警告列表、generation/锁）只进**设置 → 同步诊断**（`sync_v3_reports`）与日志文件。v4 的 plan/report 数据结构仍保留，供"摘要 + 诊断"消费。
5. **已定**：性能门禁「500/2000 比值断言 + 5 万手动」口径（SD-12 已落地）。

---

## 14. 备选方案与取舍

| 方案 | 否决理由 |
|---|---|
| 继续在 v3 上打补丁 | 每加一项语义要改 4–6 处（引擎/桌面/移动/conformance），P0 类问题会继续以「补丁的补丁」出现 |
| 重写协议（v4 wire format） | 收益低、风险高（跨端不可回滚、需双协议并行）；协议本身没有明显缺陷 |
| 引入服务端/账号 | 违背「本地优先、无账号」的产品定位 |
| SQLite 单库当真相（放弃文件正文） | 正文/资产是文件（离线 CDN、复制到微信、历史 gzip）；改动面远超收益 |
| 用现成同步框架（Automerge/Yjs） | 需要 CRDT 模型 + 服务端，与「先提交者胜、删除压编辑」的既有语义冲突 |

---

## 15. 附录：旧机制 → v4 去处（与 `06` §5 对齐）

| 旧机制 | v4 |
|---|---|
| `pendingAssets` 账本 | 删除：每轮 plan 的声明差集自然重算（幂等重试） |
| `deferAssets` | plan policy（首拉不列资产 op；打开时再 plan） |
| 正文 staging | apply 的原子写原语（temp+rename） |
| `remotePurged` | item.lifecycle = cloud-deleted（由基线+远端推导） |
| `restorePending` | IntentLog.restore |
| `quickDeletes/quickPurges/quickPurgeTimes` | IntentLog + item.purgedAt |
| `intents/pending` | IntentLog |
| `archived` | **已取消**：全量重拉复用回收站 + `cloud_deleted`（261028 定稿），不需要单独的归档列表 |
| `persistSyncMarkers` | 删除（Finalize 单点写基线） |
| `raceRetries` | commit 内建 Replan |
| `sync_base/declared_assets/published_at` | 删除；判据改 v3 事实 + dirty 集 |
| `SyncProgress.phase` V2 枚举 | 删除；plan.total 驱动 |

---

## 16. 评审清单（通过标准）

- [ ] §4 不变量 I0–I6 被认可为验收标准；
- [ ] §6 SyncPlan/IntentLog 契约无遗漏（尤其 asset 声明、恢复、归档）；
- [ ] §9 端口划分可被两端接受（异步 SQL 驱动可行）；
- [ ] §10 迁移顺序与回滚策略可执行；
- [ ] §12 PR 拆分与卡点认可；
- [ ] §13 待决问题有结论。