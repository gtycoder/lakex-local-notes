# Lake Notes 全项目优化审计

日期：2026-08-20
当前实现基线：`master` 已合并并推送到 `origin/master`，后续审计工作区为 `feat/lake-notes-ui-system`。

## 审计范围

- UI 视觉、布局、窗口和响应式行为
- 动效、hover、pointer 命中、键盘和可访问性
- React 状态、渲染、编辑器生命周期
- 搜索、同步、历史快照、回收站和冲突提示
- SQLite、文件系统、S3 镜像和资源生命周期
- IPC、主进程、preload 和安全边界
- 测试、构建、bundle、发布和可观测性

## 当前基线证据

| 项目 | 当前数据 |
|---|---:|
| 自动化测试 | 35 个测试文件 / 314 passed |
| TypeScript | `npx tsc --noEmit` 通过 |
| Vite build | 通过；有历史资源和大 chunk warning |
| npm audit（生产依赖） | 0 个漏洞 |
| 总 TS/TSX/CSS/SCSS 代码 | 约 30,550 行 |
| `src/styles.css` | 2,307 行 |
| `src/App.tsx` | 1,423 行 |
| `electron/store.ts` | 1,799 行 |
| `electron/sync.ts` | 1,137 行 |
| CSS `!important` | 约 490 处 |
| CSS 颜色字面量 / rgba | 约 885 处 |
| CSS media query | 45 处 |
| catch 分支 | 262 处；非测试空 catch 约 85 处 |
| IPC handler | 69 个 |
| 生产入口 JS | 约 9.63 MB |
| Drawnix chunk | 约 4.16 MB |

## 总体判断

当前核心功能已经进入“可维护性和体验收敛”阶段，不建议再推翻思源式布局，也不建议改动 Lake 原生编辑器工具栏。下一阶段最重要的是减少隐式状态和重复覆盖，而不是继续增加零散视觉补丁。

最高收益顺序：

1. 状态机和同步事实来源收敛；
2. CSS/React 大文件拆分；
3. 搜索、窗口崩溃恢复和编辑器生命周期补齐集成验证；
4. bundle 和发布资源治理；
5. 最后做视觉微调和动效打磨。

# P1：建议优先处理

## P1-1 同步状态的“待上传数量”还不是完全可信的领域事实

位置：`src/App.tsx`、`src/components/SyncStatusPopover.tsx`、`src/components/syncStatusModel.ts`。

当前 UI 使用：

- `notes.filter(syncState === "local")` 估算待上传文档；
- `sync.pendingChanges - 待上传文档` 估算资源数量。

这不是资源队列的真实统计，可能在以下场景显示错误：

- 资源已写盘但正文尚未保存；
- 一篇文档有多个资源；
- 同步中途失败；
- 小记或历史资源不属于普通文档；
- 本地状态已刷新但 `pendingChanges` 尚未刷新。

建议：由主进程返回统一的 `SyncPendingSummary`：

```ts
interface SyncPendingSummary {
  documents: number;
  resources: number;
  quickNotes: number;
  total: number;
  generatedAt: string;
}
```

UI 只展示主进程事实，不再在 React 层做减法推断。

## P1-2 冲突快照提醒没有携带明确的文档目标

当前 `SyncStatusPopover` 的“查看历史”回调使用当前活动文档，而冲突可能发生在其他文档。

风险：用户点击“查看历史”后打开了错误文档的历史面板。

建议：冲突状态保存：

```ts
Array<{ noteId: string; title: string; snapshotCount: number }>
```

Popover 显示最多 3 条冲突文档，点击具体文档后打开对应历史，而不是依赖 `activeNoteId`。

## P1-3 搜索 `newTab` 参数目前没有真正改变打开策略

位置：`src/App.tsx:openNote`。

`SearchPanel` 已经传递 `newTab`，但 `openNote` 使用 `_newTab` 且没有消费。当前 `⌘Enter` 与普通 Enter 的实际打开行为基本相同。

建议明确规则：

- 文档未打开：两者都打开标签；
- 文档已打开：Enter 激活已有标签，`⌘Enter` 也应明确反馈“已在已有标签打开”；
- 如果产品不允许同一文档多标签，应删除“新标签”文案，避免承诺不存在的行为；
- 如果要支持真正的副本标签，需要引入 tab instance id，不能继续用 `noteId` 作为唯一键。

推荐当前阶段采用第一种：不支持同文档多实例，但修正文案和测试，避免隐式假功能。

## P1-4 渲染进程崩溃后的未保存草稿恢复仍不完整

`electron/main.ts` 有 `render-process-gone` 自动 reload，但 renderer 崩溃时内存中的 dirty tab 可能丢失。

建议加入轻量草稿恢复：

