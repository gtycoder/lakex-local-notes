# S3 v3 转正/切换方案（261025）

## 1. 当前状态

- **桌面文档同步只走 v3（261026 起）**：`syncEngineController.syncNowViaEngine` 固定进 v3；旧通道（legacy 文档/旧 quick-notes/单条推送/旧 GC）**已整段删除**，没有应用内回滚开关。
- 桌面小记随同一轮 v3 同步（同一 pointer 提交）。
- 移动端只走 v3（`runMobileV3Sync`）；旧移动同步分支已删。
- 移动端首次 v3：云端无 pointer 默认上传本地真相；同步后写「上次同步」状态并重建搜索索引。
- 移动端单条「保存并同步」也走 v3（整轮 v3 同步兜底）。

## 2. 切换语义（无历史数据兼容）

- v3 有独立 pointer/索引/对象前缀；旧 manifest 不读取、不迁移、不删除。
- 首次在旧库上开 v3：云端无 v3 pointer → **以本地真相全量上传**（`onEmptyCloud: "upload"` 默认）；旧云端数据原样保留，成为孤儿（可用旧通道回滚或另行清理）。
- 已有 v3 pointer 的设备：正常增量。
- 不做旧 manifest → v3 迁移、不做数据回填；符合项目的无历史兼容红线。

## 3. 回滚（换回旧版本客户端，无应用内开关）

- 旧版本客户端仍读写旧 `manifests/*`；v3 云端数据（pointer/索引/对象）**不动**。
- 回滚窗口内，v3 期间产生的文档修改会在旧通道下一次同步时重新上传到旧 manifest；**只在 v3 端写入且未回传旧 manifest 的数据，回滚后旧客户端看不到**（v3 pointer 也不回退）。
- 建议回滚窗口：**升级后的一个版本内**，且先确认没有只在 v3 端写入的重要数据；之后不再保证回滚语义。
- **不提供** `LAKE_SYNC_PROTOCOL=legacy` 之类的应用内回滚（261026 已删）。

## 4. 已验证

- 真实 S3 默认路径（无 env）：首次空云端上传 + 二次空跑通过（`electron/s3v3/defaultSwitch.integration.test.ts`，1.08s）。
- 全仓测试 2,804 passed / 25 skipped（转正默认后）。
- 261026 门禁：`npx tsc --noEmit` + 定向 vitest（s3v3/移动 v3/相关守卫）+ 双端 `vite build` 通过；旧通道测试随旧模块一起删除。

## 4.5 桌面小记 v3（已默认）

- 默认：v3 文档通道下小记随同一轮同步；`LAKE_S3V3_QUICK_NOTES=0` 或 legacy 才走旧通道。
- 已实现：正文/附件/标签目录/标签关系/软删进回收站/远端删除跟随/**彻底删除 purged 墓碑跨端传播**；`DesktopStoreDevice` 注入 `QuickNotesStore`。
- 已验证 `electron/s3v3/quickNotesAdapter.test.ts` 3 例：文本创建→上传→双端拉取→编辑→删除回回收站；图片附件；彻底删除后另一端 active/trash 均无副本且指数组含 purged。
- 真实 S3：默认路径（无 env）同时上传文档 + 小记通过（`defaultSwitch.integration.test.ts`）。
- 单条“保存并同步”已改为 v3：v3 串行门内触发整轮 v3 同步兜底（先检查本地存在；返回 pushed）。
- `restore_missing_quick_note_from_cloud` 已改为 v3：从 v3 pointer/index 读正文+声明+附件并校验 hash，调用 `importRemoteQuickNote` 回填；legacy 才走旧 API。
- `sync_state` 列已在 261026 删除（统一 `is_dirty`/`is_purged`）；本节旧描述只作历史。

## 4.6 移动端 v3（已默认）

- 默认 v3；`syncProtocol=legacy` 回滚旧通道。
- 已验证：`src/mobile` 117 文件 526 例全过；全仓 2808 例；**真实 S3 移动端 v3 双端（文档 + 小记）通过**（`sync.s3.integration.test.ts`）。
- 残留：**真实设备 UI 点击/设备路径验收未做**（仅 Node/sql.js 测试）；移动端单条推送目前用整轮 v3 同步兜底（较慢）；移动端缺正文小记的 v3 云端恢复尚未接。

## 5. sync_state 删除（261026 已完成）

`notes.sync_state` / `tree_nodes.sync_state` / `quick_notes.sync_state` 已删除，统一 `is_dirty` / `is_purged`；移动端 schema v8 同步删列。旧通道随之删除，不再有「等 legacy 停写」的迁移条件。以下历史条目保留作背景：
1. 旧同步通道（已删）；
2. 桌面小记旧通道（已删）；
3. 编辑器/元数据写入 → 改 `is_dirty`；
4. UI/诊断待同步计数 → v3 报告 / `is_dirty`；
5. `purged` 语义 → v3 删除意图 / `is_purged`。

### 删除条件（全部满足后一次性删，不做回填/兼容）
1. 桌面小记迁入 v3（含删除/回收站/标签/附件语义），旧 quick-notes 通道停写；
2. 移动端 v3 默认并完成真实 UI/设备路径验收，旧移动同步停写；
3. UI 待同步计数改用 v3 同步报告/本地 pending 状态，不再读 `sync_state`；
4. `purged` 语义迁移到独立字段/墓碑状态；
5. 旧同步代码与测试整体删除，保留 v3 单通道。

完成后一次性删除 `notes.sync_state`、`tree_nodes.sync_state`、`quick_notes.sync_state` 及相关索引/写入点；测试夹具重建，不迁移旧值。

## 6. 下一阶段顺序

1. 桌面小记 v3 适配器（读写/删除/回收站/标签/附件）；
2. 小记旧通道停写 + 小记 v3 灰度；
3. 移动端 v3 默认 + 设备 UI 验收；
4. 删除旧同步通道 → 删除 sync_state 等字段；
5. 标签独立空间/文档标签 UI 可并行，但完整替代前需完成。
