# 顶栏弹框与新建菜单布局修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复桌面顶栏工作空间/同步弹框的锚点与外点关闭，并压缩窄目录栏下的新建菜单高度。

**Architecture:** 保留资料库和小记工作区的 keep-alive。将顶栏菜单的关闭边界从全局 selector 改为每个菜单组件持有的 wrapper ref，并让同步弹框在共享 ref 指向隐藏副本时选择可见按钮。新建菜单保留现有交互和数据逻辑，但改为 portal + fixed 定位，按侧栏实际宽度计算菜单尺寸和位置。

**Tech Stack:** React 18、TypeScript、Vitest、CSS、Vite/Electron。

---

### Task 1: 为顶栏外点关闭和可见锚点补测试护栏

**Files:**
- Create: `src/hooks/useTopMenus.test.ts`
- Modify: `src/components/SyncStatusPopover.test.tsx`（若已有则追加；当前先检查文件是否存在）

- [ ] **Step 1: 检查现有测试结构和测试脚本**

Run:
```bash
cd /Users/admin/file/local-lake/lake-notes-electron
find src -maxdepth 3 -type f -name '*SyncStatusPopover*.test.*' -o -name 'useTopMenus.test.*'
cat package.json | sed -n '/"scripts"/,/},/p'
```
Expected: 确认测试文件是否已存在，并使用项目已有 Vitest + Testing Library 约定。

- [ ] **Step 2: 写失败测试**

为 `useTopMenus` 的 DOM 边界测试覆盖两个 wrapper 同时存在时，点击当前 workspace wrapper 内部不会误关菜单，点击 wrapper 外部会关闭。若项目没有 hook 渲染测试依赖，则将纯 DOM 命中判断提取为无 React 的 helper，并针对 helper 写测试，避免新增依赖。

为同步弹框添加一个纯函数测试：给定一个隐藏按钮和一个有非零 `getBoundingClientRect()` 的按钮，选择后者作为锚点。

- [ ] **Step 3: 运行针对性测试确认失败**

Run:
```bash
npx vitest run src/hooks/useTopMenus.test.ts src/components/SyncStatusPopover.test.tsx
```
Expected: 新增行为测试在实现前失败，或因测试文件不存在而按项目实际结构调整测试位置。

### Task 2: 修复顶栏菜单的 ref 边界与定位

**Files:**
- Modify: `src/hooks/useTopMenus.ts`
- Modify: `src/desktop/DesktopTopBar.tsx`
- Modify: `src/desktop/DesktopOverlays.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 将 `useTopMenus` 改为接收 wrapper ref**

保留现有状态 API，新增 `workspaceMenuRef` 和 `moreMenuRef`，外点关闭时通过 ref 判断事件目标，而不是 `document.querySelector()`。两个菜单分别判断自己的 wrapper 和 portal 菜单节点；点击另一个顶栏触发器时关闭当前菜单并由触发器逻辑打开另一个菜单。

- [ ] **Step 2: 让工作空间 portal 使用当前 wrapper 坐标**

在 `DesktopOverlays.tsx` 中为 workspace portal 使用 `wsMenuWrapRef.current.getBoundingClientRect()` 的 `bottom` 与 `left`，保留 fixed 定位和窗口边界约束；不要再使用零坐标 fallback 作为正常路径。菜单应在目标 wrapper 缺失时不渲染或使用安全的窗口内 fallback。

- [ ] **Step 3: 让同步弹框选择可见同步按钮**

在 `SyncStatusPopover.tsx` 中为共享 ref 增加可见锚点解析：共享 ref 当前元素的 rect 若宽高为零，查找 `.sync-status-button` 实例，选择 `getBoundingClientRect()` 宽高均大于零且 computed style 非隐藏的实例。将坐标计算封装为纯函数，确保 `left` 和 `top` 都限制在窗口范围内。

- [ ] **Step 4: 修正工作区切换/窗口变化后的坐标刷新**

打开弹框时以及 `resize`/`scroll` 时更新坐标 state；工作区切换时关闭顶栏菜单，避免隐藏工作区的菜单残留。同步按钮再次点击仍然只切换当前弹框状态。

- [ ] **Step 5: 运行测试和类型检查**

Run:
```bash
npx vitest run src/hooks/useTopMenus.test.ts src/components/SyncStatusPopover.test.tsx
npx tsc --noEmit
```
Expected: 新增测试通过，类型检查通过。

### Task 3: 收紧新建菜单尺寸

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Create: `src/components/createMenuPosition.ts`
- Create: `src/components/createMenuPosition.test.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: 先覆盖窄侧栏定位回归**

测试 `getCreateMenuPosition`：当侧栏宽度为 156px、按钮由于工具栏最小宽度溢出到 `right=213` 时，菜单宽度收缩到 150px，且菜单右边界仍留在侧栏右边界以内。

- [ ] **Step 2: 将新建菜单 portal 到 body**

在 `Sidebar.tsx` 中为新建按钮和菜单分别维护 ref；菜单打开时根据按钮和侧栏的 `getBoundingClientRect()` 计算 fixed 坐标，通过 `createPortal` 渲染到 `document.body`，并让外点关闭同时识别触发器和 portal 菜单。

- [ ] **Step 3: 调整现有 `.create-menu` 尺寸**

保留三个选项和副标题，收紧菜单 padding、菜单项 `min-height`、上下 padding和副标题间距；CSS 继续提供桌面默认宽度，打开时由 inline width 覆盖为侧栏内可用宽度。

- [ ] **Step 4: 添加窄目录栏视觉回归检查**

使用已有 dev server 或生产构建，在目录栏收窄后打开 `+` 菜单，确认菜单的 bottom 不超过可视区域，三个按钮均可点击，文本不发生垂直裁切。

### Task 4: 完整验证

**Files:**
- Modify: only files from Tasks 1–3 if verification发现问题

- [ ] **Step 1: 运行完整测试**

Run:
```bash
npm test -- --run
```
Expected: 全部测试通过，基线不回退。

- [ ] **Step 2: 运行构建和 diff 检查**

Run:
```bash
node node_modules/vite/bin/vite.js build
git diff --check
git status --short
```
Expected: 构建成功、无 whitespace 错误，并只包含本次 UI 修复及其未提交设计/计划文档。
