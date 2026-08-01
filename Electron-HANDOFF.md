# Lake Notes Electron 交接文档

更新时间：2026-07-31 晚
状态：**POC 验证通过，资源归一化方案已确定，待落地实施**
分支：`asset-server-poc`（基于 `feature/electron` 的 baseline commit）

本文面向完全没有此前上下文的新会话。请先读完本文，再修改代码。

---

## 一、任务目标

将 Lake Notes 笔记应用从 **Tauri 2** 迁移到 **Electron**，解决 Tauri 在 macOS 上使用 WKWebView 导致的一系列渲染 bug（foreignObject 文字不绘制、viewport 偏移等）。

**为什么换 Electron**：
- Tauri 在 macOS 强制使用系统 WKWebView，无法替换。WKWebView 对 SVG foreignObject 负坐标不渲染 HTML 文字
- Lake 编辑器是 Web 组件，Chromium 是它的原生环境（语雀自己就跑在 Chrome 上）
- Electron 有完整 Chrome DevTools，调试效率提升 10 倍
- 思源笔记（同类型产品）也是 Electron

**核心设计理念**：
- 仿照思源笔记的资源管理模式：图片/附件独立存储，按笔记分目录，文档与资源分离
- 不做图片去重（冗余存储可接受，存储不贵）
- 后期用 S3 做备份/同步
- 复制到第三方应用（微信）时图片能正常显示
- **不要弹"正在加载"之类的 toast**

**技术栈**：Electron 33 + React 18 + TypeScript + better-sqlite3 + Lake 编辑器（ESM，`lakex-editor-react-component`）+ Drawnix 画板（`lakex-drawnix`）

---

## 二、工作区与分支

### 项目位置
`/Users/admin/file/local-lake/lake-notes-electron`（独立 git 仓库）

### 分支说明
- `feature/electron`：主开发分支，包含所有已完成功能
- `asset-server-poc`：当前分支，POC 验证通过，包含本地 HTTP 图片服务器 + 复制到微信适配。**下一步在此分支上落地资源归一化方案**

### 只读参考（不要修改）
- `/Users/admin/file/local-lake/lake-notes-tauri-poc/`：Tauri 版源码，架构参考，**CSS 基准**
- `/Users/admin/file/local-lake/siyuan/`：思源笔记，Electron 架构参考，资源管理参考

---

## 三、启动方式

```bash
export PATH="/Users/admin/.nvm/versions/node/v24.18.0/bin:$PATH"
export NPM_CONFIG_USERCONFIG=$(mktemp)
export NPM_CONFIG_GLOBALCONFIG=$(mktemp)
export npm_config_registry=https://registry.npmmirror.com
export npm_config_cache=/tmp/npm-cache-lake
cd /Users/admin/file/local-lake/lake-notes-electron
npx vite --host 127.0.0.1 --port 1421
```

`vite-plugin-electron` 会自动启动 Electron。Vite dev server 地址：`http://127.0.0.1:1421/`

**杀进程时绝不能用 `pkill -f "Electron"`**——Trae CN（用户的 IDE）也是 Electron 应用，主进程二进制也叫 `Electron`，会被误杀。正确方式：
```bash
kill $(ps aux | grep "lake-notes-electron" | grep -v grep | awk '{print $2}')
```

---

## 四、已完成内容

### 4.1 项目脚手架 ✅
- `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`
- `vite-plugin-electron` 同时构建前端和 Electron 主进程
- Vite alias：`@plait-board/react-board` → `lakex-drawnix-react-board`，`@plait-board/react-text` → `lakex-drawnix-react-text`

### 4.2 Electron 主进程 ✅
- `electron/main.ts`：窗口创建（hiddenInset + trafficLightPosition）、IPC 注册、`--max-old-space-size=8192`
- `electron/preload.cjs`：**原生 CJS 文件**，不走 Vite 编译（见踩坑 §10.3）
- `electron/store.ts`：Node.js 后端（better-sqlite3 + 文件系统），从 Tauri Rust 后端移植

### 4.3 前端代码迁移 ✅
从 Tauri 版复制并适配。以下文件与 Tauri 版**逐字节相同**：
- `imageFormat.ts`（图片格式嗅探）
- `resourceUpload.ts`（图片上传管线：WebP→PNG、base64、远程下载）
- `concurrency.ts`、`retry.ts`、`tree.ts`、`types.ts`、`workerPool.ts`
- `Sidebar.tsx`、`MobileLibrary.tsx`、`SyncPanel.tsx`

以下文件做了适配（功能等价）：
- `App.tsx`：`isTauri()` → `isDesktop()`
- `lakeRuntime.ts`：简化 API 签名 + 注册 BoardCard
- `native.ts`：`isTauri()` → `isDesktop()`，缺少 4 个 S3 方法
- `MultiTabEditor.tsx`：与 Tauri 版相同
- `main.tsx`：移除 wkprobe

### 4.4 Drawnix 画板集成 ✅
- `src/features/editor/BoardCard.tsx`：干净实现，无 WKWebView workaround
- CSS 从 `src/vendor/` 导入（3 个文件，从 node_modules 复制，见踩坑 §10.5）
- 在 `lakeRuntime.ts` 注册到斜杠菜单（"程序员" 分组）

### 4.5 功能迁移审计 ✅
所有核心编辑功能已 100% 迁移：图片粘贴、复制到微信、WebP 转换、自动保存、多 Tab、目录树拖拽、画板。唯一缺口：S3 同步（4 个 IPC 方法 + 后端逻辑未迁移）。

