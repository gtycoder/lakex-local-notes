# Lake Notes Electron — 会话交接（大纲自建系统 · 2026-08-05）

> **读者：完全没有上下文的新会话。先读本文，再开始改代码。**
>
> 本会话的核心工作：把桌面端多标签的 Lake 原生大纲，重写为**应用自有的右侧大纲栏系统**
> （含数据管线、渲染、工具栏、子弹线/级别/滚动增强）。功能基本完成、可运行，但**右侧栏的
> 「收起/悬停」交互仍未达到用户预期**（见 §4），交接时工作区停留在 `research/outline-system`
> 分支。下一会话请先复现并解决 §4，再继续 §6 的计划。

---

## 1. 当前快照

| 项目 | 状态 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| 分支 | `research/outline-system`（相对 `master` 领先 12 个提交，未合回） |
| 基线 | `master` @ `69c3b74`（小记 V1 完成后的旧交接） |
| 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| Git 工作区 | `Electron-HANDOFF.md`（本文）+ 临时截图未提交；其余干净 |
| 开发应用 | 可通过 `npm run dev` 启动（Node 24，见 §7）；当前已停止 |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev` **含用户测试内容，勿删** |
| 正式数据 | **未触碰** `/Users/admin/Library/Application Support/lake-notes-electron` |

> 注意：`lake-notes-dev` 里有用户自己输入的测试笔记（欢迎笔记含"指数/集合竞价/盘口名词…"等
> 多级标题，正是大纲测试数据）。**不要删除该目录**。

---

## 2. 任务目标（本会话）

用户原话拆解：

1. 大纲存在 2 个问题：① 打开文档后大纲延迟 ~3s 出现、略有卡顿；② 各类修改大纲频繁出问题。
2. 结合此前"单篇只读锁"的失败经验，决定对大纲做**深入研究并逐步重写**，目标是：
   - 支持多标签（原生 absolute/fixed 大纲不适配）；
   - 为后续自定义（子弹线、级别展示、滚动更明显）打基础；
   - 长期为只读锁复用一套稳定的大纲（锁定时大纲不依赖 Viewer 原生 fixed 侧栏）。
3. 用户对**右侧栏形态**的期望反复调整，最终期望（§4 详述）：常驻/收起/悬停都基于右侧边栏本身。

---

## 3. 已完成内容

### 3.1 机制研究（文档 `docs/OUTLINE-RESEARCH.md`，提交 81fd5e0 / 8a6046f）

- 当前大纲 = Lake 原生能力 + 我们 3 处应用层补丁（`refreshTocSidebar`、`setupTocScrollFollow`、`resolveScrollNode`+CSS 高度链）。
- 内核 TOC 管理器（PluginName `toc`）**无 PluginOption、永远运行**：`toc:{enable:false}` 只关编辑侧栏 UI，
  数据（`getDocExtraContent().toc`）与事件（`tocChange`）照常。
- **禁用 `disabledPlugins:["toc"]` 会连内核数据一起禁用，禁止使用。**
- 编辑侧栏 `tocChange` 处理是 **debounce 1000ms（leading，首次立即）**；阅读侧栏无 debounce。
- 打开延迟 ~3s 主因：内核 toc 数据在 `setDocument` → `aftercontentchange` 后才计算（大文档+虚拟渲染最慢）；
  原生侧栏先空后填；我们的轮询只是等待数据就绪。
- 开源 lake-main（lakelib 0.4.6）**没有 TOC**，TOC 是语雀内部新增，只能以 node_modules 打包产物为权威参考。
- 思源参考：`/Users/admin/file/local-lake/siyuan`（app/src/layout/dock/Outline.ts + util/Tree.ts）——
  事件驱动更新、保留选中/滚动位置、块模型高亮、展开集合持久化、工具栏等可借鉴点已记录在文档 §8。

### 3.2 实现（提交 38e3a55 起）

**架构（当前生效）**：

```
src/features/outline/
  OutlineController.ts   # 数据/状态：树构建(按depth嵌套)、折叠集合(noteId 持久化)、
                         #   选中、filterText、keepCurrentExpand、scrollProgress；useSyncExternalStore 订阅
  OutlineList.tsx        # 渲染：层级引导线(子弹线)+叶子圆点、级别徽标 H1..H6、
                         #   折叠、选中高亮、选中项滚入可视区(点击平滑)、滚动进度条
  OutlineSidebar.tsx     # 侧栏外壳：docked(280)/collapsed(44窄条)/floating(悬停浮层)；
                         #   头部工具栏：筛选、展开全部/折叠全部、展开到级别(1-6+全部)、
                         #   保持当前展开(持久化)、收起大纲按钮
  registry.ts            # EditorTab 按 noteId 注册 {controller,navigate,refresh}，侧栏按 activeNoteId 读取
  useOutline.ts          # 订阅内核 tocChange + 打开轮询、rAF 滚动高亮、虚拟渲染批次后重算、
                         #   tab 隐藏暂停、卸载全清理；返回 {controller, refresh}
  outline.css
