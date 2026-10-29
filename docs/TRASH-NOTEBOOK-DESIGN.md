# 隐藏回收站笔记本重构 — 设计定稿（TRASH-NOTEBOOK-DESIGN）

> 状态：**设计定稿，进入实施**（2026-08-15）。分支 `feat/trash-notebook`（自 `experiment/manifest-gzip` 切出，含删除链路 + gzip + 增量扫描）。
> 关联：`AGENTS.md`（原则）、`SYNC-PROTOCOL.md`（GC / 保留链 §13/§14）、`QUICK-NOTES-SPEC.md`（小记产品规格）。

## 1. 目标与统一模型

把"删除"从**特殊状态（墓碑）**重构为**普通树操作（移入隐藏回收站笔记本）**，统一同步逻辑。

**统一模型（Lake 与小记共用同一概念，产品开关不同）：**

> 删除 = 移入回收站（内容保留、可恢复）；**回收站是否上云 = 产品开关**（Lake 开 / 小记关）；purge = 移除 + 轻量墓碑（两者一致）。

- **Lake**：回收站笔记本**上云** → 删除 = `parentId` 移动，移动即跨端传播 → 软删**不需要墓碑**；只有 purge 留墓碑。
- **小记**：回收站**本地**（产品形态不变）→ 墓碑是跨端传播载体，**不可消除**；小记不结构性重构（现状已是"本地回收站 + 墓碑"，即开关=关的正确实现），只补共享层（gzip ✅、增量扫描）。

## 2. 已定稿决策（用户确认）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 回收站上云 | ✅ Lake 回收站 = 隐藏笔记本，条目全量同步（正文/资源/元数据） |
| D2 | purge 不广播 | ✅ purge 墓碑上云（`deleted:true`）；其他端**不删本地回收站副本**，标 `sync_state='purged'`（保留可恢复、不上传）；恢复 = 移出 + 清 purged → 上传覆盖墓碑（LWW：恢复 updatedAt > 墓碑 deletedAt 则墓碑让位） |
| D3 | 自动过期 | ✅ 默认 90 天，开放配置（复用 `trashAutoPurgeDays`，语义从"提醒"改为"真正自动过期"；main.ts 定时扫 trash 笔记本） |
| D4 | trash 笔记本 ID | 常量 `notebook-trash`，`node_type='notebook'`（**不改 CHECK 约束**），每端本地初始化，**不同步 folder**；侧栏/创建/拖拽按 ID 排除 |
| D5 | 恢复位置 | `deletedFromParentId` 上云（manifest 可选字段，仅 trash 条目带）；恢复 = 移回原父目录，原父缺失/已删 → fallback 根目录；`trashedAt` 上云（自动过期时间基准，仅 trash 条目带） |
| D6 | 小记 | 产品形态不变（回收站本地、不上云）；技术只做共享层统一（gzip 已做、增量扫描本轮做）；**不合并数据空间**（QUICK-NOTES-SPEC 明令） |

## 3. 数据模型

### 3.1 常量
```ts
const TRASH_NOTEBOOK_ID = "notebook-trash";   // 与 DEFAULT_NOTEBOOK_ID 同层
```

### 3.2 schema（开发版，直接 ALTER）
- `notes` 加列：`trashed_at TEXT`、`deleted_from_parent_id TEXT`
- `tree_nodes` 加列：`trashed_at TEXT`、`deleted_from_parent_id TEXT`
- `sync_state` 新增取值：`'purged'`（本地保留可恢复、不上传；仅 trash 条目）
- `deleted_notes` 表**保留**：仅作 purge 墓碑（id/title/parent_id/sort_order/updated_at/deleted_at/purged_at）
- `restore_pending_at`：**保留**（墓碑权威的显式例外——删除压编辑，只有显式恢复才允许赢；否则 B 的普通编辑会凭 LWW 复活删除）；`markSynced` 清除

