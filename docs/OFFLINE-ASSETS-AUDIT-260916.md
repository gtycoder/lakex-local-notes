# 离线资源审计（2026-09-16）——缺口 + 冗余清理

> 背景：逆向 lake 内核那轮曾给出"思维导图/画板未完全离线"的结论，本轮用**静态抽取 + 构建产物复扫 + git 考古**重新核实。
> 结论：**画板完全没问题**（误判）；思维导图只差一个外链；真正会"功能坏掉"的是**文本绘图卡的 PlantUML**；另有 ~7MB 冗余镜像可清理。
> 本文只记录事实与证据；执行顺序见文末。相关红线：本地优先、不整体 fork 闭源内核、NGPL/许可署名。
>
> **260916 三端合并后对账（本分支的最新结论，覆盖本文旧判断）**：① 本文「唯一功能级缺口 PlantUML」**已由 lakex 迁移解决**（改本地 `@plantuml/core`，见 `docs/LAKEX-MIGRATION-260916.md` §4）；② `public/vendor/lakex-doc` 139 个死文件**已删除**（留 `kitchen-iconfont.js`，4.0MB→316K）；③ `public/vendor/cdn` 的 32 个**保留**——`electron/cdnRedirect.ts` 用「镜像里是否存在该文件」作为 gw 请求的运行时兜底白名单，删了会缩小离线覆盖；④ 内核已换成 `@dlient/lakex-doc-react` 源码（v1.99.0），本文第 0/5 节里的旧包名/旧 bundle 行号均已作废。

> **260926 复核（本仓 HEAD 实测）**：本页 §2 的 **P2/P3 无法按「镜像」修复** —— `__puml` 8 张里 `cdn.nlark` 1 张 200、`lark-assets-prod` 7 张全 **404**（上游已删）；`mass-office.alipay.com` **不可达（内网）**。**P4**（jsdelivr KaTeX）内核 `style.css` 自带 KaTeX 0.16.8，且 `#katex-style` 短路可能让 `kn` 载入标志永不置位 ⇒ **不改**。要补 P2/P3 只能用**本地占位图**（产品决定），不是镜像。详见 HANDOFF §3.2。

## 0. 方法与证据来源

- 内核 bundle：`vendor/npm/lakex-editor-react-component/dist/lakex-editor-react-component.es.js`（12.5MB / 33.8 万行），全量 URL 抽取 + 按 `//#region` 归类。
- 样式：同目录 `dist/style.css`（1.2MB），抽取全部 `url()` 与 `@font-face`。
- 构建期本地化：`vite.config.ts` / `vite.mobile.config.ts` 的 `lakexAlipayLocal` transform（只重写 `gw.alipayobjects.com`）。
- **产物复扫**：`dist/`（桌面）与 `dist-mobile/`（安卓）已构建产物。
- 镜像对账：`public/vendor/lakex/alipay`（195）、`public/vendor/cdn`（35）、`public/vendor/lakex-doc`（140）。
- git 考古：`git log -S` / `--diff-filter` / `ls-tree`。

关键前提：三份 CSP（DEV/PROD/MOBILE）只放行 `'self'` + `127.0.0.1:*`，**没有任何外部域** → 下列外链不是"离线才断"，而是**在线也被 CSP 拦掉**，表现为图标/缩略图缺失、PlantUML 报错。

## 1. 已经完整离线（有硬证据，不用动）

| 项 | 证据 |
|---|---|
| gw.alipayobjects.com 全部资源 | `dist`/`dist-mobile` 中 gw 引用 **0** 条；bundle JS 35 条全部被 transform 重写；style.css 177 条 `url()` 全部有本地文件；195 个镜像文件 100% 被引用 |
| KaTeX（JS + mhchem + 字体） | `lakeRuntime.ts:12-13` 本地预注入；style.css 含 20 个 `@font-face`（KaTeX_* 12 族）+ 385 处 `.katex`，字体 URL 全部落到 `/vendor/lakex/alipay` |
| CodeMirror 7.1.3 / 7.1.27 | `lakeRuntime.ts:594` + `ALIPAY_JS_REUSE` → `vendor/cdn/.../CodeMirror.js` |
| **画板（Drawnix / @plait）** | 全部随包 bundle；`dist/assets/drawnix-*.js` 无任何运行时资产外链（仅源码注释链接与 SVG 命名空间） |
| 思维导图渲染代码 + 样式 | `@xiangfa/mindmap` 整包 bundle 进内核；style.css 含 216 处 mindmap 规则 |
| Mermaid / Graphviz / Flowchart | `mermaid`、`@viz-js/viz`、`flowchart.ts` 均已 bundle |