```

- `lakeRuntime.ts`：`LakeEditorPrefs.disableNativeToc`（桌面 EditorTab 置 true → 原生侧栏彻底不创建）；
  导出 `resolveScrollNode`。
- `EditorTab.tsx`：编辑器挂载到 `.lake-editor-main`；注册大纲句柄；点击导航 =
  `renderer.execCommand("headingUnfold",id)` + `renderer.scrollByNodeId(id)` + 50/200ms 两次校正。
- `App.tsx`：`outlineMode`（docked/floating/collapsed）、app-shell 网格第 4 列 `--outline-grid-w`
  （docked=280 / collapsed&floating=44 / 隐藏=0）、渲染 `OutlineSidebar`。
- 移动端（`LakeEditor`）完全未动，仍用原生 TOC。
- 测试：`src/features/outline/OutlineController.test.ts` 12 项；全项目 `npm test` = 123 全绿。

**功能现状**（真机 Playwright 已验证）：
- 常驻 280px 侧栏贴最右边缘，正文收缩；收起 → 44px 窄条（仍是最右列）；点击窄条 → 常驻。
- 悬停：hover 窄条 → **fixed 浮层**（right:0 覆盖正文，grid 列保持 44）→ 移出恢复收起。
- 筛选/展开折叠/展开到级别/保持当前/子弹线/级别徽标/滚动进度条/折叠持久化全部可用。
- 原生 `.ne-toc-sidebar` = 0（桌面编辑模式彻底不创建）；打开大纲 ~0.5s（小文档）。

---

## 4. 当前问题（最重要，下一会话先解决）

### 4.1 用户对右侧栏形态的最终期望（2026-08-05 多次反馈归纳）

用户参考的是**思源（SiYuan）右侧 dock 大纲**（截图参考：docs/OUTLINE-RESEARCH.md §8 与图例）：
"常驻和悬停都是基于右侧边栏出来的"。

- **右侧边栏 = 一个始终存在的列**：展开时 280px 完整面板；收起时 44px 窄条（仍是侧栏本身，不是悬浮标签）。
- **悬停 = hover 收起窄条时，侧栏"原地展开"**成完整面板（覆盖正文、带阴影），而不是变成一个脱离侧栏的浮层。
- **点击窄条 = 常驻**；头部「收起大纲」= 收起。

### 4.2 当前实现与期望的差距

当前 `floating` 态实现是 `position: fixed` 的**独立浮层**，同时 grid 列缩为 44px。
用户最后一句反馈："大纲展开的时候我右侧边栏呢" —— 即悬停展开时，右侧的"侧栏列"不见了
（只剩 44px 条 + 一个浮在正文上的面板），与"侧栏原地展开"的预期不符。

**修复方向（未实现，供新会话参考）**：悬停展开应让**侧栏列本身**在 44→280 之间变化：
- 方案 A（推荐，与左侧栏移动端 `.sidebar.is-collapsed:hover` 一致）：collapsed 时 grid 列保持 44，
  悬停时该列 `width:280px; z-index 抬高; box-shadow` 覆盖正文（CSS transition），鼠标移出恢复 44。
  即"侧栏原地膨胀"，不再用 fixed 浮层。
- 方案 B：悬停时 grid 列直接变 280（正文收缩），移出回 44——会有布局跳动，不推荐。
- 关键点：**无论哪种，展开的都是"右侧栏"本身**，视觉上始终贴右缘、无独立 rail、无边缘小标签。

> 该交互是本会话唯一未闭环的问题。建议先起 dev 复现（收起 → hover 窄条看当前 fixed 浮层），
> 再改成原地展开，真机验收后再继续 §6。

### 4.3 其余已知差距（非阻塞）

- 大文档打开延迟的主导仍是**内核 toc 计算耗时**（自建大纲只消除了渲染链额外延迟，未加速内核）。
- 侧栏宽度暂固定 280，未做拖拽调宽；悬浮态会盖住编辑器工具栏右端（overlay 固有取舍）。
- 迷你地图（整篇滚动条+标题位置）未做；虚拟渲染下视口外标题无 DOM，做迷你地图需内核提供标题位置/估算高度。

---

## 5. 踩过的坑（务必记住，别重蹈）

1. **React.StrictMode 在 dev 双次挂载 effect**：EditorTab cleanup 若用 `host.replaceChildren()`
   会把 `.lake-editor-main` 移出 DOM，第二次 effect 在脱离文档的节点上重建 Lake 编辑器 →
   `to-dom-range.ts:46` 断言 + 空白编辑器。**cleanup 只 `mount.replaceChildren()`**，且 effect 开头
   若 `!mount.isConnected` 先 `host.appendChild(mount)`。（生产构建不双挂载，所以只看生产会漏。）
2. **`disabledPlugins:["toc"]` 会连内核 TOC 数据一起禁用**，必须用 `toc:{enable:false}`。
3. **收起/窄条刚出现时光标正好在上 → 立刻又展开**：需要"进入收起态时重置 500ms hover 冷却"
   （`useEffect` 监听 mode 变化重置 `mountTimeRef`），不能只在组件挂载时记一次。
4. **localStorage 的 removeItem + 立即 reload 有磁盘刷新竞态**（测试会读到旧值）：
   测试初始状态用 `setItem` + 等 1.5s 再 reload，或直接靠 UI 点击驱动，别依赖"清 key 后 reload 就是默认值"。
5. **Playwright（node_repl MCP）动态 `import("playwright")` 报 CJS 互操作错误**：
   用 `createRequire("/Users/admin/file/local-lake/drawnix-develop/x.js")("playwright")` 加载
   （兄弟项目 drawnix-develop 里有一份可用的 playwright）。
6. **Node 版本**：vite 8 / vitest 需要 Node ≥20.12，本机默认是 v18（`/Users/admin/.nvm/versions/node/v18.20.8`），
   必须 `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`。
7. **面板在工具栏之下**：工具栏高 50px；docked 用 `margin-top:50px; height:calc(100% - 50px)`；
   **不要**把 margin-top 规则写成对所有 below-toolbar 面板生效（会与 floating 的 `top:50px` 叠加成双偏移）。
8. **`.lake-editor-main` 必须 `flex:1 + min-width:0`**，否则 Lake 内容最小宽度会把编辑器撑出主列
   （真机实测编辑器 1109px 溢出 704px 主列，被右侧栏盖住）。
9. **扁平可见列表 + 递归渲染 = 子项重复**：`getVisibleItems()` 已是前序扁平列表，渲染必须扁平，
   不要再对 children 递归。
10. **侧栏头部按钮的 is-active 要订阅 controller**（useSyncExternalStore on controller），
    只订阅 registry 版本不会随 controller 变化刷新。
11. **dev/打包版单实例锁 + 端口 1421**：测试前先 `lsof -ti tcp:1421 | xargs kill -9`，
    清理进程只按 `lake-notes-electron` 精确匹配，禁止 `pkill -f Electron`。
12. **删除笔记后 `device_state.last_opened_note_id` 残留** → 启动自动打开失败报
    `read_note: 笔记不存在`：需直接改 `metadata.sqlite3` 的 device_state 表。
13. 原生 TOC 的 `refreshTocSidebar`（重放 tocChange + 轮询）与 `setupTocScrollFollow`
    是"修到能用"的补丁；桌面编辑模式已不创建原生侧栏，这些仅移动端/历史路径在用，别删错。

---

## 6. 下一步计划

1. **P0（下一会话第一件事）**：修复 §4 的悬停交互 —— 收起窄条 hover 时"侧栏原地展开"（方案 A），
   真机验收（收起→hover→展开贴右缘→移出恢复；点击窄条常驻；头部收起）。
2. **P1 打磨**：侧栏宽度拖拽调宽（参考左侧 Sidebar 的 resize-handle）；悬浮态工具栏右端遮挡取舍；
   可选：迷你地图（需先解决虚拟渲染下标题位置数据）。
3. **P2 只读锁前置评估（原 Phase 3）**：确认 Lake 是否有稳定动态只读 API（避免 Editor↔Viewer 重建）；
   大纲已与应用 UI 解耦，锁定时可复用同一套大纲。届时再决定锁状态是否入 SQLite/S3（外围元数据、不改 `.lake` 正文、
   小记不受影响、移动端不提供锁定）。
4. 稳定后：把 `research/outline-system` 合回 `master`（先与最新 master 同步、跑全量回归）。

---

## 7. 开发与验证速查

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"   # Node 24（必须）
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev          # vite dev(1421) + Electron（vite-plugin-electron 自动拉起）
npm test             # vitest（123 项）
npx tsc --noEmit
node node_modules/vite/bin/vite.js build
```

