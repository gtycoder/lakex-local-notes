# S3 v3 转正后旧通道/字段移除计划（261025）

## 1. 当前已完成

- 桌面文档：默认 v3；`LAKE_SYNC_PROTOCOL=legacy` 回滚。
- 桌面小记：默认随 v3；正文/附件/标签/软删/purge 墓碑/单条推送/缺正文恢复都已走 v3。
- 移动端：默认 v3；`syncProtocol=legacy` 回滚；文档+小记真实 S3 双端验证。
- 真实 S3：桌面、移动默认路径均通过。

## 2. 仍被 `sync_state` 占用的活跃面（删除前必须迁移）

| 使用面 | 位置 | 迁移目标 |
|---|---|---|
| 桌面 UI 待同步/文档状态 | `src/components/model/documentStatusModel.ts`、`src/App.tsx`、tree types、`useSavePipelineGlue` | v3 本地 pending 状态（见 §3） |
| `purged` 回收站副本语义 | `isGoneNote`、旧同步 `syncEngine`、`syncReconciliation` | 独立 `is_purged`/墓碑字段 |
| legacy 文档同步 | `electron/syncEngineController.ts`、`src/core/syncEngine.ts`、等价测试 | 整段删除 |
| 旧 quick-notes 通道 | `electron/quickNotesSync.ts`、`core/quickNotesSyncEngine.ts`、旧单条推送 | 整段删除 |
| 移动旧同步 | `src/mobile/bridge/sync.ts` 旧分支、`data/syncDbPort.ts`、旧 quick 端口 | 整段删除 |
| 桌面诊断/待同步计数 | `diagnostics.ts`、`syncReconciliation.ts` | v3 报告/pending 状态 |

> `sync_state` 不是历史兼容字段；保留是因为上述活跃语义，不是为旧数据兜底。

## 3. v3 本地 pending 状态（替代 UI 读 sync_state）

- 不再引入“上传队列”；保留一个本地 `dirty` 标记（或等价派生）仅服务 UI：
  - 保存/标题/移动/回收站/恢复时置 dirty；
  - v3 发布成功且本地 hash 仍等于已发布 hash 时清 dirty；
  - UI「待同步」只读 dirty，不再读 `sync_state`。
- 该标记与 v3 的 base/local/remote 三方比对相互独立：dirty 只影响展示，不决定同步正确性。

## 4. 删除顺序（每步独立可回滚）

1. **purged 独立字段**：新增 `is_purged`/墓碑状态，替换 `sync_state='purged'` 判定，测试回收站副本/学习端不回填。
2. **UI dirty**：将待同步状态从 `sync_state` 迁到 dirty；删除 UI/类型层的 syncState 读取。
3. **桌面旧文档同步**：删除 legacy 分支、`core/syncEngine`、旧 adapter/等价测试；保留 v3 + 回滚窗口结束后。
4. **旧 quick-notes 通道**：删除 `quickNotesSync`、旧单条 push、旧 manifest/GC；去掉 legacy quick 回滚。
5. **移动旧同步**：删除 `syncProtocol=legacy` 分支、旧 syncDbPort/quick 端口/测试。
6. **删列/删字段**：一次性删除 `notes.sync_state`、`tree_nodes.sync_state`、`quick_notes.sync_state` 及相关索引/写入/夹具；不迁移旧值。
7. **清理 sync_base / lastUploadedHash 等旧账本**（若 v3 不再使用）。

## 5. 验收

- 全仓测试：每步删除后全绿；不得保留“为了旧数据”的兼容分支。
- 真实 S3：桌面/移动默认 v3 双端；删除/恢复/彻底删除零痕迹。
- 移动真实设备：同步、单条推送、小记、删除/恢复点击验收（未完成，删除前必须做）。
- 回滚窗口：至少一个版本；回滚路径删除后不再承诺。