### 3.3 状态
| 状态 | 含义 |
|---|---|
| 正常文档 | parentId=普通笔记本，`deleted_at IS NULL` |
| **回收站条目** | parentId=`notebook-trash`，`deleted_at IS NULL`，带 `trashed_at`+`deleted_from_parent_id`，普通条目全量同步 |
| **purged（本端抑制）** | 回收站条目 + `sync_state='purged'`：收到他端 purge 墓碑后保留可恢复但不上传 |
| **purge 墓碑** | `deleted_notes` 行（deleted_at + purged_at）；manifest 输出 `deleted:true`（软删不再有墓碑，故 `deleted:true` 即 purge） |

## 4. 行为定义

### 4.1 删除（Lake）
`deleteTreeNode(id)` → 改为**移动**：`tree_nodes.parent_id=notebook-trash` + `trashed_at=now` + `deleted_from_parent_id=原parent_id` + `sync_state='local'`（notes+tree_nodes），**不再写墓碑、不再递归软删子节点**（子节点随父移动）。文件夹同理。新建/拖拽禁止以 trash 为父。

### 4.2 恢复（Lake）
`restoreTrashItem(id)` → 移回 `deleted_from_parent_id`（原父缺失/已删 → 根），清 `trashed_at`/`deleted_from_parent_id`，`sync_state='local'`；**无 restore_pending_at**。文件夹恢复带动子节点。

### 4.3 purge（Lake）
`purgeTrashItem(id)` → 物理删子树（.lake/资源/历史/FTS/DB 行）+ 写 `deleted_notes` 墓碑（`deleted_at=now, purged_at=now`）；同步：manifest 移除条目 + 推 `deleted:true` 墓碑 + M4 `deletePrefix(objects/{id}-, assets/{id}/)` → `markPurgeSynced` 清 `purged_at`（墓碑保留）。

### 4.4 同步下载
- `rn.deleted`（=purge 墓碑）：
  - 本地有该笔记（任意位置）→ **不删**：`applyRemotePurge`（确保在 trash + `sync_state='purged'`），保留 .lake/资源 → 本地可恢复；**显式恢复例外**：`isRestorePending` 时跳过（本地恢复上传 active 覆盖墓碑）
  - 本地无 → `rememberDeleted`（学到的墓碑，防复活）
- **交叉分支（回收站 vs 普通位置）**：
  - 远端 trash + 本地 active（删除压编辑）：`isRestorePending` 例外 → 本地恢复胜；否则本地编辑先 `createHistorySnapshot` 留档 + `applyRemoteMoveToTrash`（标 local，随后正常对账内容），推 superseded
  - 远端 active + 本地 trash（恢复传播）：`rn.updatedAt > local.trashedAt` → `applyRemoteRestore` 移回；否则本地删除较新保持 trash（上传阶段 `trash-yield` 让位逻辑兜底）
- `rn.parentId=trash`（远端回收站条目）→ 普通下载/对账（**情况 3 解决**：从未持有设备也能拉到全文+资源进回收站）；`trashed_at`/`deleted_from_parent_id` 随 `applyRemoteNoteMeta` 同步
- 远端恢复（条目 parentId 变回普通）→ 本地 trash 条目随交叉分支移出，清 trashed 字段

### 4.5 同步上传
- `listNotesForSync` 含 trash 条目（`deleted_at IS NULL`）；`sync_state='purged'` 条目**跳过**（不上传）
- trash 条目 manifest 输出：`parentId=notebook-trash` + `trashedAt` + `deletedFromParentId`
- **trash-yield**：本地 trash 条目 vs 远端 active 且更新 → 让位（跟随恢复）
- 墓碑上传：`listDeletedNotesForSync` → `deleted:true` + 删除前内容 PUT（保留）→ 墓碑 vs 远端恢复 LWW（tombstone-yield）不变

### 4.6 GC
- `collectManifestRefs`：trash 条目是 active 条目 → assets 自然进 keep；删掉 `runDeepCleanup` 的 `softDeletedIds` 前缀保护 hack
- purge 的 M4 前缀删除不变
- 回收站条目对象（正文/资源）在 purge 前永不进 GC 候选（manifest keep）

