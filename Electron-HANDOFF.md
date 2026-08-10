# Lake Notes Electron 会话交接文档

> 写给完全没有上下文的新会话。开始工作前请先通读本文，再查看 `git status`、`git log --oneline master..HEAD` 和 `docs/TODO.md`。
>
> 本文对应项目：`/Users/admin/file/local-lake/lake-notes-electron`

## 1. 当前快照

| 项目 | 当前信息 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| Git 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| 当前分支 | `feat/desktop-2026-08`（桌面端功能迭代，从 `master` 分出；`master` 在 `6f36f38`） |
| 最近提交 | `bfab934 style(icon): enlarge emoji icon picker panel (400x440)` |
| 本轮范围 | M1 资料交付（缓存/导出/右键体系/tab 优化）+ M2 全文搜索 + M1.6 文档图标（20 个提交，见 §3 清单） |
| 思源源码参考 | `/Users/admin/file/local-lake/siyuan`（页签/tab 交互参照它实现） |
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
- 不要改 `lake-notes-dev` 里非自己创建的笔记内容；测试后要把自己插入的卡片/字符清理掉。

## 2. 本轮任务目标（已完成）

1. **资料交付**：文档右键"导出"子菜单（Markdown 资料包 / HTML / 原生 Lake，Word/PDF 预留）；复制为 Markdown / 导出资料路径（本机 AI）；编辑器右键同样支持。
2. **文本缓存落库**：保存时用 Lake 内核生成 markdown/plain 缓存，作为导出/搜索的文本源（**不做 .lake 解析器**，方案见 §4.1）。
3. **全文搜索**：FTS5 trigram + 搜索面板（⇧⌘F / 侧边栏按钮），正文命中 + 高亮 + 短词标题回退。
4. **文档图标**：tree_nodes.icon 列 + 点树节点图标换图标 + Lake emoji 资源分组选择器 + 同步进 manifest。
5. **tab 优化**：钉住（移到最前、X 隐藏、批量关闭跳过、右键可直接关）、思源式右键菜单、宽度截断。

## 3. 已完成内容（分支 `feat/desktop-2026-08`，20 个提交）

| 提交 | 内容 |
| --- | --- |
| `3bd5989` | M1.1 文本缓存落库：`notes` 表加 `md_cache`/`text_cache` 列；保存/打开时 Lake 内核 `getDocument("text/markdown" / "text/plain")` 生成缓存；IPC `update_note_caches` |
| `fde0069` | 文档右键三件套：复制为 Markdown（读缓存）/ 导出资料包（MD+图片）/ 复制资料路径（本机 AI） |
| `0f50672` | `cleanLakeMarkdown` 清洗 `<font>/<span>` 标签（跳过代码块）；导出选目录（`pick_export_dir` 对话框） |
| `7c0dc74` | 导出原生 Lake：图片 URL → base64 内嵌（VS Code Lake 插件兼容），`store.exportNativeLake` |
| `66875c3` | **收口导出**：`electron/export.ts` 统一 `exportNote(id, format, baseDir)`；右键"导出 ▸"二级子菜单（Markdown 资料包/HTML/原生 Lake，Word/PDF 禁用占位）；新增 `electron/mdToHtml.ts` Markdown→HTML 转换器；`store.exportHtmlNote` |
| `cb1b5f8` | 编辑器右键（`EditorTab`）：导出▸子菜单 + 复制 MD + 复制路径（覆盖 Lake 默认右键，复制粘贴走快捷键） |
| `d925a8a` | 多 tab 右键：钉住/关闭/关闭其他/关闭左侧/关闭右侧 |
| `9e5a22b` | 侧边栏"定位到当前文档"：展开祖先 + 高亮 + 滚动 |
| `1e82cb4` | 复制 MD/资料路径移入"导出 ▸"二级；钉住移到最前 + 关闭保护；tab 截断（186px） |
| `cd0d52c` | 思源式 tab 菜单：条件显示（关闭其他/全部/左右仅在存在时）、**关闭全部也跳过 pinned**、pinned X 隐藏、菜单项点击后关闭 |
| `ccde88a` | tab 高度改回原样；pinned 右键"关闭"直接可关（不禁用）；删除"关闭未保存" |
| `256c563` / `620e9d0` | 去掉 tab min-width（短的自适应）；padding 12→8px（宽度观感仍未完全解决，见 TODO） |
| `e1bb863` | M1.6 文档图标：`tree_nodes.icon` 列 + 右键"设置图标" + emoji 选择器 + TODO 清单 |
| `0b0e230` | **M2 全文搜索**：`notes_fts` FTS5 trigram 表 + 索引同步（保存/打开/重命名/删除）+ `searchNotes`（≥3 字 FTS + highlight，1-2 字标题 LIKE 回退）+ `SearchPanel`（⇧⌘F，防注入转义 snippet） |
| `a02de61` | icon 同步进 manifest（`ManifestNote.icon` 可选字段，向后兼容）；tab 显示自定义图标；emoji 选择器接入 Lake 表情资源（`src/lib/lakeEmojis.ts`，1421 个）+ 搜索框 |
| `4d72cc9` | 图标选择器按 Lake 分组（`src/lib/lakeEmojiGroups.ts`，8 组 1055 个）；点树节点图标直接换图标；M4/M5 进 TODO |
| `4d21d97` | 修复双份图标（TreeRow `{icon}` 渲染两处）；emoji 选择器加 backdrop 点击外部关闭（CDP 实测） |
| `fc540f1` | **修复分组 tabs 被 flex 压扁**（3.4px→43.85px，见 §6 坑 #6） |
| `bfab934` | 图标选择器放大到 400×440 |

