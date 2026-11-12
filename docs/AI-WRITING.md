# AI 写作（桌面，v1）

> 261109 立项。蓝本 = 语雀 `/dashboard/ai` 实测交互（走查记录见仓库外 `.ai-writing-recon/NOTES.md`，本文件只写我们自己的契约与决策）。
> 红线：本地优先（会话只在本地 SQLite，不进 S3）；AI Key 只在主进程；手机端**不做**（移动端已有 AI 助手）。

## 决策（用户 261109 定稿）

1. **只做桌面端**，不跨端、以后也不做；会话不参与 S3 同步。
2. **模型 = 现有 AI 供应商配置**（设置 → AI 助手），不内置语雀 DeepSeek。未配置 → 页面给引导。
3. **深度思考默认开启、不提供关闭入口**（沿用供应商配置里的 thinking / reasoningEffort）。
4. **生成文档只选到「知识库」= 我们的笔记本**，不再选目录、不做同级/子级。
5. 答案渲染 = **Markdown 交给 Lakex 只读 viewer**（与语雀同一条路径）：流式期间用轻量 `MarkdownView`，收尾后由内核 viewer 接管；内核失败/超时保留 `MarkdownView` 兜底。

## 信息架构

- 新空间 `ai-writing`（顶栏空间菜单第 4 项，⌘4 切换）：隐藏左侧目录栏，**左栏可拖动调整宽度**（`SplitPane`，宽度设备本地；与日记空间同一种分栏原语）。
- 左栏（280px）：「AI 写作」标题 / 「＋ 新对话」/「历史记录」按日期分组（今天/昨天/更早），行悬停出「…」（重命名=行内输入；删除=行内确认气泡）。
- 主区：
  - 空态：分段控件（对话写作 / 多文档推理）→ 大标题 → 「✦ 提示词」→ 输入卡 → 「点一点试试」两个 chip。
  - 会话态：消息流 + 底部输入卡（固定底）。
- 输入卡：提示词库入口、可选文档 chip（多文档模式）、textarea（占位「从这里开始对话」）、发送/停止。
  **提示词 = 点卡片直接把完整提示词写进输入框**（261110 用户定稿；已有文字则换行追加、不覆盖；面板随即关闭并聚焦输入框）。旧的「挂 chip」只保留给历史会话（存过 `promptText` 的仍显示 chip、可移除），新点击不再产生 chip。
- 消息：用户右侧灰气泡；助手头像 + 「已深度思考（用时 X 秒）」+ 思考内容（有 reasoning 才显示）+ 答案 + 操作条（重新生成 / 复制 / 生成文档 / 保存到小记）。

## 数据（本地 SQLite，主库）

```sql
ai_writing_conversations(id TEXT PK, mode TEXT, title TEXT, prompt_text TEXT,
                         doc_refs TEXT, created_at TEXT, updated_at TEXT)
ai_writing_messages(id TEXT PK, conversation_id TEXT, role TEXT, content TEXT,
                    reasoning TEXT, duration_ms INTEGER, stopped INTEGER,
                    error TEXT, sort_order INTEGER, created_at TEXT)
```

- 标题 = 首条用户消息首行 ≤24 字；可重命名。
- `doc_refs` = JSON `[{kind:"note"|"quick-note", id, title}]`（选择时解析成具体文档，快捷组也落成具体清单）。
- 流式消息：先 insert（空 content）→ 结束后 update（content/reasoning/duration/stopped）。
- 停止 = 保留已生成片段，`stopped=1`。

## 请求组装（`core/aiWriting`，纯函数）

- 系统提示：写作助手 + **输出 Markdown**（渲染层按 Markdown 渲染）。
- 多文档：`【资料 1】标题\n正文`，单篇 ≤ 12000 字、合计 ≤ 40000 字、最多 20 篇（超出截断并提示）。
- 历史轮次受字符预算约束（最近若干轮）。

## 交互细节

