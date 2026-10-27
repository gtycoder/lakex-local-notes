# S3 v3 代码 Review（261025）

## 范围
- `src/core/s3v3Engine.ts`（~800 行，核心同步编排）、`s3v3Merge/Gc/Gate/Intent/Pointer/Index/Pool`。
- `electron/s3v3/*`（S3 远程、FileDeviceStore、DesktopStoreAdapter、desktopSync）。
- `src/mobile/v3/*`（MobileDeviceStore、S3v3Remote、sync 编排）、`bridge.syncNow` 分支。
- 相关测试与文档。

## 做得好的地方
1. 协议判定全部抽到 core 纯函数（merge/gate/intent/pointer/index），桌面/移动共用，测试覆盖较好。
2. 删除意图、待删门禁、发布读回、分叉检测形成了「无 CAS provider」下的完整防线。
3. 传输有界并发（runPool/runPoolSettled）、上传失败按 note 隔离、深度清理可兜底。
4. 文档/测试/审计链路完整，B14/B15 都有回归。

## 发现（按优先级）

### P0-1 发布锁不是强互斥（provider 限制）
- 现象：Kodo 无 CAS；锁靠写+静置+读回+归属复核，理论上仍可能双持；压力下 20 端偶发、28 端频发 `发布冲突重试超限`。
- 证据：docs/S3-V3-CONCURRENCY.md、docs/S3-V3-CAPACITY.md。
- 建议：provider 支持条件写时启用 CAS；否则把「发布合并/租约」做成显式机制，并在 UI 暴露“设备过多/稍后重试”的明确提示。

### P0-2 发布串行是并发容量上限
- 每端发布 ~0.6~0.9s，N 端排队；12 端 8.1s、20 端 13s（偶发错误）、28 端 19.4s（频发）。
- 建议：短发布路径（只发布变化的分区索引）、发布合并窗口、或按文档域分片锁，避免全局单锁。

### P1-1 引擎内部「双 map」结构易再犯 B14
- `lakeEntries`（本地状态）与 `lakeIndexEntries`（待发布）需手工同步；B14 就是漏同步导致旧索引回发。
- 建议：引入单一 `WorkingSet`（local + pendingIndex 明确派生），apply/upload/delete 只写一处，发布索引由 `WorkingSet.toIndex()` 生成；用类型/测试锁住不变量。

### P1-2 适配器全量 loadState
- 桌面/移动每次同步全量扫描文档元数据（2 万文档时是秒级 CPU/IO 叠加点），与传输 RTT 叠加。
- 建议：本地维护 `sync_state` 版本号/脏集合；loadState 支持增量查询（updated_at/last_synced_at），或每轮只取变化行 + 稳定哈希。

### P1-3 标签仍是「小记专属 + 内联索引」
- 表现：`quick_note_tags`/`quick_note_tag_links` 只服务小记；v3 小记索引内联 tags 目录与 tagIds。
- 建议：按 docs/TAG-SYSTEM-DESIGN.md 做 `tags` + 多态 `tag_links` + 独立 v3 tags 空间/commit；文档标签复用同一关联表。

### P2-1 引擎文件过大、职责混杂
- 约 800 行，拉取/合并/上传/发布/门禁/迁移/清理混在一起。
- 建议：拆 `S3v3Pull` / `S3v3Upload` / `S3v3Publish` / `S3v3Pending` 模块；engine 只编排；测试按模块化。

### P2-2 缺少阶段耗时日志
- 目前只有 `[v3] sync done` 总耗时；慢在拉取/上传/发布/门禁不可区分。
- 建议：engine 增加 `onPhase(phase, ms, detail)`；desktop/mobile 写结构化日志；>1s 记 info，>5s 记 warn；错误日志带设备/epoch/generation/commit。

### P2-3 错误码/告警分类不够细
- 已有 code，但并发/锁/重试与数据损坏混在 warnings；用户提示不够可操作。
- 建议：区分 `retryable`（网络/锁/冲突）与 `fatal`（pointer 损坏/分叉/epoch），UI 按类处理。

### P2-4 pointer v3 无 tags commit
- 标签独立同步需要 pointer 增加 `tags`；属于协议破坏性升级，按用户要求直接做最优（无真实数据兼容负担）。

### P3 文档/测试
- 测试夹具重复（MemoryRemote/FileDeviceStore 各文件复制），抽公共 helper；
- HANDOFF/README 需在收口时更新（当前 HANDOFF 只指向旧报告）。

## 推荐实施顺序
1. 阶段日志 + 错误分类（低风险，先获得可观测性）。
2. WorkingSet 重构（消除双 map，防 B14 类回归）。
3. 标签子系统重做（本地表 + 文档/小记关联 + v3 tags 空间）。
4. 发布分片/合并与适配器增量 loadState（容量优化）。
5. 全套回归 + 6 端/容量复测 + 最终报告。
