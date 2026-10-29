# 06 · 第一性原理重设计：收敛式同步内核 v4

> 本篇是本次审计的**设计交付**：选一个板块从零重设架构，目标是「性能最高、实现最简、体验最顺」。
> 选定板块：**S3 同步/数据编排内核**（双端共用）。
> 前置事实：协议 v3（pointer + 不可变内容寻址索引 + 每篇资产声明）**是对的，不动**；要重写的是它上面的**编排层**。
> 证据基线见 `05-sync-data.md`；本文只给设计与迁移。行号会随在途改动漂移，以符号为准。

---

## 0. 一页看懂

| 维度 | v3 现状 | v4 目标 |
|---|---|---|
| 核心文件 | `src/core/s3v3Engine.ts` **1895 行 / 55 方法**，`incrementalSync` 单方法约 **500 行** | 4 个纯相位模块 + ~200 行编排器；决策/执行/发布彻底分离 |
| 跨轮状态 | `DeviceState` **9 本可选账本**（intents/pending/remotePurged/restorePending/quickDeletes/quickPurges/quickPurgeTimes/archived/pendingAssets） | **1 本意图日志** + 由 (本地, 基线, 远端) 推导的状态 |
| 双端实现 | 桌面适配器 481 行 + 移动 809 行 + conformance 对账 496 行 | **一份 DeviceStore** + 每端 ~80 行 SQL/文件驱动 |
| 补丁机制 | deferAssets / staging / pendingAssets / markerPersist / raceRetries / 双写 history… 各自一套 | 全部变成 **plan 的策略** 或 **apply 的原语**，无独立状态 |
| 进度 | 阶段由主进程手工映射回 V2 六态枚举 | **plan 给出确定性总量**，两端同一描述器 |
| 可观测 | 只有 report 与日志 | **SyncPlan 可导出**（dry-run / 台账 / 测试对拍） |
| 数据安全 | **全量重拉会永久删除本地独有文档**（SD-01：pullAll → saveState → purgeTrashItem，连刚写的历史快照一起删） | 新增 **I0「云端胜出不得删除本地」**：本地独有 → 回收站 + `cloud_deleted`（「云端已删除·仅本地」），删除只由用户显式动作触发（261028 定稿，已实现） |
| 性能 | 5000 篇零变更 215–348ms、改 10 篇 400–785ms、首拉 600 篇 9.7s | 稳态轮 O(changed)；空跑零写；新增按篇增量索引（v3.1）后可把索引拉取从 3MB 降到 O(变更) |
| 迁移 | — | 协议不变 ⇒ 可 dry-run 对拍、可灰度、可回滚 |

**一句话**：v3 把「状态从哪来」交给了一堆账本；v4 让「下一步做什么」由一个纯函数算出来，执行器只负责幂等地做。

---

## 1. 为什么是同步内核（而不是别的板块）

候选与取舍：

| 候选 | 为什么不是它 |
|---|---|
| 移动端工作区状态机 | 痛，但影响面限于一端；且可在 v4 之后单独做（见 `04`）。 |
| 编辑器宿主层（5 kind × 2 端） | 重要，但 v4 的「单实现 + 端口」方法论可直接复用（见 §6）。 |
| UI 设计系统 | 已经不是瓶颈（令牌 + 层级 + 门禁都在位）。 |
| **同步内核** | **核心路径 × 双端 × v3 冲刺债最集中**：54 个测试文件、6 个 v3 批次（P1/prod/parity/rem/perf/cutover）都在它上面打补丁；每加一个能力要写桌面/移动/对账三遍。 |

判断依据（第一性原理）：**同步是这个产品唯一「不可省略的分布式问题」**。笔记/编辑器再漂亮，一旦同步会产生「这篇到底在哪、为什么没上去、删了还能不能回来」的解释成本，产品体验就被拖垮。把它做成可推导、可预览、可回放的收敛计算，是收益最大的架构投资。

---

## 2. 症状：v3 的每个「功能补丁」在替哪个架构缺陷买单