### 4.6 imageConverter.worker.ts 修复 ✅
Tauri 版在 Worker 中用 `new Image()`（DOM API，Worker 中不可用）。已改为 `createImageBitmap()`。

### 4.7 POC：本地 HTTP 图片服务器 + 复制到微信适配 ✅（已验证通过）

**目标**：验证 Lake 编辑器能否接受 `http://127.0.0.1:PORT/...` 格式的图片 URL，以及复制到微信时能否正确转换回 base64。

**验证结论**：全部通过。Lake 对 HTTP URL 零兼容风险，`getDocument("text/lake")` 原样保留 URL，关闭重开图片正常加载，复制到微信图片正常显示且无多余空行。

**POC 改动文件**（5 个，均在 `asset-server-poc` 分支上，未 commit）：

#### `electron/assetServer.ts`（新增）
本地 HTTP 静态文件服务器，端口 `19876`，生命周期跟 app 绑定。
- 普通请求：返回图片二进制，`Cache-Control: immutable`
- `?base64=1` 请求：返回 `data:image/png;base64,...` 纯文本（供复制到微信的同步 XHR 使用）

当前 POC 的 URL 格式是 `/{hash}.ext`，**落地时要改为 `/{noteId}/{filename}`**（见 §七）。

#### `electron/store.ts`（修改 `imageOutput` 函数）
POC 中 `imageOutput` 改为：计算 SHA256 哈希 → 写文件到 `assets/` → 返回 `http://127.0.0.1:19876/{hash}.ext`。
**落地时要改为**：`{timestamp}_{random}` 命名 → 写文件到 `note-assets/{noteId}/` → 返回 `http://127.0.0.1:19876/{noteId}/{uniqueId}.ext`（见 §七）。

#### `electron/main.ts`（修改）
添加了 `import { startAssetServer } from "./assetServer.js"` 和 `startAssetServer(path.join(workspaceRoot(), "assets"))` 调用。
**落地时要改为** `startAssetServer(path.join(workspaceRoot(), "note-assets"))`。

#### `src/features/editor/clipboardHtml.ts`（修改）
- `normalizeImage` 函数：遇到 `http://127.0.0.1:19876/` 开头的 src 时，用**同步 XHR** 请求 `?base64=1` 端点，拿到 `data:...;base64,...` 字符串替换进剪贴板 HTML
- `normalizeClipboardHtml` 函数末尾：正则清理 Lake 编辑器产生的空 `<span>` 和空 `<p>`/`<div>`（零宽字符、`<br>` 等），避免复制到微信时出现多余空行
- `isEmptyBlock` 函数：过滤无内容的块级元素
- `BLOCK_TAGS` 中新增了 `DIV`

**落地时要修改**：`LOCAL_ASSET_PREFIX` 和 `normalizeImage` 中的 URL 匹配逻辑需要适配新的 `/{noteId}/{filename}` 格式。同步 XHR 的 `?base64=1` 拼接方式不变。

#### `src/features/editor/EditorTab.tsx` 和 `LakeEditor.tsx`（修改）
- copy handler 改为**捕获阶段**（`addEventListener("copy", handler, true)`）+ `stopImmediatePropagation()`，确保在 Lake 内部 copy handler 之前拦截
- 添加了 `[copy-debug]` 日志（落地时可删除）

### 4.8 多 Tab 滚动修复 ✅（在 `feature/electron` 分支上）
`src/styles.css` 修改：
- 删除 `.document-pane:has(.multi-tab-editor) { overflow: hidden; }`
- `.multi-tab-editor` 的 `height: 100%` → `min-height: 100%`
- `.tab-bar` 的 `position: relative` → `position: sticky; top: 0`
- `.lake-editor-tab` 删除 `overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain`
- `.lake-editor-tab .lake-editor-mount` 删除 `height: 100%`
- `EditorTab.tsx` 内联样式删除 `height: "100%"`

**注意**：这些 CSS 修复在 `feature/electron` 分支上。`asset-server-poc` 分支是从 baseline commit 创建的，**不包含这些 CSS 修复**。落地时需要先把 CSS 修复合并进来，或者在 `feature/electron` 上 cherry-pick POC 改动。

---

## 五、当前 POC 分支的存储结构

```
workspace-default/
├── metadata.sqlite3          # notes, tree_nodes, device_state, settings
├── notes/
│   └── {noteId}.lake         # 文档内容（含 http://127.0.0.1:19876/{hash}.ext 引用）
└── assets/
    ├── {sha256前16位}.png    # 内容寻址，全局扁平（POC 用，落地时要改）
    └── ...
```

**POC 的问题**（落地时要解决）：
- 全局扁平 `assets/` 目录，无法按笔记管理
- SHA256 命名导致同一张图共享文件，删一个位置可能影响另一个（虽然当前逻辑不会，但设计上耦合）
- 删笔记不删图片，无孤儿清理机制
- URL 格式 `/{hash}.ext` 不含 noteId，HTTP 服务器无法按笔记隔离

---

## 六、与 Tauri 版的功能差异

| 功能 | Tauri 版 | Electron 版 |
|---|---|---|
| Lake 编辑器 | ✅ ESM + Drawnix 画板 | ✅ ESM + Drawnix 画板 |
| 多 Tab | ✅ 8 Tab + LRU | ✅ 同 |
| 图片上传 | ✅ base64 + WebP→PNG | ✅ HTTP URL + 文件存储 |
| 目录树 | ✅ 拖拽排序 | ✅ 同 |
| 复制到微信 | ✅ | ✅（同步 XHR 转 base64） |
| 大纲/TOC | ✅ | ✅ |
| S3 备份 | ✅ | ❌ 待实现 |
| 调试 | ❌ 几乎不可用 | ✅ Chrome DevTools |
| 多 Tab 滚动布局 | ⚠️ 有覆盖 bug | ✅ 已修复（feature/electron 分支） |
| 大文档性能 | ⚠️ 卡 | ✅ OOM 已解决（图片不再进 V8 堆） |

