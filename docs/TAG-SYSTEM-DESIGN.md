# 标签子系统设计（独立管理 + 关联表，261025）

> 现状：标签只服务小记；桌面临时表 `quick_note_tags` + `quick_note_tag_links`，移动端同名表；v3 小记索引里内联 `tags` 目录与 `tagIds/tagsUpdatedAt`。
> 目标：标签成为独立管理实体，文档/小记都用同一套标签 + 关联表；不把标签名冗余进正文；v3 独立同步；为「文档打标签」预留通用关联。

## 1. 数据模型（单一来源）
```ts
interface Tag {
  id: string; name: string; color?: string | null;
  order: number; pinned: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string | null; // 墓碑
}
type TagTargetKind = "note" | "quickNote";
interface TagLink {
  targetKind: TagTargetKind; targetId: string; tagId: string; position: number;
  /** 关系集合的 LWW 版本（与目标本身 updatedAt 解耦）。 */
  linksUpdatedAt: string;
}
```
- **只有两张表**：`tags`（目录，含墓碑）与 `tag_links`（多态关联）；不在 `notes/quick_notes` 正文或索引里存标签名。
- 搜索索引里的标签词只是**派生缓存**，可重建，不作为真相。

## 2. 本地存储（桌面/移动同构）
```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX tags_name_live ON tags(name) WHERE deleted_at IS NULL;
CREATE TABLE tag_links (
  target_kind TEXT NOT NULL, target_id TEXT NOT NULL, tag_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0, links_updated_at TEXT NOT NULL,
  PRIMARY KEY(target_kind, target_id, tag_id)
);
CREATE INDEX tag_links_target ON tag_links(target_kind, target_id);
CREATE INDEX tag_links_tag ON tag_links(tag_id);
```
- 迁移：现有 `quick_note_tags` → `tags`；`quick_note_tag_links` → `tag_links(target_kind="quickNote")`；删除旧表（无真实数据，可直接重建）。
- 文档标签：`target_kind="note"`，与 Lake 文档 id 关联；UI 后续接。

## 3. 合并语义（纯逻辑，可单测）
- **目录**：按 `updatedAt` LWW；墓碑优先（墓碑 updatedAt 较新 ⇒ 删除；较旧 ⇒ 忽略）；同名活跃标签冲突 → 保留较新、旧名写入历史/告警（不静默覆盖）；新增按 id 插入，排序 `order,id`。
- **关联**：每条目标有 `linksUpdatedAt`；较新的整体集合胜出（不做逐 tag 合并，避免“删除后复活”）。应用关联前先剔除墓碑 tag；墓碑不清正文。
- **删除标签**：目录写墓碑 + 删除该 tag 的所有关联；不删目标内容。
- **合并标签**：源 tag 关联改指目标（`tag_links` 改 tag_id，冲突则删源行），源写墓碑。

## 4. v3 同步（独立空间，不再内联小记索引）
- pointer 增加独立 `tags: { commit }`；key：`meta/tags/index/<hash>.json`。
- tags index 内容 = `{ v, tags: Tag[], links: TagLink[] }`（全量不可变快照）。
- 发布顺序：先写 tags index，再写 pointer；pointer 读回校验 tags commit（与 lake/quickNotes 同规则）。
- 删除/GC：旧 tags index 进入待删；墓碑标签保留在 index（供其他端收敛），深度清理阈值后移除。
- 合并：目录走 LWW；关联按 `linksUpdatedAt` 整体胜出；冲突（两端改同一目标关联）→ 后提交者胜，输家本地保留历史/告警（与现有文档冲突策略一致）。
- 小记索引中删除 `tags` 与 `tagIds/tagsUpdatedAt`（改为读 tags index）；这是协议破坏性变更，按用户要求直接做最优，不写兼容。

## 5. 实施顺序
1. 本地：新表 + 仓库/协调层（目录、关联、删除、合并、目标查询）——桌面/移动各一套，同语义。
2. UI：标签管理页（重命名/删除/合并/排序/置顶）+ 文档/小记标签编辑器。
3. v3：pointer.tags + tags index + merge/gc/engine + 桌面/移动适配器；去掉小记索引内联标签。
4. 测试：合并/墓碑/关联 LWW/删除/merge 的纯逻辑单测；双端假 S3 + 真实 S3；6 端并发标签写；容量（10 万标签/关联）。

## 6. 与当前已修 bug 的关系
- 当前失败用例「远端标签目录合并」根因是**测试时间戳早于本端创建时间**（LWW 正确拒绝）；已改为未来时间并通过。
- 新设计仍用 LWW，但把「目录」和「关联」拆成独立版本（linksUpdatedAt），避免正文/标签互相拖累。
