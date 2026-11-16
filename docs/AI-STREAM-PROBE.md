# AI 流式体验 A+B：节流调参 + 端到端计时探针（261116）

> 任务：`task-17`。A = 收紧流式 Markdown 节流参数（立刻可见）；B = 起 loopback 假供应商、量真实流式路径的可见更新节奏。
> 纪律：只改 `src/components/ui/markdown/**`、`scripts/**` 与本文档；未 commit；未碰 `src/features/ai/**`、`src/features/aiWriting/**`、`electron/**`。
> **给 Lead 的 HANDOFF 指针**：`docs/AI-STREAM-PROBE.md`（AI 流式节流参数 2000/2 → 300/1.5，端到端探针 `scripts/ai-stream-probe.mjs`）。

## 0. 结论先行

| 项 | 改前 | 改后 | 依据 |
|---|---|---|---|
| `MAX_WAIT_MS` | 2000 | **300** | 旧值在重负载实测出 **1805–3951ms** 的可见更新间隔（用户「2 秒才更新一屏」）；300 让最坏「纯等待」≤300ms，且仍给节流留档位 |
| `COST_RATE` | 2 | **1.5** | 2×cost 等于「等一次渲染再翻倍」；1.5 保留「贵渲染降频」，把中成本档（cost 20–200ms）的间隔压到 30–300ms |
| 算法 | deepseek chat-demo 的 cost-based 节流 | **不变**（只改常量与注释） | 任务要求 / 来源一致性 |
| 60KB 普通长回答 | 43.5 fps / 最大间隔 75ms | **43.7 fps / 47ms** | 无回归（参数本来就不该影响轻负载） |
| 640KB 普通长回答 | 11.6 fps / 401ms | **12.6 fps / 256ms** | 最大间隔 **−36%**（300ms 上限开始生效） |
| 640KB 密集块（压力档） | 2.3 fps / **2516ms** | **3.3 fps / 1373ms** | 最大间隔 **−45%**，最坏值从「>2.5s，最高 3.95s」收到「≤1.45s」 |
| 首帧可见延迟 | 4–31ms | 4–31ms | 由传输/IPC 决定，与节流参数无关（无回归） |

**一句话**：参数收紧后，普通长回答观感不变，重渲染场景的「一屏等待」被砍掉 36–45%（最坏从 3.95s → 1.45s）；
但仍受**单次渲染成本地板**限制（密集 640KB 时一次提交本身约 1s），要再快属于渲染器优化，不在本任务。

---

## 1. A：节流调参（`useThrottledMarkdown`）

### 1.1 机制（保持不变）

`src/components/ui/markdown/useThrottledMarkdown.ts`（来源 deepseek-ai/chat-demo，MIT）：
每次真正提交后量 `cost = 本次渲染+提交耗时`，算下次允许更新时间点：

```
nextAllowed = now + min(MAX_WAIT_MS, cost * COST_RATE)
实际更新周期 ≈ cost + min(MAX_WAIT_MS, cost * COST_RATE)
```

⇒ **两个参数分工**：`COST_RATE` 决定轻/中成本档的降频幅度；`MAX_WAIT_MS` 决定「再贵也不许等超过多久」的上限。

### 1.2 为什么改、改成多少

- **MAX_WAIT_MS = 300**（任务窗口 250–400）：上限 300ms ⇒ 纯等待下限 3.3fps（250 档更密但会多耗 CPU；400 档只有 2.5fps）。
  实测（B 探针，3 次中位数）旧 2000 在密集 640KB 档出现 **2516ms 中位 / 3951ms 最坏** 的可见间隔；300 档同场景中位 **1373ms**，且方差从 1805–3951 收敛到 1230–1453。
- **COST_RATE = 1.5**（任务建议值，用数据确认合理）：旧 2× 让「等一次渲染」变成「等两倍渲染」；1.5 仍保留降频（避免每次 delta 都重建 DOM），
  在 cost 20–200ms 档把间隔压到 30–300ms。两者叠加后实测目标区间 2.5–8fps 成立（见 §3）。
