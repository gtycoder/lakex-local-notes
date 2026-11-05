# 标签子系统（现状契约，261025 起；261105 修订 / 261105 二次修订：删除=缺席）

> 本文记录**当前实现**（不是提案）。历史提案（独立 tags pointer、文档标签同步、置顶）未落地或已撤销；待办见 HANDOFF §3。

## 1. 数据模型（两端共用 `src/core/quickNoteTags.ts`）

```
tags(id PK, name, sort_order, created_at, updated_at)   -- 无删除标记：删除 = 行不存在（deleted_at 列仅为旧库残留，代码不读不写）
tag_links(target_kind, target_id, tag_id, position)  PK(kind,target,tag)
tag_link_versions(target_kind, target_id, links_updated_at)  PK(kind,target)
```

> **删除 = 缺席（261105 用户定稿）**：删除标签是**物理删除**目录行 + 清 `tag_links`/`tag_link_versions`（桌面还清
> `target_kind=note` 的文档标签关联）。**云端 `tags[]` 只出现 active 标签**——不允许墓碑进 S3 列表
> （「S3 列表表不得出现永久存在的条目」）。冲突按**删除压编辑**（与文档 purge 同口径）。
> 旧库若残留 `deleted_at` 行，启动时一次性迁移：先把 id 写进本机待删，再物理删行，然后置 `device_state.tag_absent_migrated=1`。

- **正文不存标签名**；目录与关联是唯一事实，搜索索引里的标签名只是派生缓存（可重建）。
- 标签 ID = `t_` + sha256(归一化名称) 前 16 hex；名称 NFC/trim/空白压缩，≤32 字符；每条 ≤20 个标签；同名 active 唯一（应用层校验）。
- 小记用 `target_kind="quickNote"`；文档用 `target_kind="note"`（关系在主库；**目录只在小记标签库**，文档只同步关系 `tagIds/tagsUpdatedAt`，261105 P1 已实现）。
- 桌面小记标签库在 `quick-notes/metadata.sqlite3`；移动端在主库；**顺序字段只是本机视图**。

## 2. 顺序（261105 用户定稿：设备本地，不参与同步）

- **目录默认顺序**（从未手动排序）：新建在前（`created_at DESC`）→ 名称（zh-CN）。
- **手动拖拽后**：本机 `device_state.quick_tags_manual_order=1`，目录按本机 `sort_order` 展示；之后新增标签追加末尾；重排**不 bump `updated_at`**（不触发同步）。
- **单条小记上的标签顺序**：`tag_links.position` 本机视图；本地新加插入最前；同步 wire 上 `tagIds` 是**排序后的集合**，对端应用时保留本机顺序、远端新增插最前。
- **置顶已删除**（不要恢复）：模型/wire/端口/UI/DB 读写均无 `pinned`；旧库多余列不迁移、代码不读写。

## 3. 同步（v3 quick-notes 索引，无独立标签空间）

- 目录随 quick-notes 索引的可选 `tags[]` 发布（**只含 active**：id/name/createdAt/updatedAt；旧索引残留的 `pinned/sortOrder/deletedAt` 一律不进发布，读取时按字段白名单丢弃 ⇒ 墓碑条目等价于缺席）。
- 每条小记关系随条目 `tagIds`（排序集合）+ `tagsUpdatedAt`（LWW）传播；正文 hash 不变也传播。
- **目录合并（三方判定）**：① 基线有 / 远端缺席 ⇒ **他端已删除**（删除压编辑）⇒ 删本地；② 本机待删（`device_state.tag_deleted`，离线删过、还没确认远端缺席）⇒ 一律按已删处理，远端重发也不复活；③ 其余按 ID + `updatedAt` LWW；同一 `updatedAt` 用确定性 tie-break（name/createdAt），保证两端选出同一赢家。
- **本机顺序不被合并覆盖**：目录合并只写名称/时间；远端新标签在手动排序下追加末尾，未手动排序时按 createdAt 进默认序列。
- **待删结算**：远端索引已不含该 id ⇒ 解除抑制（`quickTagSettled`），之后同名标签可重建。**待删集合只在本机**（不上传、不进 v3 状态信封）。
- 索引侧硬上限 `S3V3_MAX_TAGS = 5000`（校验层拒绝超限目录）。

## 4. 搜索

- `quick_notes_search_index.tags` + FTS `tags` 列是派生缓存；改名/删除/合并只重刷**关联到受影响标签的小记**（不全量重建；全量只留给启动/迁移）。

## 5. 实现位置

- 纯逻辑：`src/core/quickNoteTags.ts`（归一化/ID/LWW/确定性 tie-break/筛选/本机拖拽换算）。
- 桌面：`electron/quickNoteTagsStore.ts`、`quickNoteTagLinksStore.ts`、`quickNoteTagService.ts`、`documentTags.ts`（文档标签预留）；UI `QuickNoteTagManager`（拖拽排序）。
- 移动：`src/mobile/data/quickNoteTagsRepository.ts`、`quickNoteTagLinksRepository.ts`、`quickNoteTagService.ts`；UI `MobileQuickNoteTagManager`（管理入口 + 长按拖拽）。
- 同步端口：`electron/s3v3/desktopPlatformPort.ts`、`src/mobile/v3/mobilePlatformPort.ts`；计划/引擎 `src/core/s3v3/**`。

## 6. 未做 / 待立项

- **文档标签（261105 P1 已实现）**：关系随 lake 索引 `tagIds`（排序集合）+ `tagsUpdatedAt`（版本 LWW）同步；目录只在小记标签库；删除/改名跨库协调 + 启动清孤儿；发布时**有版本必须显式写 `tagIds`**（空集合也写 `[]`）。UI = 桌面标签空间（只读聚合 + 就地元数据管理）+ 属性面板编辑 + 侧栏筛选；移动端只读展示 + 筛选。
- 小记→文档转换**继承标签**（261105 P1 已实现）。
- 不做：置顶、跨端顺序一致、标签颜色/层级（用户 261105 定稿）。