**自动化验证**：`npx tsc --noEmit`、`npm test -- --run`（140 测试）、`node node_modules/vite/bin/vite.js build`、`git diff --check` 全绿。

## 4. 关键架构（新会话必须理解）

### 4.1 文本缓存 = 导出/搜索的文本源（不做 .lake 解析器）

- `.lake` 是 Lake 私有 XML，正文在文件里不在 DB。**不做自研解析器**，改为：**保存时用 Lake 内核 `getDocument("text/markdown"/"text/plain")` 生成缓存**存 `notes.md_cache`/`text_cache` 列（`App.tsx` `persistTab` 里调编辑器实例；`handleEditorReady` 打开时补写）。
- 搜索索引 FTS、导出资料包、复制 MD 全部消费缓存。
- 图片不参与搜索；导出资料包时用**轻量正则**从 MD 里提取 `![](http://127.0.0.1:19876/{noteId}/{file})` → 复制到 `images/` + 改写相对引用（不需要解析 .lake 卡片）。

### 4.2 收口导出（`electron/export.ts`）

- 统一入口 `exportNote(store, id, format, baseDir)`，`ExportFormat = "markdown" | "html" | "lake" | "docx" | "pdf"`（docx/pdf 未实现，抛"暂未实现"）。
- markdown → `store.exportNotePackage`（MD + images/）；html → `store.exportHtmlNote`（`mdToHtml` 转换 + images/）；lake → `store.exportNativeLake`（图片 base64 内嵌）。
- 右键菜单：文档右键（`Sidebar.tsx` ContextMenu）和编辑器右键（`EditorTab.tsx` EditorContextMenu）都是"**导出 ▸**"二级子菜单（Markdown 资料包 / Markdown 文本（复制）/ HTML / Word(禁用) / PDF(禁用) / 原生 Lake / 资料路径）。
- `cleanLakeMarkdown`（`src/lib/markdownClean.ts`）：剥 font/span 标签、跳过代码块，生成缓存时调用。

### 4.3 全文搜索

- `notes_fts` FTS5 trigram（`title, body, note_id UNINDEXED`）；`rebuildSearchIndex()` 启动时全量重建；保存/打开/重命名/删除同步（`upsertFts`）。
- `searchNotes(query, limit)`：≥3 字走 FTS `highlight(notes_fts, 1, '<mark>', '</mark>')`；1-2 字回退 `tree_nodes.title LIKE`。
- `SearchPanel`（`src/components/SearchPanel.tsx`）：⇧⌘F 或侧边栏按钮打开，300ms 防抖，结果点击打开文档；snippet 渲染前 `sanitizeSnippet`（转义后只放行 `<mark>`，防注入）。

### 4.4 文档图标

- `tree_nodes.icon` 列（emoji 文本）；`setNodeIcon` IPC。
- 同步：`ManifestNote.icon` 可选字段（v3 清单不升版本，旧清单无字段本地保持原样）；上传/下载/冲突副本/墓碑均带 icon。
- 选择器：`EmojiIconPicker`（`Sidebar.tsx` 导出）——分组 tabs（`src/lib/lakeEmojiGroups.ts`，从 Lake bundle `MYe` 提取 8 组）+ 搜索 + 清除；`src/lib/lakeEmojis.ts` 是名称→字符全量（1421）。
- 入口：点树节点图标（`tree-row-icon`，hover 提示"设置图标"）或右键"设置图标"。
- tab 上显示文档自定义图标（`TabInfo.icon`，App 从 treeNodes 查）。

