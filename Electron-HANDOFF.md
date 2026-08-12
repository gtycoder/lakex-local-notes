# Lake Notes Electron 会话交接文档

> 写给完全没有上下文的新会话。开始工作前请先通读本文，再查看 `git status`、`git log --oneline master..HEAD`、`docs/TODO.md`、`docs/HISTORY-DESIGN.md`、`docs/HISTORY-DESIGN-REVIEW.md`。
>
> 本文对应项目：`/Users/admin/file/local-lake/lake-notes-electron`

## 1. 当前快照

| 项目 | 当前信息 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| Git 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| 当前分支 | `fix/locked-viewer-text-cache`（含 7 个未合并提交，**未推 master**） |
| 未合并提交 | `212763a` 锁定缓存 / `f51379b` 回收站 / `b44e207`+`a923ce9`+`7982778` 历史设计 / `34797b3` 历史功能 / `fbef270` P0-1 / `6e70c97` 覆盖提醒 |
| 待办 | **历史功能已实现，但用户尚未实际测试**，需新会话做完整验收 + 修复 |
| 思源源码参考 | `/Users/admin/file/local-lake/siyuan`（历史/孤儿机制已调研） |
| Node | 必须优先使用 Node 24：`$HOME/.nvm/versions/node/v24.18.0/bin` |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`，禁止删除或清理 |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`，禁止触碰 |

### 绝对不能做的事情

- 不要执行 `git reset`、`git checkout -- .`、`git clean -fd` 等会丢弃工作区的命令（单文件恢复临时改动除外）。
- 不要覆盖或删除其他未提交修改；先看 `git status` 和 `git diff`。
- 不要修改 `node_modules`。
- 不要删除或直接修改开发/正式用户数据目录（SQLite 只允许只读查询）。
- 不要使用 `pkill -f Electron`；机器上还有 Trae、SiYuan、VS Code 等其他 Electron 应用（结束进程只能 kill 具体 PID）。
- 清理测试笔记必须走应用 UI 删除流程，不能直接改 SQLite，否则可能被 S3 同步恢复。
- **未验证的代码永远不推 master**：改动先切独立分支，验证通过（单测 + CDP）再合并/提交 master。

## 2. 当前分支未合并内容（需新会话验收）

### `212763a` 锁定态文本缓存修复
- 问题：锁定态（Viewer）无法用 Lake 内核 `getDocument` 生成 md/text 缓存，锁定且从未编辑的文档（含新设备同步下载）在全文搜索/复制 Markdown/导出资料包时正文不可见。
- 方案：`electron/lakeCaches.ts`（Lake HTML→md/plain 兜底转换）+ `store.ensureNoteCaches`（幂等"缺失才补"）+ importRemoteNote/rebuildSearchIndex/toggleNoteLock/handleEditorReady 四处兜底 + preload 补 `ensure_note_caches` IPC。
- 验证：单测 151 全绿、CDP 端到端通过。

### `f51379b` 软删除 + 本地回收站（不同步）
- `deleteTreeNode` 改软删除（标 `deleted_at` + 保留文件 + 记同步墓碑）；`listTrash`/`restoreTrashItem`/`purgeTrashItem`/`emptyTrash`；恢复=清墓碑+sync_state='local'（重新上传）；彻底删除=删文件+DB+墓碑保留。
- UI：活动栏回收站入口 + `TrashPanel.tsx` 毛玻璃弹层。
- 验证：单测 154 全绿、CDP 通过。

### `34797b3` 文档历史（快照）功能 ★核心
- `note_history` 表（refs_json/ref_count/单调 created_at）；`createHistorySnapshot`（gzip + 24h 防抖去重 + 恢复 force 写）；`restoreHistory`（恢复前留档 + 写回 + 缓存/FTS + 重置 sync_base）；`deleteHistory`/`cleanupHistory`（100 份/文档 + 30 天兜底，惰性）；`listNoteOrphans`/`cleanNoteOrphans`（实时解析，被历史引用保护）；`purgeTrashItem` 彻底删连历史一起删。
- `extractAssetRefs` 公共工具（复用 `referencedFilenames` 正则）。
- IPC 7 个新 channel + preload + native；UI `HistoryPanel.tsx` 两 tab（文档历史/文档孤儿文件）+ Sidebar 右键"历史版本"。
- 验证：单测 160 全绿、CDP 端到端通过（快照/恢复/搜索/孤儿/彻底删）。

