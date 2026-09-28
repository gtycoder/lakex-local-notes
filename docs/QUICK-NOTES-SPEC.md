# 小记 V1：产品与技术规格

> 状态：已实现，当前位于开发分支 `feat/quick-notes`；最后更新：2026-08-04。
> 本文是小记的唯一规格来源。它明确规定：小记不是 Lake 文档，也不复用 Lake 编辑器；只有“转为正式笔记”是两套数据空间的单向交集。
>
> **⚠️ 2026-08-04 的上述结论已在 260919 被推翻（现状以此为准）**：小记正文升级为 **`.qnote` v2 = 内核形态
> `body`**（`src/core/quickNoteModel.ts`），写作区**编辑时挂一个 Lake 内核实例**
> （`src/features/quickNotes/QuickNoteEditor.tsx`），并采用内核 **note 版式**（工具条「图片 / 待办」+
> 右上角「展开」= 同一实例切成完整工具栏的整窗编辑器）。「转为正式笔记」因此从「手拼序列化」退化成
> **搬运 + 资源作用域改写**。数据格式与迁移口径见 `docs/QUICK-NOTES-SPEC.md`，
> 内核机制与坑见 `docs/LAKEX-CONTRACT.md` §5.11；当前状态与待办见 `HANDOFF.md` §3。
> 下文凡写「独立 textarea / 不复用 Lake 编辑器」的段落**均已过期**，仅作历史对照。
>
> **260919 续**：① 写作卡工具条 = **图片 / 待办 / 附件**（附件走 `stage_quick_note_file`，与图片共用
> staging→promote→转换搬运；`content.images` 即资源清单，允许非图片条目、附件宽高为 null）；
> ② 新增**列表版式**（对齐云端）：`小记`（写作卡 + 卡片流）/ `列表`（索引列表 + 全尺寸编辑器），
> 纯本机展示偏好（localStorage），不进 S3；③ 小记仍是**手动保存**语义（云端列表版式是自动保存，
> 我们保留「小记一下 / 保存 + 取消」，这是有意的产品差异）。

## 1. 定位与范围

**定位**：本地优先、手动保存、按创建时间倒序展示的临时时间线，用于短平快地记录一段文字和少量图片。

### V1 支持

- 无标题小记；不从首行推断标题。
- 多行纯文本与图片；每条小记至少包含文字或一张图片。
- 图片支持 PNG、JPEG、GIF、WebP、AVIF；单张最大 25 MiB。
- 新建、卡片原地编辑、手动“记下”、删除、5 秒撤销删除。
- 以 `createdAt DESC` 排列的时间线；编辑不改变排序。
- 从小记转换成 Lake 正式笔记：选择一个**笔记本**，新笔记插入其最顶部。
- 与既有 S3 配置共用 bucket/prefix，但使用完全独立的 `quick-notes/` 对象空间和独立 Manifest。

### V1 明确不做

- 自动保存、草稿恢复、回收站。
- 富文本、列表、待办、代码块、附件、网页收藏卡片。
- 标签、独立搜索、与 Lake 文档混合搜索。
- 小记反向引用/同步回 Lake，或 Lake 文档转回小记。
- 移动端入口（桌面端活动栏先行）。

## 2. 交互与状态机

### 2.1 新建与取消

1. 进入左侧活动栏的“小记”工作台，显示新建卡片和时间线。
2. 输入文字、拖入/粘贴/选择图片都只写入当前渲染状态及 `staging/{draftId}`；**不会创建正式小记**。
3. 点击“记下”才创建 `.qnote`、元数据与正式图片资源，并出现在线顶部。
4. 点击“取消”删除该草稿的 staging 图片并清空输入。
5. 若有未保存文字或 staging 图片，切换回资料库、取消、或关闭窗口时必须二次确认；确认离开后允许丢失，绝不自动保存。

### 2.2 编辑与删除

- 卡片的编辑按钮或双击卡片可原地展开编辑器；保存仍必须点击“记下”。
- 删除立即从时间线移除，并显示 5 秒 Undo Toast；撤销会恢复同一条小记。
- 不设回收站。5 秒结束后，删除作为 tombstone 参与小记自身同步。

### 2.3 转为正式笔记

1. 用户在小记卡片点击“转为正式笔记”。
2. 弹窗只列出笔记本，不展示复杂树选择；用户可在转换后在资料库中再移动该文档。
3. 目标文档标题固定为 `未命名文档 · YYYY-MM-DD HH:mm`（使用源小记创建时本机时区）。
4. 目标文档创建在所选笔记本**最顶部**，并自动打开 Lake 编辑器。
5. 小记的每个物理换行转换为独立 Lake 段落（空行保留为空段落），避免后续使用有序/无序列表时被识别为同一列表项；每张图片转换为 Lake inline image card。
6. 目标 Lake 文档及其图片落盘并完成本地校验后，才删除源小记。

## 3. 隔离边界

| 范围 | Lake 正式笔记 | 小记 |
|---|---|---|
| 编辑器 | Lake 编辑器 | 独立 React 卡片/textarea |
| 数据库 | `workspace-default/metadata.sqlite3` | `workspace-default/quick-notes/metadata.sqlite3` |
| 正文 | `notes/{noteId}.lake` | `quick-notes/items/{id}.qnote` |
| 图片 | `note-assets/{noteId}/` | `quick-notes/assets/{id}/` |
| 临时图片 | 无 | `quick-notes/staging/{draftId}/` |
| S3 Manifest | Manifest v2 | Manifest v1，位于 `quick-notes/` |
| 搜索 | Lake 文档范围 | V1 不提供搜索 |