---

## 七、下一步：资源归一化落地方案（核心，必须完整阅读）

### 7.1 设计原则

1. **按笔记分目录**：每篇笔记的图片存在独立子目录，删笔记 = 删整个子目录
2. **不做去重**：同一张图粘贴到两篇笔记 = 两份文件。冗余可接受，存储不贵
3. **每次插入独立文件**：不用 hash 命名，用 `{timestamp}_{random}` 命名，从根本上消除文件共享
4. **不自动删孤儿**：saveNote 时检测孤儿写入 `orphan_assets` 表，用户手动触发清理
5. **S3 同步时跳过孤儿**：orphan_assets 表中的文件不上传

### 7.2 目标目录结构

```
workspace-default/
├── metadata.sqlite3
├── notes/
│   └── {noteId}.lake                    # 文档内容（含 http://127.0.0.1:19876/{noteId}/{filename} 引用）
└── note-assets/
    └── {noteId}/
        ├── 1722412800000_a3f2b1c9.png   # 每次插入独立文件
        ├── 1722412800100_f7e3d2a1.jpg
        └── ...
```

### 7.3 URL 格式

```
http://127.0.0.1:19876/{noteId}/{filename}
http://127.0.0.1:19876/{noteId}/{filename}?base64=1    # 复制到微信用
```

HTTP 服务器映射：`/{noteId}/{filename}` → `note-assets/{noteId}/{filename}`

### 7.4 文件命名

```typescript
const uniqueId = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
const filename = `${uniqueId}.${format.extension}`;
// 例如：1722412800000_a3f2b1c9.png
```

- 时间戳保证大致有序（方便排查）
- 4 字节随机 hex（8 字符）保证唯一
- 不用 hash，每次插入都是新文件，零耦合

### 7.5 新增 DB 表

```sql
CREATE TABLE IF NOT EXISTS orphan_assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     TEXT NOT NULL,
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,    -- 相对路径如 "note-assets/{noteId}/xxx.png"
  size        INTEGER NOT NULL,
  mime_type   TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orphan_path ON orphan_assets(file_path);
```

### 7.6 各操作的行为

#### 写入图片（uploadResource / downloadRemoteResource）

```
1. 接收 bytes + filename + noteId
2. 嗅探格式（sniffImageFormat，不变）
3. 生成 uniqueId = `${Date.now()}_${randomHex(8)}`
4. filename = `${uniqueId}.${ext}`
5. 确保 note-assets/{noteId}/ 目录存在
6. 写文件到 note-assets/{noteId}/{filename}
7. 返回 { url: `http://127.0.0.1:19876/${noteId}/${filename}`, ... }
```

#### 保存笔记（saveNote）

```
1. 写 .lake 文件（不变）
2. 更新 DB notes 表（不变）
3. 扫描 content 中所有 http://127.0.0.1:19876/{noteId}/xxx 的 filename → referencedSet
4. 列出 note-assets/{noteId}/ 下所有文件 → diskSet
5. orphans = diskSet - referencedSet
6. 对 orphans：INSERT OR IGNORE INTO orphan_assets(note_id, filename, file_path, size, mime_type)
7. 对重新被引用的（用户 undo 了删除）：DELETE FROM orphan_assets WHERE note_id = ? AND filename = ?
```

**不删文件**，只记录到表里。

#### 删除笔记（deleteNote）

```
1. 删 notes/{noteId}.lake
2. 删 DB notes/tree_nodes 记录
3. rm -rf note-assets/{noteId}/          ← 整个目录走
4. DELETE FROM orphan_assets WHERE note_id = {noteId}
```

#### 手动清理孤儿（新增 IPC）

```
IPC: clean_orphan_assets()
  1. SELECT * FROM orphan_assets
  2. 逐个 fs.unlinkSync(file_path)（文件不存在则跳过）
  3. DELETE FROM orphan_assets
  4. 返回 { count, freedBytes }

IPC: list_orphan_assets()
  SELECT * FROM orphan_assets ORDER BY detected_at DESC
  返回 [{ id, noteId, filename, filePath, size, mimeType, detectedAt }, ...]