| 症状（用户/运维可见） | 现状补丁（证据） | 它真正暴露的问题 |
|---|---|---|
| 附件下载失败后下一轮不会重试，永久缺失 | `pendingAssets` 账本 + `retryPendingAssets`（`s3v3Engine.ts:764/1730-1808`，注释：「普通增量轮不会重新调度资产」） | 调度不幂等：**资产传输不是 plan 的输出**，而是一次性副作用 |
| 首拉 39 分钟 | P0-1 全局下载流水线（261026 后加） | 编排没有「阶段 + 对象队列」模型，只能事后插流水线 |
| 移动端首拉 OOM | 正文 staging（临时文件） | apply 没有统一的原子落盘原语 |
| 清了恢复标记但没落盘 | `persistSyncMarkers` 可选端口（261026） | 状态写入有多个出口，没有 Finalize 单点 |
| 首轮并发首传 pointer 竞态 | `sync()` 外层 `raceRetries` 循环 | 发布协议没有「幂等提交 + 冲突后 re-plan」语义 |
| 双端语义漂移（archiveQuickNote、usheet normalize） | conformance 496 行 + repositoryCapabilities 对账表 | 契约过宽 + 双实现，靠测试追 |
| 删除/恢复有 6 个概念、3 个入口 | intents / remotePurged / restorePending / quickPurges / quickPurgeTimes / archived | 意图没有单一模型，状态用数组记 |
| 两端进度词汇不一致 | 桌面 `PHASE_PROGRESS` 手工映射回 V2 枚举；移动直接用 v3 阶段 | 没有 plan，就没有「总量」这个事实 |
| **全量重拉删掉本地独有文档（P0）** | `pullAll` 整体替换状态 → `saveState` 对不在新状态的行走 `deleteNote+purgeTrashItem`（连历史一起删）；`archived` 字段空壳 | 「应用 plan」没有区分「删除（用户意图）」与「收敛（系统动作）」；云端胜出必须归档而不是删除 |

**结论**：这些不是 8 个 bug，是 3 个架构缺陷的 8 次表现——**决策与执行混在一起、状态靠账本叠加、双端各写一遍**。

---

## 3. 第一性原理：同步 = 收敛计算

### 3.1 三条公理（从产品红线直接推出）

- **A1 本地是真相**：云端永远不能反向覆盖未被冲突判定的本地内容（AGENTS §3#1）。
- **A2 云端只追加不可变对象**，唯一可变是 pointer（单调 generation）；因此「云端现在是什么」= 一次读 pointer + 读不可变索引。
- **A3 用户意图是唯一需要跨轮记住的东西**：删除、彻底删除、恢复、归档——这些不能被推导，其余（缺什么、该传什么、失败了没）都能由 (本地, 基线, 远端) 重算。

### 3.2 形式化

设 `L`=本地工作区（行 + 文件 + 内容 hash），`R`=远端快照（pointer→索引→声明），`B`=基线（上次已收敛的 R），`I`=意图日志。一次同步是：

```
P  = plan(L, R, B, I, policy)        // 纯函数：输出有序操作集 + 总量
L' = apply(P)                         // 幂等执行
R' = commit(P.publish)                // 写索引 → 锁 → 读回 pointer → 写 pointer
B' = R' ; I' = gc(I, R')              // 收尾
```

**任何「待办/失败/待补」都不进入持久状态**——如果它值得记住，它是意图（A3）；否则下一轮 plan 会重新算出来。

### 3.3 六条不变量（v4 的验收标准）

| ID | 不变量 | 说明 |
|---|---|---|
| I1 | apply 幂等 | 同一 plan 重放任意次，结果一致；每个 op 有「已存在即跳过」前置 |
| I2 | 先拉后推 | 同一轮内先 apply 远端，再上传本地（避免基于过期远端判断） |
| I3 | 删除 = 缺席 + 意图压制 | 删除不写墓碑；意图只在「看到更高 generation 且 id 不在索引」时清除 |
| I4 | 资产声明全量派生 | 声明 = 本地集合的全量快照；PUT 只做差集；声明永不裁剪 |
| I5 | 冲突 = 先发布者胜 | 被覆盖方在同一事务内先写历史快照，再覆盖 |
| **I0** | **云端胜出不得删除本地** | 收敛动作只能「应用远端 + 归档本地」，物理删除只由用户显式 purge 触发（v3 的 SD-01 违背点） |
| I6 | 恢复是唯一显式例外 | 恢复 = 意图（restore）+ local-wins；不进 I3 的压制 |

> 这六条已经以测试形式存在于仓库（`correctness.integration`、`s3v3Core`、`perfPipeline` 等）；v4 把它们从「53 个测试文件的散点」升级为「plan 的类型级约束」。

---

## 4. 目标架构：四相

