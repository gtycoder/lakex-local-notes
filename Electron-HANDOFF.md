# Lake Notes Electron 会话交接文档

> 写给完全没有上下文的新会话。开始工作前请先通读本文，再查看 `git status`、`git log --oneline master..HEAD`、`docs/TODO.md` 和 `docs/HISTORY-DESIGN.md`。
>
> 本文对应项目：`/Users/admin/file/local-lake/lake-notes-electron`

## 1. 当前快照

| 项目 | 当前信息 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| Git 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| 当前分支 | `fix/locked-viewer-text-cache`（含 2 个未合并提交，**未推 master**） |
| 未合并提交 | `212763a`（锁定态缓存修复）、`f51379b`（软删除+本地回收站） |
| 下一步主线 | **文档历史（快照）功能**，设计已定稿 `docs/HISTORY-DESIGN.md`，**待实现** |
| 思源源码参考 | `/Users/admin/file/local-lake/siyuan`（历史/孤儿机制已调研，见设计文档） |
| Node | 必须优先使用 Node 24：`$HOME/.nvm/versions/node/v24.18.0/bin` |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`，禁止删除或清理 |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`，禁止触碰 |

### 绝对不能做的事情

- 不要执行 `git reset`、`git checkout -- .`、`git clean -fd` 等会丢弃工作区的命令（单文件恢复临时改动除外，如 `git diff` 确认后按文件恢复）。
- 不要覆盖或删除其他未提交修改；先看 `git status` 和 `git diff`。
- 不要修改 `node_modules`。
- 不要删除或直接修改开发/正式用户数据目录（SQLite 只允许只读查询）。
- 不要使用 `pkill -f Electron`；机器上还有 Trae、SiYuan、VS Code 等其他 Electron 应用（结束进程只能 kill 具体 PID）。
- 清理测试笔记必须走应用 UI 删除流程，不能直接改 SQLite，否则可能被 S3 同步恢复。
- **未验证的代码永远不推 master**：改动先切独立分支，验证通过（单测 + CDP）再合并/提交 master。

## 2. 当前分支未合并内容（待验证/待评审）

### `212763a` 锁定态文本缓存修复
- 问题：锁定态（Viewer）无法用 Lake 内核 `getDocument` 生成 md/text 缓存，锁定且从未编辑的文档（含新设备同步下载）在全文搜索/复制 Markdown/导出资料包时正文不可见。
- 方案（统一索引入口，幂等"缺失才补"）：
  - `electron/lakeCaches.ts`：Lake 正文(.lake HTML)→markdown/plain 兜底转换（段落/换行/链接/卡片文本保留，不执行卡片 JSON）
  - `store.ensureNoteCaches`：缓存缺失时从磁盘 .lake 生成；已有不覆盖
  - `importRemoteNote` 落位后、`rebuildSearchIndex`、`toggleNoteLock`、`handleEditorReady` 四处兜底
  - `electron/preload.cjs`：暴露 `ensure_note_caches` IPC（**曾漏，修了真实 bug**）
- 验证：单测 151 全绿、CDP 端到端通过（锁定+无缓存文档搜索正文命中且高亮）。

### `f51379b` 软删除 + 本地回收站（不同步）
- 方案：
  - `deleteTreeNode` 改软删除：标 `deleted_at` + 保留文件 + 记同步墓碑（远端不复活）
  - `listTrash` / `restoreTrashItem` / `purgeTrashItem` / `emptyTrash`
  - 恢复 = 清墓碑 + sync_state='local'（重新上传）；彻底删除 = 删文件 + DB，墓碑保留
  - IPC + preload + native 桥接；UI：活动栏回收站入口 + `TrashPanel.tsx` 毛玻璃弹层
- 验证：单测 154 全绿、CDP 端到端通过。

> **注意**：历史功能（下一步）依赖 `purgeTrashItem`，实现时要接"历史引用保护"（见设计文档 §10）。

## 3. 本轮任务目标（下一个会话的主线）

**实现文档历史（快照）功能**，完整规格见 `docs/HISTORY-DESIGN.md`（204 行，已定稿）。核心要点：

