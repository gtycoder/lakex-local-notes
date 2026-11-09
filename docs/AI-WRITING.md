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

- 新空间 `ai-writing`（顶栏空间菜单第 4 项，⌘4 切换）：隐藏左侧目录栏，整页两栏。
- 左栏（280px）：「AI 写作」标题 / 「＋ 新对话」/「历史记录」按日期分组（今天/昨天/更早），行悬停出「…」（重命名=行内输入；删除=行内确认气泡）。
- 主区：
  - 空态：分段控件（对话写作 / 多文档推理）→ 大标题 → 「✦ 提示词」→ 输入卡 → 「点一点试试」两个 chip。
  - 会话态：消息流 + 底部输入卡（固定底）。
- 输入卡：可选提示词 chip、可选文档 chip（多文档模式）、textarea（占位「从这里开始对话」）、发送/停止。
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
| 视图 | `AiWritingSidebar / AiComposer / AiPromptLibrary / AiDocPicker / AiMessageView / PublishDocDialog / SaveQuickNoteDialog / AiWritingWorkspace` | 语雀同款交互；样式 `aiWriting.css`（`layer(feature)`，只用令牌） |
| 壳层 | `desktopTypes` / `DesktopTopBar` / `useDesktopLifecycle` / `App` | 新空间 `ai-writing`（⌘4，空间菜单第 4 项；隐藏目录栏） |

### 为什么这样分

- **停止语义只有一处**：OpenAI SDK 在 abort 后可能「正常结束」流（实测），若把 stopped 判定散在 hook 里会在成功分支丢掉停止标记；`aiWritingTurn` 内聚后可用纯单测覆盖三种结局。
- **资料读取可注入**：多文档要读正文，但读法随宿主不同（桌面 IPC / 将来其它宿主）；用 reader 接口隔离，纯逻辑可测。
- **IPC 类型单一来源**：渲染层与主进程各写一遍载荷是最容易漂移的地方；类型放 core，主进程只做「unknown → 校验 → 类型」。
- **转换失败要有出口**：内核初始化偶发挂起（窗口被遮挡时 rAF 不触发，已修）；转换层超时重建一次，仍失败则在弹窗内报错、不关弹窗。

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