- **为什么不是更小**：`MAX_WAIT` 只能削「等待」，削不掉「渲染本身」。密集 640KB 的单次提交约 1s ⇒ 实测 3.3fps 已是该内容下的地板；再压参数只会让 CPU 更忙、不提升可见帧率。
- 算法/边界行为（连续 delta 只提交最新、`enabled=false` 当帧全文、卸载清定时器）**一行未改**。

### 1.3 测试（`useThrottledMarkdown.render.test.tsx`，6 例）

| 用例 | 锁什么 |
|---|---|
| 连续内容更新被合并 | 未到允许点不渲染；到期只提交**最新**内容 |
| **高渲染成本（5000ms）下最大等待仍是 300ms** | 新上限（旧实现此处会是 7000ms） |
| **间隔 = 1.5 × 上次渲染成本**（cost=100 ⇒ 150ms） | 新 COST_RATE（未触上限档） |
| enable=false 立即透传 | 生成结束/禁用语义 |
| 生成结束当帧全文 + 清定时器 | 不残留截断 |
| 卸载后无定时器泄漏 | 无泄漏、无已卸载 setState |

---

## 2. B：端到端计时探针（无真实 Key）

### 2.1 架构：真实路径，只把「供应商」换成本地假货

```
dev 实例（CDP 9222）
  └─ runAiChat()（src/lib/ai.ts，渲染层唯一入口）
       └─ IPC ai_chat → 主进程 AI 网关（electron/ai/aiClient.ts，openai SDK）
            └─ HTTP POST http://127.0.0.1:9123/v1/chat/completions（本脚本起的假供应商：text/event-stream）
                 ← 150 帧 × 20ms ≈ 3s，OpenAI chunk 格式（choices[0].delta.content），末尾 finish + [DONE]
       ← IPC onAiStream 逐 delta 回渲染层
  └─ AiStreamingMessageBody（**真实** useThrottledMarkdown）→ MarkdownView（真实解析器）→ DOM
```

- 用的是**应用同一份模块**：Vite dev 会把 `scripts/ai-stream-probe-harness.mjs` 当 ES 模块转换，
  其中 `import { runAiChat } from "/src/lib/ai.ts"`、`import { AiMessageBody, AiStreamingMessageBody } from "/src/features/ai/AiMessageBody.tsx"`
  ⇒ 不是另写渲染器；`useThrottledMarkdown`、`MarkdownView`、主进程网关与 IPC 全在链路上。
- **与真实聊天 UI 的差异（口径）**：探针把 `AiStreamingMessageBody` 挂在一个自管 React root 的 overlay 里，
  没有真实聊天弹窗外壳、会话落库、自动滚动/滚动跟随与输入框；delta 累加方式与 `AiAssistantDialog` 相同（每个 delta setState）。
  因此本文数字 = **渲染+IPC+主进程网关**的真实节奏，不含「滚动跟随/自动贴底」成本。
- 前置：dev 库里需有一条 **loopback provider**（`baseUrl=http://127.0.0.1:<port>/v1`）。本机既有 `openai → http://127.0.0.1:9123/v1`；
  探针只临时切换 `activeProviderId`，结束后恢复（**不改 baseUrl、不碰 Key**）。

### 2.2 度量口径

| 指标 | 定义 |
|---|---|
| `deltas` | 主进程 IPC 送到的 delta 数（=假供应商帧数附近） |
| `visibleUpdates` | 流式窗口内「DOM 文本真的变了」的帧数（MutationObserver + rAF 合帧） |
| `visibleFps` | `(visibleUpdates-1) / (lastVisible-firstVisible)` |
| `maxGapMs` | 流式窗口内相邻可见更新的最大间隔（=用户感知的「卡住多久」） |
| `firstVisibleMs` | `runAiChat` 调用 → 首个非空 DOM 文本出现在屏上 |
| `finalFlushMs` | 流结束后换 `AiMessageBody` 当帧全量渲染的耗时 |
| `streamMs` | `runAiChat` 调用的墙钟（含被渲染阻塞的时间） |
| `deltas` | `runAiChat` 的 onDelta 回调次数（受内部订阅生命周期影响） |
| `deltaEvents` | **事件级** delta 数：独立订阅 `native.onAiStream` 计数（不依赖 runAiChat resolve，口径修正 261116） |
| `deltaEventsAfterResolve` | resolve 之后才送达的排队 IPC delta（生产上不会再应用，仅用于暴露口径差） |
| `drainMs` | resolve 后等待迟到事件的窗口（默认 150ms；主线程忙时实际会略长） |
| `longTasks` | 流式期间 `PerformanceObserver(longtask)` 的次数/最长/总时长（渲染阻塞的直接证据；不支持的环境为 0） |
| `finalFlushRawMs` | 结束→最终全量渲染可见的**原始**间隔（可能为负：DOM 帧早于计时采样，保留原值以便识别口径问题） |
| `appState` | 驱动层记录的应用状态（打开 tab 数 / 脏 tab 数）——跨会话对比必须看它 |

