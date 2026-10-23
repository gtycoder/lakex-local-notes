# 移动端 AI（Android）设计与实施契约

> 状态：**P0 + P1 首版已实现（261023）**，待设备验收（P0 五项探针 + P1 八条验收见 §13）。设计部分仍是评审基线；实现偏差记录在 §17。
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
| D13 | 每轮发送 | **资料集会话级冻结**（放固定前缀，含资源范围）；发送清单**可逐篇开关、默认继承上一轮**（改动=缓存重建点）；历史 **append-only** | 261023 三修，见 §9 |

**明确不做**（写死，防止反复立项）：识屏/圈选、跨 App 执行、记忆/自动填充、系统级唤醒、语音输入（P3 再议）、长期会话、全局资源浏览器、结果替换正文、PDF/Office 解析、AI 出图、**历史压缩/自动摘要（P1 不做）**。

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
│ 本轮发送：2 篇 · 15,617 字 ▾                │ 24 高提示行（可点，打开发送清单）
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
| 发送提示行 | 24（可点，右侧 ▾）；无资料时显示「本轮不带资料 · 选择发送内容」 | D13 |
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
- **只在会话开始前可用**：会话一旦开始，资料集冻结；再点「＋/资料」提示「本会话资料集已固定，换资料请新开对话」（不提供会话内增删）。

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
- 范围 = **会话资料集（A+B）的资源并集**，**与「本轮发送清单」无关**：例如资料 = A+B、本轮只发 A 的正文，仍可挑 B 里的图片；按文档分组（组头 = 文档标题）。
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

1. **本轮发送清单**按资料条顺序排列（后加入的排末尾）。
2. 每篇先算纯文本长度 n_i。
3. 依次取 take_i = min(n_i, remaining)；remaining 初值 60,000。
4. 截断优先落在**段落边界**（换行），避免半句；找不到边界则硬切并在末尾加「……（以下省略）」。
5. remaining = 0 之后的文档标记 **未收录**。
6. 输出 {docs:[{id,title,totalChars,takenChars,truncated,excluded}], totalTaken}，供 UI 与上下文共用。

**绝不静默**：任何 truncated/excluded 都必须在资料条徽标 + 发送前提示行 + 对话首条分隔行三处可见（三处文案同源）。

### 8.3 文案口径（单一来源 aiCopy.ts）

- 资料条：资料 · 2 篇；清单里被关掉的 chip 显示灰点。
- 提示行：本轮发送：2 篇 · 15,617 字 ▾；清单为空：本轮不带资料 · 选择发送内容。
- 超限提示：逐篇「收录 x/y 字（超预算截断）」，footer 显示 已截断。
- 发送清单 footer：本轮发送 1 篇 · 3,214 字。

---

## 9. 上下文装配（261023 二修：参照 DSH 的前缀 + 追加模型）

> 结论先行：**无状态 API 下，“只发一次”不是不发，而是“发的内容逐字节不变、位置不变”**——供应商前缀缓存会把它按约 1/10 计价。要做到这一点，资料必须**会话级冻结**并放在历史最前，历史只能**追加**。

### 9.1 先看 DSH 怎么做的（只读调研；源码 = `/Users/admin/file/local-lake/deepseek-harness-master`）

