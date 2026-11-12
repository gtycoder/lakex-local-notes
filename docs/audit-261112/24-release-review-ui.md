# 24 发版前 UI 复核（261112）

> 只读复核：**未改动任何产品代码**；本文件是本批唯一新增文件。
> 基线 `c2d4962b`（test(stylesnap): 桌面 42 态基线重烤）.. `99df5f86`（docs(handoff): 日记收口批回写）；
> 复核范围 = 本批 UI 相关提交（下表 9 个）涉及 `src/components`、`src/App.tsx`、`src/desktop`、`src/styles`、`src/features/diary`、`src/features/aiWriting`，以及它们消费的 `src/core/capabilities/readonlyReason.ts`、`src/core/syncWarningText.ts`、`src/core/noteInfo.ts`。

## 0 结论摘要

- **无 P0 / P1 阻塞项**。回收站整行可点与标题宽度、共享「保存为文档」弹窗、NoticeToast 跨空间可见性、只读原因与同步 warning 列表四项主改动**功能正确**，均有行为/单测或活实例证据。
- 2 个 **P2**：(a) 回收站行 `role="button"` 内嵌交互控件（恢复/彻底删除/展开）的读屏语义退化；(b) 非知识库空间 toast 固定贴底，推断会在**已配置 AI 的 AI 写作空间**覆盖 composer 动作行（本机 AI 未配置，无法实测，需目视确认）。
- 若干 P3（死类名、warning 列表无渲染测试、间距字面量、文案/记忆键细节），见 §9。
- **已删除能力 0 代码残留**：「取消日记标记」IPC/UI/写路径、「重命名日记本」「更换日记本图标」入口全部移除，仅剩注释/负断言/文档说明。
- **快照：42 态 0 命中**（详见 §7）；发版前建议跑一次全量 `check:stylesnap` 兜底。

## 1 门禁实跑（本次实测）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run src/components src/features/diary src/features/aiWriting src/features/editor src/styles src/desktop src/core/capabilities …`（另含 9 个相关 core 测试文件） | **152 文件 / 1015 用例通过**（30.5s） |
| `npx vitest run electron/diaryQuickNoteConversion.test.ts electron/diaryStore.test.ts electron/ipc/ipcChannelParity.test.ts` | 3 文件 / 18 用例通过 |
| `node scripts/ui-metrics.mjs` | 颜色字面量 0、字号字面量 0、`!important` 9/9、未定义令牌 0、跨文件重复 45/45、`shadowedDecls` 0 |
| `src/styles/cssLayers.test.ts`（含在 vitest 内） | 3 用例通过（dialogs 112 / panels 106 / components 391 / aiWriting 339 基线一致） |
| `node scripts/check-arch.mjs` | import 违规 0；桌面首屏 571.4KB/600KB；移动 350.3KB/360KB |
| `npm run check:core` | core 文件 177，违规 0 |
| `git diff --check c2d4962b..HEAD` | 无输出（干净） |

说明：本次为**相关域**门禁（152 文件），全量 vitest 与 42 态真机门禁按发版流程由 Lead 统一跑。

## 2 本批 UI 提交与改动面

| commit | 内容 | 影响面 |
| --- | --- | --- |
| `3cf19a29` | 回收站「云端已删除（仅本地）」整行可点、标题不再被徽标挤成 0 宽 | `TrashPanel.tsx`、`panels.css` |
| `e06eaf99` | 只读原因单一来源 + 同步 warning 可读 + 冲突/只读文案档位统一 | `readonlyReason.ts`、`MultiTabEditor.tsx`、`SyncStatusPopover.tsx`、`syncWarningText.ts`、`documentStatusModel.ts`、`noteInfo.ts`、`components.css` |
| `d4d03260` | 移动目标候选统一剔除日记子树 | `core/diary.moveTargetCandidates`、`MoveTargetTreeDialog.tsx`、`DiaryWorkspace.tsx` |
| `f965e62c` | 日记「转为文档」复用 AI 共享弹窗 | `PublishDocDialog.tsx`（提升到 components/app）、`DiaryWorkspace.tsx`、`diaryConvert.ts`、`App.tsx`、`dialogs.css` |
| `4b6a524a` | 日记「转为小记」原样承载正文并搬运媒体 | `diaryQuickNote.ts`（改文案）、`App.tsx`、electron 侧转换 |
| `199f3403` / `fd58dc0a` | 移除「取消日记标记」、日记本固定不可变 | `DiaryWorkspace.tsx`、`App.tsx`、core/electron IPC |
| `400dcc75` | 非知识库空间也能看到 showNotice | `NoticeToast.tsx`（新增）、`DesktopStatusBar.tsx` |
| `866babd1` | 复制图片写原图尺寸 | `imageDimensions.ts`、`clipboardHtml.ts` |