```
                 ┌────────────────────────────────────────────┐
   L (本地)  ────▶│  plan(L, R, B, I, policy) -> SyncPlan       │◀──── R (远端快照)
   B (基线)  ────▶│  纯函数 · 无 IO · 可序列化 · 可 dry-run     │◀──── I (意图日志)
                 └──────────────────────┬─────────────────────┘
                                        │ SyncPlan（reads/writes/transfers/deletes/publish/intents/warnings）
                                        ▼
                 ┌────────────────────────────────────────────┐
                 │  apply(plan)   幂等 · 事务 · 原子写 · 并发池  │
                 └──────────────────────┬─────────────────────┘
                                        ▼
                 ┌────────────────────────────────────────────┐
                 │  commit(publish) 索引 → 锁 → 读回 → pointer  │
                 └──────────────────────┬─────────────────────┘
                                        ▼
                 ┌────────────────────────────────────────────┐
                 │  finalize  基线原子落盘 · 意图 GC · 台账事件  │
                 └────────────────────────────────────────────┘
```

### 4.1 Plan（纯函数）

```ts
export interface SyncPlan {
  /** 只读远端对象的取回（正文/声明/索引片段），含 key+hash+size 用于校验 */
  reads: Array<ReadOp>;
  /** 本地落库（applyRemote）、历史快照、归档、lifecycle 变更 */
  writes: Array<WriteOp>;
  /** 双向传输（PUT/GET 资产与正文），带 size/hash/优先级/是否 lazy */
  transfers: Array<TransferOp>;
  /** 删除：远端对象（purge）、本地行 */
  deletes: Array<DeleteOp>;
  /** 本轮要发布的索引（null = 无变更，不发布） */
  publish: { lake: LakeIndex; quickNotes: QuickNotesIndex } | null;
  /** 意图变更：新增（删除/恢复/归档）与清除（看到更高 generation 且缺席） */
  intentChanges: IntentChange[];
  warnings: StructuredWarning[];       // 结构化，无 UI 文案
  progressTotal: number;               // 确定性总量（ops 数 + bytes）
  stats: { pull: number; push: number; delete: number; conflict: number };
}
```

要求：
- **输入只读**：L/R/B/I 以不可变快照传入（R 为已解析索引，不含 IO）。
- **输出可序列化**：能存盘、能 diff、能在 UI 里展示（Sync Ledger，见 §8）。
- **plan 不做 IO**：不 `get`、不 `saveState`、不 emit 文案；1 万篇合并 < 50ms（现有 `planLakeMerge` 已接近 O(n)）。
- **两个 space 参数化**：`SpaceConfig<S>`（索引类型 / 键前缀 / 设备方法 / 生命周期字段），消灭 lake 与 quickNotes 的复制粘贴。

### 4.2 Apply（幂等执行器）

- 每个 op 自带 key（内容寻址）：`body:{hash}`、`asset:{id}/{filename}`、`row:{id}`。
- 幂等前置：正文已存在且 sha256 相等 → 跳过；资产已存在且 size+sha256 相等 → 跳过（现有本地实扫逻辑直接复用）。
- 事务：一篇文档的「历史快照 + 正文 + 行 + 生命周期」同事务；跨文档按批。
- 原子写：临时文件 + fsync + rename（桌面）；移动端沿用原生 `BodyStorePlugin` 的原子写；staging 不再是「状态」，只是这个原语的实现细节。
- 并发：传输池按 size 分档（小对象 24 / 大对象 4 个 range 分片），总并发仍守用户定的 12 上限；apply 的落库串行（SQLite 单写者）。
- 可取消：apply 可中断，已落地的 op 幂等可重入；commit 不可取消。

### 4.3 Commit（发布协议）

```
writeIndex(immutable)  →  acquireLock(租约)  →  readPointer() 校验 generation
  →  写 pointer（幂等：同 commit 重复写 = no-op）
  →  releaseLock  →  读回确认（失败 = 按冲突 re-plan，只重算增量）
```

- **race retry 属于 Commit**：`sync()` 外层不再有 `MAX_PUBLISH_RETRIES` 循环；冲突时返回「需要 re-plan」信号，由编排器重跑 plan（此时 R 已更新，plan 自然只剩增量）。
- **锁租约**：带 TTL + owner 校验（现有 lockOwner/assertLockOwned 语义保留），崩溃后可抢占，不需要人工清锁。
- **顺序**：先对象后索引（内容寻址）→ 声明 → 索引 → pointer（保持现有顺序，符合 v3 契约）。

### 4.4 Finalize

