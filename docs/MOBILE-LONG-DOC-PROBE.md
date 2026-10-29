# 移动端长文档 DOM 探针（MOB-04 保守版）

> 261028 建立。对应审计 `docs/audit-261027/04-mobile.md` 的 MOB-04：**先量化，不切换虚拟渲染**。
> 本文只描述"怎么量 + 量什么 + 以后怎么 A/B"，**不改产品代码**；探针 = `scripts/mobile-audit/long-doc-dom.mjs`。
> ⚠️ **设备数字尚未采集**（本轮无可用模拟器，见 §6）。在拿到第一组数字之前，本文的阈值都只是"建议值"。

## 1. 问题一句话

移动端 `DocumentEditor` 恒传 `disableVirtualRendering: true`（`src/mobile/editor/DocumentEditor.tsx:185`），
于是长文档**编辑态**每次都在 DOM 里建满全文与全部卡片；桌面同一篇在编辑态走内核 `virtualRendering`
（`src/features/editor/lakeRuntime.ts:426-436, 920-928`）。要不要为此重做"文档内查找"，先要有可复现的数字。

## 2. 为什么移动端关着虚拟渲染（现状与依赖）

| 事实 | 出处 | 含义 |
| --- | --- | --- |
| 移动端文档编辑面传 `disableVirtualRendering:true` | `DocumentEditor.tsx:185` | 编辑态不下发 `virtualRendering/cardLazyInit`，全文与全部卡片进 DOM |
| 关闭的直接原因 = 自研 DOM 查找 | `src/mobile/editor/mobileFind.ts:1-11` | 查找用 `TreeWalker` 扫 `.mobile-doc-body` 的文本节点 + CSS Custom Highlight API；只有整篇在 DOM 里，命中数才完整、Range 才建得出来 |
| 滚动定位也建在 DOM 上 | `mobileFind.ts:107-114`（`scrollRangeIntoView`） | 只改容器 `scrollTop`，依赖 `Range.getBoundingClientRect()` |
| 开关**只管编辑态** | `lakeRuntime.ts:920`（`mode === "editor"`） | **只读态两端都是全量 DOM** ⇒ 关闭虚拟渲染的代价集中在"点编辑之后"，快照门禁的 `home-doc` 态量不到 |
| 关闭时不下发 `scrollNode` | `lakeRuntime.ts:916-919`；语义见 `docs/LAKEX-CONTRACT.md:125` | 以后要开虚拟渲染，**必须同时**把 `scrollNode` 指回 `.mobile-doc-body`，否则内核量错视口（TOC/定位错乱） |
| 桌面 A/B 旧数据（同一篇 15 标题文档） | `lakeRuntime.ts:430-432` | 虚拟渲染 ON：首资产 2.0–2.3s / 2 个视口资产；OFF：4.13s / 36 个资产请求 |

## 3. 探针怎么用

### 3.1 前置

只在**专用门禁实例**（AVD `lake_gate` / CDP 9336）上跑，理由与口径见 `scripts/mobile-audit/README.md`：

```bash
bash scripts/emu-cdp.sh 9336
curl -s http://127.0.0.1:9336/json/list | head -c 200   # 应看到 type=page
```

⚠️ **探针会造数据**：一篇标题固定的文档 + 200 个 1×1 PNG（`note-assets/<noteId>/probe-*.png`），
且 `saveNote` 会把该篇置 `is_dirty=1`。所以：

- **不要**在与"门禁基线采集"同一个时间窗里跑（会改变 `home-*` 态的元素数与指纹）；
- 跑过之后按 README 的口径**重烤门禁基线**；
- 探针会读 `getCloudState()`，非 `unconfigured` 时在 JSON/日志里告警（不要在配了 S3 的日常机上跑）。

### 3.2 命令

