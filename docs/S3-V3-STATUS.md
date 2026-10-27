# S3 v3 交接（261027 最终态）

> 权威交接在仓库 `docs/HANDOFF.md` §0「261027」；本文件是 S3 v3 专项索引/收尾记录。
> 基线：`master` @ `08345db5`（已推送 gitee，私有仓）；旧协议备份 `backup/master-pre-s3v3-261027`（b8f67c33）也已推送。

## 1. 当前状态

- **S3 v3 已完成并转正合并**（`750d24de`），后续收口提交：`99c6d052` / `ae3556c5` / `08345db5`。
- 门禁：vitest **434 文件 2747 例**、tsc 0、bundle/core/mobile-UI 检查全绿、双端整页快照（移动 6 态 / 桌面 34 稳定态）0 差异、桌面 `vite build` + Android APK + packaged smoke 均通过。
- 旧协议完整保留在备份分支；b8f67c33 的公开镜像清理改动已逐项核对（见 HANDOFF §0）。

## 2. 代码地图（v3）

| 层 | 位置 |
|---|---|
| 协议/引擎 | `src/core/s3v3Engine.ts`（pointer + 索引/声明/正文/资产、merge/gate/gc、按需资产、待补账本、并发重试）· `s3v3Index/Pointer/Merge/Gc/Transfer/AssetBackfill` |
| 设备契约 | `src/core/s3v3DeviceStore.ts`（含 `listAssetStats` / `assetNativePathFor` / `pendingAssets`） |
| 桌面 | `electron/s3v3/`（DesktopStoreDevice、desktopSync、S3 remote、conformance） |
| 移动 | `src/mobile/v3/`（MobileDeviceStore、S3 remote、sync）、`src/mobile/bridge/{sync,notes,assets}.ts`、`src/mobile/native/{assetFs,bodyStore,nativeAssetSync}.ts` |
| Android 原生 | `android/.../AssetSyncPlugin.kt`（流式 GET/PUT + 本地读写/stat；`BodyStorePlugin.kt`） |
| conformance | `electron/s3v3/deviceConformance*.ts`（双端 15+15 + 混合 3） |
| 迁移/兼容 | `src/core/s3v3Migration*`、`electron/ipc/*sync*`、移动 `syncResumeMarker` |

## 3. 如何验证（按成本排序）

1. 全量门禁：`npx vitest run` / `npx tsc --noEmit` / `npm run check:core` / `npm run check:bundle` / `npm run check:mobileui`。
2. 双端一致性：`npx vitest run electron/s3v3/deviceConformance*.test.ts src/mobile/v3/deviceConformance.mobile.test.ts`。
3. 桌面打包冒烟：**真实 node_modules** 下 `npx electron-builder --dir` → `node scripts/e2e-packaged-smoke.mjs`（打包自检见 `docs/RELEASE.md` §〇）。
4. 移动：`./scripts/android-build.sh --sync` → 装到模拟器 → 配测试桶（`lakex-notes-dev4/vis-r1` 600 篇 / `quick-r1` 带图小记，密钥在 `/tmp/lake-ab/s3.secret`，勿提交/打印）。
5. 整页快照：移动 `check-mobile-snap --port 9336`（专用 AVD lake_gate + gate-fixture）；桌面 `check-stylesnap --port 9231`（独立 LAKE_USER_DATA + make-fixture）。

## 4. 已知问题 / 边界

- **测试桶污染**：vis-r1 的 vis-0591 曾挂 4×25MB 基准文件；已重写 declaration/index/pointer（generation 9）移除并删对象；旧 index 对象待深度清理。
- 「首拉后首开文档 18s」= 上述大文件下载，非产品回归（干净数据 171ms/67ms 已验证）。
- 桌面快照 settings 4 态仅指纹漂移（设置页动态值）；CI 建议按 README 双实例自证。
- 超大附件 MPU/分片上传：按用户决定不做（笔记本挂大附件低频）。
- 打包：禁止在 symlink node_modules 的 worktree 出包（sharp `@img/*` 会漏，主进程崩）；用真实 node_modules + 自检脚本。

## 5. 后续待办

1. DMG/签名/公证（`docs/RELEASE.md` 的 Apple 侧流程）。
2. CI 增加 `e2e-packaged-smoke` 与（可选）双端 conformance。
3. 发布前复跑设备冒烟；如需干净桶，建议新建 `vis-r2` 前缀重灌数据。
4. 深度清理测试桶孤儿对象（旧 index/旧 declaration）。
