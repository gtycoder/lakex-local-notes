# Lake Notes Electron 会话交接文档

> 写给完全没有上下文的新会话。开始工作前请先通读本文，再查看 `git status`、`git log --oneline master..HEAD`、`docs/TODO.md`、`docs/HISTORY-DESIGN.md`、`docs/HISTORY-DESIGN-REVIEW.md`。
>
> 本文对应项目：`/Users/admin/file/local-lake/lake-notes-electron`

## 0. 任务目标（长期主线）

**Lake Notes 是一个本地优先的笔记应用（Electron + React + better-sqlite3 + 语雀 Lake 编辑器内核），带 S3 同步。** 当前开发主线是"数据安全"三件套：**回收站（已完成）→ 文档历史/快照（已完成）→ S3 删除/垃圾回收（下一步，未完成）**。

> **重要：S3 删除（GC）是这个开发阶段的收尾。用户明确说"完全做完 S3 删除才能彻底结束这个开发"。** 这是下一个会话的核心任务，详见 §3。

---

## 1. 当前快照

| 项目 | 当前信息 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| Git 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| 当前分支 | `fix/locked-viewer-text-cache`（含 12 个未合并提交，**未推 master，不要合并 master**） |
| 分支提交 | `212763a` 锁定缓存 / `f51379b` 回收站 / `b44e207`+`a923ce9`+`7982778` 历史设计 / `34797b3` 历史功能 / `fbef270` P0-1 / `6e70c97` 覆盖提醒 / `2596362` 交接 / `b1a53a9` 历史增强 / `9ee90dd` 画板修复 |
| 工作区 | 干净（仅 `Electron-HANDOFF.md.bak-*` 备份未跟踪，可忽略/删除） |
| Node | 必须优先使用 Node 24：`$HOME/.nvm/versions/node/v24.18.0/bin`（否则 vitest 报 `styleText` 错误） |
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

---

## 2. 已完成内容（分支上，均已验证）

### 2.1 历史功能全家桶（本次会话核心成果）

| 提交 | 内容 |
| --- | --- |
| `34797b3` | **文档历史（快照）核心**：`note_history` 表（refs_json/ref_count/单调 created_at）、`createHistorySnapshot`（gzip + 24h 防抖去重 + 恢复 force 写）、`restoreHistory`（恢复前留档 + 写回 + 缓存/FTS + 重置 sync_base）、`deleteHistory`/`cleanupHistory`（100 份/30 天，惰性）、`listNoteOrphans`/`cleanNoteOrphans`（实时解析，历史引用保护）、`purgeTrashItem` 彻底删连历史一起删；`extractAssetRefs` 公共工具；7 个 IPC + HistoryPanel 两 tab + Sidebar 右键"历史版本" |
| `fbef270` | **P0-1 恢复同步语义**：`last_uploaded_hash` 判定"远端是否本机传的"——本机传→本地为准上传；他人改→接受远端+本地入历史（不产生冲突副本） |
| `6e70c97` | **远端覆盖提醒**：接受远端前强制留快照；`supersededNotes` → SyncPanel alert |
| `b1a53a9` | **历史增强**（本会话）：U1 15 分钟自动快照（saveNote 记 dirty + 主进程定时器，间隔可配置）；P1 恢复后 reloadKey 强制重建 tab；P2 detectOrphans 并入历史 refs（被历史引用资源不算孤儿）；P5 保留策略可配置（maxSnapshots/retentionDays/cleanupIntervalHours/snapshotIntervalMinutes 存 settings）；U6 设置面板历史区域（统计/清理/配置）；快照预览 + 孤儿预览（2 个新 IPC）；U5 锁定文档允许恢复+保持锁 |
| `9ee90dd` | **画板视口修复**：Drawnix onChange 不再持久化 viewport，纯平移/缩放画布不再触发保存/快照（详见 §6 坑 26） |

### 2.2 更早的已合并验证内容（同分支）

- `212763a` 锁定态文本缓存（锁定/新同步文档也能搜索/导出）
- `f51379b` 软删除 + 本地回收站（deleteTreeNode 标 deleted_at + 墓碑；listTrash/restore/purge/empty）

### 2.3 验证状态

- **单测 168 全绿**（`npm test -- --run`）
- **tsc / vite build 通过**
- **CDP 端到端**：快照/恢复/孤儿保护/保留策略/设置面板/预览/恢复后 tab 刷新/画板视口修复，全部实测通过

---

## 3. 当前问题 / 状态