## 2. 缺失清单（必须补）

| # | 项 | 位置 | 影响 | 修复方向 |
|---|---|---|---|---|
| P1 | **文本绘图卡 · PlantUML** | bundle `bEt()`：`import(/* @vite-ignore */ \`https://unpkg.com/@plantuml/core@\${fEt}/viz-global.js\`)` + `plantuml.js`（`fEt="1.2026.6"`） | `文本绘图卡`的 **puml 类型直接坏**（Graphviz/Mermaid/Flowchart 已 bundle，正常）。`@plantuml/core@^1.2026.6` 本就是 wrapper 声明依赖，运行时却走 unpkg | 镜像 2 个文件到 `public/vendor/` + 在 transform 里加 unpkg 重写；或改用可被打包的静态 import |
| P2 | 文本绘图预设缩略图 8 张 | `cdn.nlark.com/__puml/*.svg` ×1 + `lark-assets-prod.oss-cn-hangzhou.aliyuncs.com/__puml/*.svg` ×7（预设模板的 `src`） | 预设画廊缩略图空白 | 同上镜像 + 重写 host |
| P3 | 文本绘图卡 AI 按钮图标 | 产物 CSS：`.ne-text-diagram-action-ai{background:url(https://mass-office.alipay.com/design_kitchen/afts/img/Gb1wRJpalMUAAAAAAAAAABAADmmSAQBr/original)}` | 18px 图标缺失；transform 只重写 gw，漏此 host | 把 `mass-office.alipay.com` 纳入 CSS `url()` 重写规则 |
| P4 | 思维导图 KaTeX CSS | `@xiangfa/mindmap/dist/esm/utils/import.js` 的 `loadKatexStyle()` 注入 `https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/katex.min.css` | 被 CSP 拦；但 lakex style.css 自带 KaTeX 0.16.8 全套 CSS+本地字体，**渲染多半不受影响** | 创建编辑器前放一个本地 `#katex-style` 元素让 `@xiangfa` 短路；**先运行时确认** |
| — | 第三方 embed 卡 | everest/cn.alicdn/figma/modao/… | `frame-src` 只放行 `127.0.0.1`，在线也不可用 | **不修**：用不到、也不渲染，做不出来 |

## 3. 冗余清单（多的）——时间线与"是否真没用"

### A. `public/vendor/lakex-doc/`（4.0MB / 140 文件）→ 可确定删 139 个，只留 `kitchen-iconfont.js`

**来历**：第一代手工镜像（整站扒语雀 lakex-doc 网页包）。完整包（`doc.umd.js`/`doc.css`/`antd.css`/`react*.js`/`codemirror.js`/`katex.min.js`/`kitchen-iconfont.js` + `assets/` + `katex-fonts/`）只存在于**旧分支 `origin/main`** 的 `34752f6`（2026-07-21，"chore: establish local lake project baseline"）。

**HEAD 的 root commit 是 `61ee469`（2026-07-31，"baseline: before asset server POC"）**——重开基线时已丢掉 `doc.umd.js/doc.css/antd.css/react*`，只留 `codemirror.js + katex.min.js + kitchen-iconfont.js + assets/ + katex-fonts/`。从这一刻起 `assets/` 与 `katex-fonts/` 即成为孤儿（唯一引用者 `doc.css` 已不存在）。