### 4.7 自动过期（90 天可配，261026 由 60 调整为 90）
- `trashAutoPurgeDays` 默认 60（现默认 0=提醒）；main.ts 并入维护队列：定期查 trash 笔记本 `trashed_at < now - N天` 的顶级条目 → 自动 `purgeTrashItem`
- 时间基准 `trashedAt` 上云 → 各端过期起点一致

### 4.8 UI
- `listTreeNodes`（侧栏）排除 `notebook-trash`
- TrashPanel 文档 tab 改读 trash 笔记本顶级子节点（文件夹整体显示/恢复/purge，子节点随动）
- 文案："回收站随云同步，其他设备的回收站也会同步到本端"；purged 条目显示"已被其他设备彻底删除（可恢复）"
- 5 秒撤销（小记）不变

## 5. 小记技术统一（本轮范围）

1. **不结构性重构**：删除/恢复/purge 代码不动（已是"本地回收站+墓碑"正确形态）
2. **增量扫描**：✅ 已做（quickNotesSync 上传循环 `sync_state='synced'` 跳过；非跳过路径保留"索引 hash 与内容不一致则抛错"完整性校验）
3. gzip：✅ 已做
4. 统一模型与唯一分叉点（回收站上云开关）记录于 §1

## 6. 测试计划

- 重写现有墓碑测试为移动语义（`sync.test.ts` ~14 个）
- 新增：情况 3（全新设备拉到回收站全文+资源并可恢复）、purge 不广播（B 保留副本标 purged、不上传、可恢复）、恢复位置跨端一致（deletedFromParentId）、自动过期 90 天、两端 purge 后云端对象清理、trash 笔记本不出现在侧栏/不可新建/不可拖入、trashed 文件夹整体恢复
- 回归：gzip（manifest 透明解压）、增量扫描（synced 0 读取）

## 7. 实施顺序

store（schema/删除/恢复/purge/purged）→ sync（下载/上传/墓碑 LWW/GC）→ UI → 小记增量扫描 → 测试重写与新增 → 全量验证（tsc + 205 测试基线 + build + A/B 多端）

---

## 8. A/B 真机验证结论（2026-08-15，真实七牛双端）

**32 个集成场景全过**（CDP 驱动真实 Electron A/B + 真实 S3）：

- 删除链路：回收站上云 / 情况3（从未持有设备拉到回收站全文）/ 恢复传播 / purge 不广播（B 标 purged 保留）/ purged 恢复复活
- 编辑器细节 × 同步：标题 / 移动 / 重命名组 / 图标 / 锁定 LWW / 冲突 superseded+留档 / 图片资源上传+GC pending / 历史引用保护
- 小记：创建 / 图片 / 删除传播 / 本地恢复传播 / 转正式笔记（含源删除传播）
- 大文档 1.37MB 同步 / 150 文档批量 / 反复编辑 / 120 快照+清理 / GC reconcile

**真机发现并修复的既有 bug（meta 同步一致性）**：
- `moveTreeNode`/`moveTreeNodeOrdered`/`reorderTreeNodes`/`setNodeIcon` 只改 `tree_nodes`、不同步 `notes` 表（同步源），导致移动/重排/图标跨端不同步、且被下载 meta 对账回滚。
- 修复：这些操作同步更新 `notes`（parent_id/sort_order/updated_at/sync_state）；下载"正文未变"分支在本地 `sync_state='local'`（有 pending 元数据改动）时跳过 `applyRemoteNoteMeta`，本地优先、上传回写。
- 回归测试：`moveTreeNode 同步更新 notes 表`、`setNodeIcon 标记 notes 为 local`。

**环境坑（本机必须）**：Chromium GPU Helper 进程空转（99% CPU，`fontations_ffi`）会导致渲染进程冻结 → 主进程 `webContents.send` mojo 背压 → 同步卡死。`--disable-gpu` 单独不够，必须
`--disable-gpu --disable-gpu-compositing --disable-software-rasterizer --disable-gpu-sandbox`（已写入 multidev.sh）。