```

#### S3 同步

```
同步笔记 X = 上传 notes/X.lake + note-assets/X/*（跳过 orphan_assets 表中记录的文件）
下载笔记 X = 下载 .lake + 资源文件，写入 note-assets/X/
```

### 7.7 需要修改的文件清单（8 个文件）

| # | 文件 | 改动内容 |
|---|------|---------|
| 1 | `electron/assetServer.ts` | URL 解析从 `/{filename}` 改为 `/{noteId}/{filename}`，映射到 `note-assets/{noteId}/{filename}`；`?base64=1` 逻辑不变 |
| 2 | `electron/store.ts` | ① `uploadResource` 加 `noteId` 参数，写 `note-assets/{noteId}/`；② `downloadRemoteResource` 加 `noteId` 参数；③ `imageOutput` 改用 `{timestamp}_{random}` 命名，写 `note-assets/{noteId}/`；④ `deleteNote` 加 `rm -rf note-assets/{noteId}/` + 清 orphan 表；⑤ `saveNote` 加孤儿检测写表逻辑；⑥ 新增 `cleanOrphanAssets()` 和 `listOrphanAssets()` 方法；⑦ `migrate()` 加 `CREATE TABLE orphan_assets` |
| 3 | `electron/main.ts` | ① IPC handler `upload_resource` 和 `download_remote_resource` 透传 noteId；② 新增 `clean_orphan_assets` 和 `list_orphan_assets` handler；③ `startAssetServer` 参数改为 `note-assets` 目录 |
| 4 | `electron/preload.cjs` | `downloadRemoteResource` 加 noteId 参数：`(url, noteId) => invoke("download_remote_resource", url, noteId)` |
| 5 | `src/lib/native.ts` | 类型定义：`uploadResource` 和 `downloadRemoteResource` 加 noteId 参数 |
| 6 | `src/features/editor/resourceUpload.ts` | `uploadLakeResource` 加 noteId 参数，传给所有 `native.uploadResource` 和 `native.downloadRemoteResource` 调用 |
| 7 | `src/features/editor/lakeRuntime.ts` | ① `createLakeDocument` 的 `_noteId` 参数改为必传，闭包传给 `uploadLakeResource`；② **`isCaptureImageURL` 必须排除本地 URL**：`(url) => !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("http://127.0.0.1:19876/")` |
| 8 | `src/features/editor/clipboardHtml.ts` | `LOCAL_ASSET_PREFIX` 不变（仍是 `http://127.0.0.1:19876/`），但 `normalizeImage` 中匹配逻辑不变（`startsWith` 检查前缀即可，URL 路径变长不影响） |

**不需要改的**：`EditorTab.tsx`、`LakeEditor.tsx`（copy handler 已适配）、`App.tsx`、`styles.css`、`MultiTabEditor.tsx`。

### 7.8 关键坑：isCaptureImageURL

`lakeRuntime.ts` 第 96 行：
```typescript
isCaptureImageURL: (url: string) => !url.startsWith("data:") && !url.startsWith("blob:"),
```

这个函数告诉 Lake "哪些 URL 需要重新下载并上传"。我们的 `http://127.0.0.1:19876/...` 会返回 `true`，导致 Lake 在每次 `setDocument` 时尝试重新下载本地图片再上传一遍——产生冗余文件，还可能触发竞态。

**必须改为**：
```typescript
isCaptureImageURL: (url: string) => !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("http://127.0.0.1:19876/"),
```

### 7.9 noteId 传递链路

```
lakeRuntime.ts createLakeDocument(element, mode, onChange, tocEnabled, noteId)
  ↓ 闭包捕获 noteId
  image: { createUploadPromise: (request) => uploadLakeResource(request, noteId) }
  file:  { createUploadPromise: (request) => uploadLakeResource(request, noteId) }
  ↓
resourceUpload.ts uploadLakeResource(request, noteId)
  ↓ 传给 native 调用
  native.uploadResource({ bytes, filename }, noteId)
  native.downloadRemoteResource(url, noteId)
  ↓
native.ts → preload.cjs → main.ts IPC handler
  ↓ 透传
store.uploadResource(input, noteId)
store.downloadRemoteResource(url, noteId)
```

**注意**：`EditorTab.tsx` 调用 `createLakeDocument` 时已经传了 `noteId`（第 44 行），`LakeEditor.tsx` 也传了。所以 `lakeRuntime.ts` 的 `_noteId` 参数已经有值，只是当前没使用。

### 7.10 实施顺序建议

1. **先合并 CSS 修复**：把 `feature/electron` 分支上的多 Tab 滚动 CSS 修复 cherry-pick 或手动合并到 `asset-server-poc`
2. **改 `assetServer.ts`**：URL 解析支持 `/{noteId}/{filename}` 两级路径
3. **改 `store.ts`**：`imageOutput` 改命名 + 目录；`uploadResource`/`downloadRemoteResource` 加 noteId；`deleteNote` 加清理；`saveNote` 加孤儿检测；新增 orphan 表和方法
4. **改 IPC 链路**：`main.ts` → `preload.cjs` → `native.ts` 透传 noteId
5. **改前端**：`resourceUpload.ts` 加 noteId 参数；`lakeRuntime.ts` 闭包传 noteId + 修 `isCaptureImageURL`
6. **改 `clipboardHtml.ts`**：确认 `LOCAL_ASSET_PREFIX` 匹配逻辑兼容新 URL 格式（应该不需要改，`startsWith` 检查前缀即可）
7. **清数据测试**：`mv workspace-default /tmp/...` 清一次数据，从头测试
8. **删除 debug 日志**：移除 `EditorTab.tsx` 和 `LakeEditor.tsx` 中的 `[copy-debug]` console.log

### 7.11 数据迁移

当前 POC 分支的测试数据用的是旧 URL 格式（`/{hash}.ext`），改完后会 404。**不需要写迁移脚本**，部署最终版时清一次数据即可：
```bash
mv ~/Library/Application\ Support/lake-notes-electron/workspace-default /tmp/lake-data-backup-$(date +%s)
```

---

## 八、CSS 架构说明

### 8.1 CSS 基准

`src/styles.css` 的基础是 **Tauri 版的 CSS 逐字节复制**，然后只加了以下 Electron 差异：

| 行号区域 | 改动 | 原因 |
|---------|------|------|
| `:root` | `--topbar-height: 38px`（Tauri 是 `0px`） | macOS 红绿灯按钮空间 |
| `.sidebar` | 加了 `padding-top: var(--topbar-height)` | 侧边栏顶部留空 |
| `.tab-bar` | 加了 `padding-top: var(--topbar-height)` + `-webkit-app-region: drag` + `position: sticky; top: 0; z-index: 200` | 拖拽区域 + Tab 按钮 `no-drag` + 粘顶 |
| `.ne-ui` | `z-index: 1` → `150` | 工具栏不被内容覆盖 |
| `.ne-toc-sidebar` | 加了 `bottom: 40px; overflow-y: auto` | 长大纲可滚动 |
| 文件末尾 | `.board-card-wrapper--editor` 边框样式 | 画板视觉边界 |

### 8.2 CSS 修改铁律

1. **绝不修改 `.multi-tab-editor` 的 `overflow`**——必须是 `visible`，否则 Lake 的浮动 overlay（表格工具栏、TOC 切换按钮）被裁剪
2. **绝不修改 `.tab-panels` 的 `overflow`**——必须是 `visible`，同上
3. **绝不加 `content-visibility: auto`**——会让浏览器跳过标题渲染，TOC 扫描不到
4. **绝不加 `contain: layout style paint` 到 `.ne-engine > *`**——同上，影响 TOC
5. **修改 CSS 前先对比 Tauri 版**：`diff lake-notes-tauri-poc/src/styles.css lake-notes-electron/src/styles.css`

---

## 九、关键文件索引

| 文件 | 说明 |
|------|------|
| `electron/main.ts` | Electron 主进程（窗口、IPC、asset server 启动） |
| `electron/assetServer.ts` | 本地 HTTP 图片服务器（端口 19876） |
| `electron/preload.cjs` | 预加载脚本（**原生 CJS，不走 Vite**） |
| `electron/store.ts` | Node.js 后端（SQLite + 文件系统） |
| `src/App.tsx` | 主应用组件 |
| `src/main.tsx` | React 入口 |
| `src/lib/native.ts` | 前端 IPC 封装（`window.lakeNative`） |
| `src/features/editor/lakeRuntime.ts` | Lake 编辑器创建/销毁 + BoardCard 注册 |
| `src/features/editor/BoardCard.tsx` | Drawnix 画板卡片 |
| `src/features/editor/EditorTab.tsx` | 多 Tab 单编辑器 |
| `src/features/editor/MultiTabEditor.tsx` | Tab 栏 + 容器 |
| `src/features/editor/resourceUpload.ts` | 图片/附件上传管道 |
| `src/features/editor/clipboardHtml.ts` | 复制到微信的 HTML 清洗 + 本地图片转 base64 |
| `src/styles.css` | 全局样式 |
| `src/vendor/drawnix*.css` | Drawnix CSS（从 node_modules 复制） |
| `vite.config.ts` | Vite + vite-plugin-electron + Drawnix alias |

---

## 十、踩过的坑

### 10.1 npm 安装
- **必须用国内镜像**：用户没有 VPN
  ```bash
  export npm_config_registry=https://registry.npmmirror.com
  export npm_config_cache=/tmp/npm-cache-lake
  ```
- `better-sqlite3` 安装后必须用 `@electron/rebuild` 重编译，否则 ABI 不匹配（Node 24 = ABI 137，Electron 33 = ABI 130）

### 10.2 SQL INSERT 占位符
`electron/store.ts` 的 `migrate()` 和 `createNoteIn()` 方法中 INSERT 语句的 VALUES 占位符数量与列数不匹配。已修复，但如果重写 store.ts 要注意。

### 10.3 Preload 必须是 CJS
`vite-plugin-electron` **总是**把 preload 编译为 ESM（忽略 `format: "cjs"` 配置）。Electron 的 preload 脚本**必须是 CJS**。解决方案：手写 `electron/preload.cjs`，用 `require("electron")`，不经过 Vite 编译。`vite.config.ts` 中只保留 `electron/main.ts` 一个 entry。

### 10.4 `-webkit-app-region: drag` 吃点击事件
Electron 中 `-webkit-app-region: drag` 在**原生层**拦截所有鼠标事件，即使设了 `pointer-events: none` 也无效。之前用全局 `.titlebar-drag` 覆盖层导致 Tab 栏点击全部失效。正确做法：在 `.tab-bar` 上设 `drag`，在 `.tab-item` 上设 `no-drag`。

### 10.5 Drawnix CSS 导入
`lakex-drawnix-react-board` 和 `lakex-drawnix-react-text` 的 `package.json` 的 `exports` 字段**没有导出 CSS**。Vite 不允许导入未在 exports 中声明的文件。解决方案：把 CSS 复制到 `src/vendor/` 目录，从本地路径导入。

### 10.6 杀进程误杀 Trae CN
Trae CN（用户的 IDE）也是 Electron 应用，主进程二进制叫 `Electron`。`pkill -f "Electron"` 会把它一起杀掉。**永远用精确匹配**：
```bash
kill $(ps aux | grep "lake-notes-electron" | grep -v grep | awk '{print $2}')
```

### 10.7 性能优化破坏 TOC（最大教训）

以下 4 项优化**全部导致 TOC/大纲功能失效**，已全部回退：

| 优化 | 破坏原因 |
|------|---------|
| `content-visibility: auto` | 浏览器跳过标题元素渲染，TOC 扫描器找不到标题 |
| `virtualRendering: true` | Lake 跳过离屏标题的 DOM 渲染，TOC 为空 |
| Tab 离屏销毁（`return null`） | 编辑器实例被销毁重建，TOC 状态丢失 |
| MutationObserver 懒加载 | 干扰 Lake 内部 DOM 变更检测 |

**教训**：Lake 编辑器的 TOC 依赖完整的 DOM 树扫描。任何跳过/延迟/销毁 DOM 元素的优化都会破坏 TOC。做性能优化时**必须先验证 TOC 是否正常**。

### 10.8 overflow 修改破坏 Lake 浮动 UI

| 修改 | 后果 |
|------|------|
| `.multi-tab-editor { overflow: hidden }` | 裁剪 Lake 表格工具栏 + TOC 切换按钮 |
| `.tab-panels { overflow: hidden }` | 同上 |
| `.document-pane:has(...) { overflow: clip }` | 禁止所有滚动 |
| `.document-pane:has(...) { overflow: hidden }` | 禁止文档滚动 |

**正确方案**：不修改任何 overflow，用 `position: sticky` 让 tab-bar 粘在滚动容器顶部。

### 10.9 Vite 缓存
改了 `node_modules` 中的文件或 CSS 导入路径后，Vite 可能用旧的预打包缓存。清理方式：
```bash
mv node_modules/.vite /tmp/vite-cache-old
```

### 10.10 React StrictMode
`useEffect` 执行两次，`setOpenTabs` 回调中必须用 `tabs.some(t => t.noteId === id)` 去重。

### 10.11 DefaultEditorConfig 必须递归深合并
一层合并会丢失嵌套配置（如 `slash.cardSelect.recordSelectedItemConfig`）。`lakeRuntime.ts` 中的 `deepMerge` 是递归实现。

### 10.12 同步 XHR 不支持 responseType="arraybuffer"
Chromium 中同步 XHR 设置 `responseType = "arraybuffer"` 会静默失败。`overrideMimeType("text/plain; charset=x-user-defined")` 在 Chromium 中也不能正确保留原始字节（`btoa` 会报 `InvalidCharacterError`）。

**解决方案**：让服务器直接返回 base64 文本（`?base64=1` 参数），客户端零转换，直接 `return xhr.responseText`。

### 10.13 navigator.clipboard.write() 对 macOS 原生应用无效
`navigator.clipboard.write()` 写入的剪贴板格式，macOS 原生应用（如微信）读不到 `text/html`。必须用 `event.clipboardData.setData()` 同步写入。这意味着图片转换必须在 copy handler 中同步完成，所以用了同步 XHR。

### 10.14 Lake 编辑器 copy handler 优先级
Lake 编辑器内部注册了自己的 copy handler，可能调用 `stopPropagation()`。我们的 handler 必须用**捕获阶段**（`addEventListener("copy", handler, true)`）+ `stopImmediatePropagation()` 来确保先执行。

### 10.15 复制到微信的空行问题
Lake 编辑器在图片前后放空段落（用于光标定位），包含零宽空格（`\u200B` 等）和 `<span><br></span>`。微信会把这些渲染成空行。

**解决方案**：在 `normalizeClipboardHtml` 末尾用正则清理：
1. 去除零宽字符
2. 删除只含 `<br>` 或空的 `<span>`
3. 删除空的 `<p>`/`<div>`

### 10.16 isCaptureImageURL 会导致本地图片被重复下载
`lakeRuntime.ts` 的 `isCaptureImageURL` 如果不排除本地 URL，Lake 会在每次 `setDocument` 时尝试重新下载 `http://127.0.0.1:19876/...` 的图片并重新上传，产生冗余文件。**必须排除**。

### 10.17 Tauri 版自定义协议闪退
Tauri 版曾尝试用自定义协议（类似 `lake-asset://`）加载本地图片，但 WKWebView 对自定义协议支持有坑导致窗口闪退。这是当初不做资源归一化的原因。Electron 没有这个问题，所以 POC 验证了 HTTP 方案。

---


### 10.18 粘贴图片失败的三个坑（2026-08-01 排查记录）

**现象**：从知乎复制内容粘贴，未加载的图片显示空白。排查后确认是三个叠加问题，已全部修复。

**① 知乎懒加载占位图**
- 复制时图片未加载完成，剪贴板 HTML 里 `img.src` 是空白 SVG data URL（`data:image/svg+xml;utf8,<svg width='1080' height='1600'></svg>`）
- 但**每张占位图都带 `data-original` / `data-actualsrc` 真实 URL**（实测剪贴板 23/23 张都有）
- 修复：`clipboardHtml.ts` 的 `upgradePastedHtml()` 检测空 SVG → 用 `data-actualsrc`/`data-original`/`srcset` 替换 src

**② 原生 paste 事件的 clipboardData 是只读的**
- 在 paste 事件里 `clipboardData.setData("text/html", ...)` **无效**（合成事件可写，骗过了测试；真实 Cmd+V 是只读）
- 修复：`installPasteInterceptor()`（`main.tsx` 全局调用）在 **document 捕获阶段 patch `clipboardData.getData("text/html")`**，返回升级后的 HTML——Lake 读到就是处理过的内容
- 注意：必须在编辑器创建前安装（`main.tsx` 顶部）

**③ Node fetch 的 TLS 指纹被 CDN 识别（403）**
- 知乎等 CDN 做 **TLS 指纹检测**（JA3），标准 HTTP 客户端（curl/Go/Node undici）指纹与 Chrome 不同 → 403（且有时 200 有时 403，波动）
- 思源的做法：`createCustomTLSConfig()` 模拟 Chrome 的密码套件顺序和曲线优先级（`siyuan/kernel/util/tls.go`）
- Electron 更优解：主进程用 **`electronNet.fetch`**（`net` 模块，Chromium 网络栈 = 与 Chrome 相同指纹，无 CORS 限制，可带自定义 Referer/UA）
- 修复：`store.ts` 的 `downloadRemoteResource` 改用 `electronNet.fetch` + `Referer=图片URL自身`（Rust 版技巧）+ 浏览器 UA + 3 次重试 + SSRF 防护（拒绝 localhost/私网）+ 流式限量读取

**验证**：用 `webContents.paste()`（等效真实 Cmd+V）走完整原生路径实测——设置知乎格式剪贴板 → 粘贴 → 空 SVG 替换 → 下载 → 本地落盘 ✅。修复后用户重贴新文档 85 张图全部本地化、0 空 SVG。

**教训**：不要用合成事件（`dispatchEvent`）验证剪贴板相关逻辑——合成事件的 DataTransfer 可写，与真实行为不同。必须用真实粘贴路径（`webContents.paste()` + 系统剪贴板）验证。

### 10.19 复制到微信：webp 图片不显示（2026-08-01 修复）

**现象**：第三方来源（URL 下载）的图片很多是 webp 格式，复制到微信图文混排时图片不显示；本地上传（粘贴）的图片正常。

**根因**：
- 本地上传走 `uploadWithWebpConversion` → 存 **PNG** → 复制时 `data:image/png` → 微信 OK
- 第三方下载（`downloadRemoteResource`）**原格式存储（.webp）** → 复制时同步 XHR 拿到 `data:image/webp;base64,...` → **macOS 原生应用（微信）不渲染 webp**

**方案**：存储保持 webp（体积小），**复制时在 asset server 的 `?base64=1` 端点统一转 PNG**（覆盖新旧数据）：
- 先试 `nativeImage.createFromBuffer` —— **Electron 的 nativeImage 不支持 WebP 解码**（实测 isEmpty）❌
- 改用 **sharp**（libvips）：`sharp(buf).png().toBuffer()` ✅
- `electron/assetServer.ts`：`?base64=1` 端点对 `.webp`/`.avif` 转 png；handler 改 async
- `vite.config.ts`：`rollupOptions.external` 加 `sharp`（原生模块，同 better-sqlite3）

**注意**：sharp 是新增原生依赖（`npm install sharp`）。electron-builder 打包时需确保包含。

**验证**：CDP 模拟复制 webp 图 → 剪贴板 HTML 为 `data:image/png;base64,...` ✅；png/jpg 不受影响 ✅
### 10.21 资源本地化：Lake 编辑器 CDN 依赖全量本地镜像（2026-08-01）

**现状**：`lakex-editor-react-component@0.1.2`（ESM，无 window.Doc）已是最新，但其运行时仍会从 `gw.alipayobjects.com` CDN 加载 35 个资源（codemirror 7.1.27/7.1.3、katex 0.16.8 + mhchem、25 个 UI 图标 SVG、hitu 插图）。

**本地化方案**（3 层）：
1. **本地镜像**：35 个 CDN 文件已下载到 `public/vendor/cdn/`（保留原路径结构，Vite 构建时自动进 dist）。`katex.min.js`/`codemirror.js`(7.1.27) 与 CDN 版本 sha256 逐字节一致。
2. **主进程重定向**：`electron/main.ts` 的 `registerCdnRedirect()` 用 `session.webRequest.onBeforeRequest` 把所有 `*://gw.alipayobjects.com/*` 请求重定向到 `http://127.0.0.1:19876/vendor/cdn/<path>`（asset server 新增 `/vendor/cdn/` 静态路由 + 无扩展名 MIME 嗅探 + CORS）。验证：打包版里 5 类 URL（svg/png/双编码中文名/7.1.3 codemirror/mhchem）全部 200。
3. **相对路径**：`index.html` 的 `<script src="./vendor/...">` 和 `window.KITCHEN_URL`、`lakeRuntime.ts` 的 `codeblock.codemirrorURL`/`math.KaTexURL` 全部改为 `./vendor/...`（打包版 file:// 下绝对路径 `/vendor/...` 会指向系统根目录而失效）。

**注意**：
- 重定向 handler 不要 decodeURIComponent，asset server 统一 decode 一次即可（hitu 文件名是双编码 `%25E5...`，两次 decode 会 404）。
- math 的 `KaTexURL` 传数组（katex + mhchem），插件对 string/array 都兼容。

### 10.22 同步进度与结果 UI（2026-08-01）

- `electron/sync.ts`：`syncNow(store, onProgress?)` 新增 `SyncProgress` 事件（connect/download/upload/manifest/done，download/upload 带 current/total）。
- `electron/main.ts`：`sync_now` handler 通过 `event.sender.send("sync-progress", p)` 推送到渲染层；新增 `get_sync_status`（读 device_state 的 last_synced_at + last_sync_result）。
- `preload`/`native.ts`：`onSyncProgress(cb)` 订阅（返回退订函数）、`getSyncStatus()`。
- `SyncPanel.tsx`：进度条（百分比/indeterminate）+ 阶段文案 + 最近一次同步结果（上传/下载/冲突数、commit id）。
- 端到端验证（真实七牛 + 独立临时工作区）：首轮 connect→upload→manifest→done；次轮带 download，增量幂等（0 上传 0 下载）。

### 10.23 electron-builder 打包 dmg（2026-08-01）

**产物**：`release/Lake Notes-0.1.0-arm64.dmg`（158MB）+ zip + blockmap（未签名，默认 Electron 图标）。

**package.json build 配置**：
```json
"build": {
  "appId": "com.lakenotes.electron",
  "productName": "Lake Notes",
  "directories": { "output": "release" },
  "files": ["dist/**/*", "dist-electron/**/*", "electron/preload.cjs",
            "!**/*.map", "!node_modules/better-sqlite3/deps/**", "!node_modules/better-sqlite3/build/Release/obj/**"],
  "asarUnpack": ["electron/preload.cjs"],
  "mac": { "category": "public.app-category.productivity", "target": ["dmg", "zip"] }
}
```

**踩坑（按发生顺序）**：
1. **preload 必须纯 JS**：曾把 TS 类型注解（`: (progress: unknown) => void`）写进 `electron/preload.cjs` → 打包版/开发版都报 `SyntaxError: Unexpected token ':'`（makeContextifyScript）。preload.cjs 里绝不能出现 TS 语法。
2. **files 必须包含 electron/preload.cjs**：主进程用 `path.join(__dirname, "../electron/preload.cjs")` 引用，漏了就会「找不到 preload → lakeNative undefined → 页面空白」。
3. **最终根因确认**：上述两个 SyntaxError 其实都是 preload.cjs 里的 TS 语法导致的（第 1 条的语法错误会以 sandbox_bundle 或 makeContextifyScript 两种面目出现，曾误判为沙箱/asar 冲突）。防御性保留了 `webPreferences.sandbox: false`（contextIsolation 仍开启）+ `asarUnpack: ["electron/preload.cjs"]` + 打包版 preload 直接指向 `app.asar.unpacked/electron/preload.cjs`，实测可用；若后续想简化可尝试仅用 asar 内路径 + 默认沙箱。
4. **产物目录必须独立**：一开始输出目录用 `dist/`，导致上一轮的 dmg/zip/.app 被 `dist/**/*` 递归打进 asar（asar 膨胀到 1GB）。改 `directories.output: "release"`，并清掉 dist 里的旧产物。
5. **vite 8（rolldown）需要 Node ≥ 20.12**：系统 node 18 跑 `vite build` 报 `styleText` 缺失。用 nvm 的 v24：`PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" npm run dev`（dev 脚本同样受影响）。
6. **asar CLI extract-file 会剥离目录**：`asar extract-file app.asar dist/index.html` 会把产物写到当前目录的 `index.html`（不是 dist/），曾覆盖根 index.html，用 `git checkout -- index.html` 恢复。