1. 每次 dirty 内容变化后按文档写入本地 draft journal；
2. 保存成功后删除对应 journal；
3. 启动/重载时检测 journal；
4. 仅提示“发现未保存草稿”，由用户选择恢复或丢弃；
5. journal 与正式文档分开，不能污染同步 manifest。

这是本地优先产品最重要的可靠性增强之一。

## P1-5 CSS 覆盖层仍然过厚

当前约 490 处 `!important`、45 个 media query、885 个颜色字面量/rgba。`src/styles.css` 仍有大量历史补丁，与 `src/styles/shell.css`、`src/features/outline/outline.css`、B3 CSS 共同覆盖同一批选择器。

风险：

- 改动一个 rail 宽度可能影响 4 个 CSS 文件；
- dark mode 依赖选择器顺序；
- pointer-events、overflow、position 的最终值不容易从源码判断；
- 未来继续修滚动条会重复引入回归。

建议分三批整理：

1. 先抽出 `layout-contract.css`：rail、gutter、dock、scrollbar clearance；
2. 再抽出 `motion-contract.css`：duration/easing/starting-style；
3. 最后清理旧规则，禁止新代码写入 `src/styles.css` 的历史补丁区。

不要一次重写所有 B3 样式，也不要改 `src/b3/siyuan/**` 原始移植层。

## P1-6 首屏 bundle 过大

当前构建：

- 入口 JS 约 9.63MB；
- Drawnix chunk 约 4.16MB；
- CSS 约 1.46MB。

建议：

- 普通文本编辑路径不加载 Drawnix；
- 第一次打开画板/思维导图时再动态加载；
- 设置和回收站等低频面板可以延迟加载；
- 先建立资源加载冒烟测试，再做拆包；
- 不要直接对 Lake editor 做动态 import，先确认初始化和切换标签生命周期。

## P1-7 真实 UI 测试仍主要依赖临时 CDP 脚本

当前 314 个测试主要是 domain/store/search 单测；UI 的真实窗口验证脚本在 `/tmp`，没有进入可重复的项目测试命令。

建议增加 `scripts/e2e-electron-smoke.mjs` 或 `e2e/`：

- 启动开发窗口；
- 打开资料库、设置、搜索、同步 Popover；
- 验证 rail 几何；
- 输出截图和 console 错误；
- CI/本地都能运行。

物理鼠标的 Computer Use 仍保留为人工补充，不要求 CI 模拟 macOS hit-test。

# P2：中期工程优化

## UI / 交互

- 大纲、资料库、同步 Popover 的 hover union 逻辑应抽成共享 hook，避免左右两套 timer/pointer 实现继续漂移。
- 顶栏同步图标已有紧凑状态，但 bottom statusbar 仍重复显示本地/同步信息；可在确认用户偏好后收敛为“统计 + 锁定 + 一个状态点”。
- 设置面板 inline style 较多，应统一为 settings tokens/classes。
- 设置搜索目前是导航过滤，不是具体字段搜索；后续可支持进入分类后自动高亮匹配项。
- 大纲 item 的 H1-H6 彩色标签在暗色模式需要对比度审计。
- 空状态、错误状态和同步失败状态需要统一动作按钮样式。
- 浮动面板应该有统一的“打开立即可点、关闭短暂缓冲、固定不受 hover 影响”协议。

## 动效

- 目前存在 120/140/150/180/200/240/260/300ms 多套历史值。
- 建议全部映射到 `--lake-motion-fast/standard/panel`，只在编辑器原生动画外使用。
- 面板打开建议 opacity + transform；布局网格只用于固定 dock，不用于每次 hover。
- 需要补 `prefers-reduced-motion` 的真实窗口验证，而不只是 CSS 存在性检查。
- FLIP 标签动画应在快速连续关闭/拖拽时检查动画叠加。

## React / 代码结构

- `src/App.tsx` 约 1,423 行，承担 bootstrap、同步、标签、窗口、移动端、设置和布局状态；建议按领域拆为 `useWorkspaceBootstrap`、`useSyncController`、`useTabController`、`useShellLayout`。
- `electron/store.ts` 约 1,799 行；暂不建议继续机械拆分事务，但可以先抽 `StoreQuery`、`HistoryRepository`、`ResourceRepository` 的只读边界。
- `electron/sync.ts` 约 1,137 行；建议把 manifest validation、conflict decision、S3 transport、GC plan 分离为纯模块。
- 生产代码约 69 处 `any`/`as any`；Lake editor compatibility layer 可以保留，但应集中到一个 adapter 类型文件。
- 非测试代码约 85 个空 catch；至少应区分“可忽略”与“必须记录”，关键保存、同步、销毁路径要写 logger。
- 全局事件监听较多，应统一使用 `useEventListener` 或 `useLatest`，避免依赖项变化导致 listener 反复安装。

## 存储 / 同步

