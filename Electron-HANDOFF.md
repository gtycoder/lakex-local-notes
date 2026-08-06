# Lake Notes Electron — 会话交接（自建右侧大纲栏）

> **写给零上下文的新会话。请先通读本文，再修改代码。**
>
> 本轮已将桌面端 Lake 原生 TOC 的显示层替换为应用自有的右侧大纲系统，并完成用户最后确认的交互：
> **右侧有常驻 34px activity rail；rail 悬停只打开大纲预览；仅 rail 内的大纲图标切换“固定 / 悬停”；悬停和固定状态都能独立拖拽右侧大纲宽度。**
>
> 当前没有已知 P0 阻塞。工作分支是 `research/outline-system`，最新实现和文档都还**未提交**，严禁直接丢弃工作区改动。

---

## 1. 当前快照

| 项目 | 当前状态 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| 分支 / HEAD | `research/outline-system` / `49f7273` |
| 对比基线 | `master` / `69c3b74`（远程 `origin/master` 同此） |
| Git 工作区 | 有未提交的大纲实现与交接文档改动；先 `git diff` 审阅，**不要 reset / checkout -- .** |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`，含用户测试笔记，**绝不能删除** |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`，本轮**未触碰，绝不能触碰** |
| 开发服务 | 本会话最后通过 `npm run dev` 启动；Vite 为 `127.0.0.1:1421`，插件会自动拉起 Electron。新会话请自行确认进程状态，不要假定它仍存活。 |

> **2026-08-06 追加**：大纲样式已打磨（去圆点、级别标签前置分层、纯竖线分层配色、移除无功能头部图标）；大纲状态改为**单一全局变量**（`outlineMode` + `activeOutlineEmpty` + `outlineEmptyOverride`，见 `src/App.tsx`），无 per-tab 覆盖；无大纲文档自动悬浮。左侧 Sidebar 的“新建文档”父节点 fallback bug 已修。本轮改动已合入 master 并推送；后续样式优化（颜色自然分隔、动效）在新提交上进行。

---

## 2. 任务目标

### 原始目标

1. 解决 Lake 原生 TOC 在桌面多标签、虚拟渲染下的时序/显示问题，建立稳定、可扩展的应用自有大纲。
2. 大纲要支持层级引导线、标题级别、折叠、筛选、选中跟随、工具栏等定制能力，为后续“只读锁”复用。
3. 右侧交互参照思源：
   - 左右两侧一致的是**常驻 activity rail**，不是左右展开面板同宽；
   - 右 rail 悬停时，大纲从 rail 左侧以 overlay 预览，不挤压编辑器；
   - rail 内的大纲图标才负责固定 / 取消固定；整条 rail 需要保留给未来其它 activity button；
   - 固定时右大纲占据 grid，编辑器宽度自适应；
   - 右侧大纲和左侧资料库宽度分别持久化、互不影响；
   - 悬停预览态和固定态都必须可拖拽改变右大纲宽度。
4. 编辑器、目录和大纲的滚动条要作用于真正的滚动容器，默认窄、悬停加宽；删除与大纲滚动无关的假“正文进度竖线”。

---

## 3. 已完成内容

### 3.1 自建大纲架构

当前核心目录：

```text
src/features/outline/
  OutlineController.ts   # TOC 树、选中、折叠集合、筛选、展开状态与持久化
  OutlineList.tsx        # 扁平可见列表渲染、层级线、H1-H6 徽标、选中滚动可见
  OutlineSidebar.tsx     # 右 rail、悬停 overlay、固定态、工具栏、宽度拖拽
  registry.ts            # EditorTab 依据 noteId 注册/获取当前大纲控制器
  useOutline.ts          # 订阅 Lake tocChange、打开时刷新、滚动高亮、虚拟渲染批次处理
  outline.css            # 右侧布局、overlay、resize handle、列表和滚动条样式
```