- 定期 15 分钟快照（只快照 dirty 文档）+ 删除/冲突前 + 手动
- 正文 .lake gzip 存 `history/{noteId}/{ts}-{hash}.lake.gz`，`note_history` 表 + hash 去重
- **不建资源账本表**，资源引用**实时解析**（复用 `referencedFilenames` 正则，~2.2ms/篇）
- 保留策略：15 天 + 每文档 50 份；自动清理时**历史未引用资源立即物理删**（方案 A，用户已确认）
- 孤儿文件 tab 的**顺序**：默认先展示历史快照 tab，删快照后**立即重算**孤儿列表（避免漏删）
- UI：文档右键"历史版本"→ HistoryPanel 两 tab（历史快照 / 文档孤儿文件）；全部清理放设置
- 同步：历史纯本地；恢复后 sync_state='local' 重新上传

实现顺序见设计文档 §13（10 步）。单测 + CDP 验证后再考虑合并。

## 4. 关键架构（保留，新会话必须理解）

### 4.1 进程结构

```
Electron 主进程 (electron/main.ts)
├── Store (electron/store.ts)：Lake 正式笔记 better-sqlite3 + 文件系统
├── QuickNotesStore (electron/quickNotes.ts)：小记专属（独立，历史不涉及）
├── assetServer (electron/assetServer.ts)：本地图片服务器 :19876
├── sync (electron/sync.ts)：Lake Manifest v2 S3 同步
└── IPC：Lake CRUD/tree/资源/S3
Preload (electron/preload.cjs)：contextBridge 暴露 window.lakeNative
└── 渲染进程 (React + Lake 编辑器)
```

### 4.2 关键文件

| 文件 | 说明 |
|---|---|
| `electron/store.ts` | Lake 后端：notes/tree_nodes/device_state/settings/orphan_assets/deleted_notes/sync_base + 文件；**历史功能主要改这里** |
| `electron/sync.ts` | S3 同步（内容寻址 `objects/{hash}.lake`，只上传最新版；孤儿跳过） |
| `electron/lakeCaches.ts` | Lake 正文→md/plain 兜底转换（上一会话新增） |
| `electron/preload.cjs` | 原生 CJS，暴露 lakeNative（IPC 桥） |
| `electron/main.ts` | IPC 注册、窗口、asset server |
| `src/App.tsx` | 主应用（多 Tab、侧边栏、状态胶囊、活动栏含回收站入口） |
| `src/components/Sidebar.tsx` | 树渲染、文档右键菜单（历史入口要加这里） |
| `src/components/TrashPanel.tsx` | 回收站毛玻璃弹层（**HistoryPanel 仿此写**） |
| `src/components/SearchPanel.tsx` | 搜索弹层（样式参考） |
| `src/lib/native.ts` | 前端 IPC 封装 + 类型 |
| `src/features/editor/lakeRuntime.ts` | Lake 编辑器创建（虚拟渲染/TOC/卡片水合） |
| `src/styles.css` | 全部 UI 样式（毛玻璃弹窗族 `.trash-panel` 等） |
| `docs/HISTORY-DESIGN.md` | **历史功能完整设计（下一会话的主文档）** |

### 4.3 资源管理（历史功能的关键依赖）

- 资源存 `note-assets/{noteId}/{filename}`（`{13位时间戳}_{8位随机}.{ext}`，文件名全局唯一）。
- `referencedFilenames(noteId, content)`（`store.ts:949`）：正则 `\d{13}_[0-9a-f]{8}\.(?:png|jpg|jpeg|gif|webp|avif)` 从正文提取引用。
- `orphan_assets` 表：未被正文引用的资源（`detectOrphans` 保存时对账；`cleanOrphanAssets` 清理）。
- 同步上传时跳过孤儿（`sync.ts` 的 `orphans` Set）。
- **历史功能要接这套机制**：被历史引用的资源不删（实时解析判定），自动清理时无引用物理删。

### 4.4 思源历史机制（已调研，供对照）

- 定时 10min + 操作触发，文件级快照到 `history/{ts}-{op}/`，30 天保留（`clearOutdatedHistoryDir`）。
- 清理未引用资源 = **先复制进历史（HistoryOpClean）再物理删**（`RemoveUnusedAssets`）。
- 我们的方案**更优**（资源不复制，实时解析引用），但保留了"历史未引用即删"语义。

## 5. 当前问题 / 状态

