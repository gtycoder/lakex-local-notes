# Lake Notes Electron 会话交接文档

> 写给完全没有上下文的新会话。开始工作前请先通读本文，再查看 `git status`、`git log --oneline master..HEAD` 和 `docs/TODO.md`。
>
> 本文对应项目：`/Users/admin/file/local-lake/lake-notes-electron`

## 1. 当前快照

| 项目 | 当前信息 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| Git 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| 当前分支 | `feat/desktop-2026-08`（桌面端功能迭代，已并入 `master`） |
| 本轮范围 | **UI 全面改造为思源笔记风格**（三栏白卡片 + 浅灰渐变底 + 渐变标题栏 + 毛玻璃弹窗 + 悬浮状态胶囊 + 多 tab/图标/表情细节） |
| 思源源码参考 | `/Users/admin/file/local-lake/siyuan`（页签/tab 交互与视觉参照它实现；已安装 App 为 v3.7.3，源码 v3.6.5） |
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

把应用界面从"暖紫灰 + 蓝紫 accent"整体改造成**思源笔记风格**：中性浅灰背景上悬浮三块白色圆角卡片、顶部渐变标题栏、统一苹果风毛玻璃弹窗，并修复一系列布局/交互细节。用户明确要求：主色用思源蓝 `#3575f0`、完全对齐思源样式、保留既有交互（折叠/悬浮/拖拽/多标签）。

## 3. 已完成内容（提交在 `master`，见 `git log --oneline master`）

### 3.1 思源风格外壳（`src/styles.css` 为主）

- **配色**：全局 `--shell-material: #f1f2f4`（中性浅灰）、`--shell-accent: #3575f0`（思源蓝）、文字 `#222 / #5f6368`、边框/阴影改中性黑调。暖紫灰体系全部替换。
- **三栏卡片**：`.sidebar.sidebar-docked` / `.workspace` / `.outline-sidebar__content` 统一为白色圆角卡片（12px 圆角、中性阴影）；顶部贴标题栏（y38，无空隙横条）、底部对齐（窗口底或状态区），卡片间距 4px。
- **顶部标题栏**：`.tab-bar` 水平渐变 `linear-gradient(90deg,#e9e7f2,#f4f4f7 55%,#fbfcfd)`，**无底边框**（消除与 rails/卡片的接缝线）。
- **左右固定栏融入渐变**：`.activity-rail`（左）用 `#e9e7f2→灰` 垂直渐变，`.outline-sidebar__rail`（右）用 `#f7f8fa→灰` 垂直渐变，与标题栏对应位置颜色衔接。
- **多 tab**：选中标签浅蓝底 `rgba(53,117,240,.12)` + 蓝边框 `.35`；**钉住标签**琥珀金底 `rgba(196,154,58,.10)` + 金边框 + 金色 pin（激活时保持蓝色）；右上角**标签切换器可左右拖拽调宽**（160–440px，`localStorage("lake-notes-v3.tab-switcher-width")` 记忆，`MultiTabEditor.tsx` 的 `startTabMenuResize`）。
- **底部状态**：去掉通栏横条 → 改为**右下角悬浮毛玻璃胶囊**（`position:absolute` 于 `.workspace`，`right:10px;bottom:6px;z:200`，跟随编辑器宽度变化，不挡大纲悬浮预览 z250）。胶囊内展示 仓库·字数·保存·同步，点击 **⋯** 弹出菜单（锁定/解锁），点击外部/Esc 关闭。
- **弹窗统一毛玻璃（仅外观层，不动遮罩/布局/逻辑）**：对话框类（`.emoji-picker`/`.search-panel`/`.sync-panel`/`.settings-panel`/`.confirm-dialog`/`.quick-note-convert-dialog`）`rgba(255,255,255,.74)`+`blur(24px)`+圆角16px；菜单类（`.context-menu`×3/`.create-menu`/`.tab-switcher-menu`/`.statusbar-menu`）`.72`+圆角12px。
- **锁定态滚动条统一**：`.ne-viewer` 加入细滚动条规则（与编辑态 `.ne-editor-wrap` 一致，`scrollbar-width:thin`+浅灰 thumb）。
- **锁定/编辑切换防闪烁**：`.lake-editor-mount` 加 180ms 淡入（Lake 切换必须重建实例，淡入掩盖空白闪帧）。
- **小记（QuickNotes）**：背景改中性渐变、标题栏水平渐变、卡片/按钮换蓝 accent，与主界面同族。
- **移除状态栏 MD 按钮**（右键菜单已有导出），删除 `exportMarkdown` 函数与 `FileDown` 导入。

