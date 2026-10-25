# S3 v3 移动端接入方案（待实施）

> 背景：桌面 v3 已接入并通过 4 桌面真实 UI 矩阵；移动端仍是旧同步路径，2 台移动设备无法做 v3 实测。
> 本文件只做方案与映射，不代表已实现/已测试。

## 1. 移动端现状（旧同步）

- 入口：`src/mobile/bridge/sync.ts` 的 `bridge.syncNow()`（设置页/首页调用）。
- S3 端口：`src/mobile/native/s3Store.ts`（@aws-sdk/client-s3 + CapacitorHttpHandler/OkHttp），实现 core 的 `S3Store`。
- DB 端口：`src/mobile/bridge/context.ts` 构造 `SyncDbPort`；正文/小记/历史走 `BodyStorePlugin` 文件（`src/core/noteBodyPaths.ts`），SQLite 只存元数据/hash/同步账本。
- 引擎：`src/core/syncEngine.ts`（旧 manifest 链）。

## 2. 需要新增的模块

| 文件（建议） | 作用 |
|---|---|
| `src/mobile/v3/mobileDeviceStore.ts` | 实现 `S3v3DeviceStore`：MobileDb + BodyStore + 资产文件 |
| `src/mobile/v3/s3v3Remote.ts` | 实现 `S3v3Remote`：复用 s3Store 的 S3 client/gzip/LIST/DeleteObjects |
| `src/mobile/v3/sync.ts` | 编排：读 pointer→拉取→合并→上传→发布；映射到 bridge 返回结构 |
| `src/mobile/data/v3StateRepository.ts` | SQLite 新表：baseline / intents / pending / remotePurged / restorePending / assetsHash |
| schema 变更 | `MOBILE_SCHEMA_VERSION + 1`，按移动端批量 DDL 规范加表/索引 |
| `bridge/sync.ts` 分支 | feature flag（设置项/构建常量）切到 v3；默认仍旧路径 |

## 3. 映射表

| v3 契约 | 移动端来源 |
|---|---|
| `DeviceState.lake.notes` | `listNotes` / notes 表（id/title/parent_id/sort_order/updated_at/content_hash/kind/icon/locked/trashed_at/deleted_from_parent_id） |
| `DeviceState.lake.folders` | notebookTreeRepository（notebook/group/icon/sort/trash） |
| `readBody/writeBody` | `noteBodies.ts` + BodyStorePlugin（原子写） |
| `readAsset/listAssets/writeAsset` | 移动端 assets 表 + 私有 Data 文件；附件按 filename 内容寻址 |
| 小记 | quick_notes 表 + quickNoteTagService/tag links + BodyStore 小记正文/图片 |
| baseline/intents/pending/restore | 新增 v3 状态表（JSON 列或分列） |
| history | 移动端历史快照表/文件（archive/superseded 留档） |

## 4. 关键差异与风险

1. **无 Node**：v3 引擎依赖 `Buffer`/`gzip`/crypto？核心已用纯 JS（sha256Hex 基于 WebCrypto/实现需核对）；S3 端口需走 CapacitorHttp。
2. **SQLite 批量 DDL**：必须 `user_version +1`，DDL 放 `baseSchemaStatements`/`collectSchemaStatements`，禁止逐条 exec。
3. **小记**：桌面适配器目前不支持小记；移动端必须一开始就接（否则真实用户丢小记或无法同步）。
4. **schema/迁移**：旧库需从旧 manifest 账本迁移到 v3 sidecar（baseline 等），移动端升级顺序、回滚预案。
5. **真机/模拟器**：已有 AVD `lake_gate`/`lake_mobile` 与 `android/app/build/outputs/apk/debug/app-debug.apk`；设备级点击走 CDP `Input.dispatch*`（AGENTS §7.19）。
6. **测试夹具**：移动快照门禁依赖专用 AVD/夹具，v3 测试不要污染 `lake_gate` 基线。

## 5. 实施顺序（建议批次）

1. **纯适配器 + 假 DB/假 S3 单测**（Node/vitest，用移动端 fake bridge）：DeviceState 映射、正文/资产读写、墓碑/恢复。
2. **v3 状态表 + schema 迁移**：baseline/intents/pending 落库；单测覆盖重启/崩溃续跑。
   - ✅ 已完成第一步：`src/mobile/data/v3StateRepository.ts`（sync_v3_state JSON 账本 + 2 例单测）；尚未并入 MOBILE_SCHEMA_VERSION/未接引擎。
3. **移动 S3v3Remote**：复用 s3Store 的 S3 client；真实 S3 集成（dev 前缀）。
4. **bridge.syncNow v3 feature flag + 移动 UI 同步按钮/状态**；旧路径保留回滚。
5. **2 台模拟器/真机真实点击**：建文档/编辑/删除/恢复/彻底删除/冲突，观察 S3 对象与指针。
6. **指标**：移动端耗时、流量、对象数、索引大小；与桌面/旧移动同步对比。

## 6. 结论

- 移动端 v3 是**独立中等偏大批次**（适配器 + 状态表 + S3 端口 + UI 分支 + 设备矩阵），不属于“补测试”。
- 在未完成前，最终报告只声明桌面通过；移动端不计入通过项。