```bash
node scripts/mobile-audit/long-doc-dom.mjs 9336                        # 500 块 / 200 图（默认）
node scripts/mobile-audit/long-doc-dom.mjs 9336 --no-idle             # 与 boot-timeline.mjs 同口径
node scripts/mobile-audit/long-doc-dom.mjs 9336 --out .css-audit/long-doc/run1.json
node scripts/mobile-audit/long-doc-dom.mjs 9336 --baseline .css-audit/long-doc/run1.json
node scripts/mobile-audit/long-doc-dom.mjs --self-check               # 不连设备（CI 可用）
```

| 参数 | 说明 |
| --- | --- |
| `port` / `--port N` | CDP 端口（默认 9335；gate 实例 9336） |
| `--blocks N` | 块数（默认 500；**图片段落也算一块**） |
| `--images N` | 图片数（默认 200；不能大于 `--blocks`） |
| `--title T` | 文档标题；**按标题幂等复用**，反复跑不会堆文档 |
| `--no-idle` | reload 前注入 `requestIdleCallback = () => 0`（内核预热/后台同步不跑），与 `boot-timeline.mjs --no-idle` 同一段桩；**不允许与 --no-reload 同用** |
| `--no-reload` | 跳过 reload（快，但堆/资源计时带上上一轮） |
| `--timeout S` | 单阶段等渲染静默上限（默认 120s；200 张图在模拟器上可能要到几十秒） |
| `--allow-rewrite` | 允许正文被内核重写（**只告警不判失败**；默认严格 = 重写即 exit 1）。只在排查数据形态时用，采信数字前仍应修好 |
| `--out PATH` | 另存 JSON（父目录自动建） |
| `--baseline PATH` | 与基线对比，回归即 exit 1 |
| `--self-check` | 不连设备：校验生成器/报告形状/页内表达式语法 |

退出码：`0` 正常；`1` 采数不成立或基线回归；`2` 连不上 CDP；`3` 造数据/打开文档失败。
每条失败都有中文提示（例：`取不到 http://127.0.0.1:9336/json/list（App 起了吗？先 bash scripts/emu-cdp.sh 9336）`）。

### 3.3 采数流程（脚本内部顺序）

1. `Page.reload`（干净堆 + 干净资源计时）→ 等 `window.lakeNative` 与首页就绪；
2. `getHomeSnapshot` 按标题找文档，没有就 `createNote`（挂默认/已有笔记本）；
3. 生成正文（文本段落 + 图片卡片），写 200 个 PNG 到 `note-assets/<noteId>/`，然后 `saveNote`；
   写完先用一个 `<img>` 自证 AssetServer 真能取到（取不到直接失败，不采数）；
4. **先导航到入口、再开始计时**：首页「最近文档」卡片 → 没刷新就退回 知识库 → 笔记本 → 文档树，按标题把目标行滚进视口；
   之后才 `clearResourceTimings()` + 记 `performance.now()`，再点开文档（**导航耗时不算进 `openedMs`**）；
   打开后校验顶栏 `.mobile-topbar .toolbar__title` 的值 == 目标标题（防止点到了别的行）→ 等只读态静默；
5. 量只读态 → 清计时 → 点顶栏「编辑」→ 等编辑态静默 → 量编辑态；
6. 再等 1.5s 读回正文，与写入内容逐字节比 ⇒ `contentRewritten`（**硬门槛**，见 §3.5）；
7. 组装 JSON 打印，可选写 `--out`、与 `--baseline` 对比。

### 3.4 输出字段（每个阶段一份）