### 4.5 tab 交互（参照思源 `/Users/admin/file/local-lake/siyuan` 实现）

- 钉住：移到最前（pinned 组在前，`onTabsReorder`）；X 按钮隐藏（`.tab-item.pinned .tab-close { display: none }`）；关闭其他/全部/左右**跳过 pinned**；右键菜单"关闭"**可直接关 pinned**（不禁用）；关闭后清理 pinned 记录。
- 右键菜单：关闭 / 关闭其他（tabs>1）/ 关闭全部（tabs>1，跳过 pinned）/ 关闭左侧 / 关闭右侧（条件显示）→ 分隔 → 钉住/取消钉住。
- 宽度：`max-width: 186px` 截断；`padding: 6px 8px`；**无 min-width**（短 tab 自适应）。

## 5. 当前问题 / 状态

- 图标选择器已放大（400×440）、分组 tabs 正常（实测高度 43.85px）。
- **待用户确认**：图标选择器尺寸、tab 宽度观感（`padding 8px` 后关闭键仍觉有空间，见 TODO）。
- 无已知 P0 阻塞；工作区干净（`git status` 无未提交）。
- `docs/TODO.md` 记录了：tab 宽度/间距、Word/PDF 导出、2 字搜索回退（已实现）、Viewer 锁定态缓存、**M4 回收站/快照、M5 借鉴/流畅性（暂不实施）**。

## 6. 踩过的坑（本会话新增，务必记住）