### 3.2 文档图标选择器（自研 `EmojiIconPicker`，非 Lake 原生）

- 默认 **550×370**、min 440×320、可拖拽 resize；14 列、**0 间距**、表情 24px、行高 33px。
- 分组 tabs：全部 / 表情 / 人物 / 自然 / 食物 / 旅行 / 活动 / 物品 / 符号；搜索 + 清除按钮。
- 数据：`src/lib/lakeEmojis.ts`（1421 个，名称→字符）+ `lakeEmojiGroups.ts`（8 组）。
- **注意**：之前尝试加"最近使用"小节/页签，用户觉得突兀已要求移除——**保持无最近功能**。

### 3.3 交互修复

- 编辑器右键菜单（`EditorContextMenu`）：**点击外部关闭 + Esc**。
- 状态胶囊 ⋯ 菜单：document 级 pointerdown/Esc 关闭（因胶囊自身 backdrop-filter 会让内部 fixed 遮罩失效，见坑 #6）。
- 侧边栏**悬浮预览**：从窗口左缘改为贴 rail 右侧（`left: var(--activity-rail-width)`、`height: calc(100% - var(--topbar-height))`），z-index 不覆盖 rail，rail 始终可点。
- 大纲收起 → 悬停 rail 浮出预览；大纲/侧边栏折叠均验证正常。

## 4. 关键架构（保留，新会话必须理解）

### 4.1 文本缓存 = 导出/搜索的文本源（不做 .lake 解析器）

- `.lake` 是 Lake 私有 XML，正文在文件里不在 DB。**不做自研解析器**，改为：**保存时用 Lake 内核 `getDocument("text/markdown"/"text/plain")` 生成缓存**存 `notes.md_cache`/`text_cache` 列（`App.tsx` `persistTab`；`handleEditorReady` 打开时补写）。
- 搜索索引 FTS、导出资料包、复制 MD 全部消费缓存。
- 图片不参与搜索；导出资料包时用**轻量正则**从 MD 提取 `![](http://127.0.0.1:19876/{noteId}/{file})` → 复制到 `images/` + 改写相对引用。

### 4.2 收口导出（`electron/export.ts`）

- 统一入口 `exportNote(store, id, format, baseDir)`，`ExportFormat = "markdown"|"html"|"lake"|"docx"|"pdf"`（docx/pdf 未实现，抛"暂未实现"）。
- 右键菜单（文档树 + 编辑器）都是"导出 ▸"二级子菜单。
- `cleanLakeMarkdown`（`src/lib/markdownClean.ts`）：剥 font/span 标签、跳过代码块。

### 4.3 全文搜索

- `notes_fts` FTS5 trigram + `rebuildSearchIndex()` 全量重建 + 保存/打开/重命名/删除同步。
- `searchNotes`：≥3 字 FTS + `highlight`；1-2 字回退标题 `LIKE`。
- `SearchPanel`：⇧⌘F 打开，300ms 防抖，snippet 渲染前 `sanitizeSnippet` 防注入。

### 4.4 文档图标

- `tree_nodes.icon` 列（emoji 文本）；`setNodeIcon` IPC；manifest v3 可选字段 `ManifestNote.icon`（不升版本，向后兼容）。
- 入口：点树节点图标（`tree-row-icon`）或右键"设置图标"；tab 显示自定义图标。

### 4.5 tab 交互（参照思源）

- 钉住：移到最前、X 隐藏（`.tab-item.pinned .tab-close{display:none}`）、批量关闭跳过 pinned、右键"关闭"可直接关 pinned。
- 右键菜单：关闭/关闭其他/关闭全部/关闭左侧/关闭右侧（条件显示）→ 分隔 → 钉住/取消钉住。

