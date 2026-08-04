# Lake Notes Electron 交接文档

> 写给完全没有上下文的新会话。开始修改代码前，请先读完本文，再按需阅读：
> `docs/CODEX-GUIDE.md`、`docs/PROGRESS.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/TROUBLESHOOTING.md`。

## 1. 项目概况

Lake Notes 是一个 **Electron + React + TypeScript** 的本地优先笔记应用：

- 笔记正文由 `lakex-editor-react-component` / Lake 编辑器负责。
- `.lake` 文件保存在本地，SQLite 保存元数据和树结构。
- 支持 S3 兼容对象存储同步、资源本地化、孤儿资源清理、Markdown 导出。
- 桌面端支持多标签编辑、左侧活动栏、资料库树、设置、同步面板和底部状态栏。
- 移动端仍使用原有 `MobileLibrary` / 移动阅读编辑流程，桌面外壳修改不能破坏移动端。

项目目录：

```text
/Users/admin/file/local-lake/lake-notes-electron
```

远程仓库：

```text
origin = https://gitee.com/gtycoder/local-lake.git
```

当前日期：2026-08-04。

## 2. 当前 Git 状态

当前分支为 `master`，本次工作已提交并推送到远程：

```text
HEAD: a339b5d feat: add overflow tab switcher
工作区：干净
远程：origin/master 已同步
```

本轮重要提交：

```text
1b022ce merge: promote verified Apple shell
41d0ced feat: improve tabs tooltips and sync feedback
59c10cc fix: size tabs to title content
a339b5d feat: add overflow tab switcher
```

其中：

- `1b022ce`：将已验证的 Apple / 思源式桌面管理外壳合入 `master`。
- `41d0ced`：标签栏基础优化、设置和同步悬浮提示、云同步状态反馈。
- `59c10cc`：短标签按标题内容宽度显示，长标签设置上限。
- `a339b5d`：取消用户可见标签数量上限，增加自动收缩和竖向标签切换菜单。

## 3. 当前任务目标

本阶段目标是保持 Lake 编辑器本身不变，只优化其外层管理壳，使它接近思源笔记的管理方式和 macOS 原生应用的层级、材质、间距与反馈：

1. 左侧活动工具轨 + 资料库树。
2. 资料库支持常驻、悬浮、收起三种状态。
3. macOS 红绿灯拥有安全区，不能被侧栏或标签侵入。
4. 设置放在顶栏左侧，云同步放在设置右侧。
5. 顶栏包含多标签；标签栏不随资料库宽度移动。
6. Lake 原生格式工具栏、正文、卡片、表格、代码块、TOC 和虚拟渲染必须继续由 Lake 编辑器自己负责。
7. 底部状态栏保留字数、本地保存、同步状态和 Markdown 导出等功能。
8. 暂时优先 macOS 体验，Windows 视觉暂不继续调整；已有平台判断和原生标题栏逻辑不要随意删除。

## 4. 已完成内容

### 4.1 Apple / 思源式桌面外壳

主要代码：

- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/styles.css`
- `src/features/editor/MultiTabEditor.tsx`

已实现：

- 左侧活动栏：资料库、云同步、设置入口。
- 资料库模式：
  - `docked`：常驻并占用布局宽度；
  - `floating`：覆盖在编辑区上方，不挤压正文；
  - `collapsed`：隐藏资料库，仅保留活动栏。
- 资料库悬浮触发：鼠标移到资料库入口附近可预览；点击可固定/切换。
- 资料库宽度可拖拽调整并持久化。
- 顶栏窗口级固定，避免侧栏宽度改变时标签位置漂移。
- macOS 红绿灯区域预留在顶栏左侧；收起/悬浮资料库不能侵入红绿灯。
- Windows 使用原生标题栏相关类名和布局分支，但本阶段不继续做 Windows 视觉微调。

### 4.2 顶栏操作与云同步反馈

设置按钮位于顶栏左侧，云同步按钮紧邻其右侧。

按钮使用统一的深色圆角悬浮提示，例如：

```text
打开偏好设置
云同步：仅本地保存
云同步：准备同步...
云同步：同步完成
```

云同步状态反馈已接入：

- 同步中：蓝色云图标、动态状态点。
- 成功：绿色状态点。
- 失败：红色状态点。
- 同步面板显示阶段、进度、上传、下载、冲突和孤儿资源信息。

同步链路：

- `electron/sync.ts` 的 `syncNow()` 返回 `SyncResult`。
- 同步阶段包括 `connect`、`download`、`upload`、`manifest`、`done`。
- `electron/main.ts` 通过 IPC 推送 `sync-progress`。
- `electron/preload.cjs` 暴露 `onSyncProgress`。
- `src/App.tsx` 监听进度，更新顶栏云图标和状态文本。
- `src/components/SyncPanel.tsx` 展示具体同步结果。

S3 SDK/请求会返回单次请求成功、失败、错误信息和对象级结果；完整百分比是应用层根据对象总数自行计算的，不是 S3 自动提供的。

### 4.3 标签栏优化

当前实现位于：

- `src/features/editor/MultiTabEditor.tsx`
- `src/styles.css`
- `src/App.tsx` 的 `openNote()`

当前行为：

- 不再存在 `MAX_TABS = 8` 的用户可见限制。
- 打开新笔记时不再自动淘汰最久未访问标签。
- 短标题按内容宽度显示。
- 标签增多时可自动收缩。
- 最小宽度约 `84px`。
- 长标题最大约 `190px`，超出后省略。
- 标签继续增加时不会把顶栏无限撑宽；标签栏可横向滚动。
- 顶栏最右侧有固定的标签切换按钮，不参与标签压缩。
- 切换按钮显示已打开标签数量。
- 点击按钮打开竖向标签列表。
- 列表支持：当前标签高亮、点击切换、未保存状态点、关闭单个标签。
- 点击菜单外部或按 `Escape` 关闭。
- 切换标签后会尝试将对应标签滚动到可见位置。

真实 Electron 验收结果：

```text
打开 9 个标签：通过
短标签压缩到约 84px：通过
长标签上限约 190px：通过
竖向菜单显示 9 项：通过
菜单点击切换并自动关闭：通过
```

### 4.4 既有同步和数据能力

项目此前已经完成并验证：

- S3 兼容同步、manifest、墓碑和冲突处理。
- 七牛等真实 S3 兼容服务的同步验证。
- 资源本地化、远程图片下载、SSRF 防护。
- 资产服务、孤儿资源登记和清理。
- 多标签内容隔离、TOC 隔离、Markdown 导出按当前编辑器实例执行。
- 大文档虚拟渲染和长 TOC 跟随实验。
- 安全审计相关修复（IPC 来源、路径穿越、SSRF、资源完整性、单实例锁等）。

## 5. 当前验证结果

最近一次完整验证：

- TypeScript：通过。
- Vite 构建：通过。
- Vitest：`102/102` 全绿。
- `git diff --check`：通过。
- 真实 Electron：通过。
- 多标签收缩和竖向菜单：通过。

构建命令：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
npx vitest run
```