1. **保存时用 Lake 内核生成文本缓存，不要自研 .lake 解析器**。`getDocument("text/markdown"/"text/plain")` 性能极好（563KB 大文档 13ms/4.6ms），且图片在 MD 里是 `![](http://127.0.0.1:19876/{noteId}/{file})` 本地 URL——导出资料包用正则提取即可，无需解析卡片结构。
2. **Lake 导出 MD 会保留 `<font style="...">` / `<span>` 内联样式**（知乎抓取内容的颜色），需 `cleanLakeMarkdown` 剥标签（**跳过代码块**，用 ``` 分段处理，避免误伤代码块内字面量）。
3. **html 图片正则捕获组贪婪陷阱**：`<img src="URL" alt="">` 里 `([^/]+)` 会贪婪吃进 `" alt="`，导致 filename 捕获错误 → 用 `[^/"\s]+`（不含引号/斜杠/空白）。
4. **python heredoc 写 TS 代码时 `\\b` 会被转义成退格字符（0x08）**，正则静默失效（grep 输出显示为 `\b` 但 hexdump 是 08）。写正则后用 `hexdump -C` 抽查，或用 `chr(92)+'b'` 拼。**本会话此坑踩过两次（exportNativeLake 的 cardRe）。**
5. **FTS5 trigram**：中文子串搜索可行（3 字以上）；`snippet()` 在 trigram 下不可用、用 `highlight()`；**1-2 字查不到**（trigram 最小 3 字符）→ 标题 LIKE 回退。MATCH 查询串要逐词加引号转义（`escapeFtsQuery`）。
6. **flex column + 无 `flex: none` 会把子项压扁**：`.emoji-picker` 是 max-height 300px 的 flex column，1421 个表情让 grid 内容超高，search/tabs 被 flex 压缩——**分组 tabs 被压成 3.4px 高，肉眼"消失"**。修复：grid `flex: 1 1 auto; min-height: 0; overflow-y: auto`，search/tabs/clear `flex: none`。**教训：UI 验证要查元素高度/可见性，不只查存在性**（CDP `getBoundingClientRect` + computedStyle）。
7. **验证真实 UI 用 CDP**：`./node_modules/.bin/electron --remote-debugging-port=9333 .`（**参数必须在 `.` 前面**），然后 `curl :9333/json` 拿 page ws，用 Node 全局 WebSocket 发 `Runtime.evaluate` 检查 DOM / 点击 / 截图。项目有单实例锁（`app.requestSingleInstanceLock`），**不能双开**；vite-plugin-electron 会自动拉一个无端口的 Electron 抢锁——调试时临时在 `vite.config.ts` 给 electron 项加 `onstart: () => {}` 禁用自动启动，**验证后必须恢复**。
8. **vite dev server 会被 exec 会话回收杀掉**（nohup 也可能失效），调试时用长驻 tty 会话保持，或用 `npm run dev:vite` 后立刻起 Electron。
9. **macOS 关窗口 ≠ 退出应用**（隐藏到 Dock），用户"重启"可能仍加载旧渲染代码；排查"改动没生效"先确认进程是否全新（`ps aux | grep "Electron \."`）。
10. **思源 pinned tab 的 X 是隐藏不是禁用**（`.item--pin .item__close { display: none }`）；**关闭全部也跳过 pinned**；但右键"关闭"直接 `removeTab`（能关 pinned）。按用户定制：我们的右键"关闭"可直接关 pinned，X 隐藏，其余批量关闭跳过。
11. **icon 同步**：`tree_nodes.icon` 不在 `notes` 表，`listNotesForSync` 要 JOIN tree_nodes 取 icon；manifest 加可选字段**不升版本**（`validateManifest` 检查 version === 3，旧清单无 icon 字段时本地保持原样）。
12. **Lake emoji 资源提取**：全量映射是 bundle 里 `let dx={名称:字符}`（1421 唯一），分组是 `MYe = {组名: "😀.😃...".split(".")}`（Windows/Android 分支，8 组 1055 个）；用 `new Function("return " + 对象字符串)()` 解析，生成 `src/lib/lakeEmojis.ts` / `lakeEmojiGroups.ts`。

### 既有（保留，来自更早会话）

13. **不要禁用 `emoji` 插件**（unicodeEmoji 选择器数据依赖它）；不要禁用 `toc` 插件（用 `toc: { enable: false }`）。
14. **不要全量重定向 `gw.alipayobjects.com`**（同时承载运行时 CDN 和用户图片，只按本地镜像存在性精确重定向）。
15. **Viewer 和 Editor 的真实滚动容器不同**：编辑态 `.ne-editor-wrap`，锁定态 `.ne-viewer`；锁定态自定义卡片需兼容层注入最小主题结构。
16. **React StrictMode 双挂载**：cleanup 不能把 host/mount 从 DOM 拔掉。
17. **大 chunk 警告不是失败**；先区分 warning 与真正的类型/测试/运行时错误。
18. **"关闭再打开后恢复"不等于已解决**（新建/初始化路径的水合可能没完成）。

## 7. 下一步计划

1. 用户验证图标选择器尺寸（400×440）与 tab 宽度观感。
2. `docs/TODO.md` 里的待办按需推进：
   - tab 宽度/间距（短标签关闭键贴边问题，重新审视 flex/padding/gap）；
   - Word/PDF 导出（走 `electron/export.ts` 收口 + `mdToHtml` 链路，PDF 可用 Electron `printToPDF`）；
   - Viewer 锁定态文本缓存确认；
   - **M4 回收站 + 历史快照**、**M5 思源借鉴（模板/日记/命令面板）+ 流畅性优化**（方案已讨论，暂缓）。
3. 常规回归：导出三种格式、搜索（含 2 字）、图标设置/同步、tab 钉住交互、侧边栏定位。

## 8. 关键命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run        # 140 个测试
node node_modules/vite/bin/vite.js build
git diff --check
```

启动开发版：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev              # vite 1421 + vite-plugin-electron 自动拉起 dev Electron（lake-notes-dev）
```

CDP 调试启动（临时在 vite.config.ts 加 `onstart: () => {}` 后）：

```bash
./node_modules/.bin/electron --remote-debugging-port=9333 .
curl -s http://127.0.0.1:9333/json
```

只读检查开发库：

```bash
DB="/Users/admin/Library/Application Support/lake-notes-dev/workspace-default/metadata.sqlite3"
sqlite3 "$DB" "SELECT id, title, parent_id, node_type, icon FROM tree_nodes WHERE deleted_at IS NULL;"
```

## 9. 关键排查文件

```text
src/App.tsx                       # 保存缓存生成(persistTab)、导出/搜索/图标回调、SearchPanel 集成
src/components/Sidebar.tsx        # 树渲染、文档右键(ContextMenu+导出▸)、EmojiIconPicker、定位
src/components/SearchPanel.tsx    # 全文搜索面板
src/features/editor/EditorTab.tsx # 编辑器右键菜单(EditorContextMenu)
src/features/editor/MultiTabEditor.tsx # tab 右键(TabContextMenu)、钉住逻辑
src/features/editor/lakeRuntime.ts      # Lake 编辑器创建（不要动禁用插件清单）
src/lib/markdownClean.ts          # MD 清洗
src/lib/lakeEmojis.ts / lakeEmojiGroups.ts # Lake emoji 数据（自动生成）
electron/export.ts                # 收口导出统一入口
electron/mdToHtml.ts              # Markdown→HTML
electron/store.ts                 # 缓存列、FTS、exportNotePackage/HtmlNote/NativeLake、setNodeIcon
electron/sync.ts                  # manifest v3（含 icon 字段）
electron/main.ts                  # IPC 注册
docs/TODO.md                      # 待办
```
