# 文档历史（快照）设计 — 完整实现规格

> 状态：**定稿，待实现**（下一会话按此实现）。
> 目标：为 Lake Notes 增加"文档历史版本"能力（查看/恢复/清理），纯本地、不参与同步，资源按"实时解析引用"管理。
> 关联：依赖已完成的软删除+回收站（`f51379b`），历史功能要接 `purgeTrashItem`/孤儿机制。

---

## 1. 背景与目标

- 现状：`saveNote` 覆盖写 `.lake`，无版本；误改/误删无法找回。
- 目标：用户可查看某文档的历史版本（时间/大小/预览），可恢复旧版本；纯本地，不参与同步。
- 约束（实测）：
  - 自动保存 **800ms 防抖**（`src/App.tsx` `saveTimers`）——很频繁，不能每次快照。
  - 资源 274 文件共 **170MB**（单文档最大 56MB）——不能复制资源进历史。
  - `.lake` 正文 gzip 后 ~20-30%（736KB → 150KB）——正文快照成本可控。

## 2. 决策记录（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 快照触发 | **定期 15 分钟**（只快照 15 分钟内真正保存过的文档）+ 删除/冲突前 + 手动 |
| 快照内容 | **正文 .lake 全量 + gzip**（不做结构化增量，lake 是扁平 HTML） |
| 资源处理 | **不复制资源**；引用判定**实时解析**（不建账本表） |
| 保留策略 | **15 天 + 每文档 50 份**（双上限，先到先清） |
| 自动清理资源 | **历史未引用即物理删**（方案 A，用户确认） |
| 同步 | 历史**纯本地**，不参与同步；恢复后走正常同步上传 |
| 搜索 | 历史**不可搜索**，仅按文档查看 |
| 手动清理 | 历史界面提供"清理历史备份"入口 |
| 孤儿文件 tab | 文档右键历史面板内，**随历史删除动态重算**（顺序问题，见 §5） |

## 3. 存储设计

### 3.1 目录结构

```text
{workspace}/history/
├── {noteId}/
│   ├── {timestamp}-{contentHash}.lake.gz    # 快照正文（gzip）
│   └── ...（多份快照）
└── {noteId2}/...
```

- `timestamp` = `YYYYMMDD-HHmmss`（ISO 转，用于排序/保留判断）。
- `contentHash` = 快照正文 SHA-256（去重：同内容不重复存）。

### 3.2 SQLite 表

```sql
-- 历史快照元数据
CREATE TABLE IF NOT EXISTS note_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,          -- 文档 id
  file_path TEXT NOT NULL,        -- history/{noteId}/{ts}-{hash}.lake.gz 相对路径
  content_hash TEXT NOT NULL,     -- 快照正文 hash（去重用）
  created_at TEXT NOT NULL,       -- ISO 时间
  size INTEGER NOT NULL,          -- gzip 后字节
  UNIQUE(note_id, content_hash)   -- 同内容去重
);
CREATE INDEX idx_note_history_note ON note_history(note_id, created_at DESC);
```

**注意：不建 `history_asset_refs` 账本表**（避免 50 快照 × N 图笛卡尔积膨胀，极端 1000 文档可达 88MB）。

## 4. 资源引用判定（按需解析，不建账本）

**核心**：资源是否被历史引用，在需要时**实时解析历史快照正文**（复用 `referencedFilenames` 同款正则）。

```ts
// 复用 store.ts 的 referencedFilenames 正则（私有，需提取为公共工具）
const ASSET_NAME_RE = /\d{13}_[0-9a-f]{8}\.(?:png|jpg|jpeg|gif|webp|avif)/g;
function extractAssetRefs(content: string): Set<string> {
  return new Set([...content.matchAll(ASSET_NAME_RE)].map((m) => m[0]));
}
```

- **性能实测**：解析一篇 ~2.2ms；一个文档 50 份快照全解析 ≈ 100ms（低频操作可接受）。

