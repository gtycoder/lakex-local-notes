# 架构总览

## 一、进程结构

```
Electron 主进程 (electron/main.ts)
├── Store (electron/store.ts)：Lake 正式笔记的 better-sqlite3 + 文件系统后端
├── QuickNotesStore (electron/quickNotes.ts)：小记专属 SQLite / .qnote / 图片 staging，绝不写入 Lake 空间
├── assetServer (electron/assetServer.ts)：本地 HTTP 图片服务器 :19876
│     ├── /{noteId}/{filename}                         → Lake 图片二进制
│     ├── /quick-notes/{quickNoteId}/{filename}       → 已保存小记图片
│     ├── /quick-notes/staging/{draftId}/{filename}   → 未保存草稿图片
│     ├── /{noteId}/{filename}?base64=1               → Lake 图片 data URI（复制到微信用）
│     └── /vendor/cdn/<path>                           → Lake 编辑器 CDN 资源本地镜像
├── sync (electron/sync.ts)：Lake Manifest v4 的 S3 同步引擎（结构见 SYNC-PROTOCOL.md）
├── quickNotesSync (electron/quickNotesSync.ts)：小记 Manifest v1 的独立 S3 同步
├── quickNoteConversion (electron/quickNoteConversion.ts)：唯一跨空间的小记 → Lake 转换协调器
└── IPC：Lake CRUD/tree/资源/S3 与独立小记 CRUD/staging/转换

Preload (electron/preload.cjs)：原生 CJS，contextBridge 暴露 window.lakeNative（Lake 与小记独立方法）
└── 渲染进程 (React + Lake 编辑器 + Drawnix)
```

## 二、关键文件索引

| 文件 | 说明 |
|---|---|
| `electron/main.ts` | 主进程：窗口、IPC、CDN 重定向注册、asset server 启动 |
| `electron/store.ts` | Lake 后端：SQLite（notes/tree_nodes/device_state/settings/orphan_assets/deleted_notes/sync_base）+ 文件系统；包含目录顶部插入的通用底层能力 |
| `electron/quickNotes.ts` | 小记独立 SQLite、`.qnote`、图片 staging/保存/删除、转换 journal 与崩溃恢复 |
| `electron/quickNoteConversion.ts` | 小记纯文本/图片 → Lake 段落/inline image card；复制资源并协调 journal |
| `electron/assetServer.ts` | Lake 与小记隔离的本地图片服务器 + webp→png（sharp）+ `/vendor/cdn` 静态路由 |
| `electron/sync.ts` | Lake Manifest v4 同步（内容寻址、增量、先同步者胜、墓碑、孤儿跳过；协议见 SYNC-PROTOCOL.md） |
| `electron/quickNotesSync.ts` | 小记 Manifest v1 同步（独立 prefix、tombstone、冲突副本、转换等待保护） |
| `electron/preload.cjs` | **原生 CJS**（不走 Vite），暴露 lakeNative；打包版需 asarUnpack |
| `src/App.tsx` | 主应用（多 Tab、资料库/小记工作台切换、侧边栏、状态栏、同步面板入口） |
| `src/components/QuickNotesWorkspace.tsx` | 小记时间线、新建/原地编辑、图片选择/粘贴/拖放、删除 Undo、转换弹窗 |
| `src/main.tsx` | React 入口：**顶部**调用 `installPasteInterceptor()` |
| `src/lib/native.ts` | 前端 IPC 封装 + 类型（`window.lakeNative`） |
| `src/lib/types.ts` | 共享类型（S3Settings/SyncResult/SyncProgress/SyncStatusInfo/OrphanAsset 等） |
| `src/features/editor/lakeRuntime.ts` | Lake 编辑器创建；`deepMerge` 深合并；**虚拟渲染/TOC 跟随/卡片水合/表格工具栏 hover 桥**（详见 PROGRESS.md ★最新交接） |
| `src/features/editor/BoardCard.tsx` | Drawnix 画板卡片（+ `src/vendor/drawnix*.css`） |
| `src/features/editor/resourceUpload.ts` | 图片/附件上传管线（WebP→PNG、base64、远程下载） |
| `src/features/editor/clipboardHtml.ts` | 粘贴拦截升级（知乎懒加载 SVG→真实 URL）+ 复制清洗（空行/零宽字符） |
| `src/components/SyncPanel.tsx` | S3 配置 + 进度条 + 最近同步结果 + **孤儿资源清理区块** |
| `index.html` | `<script src="./vendor/lakex-doc/codemirror.js">` + KITCHEN_URL（**必须相对路径**） |
| `public/vendor/cdn/` | Lake 编辑器 35 个 CDN 资源本地镜像 |
| `public/vendor/lakex-doc/` | codemirror/katex/字体/图标（最早 vendor 的） |
| `vite.config.ts` | vite + vite-plugin-electron；external 含 better-sqlite3/sharp/@aws-sdk；Drawnix alias |

## 三、图片数据流（核心链路）

```
粘贴/拖入/远程图片
  → clipboardHtml.installPasteInterceptor（粘贴时：知乎懒加载空 SVG → data-actualsrc 真实 URL）
  → lakeRuntime createUploadPromise → resourceUpload.uploadLakeResource(request, noteId)
  → native.uploadResource / downloadRemoteResource(url, noteId)
  → store：webp→png（本地上传）或 electronNet.fetch 下载（第三方，Referer=图片自身 URL + 浏览器 UA + 重试）
  → 写入 note-assets/{noteId}/{timestamp}_{random8}.{ext}
  → 返回 http://127.0.0.1:19876/{noteId}/{filename}
复制到微信
  → copy 捕获阶段 handler（先于 Lake 内部）
  → clipboardHtml.normalizeClipboardHtml：本地图用同步 XHR 请求 ?base64=1 → data:image/png;base64 替换
  → event.clipboardData.setData("text/html", ...)
```