## 3 逐项回归审查

### 3.1 回收站：整行可点 + 标题宽度 + 预览兜底（task-89）

| 检查点 | 结论 | 证据 |
| --- | --- | --- |
| 整行点击触发预览 | 通过 | 行 `onClick` + `role="button"` + `tabIndex=0`（`TrashPanel.tsx:79`）；行内恢复/彻底删除/展开箭头均 `stopPropagation`；键盘 Enter/Space 走同一路径且有 `target !== currentTarget` 守卫 |
| 标题/时间兜底 | 通过 | `trashItemTitle/trashItemMeta`（`TrashPanel.tsx:27-42`）；无标题显示「文档/目录」、无 `deletedAt` 不留悬空「，」 |
| 缺正文不空白占位 | 通过 | `trashPreviewHint`（`TrashPanel.tsx:50`）+ `readNote.bodyMissing` 分支（`TrashPanel.tsx:234`）；`role="status"` 显示 hint（`TrashPanel.tsx:403`） |
| 标题被徽标挤压根治 | 通过（实测） | `panels.css:58` 文本 `flex: 1 0 96px`；实测修复前 textW=0、修复后 textW=96（task-89 活实例 9237） |
| 窄左栏徽标截断 | 可接受（见 P3-6） | 287.5 行宽下 badge 收缩到 67.72/42.78，文字被截断但 title 兜底 |

### 3.2 共享「保存为文档」弹窗（AI 生成文档 + 日记转为文档，task-91）

| 检查点 | 结论 | 证据 |
| --- | --- | --- |
| 单一实现、样式中性段 | 通过 | `components/app/PublishDocDialog.tsx`（唯一）；`.publish-doc*` 在 `dialogs.css:73-84`；旧 `features/aiWriting/PublishDocDialog.tsx` 已删 |
| 候选只到笔记本这一层 | 通过 | 弹窗不再过滤，消费调用方列表；AI 侧 `selectableNotebooks`、日记侧 `moveTargetCandidates(treeNodes).filter(notebook)`（`DiaryWorkspace.tsx:143`） |
| 标题默认日期可改、回调带 (notebookId, title) | 通过 | `PublishDocDialog.tsx:54-106`；render 测试 5 条（含 trim/空标题不可确认、heading/description 换口径） |
| 先 move 再 rename、失败可见 | 通过 | `diaryConvert.ts:41-62`（顺序 + 两种失败文案）；`App.tsx:578-593` 注入 `native.moveTreeNode`/`renameTreeNode`；单测 5 条 |
| 日记本不可作目标 | 通过 | `core/diary.moveTargetCandidates` + `MoveTargetTreeDialog` 内部过滤（Sidebar 同源）；回归测试覆盖 |
| 记忆键变化 | 见 P3-4 | `useFloatingDialog` id 由 `aiw-publish-doc` 改为 `publish-doc`（设备本地尺寸记忆重置一次） |

### 3.3 NoticeToast：非知识库空间可见（task-93）