- Lake 内核仍负责生成 TOC 数据与 `tocChange`；桌面端不再创建 Lake 原生 TOC 面板，而是由应用读取 TOC 数据渲染自己的组件。
- `OutlineController` 支持按 depth 构树、标题级别、筛选、展开/折叠、展开至指定级别、保持当前标题祖先展开、每篇笔记的折叠状态持久化。
- `OutlineList` 使用扁平可见项列表：有层级引导线、叶子圆点、H1–H6 徽标、当前标题高亮，当前项会滚入列表可视区域。
- 桌面 `EditorTab` 通过 registry 注册当前 note 的 `{ controller, navigate, refresh }`，因此多标签之间不会串大纲。

### 3.2 最终右侧栏交互与尺寸

相关文件：

```text
src/App.tsx
src/features/outline/OutlineSidebar.tsx
src/features/outline/outline.css
```

已实现并已验收：

- 左右常驻 activity rail 都为 **34px**。
- 右侧收起（`collapsed`）时，grid 右列仅保留 34px rail；鼠标进入 rail 后，从 rail 左侧打开大纲 overlay，**不压缩正文**。
- 右侧固定（`docked`）时，右大纲内容和 34px rail 共同参与 app grid；编辑器以可用宽度自适应。
- **不可给 `.outline-sidebar__rail` 加 click handler。**rail 只负责 hover 触发。rail 内的 `.outline-sidebar__activity-button` 才能切换模式：
  - `collapsed` 点击图标 → `docked`；
  - `docked` 点击图标 → `collapsed`；
  - 从固定切回悬停时会先清除 hover 状态，避免鼠标仍停在按钮上导致立刻重开。
- 左右展开面板宽度完全独立：
  - 左资料库：默认 `224px`、范围 `160–300`、key `lake-notes-v3.sidebar-width`；
  - 右大纲内容：默认 `280px`、范围 `200–420`、key `lake-notes-v3.outline-sidebar-width`。
- 右侧可从**大纲左边缘**拖动，向左变宽、向右变窄；带橡皮筋边界效果，松手后写回 localStorage。
- 右侧 resize handle 有 keyboard 支持：`← / →` 每次 8px，`Shift + ← / →` 每次 24px，`Home / End` 到最小/最大值。

### 3.3 最后修复：悬停态不能拖拽宽度

用户最后反馈：右侧大纲在悬浮预览状态下不能拖拽变大/变小，左侧可以。

已在 `src/features/outline/OutlineSidebar.tsx` 修复：

1. `handleResizePointerDown` 不再限制 `mode === "docked"`，仅接受鼠标主键，因此 docked 与 collapsed-hover overlay 都能开始拖动。
2. resize handle 在 `mode === "docked" || railHovered` 时可聚焦；CSS 不再在 collapsed 状态禁用其 pointer events。
3. 使用 `setPointerCapture()`，拖动期间由 `resizeRef` 标记进行中。
4. 拖动过程中 `<aside>` 的 `onPointerLeave` 不再关闭 overlay，否则鼠标离开原始边界时会导致面板和把手消失。
5. `pointerup/cancel` 后调用 `document.elementFromPoint(clientX, clientY)`：
   - 若落点仍在 aside（大纲/rail）内，overlay 保持；
   - 若落在编辑器外侧，恢复普通 hover 语义并收起。

**切勿还原以下错误实现：**

```ts
if (event.button !== 0 || mode !== "docked") return;
```

也不要在 resize 过程中无条件执行 `setRailHovered(false)`。

### 3.4 滚动条与无效进度线清理

- 已删除 `.outline-list__progress` 及其 controller/scroll handler 状态。它不是大纲自身滚动条，只是不会随大纲滚动的“正文进度竖线”。
- 真正滚动容器使用窄原生 scrollbar：
  - 左侧资料库：`.note-list`；
  - 右侧大纲：`.outline-list`；
  - 编辑器：`.lake-editor-main .ne-editor-wrap`（以及阅读容器）。
- 默认宽度 `3px`，鼠标进入滚动容器后 `6px`，thumb 更深。

### 3.5 文档与验证

已更新：

```text
Electron-HANDOFF.md
/docs/PROGRESS.md
```

