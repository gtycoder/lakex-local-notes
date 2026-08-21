# 共享同步引擎第二阶段计划：桌面 sync.ts 收敛

> 分支：`refactor/sync-shared-desktop`（继承 `refactor/mobile-capacitor` 共享层）
> 日期：2026-08-22 ｜ 供评审（GPT/用户）｜ 关联：V5 §13 高优先 TODO、docs/MOBILE-TECH-STACK.md §13

## 1. 背景与目标

**现状**：同步**决策机制**（reconcileLakeNote/decideUpload/mergeLockState）与**执行编排**（syncEngine）已在 `src/core` 共享（第一阶段完成，移动端真机验证通过）。但**桌面端 `electron/sync.ts`（1150 行）仍是独立的编排实现**——语义演进需两处同步修改，违背单一实现目标。

**目标**：桌面 sync.ts 的核心同步编排收敛到共享 `src/core/syncEngine`，桌面保留其特有扩展；语义演进只改 `src/core/syncEngine.ts` 一处。

**红线（不变）**：桌面行为零变化（408 测试全绿 + UI smoke 不回归）；不在没有测试护栏的情况下大规模重写。

## 2. 现状分析（功能面对比）

| 能力 | 共享 syncEngine（移动端已验证） | 桌面 sync.ts |
|---|---|---|
| 拉 manifest / 首次同步判定 | ✅ | ✅ |
| 墓碑/回收站/恢复（含删除压编辑时间比较） | ✅ | ✅（applyRemoteMoveToTrash/Restore） |
| reconcile 对账（正文） | ✅ | ✅ |
| **锁 LWW 应用（mergeLockState → applyRemoteLock）** | ❌ | ✅ |
| **图标/父目录/元数据 LWW（applyRemoteNoteMeta）** | ❌ | ✅ |
| **superseded 历史快照（本地编辑被远端覆盖时强制留档）** | ❌ | ✅ |
| **多笔记本/回收站笔记本语义（TRASH_NOTEBOOK）** | ❌ | ✅ |
| **GC（commit 链 prune、孤儿清理）** | ❌ | ✅（pruneOldManifests + runGcReconcile） |
| **结构化 warnings（SyncResult.warnings）** | 简化（字符串数组） | ✅ 结构化 |
| **进度上报（onProgress 阶段）** | ❌ | ✅ |
| 上传/发布/记账/skip-fast | ✅ | ✅ |
| **对象缺失 B 方案** | ✅（跳过+warnings） | ✅ |

**结论**：桌面 sync.ts 功能面**显著大于**移动端引擎。一步替换 = 丢功能（锁/历史快照/GC/多笔记本）→ 违反红线。必须**渐进收敛**：先把桌面独有的语义下沉/抽象，再逐段切换。

## 3. 目标架构

```text
共享层 src/core/syncEngine.ts（编排）
  ├── 决策：lakeReconcile/decideUpload/syncDecision（已共享）
  ├── 扩展点（新增，桌面启用/移动端可选）：
  │     ├── onProgress?（进度上报）
  │     ├── warnings 结构化（SyncWarning[]）
  │     ├── onSuperseded?（本地被覆盖 → 桌面触发历史快照）
  │     └── 锁/元数据 LWW 应用（经 SyncDbPort 方法）
  └── 端口注入：
        S3Store（桌面=ObjectStore 包装 / 移动端=CapacitorHttpHandler）
        SyncDbPort（桌面=store 方法包装 / 移动端=sql.js）
桌面 sync.ts → 缩减为：adapter 装配 + 特有扩展接线（GC/历史/warnings UI/进度）
```

## 4. 分步实施（每步独立可回滚）

### Step 1：共享引擎表驱动测试护栏 ✅（已完成，待评审）

`src/core/syncEngine.test.ts`：mock S3Store/SyncDbPort，覆盖 8 场景：
首次同步 / skip-fast / 远端墓碑应用（先内容后标志）/ 本地删除→墓碑 / 删除压编辑时间比较 /
远端恢复跟随 / 本地恢复→active 覆盖 / 对象缺失 B 方案。