| 字段 | 含义 / 怎么用 |
| --- | --- |
| `nodes` | `document.querySelectorAll('*').length`（全页节点数）——A/B 的主指标 |
| `bodyNodes` | `.mobile-doc-body` 子树节点数（排除宿主/浮层噪声） |
| `paragraphs` / `cards` / `images` / `imagesLoaded` | `.ne-p` / `ne-card` / `img` 数量；与 `expectedBlocks` 对照可判断"渲染完没有" |
| `plainTextLength` | 内核 `getDocument("text/plain")` 的长度（经过 `window.__mobileEditor`）——文档确实被解析 |
| `openedMs` | 点击 → 渲染静默的耗时（页内 `performance.now()`，不含 CDP 往返） |
| `heapUsedMB` + `pageMetrics` | CDP `Performance.getMetrics`：`JSHeapUsedSize` 换算 MB + `Nodes/JSHeapUsedSize/LayoutCount/...` 原始值 |
| `phaseCost` | `openViewer` / `enterEditor` 两段的 `ScriptDuration/LayoutDuration/RecalcStyleDuration/TaskDuration` 增量（ms） |
| `assetRequests` / `assetUniqueUrls` / `assetBytes` | 本阶段触发的本地资产请求（`http://127.0.0.1:<assetPort>` 前缀，Resource Timing） |
| `assetFirstStartMs` / `assetLastStartMs` | 第一个/最后一个资产请求的发起时刻 |
| `findScanMs` / `findMatches` | 正文文本扫描耗时/命中数（**近似口径**：与 `MobileFindBar` 相同的 `TreeWalker` 扫描，但**不含** Range 创建与 Highlight 应用） |
| `performanceMemory` | `performance.memory`，WebView 常态为 `null`（此时只信 `heapUsedMB`） |
| `contentRewritten` + `doc.contentHeadAfterOpen` | 打开后正文是否被内核改写 |

### 3.5 口径与陷阱

- **`--no-idle` 与 `boot-timeline.mjs` 完全同口径**：它只影响"内核预热/后台同步跑不跑"，不影响探针自身造数；
  要对比"干净背景"就用它，两组必须同口径（都带或都不带）。
- **`contentRewritten=true` 时这次的数字不要采信**：正文被重写说明卡片形态/资源路径有问题（对照
  `docs/LAKE-CONTENT-WRITING.md`：媒体必须是 `<card>` 容器，裸 `<img>` 会被当远程图抓 → 失败回写 → 标脏 → 随同步上传）。
  探针已按"卡片容器 + 先写资源再保存"的顺序做，但仍以这条自检兜底。
  确需先拿到数字（例如在排查形态问题）时可加 `--allow-rewrite`：结果里 `contentRewritten` 仍为 `true`、告警照出，只是不判失败。
- **图片是 1×1 PNG**：刻意压低解码成本，让 `nodes/heap` 反映的是 DOM/卡片结构而不是图像解码。
  所以 `assetBytes` 很小，**不要**拿它当真实文档的字节量。
- **节点数含 keep-alive 视图**：首页在工作区打开时仍留在 DOM（`keep-alive`）⇒ 用 `bodyNodes` 做跨版本对比更稳。
- **`openedMs` 不含导航**：计时从"点开文档"那一下开始，前面的 知识库 → 笔记本 → 文档树 → 找行/滚动都不算。
  两组对比要同口径（都从 reload 起跑、都走同一条入口路径）；`viewer.via` 会记录实际走的是 `home-doc-card` 还是 `tree`。
- **点不到视口外的东西**：所有"按坐标点"的目标都先过"是否在视口内"的判据（滚出屏的卡片/行会点空），
  所以目录树找不到行时会滚一屏再找；仍找不到即报错（提示见退出码 3）。
- **`findScanMs` 不是产品入口耗时**：它是"同样算法扫一遍"的成本，用来判断"改成非 DOM 查找值不值"；真实入口还含输入抖动、Highlight 应用与滚动。

### 3.6 基线

首组数字采集后写 `scripts/mobile-audit/baseline/long-doc.json`（与 `mobile-snap.json` 同目录；目前**尚未生成**），之后：

```bash
node scripts/mobile-audit/long-doc-dom.mjs 9336 --out scripts/mobile-audit/baseline/long-doc.json   # 只在 gate 实例上做
node scripts/mobile-audit/long-doc-dom.mjs 9336 --baseline scripts/mobile-audit/baseline/long-doc.json
```