- 基线**一次原子写**（`saveBaseline`），不再出现「marker 单独落盘」这类第二出口。
- 意图 GC：按 generation 规则（现有 `shouldClearDeletionIntent` 直接复用），删除只保留「仍生效」的意图。
- 台账事件：`plan` + `report` 广播给 UI（桌面/移动同一模型）。

---

## 5. 旧机制的去处（逐项，这是本设计的「删除清单」）

| 旧机制 | 现状 | v4 处理 | 净效果 |
|---|---|---|---|
| `pendingAssets` 账本 | state 字段 + 引擎维护 + 适配器持久化（22 处引用） | **删除**。资产传输由 plan 的「声明差集」每轮重算；失败 = 下一轮同一 transfer op（幂等重试） | 少一个账本、少一个端口、少一类「永久缺失」 |
| `deferAssets` | 选项 + 首拉策略 | **保留为 plan policy**：首拉 plan 只列 metadata+bodies；资产 op 标 `lazy`，打开时再 plan 一次（按需） | 语义更清楚：它不是状态，是策略 |
| 正文 staging | 临时文件 + 内置状态 | **删除状态**，保留原语：apply 的原子写（temp+rename） | 崩溃恢复更简单 |
| `remotePurged` 数组 | 引擎写、适配器投影 | **推导 + 生命周期字段**：基线有、远端缺席、本地有正文 ⇒ 本地副本标 `cloud-deleted`（item 字段，非 id 数组） | 状态与数据在一起，不漂移 |
| `restorePending` | 数组 | **并入意图日志**（restore intent，带时间戳） | 单一意图模型 |
| `quickDeletes/quickPurges/quickPurgeTimes` | 三份 | **并入意图日志 + item.purgedAt/lifecycle** | 3 → 1 |
| `intents/pending` | 两份 | **合并为 IntentLog**（删除/恢复/归档三类，append-only） | 2 → 1 |
| `archived` | 空壳数组（引擎从不写） | **取消**：全量重拉直接复用回收站 + `cloud_deleted`（261028 定稿）；不新制备份区 | 空壳 → 删除 |
| `sync_base` / `declared_assets` / `published_at` | manifest 时代账本：写者已死/为零，读判据仍在用（缺正文误判「无备份」、待同步计数永久挂起） | **删除**；「可云恢复」判据改读 pointer→索引事实，「待同步」单一来源 = dirty 集 | 3 张死表/列 → 0 |
| `resetFromCloud` | 死代码（epoch-mismatch 无 action） | **接成 UI 动作**：非 Ok 云端状态一律给「云端赢（先备份）/ 本地赢」二选一 | 断头路 → 可达动作 |
| `persistSyncMarkers` 端口 | 可选端口 | **删除**：Finalize 单点写基线 | 少一个跨端端口 |
| `raceRetries` | sync 外循环 | **进 Commit** | 编排器不再知道竞态 |
| lake/quick 两份流程 | 大量重复 | **Space 参数化** | 约 -30% 分支代码 |
| `SyncProgress.phase` V2 枚举 | 主进程手工映射 | **plan 提供 total**，进度 = done/total；旧枚举删除 | 两端一套词汇 |

> 原则：**「可推导的不要存，能算的不要记」**。只有 A3 的意图与性能缓存允许持久化。

---

## 6. 一份实现：DeviceStore 只写一次

现状（P1 债）：`desktopStoreAdapter.ts` 481 行 + `mobileDeviceStore.ts` 809 行，实现同一接口 30+ 方法；`deviceConformance.ts` 496 行专门对齐。

v4 拆三个最小驱动，其余共享：

```ts
// 1) SQL 驱动：桌面 better-sqlite3 / 移动 Capacitor SQLite
interface SqlDriver {
  exec(sql: string, params?: unknown[]): Promise<void>;       // 或同步（桌面）
  execBatch(stmts: Array<{ sql: string; params?: unknown[] }>): Promise<void>; // 移动 executeSet
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: () => Promise<T>): Promise<T>;
}
// 2) 文件驱动：正文/资产/历史（桌面 fs / 移动原生 BodyStore）
interface FileDriver {
  read(p: string): Promise<Uint8Array | null>;
  writeAtomic(p: string, bytes: Uint8Array): Promise<void>;   // temp+fsync+rename
  stat(p: string): Promise<{ size: number } | null>;
  list(dir: string): Promise<string[]>;
  remove(p: string): Promise<void>;
}
// 3) hash/时钟
interface HashDriver { sha256(bytes: Uint8Array): Promise<string>; }
```