### 2.3 三档 fixture（合成内容，详见 `scripts/ai-stream-probe-content.mjs`）

| 档 | 命令 | 内容 | 说明 |
|---|---|---|---|
| realistic | `--chars 60000` | 60KB 标题/列表/代码块混合 | 接近真实长回答 |
| stress | `--chars 640000` | 640KB 同结构 | 超长回答 |
| dense-heavy | `--chars 640000 --dense` | 640KB、约 8 万条极短列表项 | 压力档：每次提交都要重建大量 DOM（冷启动一次渲染约 2.8s，流中一次提交约 1s） |

---

## 3. 数字

> **口径声明（261116 修正）**：本探针只适合**同会话相对对比**（同机器、同 app 状态、同一份 fixture 下 before/after），
> **不适合跨会话的绝对值对比**：dev 构建 + 打开 tab 数 + 机器负载会让同一参数的 maxGap 波动 ±30% 以上（见 §3.2）。

### 3.1 历史批次（before = 2000/2，after = 300/1.5；同一 fixture、同一机器、各 3 次取中位数）

| fixture | 参数 | deltas | 可见更新 | **fps** | **最大间隔** | p50 间隔 | 首帧可见 | 流结束全量渲染 |
|---|---|---|---|---|---|---|---|---|
| realistic 60KB | before | 150 | 138 | 43.5 | 75ms | 21ms | 5ms | 12ms |
| realistic 60KB | after | 150 | 139 | **43.7** | **47ms** | 21ms | 4ms | 13ms |
| stress 640KB | before | 149 | 37 | 11.6 | **401ms** | 58ms | 5ms | 130ms |
| stress 640KB | after | 147 | 43 | **12.6** | **256ms** | 59ms | 16ms | 146ms |
| dense-heavy 640KB | before | 130 | 11 | **2.3** | **2516ms**（1805–3951） | 120ms | 22ms | 497ms |
| dense-heavy 640KB | after | 123 | 14 | **3.3** | **1373ms**（1230–1453） | 110ms | 31ms | 532ms |

派生结论：

- **dense-heavy 最大可见间隔 −45%**（2516 → 1373ms），最坏值 −63%（3951 → 1453ms）；fps +43%。这正是用户报的「2 秒一屏」场景。
- **stress 最大间隔 −36%**（401 → 256ms），fps +9%；300ms 上限开始成为实际瓶颈。
- **realistic 无差异**（43.5 → 43.7 fps，p50 21ms 不变）：普通长回答本来就没触发节流上限，调参不会让它变慢。
- **首帧可见 4–31ms**、**流结束全量渲染 12–532ms**：两档前后一致 ⇒ 调参只影响「中途更新节奏」，不影响首帧与最终落屏。
- dense-heavy 只有 3.3fps（目标 2.5–8fps 的下沿）：因为单次提交本身 ≈1s，参数只能削掉额外等待；再往上要渲染器优化。

### 3.2 review 复跑（261116 第二批：探针口径修正后，同会话相对值）

条件：HEAD 5ce5ecf8 + 本批渲染层修复；params=300/1.5（JSON 实测）；同一台机器、**同一会话**（appState: tabs=2, dirty=0）；
`--repeat` 默认 5（dense 档因重负载 CDP 偶发超时，实际 repeat=3）；数字 = 中位数（范围 = 各次）。