- 多文档「请选择文档」下拉：快捷组（今天/近一周/近一月的文档 / 小记）+「按笔记本选择」（笔记本 → 其下文档复选）。选中即落成具体 `doc_refs`，chip 显示「N 篇文档」。
- 「生成文档」：弹窗只选笔记本 → 确认 → `convertMarkdownToLake` → `createNoteIn(notebookId, title)` + `saveNote` → toast「已生成，打开」。
- 「保存到小记」：弹层编辑正文 → `createQuickNote` → toast「小记成功」。
- 「重新生成」：删掉最后一条助手消息重新请求；「复制」= 复制答案 markdown，toast「复制完成」。
- 所有失败都落到消息级错误行（不弹窗），可重试。

## 护栏

- `core/aiWriting.test.ts`（标题/预算/消息组装）、`electron/aiWritingRepository.test.ts`（CRUD/排序/删除级联）、
  `ipcChannelParity`（通道三方一致）、`aiClient`（reasoning 解析）。
- 样式只用 `--lake-*` 令牌 + `ln-*` 原语，CSS 进 `layer(feature)`；门禁 `ui-metrics` / `cssLayers`。

## 分层与文件（实现）

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 纯逻辑 | `src/core/aiWriting.ts` | 会话/消息形状、标题推导、日期分组、资料/历史预算、请求组装；**IPC 载荷类型也在这里**（native 桥与主进程共用一份） |
| 主进程数据 | `electron/aiWritingRepository.ts` + `schemaInit.ts` | 两张本地表 + CRUD（级联删除、排序、updated_at 推进） |
| 主进程入口 | `electron/ipc/registerAiWriting.ts` | 9 个通道：校验/上限 → 仓库；通道三方一致由 `ipcChannelParity` 守 |
| 一轮生成 | `src/features/aiWriting/aiWritingTurn.ts` | 流式聚合 + **停止/失败语义唯一实现**（stop 先置位再取消；abort 后正常结束也算停止） |
| 资料读取 | `src/features/aiWriting/aiWritingContext.ts` | 注入 reader；文档优先 Markdown 缓存、小记取纯文本；单篇失败只跳过 |
| 转换 | `src/features/aiWriting/convertAiMarkdown.ts` | Markdown→Lake（仅 render-timeout 重建重试一次，其它错误不重试；可见性等待 + 可取消） |
| 答案渲染 | `AiAnswerViewer.tsx` + `aiAnswerViewer.css` | **lazy 边界**：只读 viewer + `setDocument("text/markdown")`（内核原生解析）；懒挂载、单实例复用、pending→rich 切换 |
| 状态 | `src/features/aiWriting/useAiWriting.ts` | 列表/当前会话/输入卡/发送/停止/重新生成（只做编排，不写网络） |
| 视图 | `AiWritingSidebar / AiComposer / AiPromptLibrary / AiDocPicker / AiMessageView / SaveQuickNoteDialog / AiWritingWorkspace` | 语雀同款交互；样式 `aiWriting.css`（`layer(feature)`，只用令牌） |
| 共享弹窗 | `src/components/app/PublishDocDialog.tsx` + `styles/app/dialogs.css` 的 `.publish-doc*` | 「保存为文档」目标选择（浮窗：只选笔记本 + 标题可改）；与日记「转为文档」共用（261112 task-91，候选由调用方按 core 判据过滤：AI 用 `selectableNotebooks`） |
| 壳层 | `desktopTypes` / `DesktopTopBar` / `useDesktopLifecycle` / `App` | 新空间 `ai-writing`（⌘4，空间菜单第 4 项；隐藏目录栏） |

### 为什么这样分

- **停止语义只有一处**：OpenAI SDK 在 abort 后可能「正常结束」流（实测），若把 stopped 判定散在 hook 里会在成功分支丢掉停止标记；`aiWritingTurn` 内聚后可用纯单测覆盖三种结局。
- **资料读取可注入**：多文档要读正文，但读法随宿主不同（桌面 IPC / 将来其它宿主）；用 reader 接口隔离，纯逻辑可测。
- **IPC 类型单一来源**：渲染层与主进程各写一遍载荷是最容易漂移的地方；类型放 core，主进程只做「unknown → 校验 → 类型」。
- **转换失败要有出口**：内核初始化偶发挂起（窗口被遮挡时 rAF 不触发，已修）；转换层超时重建一次，仍失败则在弹窗内报错、不关弹窗。

## 视觉与原语（261110 统一，用户定稿：先统一、再讨论改版）