### ★ 核心待办：S3 删除（垃圾回收）—— 未做，用户要求必须完成

**现状**：S3 **只增不删**（内容寻址 + 墓碑设计）。
- `ObjectStore` 只有 `get`/`put`，**没有 delete/DeleteObject**。
- 删除文档/删正文图片后，远端 `objects/{hash}.lake`、`assets/{id}/{filename}` **永远保留**（manifest 不再引用，但对象不删）。
- 存储随使用无限累积。已记入 `docs/TODO.md`（P3 条目）。

**用户意图**：需要 S3 垃圾回收——对比 manifest 引用，删除无引用的 objects/assets。**这是大工程**，需谨慎处理：
- 多设备离线（删除方清空后，离线设备可能还在用旧对象）
- 墓碑（deleted 标记不能丢）
- 并发（GC 与上传竞争）
- 建议单独设计评审后实施（可参考 `docs/HISTORY-DESIGN.md` 的资源引用思路）

**设计参考**：用户认可的方向是"对比 manifest 引用删无引用对象"，但具体方案未定稿，需要新会话设计 + 与用户确认。

### 其他已知问题（非阻塞）

- **旧格式画板卡片不可编辑**：333/777 等旧文档的 board-card 是 `customBlock`+`customName="board-card"` 格式，编辑态被渲染成 **viewer（readonly）**，无法编辑。新格式 `name="board-card"` 正常。**未修复**（用户未要求，但可能影响旧数据）。
- **同步未做跨设备实测**：P0-1 逻辑单测覆盖，但真实双设备 S3 验证等"手机端"或"S3 GC 一起做"。
- **Word/PDF 导出**：`electron/export.ts` 已收口但 docx/pdf 未实现。
- **全文搜索 2 字以内回退**：trigram 最小 3 字符，两字词需 LIKE 回退。

---

## 4. 关键架构（新会话必须理解）

### 4.1 进程结构

```
Electron 主进程 (electron/main.ts)
├── Store (electron/store.ts)：Lake 正式笔记 better-sqlite3 + 文件系统
│     ├── 历史（note_history/history/ 目录 + 保留策略配置）
│     ├── 回收站（deleted_at/墓碑）、孤儿（orphan_assets）
│     └── sync_base（content_hash 基线 + last_uploaded_hash 私有标记）
├── QuickNotesStore (electron/quickNotes.ts)：小记专属（独立）
├── assetServer (electron/assetServer.ts)：本地图片服务器 :19876
├── sync (electron/sync.ts)：Lake Manifest S3 同步（P0-1 last_uploaded_hash 冲突判定）
└── IPC：Lake CRUD/tree/资源/S3/历史
Preload (electron/preload.cjs)：contextBridge 暴露 window.lakeNative
└── 渲染进程 (React + Lake 编辑器 + Drawnix 画板)
```

### 4.2 关键文件