**验收**：vitest 全绿（当前分支可跑）。

### Step 2：共享引擎扩展点（桌面独有语义下沉到 core）

在 `src/core/syncEngine.ts` 增加**可选扩展**（默认不启用，移动端行为不变）：
- `onProgress?: (phase, message) => void`（进度上报，桌面 UI）
- `onSuperseded?: (noteId, content) => void`（本地被远端覆盖 → 桌面 createHistorySnapshot 留档）
- warnings 结构化：`SyncWarning` 类型（message + kind + noteId），移动端沿用字符串数组或统一
- 锁/图标/父目录 LWW：扩展 `SyncDbPort.applyRemoteNote` 已带 ManifestNote 全字段（锁/icon 在 note 上），桌面 adapter 应用；core 侧用 `mergeLockState`（已共享）判定

**验收**：扩展点默认关闭；移动端真机回归不变；`src/core` 边界检查通过。

### Step 3：桌面 adapter

- `electron/syncAdapters.ts`（新）：
  - `createObjectStoreAdapter(remote: ObjectStore): S3Store`（getObject→getOptional（Buffer→string），putObject→put）
  - `createStoreSyncPort(store: Store): SyncDbPort`（getNote/getAllNotes/getSyncBase → store 现有查询；applyRemote* → store 现有方法（含锁/元数据）；localTrash/restore → store 软删/恢复；markSynced → markSyncedIfUnchanged）
- 依赖收敛：adapter 是 electron/ 与 core 的唯一桥。

**验收**：tsc 通过；不接线（仅编译存在）。

### Step 4：语义等价测试（核心护栏）

同一批 manifest/本地状态（复用 Step 1 的 8 场景 + 桌面独有场景：锁 LWW、元数据 LWW、superseded）：
- 共享 syncEngine（mock 端口）输出 vs 桌面 sync.ts 集成测试（真实 store + mock S3）行为断言一致（应用/上传/发布/记账/锁/历史快照触发）

**验收**：等价测试全绿 → 证明共享引擎语义与桌面一致，可安全切换。

### Step 5：桌面 syncNow 渐进切换（分段替换）

按段替换，每段后跑 408 测试 + 3 个 UI smoke：
- 5a：上传/发布/记账段 → 共享引擎子流程（先替换低风险段）
- 5b：下载/对账段 → 共享引擎（保留 superseded/锁/元数据扩展接线）
- 5c：sync.ts 删除重复编排，缩减为 adapter 装配 + GC/历史/进度接线

**验收**：每段 408 测试全绿 + test:ui/sidebar/tab-switch 不回归 + 双端 A/B 真机同步验证。

### Step 6：收尾

- 文档更新（SYNC-PROTOCOL 标注共享引擎为唯一实现）
- 移动端/桌面同基线双端回归
- 合并 master（用户验收后）

## 5. 验收标准

1. `src/core` 是同步语义唯一实现（桌面 sync.ts 无编排逻辑残留，仅 adapter/扩展接线）
2. 408 桌面测试 + 共享引擎表驱动测试全绿；UI smoke 不回归
3. 双端 A/B 真机同步（含墓碑/恢复/冲突）行为一致
4. `src/core` 边界检查 0 违规

## 6. 风险与回滚

| 风险 | 对策 |
|---|---|
| 桌面独有语义（锁/历史/GC）下沉后行为漂移 | Step 4 等价测试先行；每段切换后全量回归；可回滚（每步独立提交） |
| sync.ts 缩减破坏进度/UI 契约 | onProgress 扩展点保留原阶段语义；warnings 结构化兼容 |
| 移动端被扩展点影响 | 扩展点默认关闭，移动端回归 |
| 并行会话冲突（主仓库 master） | 全程独立分支 `refactor/sync-shared-desktop`；合入前 rebase |

## 7. 明确不做（本阶段）

- 不合并 GC 逻辑进共享引擎（桌面保留 runGcReconcile/DeepCleanup，仅复用 manifest refs 纯函数）
- 不改 manifest 协议（v4 不变）
- 不重写 store（仅包装 adapter）
- 不引入 Manifest CAS（V5 已撤销）
