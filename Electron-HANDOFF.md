# Lake Notes Electron 交接文档（入口 / 完整交接）

> **给零上下文的新会话：先读本文，再读 `docs/CODEX-GUIDE.md`（Playwright 驱动真实 Electron
> 实测是本项目的正确姿势），然后按需读 `docs/PROGRESS.md` / `docs/ARCHITECTURE.md` 等。**
> 本文 = 文档索引 + **★ 最新交接（2026-08-04 Apple 风格管理外壳）全记录**。修改代码前先读完相关文档。

---

## 项目一句话

**Lake Notes** 是一个 Electron + 语雀 Lake 编辑器（`lakex-editor-react-component` 封装的内核）的
**本地优先笔记应用**：`.lake` 文件存本地、SQLite 存元数据、S3 兼容备份同步、虚拟渲染优化大文档、
资源归一化（图片本地化）、支持多标签编辑、全文导出 Markdown。

## ★ 最新交接（2026-08-04）：思源式管理外壳 + Apple 风格界面原型

> **当前工作的第一原则：用“思源式”的管理方式管理 Lake，但不改变 Lake 编辑器本身。**
> 管理外壳可以重排、变窄、悬浮、增加克制动效；Lake 继续独立负责格式工具栏、正文、卡片、右侧大纲和虚拟渲染。

### 0. 新会话先看这里

- 项目目录：`/Users/admin/file/local-lake/lake-notes-electron`
- 当前开发分支：`design/apple-shell-prototype`
- master 基线：`d537428`（当前 master 未被本轮 UI 工作改动）
- 本轮分支提交：
  - `bc424ad feat: add Apple-style Lake management shell`
  - `eafdf92 refine sidebar hover and titlebar layout`
- 当前分支相对 master 只改了 4 个文件：
  - `src/App.tsx`
  - `src/components/Sidebar.tsx`
  - `src/features/editor/MultiTabEditor.tsx`（仅很小的标签栏提示调整）
  - `src/styles.css`
- 本轮代码提交后工作区原本是干净的；本交接文档本身会形成新的文档改动/提交。
- **不要直接切到 master 继续开发，也不要把分支合入 master。用户明确要求先在设计分支充分验证。**
- 用户尚未对 2026-08-04 最终版本给出最后验收意见；下一会话应先让用户体验，再按反馈微调。

### 1. 任务目标

用户希望在保留所有已有功能的前提下，把应用管理层改造成更接近思源笔记和 macOS 原生应用的界面：

1. 用思源式左侧管理结构包住 Lake 编辑器：左侧活动工具轨 + 可固定/可悬浮的资料库树。
2. Lake 编辑器保持原生行为和样式，不因外壳或动效修改编辑器内部逻辑。
3. 左侧不增加“最近”和“收藏”；资料库仍是既有笔记本/分组/文档树。
4. 多标签使用轻量胶囊样式。
5. Lake 原生格式工具栏必须常驻（除非用户在既有偏好设置中主动隐藏）。
6. 底部状态栏必须保留字数、本地保存状态、同步状态、Markdown 导出等功能，但可以更薄、更克制。
7. Apple 风格重点放在层级、材质、间距、反馈和可中断动效，不堆叠无意义动画。
8. 所有 UI 原型和实现先在独立分支完成并由用户验证，未经验证不得改动 master。

用户第二轮的明确反馈是：

- 左侧活动栏和资料库都要进一步缩窄。
- 悬浮资料库不应先点击：鼠标放到文档图标上就弹出；点击文档图标才表示固定/取消固定。
- 资料库标题栏不再需要图钉和收起按钮。
- 标签栏应融合进 macOS 窗口顶栏，像思源一样释放纵向编辑空间。
- 左活动轨已有“同步”和“设置”入口，因此底栏不应再保留重复齿轮和同步按钮；但同步**状态文本**仍需保留。

### 2. 不可破坏的产品与代码边界

以下约束是用户反复确认过的，后续修改必须继续遵守：

- 不修改 `src/features/editor/LakeEditor.tsx`。
- 不修改 `src/features/editor/EditorTab.tsx`。
- 不修改 `src/features/editor/lakeRuntime.ts`。
- 不为外壳新增 `.ne-*`、`.lake-editor-*`、Slate、Board card 等 Lake 内部选择器覆盖。
- 不把格式工具栏搬出 Lake，也不重写它的样式和交互。
- 不改变 Lake 卡片、表格、代码块、TOC、虚拟渲染或滚动容器行为。
- 外壳只负责：活动工具轨、资料库树、侧栏状态、多标签外观、设置/同步入口、底部状态栏和外壳级动效。
- 移动端仍走原有 `MobileLibrary` / 文档阅读编辑流程，桌面外壳 CSS 以 `@media (min-width: 761px)` 隔离。
- 动效必须支持 `prefers-reduced-motion`，并优先使用 `transform` / `opacity`。