| 文件 | 曾经用途 | 被替代于 | 证据 |
|---|---|---|---|
| `codemirror.js` | `index.html` 的 `<script src="/vendor/lakex-doc/codemirror.js">` | `7be8955`（2026-08-07，"fix: stabilize cards, locking, board scroll and remote images"）→ `vendor/cdn/.../7.1.3/CodeMirror.js` | 与 `vendor/cdn/render/.../7.1.27/CodeMirror.js` **sha256 相同**（`4b0b961b…`） |
| `katex.min.js` | `lakeRuntime.ts` 的 `math.KaTexURL[0]` | `80e8b76`（2026-08-18，"feat: finalize audit refactor and editor stability fixes"）→ `vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js` | 与 cdn 版 **sha256 相同**（`d4f0ea25…`） |
| `assets/`（~117）、`katex-fonts/`（20） | 被已删除的 `doc.css` 以相对路径引用（`url(09ca6e30-….svg)`、`url(katex-fonts/*.woff2)`） | `61ee469` 丢 `doc.css` 时失效 | 4 个 `.bin`（PNG/SVG）**逐字节等于** `lakex/alipay` 的 `A*G6Cz…`/`A*Stw6…`/`original`/`A*Y9PX…`；其余 svg/woff2 basename 全在 `lakex/alipay` |
| `kitchen-iconfont.js` | `window.KITCHEN_URL`（内核加载图标 sprite） | **仍在用** | `index.html:14` + `mobile.html:14`；内核 bundle 读 `window.KITCHEN_URL`；文件自包含 SVG sprite |

**"真没用"证明**：
```bash
git grep -n 'lakex-doc' HEAD -- ':!docs' ':!*.md'      # 仅 index.html:14 / mobile.html:14（kitchen）
grep -rl 'lakex-doc' dist dist-mobile                  # 仅 index.html / mobile.html（kitchen）
grep -rlE '1e138d3507744f84|b12244086060102e|b200d4e68012bbf7|bf93147ee907ac03' dist dist-mobile  # 0
```

### B. `public/vendor/cdn/`（3.5MB / 35 文件）→ 仅 3 个被产物引用，其余 32 个冗余 —— **结论：保留（运行时兜底，见顶部对账 ③）**

**来历**：`74062e3`（2026-08-02，"阶段B收尾：资源本地化+同步进度UI+dmg打包"）引入，作为"CDN 镜像 + 主进程 `onBeforeRequest` 重定向"的唯一目录。

**被架空的时刻**：`6730e8a`（2026-08-21，"feat(security): CSP 收紧（dev/prod 双 CSP）+ 全资源本地化（V5 §5.6）"）引入构建期 transform + `public/vendor/lakex/alipay`，所有 gw 字面 URL 打包时即改写到 `/vendor/lakex/alipay/<basename>`，运行时不再产生 gw 请求。

**产物里出现的 `/vendor/cdn/...` 路径（全部）**：
```
7× /vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js
4× /vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js
4× /vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js
```
→ `render/p/yuyan_v/.../7.1.27/CodeMirror.js` **未出现**（内核里该字面 URL 被 transform 映射到 `as/.../7.1.3`，见 `vite.config.ts:11`）；其余 31 个为 gw 图标/插图，与 `lakex/alipay` 重复。

> 注：`docs/TROUBLESHOOTING.md #10` 写"7.1.27 也要镜像"是**旧前提**（当时无构建期重写）。删之前建议跑一次运行时抓包，因为 `electron/cdnRedirect.ts` + `assetServer /vendor/cdn/` 兜底路径仍在。

### C. `public/vendor/lakex/alipay/`（3.0MB / 195 文件）→ 全部在用，不动

195 个 basename 全部能对上 style.css 的 177 条 `url()` + bundle 的 gw URL；产物引用 190 个（差的 6 个是 `A*…` 含 `*`，正则未匹配，实际在用）。

## 4. 执行顺序（建议）

1. **Tier 1（可确定、立即做）**：删 `public/vendor/lakex-doc/` 除 `kitchen-iconfont.js` 外的 139 个文件（≈ −3.7MB）。零运行时不确定性。
2. **补缺**：P1 PlantUML（唯一功能级）→ P2 缩略图 / P3 AI 图标 → P4 思维导图 katex（先运行时确认）。
3. **Tier 2（先验证再删）**：跑"卡片巡检"CDP 抓包（代码块/公式/思维导图/画板/文本绘图/表格/音视频/附件/bookmark），确认运行时只请求那 3 个 `/vendor/cdn/` 路径且无 404 → 删 `cdn` 其余 32 个，并评估 `cdnRedirect` 是否退役。
4. 任何删除都：`git rm` 到工作区 → 跑门禁（`tsc` / `vitest` / 桌面 + 移动 build）→ 给 diff，**不擅自提交**。