| 检查点 | 结论 | 证据 |
| --- | --- | --- |
| 提示在所有空间可见 | 通过（真机） | `NoticeToast.tsx:20-33` 唯一标记；`DesktopStatusBar.tsx:52` 非知识库分支返回 toast；活实例（隔离 9240）日记空间可见「已转为文档」「已转为小记」提示，rect 居中于 workspace、底距 42px |
| 知识库行为不变 | 通过 | toast 位置/类名与改动前一致（实测 rect 622/748/260/30 不变）；状态栏内联 message 仍在 |
| error-banner 不受影响 | 通过 | 失败仍走 `setError` 的 `.error-banner`（独立宿主）；toast 用 `role=status`、error 用 `role=alert`，语义不混 |
| z 序/视觉 | 通过 | 沿用 `.document-notice-toast`（z=190 -> `--lake-z-statusbar-popover`），无新 CSS/!important |
| 与 AI composer 重叠 | **待确认（P2-2）** | 非知识库空间 toast 固定 bottom 42px；AI 空间 `.aiw-dock` 贴底（`aiWriting.css:97`）=> 已配置 AI 时 toast 推断覆盖 composer 动作行；本机 AI 未配置（gate 状态，无 dock），未能实测 |

### 3.4 只读原因与同步 warning 列表（e06eaf99 / task-66）

| 检查点 | 结论 | 证据 |
| --- | --- | --- |
| 只读原因单一来源 | 通过 | `readonlyReason.ts:64-74` 优先级 bodyMissing > cloudDeleted > trashed > locked；`MultiTabEditor.tsx:335-345` 横幅、`MissingBodyPanel` 共用文案 |
| 冲突档位不再被绿色历史盖住 | 通过（修复） | `documentStatusModel.ts:31-36` 冲突优先，label「内容冲突（历史 N）」；单测更新 |
| 三义措辞收口 | 通过（主要面） | 「内容冲突 / 同步记录 / 历史快照」；`noteInfo.ts:59`、`SyncConflictsPanel.tsx:81`、`HistoryPanel.tsx:341`、`syncConflicts.ts:26,55` 一致；小记卡「同步冲突副本」为既有文案（未在本批范围内） |
| warning 不分青红皂白「都会重试」 | 通过（修复） | `syncWarningText.ts:21-60` 8 kind 的 label/hint/retryable；`retryable=false` 三类不写「下次同步会重试」；摘要分「需处理 / 可重试」 |
| warning 列表交互 | 通过（实现）/ 覆盖不足 | `SyncStatusPopover.tsx:251-305` 摘要 + ≤5 行可点 + 「另 N 条」+ 诊断入口；**无渲染测试**（见 §8） |
| 历史快照语义 | 通过 | 「快照保留，剩余 N 天」（`HistoryPanel.tsx:341`）不再说「冲突保留」 |

### 3.5 日记两个出口与已移除能力

| 检查点 | 结论 | 证据 |
| --- | --- | --- |
| 目录/移动不再以日记本为目标 | 通过 | `moveTargetCandidates`（core 单一判据）；`MoveTargetTreeDialog` 内部过滤 + 回归测试（含搜索命中也过滤） |
| 日记「转为文档」 | 通过 | 共享弹窗 + 先 move 再 rename；真机验证（隔离实例 CDP 9239，task-91）：标题默认日期可改、树里出现改名后的文档 |
| 日记「转为小记」媒体搬运 | 通过（electron 侧） | `diaryToQuickNoteNotice`（`diaryQuickNote.ts:18-28`）按 `droppedKinds` 明说；electron 转换测试 5/5 通过（图片+附件搬作用域、原文进回收站、原资产保留） |
| 「取消日记标记」无入口/无 IPC/无写路径 | 通过 | §4 残留核查 |
| 日记本改名/换图标/排序入口移除 | 通过 | `DiaryWorkspace.tsx:283-296` 只读展示；render 测试断言 `重命名日记本`/`更换日记本图标` 为 null 且无排序按钮 |

### 3.6 样式层与基线

