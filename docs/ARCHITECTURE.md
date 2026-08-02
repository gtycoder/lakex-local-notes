# 架构总览

## 一、进程结构

```
Electron 主进程 (electron/main.ts)
├── Store (electron/store.ts)：better-sqlite3 + 文件系统后端（从 Tauri Rust 移植）
├── assetServer (electron/assetServer.ts)：本地 HTTP 图片服务器 :19876
│     ├── /{noteId}/{filename}               → 图片二进制（immutable 缓存）
│     ├── /{noteId}/{filename}?base64=1      → data:image/png;base64（复制到微信用，webp/avif 用 sharp 转 png）
│     └── /vendor/cdn/<path>                 → Lake 编辑器 CDN 资源本地镜像
├── sync (electron/sync.ts)：S3 同步引擎（七牛等 S3 兼容服务）
└── IPC：bootstrap/note CRUD/tree/资源上传下载/orphan/S3 配置/同步

Preload (electron/preload.cjs)：原生 CJS，contextBridge 暴露 window.lakeNative（23+ 方法）
└── 渲染进程 (React + Lake 编辑器 + Drawnix)
```

## 二、关键文件索引

| 文件 | 说明 |
|---|---|
| `electron/main.ts` | 主进程：窗口、IPC、CDN 重定向注册、asset server 启动 |
| `electron/store.ts` | 后端：SQLite（notes/tree_nodes/device_state/settings/orphan_assets/deleted_notes/sync_base）+ 文件系统；图片下载（electronNet.fetch 防 JA3 403） |
| `electron/assetServer.ts` | 本地图片服务器 + webp→png（sharp）+ `/vendor/cdn` 静态路由 |
| `electron/sync.ts` | S3 同步引擎（manifest + 内容寻址 + 增量 + 冲突副本 + 墓碑 + 孤儿跳过） |
| `electron/preload.cjs` | **原生 CJS**（不走 Vite），暴露 lakeNative；打包版需 asarUnpack |
| `src/App.tsx` | 主应用（多 Tab、侧边栏、状态栏、同步面板入口） |
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

```
~/Library/Application Support/lake-notes-electron/workspace-default/
├── metadata.sqlite3          # 主数据库（WAL 模式）
├── notes/
│   └── {noteId}.lake         # 文档内容（含 http://127.0.0.1:19876/{noteId}/{filename} 引用）
└── note-assets/
    └── {noteId}/
        └── {timestamp}_{random8}.{png|jpg|webp|...}
```

### 4.2 SQLite 表

| 表 | 说明 |
|---|---|
| `notes` | 笔记元数据（sync_state、is_conflict、deleted_at） |
| `tree_nodes` | 目录树（notebook/group/note） |
| `device_state` | key-value（last_opened_note_id、last_synced_at、last_sync_result） |
| `settings` | key-value（`s3_settings` = S3 配置 JSON，secret 经 safeStorage 加密为 `enc:v1:`） |
| `orphan_assets` | 孤儿资源记录（唯一索引 file_path） |
| `deleted_notes` | 本地删除墓碑（同步用） |
| `sync_base` | note_id → content_hash（同步基线，冲突判定用） |

### 4.3 S3 云端布局（prefix = `lake-notes`）

```
lake-notes/
├── objects/{contentHash}.lake        # 文档内容（内容寻址）
├── assets/{noteId}/{filename}        # 资源（跳过 orphan_assets）
└── manifests/
    ├── latest.json                   # 当前清单（Manifest v2）
    └── {commitId}.json               # 历史快照（每次同步累积，可清理）
```

### 4.4 七牛云已验证配置（用户真实账号）

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
- **结果持久化**：device_state 存 `last_synced_at` + `last_sync_result`（JSON）