### 3. 已完成内容

#### 3.1 第一轮：Apple 风格管理外壳（`bc424ad`）

- 新增桌面左侧活动工具轨：
  - 文档/资料库入口
  - S3 云同步入口
  - 偏好设置入口
- 新增资料库三种内部状态：
  - `docked`：常驻并占布局宽度
  - `floating`：覆盖在编辑区上方，不挤压正文
  - `collapsed`：隐藏，仅保留活动工具轨
- 资料库支持拖拽调宽和键盘调宽，宽度持久化。
- 资料库树、搜索、创建、重命名、拖拽移动、删除、同步圆点等原功能全部保留。
- 多标签改成轻量胶囊形式，关闭按钮和未保存圆点保留。
- 底部状态栏压缩为 24px，仍保留仓库说明、字数、通知、MD 导出、保存状态和同步状态。
- 设置面板、同步面板、确认对话框和应用自有菜单统一为轻量半透明材质。
- 加入克制的 hover、press、侧栏滑入、树节点展开和提示出现动效。
- 侧栏宽度和模式使用 localStorage 持久化。
- 加入 reduced-motion 降级。

#### 3.2 第二轮：悬停资料库 + 融合顶栏（`eafdf92`）

- 活动工具轨宽度从 48px 缩到 **44px**，按钮缩到 32px。
- 资料库宽度范围调整为：
  - 默认 224px
  - 最小 188px
  - 最大 300px
- 使用新的宽度 key `lake-notes-v3.sidebar-width`，避免第一轮旧宽度（252/330）污染新默认值。
- 侧栏固定状态只持久化 `docked` / `collapsed`；临时 `floating` 不写 localStorage。
- 文档按钮交互改为：
  - `pointerenter`：collapsed → floating
  - 从按钮移入资料库：继续保持 floating
  - 离开按钮和资料库：延迟 120ms 后 floating → collapsed
  - 点击：非 docked → docked；docked → collapsed
- 资料库标题栏删除图钉和收起按钮，只保留“资料库”标题。
- 资料库标题栏高度从 42px 缩到 38px，搜索框和树列表横向留白同步收紧。
- 标签栏从第一轮约 73px 压缩成单行 **38px**，直接占用隐藏标题栏区域，Lake 格式工具栏紧随其后。
- collapsed/floating 时标签栏左侧额外留 30px，配合 44px 工具轨避开 macOS 交通灯区域。
- 活动轨顶部保留 38px 拖动区；资料库顶部用伪元素提供 38px `-webkit-app-region: drag` 区。
- 底栏删除可点击的同步按钮和设置齿轮：
  - 同步入口只保留在左活动轨。
  - 设置入口只保留在左活动轨。
  - 底栏改为只读 `.statusbar-sync`，显示当前同步状态和错误/成功颜色。
- Lake 格式工具栏、正文、卡片、右侧大纲均未改动。

### 4. 已完成验证

#### 4.1 自动检查

在 Node 24 环境下已通过：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
export npm_config_registry=https://registry.npmmirror.com
export npm_config_cache=/tmp/npm-cache-lake