### 引用判定场景

| 场景 | 判定方式 |
|---|---|
| 手动清理孤儿（孤儿 tab） | 解析"剩余历史快照 + 当前正文"引用集；被引用的跳过不删 |
| 自动清理（50份/15天） | 删旧快照后，解析"剩余历史快照 + 当前正文"；无引用资源**立即物理删**（方案 A） |
| 彻底删除文档（purgeTrashItem） | 删文档前解析该文档全部历史；被历史引用的资源保留，其余删 |
| 同步 | 历史纯本地，不参与同步；被历史引用但当前不引用的资源仍在孤儿集合 → 不同步上传 |

## 5. 孤儿文件 tab 的"先后顺序"（用户强调的核心）

**时序设计（避免漏删）：**

1. 右键文档 → 打开历史面板，**默认先展示"历史快照" tab**（不是孤儿 tab）。
2. 用户在该 tab **删除历史快照**（手动清理）。
3. **每次删除快照后，立即重新计算**该文档的孤儿列表（解析"剩余历史 + 当前正文"引用集）。
4. 被删快照解除引用的资源，**此刻才进入孤儿列表**（孤儿 tab 展示的是**最新实时派生**结果）。
5. 用户切到孤儿 tab，看到的是**删除历史之后的最新孤儿**，可单个/全部清理。

**实现要点**：
- 孤儿列表**不能静态缓存**，每次打开面板/删除历史后 `refresh()`。
- 历史面板组件内，删除快照回调 → 先删历史（IPC）→ 再刷新孤儿列表（IPC）。
- 孤儿列表的数据来源：`store.listNoteOrphans(noteId)`（实时计算，见 §7）。

## 6. 快照时机（三档）

1. **定期 15 分钟**：主进程定时器。`saveNote` 时把 noteId 加入"dirty 集合"（内存 Set）；定时器只快照 dirty 集合中文档，快照后清空。同一周期多次保存只留最新一份。
2. **关键操作前**：删除文档/目录前（`deleteTreeNode`）、同步冲突合并前、恢复回收站前。
3. **手动**：历史界面"创建快照"按钮。

## 7. Store API（待实现）

```ts
// 快照
createHistorySnapshot(noteId: string, content?: string): void
  // 读取当前 notes/{noteId}.lake 正文（或传入 content），gzip 存 history/{noteId}/{ts}-{hash}.lake.gz，
  // 写 note_history 表（hash 去重：已存在同 hash 则跳过）。

// 查询
listNoteHistory(noteId: string): Array<{ id, createdAt, size, contentHash, filePath }>
  // 按 created_at 倒序。

// 恢复
restoreHistory(historyId: number): void
  // 1) 恢复前：先 createHistorySnapshot(当前正文)（可反悔）
  // 2) 解压 gzip → 原子写回 notes/{noteId}.lake
  // 3) 更新 md_cache/text_cache（走 ensureNoteCaches）+ FTS
  // 4) sync_state='local'（下次同步上传恢复版本）

// 清理（手动，单快照）
deleteHistory(historyId: number): void
  // 删文件 + DB 记录；调用方随后刷新孤儿列表（顺序见 §5）

// 清理（自动，保留策略）
cleanupHistory(): void
  // 1) 删 created_at < now-15d 的快照
  // 2) 每文档超 50 份删最旧
  // 3) 删快照后：对受影响文档，解析"剩余历史+当前正文"引用集，
  //    无引用资源立即物理删（方案 A）

// 孤儿（文档级，实时）
listNoteOrphans(noteId: string): Array<{ filename, size, mimeType, protectedByHistory: boolean }>
  // 扫描 note-assets/{noteId}/ 目录，减去"当前正文引用 + 所有历史快照引用"= 孤儿
  // protectedByHistory=true 表示被历史引用（手动清理时跳过）

cleanNoteOrphans(noteId: string, filenames?: string[]): { count, freedBytes }
  // 只删"非 protectedByHistory"的文件；传 filenames 则只清指定，否则清全部可清
```