**打包版冒烟验证**（CDP 9223 + 手写极简 ws 客户端）：lakeNative 23 个方法、真实笔记数据加载、CDN 重定向 5/5、getS3Settings/getSyncStatus 正常、控制台 0 报错。

## 十一、后续阶段（资源归一化落地之后）

1. ~~S3 备份同步~~ ✅ 已实现（commit c57a3a4 + 898e7b9）；真实七牛配置见 10.20
2. ~~electron-builder 打包 dmg~~ ✅ 已实现（见 10.23）；待办：应用图标（当前默认 Electron 图标）、代码签名/公证（当前未签名，首次打开需右键打开）
3. 应用图标、窗口标题栏美化
4. 测试文件迁移（5 个 `.test.ts`）
5. 孤儿资源 UI（在设置面板中展示 orphan_assets 列表 + 清理按钮）


1. S3 备份同步（`native.ts` 缺 4 个方法 + 后端逻辑）
2. `electron-builder` 打包（dmg for macOS）
3. 应用图标、窗口标题栏美化
4. 测试文件迁移（5 个 `.test.ts`）
5. 孤儿资源 UI（在设置面板中展示 orphan_assets 列表 + 清理按钮）

### 10.20 七牛云 S3 配置坑：UnknownError（2026-08-01）