node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
bash scripts/setup-test-abi.sh
npx vitest run
git diff --check
```

结果：

- TypeScript 通过。
- Vite 渲染层和 Electron 主进程构建通过。
- Vitest **102/102** 通过。
- 构建只有已有的大 chunk 警告，无新构建错误。
- `git diff --check` 通过。

保护性检查也通过：

```bash
git diff master...HEAD -- src/styles.css | grep -nE '^\+.*(\.ne-|lake-editor|slate-|board-card)'
git diff master...HEAD --name-only | grep -E 'LakeEditor|EditorTab|lakeRuntime'
```

两项都应为空：没有新增 Lake 内部选择器，也没有改受保护的编辑器文件。

#### 4.2 真实 Electron / Playwright 验证

已用 Playwright 驱动真实 Electron 验证：

- 1280×820：布局正常，无水平溢出。
- 800×600：布局正常，无水平溢出；Lake 工具栏仍存在并可见。
- 720×480：继续进入原有移动端文档列表，不被桌面外壳覆盖。
- collapsed 状态悬停文档按钮会打开 floating 资料库。
- 鼠标从按钮移动到资料库不会中途关闭。
- 离开资料库后约 120ms 自动收起。
- 点击文档按钮可固定；再次点击可取消固定。
- floating 状态点击正文会收起。
- 资料库内部旧图钉/收起控件数量为 0。
- 底栏设置按钮和可点击同步按钮数量为 0。
- 底栏只读同步状态存在，测试时文本为“仅本地保存”。
- 标签栏实际高度为 38px。
- Lake 原生格式工具栏仍存在。
- 页面控制台无 error，Playwright `pageerror` 为空。

验证截图（位于临时目录，机器重启后可能消失）：

- `/tmp/lake-shell-refine-final.png`：1280×820 固定资料库最终状态
- `/tmp/lake-shell-hover-panel.png`：悬停资料库状态
- `/tmp/lake-shell-refine-800.png`：800×600
- `/tmp/lake-shell-refine-720.png`：720×480 移动端回归
- 第一轮最终图：`/tmp/lake-shell-final-verified.png`

### 5. 当前问题 / 尚待确认

1. **最重要：等待用户最终主观验收。** 代码和自动验证已完成，但用户还没有对第二轮最终窗口给出“可以合并”结论。不要自行合并 master。
2. **原生交通灯和窗口拖动仍需用户肉眼确认。** Playwright 截图只截 webContents，不包含 macOS 红黄绿窗口按钮；CSS 计算确认顶部已留空间，`-webkit-app-region` 也为 `drag`，但 Playwright 合成鼠标拖动没有真的移动原生窗口，不能把这点写成完全验证。
3. 资料库默认模式受 `lake-notes-v2.sidebar-mode` 影响。若用户上次退出时为 collapsed，下次仍会 collapsed；这是预期持久化，不是默认值失效。
4. 第一轮的 `lake-notes-v2.sidebar-last-open-mode` 可能仍留在 localStorage，但第二轮已经不再读取，不影响行为。
5. 侧栏 hover 只适用于桌面精确指针环境。当前事件使用 pointer enter/leave，移动端由媒体查询和原移动流程隔离；若未来支持触屏桌面，需要再定义触摸语义。
6. 侧栏调宽功能仍保留。188px 很窄，长标题会省略；这是用户要求更窄后的预期，需要用户确认是否将默认值从 224px 再调小。
7. 状态栏只读同步文本在窄窗口可能被压缩，当前 `max-width: 190px` 并省略；同步完整操作和详情在左侧云图标面板中。
8. 本轮没有增加“最近”“收藏”，也没有改 Lake 工具栏；若用户后续提出相关要求，先确认是否违背当前产品原则。
9. 写本文时曾有一个 Playwright 启动的 Electron 测试进程；下一会话不要假设它仍可用。先检查端口和项目进程，再决定复用或精确关闭。

### 6. 下一步计划（按顺序）

#### P0：继续用户验收，不合并 master

1. 在 `design/apple-shell-prototype` 上启动开发版，让用户重点体验：
   - 悬停是否太敏感或太迟钝（当前离开延迟 120ms）。
   - 点击“固定/取消固定”的心智是否自然。
   - 224px 默认资料库是否还需要缩窄。
   - 38px 融合顶栏是否足够清晰。
   - 红黄绿交通灯是否遮挡，标题栏空白区域是否能拖动窗口。
   - 底栏信息密度是否合适。
2. 若只是数值和视觉微调，继续只改 `App.tsx`、`Sidebar.tsx`、`styles.css`，不要碰 Lake 内核文件。
3. 每轮改动后重复 102 项测试和真实 Electron 多尺寸检查。

#### P1：确认后做一次专门的 UI 回归

- 多标签达到 8 个时检查横向滚动和关闭按钮。
- 长文档标题、中文/英文混排、未保存圆点、同步错误状态。
- 侧栏拖到最小/最大宽度并重启，检查持久化。
- 快速反复移入/移出文档图标，确认 timer 不残留、不闪烁。
- floating 时操作搜索、树展开、右键菜单、拖拽节点，确认不会误收起。
- 打开同步面板和设置面板，确认左侧入口完整替代底栏入口。
- 用鼠标真实拖动标题栏区域，确认窗口可移动。

#### P2：只有用户明确批准后才考虑合并

- 先确保工作区干净、分支测试全绿。
- 建议对 `master...design/apple-shell-prototype` 做一次代码审查。
- 用户明确同意后再选择 merge/fast-forward；不要由新会话自行决定。
- 合并后再更新本文和 `docs/PROGRESS.md`，记录最终交互方案。

### 7. 如何启动给用户验证

先检查运行状态，避免单实例锁：

```bash
cd /Users/admin/file/local-lake/lake-notes-electron
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