**AI 写作的控件全部接回 `kit.css` 的 `ln-*` 原语**，`aiWriting.css` 只留布局（宽度/内距/缩进/两行文本排布）与独有语义件（思考块 / 气泡 / 头像 / 空态 / 门禁 / 横幅 / 建议 chip / 行内确认气泡）。

| 控件 | 原语落点 |
| --- | --- |
| 新对话 | `ln-btn ln-btn--secondary` |
| 历史行 | `ln-row`（选中 `is-selected`）+ 标题 `flex:1` + `ln-ellipsis`；行尾「…」`ln-iconbtn ln-iconbtn--compact ln-row__actions` |
| 提示词 chip / 文档 chip | `ln-tag` + 关闭钮 `ln-iconbtn ln-iconbtn--compact`（16px 命中盒） |
| 工具钮（提示词 / 请选择文档） | `ln-btn ln-btn--ghost`，激活追加 `ln-btn--secondary is-selected` |
| 发送 / 停止 | `ln-btn ln-btn--primary` / `ln-btn ln-btn--secondary`（保留 22px 高度布局） |
| 模式切换（对话写作 / 多文档推理） | `ln-segment` 原语；**261110 用户定稿：原语整体加厚一档**（轨道 26→30、段高 22→27，settings 档 31→35）——全站所有 `.ln-segment` 用例统一生效，不在本页覆盖 |
| 提示词库 | 菜单行列表 `button.ln-menu__item`（宽 360，图标 + 标题 + 说明两行）——**取代原 3 列卡片**（与全仓菜单同一身份） |
| 文档选择 | 快捷组/笔记本/文档行 → `ln-row`（展开 `is-selected`），文本 `ln-ellipsis` |
| 消息操作条 | 重新生成/复制 → `ln-iconbtn--compact`；生成文档 `ln-btn--ghost`；保存到小记 `ln-btn--primary` |
| 生成文档 / 保存到小记弹窗 | **浮动窗**（`useFloatingDialog`：标题栏可拖、8 向缩放、尺寸/位置设备本地记忆；默认 780×460 / 860×620，min 560×340 / 560×420）；内容走 `ln-dialog__head/body/actions` + `ln-form__row` + `ln-btn`；首焦点 = 主操作 / 正文 |
| 新对话按钮 | `ln-btn ln-btn--primary`（**重点按钮**，261110 用户点单；左栏唯一的实心主操作） |

- CSS 基线：`aiWriting.css` **446 → 301 声明**（删掉的都是「同一视觉在业务文件里又写了一遍」）；之后的改版继续复用原语，禁止再长回第二套。
- 本轮**只统一视觉，不改结构/交互/逻辑**；下一轮改版在此基线上讨论。

## 左栏与气泡定位（261110 二改）

| 项 | 口径 |
| --- | --- |
| 左栏字号 | **14px**（标题 17/18 保留层级；行标题与搜索字段用各自类设字号，**不覆盖 `ln-*` 原语**，原语跨所有权门禁保持 0） |
| 两栏宽度 | `SplitPane`（`ai-writing-side`，本地记忆）：min 200 / max 520 / 右栏至少 480；分隔条 = kit `.ln-split-handle`（唯一实现）；拖到右栏下限时按 clamp 停住 |
| 对话搜索 | 顶部 `ln-input--search` 按**标题**过滤（纯显示层，不建索引、不改数据）；无结果给「没有匹配的对话」 |
| 置顶 | 设备本地 `lakex-local-notes-v3.aiwriting.pins`（有序 id，最新置顶在前；会话删除后自动剪枝）；列表顶部出现独立「置顶」段；**不做对话分组**。行内 ⋯ → 置顶/取消置顶 |
| 气泡定位 | 提示词库 / 文档选择的气泡**锚点 = 整张输入卡**，在输入卡**下方居中**展开（`usePopoverPosition` 新增 `align: "center"`；下方放不下按既有规则翻上方，仍居中） |

### 思考块默认折叠（261110 用户定稿；B 方案不做）