| fixture | runs | **fps** 中位（范围） | **最大间隔** 中位（范围） | p50 间隔 | 首帧可见 | 结束全量渲染 | longtask（次数/最长/总） | deltaEvents（迟到） |
|---|---|---|---|---|---|---|---|---|
| realistic 60KB | 5 | **42.4**（41.6–43.7） | **58ms**（46–78） | 21ms | 4–20ms | 0–12ms | 1 / ~55ms / ~55ms | 150（0） |
| stress 640KB | 5 | **12.6**（11.1–13.2） | **278ms**（218–912，一次孤立 912） | 56ms | 4–56ms | 130–142ms | 10–21 / 565–660ms / 1.7–2.1s | 150（0–2） |
| dense-heavy 640KB | 3 | **3.2**（3.1–3.6） | **1091ms**（884–1455） | 130ms | 6–30ms | 497–835ms | 19–22 / 907–1002ms / 4.4–5.5s | 150（10–48） |

与历史批次的对照（**只能看方向**，不能逐位比较）：

- stress：本次 12.6fps / 278ms vs 任务-17 review 复跑 12.6fps / 215–241ms、文档 3.1 节 after 12.6fps / 256ms ⇒ 同一档位，波动来自 app 状态/负载。
- dense：本次 3.2fps / 1091ms vs review 复跑 3.0–3.2fps / 1760–1971ms、文档 after 3.3fps / 1373ms ⇒ 方向一致；口径修正后 `maxGap` 中位更低（旧末帧被 resolve 采样截断，新版把「结束当帧」与可见帧分开量）。
- realistic：本次 42.4fps / 58ms vs 文档 after 43.7fps / 47ms ⇒ 同一量级（`finalFlush` 从页面 rAF 采样，±1 帧误差）。

**探针口径修正（本批）**：

1. `deltas` 改为**事件级**（独立订阅 `native.onAiStream`）+ resolve 后 drain 150ms ⇒ dense 档现在稳定计到 **150/150**（旧版只计到 117–142/150），并单独报告 `deltaEventsAfterResolve`（dense 档 10–48 个：主线程被渲染阻塞时迟到的 IPC 事件，生产上不会再应用）。
2. `finalFlushRawMs` 保留原始值（可能为负），`finalFlushMs` clamp≥0；`finalComplete` 改为「最终 DOM 文本不短于流式期间最长可见文本」的长度代理。
3. 新增 `longTasks`（PerformanceObserver）：dense 档一次最长**约 1s**、总 4.4–5.5s，stress 档最长 0.57–0.66s ⇒ 这些就是「一次提交 ≈1s」的直接证据，也是 300ms 上限之外的地板。
4. `appState`（tab 数/脏 tab）进 JSON；`--repeat` 默认 5。

**已知不稳定**：dense-heavy 档首次以 repeat=5 跑时（页面 reload + 重负载）出现一次 CDP 调用超时，重跑 repeat=3 全部通过；极端 fixture 建议 `--repeat 3` + `--timeout 200000`。

**探针覆盖边界**：本探针量的是 AI 助手 `AiMessageBody`（流式 Markdown 节流）路径，**不覆盖** 261116 本批新增的 AI 写作工作区合帧（`useAiWriting` 的 rAF 合帧 / `AiMessageList` memo）。后者由渲染次数回归测试覆盖（`AiMessageList.render.test.tsx`、`useAiWriting.stream.render.test.tsx`：历史条 50 delta 期间渲染 **0 次**；结束当帧完整）。

---

## 4. 告警 / 限制（读数字前必看）

