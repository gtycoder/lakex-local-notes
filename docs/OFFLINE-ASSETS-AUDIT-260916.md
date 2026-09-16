# 离线资源审计（2026-09-16）——缺口 + 冗余清理

> 背景：逆向 lake 内核那轮曾给出"思维导图/画板未完全离线"的结论，本轮用**静态抽取 + 构建产物复扫 + git 考古**重新核实。
> 结论：**画板完全没问题**（误判）；思维导图只差一个外链；真正会"功能坏掉"的是**文本绘图卡的 PlantUML**；另有 ~7MB 冗余镜像可清理。
> 本文只记录事实与证据；执行顺序见文末。相关红线：本地优先、不整体 fork 闭源内核、NGPL/许可署名。

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

### B. `public/vendor/cdn/`（3.5MB / 35 文件）→ 仅 3 个被产物引用，其余 32 个冗余（待运行时确认再删）

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

## 5. 追加：与"对齐云端语雀"的关系（2026-09-16 讨论）

本轮缺口里 **只有 P4 属于"内核资源"**；P1~P3 是 **wrapper bundle 里带的外链**（unpkg / cdn.nlark / lark-assets / mass-office），与"云端语雀 vs 我们的 lakex"本质差异无关。云端语雀的体验差异主要来自：**更新的内核构建 + 更多插件 + 服务端能力**，而非静态资源缺失。详见对话结论（浏览器抓取可行性评估）。