- 本批 4 个样式文件 + 基线同步：`dialogs.css 94->112`、`panels.css 99->106`、`components.css 358->391`、`aiWriting.css 350->339`；每条都在 `cssLayers.test.ts` 写了来历（搬移/新增交互形态），无「悄悄抬高」。
- `!important` 未新增（9/9 允许清单）；颜色字面量 0、字号字面量 0；0.5px 统一（本批唯一 .6px 收口在 `components.css:215`）。
- 新增 CSS 均为既有层（legacy）就地追加，未引入第二套样式范式；`.publish-doc*` 属中性段（dialog 家族），`.sync-status-warning-*` 属既有 `.sync-status-*` 家族。
- 死 CSS 审计：桌面候选 1 条 `.diary-split-handle`（**非本批引入**；由 SplitPane 动态类名拼接，属审计口径盲区，建议人工确认后清理）。

## 4 已删除能力残留核查

| 能力 | 代码 | IPC/桥 | 结论 |
| --- | --- | --- | --- |
| 取消日记标记（整本） | `src` 内仅 `mobile/bridge/diary.ts:3`、`mobile/diary/DiaryPage.tsx:305` 的**注释**提及历史裁决；`mobileDiaryWiring.test.ts:72-75` 为负断言 | 0 命中（`diary_unmark` / `diaryUnmark` / `unmark` 在 electron 与 src 全部为 0） | 无残留 ✅ |
| 重命名日记本 | 仅 `DiaryWorkspace.render.test.tsx:243` 负断言（`toBeNull`） | 通用 `renameTreeNode` 保留（普通笔记本用），主进程 `assertNotDiarySubtree` 拒绝日记子树（`noteMetadataRepository.ts:90-94`，测试 `diaryImmutable.test.ts`） | 无残留 ✅ |
| 更换日记本图标 | 仅 `DiaryWorkspace.render.test.tsx:244` 负断言 | 通用 `setNodeIcon` 保留，日记子树被同一守卫拒绝 | 无残留 ✅ |
| 文档/指南表述 | `docs/DIARY.md`、`docs/AI-WRITING.md`、`guide/16-diary.md` 均写「不做/已移除」 | - | 一致 ✅ |

## 5 设计系统红线核对

| 红线 | 结论 | 证据 |
| --- | --- | --- |
| 令牌唯一来源（颜色/圆角/字号/动效） | 通过 | ui-metrics：颜色 0、字号 0、未定义令牌 0；新增 CSS 全 `--lake-*` |
| 层序/@layer | 通过 | 新规则写入 legacy 域文件（既有约定），未写 vendor，未用层级 hack |
| `!important` 允许清单 | 通过 | 9/9，未新增 |
| 0.5px 边框 | 通过 | 本批无新增边框；`.6px` 收口为 `0.5px`（`components.css:215`） |
| 无第二样式范式/无手写 portal | 通过 | 浮层仍走 `Overlay`（`Dialog`/`Select`/`Popover`/`Menu`）；组件内无 `createPortal` |
| 组件不写内联 `style={{}}` | 通过 | 本批新增/改动 TSX 无内联 style（`useFloatingDialog.panelStyle` 属既有浮动窗机制） |
| 图标只用 lucide | 通过 | 新代码仅 lucide（X/File/Folder/Trash/TriangleAlert 等）；无 emoji/系统字形 |
| 界面文案不用中点「·」 | 通过（本批新增文案 0 违规） | 新增文案无「·」；`readonlyReason.test`/`syncWarningText.test` 均有 `not.toContain("·")` 断言。既有例外（不在本批）：`core/aiCorpus.ts:43`、`mobile/bitable/mobileBitableViewState.ts:23`、`mobile/settings/UpdateCenterSection.tsx:241` 仍用「 · 」拼接 |
| 间距只用 `--lake-space-*` | **轻微偏离（P3-3）** | `components.css:29-35` 新增 warning 行用 2px/4px/6px 字面量（tokens 有 `--lake-space-xxs/xs/sm` 同值档）；ui-metrics 不校验间距，未被门禁拦截 |
| 同一语义一套视觉 | 基本通过 | 共享弹窗/共享 toast 已单一来源；`sync-status-warning-open` 是 popover 内紧凑行，未复用 `.ln-row`（属既有 `.sync-status-*` 家族，见 P3-5） |

## 6 可访问性核对