- **工作区**：`docs/HISTORY-DESIGN.md` 未提交（新文件）；分支 2 个提交未合并。
- **无未完成的中断工作**：上一会话的锁定缓存 + 回收站均已验证通过。
- **下一步**：按 `docs/HISTORY-DESIGN.md` §13 实现历史功能。
- **已知取舍**（用户已接受）：
  - 编辑器内纯文本 emoji 保持 Lake 原生（不做放大，会污染 .lake）。
  - 历史资源不复制 → 用户手动删 note-assets 文件（绕过应用）会导致回滚裂图（接受）。

## 6. 踩过的坑（务必记住）

### 本会话新增

1. **CDP 调试 Electron**：`./node_modules/.bin/electron --remote-debugging-port=9333 .`（参数必须在 `.` 前）；项目有单实例锁不能双开。
2. **vite.config.ts 临时补丁**：CDP 调试时给 electron 插件项加 `onstart: () => {}` 禁用自动拉起 Electron（会抢锁/无 CDP），**验证后必须恢复**。当前分支此补丁已还原（`git status` 应无 vite.config.ts 改动）。
3. **vite dev server 会被 exec 会话回收**：用长驻 tty 会话（`exec_command` tty=true）保持；nohup 后台启动 Electron 会被 macOS 回收（**必须前台 tty 启动**）。
4. **CDP 截图超时**：Electron 窗口未激活时 `Page.captureScreenshot` 会挂起 → 先 `Page.setWebLifecycleState{state:"active"}` + `Emulation.setFocusEmulationEnabled{enabled:true}`。
5. **Python 手写 WebSocket CDP 客户端有 bug**（帧解析/握手），**用 Node 原生 WebSocket**（Node 22+ 全局 `WebSocket`）写 CDP 脚本最稳。模板见 §8。
6. **preload 桥漏方法**：`src/lib/native.ts` 声明了 `ensureNoteCaches` 但 `electron/preload.cjs` 没暴露 → 运行时 `native.xxx is not a function`。**每加一个 IPC 方法，要同步改 main.ts + preload.cjs + native.ts 三处**，用 §8 的 channel 对比脚本校验。
7. **createPortal 括号闭合**：写弹层组件时 `createPortal(` 的 `, document.body)` 易漏，tsc 报"Expected 2-3 arguments, but got 1"。
8. **window.confirm 类型**：项目里 `window.confirm` 类型声明要求 2-3 参数，用 `(window as any).confirm` 绕过。
9. **emptyTrash 重复删**：`listTrash()` 快照里父子项都在，逐项 purge 会重复删已连带删除的子项 → 只 purge 顶级（无被删父节点的）。
10. **`.lake` 是扁平 HTML**（`<p><span data-lake-id>…</span></p>`，卡片 `<card name=... value="data:JSON">`），**无块级结构，无法做结构化增量**——历史用全量 gzip。

### 既有（保留，来自更早会话）

11. **保存时用 Lake 内核生成文本缓存，不要自研 .lake 解析器**（`getDocument` 性能极好）。
12. **Lake 导出 MD 会保留 `<font>/<span>` 内联样式**，需 `cleanLakeMarkdown` 剥标签（跳过代码块）。
13. **html 图片正则捕获组贪婪陷阱**：用 `[^/"\s]+` 而非 `([^/]+)`。
14. **FTS5 trigram**：1-2 字查不到，需标题 LIKE 回退；MATCH 查询串逐词加引号转义。
15. **flex column + 无 `flex:none` 会把子项压扁**：滚动容器要 `flex:1 1 auto; min-height:0`，固定项 `flex:none`。
16. **macOS 关窗口 ≠ 退出应用**（隐藏 Dock）；排查"改动没生效"先确认进程全新（`ps aux | grep "Electron \."`）。
17. **思源 pinned tab 的 X 是隐藏不是禁用**；关闭全部跳过 pinned，右键"关闭"可直接关。
18. **icon 同步**：`tree_nodes.icon` 不在 notes 表，`listNotesForSync` 要 JOIN tree_nodes；manifest 加可选字段不升版本。
19. **Lake emoji 资源提取**：`src/lib/lakeEmojis.ts`/`lakeEmojiGroups.ts` 自动生成，勿手改。
20. **React StrictMode 双挂载**：cleanup 不能把 host/mount 从 DOM 拔掉。
21. **大 chunk 警告不是失败**；"关闭再打开后恢复"不等于已解决（水合路径要验证）。