## 5. 追加：与"对齐云端语雀"的关系（2026-09-16 讨论 + 版本排查）

本轮缺口里 **只有 P4 属于"内核资源"**；P1~P3 是 **wrapper bundle 里带的外链**（unpkg / cdn.nlark / lark-assets / mass-office），与"云端语雀 vs 我们的 lakex"差异无关。云端语雀的体验差异主要来自：**内核构建 + 插件 + 服务端能力**。

### 5.1 版本排查（2026-09-16）

直接依赖**全部已是最新**（npmjs 与 registry.npmmirror.com 双查结果一致）：

| 包 | 最新 | 我们 | 备注 |
|---|---|---|---|
| `lakex-editor-react-component` | **0.1.2** | 0.1.2 | 只有 0.1.0/0.1.1/0.1.2；最后发布 2026-07-21；维护者 bencolin4 |
| `lakex-drawnix` / `-react-board` / `-react-text` | **0.1.0** | 0.1.0 | 各自只有 0.1.0；最后发布 2026-08-13 |
| `@xiangfa/mindmap` | **0.7.1** | 0.7.1 | 最后发布 2026-07-04 |
| `@alipay/lakex-doc` | 私有 | — | 公共 npm 与镜像均 404（语雀私有包） |

→ **升级我们现有依赖的路径是关闭的。**

### 5.2 新发现：`@lakex-react/*` 同源家族（MIT，作者 lakex-doc-react / xwz1116，2026-08-11~12 发布）

| 包 | 版本 | 内容 |
|---|---|---|
| `@lakex-react/core` | 0.2.1 | 组件式 wrapper（`<LakexEditor>` / `<LakexViewer>`）；导出 `Doc` / `GetDefaultEditorConfig` / `CardResizer`；**同一 lakex 内核血脉**（bundle 含 354 处 `framework/kernel/src` 路径） |
| `@lakex-react/drawing-bord` | 0.2.1 | **画板卡**，额外导出 `mindmapBoardCard` / `flowchartBoardCard` / `umlBoardCard`；含 `LakexMaterialLibrary`（素材库）/ `LakexShapeCatalog`（形状库）/ `LakexExportMenu` / `LakexBoardContextMenu` / `LakexAIBoardAssistant` |
| `@lakex-react/ai` | 0.2.1 | AI 助手卡 + 选区助手 + 代码块助手 + Lakex JSON skills（`createAIService` / `createLakexAI`，服务端可接 DeepSeek 等） |
| `@lakex-react/text-to-diagram` | 0.2.0 | Mermaid / Flowchart / PlantUML / Graphviz 卡 |

**关键判读（诚实）**：
- 内核 API 探针（`createOpenEditor` / `DefaultEditorConfig` / `virtualRendering` / `_tocSidebar` / `_virtualNode.$appear` 等计数）与我们**几乎一致** ⇒ **不是"更新的语雀内核"，而是同代内核的重构/分模块打包**；体积差异（12.5MB vs 6.4MB）来自它把卡片运行时拆成独立包。
- `drawing-bord` 底层仍是 **Drawnix / @plait**（deps：`lakex-drawnix ^0.1.0` + `@plait/* ^0.93.1`）⇒ 它是"Drawnix + 语雀式增强层（素材库/形状库/预设/AI/导出）"，**不是换画板引擎**。
- `text-to-diagram` **仍是同一份 unpkg PlantUML 动态 import**（本文 §2 的 P1 它也没修）。
- 风险：第三方、无 repository/源码仓库字段（只能 dist 反读）；`drawing-bord` 的 peerDeps 写 `@lakex-react/core ^0.1.3` 而 core 最新 0.2.1（版本范围不一致，可能需 `--legacy-peer-deps`）。
- 迁移代价：API 从 `Doc.createOpenEditor` 的**命令式**变成 `<LakexEditor>` 的**组件式**，现有集成（bookmark 降级、原生 TOC 填充、`cardData.setName`、虚拟渲染/水合、资源上传、customCard、离线本地化）都要重做 ⇒ **是一个项目，不是一次升级**。

⇒ 结论：**"对齐云端语雀"的现成候选是 `@lakex-react/drawing-bord`（画板/思维导图/流程图/UML）+ `@lakex-react/ai`**，但需要先做隔离 spike 评估。