| 点 | 结论 | 证据/备注 |
| --- | --- | --- |
| 回收站行键盘可达 | 通过 | `tabIndex=0` + Enter/Space + `preventDefault`；行内控件独立 Tab |
| 回收站行读屏语义 | **风险（P2-1）** | `role="button"` 行内嵌 `<button>`（恢复/彻底删除）与 `role="button"`（展开）；ARIA 规定 role=button 后代呈 presentational，读屏可能丢失子控件语义（键盘仍可达） |
| 回收站行名称/选中态 | 通过 | `aria-label` 含「预览/目录」语义；`aria-current` 标记当前预览项 |
| 预览空态可感知 | 通过 | hint 用 `role="status"` |
| 共享弹窗 | 通过 | `Dialog label={heading}`、标题输入 `aria-label="文档标题"`、`Select label="选择知识库"`、关闭钮 `aria-label="关闭"`、`initialFocus` 到标题输入 |
| toast | 通过（细节见 P3-2） | `role="status" aria-live="polite"`；动作按钮为文本按钮；提示不可用读屏回读（无 dismiss 焦点） |
| 同步 warning 行 | 部分 | 行按钮可点可聚焦；处理提示仅 `title`（`SyncStatusPopover.tsx:276`），读屏不稳（P3-2） |
| 只读横幅 | 通过 | `role="status"`；新增「解锁」按钮有文本；reasons 文案无中点 |
| 日记本只读展示 | 通过 | 图标 `aria-hidden`，名字文本保留可读 |

## 7 快照影响评估

- **桌面 42 态：0 态命中**。本批 CSS 只增/改 `.trash-tree-node*`、`.publish-doc*`、`.sync-status-warning-*`、`.save-conflict-dialog*`、`.tab-deleted-badge`、`.ln-list-item` 的 cursor/flex 等；42 态清单（`scripts/css-audit/stylesnap.mjs:195-243`）不含回收站/历史/保存冲突/同步 warning/共享弹窗态。
- 移动端：本批桌面改动不触达 `src/mobile/**`；移动快照基线在范围内已重烤（`adcfa2ea`，10/10 0 差异），移动侧另见 `25-release-review-mobile.md`。
- 建议：发版前跑一次全量 `check:stylesnap`（42 态）+ `check:mobile-snap`（10 态）+ `check:tabletsnap`，作为「无态命中」结论的兜底证据。

## 8 测试覆盖缺口

1. **同步 warning 列表 UI 无渲染测试**：`SyncStatusPopover.tsx:251-305` 的 ≤5 行、「另 N 条」、点击打开文档、`role=status` 均无护栏；仅有 core 文案单测（5 条）与 `cssLayers` 基线。
2. **桌面只读横幅无渲染测试**：`MultiTabEditor.tsx:665-676` 新增「内容冲突/回收站/锁定/云端已删除」四档与「解锁」按钮，只有 `readonlyReason.test.ts` 覆盖文案/优先级；组件接线（App → DesktopLibrary → MultiTabEditor 的 `cloudDeletedNoteIds`）只有静态 grep 级别的间接保障。
3. `TrashPanel` 行的「点行内徽标也触发预览」「行内按钮不连带选中」有 render 测试（5+2 条）✅；共享弹窗 5 条 ✅；NoticeToast 6 条 ✅。

## 9 问题清单（只列问题，不改代码）