- 真实 GUI 验证：`docs/CODEX-GUIDE.md`（Playwright 驱动 Electron，模板可直接用；playwright 加载见 §5.5）。
- 关键文件：`src/App.tsx`、`src/features/outline/*`、`src/features/editor/{EditorTab,lakeRuntime}.tsx/.ts`、
  `src/styles.css`、`src/features/outline/outline.css`、`docs/OUTLINE-RESEARCH.md`。
- 数据：dev = `lake-notes-dev`（勿删，含用户测试内容）；正式 = `lake-notes-electron`（勿动）。

---

## 8. 本会话提交清单（research/outline-system，自 master 起）

```text
81fd5e0 docs: outline system deep-dive research (mechanism + root cause + plan)
8a6046f docs: add siyuan reference study + native-toc-disable safety analysis
38e3a55 feat(outline): app-owned outline panel for desktop multi-tab (Phase 1)
b5ea748 fix(outline): keep editor mount node connected across StrictMode double-mount
7749f26 feat(outline): rail icon bar with hover popup + toolbar offset (Plan A)   [已被后续取代]
b411727 feat(outline): right sidebar mirroring left sidebar (docked/collapsed/floating) [已被取代]
6882032 docs: record right-sidebar redesign (replaces in-editor rail)
0a3c754 feat(outline): right sidebar at far edge + Phase 2 (guides/levels/toolbar/scroll)
a389fa2 docs: record feedback fixes + Phase 2 progress
bbc174c feat(outline): expand-to-level dropdown (1-6 + all) in sidebar toolbar
1891701 fix(outline): right sidebar always present; remove edge tab / hidden state
f6b9267 feat(outline): right sidebar docked/collapsed/floating based on the sidebar itself
```

> `7749f26`（编辑器内图标栏）与 `b411727`（带独立 rail 的镜像侧栏）是用户否决的中间形态，
> 只作历史参考，不要回退到那两版。