| 关注点 | DSH 的做法 | 出处 |
|---|---|---|
| 多轮发送 | 会话是 append-only 事件日志，模型历史由日志派生；**已追加的消息在后续每一步都会重发**（API 无状态） | `packages/core/session/README.md`（Model Experience → Token effect） |
| 固定开场白 | **冻结前缀**：一次组合、深冻结、放在 system 之后、**全部历史之前**；原文理由「frozen per instance ⇒ provider's prompt cache holds by construction」；被否方案里明确写了：每轮重算、放 system、放历史、放请求尾部都更差（尾部每轮重付且其后不可缓存） | `.agents/notes/archived/feature/2026-07-07-session-prefix.md` |
| 会变的内容 | 走 append-only 通道：「paid once, cache-read thereafter」 | 同上 |
| 大文件 | **不内联**：通用文件存字节 + 只读路径，模型收到“文件名/大小/digest/路径”一行句柄，**用 read 工具按需读** | `packages/attachment/attachment/README.md` |
| 图片 | 规范化成 provider 无关光栅并持久化，**后续每一轮按 route 尺寸确定性重投影**（同一图同一版本）；加图会使“受影响的后缀”缓存失效 | 同上（Reuse images across the session / KV Cache effect） |
| @文件 | 只是 prompt 文本，不附带内容，模型必须自己调 read 工具 | `packages/context/file-reference/README.md` |
| 压缩 | 显式 replace，**从第一个被替换的消息起缓存失效**，代价被接受 | `packages/compaction/compaction-image-offload/README.md` |
| 可观测 | token 用量分四个不重叠桶（input / output / cacheRead / cacheWrite），界面显示 cache 命中率 | `.agents/notes/archived/feature/2026-07-21-tui-footer-cache-hit-rate.md` |
| 文档习惯 | 每个包 README 固定三段：What the model sees / Token effect / **KV Cache effect** | `docs/cookbook/adding-a-package.md` |

### 9.2 我们的简化映射（不照搬复杂度）

| DSH | 我们（P1） | 为什么简化 |
|---|---|---|
| 冻结前缀（session prefix） | **资料集 = 会话级冻结前缀**：进入对话时选定，之后不变 | 我们没有插件/多轮注入，只有“一次会话一份资料” |
| append-only 历史 | 只追加问答；**不改写历史、不压缩** | 个人短会话，压缩收益低、破坏缓存 |
| 大文件给句柄 + read 工具 | 我们**没有工具循环** ⇒ 资料仍内联全文（唯一差异），但只作为固定前缀 | 加 tool calling 是另一个量级（P3） |
| 图片确定性重投影 | 图片规范化一次、**留在历史里**、每轮同版本重发 | 与 DSH 同构，代价可控（≤10 张） |
| compaction replace | P1 不做；超预算 → 提示开新对话 | 避免“悄悄裁历史” |
| 缓存命中率 | P3 可选显示 | 先不做 |

### 9.3 每轮请求结构（稳定前缀 + 追加尾部）

```
[固定] system : AI_SYSTEM_PROMPT（本会话不变；含“资料规则”）
[固定] user   : 资料块（会话级冻结；只含清单内文档，顺序固定）
[追加] ...    : 历史（最近 12 轮问答；append-only）
[尾部] user   : 本轮问题（+ 图片块）
```

- 资料块每轮**仍随请求发送**（API 无状态），但**字节与位置不变** ⇒ 命中前缀缓存，等同“只发一次”的计费。
- 历史只在尾部追加 ⇒ 每轮只有“新增问题 + 新回答”是新 token。
- 会话内**固定模型/温度/system**（改任何一项都全量失效）。

### 9.4 会话资料集 vs 本轮发送清单

| 概念 | 范围 | 可变性 |
|---|---|---|
| **会话资料集** | 本次对话在册的文档（资料条） | 会话级冻结（P1）：中途增删 = 换资料 = 建议新对话 |
| **本轮发送清单** | 这一轮真正放进资料块的文档 | **默认继承上一轮**（sticky）；可临时关某篇 |

- 关掉/恢复某篇 = 改资料块 = **从资料块起缓存失效**（本轮全价，之后重新积累）；P1 在面板里写清一句“改动会重建缓存”。
- 会话资料集本身不动（chip 灰点 = 本轮不发，× = 移出会话——P1 里 × 也提示“建议新对话”）。
- 这个模型同时满足：“固定资料、只发一次”的缓存收益 + “继承上一轮”的零操作成本 + 必要时仍可关某篇。

**典型组合（用户 261023 举例）**：会话资料集 = A + B（固定）；本轮发送清单 = 仅 A（B 的正文不发）；同时从 B 里挑 1 张图片作为视觉输入。
- 资料块只含 A ⇒ 体积小、更省 token；
- B 的图片在尾部 user 消息里 ⇒ 不破坏 A 资料块的缓存前缀；
- 下一轮继承「仅 A」，除非用户再把 B 打开（打开 = 资料块变化 = 重建一次缓存）。

### 9.5 KV Cache 影响表（写进文档，评审时逐条看）

