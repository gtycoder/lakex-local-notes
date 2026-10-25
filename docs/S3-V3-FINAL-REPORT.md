# S3 v3 最终对比与测试报告（261025 · 桌面实测批）

> 分支 feat/s3-v3（master 未动）· 报告范围：协议内核 + 桌面应用层接入 + 4 桌面真实 UI 矩阵 + master A/B + 真实 S3 压测。
> 移动端：**未完成 v3 适配与测试**（见 §6），本报告不把移动端计入通过项。

## 1. 结论

1. **桌面 v3 已接入应用**（feature flag LAKE_SYNC_PROTOCOL=v3），真实 Electron UI 点击/键盘输入 + 真实七牛 S3 的 2 端、4 端推拉均通过。
2. **4 桌面矩阵发现并修复 P0 多端回退 bug（B14）**：修复后四端正文 sha256 完全一致（77156366…）。删除/回收站真实点击又发现并修复 B15（适配器墓碑应用路径）。
3. **master 旧同步 vs v3 指标已有真实 S3 A/B**：v3 初始上传快 1.3~1.8 倍、零变更快 12~94 倍；增量慢 1.5~2.2 倍；无附件字节少 4.7%，有附件 byte 多 3.6%（声明开销）。
4. **协议层测试**：引擎 16 例、核心/协议/并发/迁移/合成大规模 83+ 例全过；真实 S3 集成、200×10 与 500×20 规模、合成 2 万/20 万均通过。
5. **尚不能宣布整机上线**：桌面通过；移动端基础链路已在 2 台模拟器打通（bridge 触发），但真实点击/附件/小记/删除路径与指标未测；需完成 §6 清单后才能谈正式环境。

## 2. 交付物

### 2.1 协议（src/core/s3v3*.ts）
pointer 状态机 / 不可变索引与资产声明 / 三方合并 / 删除意图 / 待删门禁 / GC 差集 / 并发池（runPool/runPoolSettled）。

### 2.2 运行时（electron/s3v3/）
| 文件 | 作用 |
|---|---|
| s3Remote.ts | 七牛/S3 兼容远程 |
| deviceStore.ts | 设备契约 S3v3DeviceStore |
| fileDeviceStore.ts | 文件实现（测试/CLI） |
| desktopStoreAdapter.ts | 真实桌面 Store 适配器 v1（Lake 文档/目录/附件；sidecar；quick notes 未支持） |
| syncEngine.ts | v3 同步引擎（先拉后推/发布锁+读回/门禁/意图/清理/重拉） |
| desktopSync.ts | 桌面 v3 入口（LAKE_SYNC_PROTOCOL=v3；LAKE_S3V3_EMPTY_CLOUD） |
| migrate.ts | 旧 Manifest→v3 迁移 |
| syncEngineController.ts | 桌面 Controller 顶部 v3 分支 |

### 2.3 测试资产
- 单元/回归：src/core/s3v3*.test.ts、electron/s3v3/syncEngine.test.ts（16）、desktopStoreAdapter.test.ts（5，含墓碑→回收站、恢复→取消回收站、远端 purge→本地回收站副本回归）、desktopSync.test.ts（1）、migrate.test.ts（1）
- 真实 S3：s3.integration.test.ts、migrate.integration.test.ts、scale.integration.test.ts、ab.integration.test.ts
- 合成 2 万/20 万：src/core/s3v3Scale.test.ts
- UI 证据与流程：docs/S3-V3-UI-SMOKE.md、docs/S3-V3-AB-COMPARISON.md

## 3. 真实 UI 多端结果

### 3.1 2 桌面（真实 Input 鼠标点击 + 键盘输入）
| 步骤 | 结果 | 耗时 |
|---|---|---|
| A 首传 | uploaded=1，v3-g1 | 663ms |
| B 首拉 | downloaded=1，v3-g1 | 212ms |
| B 编辑正文 + 同步 | uploaded=1，v3-g2 | 790ms |
| A 同步 | downloaded=1，v3-g3；正文含 from-B | 590ms |

### 3.2 4 桌面（修复 B14 后）
| 步骤 | 结果 |
|---|---|
| A 首传 | uploaded=1，670ms，v3-g1 |
| B/C/D 拉取 | downloaded=1，258/172/212ms |
| D 编辑 + 同步 | uploaded=1，563ms，v3-g2 |
| A/B/C 同步 | downloaded=1，137/121/124ms，manifestId=v3-g2 |
| 四端正文 | sha256 全部 77156366fe85…，均含 from-D5 |

说明：同步按钮用 DOM button.click() 触发（真实 Input 点击被 hover 浮层拦截）；正文编辑仍是真实鼠标点击 + Input.insertText。

### 3.3 本轮 UI 测试发现的 P0（B14）
- 现象：4 端矩阵中 B/C 拉到新版本后未更新发布索引，下一轮把旧索引重新发布，云端回退、其他端丢更新。
- 根因：下载应用只更新 lakeEntries/quickEntries，未同步 lakeIndexEntries/quickIndexEntries。
- 修复：下载应用同时更新索引副本；回归测试去掉修复即失败（C 拉到 v1），恢复后通过（v2）。
- 提交：e68ce2ea；B15 修复：ed44694b，B15 回归测试：493faf51。

