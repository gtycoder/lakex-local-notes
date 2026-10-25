# S3 v3 转正/切换方案（261025）

## 1. 当前状态

- **桌面文档同步已默认 v3**：`syncEngineController.syncNowViaEngine` 在未设置 `LAKE_SYNC_PROTOCOL` 时走 v3；显式 `LAKE_SYNC_PROTOCOL=legacy` 才走旧通道（回滚）。
- 桌面小记已默认随 v3 同步；旧 quick-notes 通道只在 `LAKE_SYNC_PROTOCOL=legacy` 或 `LAKE_S3V3_QUICK_NOTES=0` 时使用。
- 移动端默认 v3：未设 `localStorage["local-lakex-notes-mobile.syncProtocol"]="legacy"` 即走 v3；旧移动同步仅 legacy 回滚。
- 移动端首次 v3：云端无 pointer 默认上传本地真相；同步后写「上次同步」状态并重建搜索索引。
- 移动端单条「保存并同步」也走 v3（整轮 v3 同步兜底）。

## 2. 切换语义（无历史数据兼容）

- v3 有独立 pointer/索引/对象前缀；旧 manifest 不读取、不迁移、不删除。
- 首次在旧库上开 v3：云端无 v3 pointer → **以本地真相全量上传**（`onEmptyCloud: "upload"` 默认）；旧云端数据原样保留，成为孤儿（可用旧通道回滚或另行清理）。
- 已有 v3 pointer 的设备：正常增量。
- 不做旧 manifest → v3 迁移、不做数据回填；符合项目的无历史兼容红线。

## 3. 回滚

- 回滚开关：`LAKE_SYNC_PROTOCOL=legacy`。
- 回滚后旧通道继续读写旧 manifest；v3 云端数据不动。
- 注意：v3 期间产生的文档修改会由旧通道重新上传到旧 manifest；v3 pointer 停在回滚前版本。
- 建议回滚窗口：**首次 v3 发布后的一个版本内**，且确认没有只在 v3 端写入的重要数据；之后回滚语义不再保证。

## 4. 已验证

- 真实 S3 默认路径（无 env）：首次空云端上传 + 二次空跑通过（`electron/s3v3/defaultSwitch.integration.test.ts`，1.08s）。
- 全仓测试 2,804 passed / 25 skipped（转正默认后）。
- 旧通道测试显式设 `LAKE_SYNC_PROTOCOL=legacy`，继续覆盖回滚路径。

## 4.5 桌面小记 v3（已默认）

- 默认：v3 文档通道下小记随同一轮同步；`LAKE_S3V3_QUICK_NOTES=0` 或 legacy 才走旧通道。
- 已实现：正文/附件/标签目录/标签关系/软删进回收站/远端删除跟随/**彻底删除 purged 墓碑跨端传播**；`DesktopStoreDevice` 注入 `QuickNotesStore`。
- 已验证 `electron/s3v3/quickNotesAdapter.test.ts` 3 例：文本创建→上传→双端拉取→编辑→删除回回收站；图片附件；彻底删除后另一端 active/trash 均无副本且指数组含 purged。
- 真实 S3：默认路径（无 env）同时上传文档 + 小记通过（`defaultSwitch.integration.test.ts`）。
- 单条“保存并同步”已改为 v3：v3 串行门内触发整轮 v3 同步兜底（先检查本地存在；返回 pushed）。
- `restore_missing_quick_note_from_cloud` 已改为 v3：从 v3 pointer/index 读正文+声明+附件并校验 hash，调用 `importRemoteQuickNote` 回填；legacy 才走旧 API。
- `sync_state` 仍被旧通道/UI 计数/legacy 回滚使用，仍不能删。

## 4.6 移动端 v3（已默认）

- 默认 v3；`syncProtocol=legacy` 回滚旧通道。
- 已验证：`src/mobile` 117 文件 526 例全过（含 v3 MobileDb/小记/标签/附件/回收站测试）；全仓 2807 例。
- 残留：**真实设备 UI 点击/设备路径验收未做**（仅 Node/sql.js 测试）；移动端单条推送目前用整轮 v3 同步兜底（较慢）；移动端缺正文小记的 v3 云端恢复尚未接。

## 5. 完整转正还差什么（sync_state 能否删除）

### 不能现在删的原因
`sync_state` 不是历史兼容字段，仍被以下活跃路径使用：
1. **旧同步通道**（回滚路径）：上传/下载/冲突/墓碑/markSynced/purged 语义；
2. **桌面小记旧通道**：待同步计数、markLocal/markSynced；
3. **编辑器/元数据写入**：改标题/移动/图标/回收站/历史恢复都会写 `sync_state='local'`；
4. **UI/诊断**：待同步计数与同步状态；
5. `sync_state='purged'` 还承载“他端 folder 墓碑后保留回收站副本”的语义。

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