不得让小记写入 `notes`、`tree_nodes`、`note-assets`、Lake Manifest v2 或 Lake 搜索索引。唯一例外是转换协调器：它显式复制资源、创建目标 Lake 文档，并以 journal 管理跨 SQLite 的原子性边界。

## 4. 本地格式与落盘

目录：

```text
workspace-default/
└── quick-notes/
    ├── metadata.sqlite3
    ├── items/{quickNoteId}.qnote
    ├── assets/{quickNoteId}/{filename}
    └── staging/{draftId}/{filename}
```

`.qnote` 为 UTF-8 JSON：

```json
{
  "version": 1,
  "text": "临时记录\n第二行",
  "images": [
    {
      "id": "uuid",
      "filename": "timestamp_random.png",
      "mimeType": "image/png",
      "width": 1200,
      "height": 800,
      "size": 123456,
      "hash": "sha256 hex"
    }
  ]
}
```

小记 SQLite 表：

- `quick_notes`：时间线元数据、内容 hash、同步状态、冲突副本标记。
- `quick_note_assets`：图片元数据和哈希。
- `quick_note_sync_base`：上次同步基线，用于冲突判定。
- `quick_note_deleted`：删除 tombstone；转换场景含 `conversion_target_note_id` 与 `ready_to_sync`。
- `quick_note_conversions`：转换 journal，状态为 `prepared → target_created → source_deleted_waiting_sync → complete`。

图片内容、大小、文件名和 SHA-256 会在保存、导入与同步下载时校验。资源 URL 专用为：

```text
http://127.0.0.1:19876/quick-notes/{quickNoteId}/{filename}
http://127.0.0.1:19876/quick-notes/staging/{draftId}/{filename}
```

不能通过普通 Lake 的 `/{noteId}/{filename}` 路径读取小记资源。

## 5. 转换一致性与排序能力

转换涉及两个独立 SQLite/文件空间，不能用单数据库事务覆盖，因此使用 journal：

```text
beginConversion(prepared)
  → 复制小记图片到 note-assets/{targetNoteId}/
  → 创建 Lake .lake + notes/tree_nodes 元数据
  → readNote 校验目标
  → target_created
  → 删除源小记（tombstone ready_to_sync=0）
  → source_deleted_waiting_sync
```

应用启动时会根据 journal 恢复：如果目标 Lake 已登记，继续完成源删除；如果目标未登记，只清理未登记的 Lake 半成品。

`Store.createNoteInAtTopWithContent()` 是通用的目录排序底层能力。它在一个主库事务中把同一父级的 `tree_nodes.sort_order` 与 `notes.sort_order` 同时加一，再以 `sort_order=0` 插入新文档。普通新建仍默认插入底部；未来可复用此能力提供“新建于顶部/底部”的用户偏好。

## 6. S3 同步协议

小记使用同一 S3 设置，但不修改 Lake Manifest v2：

```text
{prefix}/
└── quick-notes/
    ├── objects/{contentHash}.qnote
    ├── assets/{quickNoteId}/{filename}
    └── manifests/latest.json
```

小记 Manifest v1 包含 `id`、创建/更新时间、内容 hash、冲突标记、图片元数据与可选 `deleted/deletedAt`。上传使用内容寻址和图片 hash 增量判断；下载会先验证 Manifest、对象 hash、图片大小/hash 和安全路径。

同步顺序固定为：

```text
Lake sync 成功 → 标记已成功同步的转换目标 → 小记 sync
```

这意味着：

- 小记同步失败只记录在 `result.quickNotes.error`，**不会把 Lake 已成功的同步变成失败**。
- 主同步结果在小记阶段结束后再次持久化，SyncPanel 重开后仍可展示小记状态。
- 转换源小记的 tombstone 在目标 Lake 文档成功进入同步周期前 `ready_to_sync=0`，不可上传。
- 在这段等待期，若远端仍有源小记，客户端既不重新下载使其“复活”，也不会在新 Manifest 中遗漏该远端条目；待 Lake 成功后才发布删除 tombstone。
- 本地与远端同时改动时（冲突），**远端覆盖本地**；本地版本以**新 id 归档进小记回收站**（内容/资源保留、纯本地不上云），恢复后即一条新小记（验收 #4 定稿：B 方案）。

## 7. 验收与测试矩阵

单元测试覆盖：

- 无标题文本保存、staging 图片移动/清理、删除 tombstone。
- 小记 → Lake 的固定标题、图片复制、URL 序列化、顶部插入排序。
- 转换 tombstone 未被 Lake 放行前不可同步。
- 不安全远端文件名拒绝且不落盘。
- 独立 `quick-notes/` S3 对象/Manifest 前缀、幂等同步、合法删除 tombstone、等待期远端条目保持。

真实 Electron 验证（2026-08-04）：

1. 打开小记工作台，保存图文小记；
2. 原地编辑并保存；
3. 转为笔记并选择笔记本；
4. 验证目标笔记出现在笔记本顶部、Lake inline image 实际加载为 `1×1` PNG；
5. 编辑并保存转换后的 Lake 文档；
6. 重启 Electron，验证文档文字和图片仍存在、时间线源卡片已移除；
7. 已清理本次真实验证产生的开发 userData 测试数据。

## 8. 后续扩展原则

若以后增加列表、待办、标签、搜索、附件或网页收藏，必须先确认它们仍符合“小记临时记录”的定位，并为 `.qnote` 设计可版本化的数据模型。不要为了复用 Lake 编辑器而让小记成为另一种 Lake 文档；转换隔离器应继续是唯一理解两种格式的边界模块。