`--baseline` 的判据（`compareBaseline`）：`viewer.nodes`/`editor.nodes` **只许降**；
打开/进编辑/`findScanMs` 允许 +25%；堆内存允许 +15%。回归 ⇒ exit 1 并列出差值。

## 4. A/B 方案（**本任务不实施切换**）

### 4.1 目标形态

把"查找"从 DOM 上挪开，才能把 `disableVirtualRendering` 改成 `false`：

1. **文本来源**：`editor.getDocument("text/plain")`（`DocumentEditor.plainFromEditor` 已经在用，`DocumentEditor.tsx:33-42`）。
2. **偏移索引**：解析 `getDocument("text/lake")`（纯字符串）得到块序列 —— 每个块取 `data-lake-id` 与其可见文本长度，
   累加成 `全局偏移 → (块 id, 块内偏移)`。不建 DOM、不量布局，500 块量级是一次字符串扫描。
3. **定位**：命中第 k 条 ⇒ `renderer.scrollByNodeId(块 id, { position: "center" })`。
   这是**现有**的滚动定位路径（大纲/锚点跳转同一条，`src/features/editor/EditorTab.tsx:133`，`LakeEditorInstance` 已暴露 `renderer`），虚拟渲染下也有效（内核自己激活视口块）。
4. **高亮**：虚拟渲染下只有视口内的块在 DOM ⇒ 只能对"当前命中所在的块"建 Range 上 Highlight；
   其余命中靠 `n/m` 计数表达。计数来自纯文本偏移，**跨块且不受视口影响**（这正是自研 DOM 方案做不到的）。
5. **重建时机**：沿用 `MobileFindBar` 的 `revision` 依赖（正文变化 ⇒ 重建索引 + 重新计数），索引在 `contentchange` 后防抖重建。

### 4.2 必须先解决的前提（不做完不能开）

- **`scrollNode` 要恢复**：现在 `disableVirtualRendering:true` 时不下发（`lakeRuntime.ts:916-919`）；
  打开虚拟渲染必须传 `.mobile-doc-body`，否则内核按 `document.scrollingElement` 量视口 ⇒ TOC/测量错乱（`docs/LAKEX-CONTRACT.md:124-125`，`TROUBLESHOOTING #26`）。
- **内核能力核实**：`getDocument("text/plain")` 在锁定 Viewer 下可能不完整（`LakeEditorInstance` 注释已标），
  要分别实测编辑态/阅读态；阅读态本来就不虚拟化，可以维持 DOM 查找或走同一索引（二选一要在方案里写死）。
- **编辑面回归**：`edit-surface-invariants.mjs`（I1–I5）与 `keyboard-toggle.mjs`（K1–K3）必须全绿；
  `useCaretIntoView`、dock 面板、IME 收起展开都跟滚动容器强相关。
- **性能前提**：索引只在 `text/lake` 上做字符串扫描，不能在输入热路径里每键重建（防抖 + 只在查找条打开时建）。

### 4.3 A/B 怎么跑（临时改动，不提交）

1. 把 `DocumentEditor.tsx:185` 的 `disableVirtualRendering: true` 改成 `false`，**同时**把查找接到 4.1 的新实现
   （只开虚拟渲染、不换查找 = 查找功能回归，不能作为 A/B 的一组）；
2. 两组都跑本探针：

```bash
# A 组（现状：全量 DOM）——先在干净工作树上跑
node scripts/mobile-audit/long-doc-dom.mjs 9336 --no-idle --out .css-audit/long-doc/ab-full-dom.json
# B 组（临时改动：虚拟渲染 + 非 DOM 查找）——重装/热更后再跑
node scripts/mobile-audit/long-doc-dom.mjs 9336 --no-idle --out .css-audit/long-doc/ab-virtual.json
```

3. 用 `--baseline` 对拍（或直接看两份 JSON）：节点数、`openedMs`、`heapUsedMB`、`assetRequests`、`findScanMs`。
4. 两组必须同口径：同一台设备/同一个 AVD、同 `--blocks/--images`、同 `--no-idle`、都从 reload 起跑。