- **一份 schema + 一份 row↔model**（per-platform 只差 migration DDL 与批量 API）。
- 桌面驱动 ~60 行（better-sqlite3 同步 API 适配）；移动驱动 ~80 行（异步 + `executeSet` 批量，保住冷启动 185ms 指标）。
- 收益：删 ~500 行重复实现 + 删 conformance 对账（改为单实现契约测试）；两端语义漂移**结构性消失**。
- 风险：移动端 SQLite 桥是异步的，共享实现必须是 async 接口（桌面在内部 await 同步调用，成本可忽略）。

---

## 7. 性能模型（目标与手段）

### 7.1 现状实测（本机，`perf.integration.test.ts` 5000 篇）

| 场景 | 现状 |
|---|---|
| 初始上传 5000 篇 | 3565ms |
| 零变更轮 | **215–348ms**（2k/5k 文档；load-state 占 60%+，且仍全量重写 baseline） |
| 改 10 篇（增量） | **785ms**（load-state 424 / publish-save 149 / publish-finalize 78） |
| 首拉 600 篇（真机 vis-r1） | 9.7s（deferAssets） |
| 首拉 1.6GB | 39min → 流水线优化后目标 5–10min |

### 7.2 v4 的性能设计
1. **零变更路径**：plan 只读 pointer（1 GET）+ 本地 state；目标是去掉每轮「全量 load-state 反序列化」——state 改为按篇行表增量读取（SQLite 直读），零变更 < 200ms。
2. **按篇增量索引（v3.1）**：现在索引是单对象（2 万篇 ≈ 3MB gzip）；改为「目录/清单指针 + 按篇条目对象」，plan 的 reads 只包含变更篇。副作用：索引对象数变多，GC 需按引用保留。
3. **传输分档**：小对象（<1MB）并发 24、大对象 range 4；保持用户定的总并发 12 语义（池内分档，不超上限）。
4. **确定性进度**：plan 输出 total（ops + bytes），进度 = done/total；不会回退、不会跳变，两端同一描述器。
5. **内存上界**：移动端字节不过 JS（现有 native getToFile/putFromFile 保留）；plan 控制 bodyBatch（默认 100 篇/批）；峰值 O(batch)，与库大小无关。
   - 现状违背：`bodyCache` 从不释放（首拉把每篇正文常驻堆）、`buildAndUploadAll` 把全库正文攒进 `uploadOps` 才 flush、桌面无流式资产下载（20 并发整对象）⇒ v4 要求「plan 只携带引用，不携带字节」。

### 7.3 预算表（验收门槛）
| 指标 | 目标 |
|---|---|
| 零变更（2 万篇） | < 300ms |
| 改 10 篇（2 万篇） | < 1s |
| 首拉 600 篇 | < 10s |
| 1.6GB 首拉 | < 10min |
| plan 纯计算（2 万篇） | < 100ms |
| 移动端首拉峰值内存 | < 200MB |

---

## 8. UX：同步台账（Sync Ledger）——把 plan 给用户看

用户的问题从来不是「同步了多少字节」，而是：**「我这篇上了没有？删了还能回来吗？为什么失败？」**

- 数据模型（`core/syncLedger.ts`，两端共用）：
  ```ts
  type LedgerRow =
    | { kind: "pull" | "push"; id: string; title: string; state: "queued"|"running"|"done"|"failed"; reason?: string }
    | { kind: "conflict"; id: string; title: string; keptHistory: true }
    | { kind: "retained"; id: string; title: string; why: "远端已删除·仅本地" | "回收站" }
    | { kind: "delete"; id: string; title: string; scope: "cloud" | "local" };
  ```
- 桌面：状态浮窗展开 = 台账（现有 `SyncStatusPopover` 已有 `onOpenNote`，直接按行跳转）。
- 移动：设置页同步卡 = 同一模型（现在是 `describeSyncProgress` 一段文字）。
- 进度条：plan.total 已知 → 确定性百分比；「已覆盖留历史」的行可点击进历史面板。
- 取消：apply 阶段可取消（已落地幂等），commit 不可取消并明确提示"正在发布"。

这条 UX 契约是 v4 的**副产品**：只有当你有 plan，才能给用户看"接下来会发生什么"。

---

## 9. 迁移路径（不停机、可对拍、可回滚）