### 5.3 决定性证据：内核几乎相同，但卡片包硬依赖 core（2026-09-16 复核）

**内核指纹（源码路径 + 行号）**：
- 两边各抽取 `[路径].ts:行号` 指纹：ours=1036 条 / core=1035 条，去行号后 **ours 410 个文件、core 409 个、common 409**；只有 ours 多一个 `plugins/input/src/render/input-observer/lib/chrome/pc.ts`。
- 对 409 个公共文件比"最大行号"：**363 个完全相同**，40 个 core>ours，6 个 core<ours。
- 两边 `dist/components/lakex/lakex.d.ts` 一字不差（都是"@alipay/lakex-doc 的 minified webpack bundle，自动生成松散类型"）。
⇒ **同一内核的两个小版本**（约 89% 文件一致），**没有证据表明 core 的内核更新或更强**（行号方向不能定新旧）。

**卡片包对 core 的依赖**（dist 文件里的 import 语句）：
- `@lakex-react/drawing-bord`：`import { CardResizer, Doc, findCardId } from "@lakex-react/core"`
- `@lakex-react/text-to-diagram`：`import { CardResizer, Doc, findCardId } from "@lakex-react/core"`
- `@lakex-react/ai`：`import { Doc, findCardId, focusCodeblock, registerLakexEditorExtension, replaceBlockWithText } from "@lakex-react/core"`

⇒ 它们是**给 `@lakex-react/core` 写的卡片包，不是能插进 `lakex-editor-react-component` 的独立插件**（`registerLakexEditorExtension` 等 API 只有 core 有）。要用它们 = **换 wrapper + 换卡片包**，是一次重构；"只改画板/导图两个依赖"不成立。

### 5.4 找到源码仓库：`Mueat/lakex-doc-react`（MIT，即我们 vendor 的上游）

- **仓库**：https://github.com/Mueat/lakex-doc-react （MIT，0 star，无 tags/releases；默认分支 `main`，最后提交 `4b068bd2c1` 2026-08-04）。
- **它就是 `lakex-editor-react-component` 的源码**：仓库 `patches/@xiangfa+mindmap+0.7.1.patch` 与我们 `vendor/npm/lakex-editor-react-component/patches/` 里的同名文件 **sha256 完全一致**（`fa6842ffc1fcb6ca935963e20712011e4abb00cb015cadc2e6b4398f418db168`）；构建脚本（`vite build && tsc -p tsconfig.build.json && node scripts/postbuild.mjs`）与 `patches/` 布局一致。
- **仓库内 package.json**：`name: @dlient/lakex-doc-react`、`version: 0.1.3`（该名字未发布到 npm）。
- **作者**：`Mueat <hugcolin@163.com>`（= npm `bencolin4`，我们 `lakex-editor-react-component` 的发布者）与 `xwz1116 <917208493@qq.com>`（= npm `@lakex-react/*` 与 `lakex-drawnix` 的发布者）；二人在同一份代码上协作。
- **关联项目**：GitHub 组织 `dlient` —— `dlient/dlient-open`（"A local-first, plugin-based desktop host for AI agents"）、`dlient/dlient-open-plugins`。
- **`@lakex-react/*` 0.2.x 不在这个仓库**：三个 0.2.x 的 `gitHead`（`a8dff6d1…`/`ff7b504e…`/`2282d9db…`）在本仓库都不存在（HTTP 422）⇒ 0.2.x 的分包 monorepo 是另一个（很可能私有的）仓库。本公开仓库是 **0.1.x 单包血脉**，正是我们 vendor 的形态。

**仓库 `src/cards/`（与画板/导图直接相关）**：
- `DrawingBoard/`：`DrawnixBoardCore.tsx`(41KB) + `DrawnixBoardCore.css`(40KB) + `LakexMaterialLibrary.tsx`(28KB，素材库) + `LakexShapeCatalog.tsx`(19KB，形状库) + `LakexExportMenu.tsx`(导出) + `LakexBoardContextMenu.tsx` + `LakexAIBoardAssistant.tsx` + `aiBoardSchema.ts`(38KB) + `materialTemplates.ts` + `DRAWNIX_NOTICE.md`(署名)。
- `MindMapCard/`：`MindMapEditor.tsx` / `MindMapViewer.tsx` / `index.ts` / `types.ts`。
- `TextToDiagram/`：`TextToDiagramCore.tsx`(26KB) / `TextToDiagramEditor.tsx` / `TextToDiagramViewer.tsx` / `TextToDiagram.css`。
- 另有 `docs/execCommand-reference.md`、`docs/lakex-json-format-skills.md`、`docs/lakex-drawing-board-json-format-skills.md`。