### 4.4 验收判据（建议值，首轮实测后写死）

| 指标 | 判据 |
| --- | --- |
| `contentRewritten` | 必须 `false`（否则两组数字都作废） |
| `viewer.paragraphs` / `editor.paragraphs` | ≥ `doc.expectedBlocks` 的 90%（没渲染完就不算数） |
| `editor.nodes` | B 组 ≤ A 组的 `30%`（虚拟渲染只留视口附近；不达标说明没真正虚拟化） |
| `editor.openedMs` | B 组 ≤ A 组 `60%`，或绝对值 ≤ `1500ms`（取较宽者） |
| `editor.heapUsedMB` | B 组 ≤ A 组 `80%` |
| `editor.assetRequests` | B 组显著更少（桌面旧数据：36 → 2；移动端首轮实测后写死） |
| `findScanMs` | B 组 ≤ A 组 `1.2×`（纯文本扫描通常更快；慢于 1.2× 说明索引设计有问题） |
| 回归门 | `--baseline` 两项 `nodes` 无回归；`edit-surface-invariants` + `keyboard-toggle` 全绿 |

### 4.5 结论怎么下

- 若 A 组数字说明"500 块/200 图在移动端编辑态可接受"（判据 = 4.4 的绝对阈值），**维持现状**，把 A 组数字当基线（"只许降"），
  不在没有用户痛点证据时重做查找（AGENTS §3#17）。
- 若 A 组明显超阈（打开/进编辑秒级、堆内存接近 WebView 上限、编辑卡顿），再按 4.1–4.3 做 B 组并过 4.4。

## 5. 与现有门禁的关系

| 装置 | 关系 |
| --- | --- |
| `boot-timeline.mjs` | 量冷启动；本探针量"文档打开"。`--no-idle` 语义与它逐字一致 |
| `mobile-kernel-perf.mjs` | 量"点开文档 → 内核内容就绪"的切换耗时（复用它的导航配方）；本探针多量节点数/堆/资产请求 |
| `check-mobile-snap.mjs`（6 态） | 只覆盖首页/设置/打开文档**只读态**，覆盖不到编辑态全量 DOM ⇒ 本探针补这个盲区 |
| `edit-surface-invariants.mjs` / `keyboard-toggle.mjs` | A/B 的必过回归（滚动容器/键盘几何） |

## 6. 尚未实测（明确声明）

- **本文件没有任何设备数字**：本轮没有可用的模拟器/设备，也没有跑 `adb`/`emu-cdp.sh`。
  所以 §4.4 的阈值是建议值，不是结论；`scripts/mobile-audit/baseline/long-doc.json` 也**尚未生成**。
- 已在无设备条件下自证的部分（`node scripts/mobile-audit/long-doc-dom.mjs --self-check`，17 项）：
  - 500 段/200 图的正文生成、图片段落全部是 `<card>` 容器、**没有裸 `<img>`**、卡片 value 可解码且字段齐全；
  - PNG 常量合法（签名 + 字节数与 `size` 一致）、降级模式不写本地路径；
  - 报告可 JSON 序列化、字段齐全；基线对比能抓到节点增长；
  - 参数校验（互斥/上限）、15 个页内表达式全部可被 JS 解析。
- 未验证（需设备）：DOM/API 选择器是否与当前构建一致、200 张图在模拟器上的水合耗时、
  以及"只读态是不是也全量"的实测值（按 `lakeRuntime.ts:920` 读代码应如此）。

## 7. 风险与边界

- 探针**不改产品代码**，也不切换虚拟渲染；它只写测试数据（一篇文档 + 200 个 PNG）。
- 探针在页内执行 `window.lakeNative` 与 Capacitor Filesystem，等价于"设备上的自动化脚本"；
  任何破坏性动作（删除文档/清资源）都不做，重复运行按标题幂等。