- 增加 database integrity check：启动时 `PRAGMA integrity_check` 失败时进入只读/备份提示，而不是直接继续。
- 明确 SQLite WAL checkpoint 和历史快照清理的调度关系，避免大库长时间积累 WAL。
- 对 `note_history.refs_json` 做 schema/version 校验，避免历史资源引用数据损坏导致 GC 误删。
- 为上传队列增加可见的 retry count、last error 和 next retry time；当前 UI 只看到笼统同步失败。
- 资源上传和正文保存的状态应有同一条本地事务/队列事实，不要靠 `pendingChanges` 推断。
- S3 manifest 链和墓碑策略已有较多保护，但需要增加“断电发生在 DB commit 与文件 rename 之间”的故障注入测试。
- 大文件/大量资源同步需要 benchmark，而不只是单元测试；至少覆盖 1,000 文档、10,000 资源和 25MB 单资源。

## 安全 / IPC

- 69 个 IPC handler 建议生成共享参数 schema，避免 preload、renderer 类型和 main 校验逐渐漂移。
- 所有 IPC 错误应有稳定 error code；当前 renderer 有多处依赖字符串匹配错误信息。
- CSP 收紧方案仍需在 CDN redirect 覆盖矩阵通过后重新评估。
- 自定义 CSS 是高权限视觉注入点，建议明确它只影响 renderer，不进入同步和导出路径。
- 资源 server、Origin/token 校验需要加入 packaged build 的 smoke test，而非只测 dev URL。

## 测试 / 发布

- 目前没有统一的 packaged Electron smoke test。
- 构建存在 CodeMirror classic script 和 JetBrainsMono runtime path warning，发布前应清零或明确纳入资源 manifest。
- bundle size 应加入预算，例如入口 gzip 不超过当前基线 + 10%。
- 增加 crash/restart 测试：renderer gone、GPU gone、network service restart、窗口重启后 bounds 恢复。
- 增加 accessibility smoke：焦点可见、键盘关闭浮层、dialog label、VoiceOver 读法。

# P3：长期体验打磨

- 多显示器窗口恢复和屏幕断开后的 bounds 修复体验。
- 移动端与桌面端共享搜索和同步状态模型。
- 小记转正式文档时的撤销/失败恢复提示。
- 文档锁定、历史、回收站、同步冲突在视觉上建立统一状态语言。
- 资料库大规模树节点的虚拟化评估。
- 用户自定义主题 token 的可视化编辑器（当前先不做快捷键配置）。

# 推荐实施顺序

## Batch A：可靠性和事实来源

1. 同步 pending summary 主进程化；
2. 冲突历史目标文档化；
3. renderer crash draft journal；
4. IPC error code；
5. packaged smoke baseline。

## Batch B：结构整理

1. layout/motion contract；
2. `App.tsx` shell/sync/tabs hooks；
3. adapter 类型集中；
4. 清理关键空 catch 和字符串错误判断。

## Batch C：性能

1. Drawnix 按需加载；
2. editor/tab lifecycle benchmark；
3. 大树虚拟化评估；
4. CSS containment 和布局 trace；
5. bundle budget。

## Batch D：产品精修

1. 搜索 `newTab` 语义修正；
2. 同步状态与底栏信息收敛；
3. 设置字段级搜索；
4. motion/accessibility QA；
5. 统一错误/空状态。

## 明确不建议现在做

- 不改 Lake 原生工具栏；
- 不继续增加无功能的思源按钮；
- 不重新引入滚动条 hover 增宽；
- 不一次性重写 `Store` 或整个 `src/styles.css`；
- 不在没有故障注入测试前更改墓碑/冲突语义；
- 不为了 bundle 数字牺牲编辑器初始化稳定性。

## Implementation progress after audit

已完成并通过当前质量门禁：

- 当前文档浮动状态条：只显示字数/图片统计和当前文档状态，冲突历史显示 `已同步 · 历史 N`。
- 主进程 authoritative pending summary，覆盖文档、资源、小记和墓碑计数。
- 冲突历史目标文档化。
- 草稿 journal 原子写入、校验、debounce、恢复/丢弃、删除与退出生命周期。
- SQLite integrity check、WAL checkpoint。
- Drawnix lazy JS/CSS 加载与开发/packaged first-use fixture。
- IPC stable error envelope 和 renderer 错误 code 解析。
- Settings hook order、stale lastOpened fallback、top menu hook。
- Dead statusbar CSS override cleanup。
- Packaged smoke、bundle budget、1,000 文档/10,000 资源/25 MiB opt-in benchmark。

当前仍需：

- `App.tsx` 的文档标签职责拆分（菜单、统计、同步反馈已分批抽出）；
- 剩余 sync fault injection 和窗口重启/crash smoke；
- 更深的 Store/sync planner 纯函数抽取；
- 大资料库虚拟化与后台 tab 生命周期 benchmark；
- VoiceOver/focus/reduced-motion 实机 QA。