## 5. 当前问题 / 状态

- **已并入 master**：本次 UI 改造全部提交，`npm test`（140）与 `tsc` 全绿。
- **已知取舍（用户已接受）**：
  - 编辑器内**纯文本粘贴/输入的 emoji** 保持 Lake 原生渲染（跟随正文字号 15px），**不做放大**——曾尝试 JS 包裹 span 放大，实测会被 Lake（ProseMirror）模型合并并保存进 `.lake`（数据污染风险），已回退。从选择器插入的 emoji 是"卡片"（`.ne-card-unicode-emoji-icon` 默认 0.8em），同样保持原生。
  - 原生 emoji 选择器（`.ne-ui-unicode-emoji-panel`）保持 Lake 原生（10 列/418px），未自定义。
- `docs/TODO.md` 待办：tab 宽度/间距观感、Word/PDF 导出、Viewer 锁定态文本缓存确认、**M4 回收站/快照、M5 思源借鉴+流畅性（暂缓）**。

## 6. 踩过的坑（务必记住）

### 本会话新增

1. **CDP 调试 Electron**：`./node_modules/.bin/electron --remote-debugging-port=9333 .`（参数必须在 `.` 前）；项目有单实例锁不能双开。
2. **vite.config.ts 临时补丁**：CDP 调试时给 electron 插件项加 `onstart: () => {}` 禁用 vite-plugin-electron 自动拉起 Electron（会抢锁/无 CDP），**验证后必须 `git checkout -- vite.config.ts` 恢复**（恢复会触发 vite 重启并可能退出，属预期）。
3. **vite dev server 会被 exec 会话回收**（nohup 也可能失效）：用长驻 tty 会话（`exec_command` tty=true）保持。
4. **CDP 截图超时**：Electron 窗口未激活时 `Page.captureScreenshot` 会挂起 → 先 `Page.setWebLifecycleState{state:"active"}` + `Emulation.setFocusEmulationEnabled{enabled:true}`；`clip` 参数在 `fromSurface:true` 下被忽略（裁剪用 Python 解码 PNG 或 DOM 测量）。
5. **CDP 触发 React hover 无效**：React `onMouseEnter/Leave` 实际由 `pointerover/pointerout` 驱动，dispatch `new PointerEvent("pointerover",{bubbles:true})` 可触发；直接用 DOM 改 class 模拟状态会被 React 重渲染重置。
6. **backdrop-filter 形成"固定定位包含块"**：元素自身有 `backdrop-filter` 时，内部 `position:fixed` 子元素会被限制在该元素内（状态胶囊菜单遮罩失效的根因）→ 弹窗/菜单关闭统一用 document 级 pointerdown 监听 + Esc。
7. **纯文本 emoji 放大不安全**：外部 DOM 包裹 span 会被 Lake（ProseMirror 内核）**合并进模型并保存进 `.lake` 内容**（实测污染）——不要做 DOM 级包裹；要改大小只能改 Lake 的 CSS（对卡片类有效）或接受原生。
8. **Lake 两条 emoji 路径**：选择器插入 = `unicodeEmoji` 卡片（图标 `.ne-card-unicode-emoji-icon`）；粘贴/输入 = 纯文本字符（跟随正文字号）。两者互不影响，排查"表情大小"先确认是哪种。
9. **sips `--cropOffset` 是相对中心偏移**（负值才到左上），容易裁错；验证视觉以 CDP 全图 + Python 像素解码为准。
10. **VisionPower 识图在细节上不可靠**（大图误读、超时、结果不稳定）；精确测量用 DOM `getBoundingClientRect` / computedStyle / 像素采样。
11. **状态胶囊层级**：胶囊 `z:200` 故意低于大纲/侧栏悬浮面板（250），让悬浮预览能盖住胶囊、不挡交互；胶囊自身不可用 fixed 全屏遮罩（见 #6）。
12. **卡片/弹窗视觉验收流程**：改完样式后用 CDP 截图 + DOM 测量逐项确认（对齐、间距、z 层级、hover/悬浮态），不要只改不验。

