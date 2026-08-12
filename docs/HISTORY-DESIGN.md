# 文档历史（快照）设计 — 完整实现规格

> 状态：**定稿 v2，待实现**（本会话已与用户充分讨论，下个会话按此实现）。
> 目标：为 Lake Notes 增加"文档历史版本"能力（查看/恢复/清理），纯本地、不参与同步，资源按"refs 引用清单"管理。
> 关联：依赖已完成的软删除+回收站（`f51379b`），历史功能要接 `purgeTrashItem`/孤儿机制。

---

## 1. 背景与目标

- 现状：`saveNote` 覆盖写 `.lake`，无版本；误改/误删无法找回。
- 目标：用户可查看某文档的历史版本（时间/大小/预览），可恢复旧版本；纯本地，不参与同步。
- 约束（实测）：
  - 自动保存 **800ms 防抖**（`src/App.tsx` `scheduleSave`）——保存很频繁，但**快照独立于保存**。
  - 资源 274 文件共 **170MB**（单文档最大 56MB）——**不复制资源进历史**。
  - `.lake` 正文 gzip 后 ~20-30%（646KB → 147KB）——正文快照成本可控。
  - 引用解析性能：**解压+解析 ~1.34ms/篇**（gzip 用 Node 原生 `zlib`，无解压性能风险）。
  - 全量扫描性能：**1000 文档 × 50 快照 ≈ 62ms；极端 10000 文档 × 50 快照 ≈ 0.56s**（纯内存解析）。

## 2. 决策记录（已与用户确认，本会话反复讨论）

| 决策点 | 结论 |
|---|---|
| 快照触发 | **定期 15 分钟**（只快照"15 分钟内保存过"的文档）+ 删除/冲突前 + 手动 |
| 快照内容 | **正文 .lake 全量 + gzip**（不做结构化增量，lake 是扁平 HTML） |
| 资源处理 | **不复制资源实体**；每快照记录**资源引用清单 refs_json**（不是复制图片） |
| 保留策略 | **100 份/文档 为主 + 30 天兜底**（主约束 100 份 ≈ 12.5 天窗口；低频文档/早锁定文档才到 30 天兜底） |
| 清理时机 | **惰性**：创建新快照后检查超限即删最旧；启动时补一次兜底 |
| 自动清理资源 | **历史未引用即物理删**（方案 A，用户确认） |
| 恢复同步语义 | **用 `last_uploaded_hash` 判断远端是否本机传的**：本机传的→本地恢复版覆盖；他人改的→接受远端、本地入历史（P0-1，用户确认） |
| 回收站彻底删除 | **软删除保留历史**（恢复后历史还在）；**彻底删除连历史快照+历史引用资源一起物理删**（用户确认） |
| 同步 | 历史**纯本地**，不参与同步；恢复后走正常同步上传 |
| 搜索 | 历史**不可搜索**，仅按文档查看 |
| 手动清理 | 历史界面"清理历史备份"入口；全部清理放设置 |
| 孤儿文件 tab | 文档右键历史面板内，**随历史删除动态重算**（顺序问题，见 §5） |
| 快照时机边界 | **打开未编辑/只读打开关闭/锁切换重建 均不产生快照**（见 §6） |

### 2.1 保留策略的推导（100 份 + 30 天）

- 用户场景：单文档**每天高频编辑约 2 小时**，15 分钟/次 → **约 8 份/天**；但**也可能编辑几次就锁定**（低频），此时 30 天兜底生效。
- **100 份 ≈ 12.5 天窗口**（高频文档），磁盘 ~5.7MB/文档（100 × 57KB 平均）。
- **30 天兜底**：低频文档/早锁定文档才触发（防陈旧快照）。
- **份数为主约束**：直接控制磁盘有界；时间只做兜底。

## 3. 存储设计

### 3.1 目录结构

```text
{workspace}/history/
├── {noteId}/
│   ├── {timestamp}-{contentHash}.lake.gz    # 快照正文（gzip）
│   └── ...（多份快照）
└── {noteId2}/...
```

- `timestamp` = `YYYYMMDD-HHmmss`（排序/保留判断）。
- `contentHash` = 快照正文 SHA-256（去重：同内容不重复存）。

### 3.2 SQLite 表（`note_history`）