**提交时间线（正是我们要的画板增强）**：`feat:新增素材库功能`(2026-07-29) · `fix：画板优化，新增导出`(2026-07-29) · `feat:画板新增Ai画图功能`(2026-07-31) · `fix：按类型区分画板Ai画图`(2026-08-04)。我们的 vendor 是 0.1.2（发布 2026-07-21）⇒ **这些增强都在我们之后**。

⇒ 因此"对齐画板/思维导图"多了一条更省的路：**MIT 源码可读，直接把 `src/cards/DrawingBoard` / `MindMapCard` 里的功能按需移植进现有 `BoardCard`**，无需引入 `@lakex-react/core`、无需换 API 或重构 wrapper（注意保留 `DRAWNIX_NOTICE.md` / 上游署名）。

### 5.5 仓库里到底有没有"内核源码"？（2026-09-16 核实：没有）

**没有。** `@alipay/lakex-doc`（语雀内核）从未开源，任何人都没有它的原始源码。`Mueat/lakex-doc-react` 的 `src/components/lakex/` 里放的是**内核的编译产物 + 转换脚本**，不是源码：

| 文件 | 大小 | 是什么 |
|---|---|---|
| `doc.umd.js` | 4.47MB | 内核原始**压缩 webpack UMD 产物**（闭源 artifact） |
| `lakex.js` | 9.33MB | 由 `scripts/convert-lakex.js` **自动转换**出的 ESM 版本（脚本头写明：`// Source is @alipay/lakex-doc (v1.99.0).`） |
| `lakex.d.ts` | 344B | 自证："The framework is shipped as a minified webpack bundle without type info"（与我们 vendor 的同名文件逐字相同） |
| `LakexEditor.tsx` / `types.ts` / `icon.tsx` | — | 他们自己的 React 封装层 + 类型 + 图标 |

- 所以准确说法不是"只在外边包一层"，而是 **"内核编译产物 + 自动转 ESM 脚本 + React 封装层 + 卡片"**。
- 他们自己也只能把内核当黑盒：`docs/execCommand-reference.md` 开头写"基于 `src/components/lakex/lakex.js` 源码核对整理（框架为 ProseMirror 系，**命令经混淆**）"。
- 我们的 `vendor/npm/lakex-editor-react-component/dist/lakex-editor-react-component.es.js`（12.5MB）里就内嵌同一份转换后的内核（只有 `.d.ts` 被拆出来），被 vite 打成一个文件，所以看不到 `lakex.js`。

⇒ **能拿到的**：wrapper/卡片层 MIT 源码（含 `DrawingBoard`/`MindMapCard`/`TextToDiagram`）+ `docs/execCommand-reference.md`、`docs/lakex-json-format-skills.md`、`docs/lakex-drawing-board-json-format-skills.md`。**拿不到的**：内核源码——要"更强的内核"只能换内核包（而版本排查已确认没有更新的可用包）。

### 5.6 内核版本对比 + "整体换底层"可行性（2026-09-16，本地源码核对）

**三方内核指纹（源码路径 + 行号）结论**：

| 对比 | 公共文件 | 完全一致 | 不同 | 判断 |
|---|---|---|---|---|
| 我们 vendor ↔ 源码仓库 0.1.3 | 409 | 363 | 46 | **不同版本**（我们更旧） |
| 我们 vendor ↔ `@lakex-react/core` 0.2.1 | 409 | 363 | 46 | 同上 |
| 源码仓库 0.1.3 ↔ `@lakex-react/core` 0.2.1 | 409 | **409** | **0** | **同一内核** |