| 动作 | 影响 | 说明 |
|---|---|---|
| 正常发问 / 回答 | ✅ 前缀仍命中，只付新 token | 尾部追加 |
| 关掉/恢复某篇（改清单） | ❌ 从资料块起失效，本轮全价 | 之后重新积累 |
| 会话中途加/删资料（P1 不推荐） | ❌ 同“新会话” | 资料块变了 |
| 新增图片 | ⚠️ 该图之前的前缀仍命中；图片与之后是新 token | 图在尾部 user 消息里 |
| 换模型 / 改温度 / 改 system | ❌ 全失效 | 会话内固定 |
| 开新对话 | ❌ 全冷启动 | 预期内 |
| 压缩历史（P1 不做） | ❌ 从被替换点起失效 | DSH 明确接受该代价 |

### 9.6 图片

- 规范化：长边 1600 / ≤1MB / JPEG，**进入会话时做一次**；
- **留在会话历史**里，每轮确定性重发（同图同字节）⇒ 不额外破坏缓存；
- 单会话 ≤10 张；超出提示“移除一张或开新对话”；
- P3 可借鉴 DSH 的 image-offload：旧图降级为占位文本（保留可再选的引用），而不是静默丢。
- 会话退出即清（DSH 是“永不删除”，因为要跨重启复用；我们不持久化，所以清）。

### 9.7 文件

- P1 不解析外部文件（PDF/Word 不做）；DSH 那套“给只读路径 + read 工具”要 tool calling，列为 P3。

### 9.8 超限策略（P1：不压缩）

- 预算 = 资料块 + 历史 + 本轮问题（图片按 token 折算另计≤10 张）；
- 资料 > 60k 字：在选择阶段截断（逐篇显示收录多少）；
- 历史 + 问题 > 200k 字：**提示开新对话**，不静默裁历史（裁 = 破坏缓存 + 不可预期）。

### 9.9 会话过期
关闭页面即销毁（不持久化）；不提供“恢复上次对话”。

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
| Markdown | **解析器共用** `src/core/markdown.ts`（261023 从桌面抽出：块/行内 token + **GFM 表格**；纯数据、不碰 React/DOM）；**渲染各端自绘**：桌面 `MarkdownView.tsx`（`.md-preview` + `window.open`）、移动端 `AiMarkdown.tsx`（`.ai-md` + `<a target=_blank>`）。都只渲染 React 节点、禁止 dangerouslySetInnerHTML，链接只放行 http(s) |

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
- 发送清单默认继承上一轮；图片进入会话后留在历史（每轮同版本重发）。
- 结果动作：复制 / 存为新文档 / 存为小记。
- 发送前提示行；关闭即清；超预算提示开新对话（不压缩历史）。

新增文件（建议）：

