# S3 v3 同步协议 · 实施与测试报告（261025）

> 分支：`feat/s3-v3`（master 未动）· 实施时间：2026-10-25 · 状态：**协议内核已实现并通过真实 S3 验证；尚未接入 Electron/Android 应用层**
> 设计来源：[S3-REDESIGN.md](./S3-REDESIGN.md)（含两份独立审计与三轮复核处置）

## 0. 结论（先读）

1. **协议内核与运行时已完成**：指针状态机、不可变索引/声明、三方合并、删除意图、待删门禁、发布锁/读回、深度清理、旧 Manifest 迁移、文件设备模型、S3 远程实现。
2. **验证已覆盖**：单元/表驱动 70+ 例、双端假 S3 场景 12 例、迁移 1 例、真实七牛 S3 集成 1 例、真实 S3 规模 200 文档 × 10 附件（2391 对象）1 例、合成 2 万文档 / 20 万附件的索引级压测。
3. **关键实测结论**：七牛 Kodo **不支持条件写**（If-Match/If-None-Match 均被忽略；并发抢锁双持 20/20）→ v3 采用「持久删除意图 + 分叉检测 + 发布后读回」降级路线；读后写一致、LIST 即时、DeleteObjects、multipart 中止清理均通过。
4. **尚未达到「可替换现有线上同步」**：v3 引擎尚未接入 Electron 主进程/移动端（现有 syncEngine/syncEngineController 未改）、未接现有并发池、未做设备级 e2e；首次全量上云为串行传输，200×10 实测 155s，接入时必须复用现有 8 并发池。
5. **仓库存在 1 个与本批无关的既有红灯**：`electron/quickNotes.test.ts > 远端标签目录合并` 在 master 上同样失败（已用 master worktree 复核），不是 v3 引入。

## 1. 交付物与代码地图

### 1.1 协议纯逻辑（`src/core/`）
| 文件 | 内容 | 测试 |
|---|---|---|
| `s3v3Types.ts` | pointer 类型/校验、hash/epoch 形态 | `s3v3Protocol.test.ts` |
| `s3v3Pointer.ts` | 云端状态分类（no-baseline / empty / corrupt / epoch / rollback / **fork** / ok） | 同上 |
| `s3v3Decision.ts` | 三方单条目决策（restore → 删除意图 → 缺席/新增 → 常规） | 同上 |
| `s3v3Gate.ts` | 待删执行门禁（正文/附件/声明版本/旧索引/purge 前缀/小记同构；仍被引用→跳过并出队） | 同上 |
| `s3v3Intent.ts` | 删除意图生命周期（更高 generation 且索引不含 id / 显式 restore） | 同上 |
| `s3v3Keys.ts` | S3 key 布局与安全校验 | `s3v3Core.test.ts` |
| `s3v3Index.ts` | 不可变索引/资产声明的 canonical 序列化、hash、校验 | 同上 |
| `s3v3Merge.ts` | Lake/目录/小记三方合并计划 | 同上 |
| `s3v3Gc.ts` | 旧/新世界差集 → 待删键规划（含旧索引） | 同上 |
| `s3v3Scale.test.ts` | 2 万文档 / 20 万附件合成压测 | 独立 |

### 1.2 运行时（`electron/s3v3/`）
| 文件 | 内容 |
|---|---|
| `ports.ts` | S3 远程/设备存储端口 |
| `s3Remote.ts` | 七牛/S3 兼容实现（gzip、LIST 分页、DeleteObjects、前缀删除、读后一致） |
| `fileDeviceStore.ts` | 设备本地模型（正文/附件/基线/历史/待删/意图/恢复标记；原子写） |
| `syncEngine.ts` | v3 同步引擎：拉取→合并→上传→发布锁/读回→待删门禁→意图生命周期→深度清理→全量重拉 |
| `migrate.ts` | 旧 Manifest（含墓碑/回收站/小记标签）→ v3 索引+不可变声明+pointer |

### 1.3 探测/测试脚本
- `scripts/s3-v3-probe.mjs`：条件写/一致性/桶配置/ multipart 探测（只读环境变量，不落盘密钥）。
- 真实 S3 测试通过环境变量开关，默认跳过；不含任何密钥。