## 四、数据与存储

### 4.1 本地目录结构

```text
~/Library/Application Support/lake-notes-electron/workspace-default/
├── metadata.sqlite3          # Lake 主数据库（WAL 模式）
├── notes/
│   └── {noteId}.lake         # Lake 文档（含 http://127.0.0.1:19876/{noteId}/{filename} 引用）
├── note-assets/
│   └── {noteId}/
│       └── {timestamp}_{random8}.{png|jpg|webp|...}
└── quick-notes/                       # 与 Lake 数据空间完全隔离
    ├── metadata.sqlite3
    ├── items/{quickNoteId}.qnote
    ├── assets/{quickNoteId}/{filename}
    └── staging/{draftId}/{filename}
```

### 4.2 SQLite 表（Lake）

| 表 | 说明 |
|---|---|
| `notes` | 笔记元数据（sync_state、is_conflict、deleted_at） |
| `tree_nodes` | 目录树（notebook/group/note） |
| `device_state` | key-value（last_opened_note_id、last_synced_at、last_sync_result） |
| `settings` | key-value（`s3_settings` = S3 配置 JSON，secret 经 safeStorage 加密为 `enc:v1:`） |
| `orphan_assets` | 孤儿资源记录（唯一索引 file_path） |
| `deleted_notes` | 本地删除墓碑（同步用） |
| `sync_base` | note_id → content_hash（同步基线，冲突判定用） |

### 4.3 SQLite 表（小记）

| 表 | 说明 |
|---|---|
| `quick_notes` | 时间线元数据、内容 hash、同步状态、冲突标记 |
| `quick_note_assets` | 小记图片元数据和 hash |
| `quick_note_sync_base` | 小记同步基线 |
| `quick_note_deleted` | 删除 tombstone；转换时可暂缓上传 |
| `quick_note_conversions` | 跨空间转换 journal |

详见 [QUICK-NOTES-SPEC.md](./QUICK-NOTES-SPEC.md)。

### 4.4 S3 云端布局（prefix = `lake-notes`）

```text
lake-notes/
├── objects/{contentHash}.lake        # 文档内容（内容寻址）
├── assets/{noteId}/{filename}        # 资源（跳过 orphan_assets）
├── manifests/
│   ├── latest.json                   # Lake 当前清单（Manifest v4）
│   └── {commitId}.json               # Lake 历史快照
└── quick-notes/                      # 小记独立 Manifest v1 / 对象 / 图片
    ├── objects/{contentHash}.qnote
    ├── assets/{quickNoteId}/{filename}
    └── manifests/latest.json
```

### 4.5 七牛云已验证配置（用户真实账号）

```
Endpoint:    https://s3.cn-north-1.qiniucs.com
Region:      cn-north-1
Bucket:      local-lake-hebei     ← 不是 local-lake！
对象前缀:     lake-notes
Path-style:  ✅ 勾选
```
- AK/SK 保存在本机 settings 表（含密钥，勿外泄、勿提交）
- 账号下实际空间：`image-store-hebei`、`joplin-s3-hebei`、`local-image-lake`、`local-lake-hebei`、`siyuan-qiniu-hebei`
- 用户说后续**安卓端同步**也用这一套配置

## 五、S3 同步机制（electron/sync.ts）

- **Manifest**：`version=2`、`workspaceId="default"`、notes[]（id/title/parentId/sortOrder/updatedAt/contentHash/assets[]/deleted）
- **增量**：contentHash（sha256 of .lake）比对，本地 = 远端则只 setBaseHash
- **下载**：远端有本地缺/不同 → 下载 objects/{hash}.lake + assets；本地已删除（墓碑）优先，不重拉
- **冲突**：本地和远端都改过 → 生成「（冲突副本 日期）」笔记（isConflict=true）
- **上传**：仅 hash 不同才上传 .lake + 资源；**跳过 orphan_assets 记录的文件**
- **墓碑**：本地删除而云端未标记 → 清单标记 deleted（不删云端对象，防重拉）
- **进度**：`syncNow(store, onProgress)` 回调，主进程转发 `sync-progress` IPC
- **结果持久化**：device_state 存 `last_synced_at` + `last_sync_result`（JSON）。主进程在小记同步成功或失败后再次写入完整结果。

### 小记同步（electron/quickNotesSync.ts）

- **完全独立**：不读取、不修改 Lake Manifest v4；所有对象只在 `{prefix}/quick-notes/` 下。
- **顺序**：主进程先完成 Lake `syncNow()`，再执行小记同步；小记失败作为 `result.quickNotes.error` 返回，不能否定 Lake 的成功。
- **转换 tombstone**：Lake 目标文档成功进入同步周期前，源小记 tombstone 保持 `ready_to_sync=0`；同步既不上传删除标记，也不会重新下载源小记或从远端 Manifest 漏掉原条目。
- **校验**：Manifest、路径段、`.qnote` hash、图片大小与 hash 都必须通过；同时修改时创建可见的小记冲突副本。