1. **无真实网络**：假供应商走 loopback `http://127.0.0.1:9123`（主进程允许本机地址；真实 Key 未使用）。首帧/总耗时不含真实公网 RTT。
2. **dev 构建**：React 开发模式 + 未压缩 CSS/JS，渲染成本高于生产包；绝对值不能当生产基线，**改前/改后同条件对比**才是结论。
3. **合成内容**：三档 fixture 是刻意的分布（dense 档不代表平均回答）；真实回答成本落在 realistic 与 stress 之间时参数收益更小。
4. **CPU 抖动 + app 状态**：流式计时受机器负载/打开 tab 数影响大（同参数 maxGap 可有 ±30% 以上波动）⇒ `--repeat` 默认 **5** 取中位数、表内保留范围；JSON 的 `appState` 必须一起看，**跨会话绝对值不可比**。
5. **依赖既有配置**：需要 dev 实例在跑且库里有一条 loopback provider（一次性配置，见 §2.1）；不适合 CI 快跑。
6. **只量「可见更新」**：不含用户感知的滚动跟随/自动贴底、不含会话落库与输入框状态；也没有做视觉回归。
7. 早期单次 JSON（`before-*`/`after-*`）未记录 `dense` 字段（脚本已补 `fixture.dense`），以 label 与命令区分为准。
8. **deltas 口径（已修）**：旧版只数 `runAiChat` 的 onDelta；主线程被渲染阻塞时 resolve 之后仍有排队 IPC 事件，实测只计到 117–142/150。现在 `deltaEvents` 独立订阅 `native.onAiStream` 计数，并在 resolve 后 drain 150ms 收迟到事件；迟到事件**不计入**可见更新窗口（生产上不会再应用），单独记为 `deltaEventsAfterResolve`。
9. **finalFlushMs 可能为负（已标注）**：DOM 可见帧由 rAF 采样，可能早于 resolve 的计时采样点；`finalFlushMs` 已 clamp≥0，同时保留 `finalFlushRawMs`。
10. **complete 判据是长度代理**：Markdown 渲染会去掉标记符，不能直接比 `fullText` 长度；`finalComplete` = 最终 DOM 文本不短于流式期间最长可见文本。

---

## 5. 复现

```bash
# 前置：npm run dev（桌面 dev + CDP 9222）；dev 库里已有 loopback provider（本机 openai→127.0.0.1:9123/v1）
cd /path/to/lakex-local-notes

# 默认 repeat=5（中位数）、drain=150ms；输出 /tmp/ai-stream-probe/<label>.json
node scripts/ai-stream-probe.mjs --label run-realistic --chars 60000
node scripts/ai-stream-probe.mjs --label run-stress    --chars 640000
node scripts/ai-stream-probe.mjs --label run-dense     --chars 640000 --dense
# 可选：--repeat 3 / --drain-ms 150 / --timeout 200000

# 改参数后同命令再跑一遍，diff 两份 JSON 即得 before/after
```

产物（本次）：`/tmp/ai-stream-probe/{before3,after3}-{realistic,stress,dense-heavy}.json` + `summary.json`（中位数汇总）。

---

## 6. 改动文件

| 文件 | 改动 |
|---|---|
| `src/components/ui/markdown/useThrottledMarkdown.ts` | 常量 2000→300、2→1.5；注释写明依据（算法未动） |
| `src/components/ui/markdown/useThrottledMarkdown.render.test.tsx` | 6 例：合并/新上限 300/1.5×cost 档/禁用/结束当帧/卸载 |
| `scripts/ai-stream-probe.mjs`（新） | 假供应商（固定速率 SSE）+ CDP 驱动 + JSON 输出 + provider 临时切换/恢复 |
| `scripts/ai-stream-probe-harness.mjs`（新） | 页面内 harness：真实 `runAiChat`/`AiStreamingMessageBody`/`MarkdownView` + DOM 可见更新计量 |
| `scripts/ai-stream-probe-content.mjs`（新） | 合成 Markdown 生成 + 分帧（Node/页面共用） |
| `docs/AI-STREAM-PROBE.md`（新） | 本文 |
| `scripts/ai-stream-probe-harness.mjs`（261116 第二批修正） | 事件级 delta 计数（独立订阅 + drain）、longtask 观测、`finalFlushRawMs` 负值标注、`finalComplete` 长度代理 |
| `scripts/ai-stream-probe.mjs`（261116 第二批修正） | `--repeat` 默认 5、`--drain-ms`、JSON 记录 appState |

未做：不动 `src/features/ai/**` / `src/features/aiWriting/**` / `electron/**`（其它线在改）；不改 HANDOFF（由 Lead 收口时加一行指针，见文首）。