- 源码仓库（`Mueat/lakex-doc-react` @ `4b068bd2`, 2026-08-04, `@dlient/lakex-doc-react@0.1.3`）的 `src/components/lakex/lakex.js` 头部写明：`// Source is @alipay/lakex-doc (v1.99.0).` ⇒ **lakex-react 系内核 = v1.99.0**。
- 我们的 vendor 无版本标记；与它 46 个文件有差异（其中 40 个文件我们的行号更低）⇒ **我们的内核更旧**。
- `virtualRendering`(=14) / `cardLazyInit`(=2) / `createOpenEditor` 三方都有 ⇒ **虚拟渲染/卡片懒加载是内核能力，v1.99.0 未丢**。

**"大文档优化"的归属（重要）**：内核只提供 `virtualRendering` + `cardLazyInit` 开关；让它在本项目跑起来的是**应用侧代码**（`lakeRuntime.ts` 的 `setupVisibleCardHydration`/`setupTocScrollFollow`/`setupCardToolbarHoverBridge`/`resolveScrollNode`/`refreshTocSidebar`、bookmark 降级、CardErrorBoundary、KaTeX 保序注入，以及依赖内核私有字段 `_plugins`/`_tocSidebar`/`_virtualNode.$appear`/React fiber `cardData` 的一系列 hack）。⇒ **换 wrapper 不会自动带走这些**；**升级内核也要重新验证这 46 个差异文件涉及的私有字段**，否则 hack 会静默失效。

**"整体换底层 + 跟上游实时更新"的关键风险**：
- **上游已停更**：公开仓库 `pushed_at` = 2026-08-04，之后无提交；而 npm `@lakex-react/*` 0.2.x（08-11/12 发布）的 gitHead 不在该仓库 ⇒ 0.2.x 来自**另一个（很可能私有）仓库**。fork 这份源码**拿不到 0.2.x 的持续更新**。
- **工作量在集成层**：`lakeRuntime.ts`(1449 行) + `EditorTab`/`LakeEditor`/`BoardCard`/`editorCommands`/`attachmentPreviewController`/`canvasInteractionGate`/`useOutline`/资源上传/剪贴板/移动端 `src/mobile/editor/*` + 全套测试都要按新 wrapper API 重接。
- **离线化要重做**：其 bundle 同样引 `gw.alipayobjects`/`cdn.nlark`/`lark-assets-prod`/`mass-office.alipay.com`，`text-to-diagram` 同样 unpkg 动态 import PlantUML。
- 第三方个人项目、无 tag/release、0.2.x 源码不公开，长期押注风险高。

**建议（诚实）**：
- **路线 A（推荐）**：不整体重做。① **用这份 MIT 源码替换我们的 vendor 源**（同源、API 接近：它导出 `Doc` + `GetDefaultEditorConfig`，我们用的是 `Doc` + `DefaultEditorConfig`），内核随之升到 v1.99.0；② 直接使用它的 `src/cards/DrawingBoard`（素材库/形状库/导出/右键/画板 AI）+ `MindMapCard` + `TextToDiagram`；③ 保留我们的应用集成，逐点适配。收益（内核升级 + 对齐画板/导图）明确，且不押注第三方 wrapper。
- **路线 B（整体迁 `@lakex-react/core`）**：仅在能确认拿到它的持续源码/发布时再考虑；无论如何先做隔离 spike，量出"能复用/必须重写"清单再决定。

### 5.7 架构对比：lakex-react 源码强在哪、弱在哪（2026-09-16，逐文件核对）

**它强在"封装/卡片/转换管线"，不强在"内核"**：

| 维度 | 我们现状 | lakex-react 源码（0.1.3） |
|---|---|---|
| wrapper 源码 | **无**（只有 `vendor/.../dist/*.es.js` 12.5MB 产物） | 有：`src/components/lakex/LakexEditor.tsx`、`types.ts`、`configs/*`（按域拆分）、`components/*` |
| 内核原始 UMD | 无 | 有：`src/components/lakex/doc.umd.js`（4.47MB） |
| 内核转换管线 | **无**（只能对 dist 反编译） | 有：`scripts/convert-lakex.js` + `format-lakex.js` → `lakex.js`（含 ReactDOM18 `createRoot`/`unmount` shim、`defaultProps` 警告过滤） |
| 内核版本 | 旧版（46 文件差异） | **v1.99.0** |
| 卡片 | 只有我们自己的 `BoardCard`+@xiangfa | `DrawingBoard`（素材库/形状库/导出/右键/AI）、`MindMapCard`、`TextToDiagram` |
| 块级复用组件 | 自研（`setupCardToolbarHoverBridge` 等） | `BlockHoverHandle`/`BlockContextMenu`/`BlockCardSelect`/`CardResizer`/`ImageToolbar`/`BookmarkToolbar` |
| 文档 | LAKEX-CONTRACT（我们反编译总结） | README-zh 27KB + `docs/execCommand-reference.md` + 两份 JSON skills |