**现象**：用户配置七牛云 S3 后测试连接报 `S3 连接失败: UnknownError`。

**根因（AWS SDK 实测确认）**：
- 报错根本不是网络问题，是 **Bucket 名不存在** → HeadBucket 404，七牛返回的 message 字面量就是 `UnknownError`，SDK name 为 `NotFound`。
- 用户填的 Bucket `local-lake` 不存在；其账号下实际空间（ListBuckets 确认）：`image-store-hebei`、`joplin-s3-hebei`、`local-image-lake`、`local-lake-hebei`、`siyuan-qiniu-hebei`。正确的是 **`local-lake-hebei`**。
- Region 必须是 **`cn-north-1`**（七牛华北-河北），不能填空间名。
- 用户填的 Endpoint `https://local-lake-hebei.s3.cn-north-1.qiniucs.com` 是**该 bucket 专用的虚拟主机地址**，和 path-style 组合会出问题：
  - 勾选 path-style → SDK 请求 `/local-lake-hebei/<key>` → 404
  - 不勾 path-style → SDK 拼出 `local-lake-hebei.local-lake-hebei.s3...` → TLS 证书不匹配
  - 正确做法：用**区域级 Endpoint** `https://s3.cn-north-1.qiniucs.com` + path-style

**验证通过的配置**（HeadBucket + Put + Get 实测成功）：
```
Endpoint:   https://s3.cn-north-1.qiniucs.com
Region:     cn-north-1
Bucket:     local-lake-hebei
Prefix:     lake-notes
Path-style: ✅ 勾选
```
- AK/SK 本身有效（ListBuckets 成功）。
- 结论：S3 兼容服务报 `UnknownError` 时，先怀疑 Bucket 名/Region 拼写，而不是网络。可先用 AWS SDK 跑 `ListBuckets` 确认账号下真实空间名。

## 十一、后续阶段（资源归一化落地之后）

1. ~~S3 备份同步~~ ✅ 已实现（commit c57a3a4 + 898e7b9）；真实七牛配置见 10.20
2. `electron-builder` 打包（dmg for macOS）
3. 应用图标、窗口标题栏美化
4. 测试文件迁移（5 个 `.test.ts`）
5. 孤儿资源 UI（在设置面板中展示 orphan_assets 列表 + 清理按钮）
