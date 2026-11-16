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

### 2.3 三档 fixture（合成内容，详见 `scripts/ai-stream-probe-content.mjs`）

| 档 | 命令 | 内容 | 说明 |
|---|---|---|---|
| realistic | `--chars 60000` | 60KB 标题/列表/代码块混合 | 接近真实长回答 |
| stress | `--chars 640000` | 640KB 同结构 | 超长回答 |
| dense-heavy | `--chars 640000 --dense` | 640KB、约 8 万条极短列表项 | 压力档：每次提交都要重建大量 DOM（冷启动一次渲染约 2.8s，流中一次提交约 1s） |

---

## 3. 数字（before = 2000/2，after = 300/1.5；同一 fixture、同一机器、各 3 次取中位数）

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

---

## 4. 告警 / 限制（读数字前必看）

1. **无真实网络**：假供应商走 loopback `http://127.0.0.1:9123`（主进程允许本机地址；真实 Key 未使用）。首帧/总耗时不含真实公网 RTT。
2. **dev 构建**：React 开发模式 + 未压缩 CSS/JS，渲染成本高于生产包；绝对值不能当生产基线，**改前/改后同条件对比**才是结论。
3. **合成内容**：三档 fixture 是刻意的分布（dense 档不代表平均回答）；真实回答成本落在 realistic 与 stress 之间时参数收益更小。
4. **CPU 抖动**：流式计时受机器负载影响大（同参数 maxGap 可有 ±30% 波动）⇒ 一律 3 次取中位数，表内保留范围。
5. **依赖既有配置**：需要 dev 实例在跑且库里有一条 loopback provider（一次性配置，见 §2.1）；不适合 CI 快跑。
6. **只量「可见更新」**：不含用户感知的滚动跟随/自动贴底、不含会话落库与输入框状态；也没有做视觉回归。
7. 早期单次 JSON（`before-*`/`after-*`）未记录 `dense` 字段（脚本已补 `fixture.dense`），以 label 与命令区分为准。

---

## 5. 复现

```bash
# 前置：npm run dev（桌面 dev + CDP 9222）；dev 库里已有 loopback provider（本机 openai→127.0.0.1:9123/v1）
cd /path/to/lakex-local-notes

# 三档 × 3 次；输出 /tmp/ai-stream-probe/<label>.json
node scripts/ai-stream-probe.mjs --label run-realistic --chars 60000  --frames 150 --frame-ms 20 --repeat 3
node scripts/ai-stream-probe.mjs --label run-stress    --chars 640000 --frames 150 --frame-ms 20 --repeat 3
node scripts/ai-stream-probe.mjs --label run-dense     --chars 640000 --frames 150 --frame-ms 20 --dense --repeat 3

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

未做：不动 `src/features/ai/**` / `src/features/aiWriting/**` / `electron/**`（其它线在改）；不改 HANDOFF（由 Lead 收口时加一行指针，见文首）。