- 消息里的思考内容默认**只占一行**：「已深度思考（用时 X 秒）」/流式时「正在深度思考…」+ 主色小点；点这行展开 Markdown 正文，再点收起（`aria-expanded` + 箭头旋转，状态切换瞬时，不做装饰性过渡）。
- 实现：`AiThinkingBlock`（独立件，不把内核 viewer 拖进测试）；`AiMessageView` 只接线。没有思考输出（label=null）时整块不渲染。
- **B 方案（文档面 + 操作条贴卡右上）不做**——只保留这条折叠。示意图仍留在 `docs/mockups/ai-writing-b.html` 作为讨论记录。
### B 方案示意（讨论记录，已决定不做）

- 示意图：[docs/mockups/ai-writing-b.html](mockups/ai-writing-b.html)（浏览器直接打开）
- 改造要点：答案改为「文档面」（白卡 + 文档排版，操作条贴卡右上）；思考块默认收起成一行；用户消息仍为右对齐气泡；左栏 14px + 搜索 + 置顶；气泡贴输入卡下方居中。
## 答案渲染（v1.1，语雀同款）

- **路径**：`createLakeDocument(host, "viewer")` + `setDocument("text/markdown")`。实测内核原生解析覆盖标题/有序无序列表/**任务清单**/表格/引用/代码/行内与块级公式；`getDocument("text/lake")` 仍用于「生成文档」（任务清单落成 `lake-list-task` + checkbox 卡、公式落成 `name="math"` 卡）。
- **流式**：流式期间只用 `MarkdownView`（轻、跟手）；消息收尾后 viewer 挂载并在内核出内容后回调 `onReady` 切换。切换前 viewer 绝对定位 + `visibility:hidden`（照常布局/测量、不占位、不与兜底双份可见）。
- **性能/边界**：viewer 是 **lazy 边界**（内核 chunk ~1.6MB gz 不进首屏；护栏 `desktopKernelLazy.test.ts`）；消息进入视口（提前 600px）才建实例、同实例多次 `setDocument` 不重建；内核 6s 内没出内容 ⇒ 回退 MarkdownView 并保留正文。
- **观感**：正文 14px / 阅读行高 / 正文 400（粗体走内核 700、斜体走 font-style）；标题按 em 缩放（1.6/1.35/1.15/1）；隐藏 viewer 自带的「返回文档」头；首尾块清外边距。

## 已知边界（review 记录）

- 会话/消息只在本机主库：**整库备份**（DB 快照）会带上；**便携包**（桌面→手机）只搬笔记/小记/标签，**不含 AI 会话**（用户定稿：不跨端）。
- 答案 viewer 复用固定 noteId `ai-writing-answer` 只为资源解析，不落盘、不建树节点；AI 输出里的远程图片按 URL 直出。
- 流式期间仍用 MarkdownView（收尾后切内核 viewer），与语雀「直接流进 viewer」不同：实时 viewer 需要高频 `setDocument` 重排，按收益/复杂度暂不做（用户 261109 确认以实际效果为主即可）。

## 测试与门禁

- 单测：`core/aiWriting.test.ts`（标题/分组/预算/消息组装）、`aiWritingRepository.test.ts`（CRUD/级联/排序）、
  `aiWritingTurn.test.ts`（正常/停止/失败/结果兜底）、`aiWritingContext.test.ts`（缓存回落/跳过/截断）、
  `aiWritingDocs.test.ts`（可选集合/窗口/上限/切换）、`convertAiMarkdown.test.ts`（重试策略）。
- 通道：`ipcChannelParity`（注册↔preload↔WEB_METHODS；本批 185，**日记批 +1 ⇒ 现 186**）。
- 样式：`ui-metrics`（0 颜色字面量 / 0 字号字面量 / !important 不变）+ `cssLayers.test.ts`（新文件已登记基线 430）。
- 设备/视觉：本页是桌面空间，按 AGENTS §3#21 只在改动外壳几何时跑 `check:stylesnap` 的相关态。

## v1 明确不做（用户 261109 定稿）

- 移动端不接（移动端已有 AI 助手）；会话不跨端、不进 S3。
- 关闭「深度思考」的入口不提供（默认开）。
- 生成文档只选到知识库（笔记本），不选目录、不做同级/子级。
- 不做停止/重连后的服务端续写；停止即终态（可重新生成）。
