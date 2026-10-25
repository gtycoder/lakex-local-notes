# S3 v3 数据量与增量同步性能（261025，聚焦单用户/多端少量）

> 本轮不追求多端并发上限；聚焦「数据量增长后的增量同步速度、瓶颈、可用范围」。
> 测试：真实桌面 Store + DesktopStoreAdapter + core v3 引擎；本地用 MemoryRemote（扣掉网络，测 CPU/IO），真实 S3 用七牛（含网络）。

## 1. 增量同步实测（改 10 篇文档）

| 文档数 | 空跑（无变更） | 改 10 篇 | 首次上传 | 环境 |
|---|---|---|---|---|
| 500 | 23ms | **75ms** | 181ms | 本地假 S3 |
| 2,000 | 80ms | **162ms** | 537ms | 本地假 S3 |
| 5,000 | 195ms | **344ms** | 1.27s | 本地假 S3 |
| 10,000 | 392ms | **621ms** | 2.53s | 本地假 S3 |
| **20,000** | **823ms** | **1,128ms** | 5.0s | 本地假 S3 |
| 1,000 | 83~87ms | **710~812ms** | 7.4~7.9s | 真实 S3 |
| 5,000 | 251ms | **1,170ms** | 40.4s | 真实 S3 |

（优化前本地：500 文档 139ms、2,000 226ms、5,000 410ms；本轮降到 75/162/344ms。）

### 阶段拆解（本地假 S3 20,000 文档，改 10 篇，总 1,128ms）
| 阶段 | 耗时 | 说明 |
|---|---|---|
| load-state | 655ms | 20k 文件 stat + hash 缓存 + SQL 映射 |
| merge | 23ms | 三方合并 |
| publish-save-state | 219ms | 本地状态落盘（含 hashCache sidecar 20k 条） |
| publish-lock | 42ms | 静置 40ms（内存 RTT≈0） |
| publish-index | 54ms | 20k 索引序列化/哈希/写内存 |
| publish-finalize | 87ms | baseline（5.4MB gzip level1） |
| pending | 41ms | 旧正文删除 |

真实 S3 在此基础上加约 6~10 次网络 RTT（+300~600ms），2 万文档增量预计 **1.5~2.5s**。

### 阶段拆解（真实 S3 5,000 文档，改 10 篇，总 1,170ms）
| 阶段 | 耗时 | 说明 |
|---|---|---|
| load-state | 191ms | listNotesSyncMeta + 5k 文件 stat + hash 缓存 |
| uploads | 123ms | 10 篇正文 PUT（8 并发） |
| publish | 562ms | 锁（40ms 静置）+ 全量索引序列化/哈希 + 索引 PUT + pointer 写/读回 + baseline |
| pending | 234ms | 旧正文 DeleteObjects |
| total/其他 | 52ms | 指针/云状态等 |

## 2. 本轮优化（已提交）
1. **轻量元数据查询** `Store.listNotesSyncMeta()`：单 SQL 取代逐篇 `getNoteInfo`（原实现每篇读正文、算字数、扫资产卡片；大库是主要慢点）。
2. **正文 hash 缓存**：文件 `mtime+size` 未变直接复用 hash，首次全量后不再读所有正文。
3. **无变化半边不序列化**：空跑/仅一边变更时不做全量 `serialize/hash`。
4. **发布锁静置 100→40ms**：单用户场景降低固定发布延迟；多端冲突仍由锁重试/归属复核兜底。
5. **baseline/S3 gzip level 9→1**：JSON 压缩率几乎相同、CPU 更低。

### 增量发布阶段拆解（真实 S3，1,000 文档，改 10 篇，总 832ms）
| 阶段 | 耗时 | 说明 |
|---|---|---|
| load-state | 54ms | 轻量元数据 + stat/hash 缓存 |
| uploads | 165ms | 10 篇正文 PUT（8 并发） |
| publish-save-state | 17ms | 本地状态落盘 |
| publish-lock | 152ms | 读锁 + 写锁 + 静置 40ms + 读回（约 4 个 RTT） |
| publish-index | 78ms | 读 pointer + 写索引 |
| publish-pointer | 121ms | 写 pointer + 读回 |
| publish-finalize | 11ms | 本地 baseline |
| pending | 176ms | DeleteObjects 旧正文 + 状态落盘 |
| total | 53ms | 收尾/云状态等 |

结论：增量同步已接近**网络 RTT 下限**（约 10~12 次对象操作 × 30~60ms）。继续压缩需要协议级改变（如合并发布、延迟清理），不是简单代码优化；当前 2 万目标内不做过度优化。

## 3. 数据量范围（单用户常用场景）
| 范围 | 文档/附件 | 增量同步 | 首次同步 | 结论 |
|---|---|---|---|---|
| 舒适 | ≤2 万文档 / 20 万附件 | 约 **1.5~2.5s**（真实 S3；本地 CPU 1.13s） | 约 **2~3min** | 日常使用可接受 |
| 第二瓶颈 | ~5 万文档 / 50 万附件 | 约 **5~10s** | 约 **7~10min** | 仍可用，但每次发布明显等待；进入优化区 |
| 不可用 | ≥10 万文档 / 100 万附件 | **>15~20s** | >15~30min | 需要分片索引/增量发布重构 |

- 上述为外推（5,000 文档实测 + 10,000 文档本地 CPU + 真实 S3 网络），不是 5 万/10 万实测。
- **第一个瓶颈**：首次全量上传的逐对象 RTT（附件数 × RTT / 并发 8）。
- **第二个瓶颈**：增量发布时**全量不可变索引的重写/传输/序列化** + 适配器全量 load-state 扫描；约在 5 万文档开始明显（增量 >5s）。
- 10 万前不需要分片；到第二瓶颈（5 万）再启动分片/增量索引优化，符合“达到第二个瓶颈再考虑”的原则。

## 4. 后续可选优化（到第二瓶颈再做）
1. 按笔记本/分页分片索引：增量只重写受影响分片 + 小 root。
2. 发布合并/延迟写（短窗口内多次本地变更合成一次发布）。
3. 适配器增量 load-state（利用本地脏标记/变更集，减少 2 万+ 文档的全量 stat/映射）。
4. baseline 增量存储或压缩级别自适应。

## 5. 准确性验证
- `electron/s3v3/correctness.integration.test.ts`：4 端 × 3 轮并发编辑共享文档 + 各端新建，最终 25 篇文档全端内容 hash 一致、云端索引一致、每篇正文可读；无丢失。
- `electron/s3v3/desktopStoreAdapter.cache.test.ts`：hash 缓存第二次 loadState 复用；直接改正文文件后 mtime/size 变化能重新识别（不丢外部编辑）。
- 全仓测试 2799→2800 例通过（新增用例后）。

## 6. 复跑
```bash
# 本地 CPU/IO（MemoryRemote）
S3V3_PERF_SIZES=500,2000,5000,10000 ./node_modules/.bin/vitest run electron/s3v3/perf.integration.test.ts
# 真实 S3（需凭证环境变量）
S3V3_IT=1 S3V3_PERF_DOCS=1000 ./node_modules/.bin/vitest run electron/s3v3/perf.s3.integration.test.ts
```
> 5,000 文档真实 S3 测得指标已记录；该次测试 wrapper 因整体时长超时失败，残留前缀已手工清理（1,004 对象）。