### `fbef270` P0-1 恢复同步语义（用户既定方案）
- 用 `last_uploaded_hash` 判定"远端是否本机传的"：
  - 远端 == 本机最后上传 → 本地为准，上传覆盖（同端更新为主）
  - 远端 != 本机最后上传（他人改的）→ **接受远端**，本地入历史（远端赢）
- 不产生冲突副本（历史兜底取代）；`sync_base.last_uploaded_hash` 列 + `setLastUploadedHash`/`lastUploadedHash`。

### `6e70c97` 远端覆盖提醒
- 接受远端前**强制给本地留历史快照**（不丢）；`SyncResult.supersededNotes` 记录被覆盖文档；SyncPanel 同步后 alert 提醒"远端修改已覆盖本地，本地修改已存入历史"。

## 3. 当前问题 / 状态

- **历史功能已实现但用户未实际测试**（用户原话："我都没有测试，可能还有问题修改"）——**新会话首要任务：完整验收历史功能 + 修复发现的问题**。
- **工作区干净**（仅 `Electron-HANDOFF.md.bak-*` 备份未跟踪，可忽略/删除）。
- master 未动，7 个提交都在 `fix/locked-viewer-text-cache` 分支。

## 4. 关键架构（新会话必须理解）

### 4.1 进程结构

```
Electron 主进程 (electron/main.ts)
├── Store (electron/store.ts)：Lake 正式笔记 better-sqlite3 + 文件系统
│     ├── 含历史（note_history/history/ 目录）、回收站（deleted_at/墓碑）、孤儿（orphan_assets）
│     └── sync_base（content_hash 基线 + last_uploaded_hash）
├── QuickNotesStore (electron/quickNotes.ts)：小记专属（独立）
├── assetServer (electron/assetServer.ts)：本地图片服务器 :19876
├── sync (electron/sync.ts)：Lake Manifest v2 S3 同步（P0-1 last_uploaded_hash 冲突判定）
└── IPC：Lake CRUD/tree/资源/S3/历史
Preload (electron/preload.cjs)：contextBridge 暴露 window.lakeNative
└── 渲染进程 (React + Lake 编辑器)
```

### 4.2 关键文件