| 阶段 | 动作 | 验收 | 回滚 |
|---|---|---|---|
| **M-1 止血** | 先修 SD-01：`pullAll` 把本地独有条目软删进回收站 + 打 `cloud_deleted` 标（保留文件/历史），不走 purge；`saveState` 不再物理删 | 删除 `baseline.json.gz` 后同步，本地独有文档在回收站可打开、历史快照数不减 | 单点回滚 |
| M0 对拍 | 抽 `plan()` 纯函数；现引擎在真实/夹具上跑，同时跑新 plan，断言**操作集一致**（pull/push/delete 逐项 + 总量） | 差异 = 0；54 个同步测试全绿 | 不切执行器，纯并行 |
| M1 切执行器 | apply 复用现有 IO 原语；commit 用现有发布协议 | 全量回归 + deviceConformance | 旧 engine 留在分支/tag |
| M2 账本收敛 | IntentLog 接管 intents/pending/remotePurged/restorePending/quick*；**双写一轮**（旧字段继续写，新模型只读校验），确认旧版 App 仍可读 | 双端混版测试（旧 APK + 新桌面） | 关掉新模型读取 |
| M3 DeviceStore 单实现 | 先桌面（better-sqlite3 驱动）后移动；conformance 用例迁移为单实现契约测试 | 同数据同结果 + 冷启动 185ms | 旧适配器保留一个版本 |
| M4 性能 | 增量索引、分档并发、零变更路径 | §7.3 预算 | 开关降级 |
| M5 删旧 | 删旧引擎/账本/conformance/进度枚举 | grep 无引用 + 门禁 | git 可回 |

**跨端版本混合**是最大风险：协议不变，但账本收敛改变了本地 state 的写法。必须双写一轮（旧端读旧字段、新端读新模型），或在设置里加最低版本门。**不能**假设两端同时升级。

> **261029 进展与口径变更**：用户已裁 **断代、不做双写**（旧端读不了新 state，靠版本门/升级提示）。**E3-1 phase1 已落地**：持久化只写 v2 信封（9 本账 + assets/hashCache），旧格式加载时单向迁移，引擎读写未改；`sync_base`/`declared_assets` 已删（Del-6；`published_at` 因有生产调用保留）。**E2-4 单 DeviceStore 已完成（261029）**：共享 core 编排 + 平台端口/驱动薄壳（桌面 187 行 / 移动 398 行），conformance 改单实现契约（移动 21 + mixed 3）；**E3-1 phase2b（字段推导/删字段）经复核裁决不做**（净收益≈0、风险最大；证据见 docs/SYNC-STATE-CONVERGENCE.md §1.3c），其价值残项已做（cloud-deleted 失效判据单点 + 账本⇄records 穷尽性 tsc 护栏）。

---

## 10. 验收（不变量测试矩阵）

| 不变量 | 场景 | 断言 |
|---|---|---|
| I1 幂等 | 同一 plan 连续 apply 2 次、apply 中断后重跑 | 远端 PUT 数不增、本地 hash 不变 |
| I2 先拉后推 | A/B 同时改同一篇 | 先发布者胜，后到者留历史快照（superseded） |
| I3 删除=缺席 | A purge → B 拉取 | 云端无墓碑；B 的副本进回收站并标 cloud-deleted；B 再改不会复活 |
| I4 声明全量 | 本地删一张图后再上传 | 声明全量、PUT 只发差集、他端 GC 不误删在用资产 |
| I5 冲突 | 双端同篇编辑 | 被覆盖方有历史快照；无内容丢失 |
| I6 恢复 | 回收站恢复 + 远端已缺席 | local-wins 上传、标记清除、他端跟随 |
| 弱网 | 注入 N 次失败 | 下一轮自动补齐（无持久账本）；无重试风暴 |
| 性能 | §7.3 | 达标 |

---

## 11. 反模式（实现 v4 时禁止）

1. **不要再加账本**：任何新需求先问「它能否由 L/R/B/I 推导？」能，就不加状态。
2. **不要把 IO 塞进 plan**：plan 里出现 `await remote.get` 就说明设计坏了（dry-run 会变慢/不可测）。
3. **不要在 core 拼 UI 文案**：warning/进度只给结构化数据，文案在 UI 层。
4. **不要保留双实现**：宁可让驱动层多 20 行，也不要第二份语义。
5. **不要让「失败」变成状态**：失败是「本轮没做成」，下一轮的输入照旧。
6. **不要用「性能优化」之名改协议语义**：协议不动是本次重写可回滚的前提。