已知构建提示，不是本轮新增问题：

- `index.html` 中 `codemirror.js` 没有 `type="module"`，Vite 会给出提示。
- 主渲染 chunk 较大，Vite 会给出大 chunk warning；Lake 编辑器本体和 Slate 体积较大，真正优化需要编辑器懒加载。

## 6. 当前问题和限制

1. **所有打开标签仍保留完整编辑器实例**：即使标签隐藏，也仍然初始化并驻留 DOM/内存。当前适合少量到中等数量标签；如果用户打开几十个大型文档，需要重新评估。
2. **标签没有真正的后台卸载机制**：暂时只取消了用户层面的数量限制，没有实现编辑器实例懒加载、休眠或恢复。
3. **标签菜单目前显示标题和状态点**，尚未显示所属笔记本、最近使用时间等额外上下文。
4. **标签宽度目前主要依赖 CSS 自适应**：在极端窗口宽度和大量长标题下，需要继续观察交互是否比浏览器式标签更清晰。
5. **同步成功状态不会自动恢复为 idle**：目前成功状态点可能继续保持绿色，后续可考虑几秒后恢复普通状态，但不要丢失最后同步时间。
6. **真实 S3 的阶段性进度矩阵还没有在本轮用真实凭据重新覆盖**：UI 和既有状态链路已验证；如用户提供配置，可继续验证成功、失败、上传、下载、冲突场景。
7. **移动端和单编辑器路径的全部回归仍应谨慎处理**：桌面外壳 CSS 已用桌面媒体查询隔离，但后续涉及滚动、导出或标签逻辑时必须额外回归移动端。
8. **应用未签名、未公证**：发布前需要按 `docs/RELEASE.md` 完成 Developer ID 签名、公证和打包。
9. **表格 max-view 后工具栏定位偏移约 28px**：重开后自愈，属于 Lake boundary popover 的既有限制，不是本轮标签改动引入。

## 7. 下一步计划

建议新会话按以下顺序推进：

### P0：先让用户验收远程 master

- 从远程拉取 `master`，确认远程 commit 为 `a339b5d`。
- 真实启动 Electron，验收短标签、标签收缩、右侧下拉按钮和竖向列表。
- 不要未经用户反馈再大幅改变当前外壳视觉。

### P1：标签体验细节

- 观察标签超过 10～20 个时的横向滚动和菜单使用体验。
- 为标签切换菜单增加键盘上下选择、Enter 确认（当前已有 Escape 关闭）。
- 评估是否在标签菜单中增加笔记本/目录信息。
- 评估切换按钮是否应只在真正溢出时显示，或保持当前始终显示的行为。
- 评估标签右键菜单：关闭、关闭其他、关闭右侧、关闭全部。

### P1：编辑器实例资源控制

只有在真实使用确认需要后再做：

- 当前标签 + 最近访问标签保持实例。
- 远离的标签保存内容快照后卸载编辑器。
- 再次点击时恢复实例。
- 先做内存/切换性能基线，避免盲目增加复杂生命周期。

### P1：云同步反馈

