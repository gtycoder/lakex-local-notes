# Lake Notes Optimization Progress

日期：2026-08-20

## User decisions

- 顶栏保留 `本地空间` 和全局同步状态。
- 底部状态只代表当前文档，保持简单：`字数 N`、`图片 N`、当前文档状态。
- 远端覆盖本地时，本地版本进入历史；处理完成后突出显示 `已同步 · 历史 N`。
- Lake 原生编辑器工具栏不改动。

## Completed

1. UI shell / rail / outline hover and scrollbar safety；左右固定 rail 统一为 38px。
2. Floating current-document status bar：不占 workspace grid row，空文档也稳定显示 `字数 0 / 图片 0`。
3. `已同步 · 历史 N` 状态使用高亮胶囊样式；通知移到独立短暂 toast，不污染底部纯状态条。
4. Authoritative sync pending summary：主进程返回文档、资源、小记数量，含删除墓碑。
5. Document-targeted conflict history notices。
6. Renderer crash draft journal：原子写入、校验、debounce、恢复/丢弃、删除文档/清空回收站清理、关闭前 best-effort flush。
7. SQLite integrity check at startup and WAL checkpoint on quit。
8. Drawnix lazy JS/CSS loading，普通文本路径不加载 Drawnix JS。
9. Real first-use Drawnix fixture：开发版与 packaged 版都验证了 card DOM、Plait board、动态 CSS 和非 fallback 状态。
10. IPC error envelope：`NOT_FOUND`、`INVALID_INPUT`、`NOT_CONFIGURED`、`INTERNAL`；兼容 Electron/contextBridge 丢失自定义 Error 字段的消息前缀解析。
11. 设置面板 Hook 顺序修复；启动时失效的 `lastOpenedNoteId` 自动回退到仍存在的文档。
12. `useTopMenus`：将顶栏菜单状态和 outside-click 行为从 `App.tsx` 抽出。
13. `useDocumentStats`：抽出字数/图片统计和稳定 debounce；`useSyncController`：抽出用户触发同步反馈循环。
14. `mergeLockState` 抽为独立同步决策纯函数并补单测。
15. 清理失效的旧 statusbar CSS 覆盖，保留当前文档状态条专用样式。
15. 添加 opt-in workspace capacity benchmark：1,000 文档、10,000 资源、25 MiB 单资源。
16. 远程导入先落文件后提交 DB；rename 故障注入不会留下已同步但缺正文的记录。
18. Packaged smoke：设置面板、普通 UI、Drawnix 首次使用均覆盖；packaged 使用独立 `LAKE_ASSET_PORT`，避免与 dev 资源服务冲突。

## Current quality gates

最近一次验证：

- `npm test -- --run`：41 个测试文件，334 passed，1 个 opt-in benchmark skipped。
- `npx tsc --noEmit`：通过。
- `npm run check:bundle`：通过。
  - app JS gzip 约 2.58 MB / 2.9 MB budget
  - Drawnix JS gzip 约 1.24 MB / 1.4 MB budget
  - app CSS gzip 约 181 KB / 2 MB budget
- `npm run test:ui`：通过；验证普通文本不加载 Drawnix JS、状态条、设置、同步 Popover、rail 38px。
- `npm run test:drawnix`：通过；验证动态 Drawnix card 首次渲染。
- `npm run test:packaged`：通过；覆盖 packaged 普通 UI、设置和 Drawnix first-use。
- `npm run benchmark:tabs`：通过（packaged，临时 24 标签上限）：8 tabs 约 309ms，24 tabs 约 442ms；24 个 editor / engine，约 5,936 DOM 节点，当前不触发自动淘汰。
- `npm run benchmark:workspace`：通过（基准机）：
  - 1,001 notes：约 227ms 创建
  - 10,000 resources + 25 MiB：约 708ms 写入
  - pending summary：约 30ms
  - title search：约 1ms

## Remaining / next

1. 继续拆分 `App.tsx`：优先 `useDocumentTabs` 和 shell layout，不改变 state ownership。
2. Store / sync 只抽纯函数和 planner：manifest validation、conflict decision、GC planner；不机械迁移写事务。
3. 增加剩余同步故障注入：DB commit/rename 进程中断、manifest 上传中断、S3 网络中断、WAL checkpoint 失败、资源半成品下载；远程导入 rename 故障已覆盖。
4. `test:packaged:full` 已覆盖窗口 bounds、renderer crash/draft recovery、GPU/network utility helper crash；真实硬件驱动异常仍需长期观察。
5. 继续统一 renderer 错误展示和可访问性；VoiceOver / focus / reduced-motion 实机回归。
6. 大资料库虚拟列表、后台 tab 生命周期和低频面板加载继续观察；当前 24 tabs 小文档基准通过，但仍不提前引入后台卸载复杂性。

## Explicitly not doing

- 不改 Lake 原生工具栏。
- 不增加最近编辑视图。
- 不自动修改新文档标题。
- 不做冲突合并；远端胜出，本地冲突版本进入历史快照。
- 不重新引入滚动条 hover 增宽。