本轮最终静态验证均通过：

```bash
git diff --check
npx tsc --noEmit
npm test                         # 7 files / 122 tests passed
node node_modules/vite/bin/vite.js build
```

真实 Electron / Playwright 验证通过：

- 收起态 hover rail 可显示 overlay；固定/收起图标只影响模式，rail 本身不点击切换；
- 右大纲和左资料库宽度独立；
- 悬停态真实鼠标将右大纲从 **233px** 拖到 **308px**；拖动中与松手后（指针仍在面板内）overlay 都保持；鼠标移到编辑器后 overlay 正常隐藏；
- 宽度恢复写回 localStorage（测试结束时已将开发数据宽度还原为 `233px`）；
- 编辑器和大纲 scrollbar 默认 3px、hover 6px。

---

## 4. 当前问题 / 已知限制

1. **无已知 P0/P1 阻塞。**当前大纲功能、右侧交互、悬停 resize 已完成；下一会话的首要工作应是用户手动验收或提交/合并前回归，而不是重写这一套交互。
2. Lake 内核计算 TOC 本身仍可能在大文档、虚拟渲染条件下慢；自建系统消除了原生面板的额外时序/多标签问题，**但没有让内核 TOC 计算本身变快**。
3. 悬停 overlay 覆盖编辑器右端工具栏是“覆盖而非挤压”的固有取舍；固定态没有此问题。若用户继续要求视觉打磨，应先拿截图确认预期，不要自行把 hover 改回占据 grid。
4. 迷你地图/整篇标题位置概览未做。虚拟渲染下视口外标题 DOM 不存在，若要实现需要内核提供位置数据或设计估算策略。
5. 工作区仍有未提交的实现改动。提交前应先查看完整 diff，确认没有把测试数据、临时 Vite 配置或无关文件带入提交。

---

## 5. 下一步计划

### 若用户要继续验收/打磨大纲

1. 用真实开发 Electron 按下面命令启动，优先手测：
   - 右 rail hover 是否只预览、不挤压正文；
   - 图标按钮是否能固定/取消固定；
   - 悬停态和固定态均可拖动右大纲左边缘；
   - 拖动后左侧资料库宽度不变化；
   - 编辑器和大纲滚动条是否正确变窄/悬停变宽。
2. 若还有交互问题，先读 `src/App.tsx` 的 grid 宽度管理和 `OutlineSidebar.tsx` 的 pointer/hover 管理；不要只改 CSS 猜问题。
3. 若要调整宽度参数，同时审阅左侧资料库的边界和 storage key，保持“左右 rail 同为 34px、展开内容独立”的原则。

### 若准备收尾合并

1. 查看 `git diff`、`git diff --check`；不要覆盖现有未提交变更。
2. 再执行 TypeScript、Vitest、Vite build 和真实 Electron smoke test。
3. 以聚焦的提交保存本轮代码和文档；然后同步最新 `master`、解决冲突、完整回归后再将 `research/outline-system` 合回 `master`。

### 后续可选功能

- 评估 Lake 是否有稳定的动态只读 API，避免 Editor / Viewer 重建；自建大纲可为只读锁复用。
- 在不破坏 hover overlay 语义的前提下优化右端工具栏遮挡。
- 研究虚拟渲染下可行的大纲迷你地图。

---

## 6. 踩过的坑 / 不可破坏的约束