## 4. master 旧同步 vs v3（真实 S3）

| 场景 | 旧 | v3 | 说明 |
|---|---|---|---|
| 100 文档 初始 | 1916ms | **1501ms** | v3 快 1.3x |
| 100 文档 零变更 | 1668ms | **71ms** | v3 快 23x |
| 100 文档 改 5 篇 | **321ms** | 692ms | v3 慢 2.2x |
| 500 文档 初始 | 8401ms | **4736ms** | v3 快 1.8x |
| 500 文档 零变更 | 8285ms | **156ms** | v3 快 53x |
| 500 文档 改 5 篇 | **450ms** | 991ms | v3 慢 2.2x |
| 100 文档×5 附件 初始 | 7507ms | **5813ms** | v3 快 1.3x |
| 100 文档×5 附件 零变更 | 7252ms | **77ms** | v3 快 94x |
| 100 文档×5 附件 改 5 篇 | **396ms** | 848ms | v3 慢 2.1x |

字节/对象：
- 无附件 100 文档：旧 101,753B / 103 对象，v3 96,918B / 104 对象（-4.7%）。
- 有附件 100×5：旧 615,215B / 603 对象，v3 637,491B / 704 对象（+3.6%，多 101 份不可变资产声明）。

## 5. 真实 S3 与大规模数据

| 测试 | 数据 | 结果 |
|---|---|---|
| 集成 | 2 文档+附件+双端+purge+清理 | 3.3s 通过 |
| 规模（串行） | 200×10 附件，2391 对象 | 初始 154.8s / 拉取 80.1s |
| 规模（资源并发 8） | 同上 | 初始 50.1s / 拉取 26.1s |
| 规模（全局上传队列 8） | 同上 | 初始 **16.1s** / 拉取 **22.0s** / 增量 0.50s / purge 0.69s |
| 更大规模 | 500×20 附件，10,981 对象 | 初始 210.8s / 拉取 83.3s / 增量 0.66s / purge 0.93s |
| 合成 2 万/20 万 | 20k 文档，200k 附件 | 索引 5.40MB、声明 21.84MB；序列化 132ms/解析 161ms/合并 13ms/GC 19ms/门禁 5ms |

## 6. 未完成 / 上正式环境前必须做

1. **移动端 v3 基础链路已打通、但未做真实 UI 点击**：MobileDeviceStore（Lake/附件/目录/小记）+ 移动 S3v3Remote + v3 编排 + bridge flag 已完成；2 台模拟器（lake_mobile/lake_gate）用 bridge `syncNow()` 在真实 S3 上完成 A↑1→B↓1、B↑2→A↓1。**未做**：移动端真实点击、设备端附件/小记/删除路径、指标与 master A/B。详见 `S3-V3-MOBILE-DEVICE-TEST.md`。
2. **桌面 quick notes 未进 v3**：适配器检测到 quick-notes 库即拒绝；当前 v3 路由下桌面仍跑旧 quick-notes 通道（两个独立前缀并存）。需实现小记适配后再谈统一。
3. **回收站恢复/彻底删除的真实点击路径未覆盖**：删除→回收站已在 2 桌面真实点击验证（A 删除、B 收到 trashed_at；期间发现并修复 B15）；恢复/彻底删除仍待补。
4. **新建文档真实 UI 入口未锁定**：侧栏「新建」只弹新建笔记本，右键笔记本仅重命名/删除；本轮用编辑欢迎文档完成推拉。
5. **4 端矩阵的同步按钮用 DOM click 触发**；需要修掉 hover 浮层拦截，让真实 Input 点击可用。
6. **索引随文档数线性增长**：2 万文档索引 5.4MB；10 万文档前需分片索引（v3.1 预留）。
7. **未做 master 旧同步的 4 端 UI 对照**（旧引擎默认路径的 4 端实测）。
8. 桌面适配器能力缺口：quick notes、远端新建目录 id 映射（Store 创建接口不能指定 id）、lockedAt 精度。

## 7. 复跑命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npx tsc --noEmit
npx vitest run electron/s3v3/syncEngine.test.ts electron/s3v3/desktopSync.test.ts electron/s3v3/desktopStoreAdapter.test.ts electron/s3v3/migrate.test.ts
# 真实 S3（环境变量见报告/README，勿入库）
S3V3_IT=1 npx vitest run electron/s3v3/s3.integration.test.ts
S3V3_IT=1 npx vitest run electron/s3v3/migrate.integration.test.ts
S3V3_SCALE=1 S3V3_SCALE_DOCS=200 S3V3_SCALE_ASSETS=10 npx vitest run electron/s3v3/scale.integration.test.ts
S3V3_AB=1 S3V3_AB_DOCS=500 npx vitest run electron/s3v3/ab.integration.test.ts
npx vitest run src/core/s3v3Scale.test.ts
```

## 8. 判定

- **协议内核 + 桌面应用层：可以进入集成验收**（真实 S3、真实 UI 点击、4 桌面矩阵、A/B 指标均已有证据；P0 已修复）。
- **整机（含移动端）：未达到正式环境**；mobile 适配与 2 端实测、删除路径 UI、quick notes 统一、分片索引是大头。
