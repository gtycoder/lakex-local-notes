# AI 写作空间 · 附件（从本机资产选图/文件）方案（261116 · 调研 + 分期）

> 背景：用户问「AI 助手支持附件好做吗？同理可以选择我们这里的资产」，随后澄清——**AI 助手不需要附件**（入口已删，工作树注释见 src/features/ai/AiAssistantDialog.tsx:564/602「AI 助手不做附件（附件是 AI 写作空间的需求）」）；**需要附件的是 AI 写作空间**（src/features/aiWriting/**）。
> 本文只做**只读调研 + 设计**：不 commit、不改 src/**、不跑 --write-baseline；唯一写入 = 本文件。
> 快照提醒：调研时工作树有**并行未提交改动**（AI 深度思考开关、流式探针、AI 助手入口删除等），AI 写作侧 useAiWriting/AiComposer/AiWritingWorkspace 正在被改；下文行号按本快照，Phase 1 落地前先 rebase 该批。

## 0. 结论先行

**好做，但难点不在 UI——多模态链路已经存在，缺的是 AI 写作侧的「消息协议 + 持久化 + 资产枚举」三块。** Phase 1（图片，视觉模型）约 **3–3.5 人日**；Phase 2（PDF/文档注入）桌面约 **+1–1.5 人日**。

已经具备（可直接复用，不要再造一套）：
- 跨 IPC 传引用的数据模型 **AiAssetRef** + 多模态内容块 **AiContentPart**（core/aiProviders.ts:333-358）；主进程唯一解析入口 **resolveAiMessages**（electron/ai/aiContentResolver.ts:27-63）：图片 → image_url data URL（10MB/张、20MB/次护栏，4096 边长/8MB 输出），PDF → 抽文本（32MiB/6 万字符/10s）。
- 供应商侧 image_url/base64 的组装已经在 electron/ai/aiClient.ts:47-70 完成；渲染层/主进程之间**只传引用**（字节只在主进程读，core/aiProviders.ts:333-341）。
- 移动端 AI 助手已是成品参照：从「资料文档」选图（AiImageSheet + bridge.aiListNoteImages），只随当轮发送、历史用会话私有图片存档显示（docs/MOBILE-AI.md:154-178 / :289-297）。
- **入口占位已经存在（工作树，未提交）**：AI 写作输入卡已有 `.aiw-attach` 占位按钮（AiComposer.tsx:160-162，disabled + title「下一批接入」），两态样式已进基线（aiWriting.css:127-129；cssLayers.test.ts:191 当前 382），且有测试钉住「占位不伪造可用」（AiComposer.prompt.render.test.tsx:127-133）⇒ Phase 1 是**接管线**，不是从零做入口。

AI 写作侧的 4 个硬缺口（决定工作量）：
1. **消息协议**：buildAiWritingMessages 只产出纯字符串 content（core/aiWriting.ts:238-263），AiWritingMessage.content 是 string（core/aiWriting.ts:36-52）⇒ user 消息**无法携带 image part**。
2. **持久化**：ai_writing_messages 只有 content TEXT（electron/schemaInit.ts:151-162）⇒ 重开会话看不到「这条提问带了什么图」；需要新增列（可 ALTER，模式见 schemaInit.ts:186-200）。
3. **资产枚举**：桌面**没有**「按 note 列出图片」的 IPC（preload 里只有 list_orphan_assets / read_asset_preview 等，electron/preload.cjs:140-152）；移动端有 AssetSyncPlugin.listImageAssets（android/app/src/main/java/com/lakexlocalnotes/android/AssetSyncPlugin.kt:516-540）。二选一：+1 IPC（推荐）或读正文解析（只对 Lake 文档）。
4. **发送/预算语义**：主进程 ai_chat 每次请求限 10 图 / 5 文档 / 20 万字符（src/core/aiChatMessages.ts:9-13、75-81）；AI 写作历史预算只算文本（core/aiWriting.ts:159-164、221-229）⇒ 必须约定「附件只随当轮发、历史不重发」，否则 10 图上限会随轮数累加并被历史字符预算挤爆。

**最大风险 = 视觉模型能力无法探测**：AI_PROVIDERS/AiProviderConfig 只有 supportsReasoning/supportsThinking，没有任何视觉能力字段（core/aiProviders.ts:54-138）；模型名是用户自由填写。现状只能「发出去 → 供应商 400 → 按 bad_request 原文报错」（core/aiErrors.ts:140-146）。**不做**硬编码「视觉模型清单」、**不做**静默去图/自动重试。

## 1. AI 写作请求组装链路（现状，file:line）

```text
AiWritingWorkspace.tsx:220/266  <AiComposer …/>（空态卡 / 会话底部 dock 两处，props 同源）
  ↓
useAiWriting.ts（控制器）
  send()（约第 300 行起）→ native.aiWritingCreate / aiWritingAppendMessage(user) → runAssistant()
  runAssistant()（约 224-300 行）
    ├ resolveAiWritingDocs(docRefs, reader)         aiWritingContext.ts:42-57（docs 模式才读正文）
    ├ buildAiWritingMessages({mode,input,promptText,docs,history})   core/aiWriting.ts:238-263
    │    → AiChatMessage[]（**当前全是 string content**）
    └ startAiWritingTurn({messages, run: runAiChat, cancel: cancelAiChat})   aiWritingTurn.ts
         → src/lib/ai.ts runAiChat（:45-75）→ native.aiChat → IPC ai_chat
              electron/ipc/registerAi.ts:77-115
                assertMessages(core/aiChatMessages.ts:57-88) → resolveAiMessages(electron/ai/aiContentResolver.ts:32-63)
                → aiChat（electron/ai/aiClient.ts:100-121）
```

- **消息里能不能带 image part？** 协议层可以（AiChatMessage.content: string | AiContentPart[]，core/aiProviders.ts:361-364；image/document 只允许 user，core/aiChatMessages.ts:20-43），主进程 resolver 对 image/document 都已实现；**AI 写作组装层现在不产出**。
- 因此 Phase 1 不需要新网络通道/新 Key 通道，也不改主进程多模态解析链；只改 AI 写作的组装 + 持久化 + UI。

## 2. AI 写作已有 docRefs（选文档）与「图片附件」如何共存

- 形状：AiWritingDocRef {kind: "note" | "quick-note", id, title}（core/aiWriting.ts:18-25）；选择器 AiDocPicker（features/aiWriting/AiDocPicker.tsx:37-），快捷组也落成具体清单（aiWritingDocs.ts:73-89）。
- 持久化：会话列 doc_refs TEXT(JSON)（schemaInit.ts:142-150；仓库读写 aiWritingRepository.ts:143-198）；重开会话恢复 chips（useAiWriting.selectConversation → setDocRefsState）。**没有字节快照**，发送时才读正文（aiWritingContext.ts:42-57 + docs/AI-WRITING.md:40-44）。
- 预算（文本轴）：20 篇 / 单篇 1.2 万 / 合计 4 万字 / 历史 12 轮 + 2.4 万字（core/aiWriting.ts:159-164、201-229）。
- **共存建议**：
  - 两者是**不同轴**：docRefs = 文本资料（喂正文，docs 模式）；attachRefs = 多模态块（图片/PDF，随当轮 user 消息）。可并存：docs 模式 = 资料正文 + 图片；chat 模式 = 纯图问答。
  - UI 不合并语义：docRefs 继续「N 篇文档」chip；图片附件单独一行缩略图 chips（每张可删、显示张数/总量），否则用户无法预期「删掉的是文本资料还是图」。
  - 预算分别算：文本预算沿用 AI_WRITING_*；图片/文档走 aiChatMessages 的 10/5 与主进程 10MB/20MB 护栏，UI 在**选择时**就显示「本次 3 张 / 2.4MB」并在超限时禁用（不要发出去再报错）。
  - 输入为空 + 只有图：AI 写作现有 canSend 要求 input.trim()（AiComposer.tsx:62）⇒ Phase 1 约定「带图也必须写指令」；若用户要「只发图」，Phase 1.5 可复用 AI 助手的图片预设（AI_IMAGE_PRESETS，src/features/ai/aiPrompts.ts:48-52：描述/提取文字/翻译）。

## 3. 选图源 & 可复用 IPC / 组件（桌面）

| 源 | 现状 | 方案 | 建议 |
| --- | --- | --- | --- |
| **S1 已选资料文档里的图片** | AI 写作空间**没有「当前文档」**概念（无编辑器；进入空间后 shell 隐藏 sidebar：styles/app/shell.css:270-272）；最贴近的语义 = docRefs 选中的文档 | 需要「按 noteId 列图片」：新 IPC（方案 A）或 readNote+正文解析（方案 B） | **Phase 1 主源**（对齐移动端 AiImageSheet「只列资料集里的图」） |
| S2 当前活动编辑器文档 | 切到 AI 写作后编辑器 tab 仍 keep-alive，但 data-active 不可靠 | 取 activeEditorMount/editorRegistry 的 noteId | 不做 Phase 1（语义不清）；若用户要「刚才那篇」，Phase 2 再定 |
| S3 资源页未引用资产 | 已有 IPC：list_orphan_assets / list_removed_assets（preload.cjs:140-144；native.ts:294-300；类型 OrphanAsset src/lib/types.ts:615-626） | 可筛 image/*，缩略图 readAssetPreview/readOrphanPreview | **不建议 Phase 1**：语义是「待清理的孤儿」，随时可能被清理；且自带危险操作语境 |
| S4 小记图片 | docRefs 支持 kind:"quick-note"（AiDocPicker 快捷组）；小记正文是 Lake | 与 S1 同路（按 quick-note id 列图） | Phase 1 可顺带支持；**先实测**小记资产的本地寻址（见下） |
| S5 全库所有资产 | 无「列举全部 note-assets」IPC | 新全库扫描 | **不做**（性能/语义/权限） |

**资产枚举两案（桌面）**
- **方案 A（推荐）：新增 IPC list_note_image_assets(noteId)**
  主进程读 note-assets/{noteId}/ 目录，只回 filename/size/mimeType（不算 sha）；与 Android AssetSyncPlugin.listImageAssets 同口径（AssetSyncPlugin.kt:516-540），覆盖 doc/usheet/bitable/board/ink 全部文档类型。成本：+1 通道 ⇒ ipcChannelParity **188→189**（electron/ipc/ipcChannelParity.test.ts:167-170 三处：registrar / preload / WEB_METHODS）+ preload.cjs + src/lib/native.ts + electron/webApiServer.ts + 1 个主进程单测，约 **0.5 人日**。
- 方案 B（0 IPC）：渲染层 native.readNote(noteId)（NoteDocument.content，src/lib/types.ts:51-61）+ 复用 extractImagesFromContent（features/editor/imagePreview.ts:95-125）+ parseAssetRef（features/editor/selectionToolbar/selectionToolbarModel.ts:139-143）。优点零通道；缺点：**只对 Lake 正文有效**（表格/多维表/画板/手写板里的资产解析不到），每次开选择器要读整篇正文（大文档代价），且 features/aiWriting → features/editor 跨域 import 不干净（建议先把纯解析下沉 core，core/assetRefs.ts，再复用）。
- 结论：Phase 1 用 A；B 只作为「实在不想动通道」的退路。
- **小记资产寻址待实测**：主进程 readAssetBytes 走 noteAssetsDirFor(noteId) = note-assets/{noteId}/{filename}（electron/orphanLifecycle.ts:217-231）；移动端 listImageAssets 也按 note-assets/{noteId} 目录（AssetSyncPlugin.kt:523-528），但现有移动 AI 选图只传 docRefs 的 note（非 quick-note）。桌面若支持 quick-note 图片，落地前用一篇带图小记验证一次目录是否存在（若不在，Phase 1 先只做 note）。

**可复用 / 不可复用**
- 可复用：资源服务器 URL 助手 localAssetHttpUrl + withAssetWidth（core/assetUrl.ts:68-76、88-137：128/256/512/1024 档位）+ withAssetAccessToken（src/lib/assetPort.ts:44-52）→ chip 缩略图不占 IPC、不用 base64；read_asset_preview（preload.cjs:145 / native.ts:299）可作为兜底；FileKindIcon（features/bitable/FileKindIcon.tsx）+ fileKindOf/isImageExtension（core/assetNaming.ts）做类型图标。
- **不要**直接复用 AttachmentChipList：它定义在 features/bitable/bitableCells.tsx:278-330，绑定 BitableAttachment、bt-* 样式与 useNameTip，属多维表域；跨域 import 会破坏样式所有权/组件域门禁。也**不要**复用 AssetsBrowser（设置页资源浏览器、危险操作语境）。
- 选择器 UI：沿用 AiDocPicker 的「左清单 / 右展开」思路做**按文档分组的图片网格**（或复用 AiImageSheet 的网格布局，桌面用 Popover/NativeDialog）；chip 行新建在 features/aiWriting（aiw-attach-chip），样式进 aiWriting.css（token-only）。

## 4. 持久化与历史（关键决策）

- 现状：ai_writing_messages(id, role, content, reasoning, duration_ms, stopped, error, sort_order, created_at)（schemaInit.ts:151-162）；会话级只有 doc_refs；消息里没有附件语义。
- 建议：
  1. **消息级存引用，不存字节**：user 消息新增 attach_refs TEXT（JSON AiAssetRef[]），随 append_message 写入；走 schemaInit 既有「PRAGMA table_info + ALTER TABLE ADD COLUMN」轻量迁移（schemaInit.ts:186-200；无需重置库）。不复制资产文件到会话目录——桌面文件本来就在 note-assets 持久，复制只会产生双份/孤儿（移动端 AI 助手复制字节是因为相册临时文件会失效，语义不同）。
  2. **只随当轮发送**：buildAiWritingMessages 只在本轮 user content 里拼 image/document parts；历史轮次仍只送文本（图片不再发、不重复计费）。与移动端口径一致（docs/MOBILE-AI.md:289-297），也让 10 图上限只约束一轮。
  3. **重开会话**：按 attach_refs 用资源 URL 懒加载缩略图；文件已删 → 占位「附件已删除」；发送时主进程明确抛「附件文件不存在：x」（aiContentResolver.ts:48），UI 转消息级错误。
  4. **重新生成**：现有语义 = 删最后 assistant、用最后 user 重跑（useAiWriting.regenerate）；attach_refs 跟着最后 user 走，重新解析同一引用（文件还在就成功）。要写进测试。
  5. **不建附件快照/回收站**：AI 会话是设备本地数据（docs/AI-WRITING.md:130-136）；做快照 = 第二份数据 + 清理责任，收益低（AGENTS §3#7/#17）。
  6. 版本/分支：AI 写作 v1 没有分支树（对比 AI 助手的 aiConversationTree）；附件不影响历史列表分组（按 updated_at）。

## 5. Phase 1（图片，视觉模型）

### 5.1 改动文件清单（预估）

| # | 文件 | 改动 | 预估 |
| --- | --- | --- | --- |
| 1 | src/core/aiWriting.ts | AiWritingMessage 增 attachRefs?: AiAssetRef[]；AiWritingMessageAppendInput 增 attachRefs；buildAiWritingMessages 增 attachments 入参，仅本轮 user 拼 image parts；补 aiWriting.test.ts | 0.5 人日 |
| 2 | electron/schemaInit.ts | ai_writing_messages + attach_refs TEXT（ALTER 补列） | 0.1 |
| 3 | electron/aiWritingRepository.ts | 读写 attach_refs（append/update/select SQL 与映射）；补 aiWritingRepository.test.ts | 0.4 |
| 4 | electron/ipc/registerAiWriting.ts + native 类型 | append_message 接收/校验 attachRefs（复用 core 校验：形状 + ≤10 图）；**不新增通道** | 0.3 |
| 5 | **新 IPC 方案 A**：electron/ipc/registerNotes.ts（或新 registerAiAssets.ts）+ preload.cjs + src/lib/native.ts + electron/webApiServer.ts + ipcChannelParity.test.ts(188→189) + 主进程单测 | list_note_image_assets(noteId) → [{filename,size,mimeType}] | 0.5 |
| 6 | src/features/aiWriting/AiImagePicker.tsx（新） | 选图器：源 = docRefs 文档，按文档分组网格；多选 ≤10；缩略图 withAssetWidth(128)；空态/超限提示；缩略图用资源 URL | 1.0 |
| 7 | src/features/aiWriting/AiComposer.tsx | **启用已有的 `.aiw-attach` 占位**（AiComposer.tsx:160-162）→ 打开选图器；新增图片 chips 行（缩略图 + 单删 + 「N 张/总量」）；props 增 attachRefs/onAddAttachments/onRemoveAttachment；同步改「占位 disabled」断言测试 | 0.3 |
| 8 | src/features/aiWriting/useAiWriting.ts | attachRefs state；send/runAssistant 传 buildAiWritingMessages + appendMessage；发送成功后清空待发；新会话/切会话清空；重新生成沿用最后 user 的 refs | 0.4 |
| 9 | src/features/aiWriting/AiMessageView.tsx | user 气泡下渲染附件缩略图（只读；缺失占位） | 0.2 |
| 10 | src/features/aiWriting/aiWriting.css | chips/缩略图样式（token-only；`.aiw-attach` 占位两态已在基线）+ cssLayers.test.ts 基线登记（当前 382 条，新增按实测登记理由） | 0.3 |
| 11 | 测试/文档 | AiComposer.render / AiMessageView.render / workspace render；docs/AI-WRITING.md 新增「附件」章节（单一来源，别只写代码注释） | 0.5 |
|  | **合计** |  | **≈3–3.5 人日**（不含裁决与真机联调） |

> 若选方案 B（读正文解析、不加 IPC）：省 0.5 人日，但只支持 Lake 文档且需把解析下沉 core；不建议作长期方案。

### 5.2 风险

- **视觉模型不可探测**（最大风险）：无能力字段、模型名自由文本 ⇒ Phase 1 = 「尝试发送 + 400 时给可执行错误」：在 aiErrors bad_request 原文（core/aiErrors.ts:140-146）之上补一句「当前模型可能不支持图片：换视觉模型（如 OpenAI gpt-4o 系列；其余以各家文档为准）或移除图片」。**不维护硬编码模型清单**（会过期）。可选 Phase 1.5：per-provider「本模型支持图片」开关（成本：core/aiProviders + settings 视图/仓库 + 桌面 AiSection + 移动 AiSettingsSection + 测试，约 1 人日），默认关、只做提示不做拦截。
- 资产生命周期：选图后文档被删/资产被清理 ⇒ 发送时明确报错（已有）；历史缩略图 404 ⇒ 占位。**不做静默替换/快照。**
- 隐私：图片会原样发给用户配置的第三方供应商（S3 只是笔记同步镜像，AI 请求是另一条外部出口）⇒ 选图器与 chips 明示「将发送给 AI 供应商」；不自动附图。
- 计费/预算：视觉输入 token 另计；UI 显示张数+体积，主进程护栏兜底（10MB/张、20MB/次）。
- 前端包体：AI 写作空间本身是 lazy chunk（src/App.tsx:66 lazy(() => import("./features/aiWriting/AiWritingWorkspace"))）⇒ 新增选择器组件不进首屏图，check:bundle 预计无影响（仍需跑）。
- 并行改动：AI 写作侧正在被并行修改（深度思考开关、输入卡重排、**附件占位**等）；Phase 1 开工先 rebase，**不要重复加按钮**（占位已在），只接管线。

### 5.3 验收

- 单测：buildAiWritingMessages（图只在本轮；history 无图；attachment 顺序 text→image）；repository attach_refs 往返；ipcChannelParity；AiComposer render（按钮/上限/删除/空指令禁用；**AiComposer.prompt.render.test.tsx:127 的「附件=占位 disabled」断言要改成「可用/打开选图器」**）；AiMessageView 附件缩略图/缺失占位。
- 门禁：npx tsc --noEmit、npx vitest run（core/aiWriting + electron/aiWritingRepository + features/aiWriting + ipcChannelParity + cssLayers + aiWriting 相关 render）、node scripts/ui-metrics.mjs、src/styles/cssLayers.test.ts 基线登记（新增声明逐条写理由）、npm run check:bundle。
- 手动（隔离 LAKE_USER_DATA）：配置视觉模型（如 OpenAI gpt-4o）→ 选资料文档 → 选 2 张图 → 发送 → 回答描述图片；追问一轮 → 请求里**不再**出现 image_url（用 scripts/ai-stream-probe-harness.mjs 或主进程日志观察）；换非视觉模型 → 明确错误、移除图后可重发；重开会话 → 历史缩略图在；删掉资产文件 → 发送明确报错、历史占位。
- 视觉快照：stylesnap 现无 AI 写作态（scripts/css-audit/stylesnap.mjs 无 ai-writing）⇒ 不需要重烤；不跑 --write-baseline。

## 6. Phase 2（PDF / 文档注入）

### 6.1 两种语义先分清

| 语义 | 机制 | 现状 |
| --- | --- | --- |
| **视觉文件**（PDF 作为 document 块） | 主进程读 PDF → 抽文本 → 作为 text 块（供应商不支持 PDF 原文件） | **已实现**：aiContentResolver.ts:55-58 + pdfText.ts（32MiB / 6 万字符 / 10s / 扫描件明确报错 pdfText.ts:42-60） |
| **正文注入**（笔记正文作为资料） | docs 模式把选中文档正文拼成资料块 | **已实现**：aiWritingContext.ts:42-57 + core/aiWriting.ts:201-235 |

### 6.2 桌面 Phase 2 改动面

- PDF 附件：选图器加 PDF 过滤（fileKindOf）、attach_refs 增 type（image | document）、buildAiWritingMessages 拼 document part、chips 用 FileKindIcon 显示 PDF 图标、AiMessageView 显示文件名 chip。**主进程零改动**（解析链已存在）。约 **+1–1.5 人日**（含测试/验收）。
- 文档注入：与 docRefs 语义重复 ⇒ **建议直接复用 docRefs**（已有），不新增「文档附件」概念；仅在用户明确要「把这篇笔记当附件发」时再讨论（可做 docRefs→attachRefs 的引用转换，但预算要统一，避免同一篇文本被发两次）。
- 风险：扫描件/空 PDF 明确报错；长 PDF 截断提示；PDF 内容隐私同上（发送给供应商）。

### 6.3 移动端

- AI 写作 v1 **明确不做移动端**（docs/AI-WRITING.md:6-9）；移动 native AiChatPlugin 只处理 image/text、**无 document**（android/.../AiChatPlugin.kt:344-352），PDF 也无本地解析（没有 unpdf）⇒ Phase 2 不覆盖移动端；若未来要做需原生抽文本/另立项。
- 移动 AI 助手已有图片附件成品（作为以后若把该能力搬到移动时的参照），不在本期。

## 7. 明确不建议项

1. **把整个资源页（孤儿/历史/缺失）塞进选择器**：这些是「待清理/已移除」资产，随时可能被清理，选中即埋悬空引用；且列表大、含非图片。→ 选图器只列「资料文档里现存的图片」。
2. **无视觉模型时静默降级/自动重试/自动去图**：违反本仓「附件解析失败绝不静默降级」（electron/ai/aiContentResolver.ts:27-31）与用户可预期；也会让用户以为图已发送。→ 明确报错 + 手动移除。
3. **渲染层转 base64 过 IPC**：违反「跨 IPC 只传引用，字节只在主进程」（core/aiProviders.ts:333-341），大字节会把渲染层/桥拖垮。
4. **把附件字节复制进会话目录/版本树**：桌面资产本就在 note-assets 持久；复制产生第二份数据与清理责任（移动端复制的理由不适用于桌面）。
5. **复用 AttachmentChipList / AssetsBrowser**：前者属多维表域（BitableAttachment/bt-*），后者属设置页资源浏览器（危险操作语境）；跨域 import 破坏样式所有权与门禁。只复用 FileKindIcon/fileKindOf。
6. **在 AI 助手（文档浮窗）做附件**：用户已裁决不做（工作树 AiAssistantDialog.tsx:564/602 注释）；方向是 AI 写作空间。
7. **新建「全局资产库」/后台资产索引**：收益是「任何文件都能选」，代价是索引/权限/性能与语义风险；从「已选资料文档的图片」起步（AGENTS §3#17）。
8. **把 AI 写作附件接入 S3/同步/便携包**：AI 会话是设备本地数据（docs/AI-WRITING.md:130-136），不跨端、不进 S3。

## 8. 需要用户裁决的开放问题

1. Phase 1 图片源：只做「已选资料文档里的图片」（推荐），还是也要「资源页未引用资产 / 小记图片」？（后者需额外语义与清理防护）
2. 视觉模型：接受「发出去失败再提示」（推荐 Phase 1），还是先加 per-provider「支持图片」开关（Phase 1.5，约 +1 人日）？
3. 带图是否必须写指令（推荐必须），还是允许「只发图」并给图片预设（描述/提取文字/翻译）？
4. 上限是否沿用 10 图 / 5 文档 / 20MB，还是写作空间另设更小上限（如 6 图）？
5. Phase 2 是否本期只做 PDF，文档注入继续走 docRefs？

## 9. 证据索引（本文引用的 file:line）

| 主题 | 证据 |
| --- | --- |
| 多模态数据模型 / 只传引用 | core/aiProviders.ts:333-364；core/aiChatMessages.ts:20-43 |
| 主进程解析（图/PDF/护栏） | electron/ai/aiContentResolver.ts:8-63；electron/ai/pdfText.ts:42-60；electron/ai/aiImages.ts（4096/8MB） |
| 供应商请求（image_url/base64） | electron/ai/aiClient.ts:15-21、47-70、100-121 |
| 请求入参预算 | core/aiChatMessages.ts:9-13、57-88 |
| AI 写作请求组装 | core/aiWriting.ts:159-164、201-263；features/aiWriting/useAiWriting.ts（约 224-300）；features/aiWriting/aiWritingContext.ts:42-57；src/lib/ai.ts:45-75；electron/ipc/registerAi.ts:77-115 |
| AI 写作 UI 扩展点 | features/aiWriting/AiComposer.tsx:87/123/159/184；AiWritingWorkspace.tsx:220/266；AiMessageView.tsx:59-66 |
| docRefs 语义/持久化 | core/aiWriting.ts:18-25；schemaInit.ts:142-150；aiWritingRepository.ts:143-198；AiDocPicker.tsx:37-；aiWritingDocs.ts:73-89 |
| 消息/会话表结构 | electron/schemaInit.ts:142-163；迁移模式 186-200 |
| AI 写作本地会话边界 | docs/AI-WRITING.md:6-9、130-160 |
| 选图源/资产 IPC | electron/preload.cjs:140-152；src/lib/native.ts:294-300、299；src/lib/types.ts:615-626；android/.../AssetSyncPlugin.kt:516-540；src/mobile/bridge/ai.ts:78-92 |
| 可复用 URL 助手 | core/assetUrl.ts:68-76、88-137；src/lib/assetPort.ts:44-52 |
| 不要复用的组件 | features/bitable/bitableCells.tsx:278-330（AttachmentChipList）；features/bitable/FileKindIcon.tsx（可复用） |
| 快照/懒加载/门禁 | src/App.tsx:66（AI 写作 lazy）；electron/ipc/ipcChannelParity.test.ts:167-170（188）；scripts/css-audit/stylesnap.mjs（无 AI 写作态）；src/styles/cssLayers.test.ts:55/191（aiWriting.css 基线 382，含 .aiw-attach 占位两态） |
| 入口占位（已存在） | AiComposer.tsx:7、160-162；aiWriting.css:127-129；cssLayers.test.ts:191（382）；AiComposer.prompt.render.test.tsx:127-133；本批并行 commit 说明见 cssLayers.test.ts:191 注释（261116 task-20） |
| 用户裁决（AI 助手不做附件） | src/features/ai/AiAssistantDialog.tsx:564、602（工作树未提交） |
