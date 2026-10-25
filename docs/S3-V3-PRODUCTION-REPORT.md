# S3 v3 生产化收口报告（261025）

> 分支 feat/s3-v3（master 未动）· 全仓测试 2799 passed / 23 skipped · check:core 0 违规
> 结论：**桌面可进入小范围正式灰度；移动端基础链路可进入 beta；不建议直接全量替换默认同步路径。** 残留风险与准入门槛见 §8。

## 1. 交付范围

| 模块 | 内容 |
|---|---|
| 协议内核 | pointer 状态机、不可变索引/声明、三方合并、删除意图、待删门禁、GC、WorkingSet、并发池 |
| 桌面运行时 | S3v3Remote、FileDeviceStore、DesktopStoreAdapter、desktopSync、migrate、feature flag |
| 移动运行时 | 引擎下沉 core、MobileDeviceStore（Lake/附件/目录/小记）、移动 S3v3Remote、v3 编排、bridge flag |
| 标签 | 通用 `tags` + 多态 `tag_links` + `tag_link_versions`（桌面/移动）；文档标签服务；LWW/墓碑/合并 |
| 可观测性 | 阶段耗时 `onPhase`、慢阶段日志、错误分类 retryable/action-required/fatal |
| 测试 | 协议/核心/引擎/适配器/迁移/并发/容量/真实 S3；全仓 2799 例 |

## 2. 6 端并发（修复后）

- 修复前：6 端同时推送 5 端 `lock-busy` 直接失败（锁被占即抛）。
- 修复：有限重试 + 抖动 + 写后静置 100ms 读回 + 发布前锁归属复核 + 外层指数退避；锁等待可配置。
- 结果：
  - 假 S3 6 端同文档并发：无错误；1 发布/5 下载；输家本地历史均留档；两轮收敛；
  - 假 S3 6 端各自文档并发：6 端全部发布并收敛；
  - **真实 S3 6 端并发**：errs=[]，并发轮 7.6s，shared 唯一 hash，ownAll=true。

## 3. 容量三拐点

### 3.1 索引/声明（合成）
| 规模 | 索引 | 声明 | 序列化 | 解析 | 合并 | GC |
|---|---|---|---|---|---|---|
| 1 万/10 万 | 2.70MB | 10.9MB | 64ms | 78ms | 8ms | 10ms |
| 2 万/20 万 | 5.42MB | 21.8MB | 130ms | 162ms | 13ms | 18ms |
| 5 万/50 万 | 13.58MB | 54.6MB | 322ms | 383ms | 33ms | 63ms |

### 3.2 真实 S3 首同步（单设备）
- 200×10（2,391 对象）：初始化 16.1s / 拉取 22.0s；
- 500×20（10,981 对象）：初始化 210.8s / 拉取 83.3s；
- 外推 2 万/20 万：约 70min / 28min（逐对象 RTT 主导）。

### 3.3 并发发布容量（N 端同时改各自文档）
| 端数 | 耗时 | 错误 | 判定 |
|---|---|---|---|
| 12 | 8.1s | 0 | 正常 |
| 20 | 13.0s | 2 | 偶发 |
| 28 | 19.4s | 7 | 频发/不可用 |

### 3.4 三个容量点
1. **正常**：≤500 文档×20 附件（~1.1 万对象）、≤12 端同时发布；首同步 16~211s，增量 <1s。
2. **偶发错误**：~2 万文档/20 万附件首同步（~1h，网络超时/重试）；20 端并发发布（偶发 publish-conflict）。
3. **不可用**：>5 万文档或 >50 万附件（首同步数小时~天）；≥28 端同时发布（发布冲突频发）。

**真正瓶颈**：逐对象 RTT + 全局发布锁串行；索引 CPU/内存在 10 万文档前不是瓶颈。

## 4. 标签子系统

- 数据模型（桌面/移动同构）：
  - `tags`（目录，含墓碑）；
  - `tag_links(target_kind,target_id,tag_id,position)`（多态关联，正文不存标签名）；
  - `tag_link_versions(target_kind,target_id,links_updated_at)`（关系整体 LWW，独立于正文）。
- 文档标签：`DocumentTagsService` + `store.documentTags`（list/create/update/reorder/delete/merge/get/set）；`target_kind="note"`。
- 小记标签已迁移到通用表（桌面/移动），旧 `quick_note_tags/links` 表定义删除。
- 合并失败用例根因：测试时间戳早于本端创建时间（LWW 正确拒绝）；修正后 37 例通过。
- **残留**：v3 尚未独立 tags commit/index（标签仍随小记索引同步）；文档标签无 IPC/UI；桌面/移动仍有各自 merge 实现，未完全收敛到 `src/core/tags.ts`。

## 5. 代码 Review 与重构

- 已完成：WorkingSet（消除双 map，B14 类回归在 API 层不可再发生）；标签通用表；阶段耗时/错误分类；传输全局队列 8；锁重试/静置/复核。
- 仍建议：引擎拆模块（Pull/Upload/Publish/Pending）；适配器增量 loadState；发布分片/合并；错误码细分；统一 tag merge。
- 详见 `docs/S3-V3-CODE-REVIEW.md`。

## 6. 关键 Bug（已修 + 回归）
B1 回收站副本重传 / B2 仅远端元数据丢失 / B3 删除意图提前清除 / B4 restore 被压回 / B5 门禁未出队 / B6 基线不推进 / B7 历史写错目录 / B8 小记删除无意图 / B9 目录合并误判 / B10 迁移夹具 / B11 无 CAS / B12 上传失败污染索引 / B13 pointer 非法 JSON / **B14 下载后旧索引回发（P0）** / **B15 适配器墓碑路径**。

## 7. 测试与复跑
```bash
./node_modules/.bin/vitest run            # 全仓 2799 passed
node scripts/s3v3-verify.mjs              # v3 门禁（无需云凭证）
./node_modules/.bin/vitest run electron/s3v3/concurrency.integration.test.ts
S3V3_IT=1 ./node_modules/.bin/vitest run electron/s3v3/concurrency.s3.integration.test.ts
./node_modules/.bin/vitest run src/core/s3v3Capacity.test.ts
# 真实 S3 集成/规模/AB 见 S3-V3-FINAL-REPORT.md 与 S3-V3-CAPACITY.md
```

## 8. 上线判定与准入门槛

**可灰度（桌面）**：6 端并发、真实 S3、删除/回收站/恢复/彻底删除协议回归、A/B 指标均有证据；v3 仍是 feature flag，默认旧路径可回滚。
**移动 beta**：2 台模拟器真实 S3 推拉通过（bridge 触发）；UI 点击、设备端附件/小记/删除路径、指标未测。
**不建议全量&替换默认路径**，直到：
1. v3 独立 tags 空间落地（标签不再随小记索引）+ 文档标签 IPC/UI；
2. 发布分片/合并 + 适配器增量 loadState（解决 20/28 端与 2 万/20 万首同步）；
3. 移动端真实 UI 点击与设备数据路径验证；
4. 锁/并发在更大设备数（20+）与真实网络下的稳定性复测；
5. 正式桶能力探测（无版本化/对象锁/复制）与回滚演练。

## 9. 相关文档
- S3-V3-FINAL-REPORT.md / S3-V3-IMPLEMENTATION-REPORT.md
- S3-V3-CONCURRENCY.md / S3-V3-CAPACITY.md / S3-V3-CODE-REVIEW.md / TAG-SYSTEM-DESIGN.md
- S3-V3-MOBILE-PLAN.md / S3-V3-MOBILE-DEVICE-TEST.md / S3-REDESIGN.md