1. **不要禁用 TOC 插件。**`disabledPlugins: ["toc"]` 会把内核 TOC 数据一起关掉。桌面端应使用 `toc: { enable: false }` 隐藏原生 UI，TOC 数据和 `tocChange` 仍可用。
2. **不要把右 rail 做成整条可点击按钮。**`.outline-sidebar__rail` 只处理 hover，未来可以放多个 activity button；只有 `.outline-sidebar__activity-button` 切换大纲模式。
3. **不要把左右展开面板宽度绑在一起。**一致的是左右 34px rail，不是左资料库和右大纲的内容宽度。
4. **悬停 resize 需要 pointer capture + 拖动保护。**不得恢复 `mode !== "docked"` 的早退；`pointerleave` 在拖动中不能关闭 overlay；结束时再根据真实落点决定是否隐藏。
5. **滚动条必须写到真实滚动元素。**编辑器是 `.ne-editor-wrap`，不是 `.lake-editor-main` 外壳；大纲是 `.outline-list`。不要重新加入静态正文进度竖线冒充大纲滚动条。
6. **`.lake-editor-main` 要保留 `flex: 1` 和 `min-width: 0`。**缺失时 Lake 内容的最小宽度会撑破右侧固定态的编辑器列。
7. **可见大纲列表已经是扁平前序列表。**`getVisibleItems()` 返回值不能递归 children 再渲染，否则子项重复。
8. **工具栏 active 状态要订阅 controller。**只订阅 outline registry 的版本不会随着 `controller` 内部状态更新而刷新。
9. **React StrictMode 在 dev 会双挂载 effect。**编辑器 cleanup 不能把 host/mount 从 DOM 拔掉；历史上 `host.replaceChildren()` 曾导致第二次挂载的 Lake 编辑器空白。保持 cleanup 只清理 mount 内容，并保留连接性防护。
10. **Node 版本必须是 24。**本机默认 v18 不适合 Vite 8 / Vitest：
    ```bash
    export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
    ```
11. **Vite 配置中的 electron 插件会自动拉起 Electron。**做 Playwright 隔离测试时，不要同时启动普通 `npm run dev` 的 Electron，否则单实例锁会让隔离 Electron 退出。绝不要使用 `pkill -f Electron`，机器上有其它 Electron 应用；只关闭/定位本项目的 PID。
12. **localStorage 测试有写盘时序。**不要用 `removeItem()` 后立即 reload 来赌默认值；需要固定状态时显式 `setItem()`，再 reload/等待。当前右大纲 key 是 `lake-notes-v3.outline-sidebar-width`。
13. **开发数据不可清理。**不得删除 `/Users/admin/Library/Application Support/lake-notes-dev`；更不得碰正式目录 `/Users/admin/Library/Application Support/lake-notes-electron`。
14. **大纲状态是单一全局变量。**不要恢复 per-tab 覆盖模型；无大纲自动悬浮由 `activeOutlineEmpty` 驱动，空文档显式固定的豁免在切标签时清除。
15. **清理测试笔记必须走 UI 删除**（写 tombstone）。直接改 SQLite 会被 S3 同步从远端拉回。

---

## 7. 开发、验证与关键路径速查

### 启动开发应用

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev
```

`npm run dev` 会启动 Vite（`127.0.0.1:1421`）并由 `vite-plugin-electron` 自动启动开发 Electron。

### 静态验证

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
git diff --check
npx tsc --noEmit
npm test
node node_modules/vite/bin/vite.js build
```

### 建议优先阅读的文件

```text
src/App.tsx
src/features/outline/OutlineSidebar.tsx
src/features/outline/outline.css
src/features/outline/OutlineController.ts
src/features/outline/OutlineList.tsx
src/features/outline/useOutline.ts
src/features/editor/EditorTab.tsx
src/features/editor/lakeRuntime.ts
docs/OUTLINE-RESEARCH.md
docs/PROGRESS.md
```

### 分支历史（便于定位）

```text
49f7273 docs: session handoff for outline system work (goals/done/issues/next/pitfalls)
f6b9267 feat(outline): right sidebar docked/collapsed/floating based on the sidebar itself
1891701 fix(outline): right sidebar always present; remove edge tab / hidden state
bbc174c feat(outline): expand-to-level dropdown (1-6 + all) in sidebar toolbar
38e3a55 feat(outline): app-owned outline panel for desktop multi-tab (Phase 1)
8a6046f docs: add siyuan reference study + native-toc-disable safety analysis
81fd5e0 docs: outline system deep-dive research (mechanism + root cause + plan)
```

`7749f26`（编辑器内图标栏）和 `b411727`（旧镜像侧栏）是用户已否决的中间形态；不要以它们为目标回退。