| 级别 | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| P2-1 | 回收站行 `role="button"` 内嵌原生按钮/`role=button` 箭头 => 读屏可能丢失子控件语义（ARIA presentational children） | `TrashPanel.tsx:79`（行）、`:93`（箭头）、`:116`/`:122`（恢复/删除） | 行改为 `role="group"` + 行内文本区独立可点按键，或 `role="option"` + `aria-selected`（配 listbox 语义）；保留 `aria-label`/键盘 |
| P2-2 | 非知识库空间 toast 固定 bottom 42px，推断在**已配置 AI** 的 AI 写作空间覆盖 composer 输入/发送行（toast 容器 `pointer-events:auto`，2.2s/8s 内可能拦截点击） | `NoticeToast.tsx:24` + `document-status.css:33-45` + `aiWriting.css:97` | 在 AI 空间目视/命中测试确认；如需修：非 library 空间把 toast 抬到 dock 之上，或容器 `pointer-events:none` + 动作按钮 `auto` |
| P3-1 | `.diary-dir__icon` 已无任何 CSS（原按钮靠 `ln-iconbtn` 给 26×26/hover），现为 span 裸类名 => 死类名 + 图标尺寸不再由样式表定义 | `DiaryWorkspace.tsx:289`、`diary.css` 无该选择器 | 删除类名或补一条 size 声明；若要保留视觉档位请写成令牌 |
| P3-2 | warning 行的处理提示只放在 `<li title>`，按钮无 `aria-describedby` => 读屏/键盘用户拿不到 hint | `SyncStatusPopover.tsx:276`（行结构 `:264-291`） | 把 hint 作为 `aria-label`/`aria-describedby`，或按钮内加视觉隐藏文本 |
| P3-3 | 新增 warning 行 CSS 用 2/4/6px 字面间距（`--lake-space-xxs/xs/sm` 同值档已存在） | `components.css:29-35` | 换令牌，避免间距第二来源 |
| P3-4 | 共享弹窗浮动窗记忆键由 `aiw-publish-doc` 改为 `publish-doc` => 已有用户本地记忆的窗口尺寸/位置重置一次（设备本地，非同步数据） | `PublishDocDialog.tsx:54` | 可接受；若在意可保留旧 id |
| P3-5 | `sync-status-warning-open` 是自定义紧凑行，未走 `.ln-row`/`.ln-menu__item` 原语（与「同一语义一套视觉」有张力） | `components.css:33-35` | 记录为例外；后续收口时评估并入 kit 行原语 |
| P3-6 | 回收站窄左栏下 `N 天后清除` 等徽标被截断（靠 title 兜底），信息损失可接受但需知情 | `panels.css:58-66` | 非阻塞；如用户在窄分栏依赖倒计时，可评估在窄行隐藏次要徽标（容器查询） |
| P3-7 | `PublishDocDialog` 的 `useEffect` 依赖 `options[0]?.value`：标题编辑期间若目录树刷新导致首本变化，用户已改标题会被重置为默认值（低概率） | `PublishDocDialog.tsx:61` | 仅在 `open` 从 false->true 时重置，或记录用户是否手改过标题 |
| P3-8 | `diaryToQuickNoteNotice` 固定文案含「含图片/附件」，无媒体时也这么写（措辞略过度） | `diaryQuickNote.ts:18` | 按实际搬运数量决定是否提「图片/附件」 |

## 10 发版建议

- 阻塞项：无。P2-2 建议在已配置 AI 的桌面实例做一次 5 分钟目视确认（AI 空间 生成文档/保存小记 后 toast 是否遮挡 composer）；P2-1 可随下一批 UI 收口一起改；若本版必须发，按已知小问题接受（不阻塞）。
- 发版前兜底（可选、低成本）：全量 `npx vitest run`、`npm run check:stylesnap`（42 态）、`check:mobilesnap`/`check:tabletsnap`（本次桌面改动理论上 0 影响）。
- 本批复跑命令：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npx tsc --noEmit
npx vitest run src/components src/features/diary src/features/aiWriting src/features/editor src/styles src/desktop
npx vitest run electron/diaryQuickNoteConversion.test.ts electron/diaryStore.test.ts electron/ipc/ipcChannelParity.test.ts
node scripts/ui-metrics.mjs && npm run check:core && npm run check:arch
git diff --check c2d4962b..HEAD
```

## 附：未覆盖范围

- electron 主进程转换实现（`electron/diaryQuickNoteConversion.ts`、IPC 注册）只做了**行为级**测试与三处登记检查，未做逐行安全复审（属 core/electron 复核批次）。
- 移动端行为与设备门禁用例见 `25-release-review-mobile.md`（本报告不重复）。
- 本报告未启动 42 态桌面装置；快照结论基于 selector/态清单静态比对 (§7)。