```sql
CREATE TABLE IF NOT EXISTS note_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  file_path TEXT NOT NULL,          -- history/{noteId}/{ts}-{hash}.lake.gz
  content_hash TEXT NOT NULL,       -- 快照正文 hash（去重）
  created_at TEXT NOT NULL,         -- ISO 时间
  size INTEGER NOT NULL,            -- gzip 后字节
  refs_json TEXT NOT NULL,          -- 该快照引用的资源文件名 JSON 数组（见 §4）
  ref_count INTEGER NOT NULL,       -- refs_json 长度（引用数，轻量索引/预估，不参与判定）
  -- 注意：不设 UNIQUE(note_id, content_hash)——恢复/回退场景同内容会再次出现，
  -- UNIQUE 会让"恢复前留档"被静默跳过（P0-2，评审确认）。
  -- 去重改为：同 hash 且 24h 内已有则跳过（防 15 分钟周期内连续写盘刷屏）；
  -- 恢复动作强制写快照（即使同 hash，用 created_at 区分）。
  UNIQUE(note_id, created_at)
);
CREATE INDEX idx_note_history_note ON note_history(note_id, created_at DESC);
```

**不建 `history_resource_count` 计数表**（讨论后确认不需要）：
- 删快照/清理孤儿是**低频**操作（用户偶尔点），50 份 refs 合并去重几十 ms，性能足够。
- 计数表引入"计数漂移"风险 + 维护复杂度，收益低。
- `ref_count` 列只是**每快照自己的引用数**（轻量元数据，供未来统计/排序，不参与判定）。

**不建全局账本表**（避免 50 快照 × N 图笛卡尔积膨胀）。

### 3.3 refs_json 内容

```json
["1786123456789_abc12345.png", "1786123456789_def67890.jpg"]
```

- 来源：快照正文用 `referencedFilenames` 同款正则提取（见 §4）。
- 实测大小：单快照 2B~3KB（100 图约 7KB），DB 列完全放得下。

## 4. 资源引用判定（refs_json 按快照记录）

**核心**：每个快照创建时，把"它引用的资源文件名"解析出来存进 `refs_json`。删除快照/清理孤儿时，**只读剩余快照的 refs_json 合并去重**即可判定。

```ts
// 复用 store.ts referencedFilenames 同款正则（私有，需提取为公共工具）
const ASSET_NAME_RE = /\d{13}_[0-9a-f]{8}\.(?:png|jpg|jpeg|gif|webp|avif)/g;
function extractAssetRefs(content: string): Set<string> {
  return new Set([...content.matchAll(ASSET_NAME_RE)].map((m) => m[0]));
}
```

### 判定场景

| 场景 | 判定方式 |
|---|---|
| 创建快照 | 解析正文 → refs_json 存该快照引用清单 + ref_count |
| 删单个快照 | 读**剩余**快照 refs_json 合并 → + 当前正文引用 → 差集 = 孤儿 |
| 删全部历史 | 历史引用集 = 空 → 仅当前正文引用 → 差集 = 孤儿 |
| 自动清理（200份/45天） | 删旧快照后，对受影响文档重算（同上）→ 无引用资源立即物理删（方案 A） |
| 彻底删除文档（purgeTrashItem） | **连历史一起物理删**：删 `history/{noteId}/` + `note_history` 记录 + 该文档所有资源（用户确认"彻底删除要彻底"） |
| 同步 | 历史纯本地，不参与同步；被历史引用但当前不引用的资源仍在孤儿集合 → 不同步上传 |

### 性能实测

- 创建快照：压缩 ~3.2ms/篇 + 解析 ~1.3ms/篇。
- 删快照/清理：读剩余 refs 合并（50 份 × KB 级）→ 几十 ms。
- 全量清理（1000 文档 × 50 快照）：**62ms**；极端 10000 文档 × 50 快照：**0.56s**（纯内存，可接受）。

## 5. 孤儿文件 tab 的"先后顺序"（用户强调的核心）

**时序设计（避免漏删）：**

1. 右键文档 → 打开历史面板，**默认先展示"历史快照" tab**（不是孤儿 tab）。
2. 用户在该 tab **删除历史快照**（手动清理）。
3. **每次删除快照后，立即重新计算**该文档的孤儿列表（读**剩余**快照 refs + 当前正文引用集）。
4. 被删快照解除引用的资源，**此刻才进入孤儿列表**（孤儿 tab 展示的是**最新实时派生**结果）。
5. 用户切到孤儿 tab，看到的是**删除历史之后的最新孤儿**，可单个/全部清理。

**实现要点**：
- 孤儿列表**不能静态缓存**，每次打开面板/删除历史后 `refresh()`。
- 历史面板组件内，删除快照回调 → 先删历史（IPC）→ 再刷新孤儿列表（IPC）。
- 孤儿列表数据来源：`store.listNoteOrphans(noteId)`（实时计算，见 §7）。

## 6. 快照时机（三档 + 边界）

### 触发时机

