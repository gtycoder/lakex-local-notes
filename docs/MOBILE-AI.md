# 移动端 AI（Android）设计与实施契约

> 状态：**P1 设计定稿（261022 用户拍板）**，未开工。实施前先读 §13 分期与 §15 未决项。
> 归属：移动端（src/mobile/** + android/**）；**不改桌面 AI 行为**（共享的只是 core 纯函数）。
> 相关：[MOBILE-TECH-STACK.md](./MOBILE-TECH-STACK.md)（架构/互斥域）· [MOBILE-DESIGN.md](./MOBILE-DESIGN.md)（视觉/浮层/44 Rule）· [LAKEX-CONTRACT.md](./LAKEX-CONTRACT.md)（内核命令）· [HANDOFF.md](./HANDOFF.md)（当前状态）。

---

## 1. 一句话

手机端 AI = **一次对话 + 一个临时资料集（N 篇我们的文档全文）+ 资料里的图片**；不持久化、不替换正文、不解析外部文件。

形态对标小米「超级小爱」的**结构**（独立会话页 / 空态问候 / 建议 chips / 胶囊输入栏 / 相机直达），**皮肤与字阶走我们自己的移动端令牌**，不抄巨字与橙色。

---

## 2. 决策记录（261022 用户逐条拍板，实施时不得重开）

| # | 议题 | 结论 | 备注 |
|---|---|---|---|
| D1 | 与云同步的关系 | **完全独立**：关云同步不影响 AI；AI 另有自己的开关 | 需新增 aiCanTouchNetwork()，并改写 AGENTS §3#20「唯一判据」措辞 |
| D2 | 会话持久化 | **不持久化**：退出即清空（资料、历史、图片） | 短平快 |
| D3 | 上下文上限 | **有上限**（见 §8） | 超限显式提示，绝不静默截断 |
| D4 | 结果回写 | **只插入、不替换** | P1 落点见 §10.4（因入口调整，改为「新建文档 / 存为小记」） |
| D5 | 通道方案 | **B：Kotlin 原生 SSE 通道**，Key 不进 WebView | 见 §11 |
| D6 | 容器 | **全屏页**，不是底部 Sheet | 见 §4~§5 |
| D7 | 附件入口 | **ActionSheet**（四件浮层原语不变） | 见 §7 |
| D8 | OCR | 由 AI 多模态承担（P2），届时改 MOBILE-DESIGN 的「不做 OCR 识图」 | MOBILE-DESIGN.md 第 134 行 |
| D9 | 文档内入口 | **暂不做**（只从首页胶囊进；系统分享 P2） | 直接后果见 §10.4 |
| D10 | 外部文件解析 | **不做**（PDF/Word 一律不解析） | 只支持我们自己的文档 + 图片 |
| D11 | 资料的组成 | **1~5 篇 Lake 文档全文**；资源 = 这些文档里的图片 | 见 §3、§6 |
| D12 | 资料交互细节 | 常驻资料条 / 不自动勾选 / 允许中途增删 / 资源入口随资料置灰 / 60k 字·5 篇 / 仅 Lake 文档 | 见 §6~§9 |

**明确不做**（写死，防止反复立项）：识屏/圈选、跨 App 执行、记忆/自动填充、系统级唤醒、语音输入（P3 再议）、长期会话、全局资源浏览器、结果替换正文、PDF/Office 解析、AI 出图。

---

## 3. 概念模型

| 概念 | 定义 | 生命周期 | 数据来源 |
|---|---|---|---|
| **会话** | 一次打开 AI 页到关闭 | 内存；关闭即销毁 | 无落盘 |
| **资料** | 用户选入的 1~5 篇 kind=doc 文档，按选择顺序参与上下文 | 会话内；可中途增删 | readNoteBody() → lakeHtmlToPlain()（§10.1） |
| **资源** | 所选资料文档里的图片，用户显式挑选用作多模态输入 | 会话内 | note-assets/{noteId}/ + readAssetPreview() |
| **照片** | 拍照/相册临时图片，不属于任何文档 | 会话内；退出删除临时文件 | 系统相机/相册 → 临时目录 |
| **资料快照** | 首轮发送时把资料渲染成文本块的产物 | 会话内；文档 hash 变化时重建 | §9.1 |

不参与：未选入的文档、多维表/表格/画板/手写板（无纯文本）、小记（P3 再议）、外部文件。

---

## 4. 入口与信息架构

- **唯一入口**：首页底部胶囊「AI」（已是定稿三格之一；HomePage.tsx:743 目前点出的是「尚未接入」toast，P1 换成打开 AI 页）。
- **不新增入口**：工作区胶囊是定稿四格；工作区菜单不许放搜索/设置；工作区顶栏右上是「编辑/完成 + 同步」。**文档内入口 = 不做**（D9）。
- **系统分享（P2）**：已有 ACTION_SEND（text/plain、image/*，AndroidManifest.xml）→ 打开 AI 页并预填文本/图片。
- **不占胶囊格**：AI 页是**全屏功能页**，从首页盖上去，关闭回首页。

### 4.1 路由与层（不改 route 状态机）

- AI 页**不入 route.kind**，不改 useRouteTransition 的两层状态机（261019/261020 两次因 transform 包含块踩坑）。
- 实现：MobileApp 里 aiOpen 状态 → 条件挂载 MobileAiPage；类名 .mobile-ai-page，position:fixed;inset:0；层序用新令牌 --mobile-z-page: 30（低于 drawer 40、高于 dock 7；在 theme/tokens.css 新增并注释「全屏功能页」）。
- 进场 = **挂载淡入 120ms**（--lake-motion-fast；符合 DESIGN「挂载出现用 animation」），不做 push 位移；硬件返回注册 pushBackHandler（ui/backStack.ts）。

---

## 5. 页面结构与几何

```
┌──────────────────────────────────────────┐
│ ‹      新对话                     ＋      │ 44 顶栏
│         内容由 AI 生成                    │ 副标题 13px / --lake-text-3
├──────────────────────────────────────────┤
│ 资料 · 2 篇  [《周报》×] [《内核笔记》×] [＋] │ 44 资料条（常驻，横向滚动）
├──────────────────────────────────────────┤
│                                          │
│              ✦  AI 助手                  │ 空态：图标 28 / 小字 13
│          想让我帮你做点什么？              │ H1 24px（--lake-font-size-h1）
│                                          │
│   [总结这 2 篇] [对比异同] [列要点]        │ 建议 chips（32 高 + 44 命中区）
│                                          │
│   ── 对话流（流式 Markdown）──             │
│                                          │
├──────────────────────────────────────────┤
│ 将发送：2 篇文档（1.5 万字）· 3 张图片      │ 24 高提示行（有附件才显示）
│ [＋] [  问点什么…              ] [发送]    │ 输入栏 48 / 圆角 999
│                        （生成中→[停止]）   │
└──────────────────────────────────────────┘
```

### 5.1 几何与令牌（硬约束）

| 项 | 值 | 来源 |
|---|---|---|
| 顶栏 | 44 | MOBILE-DESIGN「档位」 |
| 资料条 | 44（chip 高 32，命中区补到 44） | 44 Rule |
| 输入栏 | 48，圆角 999，高随安全区 | 胶囊输入 |
| 页面左右内距 | 16 | --mb-page-pad |
| 内容区 | flex:1; overflow:auto；键盘用 viewportShell 的 --mb-app-h 收口 | 复用既有 IME 处理 |
| 字号 | 只用 --lake-font-size-*（空态问候 h1=24；正文 body=16；元信息 micro=12） | 无新字阶 |
| 颜色 | 只用 --lake-* 令牌；不新增颜色字面量 | ui-metrics |
| 图标 | lucide（Sparkles / Camera / Image / Paperclip / FileText / ArrowUp / Square），描边 1.75 | AGENTS §3#14 |

**44 Rule**：chip、顶栏图标钮、输入栏内按钮、资源网格项、资料 chip 的 ×，全部用 ::after 把命中区补到 --mb-tap-min（44），并**登记进 src/mobile/mobile.css 的「触达补足注册表」**（mobile.css:429）。不要靠放大视觉尺寸达标。

### 5.2 状态

| 状态 | 表现 | 备注 |
|---|---|---|
| 空态（无资料） | 问候 + 通用建议 chips（写作/翻译/头脑风暴） | 允许直接问，不强制选资料 |
| 空态（有资料） | 问候 + 随资料变的 chips（总结/对比/列要点） | 文案由 buildAiSuggestions(corpus) 纯函数生成 |
| 思考中 | 消息位置三点骨架；输入栏变「停止」 | 不弹 loading toast（产品气质） |
| 流式 | 逐块追加 Markdown；自动跟底（上滑则暂停） | §10.3 |
| 已停止 | 保留已生成内容 + 「已停止」小字 + 重试 | |
| 错误 | 气泡内中文原因 + 重试按钮（复用 aiErrors 文案） | 不静默、不 toast |
| 超预算 | 资料条旁警示徽标；发送前提示行明示截断 | §8.3 |
| 关闭确认 | **不做**（不持久化，关就清；生成中关闭先中止请求） | 避免多余确认 |

---

## 6. 资料选择器（Sheet）

入口：资料条右侧「＋」或点「资料 · N 篇」。

```
┌──────────────────────────────┐
│ 选择资料                [完成] │  head 44
│ 🔍 搜索文档…                  │  复用 SearchSheet 的搜索逻辑（bridge.searchNotes）
│ ──────────────────────────── │
│ ☑ 《周报 261022》   3,214 字  │  行 56
│ ☑ 《内核笔记》     12,403 字  │
│ ☐ 《读书摘录》     28,900 字  │
│ ☐ 《周报 260928》  表格 · 不支持│  置灰 + 理由
├──────────────────────────────┤
│ 已选 2 篇 · 1.5 万字 / 6 万字  │  预算条（实时）
│                  [开始对话]   │
└──────────────────────────────┘
```

规则：
- 默认列表 = 最近文档（noteRepository.listNotes 排序后取前 200，含搜索）。
- **不自动勾选任何文档**（避免误发隐私）。
- 只允许 doc_kind=doc；其余类型置灰 + 一行理由「暂只支持 Lake 文档」。
- 字数来自正文派生（首开读正文统计；后续用 text_cache），**估算值**允许 ±1%。
- 列表项标题单行省略（.mb-ellipsis）；多选复用现有 settings 行样式，不新造。
- 「完成」回填资料条；中途打开时保留已选。
- 浮层 = .mb-sheet（不新造第五件原语）；滑关/点遮罩/返回键走 useSwipeToClose + backStack。

---

## 7. 附件与资源（ActionSheet）

输入栏左侧 ＋ → .mb-actionsheet：

| 项 | 行为 | 前置 |
|---|---|---|
| 拍照 | 系统相机 → 临时图片 → 压缩 → 加入待发送图片 | 相机权限（走系统 picker 时无显式权限） |
| 相册 | 系统相册 → 同上 | — |
| 资源（文档里的图片） | 打开资源选择器（网格） | **必须先选资料**；否则置灰 + 理由「先选择资料文档」 |
| 资料 | 打开资料选择器（§6） | — |

资源选择器：
- 范围 = **所选资料文档的资源并集**；按文档分组（组头 = 文档标题）。
- 数据源：AssetSyncPlugin.listAssets({noteId})（AssetSyncPlugin.kt:222）只取 filename/size；**不要在这里算 sha256**（现有实现会算，附件多的文档会卡；P1 加一个 listAssetsLite 或按目录读）。
- 缩略图：readAssetPreview(noteId, filename)（bridge/assets.ts:21）返回 dataUrl，**只用于画缩略图**。
- 只允许图片（image/*），其它置灰 + 理由「暂只支持图片」。
- 多选 ≤10 张；选中项在输入栏上方显示缩略图 ×（可删）。

图片处理（拍照/相册/资源统一）：
- 解码 → 长边缩到 **1600px** → 编码 **JPEG q≈0.82**，目标单张 **≤1MB**；HEIC 解码失败 → 明确提示「这张照片格式暂不支持」。
- 原图不落用户资源目录；临时文件放 App 私有 cache 目录，发送后与退出时删除。
- 发送时**只传引用**（{kind:"asset", noteId, filename} / {kind:"temp", path}），由原生读文件组请求（§10.2）。

---

## 8. 预算模型

### 8.1 常量（新文件 src/mobile/ai/aiLimits.ts，单一来源）

```ts
export const AI_CORPUS_MAX_DOCS = 5;          // 对齐桌面 AI_MAX_DOCUMENTS
export const AI_CORPUS_MAX_CHARS = 60_000;    // 资料总字数（约 4 万 token，128k 上下文留余量）
export const AI_CORPUS_MIN_CHARS = 200;       // 低于此值视为空文档，不收录并提示
export const AI_HISTORY_MAX_TURNS = 12;       // 移动端只留最近 12 轮（24 条）
export const AI_IMAGES_MAX = 10;              // 对齐桌面 AI_MAX_IMAGES
export const AI_IMAGE_MAX_EDGE = 1600;
export const AI_IMAGE_MAX_BYTES = 1024 * 1024;
export const AI_TOTAL_MAX_CHARS = 200_000;    // 上游总护栏（含历史 + 资料），与桌面同值
```

### 8.2 收录算法（纯函数 buildCorpus()，可单测）

1. 资料按**选择顺序**排列（后加入的排末尾）。
2. 每篇先算纯文本长度 n_i。
3. 依次取 take_i = min(n_i, remaining)；remaining 初值 60,000。
4. 截断优先落在**段落边界**（换行），避免半句；找不到边界则硬切并在末尾加「……（以下省略）」。
5. remaining = 0 之后的文档标记 **未收录**。
6. 输出 {docs:[{id,title,totalChars,takenChars,truncated,excluded}], totalTaken}，供 UI 与上下文共用。

**绝不静默**：任何 truncated/excluded 都必须在资料条徽标 + 发送前提示行 + 对话首条分隔行三处可见（三处文案同源）。

### 8.3 文案口径（单一来源 aiCopy.ts）

- 资料条：资料 · 2 篇 · 1.5 万字；超限追加（第 2 篇截断）。
- 发送前提示行：将发送：2 篇文档（1.5 万字，第 2 篇截断）+ 3 张图片。
- 超限空态提示：资料已达上限，第 3 篇起不会被发送。

---

## 9. 上下文组装协议

### 9.1 资料块（固定前缀）

```
消息 1   system : AI_SYSTEM_PROMPT（共享，追加一段「资料规则」）
消息 2   user   : 【资料开始】共 2 篇 · 约 1.5 万字
                  【资料 1/2】《周报 261022》（3,214 字）
                  <纯文本；图片位置替换为 [图片]>
                  【资料 2/2】《内核笔记》（12,403 字，节选前 11,786 字）
                  ……
                  【资料结束】
消息 3..N 历史（最近 12 轮）
消息 N+1 user  : <本轮问题> + 图片块（image_url）
```

- 标记常量放 src/core/aiCorpus.ts（新）：AI_CORPUS_BEGIN/END、buildAiCorpusBlock()、buildAiSystemPrompt()；纯函数、两端都能用，方便将来桌面复用。
- 图片在正文里的引用一律替换为 [图片]（避免模型看到 URL 噪音）。
- 资料块**只注入一次**（会话首轮），随后作为**固定前缀**随会话保留。

### 9.2 固定前缀（pin）与裁剪

桌面 capMessages 现在只保「首条 system」（electron/ai/aiChatMessages.ts）。本设计需要：

- AiChatMessage 增加可选 pinned?: boolean。
- 裁剪规则改为：**保留开头连续 system + 开头连续 pinned 消息，再补最近若干条**，总数 ≤ 40。
- 移动端自己按 AI_HISTORY_MAX_TURNS=12 先裁一轮，再交给共享护栏兜底。

> 依据：资料不能被「保留最近 40 条」挤掉；且固定前缀稳定 ⇒ 供应商前缀缓存命中，成本远低于每轮重发 6 万字。

### 9.3 资料变更

- 允许中途增删；变更后**追加一条新的 pinned 资料块**，正文前缀写【资料更新 · 以本块为准】，旧块保留在历史里。
- 对话流里插一条淡色分隔行：— 资料已更新：+《标题C》 —，并在其后第一条回答上标注「基于更新后的资料」。
- 资料条实时更新；若文档 content_hash 变化（别端同步/本机编辑）→ 下次发送前重建资料块并追加（同一机制）。

### 9.4 预算与总护栏

- 资料 + 历史 + 本轮问题 ≤ AI_TOTAL_MAX_CHARS(200k)；超了先裁历史，**永不裁资料**（资料超限在选择阶段已解决）。
- 图片数 ≤10，单张 ≤1MB。

---

## 10. 数据与安全通路

### 10.1 读正文（资料）

readNoteBody(kind,id)（src/mobile/data/noteBodies.ts）→ lakeHtmlToPlain()（bridge/notes.ts:123）→ 纯文本。

- 缓存：Map<noteId, {hash, text}>，key 用 notes.content_hash；hash 不变不重读。
- 统计字数：countChars(plain)（同文件既有函数），选择器与预算条共用。
- 读失败（文件缺失/损坏）→ 该篇标红「无法读取」并**不加入资料**，绝不静默发空。

### 10.2 字节只在原生

- WebView 只传引用：{kind:"asset", noteId, filename} / {kind:"temp", path}。
- 原生 AiChatPlugin 自己读文件、编码 data URL、组请求体。
- readAssetPreview 的 dataUrl **只给缩略图**，不能当作发送数据源（否则字节绕 WebView 一圈）。

### 10.3 流式渲染

- 原生逐块推 ai:delta → JS 累积文本 → React state（**每帧最多一次 setState**，用 rAF 合并；不要每 delta 一次 render）。
- 自动跟底：仅在用户处于底部时跟随；用户上滑后暂停，显示「回到底部」小钮。
- 生成中切换资料/发新问 → 先取消当前请求（同 requestId 语义）。
- 关闭页面/切后台 → aiCancel；**进后台 = 中止本轮**（明确提示「已中止：应用进入后台」），P0 探针再验证是否改成「原生缓冲、回前台补」。

### 10.4 结果落点（D4 + D9 的直接后果）

文档内入口不做 ⇒ P1 **没有「当前编辑器」**，所以结果落点改为：

| 动作 | 行为 | 备注 |
|---|---|---|
| 复制 | 复制 Markdown 原文 | 最稳 |
| **存为新文档** | 新建 kind=doc，标题 = 本轮问题前 30 字，正文 = Markdown 写入，**不覆盖任何既有文档** | 复用 bridge.createNote + 文本写入 |
| **存为小记** | 新建小记，正文 = 回答（纯文本 + 图片卡，复用 quickNoteBodyFromTextAndImages） | 复用现有小记通道 |
| 插入到某篇文档 | **P2**：需恢复文档内入口后，用 insertAtPosition({id,offset},"text/markdown") 插到末尾，原块不动 | 单独验收 |

> 若后续恢复文档内入口，「插入/替换」语义再按桌面 aiResultOps 对齐——**替换永远不做**。

### 10.5 出网判据（D1）

- 新增 src/core/aiNetwork.ts：aiCanTouchNetwork({aiEnabled, netOnline})。
- AI **不看** cloudStateOf()/canTouchNetwork()；反过来同步也不看 AI。
- 设置页 AI 子页开关：AI 助手（默认关）；关闭时首页 AI 键**仍可进页**（否则用户找不到开关），进页后显示「AI 助手已关闭」+ 去开启；**任何路径不出网**。
- AGENTS §3#20 措辞改：canTouchNetwork() = 「**同步**能不能出网的唯一判据」，并补一句 AI 用 aiCanTouchNetwork()。
- 护栏：src/core/aiNetwork.test.ts + 一条静态断言（AI 路径不得 import cloudState）。

### 10.6 隐私与密钥

- Key 只在原生：写入时 JS 传一次明文到原生（aiSaveSettings({apiKey})），读取只回 keyTail（sk-****1234）。
- 存 Android Keystore（AES-GCM）+ SharedPreferences：复用 SecureStorePlugin.kt 的模式，**把加解密抽成 SecretBox.kt 单一实现**，两个插件共用；新别名 local-lakex-notes.ai.v1、prefs local-lakex-notes-ai。
- 日志：请求/响应只记长度与状态码，**不记 key、不记正文**。
- 资料外发提示：发送前提示行 + 首次使用一次性说明（设置页文案，不做弹窗）。
- 退出即清：内存会话 + 临时文件全清（cacheDir/ai-*）。

---

## 11. 原生通道（P0 核心）

### 11.1 插件接口（android/app/src/main/java/com/locallakexnotes/mobile/AiChatPlugin.kt）

Capacitor 插件名 AiChat，注册进 MainActivity 的插件列表。

| 方法 | 入参 | 出参 | 说明 |
|---|---|---|---|
| aiGetSettings | — | {baseUrl, model, temperature, reasoningEffort, thinking, hasKey, keyTail} | 永不返回明文 key |
| aiSaveSettings | {baseUrl?, model?, apiKey?, temperature?, reasoningEffort?, thinking?} | {ok} | 传 apiKey 才覆盖 |
| aiTestConnection | — | {ok, code?, message?, retryable?} | 最小真实请求 |
| aiChat | {requestId, messages, images?} | {ok, text}（结束时 resolve） | 流式经事件；错误也 resolve 成 {ok:false,code}，便于统一处理 |
| aiCancel | {requestId} | {ok} | 幂等 |

事件：ai:delta {requestId, delta}、ai:error {requestId, code, message, retryable}、ai:done {requestId, finishReason}。

### 11.2 实现要点

- 网络：**复用 HttpURLConnection**（AssetSyncPlugin 既有姿势），不引 OkHttp；worker 线程执行，**不阻塞主线程**。
- SSE 解析：按空行分帧，取以 data: 开头的行；[DONE] 结束；取 choices[0].delta.content；P1 忽略 reasoning_content。
- 超时：连接 15s / 空闲 60s / 总 180s；aiCancel 关连接。
- 错误归类：401/403 → auth；429 → rate；超时 → timeout；无网 → network；5xx → server；解析失败 → protocol；中文文案由共享 aiErrors 的 aiErrorTextFromCode(code, httpStatus?) 产出（P0 在 core 新增，桌面复用同一张表）。
- 命名：包名 com.locallakexnotes.mobile；存储键、prefs、别名统一 local-lakex-notes-*（旧 com.lakenotes.* / lake-notes-* 不再使用）。

### 11.3 JS 侧

- src/mobile/native/aiChat.ts：registerPlugin + 事件订阅（AiChat.addListener）。
- src/mobile/bridge/ai.ts：域方法 aiGetSettings/aiSaveSettings/aiTestConnection/aiChat/aiCancel + aiStream(listener)。
- 合入 bridge 组合（src/mobile/bridge.ts）。
- lakeNativeContract.ts 的 LAKE_NATIVE_BRIDGE_METHODS 追加这 5 个名字（护栏 contractSurface.test.ts 要求登记归属）。
- 移动端不复用桌面 IPC 三个通道（那是 Electron preload 语义）。

---

## 12. 与桌面的复用边界（单一来源）

| 资产 | 处置 |
|---|---|
| src/core/aiProviders.ts（供应商/设置/消息块类型） | **直接共用** |
| src/core/aiErrors.ts | 共用；P0 增 aiErrorTextFromCode() |
| src/features/ai/aiPrompts.ts（预设动作 + 系统提示 + 文档标记） | **只共用纯数据/纯函数**（AI_PROMPT_PRESETS、AI_SYSTEM_PROMPT、AI_DOCUMENT_MAX_CHARS）；UI 不复用 |
| electron/ai/aiChatMessages.ts 护栏 | **上收为 src/core/aiChatMessages.ts**（纯函数、无 node: 导入），桌面 main 改为 re-export；移动端共用（约 120 行，属必要重构） |
| electron/ai/aiClient.ts | 桌面专用（OpenAI SDK），移动端不用 |
| 桌面 UI（AiAssistantDialog / AiMessageBody / MarkdownView） | **不复用**（两端 UI 不共享）；移动端自写 src/mobile/ai/* |
| Markdown 渲染 | 移动端新写最小子集 AiMarkdown.tsx：段落/标题(≤h3)/粗斜体/行内代码/代码块/有序无序列表/引用/链接；**只渲染 React 节点，禁止 dangerouslySetInnerHTML**（AI 输出是不可信文本）；链接只放行 http(s) 并走系统浏览器 |

---

## 13. 分期任务书

### P0 · 通道探针（0.5~1 天，无 UI）

产出：AiChatPlugin.kt + native/aiChat.ts + bridge/ai.ts + 设置读写 + aiErrorTextFromCode。

设备探针（emulator-5554，隐藏调试入口或临时按钮）逐条记录：
1. 流式首字延迟与总时长（同一提示词跑 3 次）。
2. 取消：aiCancel 后 1s 内无新 delta、连接释放。
3. 断网：错误码 = network、文案可读、不崩溃。
4. 切后台/锁屏：事件是否丢、回前台能否继续（决定 §10.3 的「中止」是否成立）。
5. Keystore 往返：写入 → 杀进程 → 重启 → hasKey=true、keyTail 正确、明文不落盘（grep prefs）。

**P0 门禁**：npx tsc --noEmit + vitest（新单测）+ 双端构建 + check:mobileui。

### P1 · AI 页 MVP

范围：
- 首页 AI 键 → AI 页（全屏、淡入、硬件返回）。
- 空态 / 输入栏 / 流式 / 停止 / 错误重试。
- 资料条 + 资料选择器（搜索、多选、预算条、仅 doc）。
- 资料块组装（固定前缀 + pin 裁剪 + hash 缓存）。
- 设置页「AI」子页（地址/模型/Key/温度/思考档 + 连通性测试）。
- 结果动作：复制 / 存为新文档 / 存为小记。
- 发送前提示行；关闭即清。

新增文件（建议）：

```
src/mobile/ai/MobileAiPage.tsx     页面外壳（顶栏/资料条/内容/输入栏）
src/mobile/ai/AiConversation.tsx   会话状态机（发送/停止/重试/资料变更）
src/mobile/ai/AiMessageList.tsx    气泡 + 分隔行 + 自动跟底
src/mobile/ai/AiComposer.tsx       输入栏 + ＋ ActionSheet + 待发送图片条
src/mobile/ai/AiCorpusBar.tsx      资料条
src/mobile/ai/AiCorpusSheet.tsx    资料选择器
src/mobile/ai/AiResourceSheet.tsx  （P2）资源选择器
src/mobile/ai/AiMarkdown.tsx       最小 Markdown 渲染
src/mobile/ai/aiSession.ts         会话内存模型（纯逻辑 + 单测）
src/mobile/ai/aiLimits.ts / aiCopy.ts / aiSuggestions.ts
src/mobile/ai/ai.css               （登记 mobileLayers 基线，必须由组件 import）
src/core/aiCorpus.ts               资料块/系统提示/标记（纯函数）
src/core/aiChatMessages.ts         从 electron 上收
src/core/aiNetwork.ts              出网判据
src/mobile/settings/AiSettingsSheet.tsx（或设置子页）
```

**P1 验收**：
1. 首页进 AI、返回；硬件返回逐层（Sheet → 页面 → 首页）。
2. 选 2 篇文档：资料条、字数、预算条正确；超 60k 时有截断标记。
3. 发送：原生流式可见、可停止、错误可读、重试可用。
4. 结果：复制 / 存为新文档（正文与回答一致、无覆盖）/ 存为小记。
5. 关闭页面再进：资料与历史为空（不持久化）。
6. 关闭 AI 开关：任何路径不出网（抓包/日志双证）。
7. 设备截图（adb exec-out screencap -p）+ 走查新增 1 屏 ai-home（23→24 屏，只跑该屏）。
8. 门禁：tsc / vitest / 双端构建 / check:mobileui / ui-metrics / mobileLayers 基线只许按新增文件登记。

### P2 · 多模态

- 拍照 / 相册（压缩管线）+ 资源选择器（资料内图片）+ 待发送缩略图。
- 发送 image_url（user 消息，≤10 张）。
- OCR 场景 chips（提取文字 / 翻译），结果可「存为新文档」。
- 改 docs/MOBILE-DESIGN.md 的「不做 OCR 识图」。
- 系统分享入口（text/plain、image/*）→ 打开 AI 页预填。

**验收**：拍一张书页 → OCR 文字与原图一致；资源选择器只列所选文档的图片；非图片置灰有理由；10 张上限生效；设备截图。

### P3 · 可选（先证价值）

- 语音输入（系统 SpeechRecognizer，须明确「音频将交给设备语音服务」的提示）。
- 资料集超预算时的检索增强（用现有 FTS 命中片段替代全文）。
- 小记作为资料；思考过程展示；token 用量显示。

---

## 14. 护栏与测试清单

| 类型 | 项 |
|---|---|
| 单测 | aiSession（发送/停止/资料增删/清空）· aiLimits+buildCorpus（顺序/截断/段落边界/未收录）· aiCorpus（块格式/markers/图片占位）· aiChatMessages（pin + 40 条 + system 保护）· aiNetwork（AI 开关 × 网络 × 云同步互不影响）· aiErrorText（码表）· AiMarkdown（不渲染 HTML、链接只放行 http(s)）· aiSuggestions |
| 静态护栏 | mobileLayers.test.ts（新 css 登记基线）· mobileIndependence.test.ts（不 import 桌面样式/UI）· mobileStructure.test.ts（新文件放 src/mobile/ai/）· ui-metrics（无颜色/字号字面量）· lakeNativeContract/contractSurface（5 个方法登记）· CSP 测试不变（**不放开外网**） |
| 设备门禁 | 走查 +1 屏 ai-home；check:mobilesnap 不含 AI 页（避免再动 6 态基线；6 态基线本来就陈旧待重烤） |
| 手工 | 断网/弱网/后台切换/取消/超长文档/空文档/损坏正文/关闭开关/首次配置 |
| 日志 | 只记 requestId、耗时、字符数、状态码；不记 key 与正文 |

---

## 15. 风险与未决项

| # | 风险/未决 | 现状与建议 |
|---|---|---|
| R1 | 多文档全文 = token 成本 | 固定前缀 + 供应商前缀缓存；实测一轮 1.5 万字的实际计费后再决定是否降 60k |
| R2 | 切后台事件是否丢 | P0 探针第 4 条决定；默认「进后台即中止」 |
| R3 | 大附件内存 | 单张原图 >10MB 直接拒绝并提示；压缩在 WebView 用 createImageBitmap+canvas（HEIC 可能不解码） |
| R4 | 超长文档「整篇」期待 | 60k 是硬上限；P3 用 FTS 命中片段补，不做无限塞 |
| R5 | Markdown 渲染工作量 | 只做最小子集；代码块用等宽字体不引入高亮库 |
| R6 | 资料变更语义 | 采用「追加新前缀 + 分隔行」；若实测模型混淆，退回「改资料即新会话」 |
| R7 | 结果落点争议 | P1 = 新建文档/小记；恢复文档内入口后再补 insertAtPosition |
| R8 | 6 态基线陈旧 | 与本设计无关（HANDOFF §3#23），但动 AI 页别顺手改基线 |

---

## 16. 变更记录

- 261022：立项与定稿（用户拍板 D1–D12；明确不做外部文件解析、不做文档内入口）。
