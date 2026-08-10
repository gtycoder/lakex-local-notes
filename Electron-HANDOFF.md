# Lake Notes Electron 会话交接文档

> 写给完全没有上下文的新会话。开始工作前请先通读本文，再查看 `git status` 和最近提交。
>
> 本文对应项目：`/Users/admin/file/local-lake/lake-notes-electron`

## 1. 当前快照

| 项目 | 当前信息 |
| --- | --- |
| 项目目录 | `/Users/admin/file/local-lake/lake-notes-electron` |
| Git 远程 | `origin = https://gitee.com/gtycoder/local-lake.git` |
| 分支 | `research/outline-system`（已推送 `origin/master` 至 `7be8955`） |
| 最近提交 | `7be8955 fix: stabilize cards, locking, board scroll and remote images` |
| 当前任务 | 多级嵌套、右键菜单定位、表情/公式块交互修复（**本轮 6 个文件尚未提交**） |
| Node | 必须优先使用 Node 24：`$HOME/.nvm/versions/node/v24.18.0/bin` |
| 开发数据 | `/Users/admin/Library/Application Support/lake-notes-dev`，禁止删除或清理 |
| 正式数据 | `/Users/admin/Library/Application Support/lake-notes-electron`，禁止触碰 |

### 绝对不能做的事情

- 不要执行 `git reset`、`git checkout -- .`、`git clean -fd` 等会丢弃工作区的命令。
- 不要覆盖或删除其他未提交修改；先看 `git status` 和 `git diff`。
- 不要修改 `node_modules`。
- 不要删除或直接修改开发/正式用户数据目录（SQLite 只允许只读查询）。
- 不要使用 `pkill -f Electron`；机器上还有 Trae、SiYuan、VS Code 等其他 Electron 应用。
- 清理测试笔记必须走应用 UI 删除流程，不能直接改 SQLite，否则可能被 S3 同步恢复。
- 不要改 `lake-notes-dev` 里非自己创建的笔记内容；测试后要把自己插入的卡片/字符清理掉。

## 2. 任务目标（本轮）

1. 资料库目录支持**多层嵌套**：文档下可建分组/文档，分组下可建文档/分组（此前 store 强制 note 不能作为父节点，右键文档的“新建文档/新建分组”会报 `笔记不能作为父节点`）。
2. 右键菜单定位错位（出现在光标右下方），需要精确显示在光标处。
3. 插入表情/公式后：**点“表情”直接弹出表情选择器**、点“公式”直接弹出公式编辑器，不再需要“先点一下方框、再点别处、再点方框”三步；同时“第一次点击方框”就能打开。

## 3. 已完成内容

### 3.1 多级嵌套（文档可作父节点）

相关文件：

- `electron/store.ts`
- `electron/store.test.ts`
- `src/components/Sidebar.tsx`

实现：

- `assertParentCompatible` 放宽为：notebook 只能位于根层；note/group 必须位于某个节点下（**父节点类型不限**，note 也可以当父节点）。
- `Sidebar` 的“创建上下文”直接用当前选中/右键的节点作父节点（不再上溯到最近的笔记本/分组）；右键菜单“新建文档/新建分组”也直接以目标节点为父节点。
- 删除 `findContainerAncestor`（无残留引用）。
- 树渲染/`subtreeIds`/`expandAncestors`/`autoExpanded` 本来就支持任意嵌套，无需改动。
- 同步不感知层级（manifest 只同步 note 的 `parentId` 字符串），多级嵌套不破坏 S3 同步。
- `store.test.ts` 对应测试更新为“支持多层嵌套，notebook 仍只能位于根层”。

### 3.2 右键菜单定位（Portal）

相关文件：

- `src/components/Sidebar.tsx`
- `src/styles.css`

根因：桌面模式下 `.sidebar` 恒有 `transform: translateX(0)`，CSS 规定 `transform`（即使恒等变换）会让内部 `position: fixed` 退化为**相对侧边栏**定位，于是 `.context-menu` 整体偏移到光标右下（约 活动栏+顶栏 的距离）。

修复：

