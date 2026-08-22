# 桌面同步拆分计划（SYNC-SPLIT-PLAN）——存储机制统一的正确路径

> 分支：`refactor/sync-split-desktop`（从 master `df29fa7` 拉出）
> 日期：2026-08-22 ｜ 状态：待评审 ｜ 背景：废弃了"移动端重写共享引擎"路径（sync-shared-desktop），
> 改为「从桌面拆」——桌面 sync.ts 是语义权威（408 测试 + Phase 0 加固），按移动端需求逐段拆分，
> 拆出的模块两端共享；桌面行为零变化，拆完即同一套存储机制。

## 1. 原则（用户确认的方向）

1. **源 = 桌面 `electron/sync.ts`**（1150 行，语义权威）；移动端不重写，只复用拆分产物。
2. **按移动端需求拆分**：需要哪个拆哪个，拆时不改行为（只移动代码位置 + 端口注入）。
3. **每步 408 测试全绿**（行为零变化护栏）+ 拆出模块带独立表驱动测试。
4. **拆完 = 两端同一套存储机制**：桌面 sync.ts 缩减为 adapter 装配 + 桌面特有接线（GC/进度/warnings UI）；移动端 adapter 复用拆出的模块。
5. 目标终态：同步语义只改 `src/core` 共享模块一处。

## 2. 拆分边界盘点（electron/sync.ts，行号基于 master）

### A. 纯逻辑段（无 store/electron 依赖 → 直接进 src/core，零风险）

| 函数 | 行 | 说明 |
|---|---|---|
| `syncSnapshot` | 30 | 同步快照比较纯函数 |
| `parseLakeManifest` | 121 | manifest 解析（字节 → 对象） |
| `isGzip` | 138 | gzip 魔数检测 |
| `collectManifestRefs` | 856 | GC 引用收集（纯 Set 运算） |
| `normalizeEndpoint` | 991 | endpoint 规范化 |
| `validateS3Settings` | 1005 | S3 配置校验 |
| `errorMessage` | 1018 | 错误消息提取 |
| `isNoSuchKey` | 1026 | 404 判定 |
| `sha256Hex` | 1033 | Buffer 版（core 已有 crypto.subtle 版，需统一/并存决策） |
| `mimeTypeFor` | 1037 | 文件名 → MIME |
| `assertSafeKey` | 1049 | S3 键安全校验 |
| `chunkArray` | 1053 | 分块 |
| `validateManifest` | 1060 | **manifest 结构/上限/字段校验（审计 C3 的核心）** |

### B. 编排段（依赖 store + S3 → 端口化后进 core，移动端复用的主体）

| 段 | 行 | 说明 |
|---|---|---|
| `syncNow` 下载对账 | 350-600 | 墓碑/恢复/正文对账/锁/元数据 LWW/superseded 留档 → 需端口（S3Store + SyncDbPort）|
| `syncNow` 上传发布 | 600-800 | 对象上传/资源扫描/manifest 组装/发布/记账 |
| `syncNow` 记账收尾 | 780-850 | setBaseHash/lastUploadedHash/markSyncedIfUnchanged |
| `pruneOldManifests` | 1123 | commit 链裁剪（纯 S3 操作） |

### C. 桌面 adapter 层（留在 electron/，不拆）

| 项 | 行 | 说明 |
|---|---|---|
| `ObjectStore` | 145 | S3 客户端（桌面实现，移动端用 CapacitorHttpHandler） |
| `testConnection` | 318 | 桌面连接测试 |
| `runGcReconcile`/`runDeepCleanup` | 866/923 | GC（桌面特有，移动端不需要） |
| 类型 `S3Settings`/`SyncResult`/`SyncProgress`/`SyncWarning` | 48-72 | 可下沉 core 共享（移动端同步结果类型） |

## 3. 分步实施（每步独立可回滚，408 测试全程绿）

### Step A：纯逻辑段批量下沉（零风险，先做）
把 §2.A 的纯函数移到 `src/core/`（按主题合并，如 `src/core/syncUtils.ts` + 现有文件），
`electron/sync.ts` 改 import + re-export（外部调用方不感知）。
- **验收**：408 测试全绿 + 边界检查通过 + git diff 仅「移动 + re-export」。
- **注意**：`sha256Hex`（Buffer）与 core `sha256`（crypto.subtle）双版本决策——桌面主进程可保留 Buffer 版（re-export），移动端用 crypto.subtle 版；hash 输出一致。

### Step B：墓碑/恢复/对账决策纯函数化
把 `syncNow` 下载段的**分支决策**（417-464：purge/移回收站/恢复/锁 LWW/元数据 LWW/superseded 触发条件）
抽成 core 纯函数（输入 local/remote 状态 + 基线 → 动作枚举），带表驱动测试。
- **验收**：决策函数表驱动测试绿 + 408 全绿（syncNow 改调纯函数，行为不变）。

### Step C：下载对账循环端口化
把 §2.B 下载段抽成 `src/core/syncDownload.ts`（注入 `S3Store` + `SyncDbPort`），
桌面 syncNow 的下载段替换为调用它。
- **验收**：408 全绿 + 语义等价测试（同一批 manifest → 桌面旧逻辑 vs 共享模块输出一致）+ 边界检查。

### Step D：上传发布记账端口化
同 Step C，抽 `src/core/syncUpload.ts`（对象上传/资源扫描/manifest 组装/发布/记账）。
- **验收**：同 Step C。

### Step E：sync.ts 缩减 + 移动端接线
- 桌面：sync.ts 保留 adapter 装配（ObjectStore → S3Store、store → SyncDbPort）+ GC/进度/warnings UI 接线。
- 移动端：adapter（CapacitorHttpHandler → S3Store、sql.js → SyncDbPort）复用 Step B/C/D 模块。
- **验收**：双端真机 A/B（gzip manifest、删除/恢复、图片、锁）行为一致。

## 4. 移动端复用方式（不重写）

- 移动端**不再有自研 syncEngine**：直接调 `src/core` 拆出的模块（download/upload 段 + 决策纯函数）。
- 移动端 adapter = `S3Store`（已有 s3Store.ts 思路）+ `SyncDbPort`（已有 dbPort 思路）——只需按共享模块的端口契约对齐。
- C2 修复（saveNote 置 sync_state='local'）从 mobile-capacitor 保留。

## 5. 与已有共享的关系

- `src/core/lakeReconcile.ts`/`decideUpload.ts`/`syncDecision.ts`（V5 Phase 1 已抽）：已是桌面逻辑抽出的决策函数，保留为 Step B 的基础（Step B 是把 sync.ts 剩余的内联决策也抽出来）。
- `src/core/assetUrl.ts`（master df29fa7 新增）：图片 canonical 解析器，独立于同步拆分，无冲突。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 拆分段行为漂移 | 每步 408 全绿 + 语义等价测试（同一批输入对比） |
| sha256 双版本 | 输出一致（SHA-256 确定性），测试覆盖 |
| 与并行会话（master 图片方案）冲突 | 独立分支；合入前 rebase master |
| 移动端现有实现浪费 | syncEngine 已废弃；adapter 端口思路保留（s3Store/dbPort 代码可复用） |

## 7. 明确不做

- 不合并 GC 进共享（桌面保留 runGcReconcile/DeepCleanup）
- 不改 manifest 协议（v4 不变）、不引入 CAS
- 不预先设计"完整共享引擎"（需要哪个拆哪个，KISS）