| 文件 | 说明 |
| --- | --- |
| `electron/store.ts` | Lake 后端核心：notes/tree_nodes/orphan_assets/deleted_notes/sync_base/**note_history**；历史/回收站/孤儿/保留策略逻辑 |
| `electron/sync.ts` | S3 同步（内容寻址、last_uploaded_hash 冲突判定、supersededNotes）—— **S3 GC 主要改这里** |
| `electron/main.ts` | IPC 注册 + 15 分钟自动快照定时器 + 24h 清理巡检 + 启动兜底清理 |
| `electron/preload.cjs` / `src/lib/native.ts` | IPC 桥（三处同步：main/preload/native，加方法必须三处都改） |
| `src/components/HistoryPanel.tsx` | 历史面板两 tab + 快照/孤儿预览弹层 |
| `src/components/SettingsPanel.tsx` | 设置面板（含历史区域：统计/清理/配置） |
| `src/components/TrashPanel.tsx` / `SyncPanel.tsx` | 回收站 / 同步面板（superseded 提醒） |
| `src/features/editor/BoardCard.tsx` | Drawnix 画板卡片（视口修复在此） |
| `src/features/editor/EditorTab.tsx` | 编辑器 tab（contentchange → 保存链路、setting 屏蔽、reloadKey 重建） |
| `docs/HISTORY-DESIGN.md` / `HISTORY-DESIGN-REVIEW.md` | 历史功能设计 + 评审 |
| `docs/TODO.md` | 待办（含 P3 S3 GC 条目） |

### 4.3 同步冲突判定（P0-1，必须理解）

两个基线变量（都在本地 `sync_base` 表，**绝不进 manifest**）：
- `baseHash`：本机最后一次同步对齐点
- `lastUploadedHash`：本机最后一次成功上传的 hash（仅本机上传时更新，**纯本地私有**）

判定（syncNow 下载阶段）：
| 分支 | 条件 | 行为 | 留快照 | 提醒 |
| --- | --- | --- | --- | --- |
| ① 正文一致 | localHash==rn.contentHash | 合并锁 | 否 | 否 |
| ② 本机传的 | uploadedByUs | 本地为准上传覆盖 | 否 | 否 |
| ③ 真冲突 | !uploadedByUs && localChanged | 留快照→接受远端 | **是** | **是** |
| ④ 远端更新无本地改动 | !uploadedByUs && !localChanged | 下载覆盖 | 否 | 否 |

**硬性约束：`last_uploaded_hash` 绝不能写进 manifest / 上传 S3**（否则其他设备误判"远端是本机传的"→ P0-1 失效）。

### 4.4 资源管理（历史/孤儿关键）

- 资源存 `note-assets/{noteId}/{filename}`（`{13位时间戳}_{8位随机}.{ext}` 全局唯一）。
- `extractAssetRefs`（store.ts 顶部公共函数）：正则 `\d{13}_[0-9a-f]{8}\.(?:png|jpg|jpeg|gif|webp|avif)` 从正文提取引用。
- `orphan_assets` 表：未被**当前正文**引用的资源；`detectOrphans` 保存时对账（**已并入历史 refs**——被历史引用的不算孤儿，P2 修复）。
- 同步上传跳过孤儿（`sync.ts` 的 `orphans` Set）——**注意：S3 GC 后这条语义要重新审视**。

---

## 5. 下一步计划（新会话）

1. **★ S3 删除（GC）**（主线，用户要求必须做）：
   - 设计：对比 manifest 引用，GC 无引用的 `objects/*` 和 `assets/*`
   - 关键难点：多设备离线、墓碑、并发、与"孤儿跳过上传"语义的交互
   - 建议先写设计文档（仿 HISTORY-DESIGN.md 流程）→ 用户确认 → 实现 → 单测 + CDP
2. **常规回归**（动代码前/后）：导出三格式、全文搜索（含 2 字）、图标、tab、侧栏/大纲、锁定切换、回收站、历史面板。
3. **待办（docs/TODO.md）**：Word/PDF 导出、搜索 2 字回退、M5 流畅性（TreeRow memo、树虚拟化、保存 debounce、图片懒加载）。
4. **分支合并**：S3 GC 完成后，与用户确认合并 `fix/locked-viewer-text-cache` → master（**用户明确：S3 删除没做完不合并**）。

---

## 6. 踩过的坑（务必记住）

### 本次会话新增（最高优先级）

1. **CDP 调试 Electron**：`./node_modules/.bin/electron --remote-debugging-port=9333 .`（参数必须在 `.` 前）；单实例锁不能双开。
2. **vite.config.ts 临时补丁**：CDP 调试时给 electron 插件加 `onstart: () => {}` 禁自动拉起，**验证后必须还原**（`git status` 应无 vite.config.ts 改动）。
3. **vite dev server 会被 exec 会话回收**：必须用长驻 tty（`exec_command` tty=true）启动；nohup 后台会被 macOS 回收（ERR_CONNECTION_REFUSED）。
4. **CDP 截图超时**：窗口未激活时 `Page.captureScreenshot` 挂起 → 先 `Page.setWebLifecycleState{state:"active"}` + `Emulation.setFocusEmulationEnabled{enabled:true}`。
5. **Python 手写 WebSocket CDP 客户端有 bug**，用 **Node 原生 WebSocket**（Node 22+ 全局 `WebSocket`）写 CDP 脚本最稳（模板见 §7）。
6. **preload 桥漏方法**：加 IPC 必须同步改 main.ts + preload.cjs + native.ts 三处，用 channel 对比脚本校验（§7）。
7. **window.confirm 类型**：项目里 `window.confirm` 类型要求 2-3 参数，用 `(window as any).confirm` 绕过。
8. **emptyTrash 重复删**：`listTrash()` 快照父子项都在，逐项 purge 会重复删 → 只 purge 顶级（无被删父节点的）。
9. **`.lake` 是扁平 HTML**（`<p><span data-lake-id>…</span></p>`，卡片 `<card value="data:JSON">`），无块级结构——历史用全量 gzip。
10. **UNIQUE(note_id, content_hash) 会让恢复前留档被跳过**（P0-2）→ 去 UNIQUE，24h 防抖 + 恢复 force 写。
11. **created_at 单调**：同毫秒多条快照会撞/排序不稳定 → 若与上条同毫秒 +1ms。
12. **sync 测试 FakeStore 需补方法**：加 `setLastUploadedHash`/`lastUploadedHash`/`createHistorySnapshot` 到 mock。
13. **P0-1 曾误用保守 setBaseHash 方案**（因怕破坏冲突测试擅自降级）——**用户明确要 last_uploaded_hash 方案，最终已按既定方案修正**。教训：用户确认的方案不要擅自降级。
14. **P1 恢复后刷新 tab**：仅改 tab.content 不够，EditorTab 不因 content prop 重建 → 必须 bump `reloadKey`（MultiTabEditor 的 EditorTab `key={noteId}-{reloadKey}`）。**不要用"关闭重开"方案**（setTimeout 时 openTabsRef 未更新 → openNote 走"已存在"分支 → tab 丢失）。
15. **历史恢复点错条目**：历史列表倒序，恢复前会自动留档（新快照插入），列表位置会变。测试时按 hash 找目标条目，别按 index。
16. **画板卡片格式**：旧数据 `customBlock`+`customName="board-card"`（编辑态渲染成 viewer 只读），新格式 `name="board-card"`（可编辑）。造测试画板文档用新格式，或直接复制 333 文档的卡片。
17. **Drawnix onChange 无条件触发**（含纯视口平移/缩放）→ 之前把 viewport 持久化导致平移画布触发保存/快照。修复：JSON 对比 elements 变化才 updateCardValue，**viewport 不落盘**。
18. **画板测试**：旧文档（333/777）画板是 readonly/viewer，无法测真实拖拽；需新建文档插入画板（用 `customBlock`+`customName="board-card"` 格式）才有可编辑画板。

### 既有（保留，来自更早会话）

19. **保存时用 Lake 内核生成文本缓存，不要自研 .lake 解析器**（`getDocument` 性能极好）。
20. **Lake 导出 MD 保留 `<font>/<span>` 内联样式**，需 `cleanLakeMarkdown` 剥标签（跳过代码块）。
21. **html 图片正则贪婪陷阱**：用 `[^/"\s]+` 而非 `([^/]+)`。
22. **FTS5 trigram**：1-2 字查不到，需标题 LIKE 回退。
23. **flex column + 无 `flex:none` 子项压扁**：滚动容器 `flex:1 1 auto; min-height:0`，固定项 `flex:none`。
24. **macOS 关窗口 ≠ 退出应用**；排查"改动没生效"先确认进程全新（`ps aux | grep "Electron \."`）。
25. **React StrictMode 双挂载**：cleanup 不能把 host/mount 从 DOM 拔掉。

---

## 7. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run        # 168 个测试
node node_modules/vite/bin/vite.js build
git diff --check
```

启动开发版：`npm run dev`（vite 1421 + 自动拉起 Electron）。

CDP 调试（前台 tty；先加 `onstart: () => {}` 临时补丁，验证后还原）：

```bash
# 终端 1（tty 长驻）
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421
# 终端 2（tty 长驻）
./node_modules/.bin/electron --remote-debugging-port=9333 .
# 获取 page WS
curl -s http://127.0.0.1:9333/json | python3 -c "import json,sys; print([t['webSocketDebuggerUrl'] for t in json.load(sys.stdin) if t['type']=='page'][0])"
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

IPC channel 对比（加方法后校验 preload/main 一致）：

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

---

## 8. 关键排查文件

```text
docs/HISTORY-DESIGN.md             # 历史功能完整设计
docs/HISTORY-DESIGN-REVIEW.md      # 评审意见（P0/P1/P2）
docs/TODO.md                       # 待办（含 P3 S3 GC）
electron/store.ts                  # 历史/回收站/孤儿/缓存/保留策略核心
electron/sync.ts                   # S3 同步 + P0-1 冲突判定（S3 GC 主战场）
electron/lakeCaches.ts             # Lake→md/plain 兜底
electron/main.ts                   # IPC 注册 + 自动快照定时器
electron/preload.cjs / src/lib/native.ts / src/lib/types.ts  # IPC 桥三处
src/components/HistoryPanel.tsx    # 历史面板（两 tab + 预览）
src/components/SettingsPanel.tsx   # 设置（历史配置区）
src/features/editor/BoardCard.tsx  # 画板卡片（视口修复）
src/App.tsx                        # 主应用（tab 管理、reloadKey）
```
