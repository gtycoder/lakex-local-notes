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
                    attach_refs TEXT, reasoning TEXT, duration_ms INTEGER, stopped INTEGER,
                    error TEXT, sort_order INTEGER, created_at TEXT)
```

- 标题 = 首条用户消息首行 ≤24 字；可重命名。
- `doc_refs` = JSON `[{kind:"note"|"quick-note", id, title}]`（选择时解析成具体文档，快捷组也落成具体清单）。
- `attach_refs` = 该条**用户消息**随发的图片引用 JSON `[{noteId, filename, name?}]`（261116 Phase 1）；**存引用不存字节**，NULL = 该条没有附件；只有 user 消息允许。
- 流式消息：先 insert（空 content）→ 结束后 update（content/reasoning/duration/stopped）。
- 停止 = 保留已生成片段，`stopped=1`。

## 请求组装（`core/aiWriting`，纯函数）

- 系统提示：写作助手 + **输出 Markdown**（渲染层按 Markdown 渲染）。
- 多文档：`【资料 1】标题\n正文`，单篇 ≤ 12000 字、合计 ≤ 40000 字、最多 20 篇（超出截断并提示）。
- 历史轮次受字符预算约束（最近若干轮）。
- **图片附件（261116 Phase 1）**：只挂**本轮** user 消息 —— 请求 = `[{type:"text"},{type:"image",asset},…]`；
  历史轮仍只送文本（不重发旧图、不重复计费，主进程 10 图上限只约束一轮）。上限 = `AI_WRITING_MAX_ATTACHMENTS`
  （与主进程 `AI_MAX_IMAGES` 同一预算 = 10 张），字节护栏（10MB/张、20MB/次、4096 边长/8MB 输出）
  全在主进程 `electron/ai/aiContentResolver.ts`；渲染层只传 `AiAssetRef`，**不转 base64、不读字节**。

## 图片附件（261116 Phase 1）

- 入口：输入卡右下纸夹（`.aiw-attach`，Phase 1 起**可点击**）→ 选图器 `AiImagePicker`。
- 选图源 = **已选资料文档（docRefs）里的图片**（对齐移动端 AI 助手 AiImageSheet）；按文档分组网格，
  多选 ≤ 剩余槽位，已添加的标灰；小记图片下一批（资源根路径语义待定）。
- 资产枚举 IPC：`list_note_image_assets(noteId)`（主进程读 `note-assets/{noteId}`，只回 filename/size/mimeType，
  **不算 sha**；与 Android `listImageAssets` 同口径）——通道数因此 188 → 189。
- 展示：chips / 历史气泡缩略图都走本地资源服务器直链（`?w=128` + access token），文件被清理则显示破图；
  发送时主进程对缺失/超大/非图片**明确报错**（不静默去图）。
- **视觉能力不可探测**：供应商配置没有 vision 字段、模型名自由填写 ⇒ 照发；失败且错误里含 400/参数类时，
  在 `aiErrors` 归类文案后追加一句可执行提示（换支持视觉的模型 / 移除图片重试），
  **不维护视觉模型清单、不自动重试、不静默去图**（判据 `aiWritingAttachmentErrorHint`）。
- 持久化：附件引用随 user 消息存 `attach_refs`；**不复制字节进会话目录、不进 S3**（AI 会话仍是设备本地数据）。
- 失败语义：主进程把供应商错误编码成 `{ok:false, error}` ⇒ 本轮按**消息级错误**落库（保留 400 原文 + 可执行提示），
  不再退化成「生成已中断」的空气泡（`aiWritingTurn` 对 `ok:false` 的判断由单测钉住）。

## 模式判据与附件来源（261116 第四稿最终口径）

**单一判据 = 纯函数 + 表**（`src/core/aiWriting.ts` 的 `AI_WRITING_MODE_CAPABILITIES` / `aiWritingModeCapabilities()`；
UI、请求组装、IPC 校验都读它，测试 `src/core/aiWriting.test.ts` 对表断言）：

| 模式 | 选文档（docRefs） | 文档附件来源 | 本机文件附件 | 附件是否限定已选文档 |
| --- | --- | --- | --- | --- |
| 对话写作 chat | ✗ | ✓（**按文档浏览**：选一篇文档 → 列它的附件；只寻址，不产生 docRefs） | ✓ | ✗ |
| 多文档推理 docs | ✓（核心上下文） | ✓（**仅当前已选文档集合**） | ✗ | ✓ |

- **对话写作 = 纯对话（codex 式）**：不显示/不接受 docRefs、无「已选 N 篇」/「请选择文档」、标题不出现文档名；
  附件只把**选中的附件本身**作为当轮 user 的 image/text 块，**不注入任何文档正文**。
  文档资产入口 = **与「选文档」同款形式的浏览面板**（复用 AiDocPicker 的笔记本 → 文档两级形式）：
  选中一篇文档**仅用于寻址**，进入它的附件列表 → 勾选；chips 标注所属文档名。
- **多文档推理 = 知识库问答**：必须选文档；附件入口只允许所选文档里的附件（无本机文件入口，IPC 也会拒绝混入）；
  换选/移除文档时，引用被移除文档的附件**一并清掉**（不留悬空附件）；标题/空态体现「在 N 篇文档里问答」。
- **模式切换（两向）= 结束当前会话视图（新会话）+ 清空 docRefs/attachRefs/输入（与提示词 chip）+ 取消在途请求**；
  判据测试 `src/features/aiWriting/useAiWriting.test.tsx`（docs 带 23 篇 → 切 chat 后全部为 0、旧会话不被写改）。

### 附件枚举：按文档取，**不做全库扫描**（有意简化）

- 文档资产附件统一复用既有 IPC `list_note_image_assets(noteId)`（通道 **189** 时已存在）：只回
  `{filename, size, mimeType}`，不算 sha。
- **不新增「全库附件枚举/分页搜索」IPC**：对话写作先浏览文档（寻址层级）再取该文档附件即可；2 万文档 / 20 万附件
  量级下全库扫描没有收益，且会把「选附件」变成搜索基础设施。若未来真要做全库搜索，先重新过需求三问，不要顺手扩。
- 附件仍只收录「文档引用的资产」，不列资源页孤儿/缺失。
- 通道数最终 = **190**（189 + 本机文件选择 `pick_ai_local_files`）；四面 = registrar / preload / native 封装 / WEB_METHODS。

### 本机文件附件（对话写作）

- 主进程 `dialog.showOpenDialog`（图片 + 文本/代码扩展名白名单；多选取消返回空；>10 文件报错）；
  选完登记到主进程内存注册表，渲染层只拿 `{kind:"local", token, name, size, mimeType}`（**绝对路径与字节都不出主进程**）。
- 发送时 resolver 按 token 读文件：图片 → ``image_url`` data URL（沿用 10MB/张、20MB/次、4096/8MB 输出护栏）；
  文本/代码 → 带文件名的 text 块（单文件 ≤200KB、单次合计 ≤6 万字符，超出截断并提示）；
  **PDF/二进制/未知扩展名 → 明确拒绝**（「暂不支持该文件类型：…（支持图片与文本/代码文件；PDF 等二进制见 Phase 2）」）。
- token 失效（应用重启/文件被移动）→「本机文件附件已失效：…请重新选择」；历史只按文件名 chip 展示。
- 附件上限沿用：单次 ≤10 个（图片与本地文件合计；错误文案在选图器/主进程各自可执行）。

## 交互细节

- 多文档「请选择文档」下拉：**只在文档推理（docs）模式**出现（261116 用户确认：纯对话不需要选文档）；快捷组（今天/近一周/近一月的文档 / 小记）+「按笔记本选择」（笔记本 → 其下文档复选）。选中即落成具体 `doc_refs`，chip 显示「N 篇文档」。
- 药丸（深度思考 / 提示词 / 请选择文档）统一用 kit 原语 `.ln-pill`（261116 收口，本页不再自养三态）。
- 输入卡**有意比 AI 助手大**（AI 写作 = 纯对话：textarea 最小 96px、卡片大内距；AI 助手 = 资料修改的轻对话：紧凑卡 max 120）——两端不合并。
- 「生成文档」：弹窗只选笔记本 → 确认 → `convertMarkdownToLake` → `createNoteIn(notebookId, title)` + `saveNote` → toast「已生成，打开」。
- 「保存到小记」：弹层编辑正文 → `createQuickNote` → toast「小记成功」。
- 「重新生成」：删掉最后一条助手消息重新请求；「复制」= 复制答案 markdown，toast「复制完成」。
- 所有失败都落到消息级错误行（不弹窗），可重试。

## 护栏

- `core/aiWriting.test.ts`（标题/预算/消息组装/**附件只在本轮 + 归一 + 失败提示**）、`electron/aiWritingRepository.test.ts`（CRUD/排序/删除级联/attach_refs 往返）、
  `ipcChannelParity`（通道三方一致）、`aiClient`（reasoning 解析）、`AiImagePicker.render.test.tsx`（选图/上限/已添加/小记提示）。
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
| 视图 | `AiWritingSidebar / AiComposer / AiPromptLibrary / AiDocPicker / AiImagePicker / AiMessageView / SaveQuickNoteDialog / AiWritingWorkspace` | 语雀同款交互；样式 `aiWriting.css`（`layer(feature)`，只用令牌） |
| 图片附件 | `AiImagePicker.tsx` + `aiWritingAttachments.ts` | 选图器（docRefs 文档里的图片）+ 引用→资源 URL 换算（`?w=128` + token；不读字节、不转 base64） |
| 共享弹窗 | `src/components/app/PublishDocDialog.tsx` + `styles/app/dialogs.css` 的 `.publish-doc*` | 「保存为文档」目标选择（浮窗：只选笔记本 + 标题可改）；与日记「转为文档」共用（261112 task-91，候选由调用方按 core 判据过滤：AI 用 `selectableNotebooks`；日记用 `moveTargetCandidates` 后只留 notebook（不出现分组/日记本），标题默认日期键可改） |
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
- 通道：`ipcChannelParity`（注册↔preload↔WEB_METHODS；现 189；261116 附件选择器 +1 = `list_note_image_assets`）。
- 样式：`ui-metrics`（0 颜色字面量 / 0 字号字面量 / !important 不变）+ `cssLayers.test.ts`（新文件已登记基线 430）。
- 设备/视觉：本页是桌面空间，按 AGENTS §3#21 只在改动外壳几何时跑 `check:stylesnap` 的相关态。

## 附件 Phase 2：PDF / 文档内容注入（261116 第七稿，桌面）

**范围**：对话写作的**本机文件**附件支持 PDF（文档内容注入）；文本/代码类沿用 Phase 1.5。不做小记图片入口；
多文档推理的附件源仍是「所选文档里的图片」；docx/其它二进制不解析（**不引新依赖**，明确拒绝）。

- **解析链（主进程，唯一）**：`electron/ai/pdfText.ts`（unpdf）——源文件 ≤32MiB、结果 ≤6 万字符、单文档 10s；
  抽不到文字（扫描件）明确报错；**PDF 在「选择文件」时解析一次**并把结果缓存在 token 注册表（ref 只带
  `pages` 回渲染层做 chips 提示），发送时复用缓存，**不当 image_url、字节不进渲染层**。
- **预算**：单次附件 ≤10 个；PDF 单文件沿用 32MiB/6 万字符/10s；**本地附件合计注入文本 ≤6 万字符**
  （文本/代码文件与 PDF 共享），超出部分截断并写「…（已截断）」；PDF 自身超 6 万字符标「原文过长已截断」；
  文本/代码文件单文件 ≤200KB。**截断一律标注，不静默丢**。
- **失败语义（选择阶段即报错，不自动重试、不静默跳过）**：
  - 加密：`PDF 解析失败：x.pdf（文件已加密（需要密码））。请换用可复制文字的 PDF，或取消密码保护后重试。`
  - 扫描件：同上（没有可提取文字（可能是扫描件））
  - 损坏 / 非 PDF：同上（文件损坏或不是有效的 PDF）
  - 超时/过大：同上（解析超时 / 文件超过解析上限）
  - 发送时 token 失效（重启/文件移动）：「本机文件附件已失效：…请重新选择」
- **UI（不新增图标/节点）**：本机文件 chip 复用 `FileKindIcon`（PDF 显示文件页图标）＋ 现有 `__size` span 文本
  改为「大小 / N 页」（仅 `kind:"local"` 且 `pages` 存在时）；不新增节点、不动缩略图/预览按钮；
  `AiMessageView` 未改（历史 chips 保持现状）。
- **IPC**：复用 `pick_ai_local_files`（dialog 过滤扩展名加 `pdf`；选择时解析，失败抛可执行中文错误）；
  **通道数仍 190**，未新增通道。
- **持久化/历史**：附件只随当轮 user 发送、历史不重发；`pages` 走 `normalizeAiWritingAttachments` 白名单映射
  （不补字段会被静默丢弃，已有测试钉住）。
- **已知限制**：加密 PDF 即使知道密码也不支持（不做密码输入 UI）；扫描件不做 OCR；docx/Excel 等不解析；
  移动端 AI 写作仍不接（原生 AiChatPlugin 无 document 支持）。

## 数据边界：AI 写作本地专属（不进 S3、不进便携包）

> 用户裁决（261116）：「所有 AI 历史对话与这些附件都只在本地，绝不进 S3」。这不是约定，是护栏机检。

- **会话/消息**：只存本机主库 `metadata.sqlite3` 的 `ai_writing_conversations` / `ai_writing_messages` 两张表；
  **不进树/搜索/S3/同步/便携包**；没有任何后台外发，只有用户点「发送」时 messages 随 `ai_chat` 请求发给用户配置的供应商。
- **附件（文档资产图）**：只在 `attach_refs` 里存引用（noteId/filename），字节本来就在 `note-assets`（笔记数据）；
  **不复制进 AI 会话目录**；AI 请求时才由主进程读取。
- **粘贴图片**：落盘目录 **`<userData>/ai-attachments/paste-<uuid>.<ext>`**（userData 顶层，单一来源
  `localAttachments.pastedAttachmentDir`）。**绝不能放 `note-assets/`**（会被资产声明/GC/同步扫到），
  也不进 `dist/`、不进 workspace 数据根、不进 S3。
- **跨重启**：`paste-` token 可反推文件名 ⇒ 注册表 miss 时读取/预览回落读盘（历史缩略图、重新生成仍可用）；
  非 `paste-` token（dialog 选的普通本机文件）保持「重启失效」语义。
- **粘贴图生命周期**：粘贴时写入（tmp+rename 原子写）；token 存内存注册表；启动时主进程执行一次清理——
  删除「未被任何 `attach_refs` 引用且 mtime 超过 **7 天**」的粘贴文件；删除会话**不立即删文件**（等启动 GC）；
  不做同步，不做云备份。目录缺失/清理失败不影响启动。
- **护栏**：`electron/aiWritingLocalOnly.test.ts` ——
  ① `ai_writing` 只许出现在 schema/repository/IPC/preload/本地 webApi；
  ② `electron/s3v3`、`syncEngineController`、`portable`、`store.ts`、`indexRepository.ts` 出现
  `ai_writing` / `ai-attachments` / `ai-paste` 直接红；
  ③ 便携包收集白名单不含 AI 会话/附件目录（现状白名单 = 正文 + note-assets + quick-notes）。

## v1 明确不做（用户 261109 定稿）

- 移动端不接（移动端已有 AI 助手）；会话不跨端、不进 S3。
- 关闭「深度思考」的入口不提供（默认开）。
- 生成文档只选到知识库（笔记本），不选目录、不做同级/子级。
- 不做停止/重连后的服务端续写；停止即终态（可重新生成）。