1. **定期 15 分钟**：主进程定时器。`saveNote` 成功时把 noteId 加入"15 分钟 dirty 集合"（内存 Set）；定时器只快照集合中文档，快照后清空。同一周期多次保存只留最新一份。
2. **关键操作前**：删除文档/目录前（`deleteTreeNode`）、同步冲突合并前、恢复回收站前。
3. **手动**：历史界面"创建快照"按钮。

### 快照边界（本会话重点确认，实现必须遵守）

**dirty 判定 = "15 分钟内该文档磁盘 .lake 是否变化"（saveNote 落盘），与锁状态解耦：**

| 场景 | 是否快照 | 原因 |
|---|---|---|
| 打开未编辑，点保存 | **不会** | 无 contentchange → 不保存；且保存本就不触发快照 |
| 打开未编辑，15 分钟到 | **不会** | 不在 dirty 集合（无编辑） |
| **编辑后锁定，15 分钟到** | **会** | 磁盘 15 分钟内变了，快照记录锁定前最终版（用户仍可找回） |
| 只读文件打开/关闭（未编辑） | **不会** | 磁盘没变 |
| 纯只读文件（从未编辑） | **不会** | 磁盘没变 |
| 锁切换（编辑↔只读重建） | **不会** | 重建期 contentchange 被 `setting` 标志屏蔽（`EditorTab.tsx:276-310`），不标 dirty |
| 删除/冲突/手动 | **会** | 关键操作前/手动 |

**实现要点**：
- **快照候选 = saveNote 落盘的 noteId 集合**（不是 UI tab 的 dirty 标志）。`saveNote` 成功时把 noteId 记入 dirty 集合。
- **不要**因锁状态跳过快照：编辑过即使锁定也要快照（锁定前最终版值得留档）。
- 锁切换重建（`EditorTab` effect 依赖 `locked`）期间 contentchange 被 `setting` 屏蔽 → 不会误标 dirty → 不会误进候选。

## 7. Store API（待实现）

```ts
// 快照
createHistorySnapshot(noteId: string, content?: string): void
  // 读 notes/{noteId}.lake（或传入 content）→ 提取 refs → gzip 存 history/{noteId}/{ts}-{hash}.lake.gz
  // 写 note_history（hash 去重：同 hash 跳过）→ 记录 refs_json + ref_count
  // 写后：惰性清理（cleanupHistory 检查该文档超限）

// 查询
listNoteHistory(noteId: string): Array<{ id, createdAt, size, contentHash, refCount, filePath }>
  // 按 created_at 倒序。

// 恢复
restoreHistory(historyId: number): void
  // 1) 恢复前：先 createHistorySnapshot(当前正文)（可反悔，强制写即使同 hash）
  // 2) 解压 gzip → 原子写回 notes/{noteId}.lake
  // 3) 更新 md_cache/text_cache（走 ensureNoteCaches）+ FTS
  // 4) 重新计算写盘正文 hash → setBaseHash(id, 新hash) + markSynced(id)
  //    （恢复 = 本地与远端重新对齐到恢复版，不是"本地新修改"——P0-1）
  // 5) sync_state='synced'（下次同步按 last_uploaded_hash 判定：远端是否本机传的）

// 清理（手动，单快照）
deleteHistory(historyId: number): void
  // 删文件 + DB 记录；调用方随后刷新孤儿列表（顺序见 §5）

// 同步基线增强（P0-1）：恢复后判定"远端是否本机传的"
setLastUploadedHash(id: string, hash: string): void   // sync.ts 上传成功后调用
lastUploadedHash(id: string): string | null           // 读 last_uploaded_hash

// 清理（惰性，保留策略）
cleanupHistory(): void
  // 1) 每文档超 100 份 → 删最旧
  // 2) created_at < now-30d → 删
  // 3) 删快照后：对受影响文档，解析"剩余历史 refs + 当前正文"，
  //    无引用资源立即物理删（方案 A）
  // 触发：创建快照后（惰性）+ 应用启动时兜底

// 孤儿（文档级，实时）
listNoteOrphans(noteId: string): Array<{ filename, size, mimeType, protectedByHistory: boolean }>
  // 扫 note-assets/{noteId}/ − (当前正文引用 ∪ 所有历史快照 refs) = 孤儿
  // protectedByHistory=true 表示被历史引用（手动清理时跳过）

cleanNoteOrphans(noteId: string, filenames?: string[]): { count, freedBytes }
  // 只删非 protectedByHistory 的文件；传 filenames 则只清指定，否则清全部可清
```

## 8. IPC / preload / native

- IPC channels：`create_history_snapshot` / `list_note_history` / `restore_history` / `delete_history` / `cleanup_history` / `list_note_orphans` / `clean_note_orphans`
- **三处同步**（重要坑）：`electron/main.ts`（handle）+ `electron/preload.cjs`（invoke）+ `src/lib/native.ts`（类型+封装）。加完用 channel 对比脚本校验（见交接文档 §8）。
- 现有 `list_orphan_assets` / `clean_orphan_assets`（全局，SyncPanel）保留；新增的 `list_note_orphans` / `clean_note_orphans`（文档级，历史面板）。