```
src/mobile/ai/MobileAiPage.tsx     页面外壳（顶栏/资料条/内容/输入栏）
src/mobile/ai/AiConversation.tsx   会话状态机（发送/停止/重试/资料变更）
src/mobile/ai/AiMessageList.tsx    气泡 + 分隔行 + 自动跟底
src/mobile/ai/AiComposer.tsx       输入栏 + ＋ ActionSheet + 待发送图片条
src/mobile/ai/AiCorpusBar.tsx      资料条
src/mobile/ai/AiSendSheet.tsx      本轮发送清单（每篇开关 / 全部发送 / 全部不发）
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
5. 组合场景：资料 = A+B 固定，本轮只发 A，从 B 挑图发送；下一轮继承「只发 A」；再打开 B ⇒ 资料块变化、缓存重建一次。
6. 关闭页面再进：资料与历史为空（不持久化）。
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
| 单测 | aiSession（发送/停止/资料增删/清空）· aiLimits+buildCorpus（顺序/截断/段落边界/未收录）· aiCorpus（块格式/markers/图片占位/清单为空不加块）· aiSendList（默认继承/关闭不移除/× 才移除）· aiCacheShape（资料块字节稳定、历史只追加、清单变化只影响本轮）· aiChatMessages（pin + 40 条 + system 保护）· aiNetwork（AI 开关 × 网络 × 云同步互不影响）· aiErrorText（码表）· AiMarkdown（不渲染 HTML、链接只放行 http(s)）· aiSuggestions |
| 静态护栏 | mobileLayers.test.ts（新 css 登记基线）· mobileIndependence.test.ts（不 import 桌面样式/UI）· mobileStructure.test.ts（新文件放 src/mobile/ai/）· ui-metrics（无颜色/字号字面量）· lakeNativeContract/contractSurface（5 个方法登记）· CSP 测试不变（**不放开外网**） |
| 设备门禁 | 走查 +1 屏 ai-home；check:mobilesnap 不含 AI 页（避免再动 6 态基线；6 态基线本来就陈旧待重烤） |
| 手工 | 断网/弱网/后台切换/取消/超长文档/空文档/损坏正文/关闭开关/首次配置 |
| 日志 | 只记 requestId、耗时、字符数、状态码；不记 key 与正文 |

---

## 15. 风险与未决项

| # | 风险/未决 | 现状与建议 |
|---|---|---|
| R1 | 多文档全文 = token 成本 | 资料块冻结 + 历史 append-only ⇒ 稳定前缀命中缓存（约 1/10 价）。实测一轮 1.5 万字、连续 10 轮账单后再决定是否降 60k |
| R9 | 改清单/改资料导致缓存失效 | 改一次只破一次，之后重新积累；P1 文案要写清“改动会重建缓存”，资料集则建议开新对话 |
| R10 | 无历史压缩 ⇒ 长会话会撞 200k 上限 | P1 提示开新对话；P3 若做压缩，按 DSH 经验接受“从替换点起缓存失效” |
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
- 261023：新增 D13「每轮发送清单」，§9 首版为“每轮重建 + 历史剥离资料”。
- 261023（二修，参照 DSH）：改为**资料集会话级冻结 + 固定前缀 + append-only 历史**；发送清单默认继承；图片留在历史；P1 不做压缩。附 DSH 出处与 KV Cache 影响表。
- 261023（三修，用户定稿）：资料集冻结但**逐篇发送开关保留**（支持“资料 A+B、仅发 A、用 B 的图片”）；资源范围 = 会话资料集，与发送清单无关；会话内不再提供资料增删入口。

---

## 17. 实现状态（261023）

### 已落地（可编译、门禁绿）

| 层 | 文件 | 说明 |
|---|---|---|
| 原生通道 | `android/.../AiChatPlugin.kt` · `SecretBox.kt` | Keystore 存配置；HttpURLConnection + SSE；ai:delta / ai:error / ai:done；aiChat / aiCancel / aiTestConnection / get·saveSettings |
| 桥接 | `src/mobile/native/aiChat.ts` · `src/mobile/bridge/ai.ts` | 插件封装 + 域方法（含 `aiReadDocText`）；契约名单 +5（`lakeNativeContract` 55/56） |
| core | `aiCorpus.ts` · `aiNetwork.ts` · `aiChatMessages.ts`（从 electron 上收） · `aiErrors.aiErrorInfoFromCode` | 资料块拼装 / 出网判据 / 统一预算 / 错误码中文映射 |
| UI | `src/mobile/ai/`（MobileAiPage / AiCorpusSheet / AiSendSheet / AiMarkdown / aiSession / aiSettings / ai.css） | 全屏页、资料条、发送清单、流式、停止、错误重试、结果三动作（复制 / 存为新文档 / 存为小记） |
| 接线 | `MobileApp.tsx`（lazy + aiOpen） · `HomePage.tsx`（AI 键） · `SettingsDrawer.tsx`（AI 子页） · `main.tsx`（ai.css） · `tokens.css`（--mobile-z-page） | 入口/设置/层序 |
| 门禁 | `mobileLayers`（ai.css 234/1） · `mobileIndependence` · `ui-metrics` · `check:mobileui` · tsc · vitest（368 文件 / 2554 例） | 全绿 |

### 设备实测（emulator-5554 + 小米 MiMo，261023）

**配置**：`baseUrl=https://api.xiaomimimo.com/v1`、`model=mimo-v2.6-flash`；Key 经 `aiSaveSettings` 写入后只读回 `sk-****ju4z`；`aiTestConnection` **ok（≈0.9s）**；**重启 App/模拟器后仍可读回并连通**（Keystore 持久化 ✓）。