lsof -nP -iTCP:1421 -sTCP:LISTEN
ps -axo pid=,ppid=,command= | grep '/Users/admin/file/local-lake/lake-notes-electron' | grep -v grep
```

常规开发启动：

```bash
npm run dev:vite
# 另一个终端
npm run dev:electron
```

若用 Playwright 做稳定的生产构建验证，按 `docs/CODEX-GUIDE.md`：

1. `node node_modules/vite/bin/vite.js build`
2. 用 Node REPL 静态 HTTP server 提供 `dist/` 到 `127.0.0.1:1421`
3. `_electron.launch()` 启动项目 Electron
4. 读取 DOM 几何、真实 mouse hover/click、截图

**禁止使用 `pkill -f Electron`。** 只能根据完整项目路径或已确认 PID 精确关闭本项目 Electron，否则会误杀其他 Electron 应用。单实例锁存在时，第二个 Electron 可能立刻退出；先清理本项目旧实例再启动 Playwright。

### 8. 本轮踩过的坑 / 可复用经验

1. **悬浮侧栏不能只监听按钮。** 如果 button `pointerleave` 立即关闭，鼠标还没到 panel 就消失。正确做法是按钮和 `<aside>` 都绑定 enter/leave，并共享一个短延迟 timer。
2. **floating 是瞬时预览状态，不能持久化。** 否则重启后直接得到覆盖层，用户会误以为布局坏了。只持久化 docked/collapsed。
3. **点击发生前会先 pointerenter。** 点击按钮时当前状态可能已经从 collapsed 变成 floating，因此点击函数必须把“任何非 docked 状态”都转成 docked，而不能只写 collapsed → docked。
4. **缩窄侧栏时要换 localStorage key。** 旧持久化宽度会把新默认值完全盖掉；第二轮使用 `lake-notes-v3.sidebar-width`。
5. **活动轨宽度有多个耦合点。** grid 第一列、rail 自身 width/min-width、floating sidebar 的 `left` 必须使用同一个 CSS 变量；否则会出现悬浮层缝隙或覆盖。
6. **hover 桥不能有物理缝隙。** floating panel 的 `left` 必须紧贴 rail 的右边缘；120ms 延迟只是容错，不能代替连续命中区域。
7. **融合顶栏不能简单删除顶部 padding。** Electron 使用 `titleBarStyle: hiddenInset`，必须给交通灯和拖动区留空间；活动轨和资料库顶部 38px 不放交互按钮，标签栏在 collapsed/floating 时也要额外左内边距。
8. **Playwright webContents 截图看不到原生交通灯。** 可以验证 DOM 几何和 app-region 计算值，但最终仍需用户在真实窗口肉眼确认原生按钮与拖动。
9. **不要为了统一视觉覆盖 Lake 内部 CSS。** 本轮外壳所有新样式都应限制在 `.activity-*`、`.sidebar`、`.tab-*`、`.statusbar-*`、应用自有 modal/menu；格式工具栏发灰是 Lake 自己的视觉，不应擅自重画。
10. **桌面 CSS 必须放在 `min-width: 761px`。** 720×480 会切换到完全不同的移动端 React 树；若把桌面布局写成全局规则，移动端会直接回归。
11. **dev server 与 Electron 生命周期容易纠缠。** `vite` 可能拉起 Electron 子进程；停止终端时 Electron 会一起退出。做自动验证时用构建产物 + 静态 server 通常更可控。
12. **单实例锁会让 Playwright 启动表现像随机失败。** 如果已有开发版 Electron，新的 `_electron.launch()` 可能 exit code 0 后立即关闭。先用完整项目路径检查进程，精确杀本项目实例。
13. **不要把合成拖动未移动窗口当作 app-region 失效。** Playwright 对 macOS 原生窗口拖动支持有限；先检查 computed `-webkit-app-region: drag`，再由用户真实鼠标验证。
14. **状态栏入口与状态是两回事。** 用户要求移除重复同步入口，但仍要求常驻同步状态，所以正确方案是左轨保留操作入口、底栏保留只读状态，而不是彻底删掉同步信息。
15. **设计技能的使用边界：** `apple-design` 适合材质、空间一致性、可中断动效和 reduced-motion；`animation-vocabulary` 只适合给动效命名，不是实现规范；不要为了“Apple 感”添加不服务于层级和反馈的动画。

### 9. 本轮关键实现位置

- `src/App.tsx`
  - `SIDEBAR_DEFAULT_WIDTH` / `MIN` / `MAX`
  - `initialSidebarMode()` / `initialSidebarWidth()`
  - `sidebarPreviewTimer`
  - `showSidebarPreview()` / `hideSidebarPreview()` / `toggleSidebarDock()`
  - 左活动轨按钮
  - 底部 `.statusbar-sync`
- `src/components/Sidebar.tsx`
  - `SidebarMode`
  - `onPreviewEnter` / `onPreviewLeave`
  - `<aside>` 的 pointer enter/leave
  - 资料库标题栏（无图钉/收起按钮）
  - resize handle
- `src/styles.css` 的 `/* ===== Apple-style management shell ... ===== */` 段
  - `--activity-rail-width: 44px`
  - 三列 app shell
  - docked/floating/collapsed 几何与过渡
  - 38px 融合标签栏
  - 24px 状态栏与只读同步状态
  - reduced-motion
- `src/features/editor/MultiTabEditor.tsx`
  - 标签胶囊渲染仍使用原组件；本轮没有改 EditorTab/LakeEditor。

---

## 历史交接（2026-08-03 会话）：代码审计修复 + 体验优化 + MD 导出 + 发布准备

### 任务目标（本会话）

1. 阅读并独立复核 `docs/CODE-AUDIT-2026-08-03.md`（15 项问题 + 6 个复现重点 + 新增 8 项）
2. 在独立分支 `fix/audit-2026-08-03` 修复全部审计问题（**后 fast-forward 合入 master**）
3. 参考 4 个 Lake 相关仓库（lake-main / lake-editor-main / yuque-rich-text / am-editor），输出可借鉴点
4. 落地 P0+P1 体验优化（偏好设置/字号/段间距/TOC/工具栏/字数统计）
5. 全文导出 Markdown（用户核心需求：AI 输入场景）
6. 发布准备（应用图标、签名/公证教程、dev/打包 userData 隔离）
7. 修复用户实测发现的问题（暗黑编辑器背景、中文斜体失效、多 tab 隔离）

### 已完成内容

**① 代码审计 15 项 + 新增 8 项全部修复（分支 `fix/audit-2026-08-03` → 已合入 master）**
- **#1 同步清空资源清单（高）**：`electron/sync.ts` 资源清单每次同步恒重扫（正文 hash 未变也保留 assets）
- **#2 墓碑只保留一次同步（高）**：墓碑永久保留 + 下载 deleted 标记时 `rememberDeleted` 学习墓碑（设备接力保管）
- **#3/#17 目录穿越（高）**：`notePath`/资源文件名统一 `isSafePathSegment` 校验 + manifest 运行时 schema 校验
- **#4 远端资源完整性（高）**：下载缺失即中止 + size/sha256 校验
- **#5 SSRF（高）**：`ssrf.ts` 新增 `assertSafeRemoteHost`（DNS 解析逐地址校验）+ 下载层改用
  `net.request` + `followRedirect:false` 逐跳校验 + **彻底移除渲染层回退**（原回退是刻意绕过安全策略）
- **#6 IPC 来源（高）**：精确 URL + webContents 白名单 + `will-navigate`/`setWindowOpenHandler` 拦截
- **#7 自动保存覆盖（中偏高）**：App.tsx 加每笔记 revision 计数器，旧响应不覆盖新草稿
- **#9 树结构不变量（中）**：notebook 只能根层、note 不能作父、reorder 完整性校验
- **#10 FS/SQLite 非原子（中，删除高）**：deleteTreeNode DB-first、importRemoteNote staging 写入
- **#12 孤儿清理（低）**：失败保留记录可重试
- **#13 Worker（低）**：崩溃 terminate+替换 + 60s 任务超时
- **#14 附件大小（中低）**：非图片附件 25MiB 上限 + Data URL 解码前预检
- **#15 TOC 水合（低）**：裸函数修正（`lakeRuntime.ts:560-561`）+ 定时器统一清理 + `refreshTocSidebar` host 限定
- 新增：#16 资产服务 CORS Origin 门控、#18 move+reorder 原子 IPC、#19 schema 校验（随 #3）、
  #20 墓碑学习（随 #2）、#21 upload_resource IPC 大小预检、#22 detectOrphans 隔离、#23 beforeunload 兜底
- 额外：#8 移动端 viewer 旧快照（persistMobile）、#11 导入后按正文对账标记孤儿

**② 参考仓库评审（`docs/REFERENCE-REVIEW-2026-08-03.md`）**
- lake-editor-main（重点，同内核 `@alipay_lakex-doc`）：paragraphSpacing/defaultFontsize/toc 等内核 option 直接可用
- lake-main（lakelib 0.4.6 官方新版，不同代码线）：机制对照 + 功能差距清单
- yuque-rich-text（同内核 iframe 方案）：viewer/wordCount/HTML 互转参考，iframe 方案不采用
- am-editor（不同内核）：插件化 + yjs 协同，仅设计参考

**③ P0+P1 体验优化（`6e0f2f1`）**
- 偏好设置面板（状态栏齿轮）：**字号**（12-24 八档，内核 defaultFontsize）、**段间距**（CSS relax）、
  **TOC 显隐**（toc.enable）、**工具栏显隐**（disabledPlugins）——localStorage 持久化
- **字数统计**：状态栏实时显示当前文档字数
- ⏸ **深色模式已回滚**（`5e8e160`）：工具栏图标暗色对比度差、成本高收益小，用户决定不做
- ⏸ **纯文本粘贴已回滚**（`5e8e160`）：Cmd+Shift+V 在 Chromium 不触发 paste 事件，DOM 插入方案被
  Lake 文档模型重建清除，真修需内核插入 API 成本高，放弃

**④ 全文导出 Markdown（`fae79e8`）**
- 状态栏「MD」按钮 → `editor.getDocument("text/markdown")`（**内核原生支持，语雀同款**）→ 复制到剪贴板 + 提示
- EditorTab/LakeEditor 通过 `onEditorReady` 回调注册编辑器实例到 App（`editorsRef` noteId → editor）
- 实测输出质量高（标题/加粗/斜体/列表/引用/代码/链接全正确）
- 调研报告 `docs/MARKDOWN-EXPORT-REVIEW.md`：md 导入（`setDocument("text/markdown")`）、选区转 md、右键框架待做

**⑤ 发布准备（`3dae1a9`）**
- 应用图标 `build/icon.icns`（湖蓝渐变 + 文档页 + 波浪，程序化设计，全尺寸）+ electron-builder mac.icon 配置
- 发布教程 `docs/RELEASE.md`（Apple Developer 认证 → Developer ID 签名 → 公证 → 打包全流程）
- **userData 隔离**：dev 用 `lake-notes-dev`、打包版用 `lake-notes-electron`（main.ts app ready 前 setPath）
- Gitee：默认分支已切 master、main 已设保护分支

**⑥ 修复用户实测问题**
- **暗黑编辑器背景**：Lake 运行时注入 `.lakex-default-theme` 亮色变量 → 高优先级选择器
  `html[data-theme=dark] .lake-editor .ne-editor` 覆盖变量（后因用户决定不做深色而回滚）
- **中文斜体失效**（`2cd848d`）：根因 `font-synthesis: none` 禁止合成斜体（中文字体无 italic 变体）→
  改为 `font-synthesis: style weight`。验证：同内容中文 normal vs italic 截图像素差异 92.2%
- **多 tab 隔离**（`c93813a`）：hover 桥 `onMouseLeaveCapture` 补 `host.contains` 检查；实测内容/TOC/
  导出/设置/关闭 tab 全隔离

### 当前问题 / 已知限制

1. **应用未签名、未公证**：dmg 首次打开需右键→打开；用户按 `docs/RELEASE.md` 推进 Apple 认证（进行中）
2. **渲染包超大**：主 chunk ~9.4MB（Lake 本体 + slate + react），编辑器懒加载属 Lake 阶段
3. **表格 max-view 进出后工具栏定位偏移 ~28px**（自愈，Lake 内部问题，待 Lake 优化阶段）
4. **移动端/单编辑器路径未回归**：`resolveScrollNode` 仅 `.lake-editor-tab` 启用内部滚动，移动端待验证
5. **移动端 MD 导出未验证**：依赖 viewer 实例 getDocument（低频，后续确认）
6. **隐藏 tab 编辑器全量驻留内存**（最多 8 个，多标签即时切换设计使然）
7. **S3 对象累积回收（GC）待立项**：已同步图片删除后对象永久留存（思源式数据仓库瘦身方案）
8. **npm 私有镜像不可达**：装新依赖必须显式用 npmmirror registry

### 下一步计划（建议顺序）

1. **发布**：用户完成 Apple 认证（`docs/RELEASE.md`）→ 签名 + 公证 + 打包验证
2. **右键菜单框架 + 选区转 md**（已与用户讨论定方向）：右键 = 复制为 Markdown + 复制为纯文本
   + AI 占位；复制纯文本是 Cmd+Shift+V 做不了后的唯一干净入口
3. **md 导入**：`.md` 文件 → `setDocument("text/markdown")`（配合 AI 生成场景）
4. **外部变更检测**（AI 生成场景）：主进程 fs.watch + 自保存过滤（参考 lake-editor-main file-change-detector）
5. **Lake 优化阶段**（用户后续主导）：参考评审 P0/P1 项 + max-view 偏移 + 渲染包懒加载
6. **移动端路径回归**（scrollNode 回退分支 + TOC，随移动端一起）
7. 安卓端同步（复用同步协议）、S3 GC（独立阶段）

### 本会话踩过的坑（速览，细节见 docs/TROUBLESHOOTING.md H/I 节）

- **Chromium Cmd+Shift+V 不触发 paste 事件**（移除默认菜单项也不触发）；execCommand insertHTML/paste
  在 Lake 不可靠；合成 paste 被 Lake 拒绝（isTrusted 检查）
- **Lake 运行时注入 `<style>` 定义 `.lakex-default-theme` 亮色变量**，优先级高于 html 级变量定义
- **`font-synthesis: none` 导致中文斜体完全失效**（中文字体无 italic 变体，被禁止合成）
- **Chromium `net.fetch` 的 `redirect:"manual"` 直接抛 "Redirect was cancelled"**；逐跳校验必须用
  `net.request` + `followRedirect:false`；Referer 必须每跳用当前 URL（固定外部 Referer 被 Google 等拦截）
- **渲染层回退是刻意设计的 SSRF 绕过**（resourceUpload.ts 注释为证），安全错误绝不回退
- **vitest `mockRestore()` 后重新 mock 不生效**；**dist 构建缓存损坏**导致 `path is not defined` 假象（clean build 解决）
- **Playwright 环境不稳定**：后台窗口渲染暂停（getBoundingClientRect 全 0）、node_repl kernel 反复 reset、
  `querySelector(".ne-engine")` 多 tab 时取第一个隐藏 host（必须按 `data-note-id`/display 精确定位）
- **测试污染**：真实 Cmd+Shift+V 会把系统剪贴板内容粘进笔记（必须用隔离 userData + 测后恢复/清理）；
  Playwright 会话后必须清 last_opened_note_id 残留（否则启动报"笔记不存在"）
- **Lake 标记/API 速记**：斜体 = `ne-text[ne-italic="true"]`（em/i 会被 Lake 解析为此）；
  md 转换 = `getDocument("text/markdown")` / `setDocument("text/markdown", md)`；
  editor 实例通过 onEditorReady 回调获取（导出用）

---

## 参考资料解读经验（2026-08-03 沉淀：如何分析同类开源项目）

> 本次解读了 4 个 Lake 相关仓库（lake-main / lake-editor-main / yuque-rich-text / am-editor），
> 结论见 `docs/REFERENCE-REVIEW-2026-08-03.md`。以下是可复用的**方法**：

### 1. 先判内核血缘，决定参考深度
- **看依赖与内置资源**：项目用哪个内核？node_modules 里的 lakex 封装 vs 参考项目的 `media/editor/doc.umd.js`
  （@alipay_lakex-doc）——**同内核（语雀系）的参考价值最高**：option/API 可直接拿来用（如
  `paragraphSpacing`、`toc.enable`、`getDocument("text/markdown")`）。
- **lake-main（lakelib 0.4.6）是不同代码线**（官方新版，模块化重写）：机制可对照（虚拟渲染/TOC/工具栏
  的设计意图），但命名/API 不通用，**不能直接抄代码**。
- **am-editor 完全不同内核**（contenteditable + 插件体系）：只借鉴设计（插件化架构、yjs 协同），
  代码零复用。判断标准：**同内核 > 同 API 风格 > 纯设计参考**。

### 2. 抓"可直接复用"的资产，而非只读结论
- 参考项目的**编辑器初始化参数/配置项**是金矿（lake-editor-main 的 `src/webview/lake-preview/index.ts`：
  `paragraphSpacing: 'relax'`、`toc: { enable }`、`defaultFontsize`、`formatLake`）——同内核直接可用。
- 参考项目的**踩坑修复**（外部变更检测的 300ms 自保存过滤窗口、粘贴纯文本的实现路径）→ 直接启发
  我们的实现方案。

### 3. 验证 > 信任：源码说有，必须 Playwright 实测
- 看源码确认 API 存在（`registerReader("text/markdown", ...)`）→ **必须起真实应用实测**
  （`getDocument("text/markdown")` 输出质量、`editor.execCommand` 命令系统）。
- 实测手段：**临时暴露编辑器实例**（`window.__lakeEditor = editor`）→ 调 API 验证 → 测后移除。
- 多 tab 实测注意：`querySelector(".ne-engine")` 会取到第一个隐藏 host，必须按
  `data-note-id`/`display` 精确定位（本次踩过）。

### 4. 反推内核机制的三个技巧
- **CSS 变量是主题正解**：发现 Lake 用 `--lakex-editor-*` 变量（默认未定义、运行时注入
  `.lakex-default-theme`）→ 用更高优先级选择器在容器上覆盖变量，比逐选择器改样式可靠。
- **看序列化标记而非标准标签**：斜体是 `ne-text[ne-italic="true"]`（em/i 会被解析转换）；
  查自定义元素/属性比查标准 HTML 标签更能定位 Lake 的功能实现。
- **命令系统**：`editor.execCommand` + 命令 ID（如 `getSelectionContent`）是 Lake 扩展入口，
  比直接操作 DOM 更安全（DOM 操作会被 Lake 文档模型重建清除——纯文本粘贴的教训）。

### 5. 产出要有"可执行性"
- 每次解读输出：**功能差距清单 + 成本评估 + 建议实现顺序**（REFERENCE-REVIEW 的 P0/P1/P2 表），
  让后续会话能直接按表执行，而不是重新读一遍参考仓库。

### 6. 警惕参考项目自身的坑
- lake-editor-main 的 `pasteAsPlainText` 依赖编辑器命令（我们的内核没有同命令）；formatLake 的正则
  只在标签边界加换行（安全），但直接抄要验证目标内核的序列化格式是否兼容。
- vscode 扩展的上下文（菜单/命令系统）与 Electron 应用不同，映射到我们场景时要重新评估实现路径。

## 项目历史背景（简）

- **阶段 A**：资源归一化（图片本地化）、第三方图片下载（electronNet.fetch + Referer/UA）、粘贴拦截升级
- **阶段 B**：S3 备份同步（sync 引擎、墓碑、孤儿资源 UI）
- **阶段 C**：代码审计与优化（SSRF/IPC/并发/安全）
- **虚拟渲染**：大文档性能（首图 3.5s→88ms）、TOC 三问题、代码块粘贴、表格工具栏 hover、长大纲跟随
  （详见 `docs/PROGRESS.md` 历史部分 + `VIRTUAL-RENDERING-TEST.md`）

## 文档索引

| 文档 | 内容 | 优先级 |
|---|---|---|
| **docs/CODEX-GUIDE.md** | **Codex 自主开发指南**：Playwright 驱动真实 Electron（含启动模板）/ Computer Use / 应用内浏览器；推荐会话工作流；环境速查 | **动手前必读** |
| **docs/PROGRESS.md** | ★最新交接（含本次会话全记录 + 多 tab 评审）、经验总结、历史阶段、当前问题、下一步 | **先读** |
| **docs/CODE-AUDIT-2026-08-03.md** | 审计报告 15 项 + 二次审计判断 + 修复状态表 | 了解本次审计 |
| **docs/REFERENCE-REVIEW-2026-08-03.md** | 四个 Lake 参考仓库评审 + P0/P1/P2 可借鉴清单 | 体验优化参考 |
| **docs/MARKDOWN-EXPORT-REVIEW.md** | MD 导出/导入调研（内核原生支持、成本评估、实现顺序） | 做 md 功能前读 |
| **docs/RELEASE.md** | 发布教程：Apple 认证 → 签名 → 公证 → 打包 | 发布时读 |
| README.md | 项目概览/核心理念/技术栈/状态总览/仓库与分支 | 了解项目 |
| docs/DEVELOPMENT.md | 环境要求/开发/构建打包/测试（双 ABI）/依赖版本 | 动手前读 |
| docs/ARCHITECTURE.md | 进程结构/关键文件索引/图片数据流/数据与存储/S3 同步机制 | 改代码前读 |
| docs/TROUBLESHOOTING.md | 踩过的坑 A-I（打包/CDN/剪贴板/编辑器与 CSS/环境/S3/虚拟渲染/审计修复/斜体） | 遇坑查 |
| VIRTUAL-RENDERING-TEST.md | 虚拟渲染回归清单（逐项手测） | 动虚拟渲染相关代码前后跑 |

## 环境速查

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"   # Node 24（vite 8 必需）
export npm_config_registry=https://registry.npmmirror.com   # npm 私有镜像不可达
export npm_config_cache=/tmp/npm-cache-lake
node node_modules/vite/bin/vite.js build                    # 构建渲染层+主进程
npx vitest run                                              # 测试（先 bash scripts/setup-test-abi.sh）
bash scripts/setup-test-abi.sh                              # 装 Node ABI better-sqlite3（测试用）
```

- **当前分支**：`master`（最新 `c93813a`，已推送 Gitee；`fix/audit-2026-08-03` 分支保留在远程）
- **测试**：102 个 vitest 用例全绿
- **Playwright 启动模板**：见 `docs/CODEX-GUIDE.md`（静态服务器 serve dist/ + `_electron.launch`）
- **注意**：dev 用 `lake-notes-dev` userData（隔离），打包版用 `lake-notes-electron`；单实例锁（dev 与打包不能同时跑）；杀进程只 grep "lake-notes-electron"