- 真实配置 S3 后验证完整同步链路。
- 如需要，把进度细化到“上传第 x / y 个对象”。
- 同步失败时顶栏只显示友好摘要，详细错误放同步面板。
- 连接测试也可以同步反映到云图标状态。

### P2：发布和性能

- 按 `docs/RELEASE.md` 完成签名、公证和打包。
- 后续和 Lake 阶段一起评估编辑器懒加载及渲染包拆分。
- Windows 视觉暂时不动，除非用户重新提出明确需求。
- Markdown 导入/导出扩展、外部变更检测、`.lakebook` 导入等仍属于后续 Lake 功能计划。

## 8. 重要代码边界（严禁越界）

除非用户明确要求并完成单独回归，不要修改以下 Lake 编辑器内核文件：

```text
src/features/editor/LakeEditor.tsx
src/features/editor/EditorTab.tsx
src/features/editor/lakeRuntime.ts
```

不要新增或覆盖以下内部选择器/行为：

- `.ne-*`
- `.lake-editor-*`
- Slate 内部选择器
- Lake 工具栏、卡片、表格、代码块、TOC、虚拟渲染相关行为

外壳可以修改的范围：

- `src/App.tsx` 的管理层状态和布局
- `src/components/Sidebar.tsx`
- `src/features/editor/MultiTabEditor.tsx` 的标签外观/切换管理
- `src/styles.css` 的桌面外壳样式
- `src/components/SyncPanel.tsx` 的同步面板外层反馈
- `electron/main.ts` / `electron/preload.cjs` / `electron/sync.ts` 的同步状态链路（需同步 IPC 类型和测试）

## 9. 开发、启动和实测方法

Node 版本：建议 Node 24：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
```

开发启动：

```bash
cd /Users/admin/file/local-lake/lake-notes-electron
npm run dev:vite
npm run dev:electron
```

真实 Electron Playwright 启动模板见 `docs/CODEX-GUIDE.md`。推荐流程是：

1. 先检查端口和旧 Electron 进程。
2. 启动 Vite `127.0.0.1:1421`。
3. 启动 Electron。
4. 等待 React/Lake 编辑器加载后再读取 DOM。
5. hover 必须用真实 `mouse.move`，普通合成事件对部分交互无效。
6. 结束测试时只清理本项目进程，不要使用 `pkill -f Electron`，避免误杀其他 Electron 应用。

注意：dev 使用独立 userData：

```text
~/Library/Application Support/lake-notes-dev
```

打包版使用 `lake-notes-electron` userData。单实例锁要求 dev 与打包版不要同时运行。

## 10. 踩过的坑

- **不要把侧栏宽度当成顶栏宽度**：顶栏必须窗口级 fixed，否则收起/悬浮资料库时标签会跟着移动。
- **macOS 红绿灯安全区由顶栏负责**：收起标签或资料库时不能让标签、侧栏入口侵入左侧红绿灯区域。
- **原生 paste 的 DataTransfer 基本只读**：直接 `setData` 不可靠；Lake 内部 DOM 插入会被文档模型重建清除，纯文本粘贴方案已回滚。
- **多标签下不能用全局 `.ne-engine` / `.ne-toc-sidebar` 查询**：必须按 `data-note-id` 或具体 host 限定，否则会串扰隐藏标签。
- **虚拟渲染时视口外标题不在 DOM**：TOC watcher 的二分探测可能得到 `-1`，列表跟随要按可视区自行复刻滚动逻辑。
- **Lake 内部菜单的 mouseleave 不冒泡**：需要 document 捕获阶段或 hover bridge，并且必须限定 host，避免多 tab 互相影响。
- **表格 hover 的根节点是 `ne-table-wrap`**，不是 `ne-table-hole`。
- **Playwright 合成事件不等于真实用户操作**：打开笔记、hover、焦点和弹层优先使用真实鼠标操作。
- **测试数据会写入真实本地笔记库**：创建/粘贴测试数据后必须清理，并扫描 `.lake` 确认无残留。
- **better-sqlite3 存在双 ABI**：Electron ABI 和 Node ABI 不同；Vitest 前按项目脚本准备测试 ABI。
- **npm 私有镜像可能不可达**：安装新依赖时显式使用 `https://registry.npmmirror.com`。
- **S3 Secret 已改为 safeStorage 加密存储**：换机器或旧版本迁移时可能需要重新填写 secret。
- **单实例锁会阻止 dev 和打包版并存**：启动前先退出另一个本项目实例。
- **不要因标签数量限制直接做内存淘汰**：当前标签 UI 已取消限制，但所有 Lake 编辑器实例仍驻留；真正淘汰必须先设计内容快照和 editor 生命周期。

## 11. 新会话第一步

```bash
cd /Users/admin/file/local-lake/lake-notes-electron
git status --short --branch
git log --oneline --decorate -5
git pull --ff-only origin master
```

然后阅读：

1. 本文件；
2. `docs/CODEX-GUIDE.md`；
3. `docs/PROGRESS.md` 最新交接；
4. 按具体任务阅读 `docs/ARCHITECTURE.md` / `docs/TROUBLESHOOTING.md`。
