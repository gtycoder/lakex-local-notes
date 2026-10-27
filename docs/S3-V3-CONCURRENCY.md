# S3 v3 多端并发推拉（6 端，261025）

## 场景
- 6 台设备（独立 FileDeviceStore）连同一真实/假 S3；先由 A 初始化上传 7 篇文档，其余 5 台各拉一轮。
- 并发轮：6 台**同时**修改同一篇 `shared` + 各自 `own-i`，同时调用 sync（`Promise.allSettled`）。
- 随后再统一 sync 一轮看收敛。

## 修复前（假 S3 + 网络延迟）
- 5/6 端直接失败 `lock-busy`：发布锁被占即抛错，没有重试。

## 修复（src/core/s3v3Engine.ts）
- 发布锁改为**有限重试 + 抖动 + 写后静置 100ms 再读回**；
- 发布 pointer 前 `assertLockOwned()` 再确认锁归属，被抢走则 PublishRetry（外层指数退避 + 抖动，最多 6 次）；
- 无 CAS 的 provider 下仍存在理论上的双持窗口（静置 + 复核已显著缩小），这是 Kodo 能力限制，残留风险写入文档。

## 修复后结果
| 场景 | 结果 |
|---|---|
| 假 S3 / 6 端同文档并发 | 无错误；1 端发布、5 端下载赢家；5 个输家本地历史均有留档；两轮后 6 端正文同一 hash |
| 假 S3 / 6 端各自文档并发 | 6 端全部 published；两轮后每篇在 6 端都等于各自编辑版本 |
| **真实 S3 / 6 端同文档 + 各自文档并发** | **errs=[]**；并发轮 7599ms；6 端 r1 全部 published；r2 全为下载/零发布；shared 唯一 hash；ownAll=true；冲突历史留档（赢家 0、其余 >0） |

## 发现与容量含义
1. **发布锁是并发写的串行瓶颈**：6 端同时推送时发布被串行化，真云并发轮 ~7.6s（每端 ~1.2s 量级）。设备数继续增加时，锁等待会线性变长。
2. **无 CAS ⇒ 锁不是强互斥**：静置 + 归属复核能避免常规交错；极端网络乱序下仍可能双持，靠 pointer 读回/分叉检测兜底，不能承诺强一致。
3. **同文冲突策略符合设计**：远端胜、输家本地强制留档；不会静默丢编辑。
4. **不同文档并发写**：全部保留并最终收敛，说明上传/合并本身可并发，只有发布被锁串行。

## 复跑
```bash
# 假 S3（无需凭证）
./node_modules/.bin/vitest run electron/s3v3/concurrency.integration.test.ts
# 真实 S3（环境变量同其它集成测试）
S3V3_IT=1 ./node_modules/.bin/vitest run electron/s3v3/concurrency.s3.integration.test.ts
```