## 8. IPC / preload / native

- IPC channels：`create_history_snapshot` / `list_note_history` / `restore_history` / `delete_history` / `cleanup_history` / `list_note_orphans` / `clean_note_orphans`
- `electron/preload.cjs`：加对应 `lakeNative` 方法
- `src/lib/native.ts`：加类型 + 封装

## 9. UI（历史面板，两个 tab）

- 入口：文档右键菜单 → "历史版本"（在 `src/components/Sidebar.tsx` ContextMenu 加项）
- 组件：`src/components/HistoryPanel.tsx`（仿 `TrashPanel.tsx` 毛玻璃弹层）
  - **Tab 1 文档历史**：快照列表（时间/大小）、点击预览（Viewer 渲染 .lake 或解压后文本）、"恢复此版本"、"创建快照"、"删除此快照"
  - **Tab 2 文档孤儿文件**：孤儿列表（文件名/大小/是否被历史保护）、单个清理/全部清理
  - **顺序**：默认 Tab 1；删快照后刷新孤儿（§5）
- 设置：**全部清理历史**入口放设置面板（`SettingsPanel.tsx`）
- 样式：复用 `.trash-panel` 毛玻璃族（可加 `.history-panel` 变体）

## 10. 与现有机制的关系

- **回收站**：`purgeTrashItem` 彻底删除时，被历史引用的资源保留（解析历史引用）。
- **孤儿机制**：`detectOrphans` 仍按"当前正文引用"判定孤儿；历史保护在**清理动作**时实时判定（不污染孤儿表）。
- **同步**：历史目录不进 manifest；恢复后 sync_state='local' 上传。
- **锁定缓存**：恢复走 `ensureNoteCaches` 兜底。

## 11. 风险与权衡

- **磁盘**：正文 gzip 20-30%，15 天 × 50 份上限，实际几 MB/文档。
- **资源**：不复制 → 回滚依赖"当前资源仍在"。用户**手动删** note-assets（绕过应用）→ 回滚裂图（接受，应用内不会删被历史引用的）。
- **正则**：`referencedFilenames` 依赖文件名模式 `\d{13}_[0-9a-f]{8}\.{ext}`，若未来 lake 资源命名变化需同步更新。
- **自动清理立即物理删**：方案 A——历史未引用即删。风险：若用户误删历史快照，资源立即消失（但剩余历史引用的不删）。接受（语义明确）。

## 12. 测试要点

- 单测（`electron/store.test.ts`）：
  - 快照创建 + hash 去重（同内容不重复）
  - 保留策略：15 天 / 50 份上限裁剪
  - 恢复：写回 .lake + 缓存/FTS 更新 + sync_state='local'
  - 引用判定：孤儿列表含/不含被历史引用的资源
  - 自动清理：删快照后无引用资源物理删
  - 删除历史后孤儿刷新（顺序）
- CDP 端到端：
  - 创建文档 → 改内容 → 手动快照 → 历史列表出现
  - 删除历史 → 孤儿 tab 出现被解除引用的资源
  - 恢复历史 → 正文回滚 + 可搜索
  - 彻底删除文档 → 被历史引用资源保留

## 13. 实现顺序建议

1. `note_history` 表 + 迁移（`store.ts` migrate）
2. `extractAssetRefs` 提取为公共工具（`referencedFilenames` 复用）
3. `createHistorySnapshot` / `listNoteHistory`（含 gzip、hash 去重）
4. `restoreHistory` / `deleteHistory`
5. `cleanupHistory`（保留策略 + 资源自动物理删）
6. `listNoteOrphans` / `cleanNoteOrphans`（实时解析）
7. `purgeTrashItem` 接历史保护
8. IPC / preload / native
9. `HistoryPanel.tsx` UI（两 tab）+ Sidebar 右键入口 + Settings 全部清理
10. 单测 + CDP 验证