- `ContextMenu` 用 `createPortal(..., document.body)` 渲染，恢复真正的视口固定定位。
- `.context-menu` 的 `z-index` 由 40 提到 600（避免被侧边栏 z-index:250 盖住）。
- 点击外部关闭逻辑不变（document 层监听 `[data-context-menu]`）。

### 3.3 表情/公式块：直接弹出选择器/编辑器

相关文件：

- `src/features/editor/lakeRuntime.ts`
- `src/features/editor/LakeEditor.tsx`

#### 根因一：表情选择器空白（0×0 方框）

- 编辑态 `disabledPlugins` 里一直禁用了 `"emoji"` 插件（基线就如此）。
- unicodeEmoji 卡片的选择器（`.ne-ui-unicode-emoji-panel`）依赖默认表情数据（8 组、1467 个表情），禁用后面板渲染成 0×0 空壳。
- 修复：**编辑态不再禁用 `emoji` 插件**（Viewer 只读态仍禁用：`["save","toolbar","emoji"]`）。

#### 根因二：插入后不自动弹出

- Slash 插入命令会把选区放进卡片并调用卡片 `focus()`（表情→`openOverlay()` 开选择器；公式→`rerender({focus:true})` 开编辑器）。
- 但卡片 UI 是**懒初始化**的：`_uiViewProxy`/`_$cardUI` 未就绪时 `focus()` 是空操作；且选区已停在卡片内，导致之后点击不再触发 focus。
- 修复：`lakeRuntime.ts` 新增 `setupInsertedCardAutoOpen(host)`（仅编辑态接入，随 `__disposeExtras` 释放）：
  - 监听编辑器 DOM（MutationObserver，防抖 60ms）与卡片 mousedown（捕获阶段）；
  - 命中 `ne-card[data-card-name="unicodeEmoji"|"math"]`：
    - 插入后若 `window.getSelection()` 锚点落在卡片内 → 对 `card._neRef._virtualNode._instance._$cardUI.focus()` 做**有限重试**（最多 12 次 × 80ms），UI 就绪后自动弹出；
    - 点击方框时直接触发（无需选区先落进卡片），覆盖“第一次点击方框无效”；
  - `seen` 集合按卡片 id 去重，已打开的卡片不会重复弹（不干扰正常的关闭/切换/换表情）。
- `LakeEditor.tsx`：编辑器宿主上加捕获阶段 `mousedown`，命中 `.ne-card-unicode-emoji, .ne-math-entry` 时 `preventDefault()`（防失焦，保住编辑器选区）。

已实测（真实 UI）：

- `/` → 表情 → 选择器**直接弹出**，带完整内容（231 个表情、最近使用、搜索框）✅
- `/` → 公式 → 插入“添加 TeX 公式”方框；公式编辑器自动弹出在测试时显示 0×0（疑似 DevTools 挤窄窗口 + 卡片在文档末尾的布局环境问题），**待用户在实际使用中确认**。

## 4. 当前问题 / 当前状态

- 用户已确认：多级嵌套、右键菜单定位、表情直接弹出选择器均正常。
- **待确认**：公式块插入后编辑器是否直接弹出（用户验证中）。
- 无已知 P0 阻塞。
- 自动化验证已通过：

```text
npx tsc --noEmit
npm test -- --run        # 8 个测试文件 / 126 个测试通过
node node_modules/vite/bin/vite.js build
git diff --check
```

- 本轮改动（**未提交**）：

```text
 M electron/store.test.ts
 M electron/store.ts
 M src/components/Sidebar.tsx
 M src/features/editor/LakeEditor.tsx
 M src/features/editor/lakeRuntime.ts
 M src/styles.css
```

## 5. 下一步计划

1. 用户确认公式块自动弹出；若仍异常，优先检查：
   - 数学编辑器 popover 渲染位置（`.ne-inner-overlay-container` / `.ne-ui-boundary-popover`）与卡片是否在视口内；
   - `setupInsertedCardAutoOpen` 的 `overlayOpened()` 是否被 0×0 误判（`[data-testid="ne-math-editor"]` 需宽高 >0 才算打开）。
2. 用户确认后提交并推送本轮改动（不要动 `origin/master` 已有提交，只在其上追加）。
3. 常规回归：
   - 多级嵌套：右键文档建分组/文档、分组建文档/分组、拖拽移动、删除子树；
   - 右键菜单位置（侧边栏中部/底部、窗口边缘翻转）；
   - 表情/公式插入与点击；
   - 既有功能回归：锁定/解锁滚动位置、画板、代码块新建、图片下载、大纲。