| 探针 | 结果 |
|---|---|
| 流式首字 | **≈1.2s**（短问答；长文创作首字略慢） |
| 从发送到结束 | **≈1.8s**（71 字回答） |
| 流式中止 | 点停止后正文冻结、显示「已停止」、按钮回到发送态；**之后的 delta 不再追加** |
| 出网错误 | 不可达 baseUrl ⇒ `code=network`；坏 Key ⇒ `401` → `code=auth` +「Invalid API Key」（错误体已从 JSON 提取 message，不再把整段 JSON 塞进气泡） |
| 带资料问答 | 选中 365 字文档 → 资料条/提示行/分隔行正确；回答**确实引用文档内容**并区分「资料集 vs 发送清单」 |
| 切后台 | 后台 4s 再回前台：**未崩溃、流继续**（92 字 → 175 字）。**用户 261023 定稿：保留“继续流”**，不做后台中止 |
| 离开 AI 页 | 流式期间点返回回首页、9s 后再进来：**完整回答还在**（会话存于模块级 store，订阅常驻）；「新对话」才清空；**App 进程结束 = 新会话** |

截图（本地预览件 `docs/preview/`，未入库）：`ai-device-empty.png` · `ai-device-corpus.png` · `ai-device-corpus-chat.png` · `ai-device-streaming.png` · `ai-device-stopped.png` · `ai-device-error.png` · `ai-device-settings.png`。

**探针期间发现并修掉的两处**（都不在 happy path 上）：

1. **Kotlin：delta 为 JSON null 时混入字符串 "null"**（`optString` 会把 null 变 "null"）→ 改用 `opt` 判类型；修前回答正文会出现 `nullnull…` 前缀。
2. **移动端「彻底删除」在原生批量事务里重复 BEGIN**（`d.transaction` 内再调 `executeSet` 默认 `transaction:true`）⇒ 回收站 purge 报 `Already in transaction`，**删除一直失败**。修法：`executeSet` 增加 `{transaction}` 选项，事务内批量下发传 `false`；补单测 `sqliteDb.batch.test.ts`。实测 4 篇探针文档已全部 purge，回收站清空。

### 与设计的偏差 / 待办

1. **P0 探针已跑通主路径**（见上表）；仍缺：超时（read timeout）与限流（429）文案、后台策略拍板。
2. **图片仍是 P2**：附件 ActionSheet 已按最终形态接线，拍照/相册/资源三项点了给「即将支持」提示（不假装可用）。
3. **资料集冻结的实现口径**：首条消息发出后禁止增删资料（提示「换资料请新开对话」）；发送清单可随时改（文案已写清缓存重建代价）。
4. **结果「存为新文档」**用「新建空文档 + 写入纯文本段落」，没有走内核编辑器（P1 无编辑器挂载）；后续若要保留 Markdown 结构，再评估内核写入。
5. **未接设备门禁**：走查 23 屏尚未加 `ai-home`（需要设备；P1 验收第 7 条）。
6. **Markdown 表格不渲染**：模型偶尔输出表格，当前最小渲染器按下标原样显示 `|` 文本；要不要支持表格是 P2 的小决定。
7. **后台行为与设计稿不一致**：设计写「进后台即中止」，实测是继续流；需要你拍板保留哪种（继续更像 ChatGPT，中止更省流量）。
8. **会话连续性（261023 定稿）**：AI 页关闭不销毁会话（模块级 `aiChatStore` + 常驻 `onAiStream`），后台流继续、再进来可看完整回答；**App 进程结束才清空**（仍不持久化）。若要跨 App 重启保留，需要单独拍板"保留最近一次会话"。
9. **Markdown 表格（261023 定稿）**：解析器已抽到 `src/core/markdown.ts`（桌面/移动共用，含 GFM 表格）；**两端都渲染表格**（桌面 `.md-table`、移动 `.ai-md__table`），样式各走各的令牌；零依赖、纯 React 节点。图片仍不做（按原文呈现）。
10. **未提交/未推送**：本批只落工作树，等用户验收后按仓库规则提交。