### 既有（保留，来自更早会话）

13. **保存时用 Lake 内核生成文本缓存，不要自研 .lake 解析器**（`getDocument` 性能极好）。
14. **Lake 导出 MD 会保留 `<font>/<span>` 内联样式**，需 `cleanLakeMarkdown` 剥标签（跳过代码块）。
15. **html 图片正则捕获组贪婪陷阱**：用 `[^/"\s]+` 而非 `([^/]+)`。
16. **python heredoc 写 TS 时 `\\b` 会变退格字符**：写正则后用 `hexdump -C` 抽查。
17. **FTS5 trigram**：1-2 字查不到，需标题 LIKE 回退；MATCH 查询串逐词加引号转义。
18. **flex column + 无 `flex:none` 会把子项压扁**：滚动容器要 `flex:1 1 auto; min-height:0`，固定项 `flex:none`；UI 验证查元素高度/可见性，不只查存在性。
19. **验证真实 UI 用 CDP**（见 #1-#5）。
20. **macOS 关窗口 ≠ 退出应用**（隐藏 Dock）；排查"改动没生效"先确认进程全新（`ps aux | grep "Electron \."`）。
21. **思源 pinned tab 的 X 是隐藏不是禁用**；关闭全部跳过 pinned，右键"关闭"可直接关。
22. **icon 同步**：`tree_nodes.icon` 不在 notes 表，`listNotesForSync` 要 JOIN tree_nodes；manifest 加可选字段不升版本。
23. **Lake emoji 资源提取**：全量 `let dx={名称:字符}`（1421）、分组 `MYe`（8 组 1055），`new Function("return "+对象字符串)()` 解析生成 `src/lib/lakeEmojis.ts`/`lakeEmojiGroups.ts`。
24. **不要禁用 `emoji`/`toc` 插件**（unicodeEmoji 数据依赖 emoji 插件；toc 用 `toc:{enable:false}`）。
25. **Viewer 与 Editor 滚动容器不同**：编辑态 `.ne-editor-wrap`，锁定态 `.ne-viewer`（滚动条样式、滚动监听都要覆盖两者）。
26. **React StrictMode 双挂载**：cleanup 不能把 host/mount 从 DOM 拔掉。
27. **大 chunk 警告不是失败**；"关闭再打开后恢复"不等于已解决（水合路径要验证）。

## 7. 下一步计划

1. 常规回归：导出三种格式、全文搜索（含 2 字）、图标设置/同步、tab 钉住/拖拽调宽、侧边栏/大纲折叠悬浮、锁定切换。
2. `docs/TODO.md` 待办按需推进：
   - tab 宽度/间距观感（短标签关闭键贴边）；
   - Word/PDF 导出（`electron/export.ts` 已收口，PDF 可走 `printToPDF`）；
   - Viewer 锁定态文本缓存确认；
   - **M4 回收站 + 历史快照**、**M5 思源借鉴（模板/日记/命令面板）+ 流畅性优化**（方案已讨论，暂缓）。
3. 如用户后续要改编辑器内 emoji 大小：**只能改 Lake 卡片 CSS**（`.ne-card-unicode-emoji-icon`），纯文本 emoji 不要用 DOM 包裹（见坑 #7）。

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

CDP 调试启动（临时在 vite.config.ts 加 `onstart: () => {}` 后，验证完恢复）：

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
src/styles.css                    # 全部 UI 样式（思源外壳/卡片/标题栏/状态胶囊/毛玻璃弹窗/emoji 选择器）
src/features/outline/outline.css  # 右侧大纲栏（卡片化、滚动条）
src/App.tsx                       # 状态胶囊 + ⋯ 菜单（statusMenuOpen/useEffect 外部关闭）、保存缓存、导出/搜索/图标回调
src/components/Sidebar.tsx        # 树渲染、文档右键、EmojiIconPicker（550×370、14 列）
src/features/editor/EditorTab.tsx # 编辑器右键菜单（外部点击关闭）、锁定切换淡入（styles.css）
src/features/editor/MultiTabEditor.tsx # tab 右键、钉住、标签切换器拖拽调宽（tabMenuWidth）
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