| 文件 | 说明 |
|---|---|
| `electron/store.ts` | Lake 后端：notes/tree_nodes/orphan_assets/deleted_notes/sync_base/**note_history**；历史/回收站/孤儿核心逻辑 |
| `electron/sync.ts` | S3 同步（内容寻址、last_uploaded_hash 冲突判定、supersededNotes 提醒） |
| `electron/lakeCaches.ts` | Lake 正文→md/plain 兜底转换 |
| `electron/preload.cjs` | 原生 CJS 桥（IPC 三处之一） |
| `electron/main.ts` | IPC 注册 |
| `src/App.tsx` | 主应用（活动栏回收站入口、历史面板状态） |
| `src/components/Sidebar.tsx` | 树渲染、文档右键（历史版本入口） |
| `src/components/HistoryPanel.tsx` | 历史面板两 tab（文档历史/文档孤儿文件） |
| `src/components/TrashPanel.tsx` | 回收站弹层 |
| `src/components/SyncPanel.tsx` | 同步面板（含 supersededNotes 提醒） |
| `src/lib/native.ts` | 前端 IPC 封装（IPC 三处之二） |
| `src/lib/types.ts` | 共享类型（SyncResult.supersededNotes） |
| `docs/HISTORY-DESIGN.md` | 历史功能设计（定稿 v2+评审修复） |
| `docs/HISTORY-DESIGN-REVIEW.md` | 评审意见（P0-1/P0-2/P0-3 + P1×7 + P2×6） |

### 4.3 资源管理（历史/孤儿关键）

- 资源存 `note-assets/{noteId}/{filename}`（`{13位时间戳}_{8位随机}.{ext}`，全局唯一）。
- `extractAssetRefs`（`store.ts` 顶部公共函数）：正则 `\d{13}_[0-9a-f]{8}\.(?:png|jpg|jpeg|gif|webp|avif)` 从正文提取引用。
- `orphan_assets` 表：未被正文引用的资源；`detectOrphans` 保存时对账；`cleanOrphanAssets` 全局清理（SyncPanel）。
- `listNoteOrphans`/`cleanNoteOrphans`：文档级，实时解析（当前正文 + 历史 refs），被历史引用保护。

### 4.4 历史功能核心设计（速览）

- 快照：定期 15 分钟（只快照"15 分钟内保存过"的文档）+ 删除/冲突前 + 手动。
- 存储：`history/{noteId}/{ts}-{hash}.lake.gz` + `note_history` 表（refs_json/ref_count）。
- 保留：100 份/文档 + 30 天兜底，惰性清理。
- 资源：不复制，refs_json 记录引用；删历史后重算孤儿。
- 恢复：重置 sync_base（P0-1）；恢复前强制留档。
- 同步：历史纯本地；远端覆盖本地时强制留档 + supersededNotes 提醒。

## 5. 下一步计划（新会话）

1. **验收历史功能**（首要）：用户尚未测试。按 `docs/HISTORY-DESIGN.md` §12 测试要点 + 真实 UI 操作：
   - 创建文档 → 编辑 → 15 分钟/手动快照 → 历史列表 → 预览/恢复 → 孤儿清理 → 彻底删除
   - 锁定/只读/编辑切换边界（不产生垃圾快照）
   - 恢复后搜索/导出/同步状态
2. **验收 P0-1**：`last_uploaded_hash` 冲突判定（单测已覆盖 2 场景，需真实同步验证——可配测试 S3 或 mock）。
3. **验收回收站 + 锁定缓存**：确认无回归。
4. **常规回归**：导出三格式、全文搜索（含 2 字）、图标、tab、侧栏/大纲、锁定切换。
5. **后续待办**（docs/TODO.md）：
   - Word/PDF 导出（`electron/export.ts` 已收口）
   - 全文搜索 2 字以内回退
   - **M5 流畅性优化**（用户强调重点工作：TreeRow memo、树虚拟化、保存 debounce、图片懒加载）
6. **分支合并**：验收通过后，与用户确认合并 `fix/locked-viewer-text-cache` → master。

## 6. 踩过的坑（务必记住）

### 本会话新增

1. **CDP 调试 Electron**：`./node_modules/.bin/electron --remote-debugging-port=9333 .`（参数必须在 `.` 前）；单实例锁不能双开。
2. **vite.config.ts 临时补丁**：CDP 调试时加 `onstart: () => {}` 禁自动拉起，**验证后必须还原**（当前已还原）。
3. **vite dev server 会被 exec 会话回收**：用长驻 tty（`exec_command` tty=true）；nohup 后台 Electron 会被 macOS 回收（必须前台 tty）。
4. **CDP 截图超时**：窗口未激活时 `Page.captureScreenshot` 挂起 → 先 `Page.setWebLifecycleState` + focus emulation。
5. **Python 手写 WebSocket CDP 客户端有 bug**，用 **Node 原生 WebSocket**（Node 22+ 全局 `WebSocket`）写 CDP 脚本最稳（模板见 §8）。
6. **preload 桥漏方法**：`src/lib/native.ts` 声明了但 `electron/preload.cjs` 没暴露 → 运行时 `native.xxx is not a function`。**每加 IPC 方法要同步改 main.ts + preload.cjs + native.ts 三处**，用 channel 对比脚本校验。
7. **createPortal 括号闭合**：`createPortal(` 的 `, document.body)` 易漏，tsc 报 "Expected 2-3 arguments, but got 1"。
8. **window.confirm 类型**：项目里 `window.confirm` 类型要求 2-3 参数，用 `(window as any).confirm`。
9. **emptyTrash 重复删**：`listTrash()` 快照父子项都在，逐项 purge 会重复删 → 只 purge 顶级（无被删父节点的）。
10. **`.lake` 是扁平 HTML**（`<p><span data-lake-id>…</span></p>`，卡片 `<card value="data:JSON">`），无块级结构，无法结构化增量——历史用全量 gzip。
11. **gzip 解压性能无风险**：解压+解析 ~1.34ms/篇；全量 1000 文档×50 快照 ≈ 62ms。
12. **UNIQUE(note_id, content_hash) 会让恢复前留档被跳过**（P0-2）→ 去 UNIQUE，24h 防抖 + 恢复 force 写。
13. **created_at 单调**：同毫秒多条快照会撞/排序不稳定 → 若与上条同毫秒 +1ms。
14. **sync 测试 FakeStore 需补方法**：加 `setLastUploadedHash`/`lastUploadedHash`/`createHistorySnapshot` 到 mock。
15. **P0-1 曾误用保守 setBaseHash 方案**（因怕破坏冲突测试擅自降级）——**用户明确要 last_uploaded_hash 方案，最终已按既定方案修正**。教训：用户确认的方案不要擅自降级。

### 既有（保留，来自更早会话）

16. **保存时用 Lake 内核生成文本缓存，不要自研 .lake 解析器**（`getDocument` 性能极好）。
17. **Lake 导出 MD 保留 `<font>/<span>` 内联样式**，需 `cleanLakeMarkdown` 剥标签（跳过代码块）。
18. **html 图片正则贪婪陷阱**：用 `[^/"\s]+` 而非 `([^/]+)`。
19. **FTS5 trigram**：1-2 字查不到，需标题 LIKE 回退。
20. **flex column + 无 `flex:none` 子项压扁**：滚动容器 `flex:1 1 auto; min-height:0`，固定项 `flex:none`。
21. **macOS 关窗口 ≠ 退出应用**；排查"改动没生效"先确认进程全新。
22. **思源 pinned tab 的 X 是隐藏不是禁用**。
23. **icon 同步**：`tree_nodes.icon` 不在 notes 表，`listNotesForSync` 要 JOIN tree_nodes。
24. **React StrictMode 双挂载**：cleanup 不能把 host/mount 从 DOM 拔掉。
25. **大 chunk 警告不是失败**。

## 7. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run        # 161 个测试
node node_modules/vite/bin/vite.js build
git diff --check
```

启动开发版：`npm run dev`（vite 1421 + 自动拉起 Electron）。

CDP 调试（前台 tty；先加 `onstart: () => {}` 临时补丁，验证后还原）：

```bash
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421
./node_modules/.bin/electron --remote-debugging-port=9333 .
curl -s http://127.0.0.1:9333/json | python3 -c "import json,sys; print([t for t in json.load(sys.stdin) if t['type']=='page'][0]['webSocketDebuggerUrl'])"
```

Node CDP 脚本模板（存 /tmp/cdp.mjs，Node 22+ 全局 WebSocket）：

```js
const ws = new WebSocket(process.argv[2]);
let id = 0; const pending = new Map();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error("timeout " + method)); } }, 20000);
  });
}
ws.onopen = async () => {
  try {
    const r = await call("Runtime.evaluate", { expression: process.argv[3], returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result, null, 1));
  } catch (e) { console.log("ERR:", e.message); }
  ws.close(); process.exit(0);
};
ws.onerror = (e) => { console.log("WS error", e.message); process.exit(1); };
ws.onmessage = (ev) => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id).resolve(d); pending.delete(d.id); } };
```

IPC channel 对比：

```bash
grep -o 'invoke("[a-z_]*"' electron/preload.cjs | sed 's/invoke("//;s/"//' | sort > /tmp/p.txt
grep -o 'handle("[a-z_]*"' electron/main.ts | sed 's/handle("//;s/"//' | sort > /tmp/m.txt
comm -3 /tmp/p.txt /tmp/m.txt
```

只读检查开发库：

```bash
DB="/Users/admin/Library/Application Support/lake-notes-dev/workspace-default/metadata.sqlite3"
sqlite3 "$DB" "SELECT id, title, deleted_at FROM tree_nodes;"
sqlite3 "$DB" "SELECT note_id, created_at, size, ref_count FROM note_history ORDER BY created_at DESC LIMIT 20;"
```

## 8. 关键排查文件

```text
docs/HISTORY-DESIGN.md             # 历史功能完整设计（含评审修复）
docs/HISTORY-DESIGN-REVIEW.md      # 评审意见（P0/P1/P2）
electron/store.ts                  # 历史/回收站/孤儿/缓存核心
electron/sync.ts                   # S3 同步 + P0-1 冲突判定 + supersededNotes
electron/lakeCaches.ts             # Lake→md/plain 兜底
electron/preload.cjs               # IPC 桥
electron/main.ts                   # IPC 注册
src/components/HistoryPanel.tsx    # 历史面板（两 tab）
src/components/TrashPanel.tsx      # 回收站面板
src/components/SyncPanel.tsx       # 同步面板（superseded 提醒）
src/App.tsx                        # 主应用（活动栏回收站、历史状态）
src/lib/native.ts / types.ts       # IPC 封装 + 类型
docs/TODO.md                       # 待办
docs/ARCHITECTURE.md               # 架构总览
```
