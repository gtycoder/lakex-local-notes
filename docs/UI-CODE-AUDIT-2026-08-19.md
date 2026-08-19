# Lake Notes 前端代码与 UI 审计

日期：2026-08-19
分支：`feat/lake-notes-ui-system`

## 审计结论

本次修改完成了已确认方向的第一轮实现，并保持当前 `master` 不变。核心信息架构没有推翻：

```text
活动轨 → 资料库 → Lake 文档编辑器 → 大纲
```

Lake 原生编辑器工具栏保持原样；新增能力全部位于应用壳层或搜索/同步协议层。

## 已实现

### 视觉与主题

- 新增 `src/lib/uiTokens.ts` 和 `src/styles/tokens.css`。
- 统一 Lake 语义 token：shell、panel、canvas、border、text、accent、sync states、error。
- 深色模式实际窗口验证为：
  - sidebar `rgb(32, 35, 41)` = `#202329`
  - document panel `rgb(32, 35, 41)` = `#202329`
  - editor text `rgb(243, 245, 248)` = `#F3F5F8`
  - statusbar `rgb(23, 25, 30)` = `#17191E`
- 新增 120ms / 180ms / 260ms shell motion token。
- 统一 focus-visible 和 reduced-motion。

### 同步

- 新增 `SyncStatusPopover`。
- 默认显示“本地已保存”。
- 有待上传内容时显示数量。
- Popover 显示本地保存、脏标签、上次同步、文档/资源待上传数量。
- 远端差异只提示“已保留历史快照”，不做合并。
- 原有同步 Toast 继续承担同步进度和错误，不重复制造常驻冲突横幅。

### 搜索

- 全局 `⌘K` 入口。
- 搜索标题和正文，不搜索小记。
- 1 字标题搜索。
- 2 字标题 + 正文搜索（包括中文短词 fallback）。
- 3 字以上使用 FTS5，并按标题完全匹配、标题前缀、标题包含、正文命中排序。
- 结果支持标题/正文标识、笔记本、更新时间、键盘上下选择、Enter、`⌘Enter`、Esc。
- 命中正文后由 `locateEditorSearchHit` 滚动到第一个命中块并短暂高亮。

### 窗口

- 新增 `electron/windowState.ts`。
- 保存和恢复窗口位置、尺寸、最大化、全屏状态。
- 恢复时限制到当前主屏 work area，避免窗口跑出屏幕。
- 新增 `⌘⇧Enter` Focus Mode，隐藏壳层但保留编辑区。

### 视觉整理

- 新增 shell、overlay、quick-notes、responsive、editor-bridge 入口文件。
- 设置面板增加搜索设置入口。
- 小记和大纲接入 Lake semantic token。
- 未增加最近视图、未自动重命名文档、未改 Lake toolbar。

## 文件边界

| 层 | 主要文件 | 责任 |
|---|---|---|
| semantic tokens | `src/lib/uiTokens.ts`, `src/styles/tokens.css` | Lake 产品色阶和 motion |
| shell | `src/styles/shell.css` | 窗口、面板、焦点模式、暗色表面 |
| overlays | `src/styles/overlays.css` | 同步 Popover、搜索、设置搜索 |
| editor bridge | `src/styles/editor-bridge.css` | 搜索命中高亮等必要宿主接线 |
| sync UI | `src/components/SyncStatusPopover.tsx` | 本地/云端状态解释 |
| search | `electron/searchRepository.ts`, `src/components/SearchPanel.tsx` | 标题/正文搜索与定位 |
| window | `electron/windowState.ts`, `electron/main.ts` | bounds 持久化 |

## 代码质量观察

### 已改善

- 新行为都有纯函数/仓储测试。
- 搜索短词和窗口 bounds 具备回归测试。
- 新壳层样式通过后置文件覆盖旧 B3 规则，避免直接重写思源文件。
- Lake 原生编辑器未被复制或重排。

### 仍需整理

1. `src/styles.css` 仍然约 128KB，历史补丁和产品规则尚未完全拆出。
2. 旧的硬编码 shell 色值仍存在于 legacy CSS；本轮只把新逻辑迁移到 semantic token。
3. 同步顶部状态和底部状态栏存在一定信息重复，后续可在用户实测后决定是否收敛底部文本。
4. `SearchPanel` 还没有完整的 React DOM 交互测试框架，当前依赖纯函数测试、IPC 仓储测试和真实 Electron 验证。
5. `⌘K` 已在真实 Electron 窗口通过 Computer Use + CDP 验证；Focus Mode 仍需要解锁 Mac 后做一次物理键盘复核。

## 不应做的重构

- 不要把 Lake toolbar 复制进应用代码。
- 不要为“像思源”继续增加无功能按钮。
- 不要以最近视图或自动标题改变资料库语义。
- 不要为了减少 CSS 文件大小而一次性改写所有 B3 选择器。

## 证据

- Light screenshot: `/tmp/lake-notes-ui-system-light.png`
- Dark screenshot: `/tmp/lake-notes-ui-system-dark.png`
- Sync popover: `/tmp/lake-notes-ui-system-sync.png`
- Final CDP health: 1280×820, 2,098 DOM nodes, 27 Lake toolbar buttons, 2 KaTeX scripts, 0 console errors.

## Follow-up pass: 2026-08-19 21:xx

- Focus Mode now remains reversible from the existing breadcrumb “更多” menu; the hidden outline rail no longer steals the top-right menu hit area.
- Workspace label is intentionally shortened to `本地空间`.
- Sync control is now icon-only with a small pending-count badge; detailed text remains in the click Popover and accessible label.
- Added a fixed, read-only shortcut reference category in Settings.
- Outline floating preview now has a bounded vertical surface (`top/bottom: 72px`) rather than occupying the whole right column.
- Removed the rail-to-panel pointer dead zone by making the trigger cover the full collapsed rail width and adding a short leave grace period. The panel can now be entered and outline items clicked without disappearing.
- Scrollbar ownership remains centralized in `src/b3/layout.css`; no new competing scrollbar skin was added. The outline list uses `overflow: auto` and `overscroll-behavior: contain` only.

Evidence:
- `/tmp/lake-notes-outline-hover-fixed.png`
- `/tmp/lake-notes-ui-iteration-final.png`
- Real DOM geometry: floating outline `x=1048, y=110, w=200, h=638`; hidden state `pointer-events: none`; hovered state `pointer-events: auto`.