## 9. UI（历史面板，两个 tab）

- 入口：文档右键菜单 → "历史版本"（`src/components/Sidebar.tsx` ContextMenu 加项）。
- 组件：`src/components/HistoryPanel.tsx`（仿 `TrashPanel.tsx` 毛玻璃弹层）。
  - **Tab 1 文档历史**：快照列表（时间/大小/引用数）、点击预览（Viewer 渲染 .lake 或解压文本）、"恢复此版本"、"创建快照"、"删除此快照"。
  - **Tab 2 文档孤儿文件**：孤儿列表（文件名/大小/是否被历史保护）、单个清理/全部清理。
  - **顺序**：默认 Tab 1；删快照后刷新孤儿（§5）。
- 设置：**全部清理历史**入口放设置面板（`SettingsPanel.tsx`）。
- 样式：复用 `.trash-panel` 毛玻璃族（可加 `.history-panel` 变体）。

## 10. 与现有机制的关系

- **回收站**：
  - **软删除**（进回收站）：历史**保留**（恢复文档后历史还在，用户可找回更早版本）。
  - **彻底删除**（`purgeTrashItem`）：**连历史快照 + 历史引用的资源一起物理删**（彻底清除语义，用户确认）；删 `history/{noteId}/` 目录 + `note_history` 记录 + 被历史引用的资源 + .lake + note-assets + DB + FTS + 墓碑。
- **孤儿机制**：`detectOrphans` 仍按"当前正文引用"判定孤儿（保存时，不查历史）；历史保护在**清理动作**时实时判定（不污染孤儿表）。
- **同步**：历史目录不进 manifest；恢复后 sync_base 重置到恢复版 hash + markSynced；同步冲突判定用 `last_uploaded_hash`（P0-1）。
- **锁定缓存**：恢复走 `ensureNoteCaches` 兜底。

## 11. 风险与权衡

- **磁盘**：正文 gzip 20-30%，200 份/文档 ≈ 11MB（普通）/ 29MB（大文档），可控。
- **资源**：不复制 → 回滚依赖"当前资源仍在"。用户**手动删** note-assets（绕过应用）→ 回滚裂图（接受，应用内不会删被历史引用的）。
- **正则**：`referencedFilenames` 依赖文件名模式 `\d{13}_[0-9a-f]{8}\.{ext}`，若未来 lake 资源命名变化需同步更新。
- **自动清理立即物理删**（方案 A）：历史未引用即删。若用户误删历史快照，资源立即消失（但剩余历史引用的不删）。接受。
- **refs_json 一致性**：快照创建时正文 + refs 同事务写入（`note_history` 一行），保证一致；不建计数表避免漂移。

## 12. 测试要点

- 单测（`electron/store.test.ts`）：
  - 快照创建 + hash 去重（同内容不重复）
  - 保留策略：200 份上限裁剪、45 天兜底
  - 恢复：写回 .lake + 缓存/FTS 更新 + sync_state='local'
  - refs 判定：孤儿列表含/不含被历史引用的资源
  - 自动清理：删快照后无引用资源物理删
  - 删除历史后孤儿刷新（顺序，§5）
  - **边界**：只读文件不产生快照；编辑后锁定仍产生快照（dirty 由 saveNote 落盘驱动）
- CDP 端到端：
  - 创建文档 → 改内容 → 手动快照 → 历史列表出现
  - 删除历史 → 孤儿 tab 出现被解除引用的资源
  - 恢复历史 → 正文回滚 + 可搜索
  - 彻底删除文档 → 历史快照 + 资源全部物理删；软删除 → 历史保留
  - 编辑 → 锁定 → 15 分钟后快照存在（锁定不阻止快照）

## 13. 实现顺序建议

1. `note_history` 表 + 迁移（`store.ts` migrate）
2. `extractAssetRefs` 提取为公共工具（`referencedFilenames` 复用）
3. `createHistorySnapshot` / `listNoteHistory`（含 gzip、hash 去重、refs_json）
4. `restoreHistory` / `deleteHistory`
5. `cleanupHistory`（200份/45天 + 资源自动物理删，惰性触发）
6. `listNoteOrphans` / `cleanNoteOrphans`（实时解析）
7. `purgeTrashItem` 接历史保护
8. IPC / preload / native（三处同步）
9. `HistoryPanel.tsx` UI（两 tab）+ Sidebar 右键入口 + Settings 全部清理
10. 单测 + CDP 验证（含 §12 边界用例）