- 这条链路的"正确性"最终仍要设备实测背书：`contentRewritten=false` + 段落数达标 + 图片 `imagesLoaded` 接近 `images`。

## 8. 261029 · 设备 A/B 结果（结论：暂不切换）

**样本**：lake_gate（emulator-5562 / CDP 9336），`[探针] 长文档 500块/200图`（正文 212KB、200 个 1×1 PNG）。同一台设备、同一份工作树，只切换 `DocumentEditor` 的 `disableVirtualRendering`（ON 变体为临时改动，实验后已还原为 `true` 并重装 debug APK）。

| 指标（探针 JSON） | OFF（现状） | ON（临时） | 变化 |
|---|---|---|---|
| 只读态节点（`nodes`） | 4888 | 4888 | 不变（只读态两端本来就全量） |
| 编辑态节点（`nodes`） | **5552** | **2202** | **−60%** |
| 打开耗时 `openedMs` | 1953ms | 1933ms | 基本不变 |
| 进编辑墙钟 `enterEditor` | **5117ms** | **2356ms** | **−54%** |
| 进编辑 `TaskDuration` | **3351ms** | **767ms** | **−77%** |
| 进编辑 Script / Layout / Recalc | 1201 / 384 / 795ms | 242 / 63 / 214ms | 同步下降 |
| 正文重写 `contentRewritten` | false | false | 两态都未被内核重写 |

**结论：数字说明虚拟渲染确实值得切，但本轮不切**：
- 移动端关闭虚拟渲染是「自研 DOM 查找（`mobileFind.ts` TreeWalker + CSS Custom Highlight）+ Range 滚动定位」的**直接依赖**；切 ON 后视口外段落不在 DOM ⇒ 文档内查找命中数/高亮/定位都会退化（当前移动端没有内核查找面板可替代：`showToolbar:false` + disabledPlugins toolbar）。
- 切换 = 先给查找一条新路（打开查找时整篇渲染、或改用内核搜索 API），再开虚拟渲染并跑移动门禁（6 态 + 编辑面不变量 + 走查），属独立重构项；本轮只交付「可复现的 A/B 数字 + 探针修复」。
- 探针本轮修复（已落盘）：① 移动端段落是自定义元素 `<ne-p>`（无 class），`paragraphs` 同时统计 `.ne-p, ne-p`；② keep-alive 下小记/知识库两页都在 DOM ⇒ 导航改判「**可见**入口」并等它出现（原先 `exists(.nb-row)` 会误判已在知识库）。

## 9. 261029 · 终局：已切换（ON）

- 前置：查找已接内核（`MobileFindBar` → `ISearchService.onSearch` / `jumpTo`，与桌面同一逻辑），不再依赖全量 DOM。
- 正式切换：`DocumentEditor` 编辑态 `disableVirtualRendering:false`；`LakeEditor` 新增 `scrollNode` 支持（可传 getter，`resolveScrollNode` 每次测量时求值），移动端传 `() => .mobile-doc-body`。
- 新增 A/B（同一探针，已接 scrollNode）：只读 4883 节点 / 打开 1909ms（不变），编辑 **2197** 节点 / 进编辑 **2102ms**（TaskDuration 342ms）——对比 OFF 编辑 5552 / 5117ms（TaskDuration 3351ms）。
- 设备复验（lake_gate）：长文档查找 **1/300 → 2/300**（内核红/黄高亮）；`jumpTo(299)` 触发滚动（scrollTop 0→19860）且目标块被按需渲染；编辑态输入真实写入正文；滚动后卡片按需水合（4/4 img naturalWidth>0）；`edit-surface-invariants.mjs` 全 ok；移动 6 态快照重烤后 0 差异。
- 已知边界：虚拟渲染在编辑态生效（只读仍全量）；滚动定位用 `jumpTo(index)`（第二参数 truthy = 不滚动，勿传 true）；内核升级（vendored 版本）时 search 私有路径与虚拟渲染都要重验。