## 6. 踩过的坑

### 本轮新增

1. **不要禁用 `emoji` 插件。** unicodeEmoji 卡片的表情选择器数据依赖它；禁用后选择器渲染成 0×0 空壳，表现为“方框点了没反应”。`disabledPlugins: ["emoji"]` 只应保留在 Viewer。
2. **卡片名在 `ne-card.dataset.cardName`，UI 控制器在 `_neRef._virtualNode._instance._$cardUI`。** `ne-card._neRef` 只是节点引用（无 `focus()`），直接对它调 `focus()` 是无效的。
3. **卡片 UI 懒初始化**导致插入后 `focus()` 空操作（`_uiViewProxy`/`_$cardUI` 未就绪），且选区已停在卡片内使后续点击不再触发——需要“重试 focus 直到 UI 就绪”或“点击时直接触发”。
4. **`.sidebar` 恒有 `transform: translateX(0)`**，会让内部 `position: fixed` 退化为相对侧边栏定位，弹层/菜单偏移到光标右下。弹层类 UI 应 `createPortal` 到 `document.body`。
5. 拖动/键盘清理编辑器内容时，Backspace 计数与 DOM 结构不一定一一对应；清理测试残留后务必核对保存的 `.lake` 文件（`python3` 只读检查 `name="math"` / `name="unicodeEmoji"` 数量）。

### 既有（保留）

6. **不要全量重定向 `gw.alipayobjects.com`。** 它同时承载运行时 CDN 和用户图片；只能按本地镜像文件存在性精确重定向。
7. **不要禁用 `toc` 插件。** 桌面端应使用 `toc: { enable: false }`，禁用插件会让 TOC 数据一起消失。
8. **Viewer 不一定注入 `editor`。** 锁定态自定义卡片（如思维导图）需要兼容层注入最小主题结构。
9. **Viewer 和 Editor 的真实滚动容器不同。** 编辑态 `.ne-editor-wrap`，锁定态 `.ne-viewer`。
10. **画板新增元素不一定触发 Lake `contentchange`。** 需要 Drawnix `onChange` 路径派发 `lake-board-contentchange` 专属事件；恢复 scrollTop 不能每个 scroll/RAF 都写。
11. **React StrictMode 会双挂载 effect。** cleanup 不能把 host/mount 从 DOM 拔掉。
12. **不要用旧代码块资源。** 统一使用新版 Lake CodeMirror 7.1.3 镜像（`./vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js`）。
13. **不要删除用户数据目录来解决问题。** 单实例锁用正常关闭流程。
14. **构建输出中的大 chunk 警告不是本轮失败。** 先区分 warning 与真正的类型/测试/运行时错误。
15. **不要把“关闭再打开后恢复”误认为已解决。** 通常说明新建/初始化路径没完成卡片水合。

## 7. 关键命令

### 静态检查

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
npm test -- --run
node node_modules/vite/bin/vite.js build
git diff --check
```

### 启动开发版

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev
```

`npm run dev` 会启动 Vite `127.0.0.1:1421` 并由 vite-plugin-electron 拉起开发版 Electron；改动 `electron/*.ts` 主进程代码会自动重建重启，改动 `src/**` 渲染进程代码 HMR。

### 只读检查开发库

```bash
DB="/Users/admin/Library/Application Support/lake-notes-dev/workspace-default/metadata.sqlite3"
sqlite3 "file:${DB}?mode=ro" "SELECT id, parent_id, node_type, title FROM tree_nodes WHERE deleted_at IS NULL;"
```

### 关键排查文件

```text
src/App.tsx
src/components/Sidebar.tsx
src/features/editor/MultiTabEditor.tsx
src/features/editor/EditorTab.tsx
src/features/editor/LakeEditor.tsx
src/features/editor/lakeRuntime.ts
src/features/editor/BoardCard.tsx
src/features/editor/resourceUpload.ts
electron/main.ts
electron/store.ts
electron/cdnRedirect.ts
src/features/outline/
src/styles.css
```