## 2. 测试方案（可复跑）

### 2.1 门禁（每次改动）
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npx tsc --noEmit
npx vitest run src/core/s3v3Protocol.test.ts src/core/s3v3Core.test.ts electron/s3v3/syncEngine.test.ts electron/s3v3/migrate.test.ts
npm run check:core
/usr/bin/git diff --check
```

### 2.2 合成大规模（无网络，2 万文档 / 20 万附件）
```bash
npx vitest run src/core/s3v3Scale.test.ts
```

### 2.3 真实 S3（七牛）集成与规模
```bash
# 凭证只放环境变量（勿入库）；建议测试后轮换 AK/SK
source /tmp/s3v3.env
export S3V3_IT=1 S3V3_PREFIX=lake-notes-v3-dev1
npx vitest run electron/s3v3/s3.integration.test.ts

export S3V3_SCALE=1 S3V3_SCALE_DOCS=200 S3V3_SCALE_ASSETS=10
npx vitest run electron/s3v3/scale.integration.test.ts
```
`测试前缀 = <S3V3_PREFIX>/_it|_scale/<随机 UUID>`，结束自动 `deleteByPrefix("")` 清空。

## 3. 测试结果（261025 实测）

| 测试 | 规模 | 结果 | 耗时 |
|---|---|---|---|
| 协议纯逻辑 | 44 例 | 全过 | 4ms |
| 核心索引/合并/GC | 18 例 | 全过 | 7ms |
| 双端引擎（假 S3） | 12 例 | 全过（初始化/增量/冲突/软删恢复/purge/恢复例外/锁/门禁/深度清理/缺对象/小记） | 83ms |
| 迁移 | 1 例 | 全过（墓碑丢弃、附件/回收站/标签保留、新设备可拉） | 11ms |
| 真实 S3 集成 | 2 文档+附件+双端+purge+清理 | 全过 | 3.3s |
| **真实 S3 规模** | **200 文档 × 10 附件 = 2391 对象** | 全过（初始化/全量拉取/增量/purge 零痕迹） | 初始化 154.8s / 拉取 80.1s / 增量 0.59s / purge 0.74s |
| **合成规模** | **2 万文档 / 20 万附件** | 全过 | 构建 1.57s / 序列化 132ms / 解析 161ms / 合并 13ms / GC 19ms / 门禁 5ms |

合成规模数字：索引 **5.40MB** 明文（20k × 约 270B，含 assetsHash）；资产声明总量 **21.84MB**（20 万条 × 约 109B，分散为 2 万对象）；索引解析 161ms、合并 13ms，均远低于预算。

### 3.1 真实 S3 探测（Kodo）
| 项 | 结果 |
|---|---|
| 覆盖写后读 | 30/30 一致（max 221ms） |
| `If-Match` / `If-None-Match` | **均被忽略（不支持条件写）** |
| 并发抢锁 | 双持 20/20（锁不能互斥） |
| PUT 后 LIST / DeleteObjects / multipart 中止清理 | 通过 |
| versioning / object lock / replication | 501 / 无配置 / 501 |

## 4. 发现并修复的 Bug（按严重度）

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| B1 | 数据错误 | 远端已彻底删除的条目被本地「回收站副本」重新上传到索引 | 同步索引排除 `remotePurged` 条目；本地状态保留回收站副本 |
| B2 | 数据丢失 | 仅远端元数据变化（正文 hash 不变）时本地状态未应用，且不判为变更 | `lakeChanged/quickChanged` 纳入 `applyRemote`，并按状态快照落盘 |
| B3 | 数据错误 | 删除意图在发布成功后被提前提升/清除，迟到覆盖可绕过 | 拆成「发布后钉住 generation」与「增量轮按更高 generation 清除」两个阶段 |
| B4 | 数据丢失 | 显式 restore 被本地删除意图压回（恢复例外失效） | 删除意图增加 `purgedAt`；远端条目 `updatedAt > purgedAt` 视为他端恢复，意图让位 |
| B5 | 数据错误 | 待删门禁「仍被引用 → 跳过」后未出队，永久滞留 | 执行后全部出队；删除失败才保留重试 |
| B6 | 数据丢失 | 发布后不推进基线 generation（无变更轮）导致重复比较/不收敛 | 无发布轮也按 pointer 更新 baseline（epoch/generation/commits） |
| B7 | 数据错误 | 本地历史快照写到了 archive/ 而非 history/ | 归档统一写 `history/` |
| B8 | 数据错误 | 小记删除没有删除意图，会被远端重新拉回 | 小记合并加入 purgeIntent → `local-purge`，与 Lake 同生命周期 |
| B9 | 数据错误 | 目录合并：本地有/远端无（基线存在）被误判为 download | 改为 `remote-purged-trash`（远端已删）或 upload（本地新建） |
| B10 | 数据错误 | 迁移测试小记缺正文对象（fixture 问题） | 修正测试夹具 |
| B11 | 设计风险 | 七牛不支持条件写，锁无法互斥 | 实测后定稿：持久删除意图 + 分叉检测 + 发布读回；限制写入文档 |

> 说明：以上均为本轮实现/测试中真实出现并修复的问题；修复后对应断言已加入测试。

## 5. 尚未完成 / 上生产前必须做

1. **接入应用层（最大缺口）**：把 `electron/s3v3/syncEngine.ts` 接入 Electron 主进程同步编排（替换/并行于现有 `syncEngineController`），移动端需按同一 core 逻辑实现；本次未改现有 `src/core/syncEngine.ts` / `electron/syncEngineController.ts`。
2. **传输并发**：当前引擎串行上传/下载（真实规模 200×10 初始化 155s）。生产必须复用现有 8 并发池（正文/资源各自上限），否则 2 万/20 万首装不可接受。
3. **UI/DB 映射**：文件设备模型需映射到现有 `store`/移动端 SQLite：baseline、intents、pending、remotePurged/restorePending 落库；设置页展示能力探测结果。
4. **迁移演练**：用真实旧库（dev 副本）跑「旧清单→v3」，双端升级顺序、旧客户端拒绝、回滚预案。
5. **真云复测最终桶**：换 provider/bucket/region 后用 `s3-v3-probe.mjs` + 集成测试复测；确认零痕迹部署约束（versioning/object lock/replication）。
6. **设备级 e2e**：桌面 Electron + Android 真机（先拉后推、离线、崩溃窗口、恢复例外、purge 零痕迹截图/断言）。
7. **AGENTS/HANDOFF 同批修订**：2 万/20 万规模承诺、§3 #3/#5/#11/#15 红线改写（v3 落地批内）。
8. **既有红灯**：`electron/quickNotes.test.ts` 标签目录合并用例在 master 同样失败，需单独修（与本批无关）。

## 6. 上生产判定

- **协议内核：可以进入集成**。核心语义（删除压编辑、恢复例外、冲突先提交者胜、回收站、标签 v3 口径）有表驱动测试与双端假 S3/真 S3 验证；零痕迹在真实 S3 已验证（purge 后前缀 0 对象）。
- **整机：还不能直接替换线上同步**。缺少应用层接入、并发池复用、设备级 e2e、迁移演练；在上述 5.1~5.8 完成前，不应把 v3 设为默认同步路径。
- 建议上线方式：新协议只在 `feat/s3-v3` 完成后，先在 dev 前缀与作者自己的第二台设备灰度；保留旧协议回滚窗口（旧数据不删、仅迁移指针）。

## 7. 分支与提交

```
feat/s3-v3
9adf3b4a docs(s3): v3 同步协议重设计 + 两份审计处置
7be3d223 feat(s3v3): 协议纯逻辑 + 44 例单测
8800656a chore(s3v3): Kodo 条件写探测脚本 + 实测结论
7354f541 docs(s3v3): provider 可移植性与能力探测
b4477f92 feat(s3v3): 运行时（S3 远程/文件设备模型/同步引擎）
074a64b9 feat(s3v3): 迁移/深度清理/真实 S3 与大规模测试
```