## 7. 下一步计划

1. **实现文档历史**（主线）：按 `docs/HISTORY-DESIGN.md` §13 顺序：
   - `note_history` 表 + 迁移 → `extractAssetRefs` 公共工具 → 快照 CRUD → 保留策略/自动清理 → 孤儿列表/清理 → `purgeTrashItem` 接历史保护 → IPC/preload/native → HistoryPanel UI → 单测 + CDP
2. **常规回归**（动代码前/后）：导出三种格式、全文搜索（含 2 字）、图标设置/同步、tab 钉住/拖拽调宽、侧边栏/大纲折叠悬浮、锁定切换、回收站恢复/彻底删除。
3. **待办（docs/TODO.md）**：
   - Word / PDF 导出（`electron/export.ts` 已收口，PDF 可走 `printToPDF`）
   - 全文搜索 2 字以内回退（trigram 最小 3 字符，需 LIKE 回退）
   - **M5 借鉴与流畅性**（模板/日记挑 1-2 项；TreeRow memo、树虚拟化、保存 debounce、图片懒加载）——用户强调流畅性优化是重点工作。
4. 未合并分支（`fix/locked-viewer-text-cache`）**待评审**：锁定缓存 + 回收站，验证充分后可考虑合并 master（先用户确认）。

## 8. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run        # 154 个测试
node node_modules/vite/bin/vite.js build
git diff --check
```

启动开发版（vite dev 自动拉起 Electron）：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev              # vite 1421 + vite-plugin-electron 自动拉起 dev Electron
```

CDP 调试启动（**必须前台 tty**；先在 vite.config.ts 加 `onstart: () => {}` 临时补丁禁自动拉起，验证后还原）：

```bash
# 终端 1（tty 长驻）：临时补丁后
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421
# 终端 2（tty 长驻）：
./node_modules/.bin/electron --remote-debugging-port=9333 .
# 然后：
curl -s http://127.0.0.1:9333/json | python3 -c "import json,sys; print([t for t in json.load(sys.stdin) if t['type']=='page'][0]['webSocketDebuggerUrl'])"
```

Node CDP 脚本模板（最稳，Node 22+ 全局 WebSocket，存 /tmp/cdp.mjs）：

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

用法：`node /tmp/cdp.mjs "ws://127.0.0.1:9333/devtools/page/XXXX" '(() => ({ ready: !!window.lakeNative, title: document.title }))()'`

IPC channel 对比（加方法后校验 preload/main 一致）：

```bash
grep -o 'invoke("[a-z_]*"' electron/preload.cjs | sed 's/invoke("//;s/"//' | sort > /tmp/p.txt
grep -o 'handle("[a-z_]*"' electron/main.ts | sed 's/handle("//;s/"//' | sort > /tmp/m.txt
comm -3 /tmp/p.txt /tmp/m.txt
```

只读检查开发库：

```bash
DB="/Users/admin/Library/Application Support/lake-notes-dev/workspace-default/metadata.sqlite3"
sqlite3 "$DB" "SELECT id, title, parent_id, node_type, icon FROM tree_nodes WHERE deleted_at IS NULL;"
```

## 9. 关键排查文件

```text
docs/HISTORY-DESIGN.md             # ★ 历史功能完整设计（下一会话主文档）
electron/store.ts                  # Lake 后端（历史/孤儿/回收站/缓存主要改这里）
electron/lakeCaches.ts             # Lake 正文→md/plain 兜底（上一会话新增）
electron/main.ts                   # IPC 注册
electron/preload.cjs               # 原生 CJS 桥（IPC 三处之一）
electron/sync.ts                   # S3 同步（孤儿跳过、内容寻址）
src/App.tsx                        # 主应用（活动栏回收站入口、状态胶囊）
src/components/Sidebar.tsx         # 树渲染、文档右键（历史入口加这里）
src/components/TrashPanel.tsx      # 回收站弹层（HistoryPanel 仿此）
src/components/SearchPanel.tsx     # 搜索弹层（样式参考）
src/styles.css                     # 全部 UI 样式（毛玻璃弹窗族）
src/lib/native.ts                  # 前端 IPC 封装（IPC 三处之二）
docs/TODO.md                       # 待办
docs/ARCHITECTURE.md               # 架构总览
```