**它也不强在哪（诚实）**：
- **内核仍是黑盒**：`doc.umd.js` 是压缩 UMD、`lakex.js` 是自动转换产物，**没有内核源码**；改内核逻辑仍要试错（其 `execCommand-reference.md` 自述"命令经混淆"）。
- **fork 的 0.1.3 不含 0.2.x 的架构升级**：grep 确认 fork 无 `registerLakexEditorExtension`/`getLakexEditorExtensions`/`subscribeLakexEditorExtensions`；这些只在 `@lakex-react/core` 0.2.1（私有源）。fork 的 API 仍是命令式 `Doc.createOpenEditor` + config，**更接近我们现在的用法**。
- **它自己也在打同类补丁**：`LakexEditor.tsx` 里 dark/language 变更即 `destroy()` 重建、`Doc.FrameworkInfra.Locale.setLanguage`、`editor.__lakexDrawingBoardAI` 挂私有字段。
- 上游停更、0.2.x 源码不公开（见 §5.6）。

**结论**："改成 lakex-react 源"的收益集中在**封装/配置/卡片 + 内核转换管线**（把"改内核周边"从反编译+试错变成改可读源码），**不会**让"改内核内部逻辑"变容易。若目标是后者，两条路都做不到。

**A′（在 A 基础上更彻底，推荐）**：把这套 **0.1.3 源码整体作为我们 vendor 的基底**（替换现在 dist-only 的 vendor），保留我们的应用集成层（同是 `Doc.createOpenEditor` + config，改动面小）。收益=可读源码 + 转换管线 + 内核 v1.99.0 + 富卡片；代价=维护一个 fork + 回归 46 个差异文件涉及的私有字段 hack。

### 5.8 关系图（防止把"wrapper"误当"内核源码"）（2026-09-16）

```
语雀内核 @alipay/lakex-doc（闭源；公共 npm 无源码）
        │ webpack 打包
        ▼
   doc.umd.js（压缩 UMD，4.47MB）          ← 内核"产物"，不是源码
        │ scripts/convert-lakex.js（自动转 ESM + ReactDOM18 shim）
        ▼
   lakex.js（ESM，9.33MB）                  ← 内核"产物"
        │
        ├──────────────┬──────────────────────────────┐
        ▼              ▼                              ▼
  你下载的 zip      我们用的 vendor                 @lakex-react/*
  @dlient/lakex-    lakex-editor-react-           core 0.2.1（分包）
  doc-react 0.1.3   component 0.1.2                + drawing-bord / ai /
  （单包，公开源码）（bencolin4=Mueat，dist-only， text-to-diagram
                    无源码）                      （同一作者，源码不公开）
        └──────── 同一作者、同一代码库的多次发布 ────────┘
```

- **内核源码：三边都没有。** `doc.umd.js` / `lakex.js` 都是编译产物；`@alipay/lakex-doc` 从未公开源码。
- **0.1.3（你下载的 zip）与 0.2.x（`@lakex-react/*`）是同一套 wrapper + 同一内核 v1.99.0 的两种打包形态**（内核指纹 409/409 完全一致），不是"内核源码 vs 封装"的关系。
- **zip 项目不引用 `@lakex-react` npm 包**（全仓 `@lakex-react` 命中 0）；它自己就是 wrapper 包（`@dlient/lakex-doc-react`），内核来自**本地文件** `src/components/lakex/lakex.js`（`import Doc from "../../components/lakex/lakex"`）。
- **我们项目也不引用 `@lakex-react/*`**：用的是 `lakex-editor-react-component`（`file:./vendor/...`，bencolin4=Mueat，0.1.2）+ `lakex-drawnix*`（xwz1116）。
- `@lakex-react/core` 的 deps 只有 `classnames` ⇒ 内核同样是打包进去的，不依赖 zip 那个包。
