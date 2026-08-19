# Lake Notes UI System & Interaction Design

**Date:** 2026-08-19
**Status:** Approved direction, implementation in `feat/lake-notes-ui-system`

## Goal

保留思源式 Lake 文档管理骨架和 Lake 原生编辑器工具栏，把 Lake Notes 的产品壳层收敛为一个安静、可靠、本地优先、同步透明的个人笔记桌面应用，并完成对应的前端代码整理、运行时验证和 UI 审计。

## Non-goals / hard boundaries

- 不为新文档自动生成可区分的临时标题。
- 不增加“最近编辑”视图。
- 不改动 Lake 原生工具栏的行为、布局、能力或 DOM 结构；只允许做必要的宿主容器背景/层叠接线。
- 不搜索小记。
- 不做冲突合并；远端差异写入历史快照，只做轻量提醒。

## Product principles

1. 本地是真相：用户始终知道内容已经保存到本地。
2. 云端是镜像：同步状态可解释，但不打扰写作。
3. 编辑区优先：资料库、大纲、状态栏服务正文，不抢正文注意力。
4. 思源骨架、Lake 工具栏：壳层采用思源式布局，Lake 编辑体验保持原生。
5. 动效服务空间关系：面板、标签、大纲和 Toast 有动效，编辑器内部不额外包装动画。
6. 以真实窗口为准：桌面尺寸、hiddenInset、物理鼠标和 CDP 都要验证。

## Visual system

### Semantic tokens

Light mode 保持现有 B3 daylight 基础；新增 Lake 语义 alias，壳层优先使用 alias。

Dark mode 采用专用阅读色阶：

| Semantic | Value |
|---|---|
| `--lake-shell` | `#17191E` |
| `--lake-panel` | `#202329` |
| `--lake-canvas` | `#272A31` |
| `--lake-border` | `#383E49` |
| `--lake-text` | `#F3F5F8` |
| `--lake-text-secondary` | `#B1BAC8` |
| `--lake-text-tertiary` | `#838D9C` |
| `--lake-accent` | `#78A5FF` |
| `--lake-accent-soft` | `rgba(120,165,255,.18)` |
| `--lake-sync-pending` | `#E4AF5E` |
| `--lake-sync-success` | `#63C47B` |
| `--lake-error` | `#F08078` |

Light semantic equivalents:

| Semantic | Value |
|---|---|
| `--lake-shell` | `#F2F4F7` |
| `--lake-panel` | `#FFFFFF` |
| `--lake-canvas` | `#FFFFFF` |
| `--lake-border` | `#DFE3EA` |
| `--lake-text` | `#252A33` |
| `--lake-text-secondary` | `#667181` |
| `--lake-text-tertiary` | `#8993A1` |
| `--lake-accent` | `#3575F0` |
| `--lake-accent-soft` | `#EDF3FF` |
| `--lake-sync-pending` | `#B7771E` |
| `--lake-sync-success` | `#368A61` |
| `--lake-error` | `#C94A43` |

### Motion

```css
--lake-motion-fast: 120ms;
--lake-motion-standard: 180ms;
--lake-motion-panel: 260ms;
--lake-ease-standard: cubic-bezier(.22, 1, .36, 1);
```

Existing Lake editor motion is out of scope. The shell must support `prefers-reduced-motion: reduce`.

## Sync status design

### Default top-bar state

The top bar shows a compact status control with:

- primary label: `本地已保存`
- secondary count when non-zero: `待上传 N`
- icon/color reflects local/sync state
- no permanent conflict warning

The control remains a button with an accessible label describing the full state.

### Popover content

1. **本地状态**
   - 本地已保存 / 保存中 / 有未保存更改
   - 最近保存时间
   - 当前脏标签数
2. **云端状态**
   - 上次同步时间
   - 待上传文档数
   - 待上传资源数
   - 当前同步进度 / 失败原因
3. **历史快照**
   - only shown after a conflict snapshot event
   - copy: `检测到远端版本差异，已保留历史快照`
   - action: `查看历史`
4. **Actions**
   - `立即同步`
   - `同步设置`

### State semantics

- `local-only`: 本地已保存；无待上传或未配置同步。
- `pending`: 本地已保存；显示待上传数量。
- `syncing`: 显示同步中和进度，不阻塞编辑。
- `synced`: 本地已保存；云端已同步。
- `conflict-snapshot`: 轻量一次性提醒，历史可查，不合并。
- `error`: 明确失败原因和重试入口。

## Search command palette

### Entry

- Global shortcut: `⌘K`.
- Existing sidebar search button opens the same command palette.
- `Esc` closes and returns focus to the previous element.
- Search palette is not a separate route.

### Scope and ranking

- Does not search Quick Notes.
- 1 Unicode character: title only.
- 2+ characters: title and body.
- Ranking: exact title > title prefix > title contains > body hit.
- Ties sort by most recent update.
- Debounce: 120ms.
- Max result count: 50.

### Keyboard behavior

- Arrow Up / Down: change active result.
- Enter: open active result and position the editor at the first body hit when the result came from body text.
- `⌘Enter`: open in a new tab and position at the first body hit.
- Esc: close.

### Result content

Each result may show:

- title
- highlighted snippet
- notebook name/path
- updated time
- local/sync status

The backend must return enough hit metadata for deterministic first-match positioning; if the existing editor protocol cannot accept a position, introduce a small host-to-editor locate request instead of faking a scroll.

## Window and focus mode

- Preserve macOS `hiddenInset` and traffic light position.
- Persist size, position, maximized/fullscreen state through the Electron main process.
- Add a host-level Focus Mode shortcut. Focus mode hides shell chrome, keeps the document canvas, and restores the prior dock/sidebar state on exit.
- All interactive controls in the draggable title-bar row must use `-webkit-app-region: no-drag`.

## Outline and Quick Notes

- Preserve current outline rail trigger and dock/hover behavior.
- Default outline width may be tightened only after real-window verification; no change to the trigger hit zone.
- Improve hierarchy and state styling without changing the Lake editor toolbar.
- Quick Notes keeps its independent workspace identity, but shares Lake semantic tokens, state colors, typography and motion.
- Quick Notes primary actions: `记下`, `记下并转为正式笔记`.

## Code organization

First pass is behavior-preserving cleanup:

```text
src/styles/
  tokens.css
  shell.css
  library.css
  overlays.css
  quick-notes.css
  responsive.css
  editor-bridge.css
```

`src/styles.css` becomes the stable import entry during migration. No broad selector rewrite in the first pass. Do not duplicate or fork Lake editor styles.

## Acceptance criteria

- Light/dark 1280×820 real Electron screenshots show clear shell/panel/canvas hierarchy.
- Dark mode body/title/tool/status text is readable and no editor content is visually lost.
- Default sync state visibly communicates local saved state and pending upload count.
- Conflict snapshot reminder is non-persistent and links to history.
- `⌘K` works from the app shell; 1/2-character strategy is observable.
- Search results support keyboard navigation and open/locate behavior.
- Quick Notes are excluded from search.
- Lake native toolbar behavior remains unchanged in a before/after DOM and interaction check.
- Existing tests, TypeScript, build and git diff checks pass.
- Final UI/code audit documents remaining risks and evidence.
