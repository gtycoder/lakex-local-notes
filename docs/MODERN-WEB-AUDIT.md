# 现代 Web 写法审计（261115 · v2 全量）

> 审计范围：桌面 + 移动端的**自有 Web UI/交互层**（React/TSX/CSS/HTML），不含闭源 Lakex 内核、第三方编辑器（Univer/Drawnix/Plait）、画板/手写板/多维表领域引擎。
> 审计对象：本仓源码（`src/**` + `electron/**` + 根 `index.html`/`mobile.html`），**不含**构建产物、Android 打包资产、`scripts/**`、`docs/**`、`vendor/**`。
> 权威依据：GoogleChrome/modern-web-guidance（语料仓 `modern-web-guidance-src` @ `5e5cd33`，252 篇 guide / 38 篇带确定性规则）+ 本仓实测。
> 快照：`7e2db298`（261115）。本文只记录事实、判定与计划，不含代码改动。
> **与 v1（同日早版）的关系**：v1 的结论方向仍成立（不是「旧语言」，是「旧平台用法」），本文是 v2 全量展开——补全 252 篇语料的逐类覆盖判定、校正 v1 的若干计数、新增 10 组 v1 未覆盖的结论（含 `NativeTitleTips` 三缺口、`content-visibility` 已落地、`boot.html` 476KB、Chromium 152 实测）。差异见 §10。

## 0. 结论先行

**一句话**：代码不旧（TS 5.9 / React 18.3 / @layer / :has / content-visibility 都在用），旧的是**四个平台层**：浮层（dialog/popover/top-layer）、输入语义（IME/表单/文字缩放）、媒体与图片策略、可观测的性能让步（长任务/窗口化）。

三组数字：

| 口径 | 结果 | 说明 |
| --- | --- | --- |
| 官方 analyzer（发布版 1.0.0） | **35 findings / 33 guides / 35 rules** | 官方自述只覆盖语料约 20% |
| 官方 analyzer（源码版，52 rules） | **139 findings / 38 guides / 52 rules** | 排除 31 条构建产物后 = **108 条真实源码 findings**（D67 / M28 / E8 / 脚本 5） |
| 本轮语料覆盖判定 | **252 篇 = 命中 13 · 部分 68 · 干净 1 · 待验证 32 · 不适用 138** | 「干净」= 整篇 expectations 全部满足；口径见 §2 |

**真需要动手的 6 类（按性价比排序）**：

1. **IME 回车误提交（33 处，D20/M13）**——真实用户可见 bug，已有 10 处内联 guard 但没有共享判据，抽一个即可一次收口。P0。
2. **浮层三层能力（原生 dialog / top-layer / inert / 声明式触发）**——全仓 0 个 `<dialog>`、0 个 `popover`，29 处 `role="dialog"` 自绘；桌面模态**没有**把背景 inert（移动端首页分页才有）。P1，先试点 2–3 个。
3. **OS 文字缩放**——`<meta name="text-scale">` 0 处、字号 11 档全 px（10–24px）、固定高 449 处；大字号用户当前无路可走。P1（分两步：先 meta，再 rem 化）。
4. **Tooltip 体系**——原生 `title` 283 处（原生标签上）、aria-label 920 处、**156 行同时写两者**；`popover="hint"`/`interestfor` 0 处。触屏不可发现、读屏重复朗读。P1/P2 渐进。
5. **长列表与 INP**——`content-visibility` 已正确用在 `.tree-row`/`.outline-item`（**这点比 v1 判断更好**），但 10k 文档仍是 20 万 DOM；`scheduler.yield` 0、`useDeferredValue`/`startTransition` 0。P1（与 HANDOFF「大库观察项」同一件事）。
6. **首屏字节与主题首帧**——`electron/boot.html` **476 KB**（内联 APNG + PNG data URI），且缺 `color-scheme`；`index.html` 无 `<meta name="color-scheme">`、`:root` 无默认 `color-scheme` ⇒ 深色用户首帧闪浅色。P1（小改动，直接可见）。

**明确不该做的 8 类**（防后续会话重复立项，详见 §7）：全仓 rem 重写、原生 dialog 一次性替换 29 处、Web Components/Shadow DOM、Temporal/时区体系、Trusted Types、View Transitions 全站、字体/动效体系重构、PWA/Built-in AI/WASM/WebMCP/passkeys。

## 1. 方法与工具（可复现）

### 1.1 语料指纹

| 项 | 值 |
| --- | --- |
| 仓库 | `https://github.com/GoogleChrome/modern-web-guidance-src`（本仓 clone：`/tmp/mwg-src`） |
| commit | `5e5cd33a7738f21281e3027732bcbd58cfa82bf1`（2026-11-13） |
| guide 总数 | **252**（17 个分类目录 + `modern-web-guidance` 元目录） |
| 带确定性规则的 guide | **38**（`src/analyzing/rules/*.ts` 39 个规则文件，其中 1 个无同名 guide） |
| 发布包 | npm `modern-web-guidance@1.0.0`（bin = `skills/modern-web-guidance/modern-web.mjs`），只带 35 条规则 |
| 每篇 guide 组成 | `guide.md` + `expectations.md`（可判定的 MUST 清单）+ `demo.html`/`negative-demo.html` + `tasks/` + `grader.ts` |

> **grader 不是给我们用的**：`src/grading/run-grader.ts` 的入口是 `pnpm grade <target-dir>`，面向 guide 自带的 demo 目标目录（Playwright + 本地 target server）。它没有「审计任意应用」的开关；本仓可用的机器判据只有 `legacy-scan`。若要试点，唯一可行路径是把 grader 指向我们的**浏览器端预览**（设置 → 浏览器端，`127.0.0.1`），属未验证实验，不列入本轮结论。

### 1.2 两条扫描口径（本轮实跑，非引用 v1）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
REPO=$(cd <repo> && pwd)

# ① 发布版（35 条规则）
npx --yes modern-web-guidance@latest legacy-scan "$REPO" --json > /tmp/mwg-audit/npm-scan.json

# ② 源码版（52 条规则；需 /tmp/mwg-src 已装依赖）
node --experimental-strip-types /tmp/mwg-src/src/analyzing/cli.ts legacy-scan "$REPO" --json > /tmp/mwg-audit/src-scan.json
```

| 口径 | findings | guides | rules | 跳过 docs/tests |
| --- | ---: | ---: | ---: | ---: |
| 发布版 `npm-scan.json` | 35 | 33 | 35 | 971 |
| 源码版 `src-scan.json` | 139 | 38 | 52 | 973 |
| 源码版（排除 `dist*` / `release` / `android/**/assets`） | **108** | 34 | 46 | — |

源码版比发布版多出的 73 条全部来自 `src/analyzing/rules` 里更细的 JS 规则（`copying-array-methods` 53、`error-cause` 11、`abort-signal-timeout` 3、`promise-with-resolvers` 2、`structured-clone` 2、`complex-shapes` 2 等）。

**31 条构建产物 findings** 全部落在 `dist/`、`dist-mobile/`、`android/app/src/main/assets/public/`：它们是源码问题的副本，**不单独修**；把 `dist*`/`android` 加入扫描排除即可（§8 给命令）。

### 1.3 运行时基线（实测，不是推断）

| 端 | 内核 | 判定 |
| --- | --- | --- |
| 桌面 | Electron **44.9.3** / Chromium **152.0.7977.167** / Node 24.22.0（`app.whenReady()` 实测 `process.versions`） | 152 覆盖全部 2024–2025 Baseline：`<dialog>`、popover、anchor positioning、`interestfor`、`commandfor`、`appearance: base-select`、`field-sizing`、`light-dark()`、`scheduler.yield`、`text-wrap: pretty` |
| 移动 | Capacitor 8 / Android `minSdk 24` `compileSdk 36` / 设备 WebView（可随 Play 升级；本地 `lake_mobile` 同代 Chromium） | **必须以 feature detect 为准**：minSdk 24 允许旧 WebView，不能用「桌面 152 支持」代替 |

> 结论：**桌面端不存在「浏览器不支持」的借口**；移动端只存在「老设备 WebView」这一条，而它已经有既定做法（`typeof X !== "undefined"` / `CSS.supports`）。凡本文明写「需要 feature detect」的项，都是给移动端留的。

### 1.4 人工复核口径（本文所有计数）

- 扫描面：`src/**` + `electron/**` + 根 `index.html`/`mobile.html`，共 **1183 个** `.ts/.tsx/.css/.html`（排除 `*.test.*`）。
- 排除：`node_modules`、`dist`、`dist-electron`、`dist-mobile`、`release`、`preview`、`.css-audit`、`.impeccable`、`docs`（含 mockups）、`scripts`、`android`、`build`、`public`、`vendor`。
- 计数单位 = **命中行**（一行多次只算 1）；带 ※ 的三个数是 `.tsx` 内**出现次数**（同一行多次算多次）：`title` 283、`aria-label` 920、`role="dialog"` 29。`D` = 桌面 `src/`（不含 `src/mobile/`），`M` = `src/mobile/`，`E` = `electron/`，`O` = 根 HTML/其它。
- 静态计数是**候选**：例如 `title=` 既可能是 DOM 属性，也可能是我们自己的组件 prop（`PanelLoading title=`）。凡本文写「原生标签上的 title」都指用 `<div|span|button|...>` 标签名匹配到的 283 处；523 这个更大的数字是「所有 title= 出现」，含组件 prop，**不要混用**。
- 判「已现代」必须有正面证据（类名/属性/行号），**没证据一律记「待验证」**，不写「干净」。

### 1.5 语料覆盖面（为什么还有 32 项「待验证」）

官方 analyzer 只对 38/252 篇 guide 有确定性规则，其余 214 篇靠人判。本轮已逐类给出判定（§2），但**没有逐篇写 demo 复现**；`待验证 32` 就是「需要跑一次设备/浏览器实测或写一段 demo 才能定性」的那部分——这不是遗漏，是边界。

## 2. guide 覆盖矩阵（252 篇，本轮判定）

### 2.1 分类汇总

| 分类 | guides | 命中 | 部分 | 干净 | 待验证 | 不适用 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| accessibility | 4 | 1 | 2 | 0 | 0 | 1 |
| built-in-ai | 4 | 0 | 0 | 0 | 0 | 4 |
| css | 20 | 0 | 8 | 0 | 6 | 6 |
| forms | 27 | 3 | 5 | 0 | 2 | 17 |
| html | 11 | 1 | 1 | 0 | 0 | 9 |
| js | 6 | 1 | 0 | 0 | 1 | 4 |
| performance | 29 | 1 | 6 | 0 | 4 | 18 |
| privacy | 1 | 0 | 0 | 0 | 0 | 1 |
| pwa | 10 | 0 | 0 | 0 | 0 | 10 |
| security | 17 | 0 | 4 | 0 | 0 | 13 |
| ui-atoms | 14 | 1 | 6 | 0 | 2 | 5 |
| ui-behaviors | 45 | 2 | 12 | 0 | 8 | 23 |
| ui-components | 28 | 1 | 12 | 0 | 4 | 11 |
| user-experience | 5 | 0 | 4 | 1 | 0 | 0 |
| visual-design | 27 | 2 | 8 | 0 | 5 | 12 |
| wasm | 1 | 0 | 0 | 0 | 0 | 1 |
| webmcp | 3 | 0 | 0 | 0 | 0 | 3 |
| **合计** | **252** | **13** | **68** | **1** | **32** | **138** |

判定口径：

- **命中** = 有确定性证据表明违反了该 guide 的 MUST（多数同时被 analyzer 命中）。
- **部分** = 该能力有实现但不完整，或只在某一端/某一处成立。
- **干净** = 整篇 expectations 全部满足（本轮只有 `user-experience/content-first-noise-reduction`）。
- **待验证** = 必须实测才能判定（触控命中、200% 字号 reflow、LCP 图、键盘/返回键、grader 类）。
- **不适用** = 产品形态或技术选型决定（见 §2.3），不是「没做」。

> 为什么「干净」只有 1：这份语料是给**公开网站**写的，很多 MUST 默认「有表单/有多页/有分享/有安装」。本仓是本地优先的双端应用，用「整篇全部满足」当干净门槛，天然极少。真正有价值的信息在「命中 13 + 部分 68」。

### 2.2 命中与部分（逐篇，56 行）

> 只列有明确证据的代表行；未列出的「部分」与全部「待验证 32」按分类见 §2.1、§2.4，不逐篇复述。「不适用 138」见 §2.3 逐类理由。

| guide | 判定 | 证据（本仓实测） |
| --- | --- | --- |
| `ui-components/dialog` | 命中 | `<dialog>` **0**；`role="dialog"` **29 处 / 22 文件**；`showModal` 0 |
| `ui-behaviors/declarative-dialog-popover-control` | 命中 | `command`/`commandfor` **0**；`popovertarget` **0** |
| `ui-behaviors/interest-triggered-tooltips` | 命中 | `popover="hint"`/`interestfor` **0**；原生标签 `title=` **283** |
| `forms/ime-safe-enter-submit` | 命中 | **33**（D20/M13），见 §3.2 |
| `forms/form-fields-automatically-fit-contents` | 命中 | `AiAssistantDialog.tsx:183-188` 手写 `scrollHeight`；全仓 `field-sizing` 仅 `bitableEditor.css:414` 1 条声明 |
| `forms/branded-select-styling` | 命中 | `appearance: base-select` **0**；`Select.tsx:11` 注释仍以「原生弹层不可控」为由自研 |
| `visual-design/dark-mode` | 命中 | `<meta name="color-scheme">` **0**；`index.html` 无 `:root` 默认；`electron/boot.html:21` 只有 `prefers-color-scheme` 无 `color-scheme` |
| `visual-design/complex-shapes` | 命中 | `usheet-chrome.css` 2 处 `-webkit-mask` 无标准 `mask`（`kit.css:529` 已是标准写法） |
| `accessibility/respect-os-text-scale` | 命中 | `<meta name="text-scale">` **0**；字号 token 11 档全 px；固定 `height: Npx` **449** |
| `performance/optimize-image-priority` | 命中 | `fetchpriority` **0**；`srcset`/`image-set()` **0**；`loading="lazy"` 8、`decoding="async"` 2（`<img` 57） |
| `js/js` | 命中 | 71 条（`toSorted` 53、`cause` 11、`AbortSignal.timeout` 3、`Promise.withResolvers` 2、`structuredClone` 2） |
| `css`（总纲） | 部分 | 层序/@layer 到位；无 `@property`、无 container style queries |
| `css/selector-atrule-combinations` | 部分 | `:where()` 7、`:is()` 15；未与 `@supports`/`@container` 组合使用 |
| `css/responsive-design` | 部分 | `dvh` 14 处（移动 12）✓，但 `@container` 仅 **2 行 / 1 文件**（`panels.css:59-61`），`container-type` 1 |
| `css/size-aware-styling` | 部分 | 同上：组件级自适应仍以 viewport `@media` 为主 |
| `css/design-token-reactivity` | 部分 | 令牌体系完整（`--lake-*` + 4 主题文件），但无 `@property` 注册、无 container style queries；主题切换靠 `html[data-theme]` |
| `css/child-state-based-styling` | 部分 | 主题由 `data-theme` 类驱动（**有意设计**，见 DESIGN），未用 `:root:has()`/`light-dark()` |
| `css/style-parent-with-has` | 部分 | `aiAssistantCard.css:4` 等处 30 处 `:has()`；表单错误态无 `:user-invalid` 配套 |
| `css/css-layout` | 部分 | flex/grid 到位；anchor positioning 0，浮层翻转靠 `usePopoverPosition` 手写 |
| `html/dialog`（总纲） | 部分 | 见上：原生 dialog/popover 全缺 |
| `html/html`（总纲） | 部分 | 语义标签：`<main>` 3、`<nav>` 3、`<section>` 32、`<search>` 0；`<form>` **0** |
| `ui-components/menu` | 部分 | 自定义 `Menu`（`Overlay.tsx`）+ 键盘漫游；无 `role=menu` 的原生语义来源 |
| `ui-components/context-menu` | 部分 | `data-context-menu` + 手写外点判据（`isInsideOverlaySurface`） |
| `ui-components/navigation-drawer` | 部分 | 移动 `MobileSheet`（`role=dialog aria-modal` div）无 top-layer/返回键原生语义 |
| `ui-components/tabs` | 部分 | `tabPager`/`.ln-tabs` 自研，无 `role=tablist` 一致性保证（aria-selected 48 处） |
| `ui-components/toolbar` | 部分 | 自研工具条；`role=toolbar` 未全量 |
| `forms/slider`、`forms/switch` | 部分 | 原生 range 用 `accent-color`（`mobileBitable.css:86` 等 4 处）；switch 自绘胶囊 32×19（未用原生 `switch` 属性） |
| `ui-components/checkbox`、`ui-components/progress` | 部分 | 自绘 `.ln-check` 20×20（选中走 `status-ok`）；进度为自绘细条 |
| `ui-components/card` | 部分 | `.ln-row2` 等；无容器查询自适应 |
| `ui-atoms/position-aware-tooltips` | 命中 | 手写 `placeVertical`/`usePopoverPosition` 翻转（无 anchor positioning） |
| `ui-atoms/viewport-aware-dropdowns` | 部分 | `topMenuPosition.placeVertical` + `resolveBelowFixed` 手算夹取 |
| `ui-atoms/single-line-overflow` | 部分 | `text-overflow: ellipsis` 79 处；`-webkit-line-clamp` 6 |
| `ui-atoms/scrollability-affordance-hints` | 部分 | `useScrollFade` + `mask-image` 7 档（`kit.css:525`）——**实现比 guide 更细，但只接 2 个选择器** |
| `ui-atoms/scroll-position-aware-elements` | 部分 | 滚动监听 19 处（部分带 passive） |
| `ui-atoms/state-aware-sticky-headers` | 部分 | `position: sticky` 9 处，无「stuck」态视觉 |
| `ui-atoms/custom-list-markers` | 部分 | 目录图标/序号自绘 |
| `ui-atoms/responsive-table` | 部分 | 多维表移动版另有实现（`mobileBitable.css`） |
| `ui-behaviors/light-dismiss-a-dialog` | 部分 | 遮罩 `onMouseDown` 判 `e.target===e.currentTarget`（`Overlay.tsx:192`）——**已按 guide 的「按下起点」口径** |
| `ui-behaviors/platform-controls-dismiss-dialog` | 部分 | Esc 栈式关闭 ✓（`Overlay.tsx:103`）；Android 返回键无统一桥（移动 Sheet 各自处理） |
| `ui-behaviors/prevent-page-scroll-under-modal-dialog` | 部分 | `lib/pageScrollLock` 计数锁 ✓ |
| `ui-behaviors/animate-to-from-top-layer` | 部分 | `@starting-style` 6 处 ✓，但无 top-layer 可动 |
| `ui-behaviors/hierarchical-navigation` | 部分 | 目录树键盘漫游（`.tree-row` `content-visibility`） |
| `ui-behaviors/sortable-table` | 部分 | 多维表排序为数据排序，非表格 header 渐进增强 |
| `ui-behaviors/drag`、`drag-and-drop`、`dynamic-sort` | 部分 | 大量手写拖拽（`draggable` 14 处 + pointer 手势） |
| `ui-behaviors/swipe-to-reveal`、`swipe-to-remove` | 部分 | 移动手势（`touchstart/move` 20 处，passive 15） |
| `ui-behaviors/scroll-entry-exit-effects` | 部分 | `IntersectionObserver` 6 处（小记预览懒挂载） |
| `ui-behaviors/motion` | 部分 | 动效已收敛（`--lake-motion-` 单档 250ms `ease-out` + `reduced-motion` 20 处）✓；无 scroll-driven/View Transitions |
| `ui-behaviors/move-dom-element-without-losing-state` | 部分 | 移动分页 keep-alive 常驻（`HomePage.tsx:237` `inert` 切换）——比「移动 DOM」更稳 |
| `perf/defer-rendering-heavy-content` | 部分 | `content-visibility: auto` 已用于 `.tree-row`（`shell.css:397`）、`.outline-item`、`.ink-pages-panel__cell`，含 `contain-intrinsic-size: auto 23px` ✓；**但 10k 文档仍是 20 万 DOM**（HANDOFF §3 大库观察项） |
| `perf/break-up-long-tasks` | 部分 | `requestIdleCallback` 14 ✓、`requestAnimationFrame` 68 ✓；`scheduler.yield`/`postTask` **0** |
| `perf/efficient-background-processing` | 部分 | `IntersectionObserver` 6 + keep-alive；无 `document.visibilitychange` 全面暂停（26 处 pagehide/visibilitychange） |
| `perf/interactions-in-complex-layouts` | 部分 | `ResizeObserver` 35 ✓；`will-change` 18（移动 16，需核常驻） |
| `perf/identify-inp-causes` | 待验证 | 需 PerformanceObserver 实测（long-animation-frame） |
| `perf/lazy-load-video-and-audio` | 部分 | `<video>/<audio>` 11 处 tsx，无 `preload="none"` 统一 |
| `perf/optimize-preload-priority` | 部分 | `modulepreload` 由构建生成（20 条），无 `fetchpriority` 调优 |
| `perf/schedule-tasks-by-priority` | 待验证 | 见 `break-up-long-tasks` |
| `accessibility/accessibility`（总纲） | 部分 | 焦点环 `:focus-visible` 60 处 ✓；`outline: none` 35 处需逐一确认有替代；`aria-hidden` 282 |
| `accessibility/accessible-error-announcement` | 部分 | `role="alert"`/`aria-live` 108 处 ✓；无 `:user-invalid` 联动 |
| `accessibility/accessible-generated-content` | 部分 | `::before/::after` 图标未统一 `content: "" / aria-hidden` |
| `security/sanitize-untrusted-html` | 部分 | 4 处真实注入面全部自建转义（`core/search/snippet.ts` 全量转义）；无 DOMPurify（`dompurify` 命中均为同名 `sanitize()` 函数） |
| `security/trusted-types` | 部分 | CSP 6 处（`index.html` 注入 + `assetServer` + 恢复页）；无 Trusted Types |
| `security/validate-origins` | 部分 | `isAppOriginUrl` 比 scheme+host ✓（已按 AGENTS 修过）；无 `URL.parse` |
| `security/secure-external-subresources` | 部分 | 全本地资源（无 CDN 外链），SRI 无对象 |
| `visual-design/color` | 部分 | `forced-colors` **0**、`prefers-contrast` **0**；对比度走 `ui-metrics` 门禁 ✓ |
| `visual-design/browser-ui-theming` | 部分 | `::selection` ✓（`kernel-theme.css:140`）、`accent-color` 5 ✓、`field-sizing` 部分；`:user-invalid` 0 |
| `visual-design/typography` | 部分 | 无 `vw` 字号（好）；但 px 字号 + `text-wrap` 仅 2 处 |
| `visual-design/improve-text-layout-and-legibility` | 部分 | `text-wrap: balance/pretty` 2 处 |
| `visual-design/soft-edge-content-fade` | 部分 | `mask-image` 7 档 ✓（`kit.css`），仅 2 个接入点 |
| `visual-design/visually-stable-font-fallbacks` | 部分 | 无 `size-adjust`/`ascent-override`（本仓 0 处） |
| `user-experience/form-factor-adaptation` | 部分 | 触控 44 有**自有判据**（`mobile-walkthrough.mjs` `smallTap`）；但 `@media (pointer: coarse)` **0**，`hover:hover` **0** |
| `user-experience/natural-interactions` | 部分 | hover/active/focus 六态齐 ✓；`:active` 整卡缩放已按 261111 移除 |
| `user-experience/preference-aware-ui` | 部分 | `prefers-reduced-motion` 20 ✓；`prefers-contrast`/`prefers-reduced-transparency` 近乎 0 |
| `user-experience/guided-navigation` | 部分 | 壳层无路由（单页壳 + 分页），无 View Transitions |
| `user-experience/content-first-noise-reduction` | **干净** | 无弹窗广告/无障碍遮挡；空态与横幅克制（DESIGN「Voice & Copy」） |
| `forms/autofill-sign-in-form` | 部分 | `lockedTextCard` 已用 `current-password`/`new-password` ✓；S3/AI Key 字段 `autoComplete="off"` ✓ |
| `forms/select-menu-interaction` | 部分 | `Select` 自研（`aria-haspopup=listbox`）；无 `:user-invalid` |
| `forms/combobox`、`filterable-select` | 待验证 | 自研选择器/搜索面板是否满足 combobox 键盘语义 |
| `js/calculate-event-differentials` | 待验证 | 日期/时长格式化手写 11 处（`padStart(2,"0")`），`Intl` 仅 `textStats.ts` 1 处 |

### 2.3 不适用（138 篇）——逐类理由

| 分类 | 篇数 | 理由（一次说清，别再来问） |
| --- | ---: | --- |
| pwa | 10 | 我们是 Electron 壳 + Capacitor 壳：没有 Service Worker、没有 installable web app、没有 WCO（自定义标题栏走 `-webkit-app-region`，见 `shell.css`）、没有系统分享 Web API（走 Kotlin 插件） |
| built-in-ai | 4 | AI 走远程供应商（`core/aiProviders`），不做端侧 Prompt/Translator/Summarizer API |
| wasm | 1 | 无 C/C++ 模块；`sharp`/`unpdf` 在主进程原生侧 |
| webmcp | 3 | 无「把 App 能力暴露给浏览器内 AI Agent」的产品需求 |
| privacy | 1 | 无三方分析/广告/Cookie；数据只在本机与用户自己的 S3 |
| security | 13 | 无账号体系/passkey/邮件验证/支付；无跨域子资源（全本地）；无 WebRTC 采集 |
| forms | 17 | 无支付/地址/注册/OTP/评分/富媒体选择器；本仓只有「设置项 + 重命名 + 筛选」这类轻输入（`<form>` 0 处，无提交语义） |
| html | 9 | 无 Web Components/Shadow DOM/declarative shadow DOM/SSR 水合/location/摄像头（Kotlin 插件代劳） |
| js | 4 | 无跨时区会议、无纳秒时间戳、无多历法需求（界面固定 zh-CN）；Temporal 引入成本 >> 收益 |
| performance | 18 | 无分析埋点/A-B/流式 SSR/视频播放器/跨域字体/vendor 预取；本地资源无 CDN 协商 |
| css | 6 | masonry/scroll-driven/自定义缓动/physics easing 与 DESIGN「只保留入场与位移」冲突 |
| ui-atoms | 5 | 无轮播/pull-to-reveal/收缩头/滚动进度条/3D；「组件级明暗」（代码块）不适用 |
| ui-behaviors | 23 | 无跨文档导航/SPA 路由/parallax/scrollytelling/空间导航/物理弹簧/持久 top-layer 重挂载 |
| ui-components | 11 | 无应用菜单栏（Electron 原生菜单）、无面包屑组件、无 hovercard、无轮播、无骨架屏之外的空态组件、无媒体播放器、无持久引导 |
| visual-design | 12 | 无 WebGL/3D/画布导出/海报排版/等宽文本行/梯度边框/纹理/形状裁切（除 2 处 mask） |

### 2.4 待验证（32 篇）——要跑什么才算数

| 组 | 篇数 | 验证手段 |
| --- | ---: | --- |
| 触控命中/形态适配 | 6 | 设备 `smallTap` 走查（已有装置）+ 200%/400% 字号 reflow |
| 键盘/读屏语序 | 6 | CDP 键盘走查 + VoiceOver/TalkBack 人工（**从未做过**，PRODUCT 已声明不承诺） |
| 图文/媒体优先级 | 4 | 首屏 LCP 探针（`scripts/mobile-audit/perf-baseline.mjs` 已有） |
| combo/筛选控件语义 | 4 | 键盘 + 读屏 + `aria-expanded/activedescendant` 实测 |
| 长任务/INP | 4 | `PerformanceObserver` long-animation-frame + 10k 库实测（HANDOFF 已有大库装置） |
| 浮层层序/嵌套 | 8 | 内核 portal（`.ne-overlay-container`）× 自绘 Overlay × 移动 Sheet 三层叠加实测 |

## 3. 确定性 findings（工具口径 108 条）

### 3.1 汇总

| rule | 数量 | D | M | E | 其它 | 代表位置 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `ime-safe-enter-submit` | 33 | 20 | 13 | 0 | 0 | `TagsHomeTab.tsx:482`、`SelectionToolbar.tsx:915` |
| `js/copying-array-methods` | 53 | 41 | 7 | 4 | 1 | `core/s3v3/plan/plan.ts`(13)、`s3v3Index.ts`(6) |
| `js/error-cause` | 11 | 4 | 6 | 0 | 1 | `mobile/portable/importPortable.ts`(4) |
| `js/abort-signal-timeout` | 3 | 0 | 0 | 1 | 2 | `electron/s3Store.ts` |
| `js/promise-with-resolvers` | 2 | 0 | 0 | 2 | 0 | `electron/syncEngineController.ts` |
| `js/structured-clone` | 2 | 1 | 0 | 0 | 1 | `usheet/UniverSheetEditor.tsx:67` |
| `complex-shapes` | 2 | 0 | 2 | 0 | 0 | `mobile/usheet/usheet-chrome.css`(2) |
| `dark-mode` | 1 | 0 | 0 | 1 | 0 | `electron/boot.html:21` |
| `form-fields-automatically-fit-contents` | 1 | 1 | 0 | 0 | 0 | `features/ai/AiAssistantDialog.tsx:183` |
| **合计** | **108** | **67** | **28** | **8** | **5** | — |

### 3.2 IME-safe Enter（33 处，P0）

完整清单（`file:line`，桌面 20 / 移动 13）：

```text
桌面（D20）
src/components/app/BatchTagDialog.tsx:69
src/components/app/settings/sections/MaintenanceSection.tsx:76
src/components/app/SettingsPanel.tsx:35
src/components/app/sidebar/TreeRowFace.tsx:23
src/components/ui/InlineRenameInput.tsx:122
src/features/bitable/bitableCells.tsx:171 / 683 / 1070
src/features/bitable/BitableEditor.tsx:798 / 1435
src/features/bitable/BitableKanbanView.tsx:150
src/features/editor/AssetRenameDialog.tsx:41
src/features/editor/lockedTextCard.tsx:265 / 281
src/features/editor/selectionToolbar/SelectionToolbar.tsx:915 / 917 / 929
src/features/ink/InkPageTabForm.tsx:51
src/features/quickNotes/QuickNotesWorkspace.tsx:390
src/features/quickNotes/QuickNoteTagPicker.tsx:87
移动（M13）
src/mobile/ai/MobileAiPage.tsx:317
src/mobile/bitable/MobileBitableFieldSheet.tsx:88
src/mobile/bitable/MobileBitableRecordSheet.tsx:83 / 144
src/mobile/bitable/MobileBitableTableActions.tsx:62
src/mobile/bitable/MobileBitableViewActions.tsx:63
src/mobile/bitable/MobileBitableViewer.tsx:519
src/mobile/editor/MobileFindBar.tsx:113
src/mobile/settings/CreateNotebookSheet.tsx:63
src/mobile/settings/SearchSheet.tsx:139
src/mobile/tags/TagsHomeTab.tsx:482 / 506
src/mobile/ui/NameSheet.tsx:65
```

**关键新证据（v1 没有）**：全仓**已经有 10 处**内联 `isComposing` guard（`BitableEditor.tsx:695`、`bitableEditorModel.tsx:53`、`useAiConversation.ts:221`、`AiComposer.tsx:115`、`Overlay.tsx:103`、`settingsPrimitives.tsx:164`、`QuickNotesVirtualList.tsx:66`、`mobile/ui/settingsPrimitives.tsx:180`、`usePadShortcuts.ts:58`、`useWindowShortcuts.ts:16`），**但没有共享判据**（`grep isImeComposing` = 0）。⇒ 修复不是「33 个新逻辑」，而是「抽 1 个 `isImeConfirming(event)` + 33 处替换 + 合成 Composition 测试」。

现代写法（guide 原文口径 + 本仓既有惯例）：

```ts
/** 单一来源：src/core/ime.ts（新增） */
export function isImeConfirming(e: { isComposing?: boolean; keyCode?: number }): boolean {
  // keyCode 229 仅兼容旧 Android WebView；桌面 Chromium 152 只需 isComposing
  return Boolean(e.isComposing) || e.keyCode === 229;
}
```

要点（keep/drop 判据）：保留 `Shift+Enter`（textarea 换行）；**不要**用 `keyCode === 13` 替代（官方明确说旧 keyCode 13 本来就不受 IME 影响，迁到 `event.key` 才需要 guard）；`<input type="number">`（SelectionToolbar 的宽/高）同样要 guard。

### 3.3 JS 现代 API（71 条，P3）

| rule | 数量 | 现代写法 | 本轮判定 |
| --- | ---: | --- | --- |
| `copying-array-methods` | 53 | `[...a].sort()`→`a.toSorted()`、`reverse`→`toReversed`、反向查找→`findLast` | **顺手做**：集中在 `core/s3v3/**`（纯函数、有测试），一次一批，别全仓机械替换 |
| `error-cause` | 11 | `new Error(msg, { cause })` | 值得做：移动端导入/便携包链路（`importPortable.ts` 4 处）报错会丢原始 cause |
| `abort-signal-timeout` | 3 | `AbortSignal.timeout(ms)` | 值得做：`electron/s3Store.ts` 手写 controller+setTimeout |
| `promise-with-resolvers` | 2 | `Promise.withResolvers()` | 可做：`syncEngineController.ts` |
| `structured-clone` | 2 | `structuredClone(x)` | 做（`UniverSheetEditor.tsx:67` 的 JSON 深拷贝有丢类型风险） |

不做的：`Object.groupBy`/`URL.parse`/`Array.fromAsync` 等「为了新而新」的替换（无收益，且老 WebView 要兜底）。

### 3.4 CSS / 表单（5 条）

- `complex-shapes`（2，M）：`src/mobile/usheet/usheet-chrome.css` 的 `-webkit-mask` 后补标准 `mask`/`mask-image`（**保留前缀**，Android 老 WebView 仍需）。
- `dark-mode`（1，E）：`electron/boot.html` 补 `color-scheme: light dark`（或 `:root{color-scheme:light dark}`），与恢复页 `startupRecovery.ts:394` 的写法对齐（**全仓最现代的一页就是恢复页**）。
- `form-fields-automatically-fit-contents`（1，D）：`AiAssistantDialog.tsx` 的 `scrollHeight` 自增高改 `field-sizing: content` + `max-height`；保留「到上限后自己滚动」。

### 3.5 构建产物里的 31 条（不修，只排除）

`dist/`、`dist-mobile/`、`android/app/src/main/assets/public/` 是源码的压缩副本；它们的 findings 与源码 1:1（`ime 33` 里有一部分同时出现在构建产物）。**不要把「扫描清零」当目标去改产物**——改源码、重构建即可。扫描时排除：

```bash
node --experimental-strip-types /tmp/mwg-src/src/analyzing/cli.ts legacy-scan src electron --json
```

## 4. 规则未覆盖：手工 findings（本轮新增/深化）

> 本节所有计数来自 §1.4 口径；每条给「证据 → 官方期望 → 判定（做/不做/待验证）」。

### 4.1 浮层：全仓没有一个原生 `<dialog>`（P1，最大一块）

**证据（本轮实测）**

| 能力 | 计数 | 位置 |
| --- | ---: | --- |
| `<dialog` | **0** | — |
| `showModal()` / `showPopover()` | **0 / 0** | — |
| `popover=` / `popovertarget` | 0 / 0 | — |
| `::backdrop` / `:modal` / `:popover-open` | 0 / 0 / 0 | — |
| `role="dialog"` 自绘表面 | **29 处 / 22 文件** | `Overlay.tsx:197`、`MobileSheet.tsx:115`、`ImageLightbox`、`AttachmentPreview`、`InkPagesPanel`、`bitableEditorModel` 等 |
| `aria-modal` | 15 | 与 29 处 `role=dialog` **不匹配**（14 处非模态） |
| `createPortal` | 15 / 6 文件 | 收敛在 `Overlay.tsx`（好事） |
| `inert` 真实写入 | 6（移动 6 / 桌面 0） | `HomePage.tsx:239-243`、`useRouteTransition.ts:103` |

`Overlay.tsx` 自建了一整套：Tab 焦点圈闭（180–187）、Esc 栈（38、103）、外点关闭（`isInsideOverlaySurface`，30–34）、滚动锁（`lockPageScroll`）、`tabIndex={-1}` 表面、`data-context-menu` 嵌套豁免。**这套实现的质量不低**——问题是它把浏览器已经免费给的东西自己实现了一遍，且缺两件：

- **背景不可聚焦**：`role="dialog"` + `aria-modal` 只是「声明」，不会让外层 DOM 失去可聚焦性；`showModal()` 才会（顶层 + inert + `:modal`）。桌面模态打开时背景仍可 Tab 进去（移动端首页分页反而做对了，用了 `inert`）。
- **层序靠 z-index**：没有 top-layer，所以内核 portal（`.ne-overlay-container`）、我们自己的 scrim、tooltip 三套层序要靠令牌带维护（这也是「嵌套浮层点了没反应」这类事故的结构性来源）。

**官方期望**（`ui-components/dialog` expectations，原文摘要）：模态必须 `<dialog>` + `showModal()`（或 `command="show-modal"`），`:modal` 匹配、焦点回归触发元素、Esc 关闭、`closedby="none"` 保护未保存、**`<dialog>` 不得再加 `role="dialog"`/`aria-modal`**、模态打开时背景不可聚焦、背板滚动不得穿透。

**判定**：做，但**不一次性替换 29 处**。三步：

1. **新代码**：新增确认框/提示框直接用 `<dialog>`（`Overlay` 保留给「点锚定菜单/气泡」）。
2. **试点 2–3 处**：`NamePromptDialog` / 删除确认 / `InlineRenameInput` 的父容器。验证清单（缺一不可）：焦点回归、嵌套（对话框里开 `Select` 菜单）、滚动锁与 `::backdrop`、内核浮层与移动 Sheet 的层序、`stylesnap`/`mobile-snap` 基线是否需要重烤。
3. **成功后再迁**：`Popover`/`Menu` → `popover` 属性（**菜单不是 dialog**，guide 明确区分）；`MobileSheet` → `<dialog>` + Android 返回键（`platform-controls-dismiss-dialog`）。

**已知坑（本仓踩过，迁移必须带着）**：`transform`/`will-change` 祖先会把 `fixed` 与 backdrop 的包含块改成自己（AGENTS §7 壳层）；内核浮层 portal 到 `body`，只能用 body 级选择器覆盖（`body.lake-mobile`）；`data-context-menu` 豁免是修「子菜单点击被父菜单先卸载」的补丁，迁到 `popover` 后由 light dismiss 语义取代，别顺手删。

**成本**：试点 ≈ 0.5 天；全量 29 处 ≈ 3–5 天 + 一次基线重烤。**收益**：a11y 正确性（背景 inert）、层序结构简化、少一个焦点圈闭实现。

### 4.2 声明式触发（`command`/`commandfor`）：0 处（P2，与 4.1 同批）

- 现状：所有开关都靠 `onClick={() => setOpen(true)}`。
- 官方期望（`declarative-dialog-popover-control`）：`<button command="show-modal" commandfor="id">`、`toggle-popover`、`show-popover`/`hide-popover`；form 内必须 `type="button"`；feature detect `"commandForElement" in HTMLButtonElement.prototype`。
- 判定：**跟随 4.1 一起做**（有 `<dialog>` 才有意义）。Chromium 152 原生支持，无需 polyfill；移动端老 WebView 加 feature detect 回退到 `onClick`。

### 4.3 Tooltip / `title`：有全局拦截器，但移动端完全没有（P1/P2，v1 判断需修正）

**证据**

| 项 | 计数 |
| --- | ---: |
| 原生标签上的 `title=` | **283** |
| 所有 `title=` 出现（含组件 prop） | 523 |
| `aria-label` | 920 |
| 同一行同时有 `title` 与 `aria-label` | **156** |
| `popover="hint"` / `interestfor` | 0 / 0 |
| `aria-describedby` | 12 |

**关键事实（v1 漏了）**：`src/components/ui/NativeTitleTips.tsx` 是**全仓唯一的 title → 自绘 `.ln-tip` 拦截器**（350ms 延时、悬停/焦点都触发、下方放不下翻上方、长文本自动宽版）。它比「283 处裸 title」好得多，但也带来三个新问题：

1. **只在桌面挂载**（`App.tsx:1039`）。移动端 `MobileApp` 没有它 ⇒ 移动端 96 处 `title` 是**永远不出现的死属性**（触屏既无 hover，WebView 也不会画系统 tooltip）。
2. **焦点即摘除 `title`**：`focusin` 也会走 `onOver` → `el.removeAttribute("title")`（77 行）。对**只有 `title`、没有 `aria-label`** 的元素，这会把无障碍描述当场摘掉（读屏读到的是一个没有描述的元素）；对 156 处双写元素没问题，对「只写 title」的那部分是真回归。
3. **tooltip 没有与触发器建立程序化关联**：`.ln-tip` 有 `role="tooltip"`，但触发器上没有 `aria-describedby`，读屏永远读不到这段补充信息。

**官方期望**（`interest-triggered-tooltips`）：触发器必须是 `<button>`/`<a>`；`interestfor=id` + `popover="hint"`；CSS Anchor Positioning 定位 + `position-try-fallbacks` 做翻边；无支持时按需加载 polyfill；内容必须在 DOM 里而不是 `content` 伪元素。

**判定**：

- **不重写 283 处**（拦截器这条路是对的，符合「同一交互语义只有一套实现」）。
- 修 3 件事：① 移动端也挂 `NativeTitleTips`（或改用 `interestfor`，Chromium 152 原生；老 WebView 保留现状）；② `removeAttribute` 前先判断「该元素是否有别的可访问名」，没有就**保留 title**（或把文本写进 `aria-label` 再摘）；③ 给 tooltip 加 `aria-describedby`（tip id 每次唯一 → 改成每个锚点一个 `<span id>` 不现实，可直接用 `aria-describedby` 指向 `TIP_ID` 并保证同一时刻只显示一条 —— 与现状「单例 tip」恰好兼容）。
- **P3 机会**：用 `popover="hint"` + `interestfor` + anchor positioning 替换手写定位（同时解决「提示被 `overflow:hidden` 裁掉」，top-layer 不再受祖先裁剪）。

### 4.4 表单与输入：没有 `<form>`，输入元数据基本靠默认（P2）

| 项 | 计数 | 判定 |
| --- | ---: | --- |
| `<form>` / `requestSubmit` / `:user-invalid` | **0 / 0 / 0** | 可接受（无提交语义、全即时保存），但 Enter 语义只能自己实现 → 就是 §3.2 的 33 处 |
| `<input>` | 81（桌面 55 / 移动 26） | — |
| checkbox/radio | 64 | 自绘 `.ln-check` + 5 处原生 `accent-color` |
| `<select>` | 3 | 其余自研 `Select`（见下） |
| `inputMode` | 12 | ✓（数字/URL 已设） |
| `enterKeyHint` | **1**（`MobileFindBar.tsx:107`） | **缺**：搜索、重命名、新建的键盘回车键仍是默认「换行」 |
| `autoComplete` | 6（`lockedTextCard` 3 处正确、AI/S3 关） | ✓ |
| `field-sizing` | 1 处声明（`bitableEditor.css:414`）+ 1 处 JS 自增高（`AiAssistantDialog`） | 部分 |

**判定**：不做「引入 form 体系」（违反 KISS，且会与即时保存冲突）；只做三件小事：① 移动端搜索/重命名 `enterKeyHint="search"`/`"done"`；② `field-sizing: content`（§3.4）；③ bitable 表单校验用 `:user-invalid`（当前完全没有，校验提示全是手写状态）。

**自研 Select 的理由已经过期**：`Select.tsx:11` 写着「原生 `<select>` 的弹层由 Chromium/OS 绘制，应用完全无法控制」。这在 **`appearance: base-select` + `::picker(select)`**（Chromium 135+，我们桌面 152）之后不成立了：弹层虽然仍由浏览器绘制，但**可以被设计系统完全接管**（`::picker(select)`、`::picker-icon`、`option::checkmark`、`<selectedcontent>`）。
判定：**P2 试点 1 处**（设置页某个纯选项下拉），不是全量替换 —— 自研 Select 已经承载了 `useScrollFade`、键盘漫游、`useSettingField` 无障碍等 3 年积累，替换要按组件逐个评估；移动端老 WebView 需 feature detect。

### 4.5 OS 文字缩放：完全没接（P1，无障碍最大缺口）

**证据**：`<meta name="text-scale">` **0**；字号 token **11 档、全部 px**（10/11/12/13/14/15/15.5/16/18/20/24，`themes/base.css:96-106`）；固定 `height: Npx` **449**（D264 / M180 / E4）；`line-height` 令牌是 unitless ✓（8 条）。

**官方期望**（`respect-os-text-scale`）：必须 `<meta name="text-scale" content="scale">`；字号用 `rem/em`；行高 unitless；200% 字号 + 320px 宽下不得丢内容/双向滚动；含文字的容器不得用固定高或限制性 `max-height` 造成裁切。

**判定**：分两步，**不要一次全仓 rem 化**（会同时打穿 449 处固定高、工具栏、表格行高与 42 态 + 10 态视觉基线）：

1. **第一步（半天）**：加 `<meta name="text-scale" content="scale">`（`index.html` + `mobile.html`），并在 `:root` 上把「阅读类」字号 token 改 `rem`（`--lake-font-size-body/bodyMd/bodyLg/preview/title/display/h1`），chrome 类（nano/micro/tiny/small）保持 px。同步 `ui-metrics` 的字号字面量门禁正则（否则红）。
2. **第二步（按面板推进）**：含文字的行/卡片把 `height` 改 `min-height`；在 200% 字号下逐屏走查（桌面 42 态 + 移动 10 态需重烤）。
3. **不做**：覆盖 root font-size（guide 明确禁止）、把字号换成 `vw/clamp`（桌面应用不需要流式排版）。

### 4.6 图片 / 媒体 / 首屏字节（P2，收益集中在小记与启动）

| 项 | 计数 | 判定 |
| --- | ---: | --- |
| `<img` | 57（tsx 23 / electron 生成 HTML 14 / 其它 20） | — |
| `loading="lazy"` | 8 | 缺：小记卡片封面/预览、历史孤儿预览 |
| `decoding="async"` | 2 | 缺 |
| `fetchpriority` | **0** | 缺（本地资产，只有首屏图值得） |
| `srcset` / `image-set()` | 0 / 0 | **不做**：本地资产已按 `?w=1024` 单档缩略（AGENTS §4 图片缩略口径），多密度收益低于风险 |
| 比例盒（`imageBoxAttrs`） | 7 处（`QuickNotePreview`/`quickNoteImage`/HomePage） | ✓ 已防 CLS；其余 `<img>` 靠 `aspect-ratio`/`.ln-imgfill` |
| `aspect-ratio` 声明 | 13 | ✓ |

**首屏字节（本轮新发现）**：`electron/boot.html` = **476,368 B**，里面是两张内联 data URI（`boot__anim` APNG + `boot__poster` PNG），启动页本身没有任何网络请求却背着 ~460KB 的 base64。对照 HANDOFF 261112 记录「启动动画改 CSS 后删除已无引用的 APNG/poster（约 −1MB）」——**当前这份 boot.html 仍是 APNG 版**，说明那次清理没有覆盖到这个文件（或后来回滚）。判定：P2，与 4.7 的 `color-scheme` 一起改：APNG 移出 HTML（外部文件）或改纯 CSS 动画，保留 `prefers-reduced-motion` 的静态 poster 分支。

### 4.7 CSS 现代特性矩阵（P2/P3 机会，附「已现代」证据）

| 特性 | 计数 | 判定 |
| --- | ---: | --- |
| `@container` / `container-type` | **2 / 1**（仅 `panels.css:59-61`） | P2：可复用面板（设置组、属性卡、多维表详情）用容器查询替代 viewport 判断 |
| `:has()` | 30（10 文件） | ✓ 在用在位（`aiAssistantCard.css:4` 等） |
| `:where()` / `:is()` | 7 / 15 | ✓ 层序友好 |
| `@starting-style` | 6（3 文件） | ✓ 浮层入场 |
| `clamp()` | 27 | 部分用于尺寸；**字号 0** |
| `color-mix()` | 56 | ✓ |
| `oklch()` | 0 | P3（可选，主题色相计算更直观；改动会牵动对比度门禁，本轮不建议） |
| `light-dark()` | 12（**只在** `electron/startupRecovery.ts`） | 不推广：本仓主题是「用户显式选择」的 class 体系（DESIGN 定稿），guide 也把「显式用户切换」列为允许的例外 |
| `color-scheme` | 5（4 主题文件 + 移动 2 个主题文件） | ✓ 每主题都声明了；**缺** `:root` 默认值与 `<meta>`（首帧闪浅色） |
| `@media (forced-colors)` | **0** | P2：Windows 高对比度下自绘边框/阴影会消失 |
| `@media (prefers-contrast)` | **0** | P2/P3 |
| `@media (hover:hover)` / `(pointer:coarse)` | 0 / 0 | 有意：形态判据走 JS（`pad/formFactor`）；移动端 `:hover` 规则只有 2 处，无粘滞 hover 问题 |
| `text-wrap: balance/pretty` | 2 | P2（成本极低：标题 `balance`、正文 `pretty`） |
| `font-variant-numeric: tabular-nums` | 60 | ✓ 已按 DESIGN 的 Tabular Rule 落地 |
| 独立 transform 属性（`scale`/`translate`） | 0 | P3：kit 按压用 `transform: scale()`，改成 `scale:` 可避免与其它 transform 互相覆盖（但会牵动动效门禁，随动效专项做） |
| `-webkit-mask` / 标准 `mask-image` | 2 / 11 | 只有 `usheet-chrome.css` 2 处要补标准属性（保留前缀） |
| `::-webkit-scrollbar` / `scrollbar-width`、`scrollbar-color` | 74 / 41 | 混合：滚动条自绘是**有意设计**（`nodeIcon.css:43-44` 等处成对写标准+前缀）。**不改**，但新增样式必须成对写 |
| `-webkit-overflow-scrolling` | 5 | P3：Chromium 早已无操作，可直接删（Android 老 WebView 也是 no-op） |
| `will-change` | 18（移动 16） | 需核：常驻 `will-change` 会白占显存；应只在动画期间加 |
| `content-visibility` | **3 处真实使用** + 2 处注释禁止 | ✓ 见 4.9 |
| `contain:` | 0 | 不必要（`content-visibility` 已隐含布局/绘制隔离） |
| `image-set()` | 0 | 不做（见 4.6） |
| `-webkit-line-clamp` | 6 | ✓ 标准做法（`line-clamp` 仍未全面可用） |

### 4.8 移动端视口 / 键盘 / 手势：整体已现代（保留 3 处残留）

| 项 | 计数 | 判定 |
| --- | ---: | --- |
| `dvh` / `vh` / `100vh` | 14 / 42（移动 8）/ 13（移动 2） | ✓ 全屏尺寸已用 `dvh`；移动端 2 处 `100vh` 是内核菜单夹高，可换 `dvh` |
| `visualViewport` | 14（`useKeyboard.ts` 单例 store） | ✓ 本仓最现代的移动基础设施之一（`useSyncExternalStore` 单例，见注释 261103） |
| `--mb-app-h` | 23 | ✓ 只在与视口不同时写（AGENTS §7 键盘红线） |
| `overscroll-behavior` | 24 | ✓ 面板/Sheet 已 `contain` |
| `env(safe-area-inset-*)` | 7 | ✓ |
| `touch-action` | 37 | ✓ |
| `-webkit-overflow-scrolling` | 5 | P3 删除 |
| `position: fixed` | 91 | ✓ 有 `transform` 包含块红线约束（AGENTS §7） |

### 4.9 长列表与 INP：CSS 已经做到位，差在「DOM 数量」与「让步」

**已现代（证据）**：`.tree-row`（`shell.css:397`）与 `.outline-item`（`outline.css:397`）都是 `content-visibility: auto` + `contain-intrinsic-size: auto 23px/26px`，注释里还写了实测根因（占位 28→真实 27 的 5px 跳动）。`.ink-pages-panel__cell` 同样。

**剩余**：

| 项 | 计数 | 判定 |
| --- | ---: | --- |
| 10k 文档树 DOM | 10,022 行 / 约 20.1 万节点 / renderer heap 313–317MB（HANDOFF §3 实测） | `content-visibility` 只省布局/绘制，**不省 DOM 与内存** ⇒ 真正下一步是窗口化/分页（已登记，不是本审计的新发现） |
| `scheduler.yield()` / `postTask` | **0** | P1：docx 导入、批量导出、便携包打包/解包这几条长任务可以分片让步（Chromium 152 原生） |
| `useDeferredValue` / `startTransition` | 0 / 0 | P1：10k 树搜索/筛选、标签聚合列表可用并发渲染降 INP |
| `requestIdleCallback` | 14 | ✓ |
| `requestAnimationFrame` | 68 | ✓（注意别和 4.7 的 `will-change` 常驻叠加） |
| `addEventListener` + `passive: true` | 27 | ✓ |
| `passive: false` | 6 | 需核：`MultiTabEditor.tsx:507` 等是 `wheel` 阻止默认滚动，属有意 |
| `ResizeObserver` | 35 | ✓ 优于 window resize（仍有 23 处 resize 监听，多为壳层几何，可接受） |

### 4.10 无障碍语义：缺口集中在「模态背景」与「可点 div」

| 项 | 计数 | 判定 |
| --- | ---: | --- |
| `role="dialog"` | 29（22 文件） | 见 4.1 |
| `aria-modal` | 15 | 与 29 不匹配：**14 处模态声明缺失**（或本就不该标） |
| 桌面背景 `inert` | **0** | P1：`Dialog` 打开时对 `#root` 设 `inert`（或等 `showModal` 自带的背景隔离） |
| `role="button"` | 25 | 多数带 `tabIndex={0}`（`SelectionToolbar.tsx:149`、`noteRefCard.tsx:203`）；guide 仍偏好原生 `<button>` |
| 可点 `div/span`（无 role、无 tabIndex） | **33** | P2：`HistoryPanel.tsx:332,353`、`TreeRowFace.tsx:39` 等；部分在可聚焦行内（需逐个核，不能一把改） |
| `:focus-visible` 声明 | 60 | ✓ |
| `outline: none/0` | 35 | 需核：多数应配 `:focus-visible` 的自绘环（见 `settings.css`/`aiWriting.css`），逐个确认 |
| `aria-label` / `aria-hidden` | 920 / 282 | ✓ 覆盖广；注意 `aria-hidden` 不要落在可聚焦元素上 |
| `role="alert"`/`aria-live` | 108 | ✓ 错误与状态播报 |
| `aria-expanded` / `aria-selected` / `aria-pressed` / `aria-checked` | 47 / 48 / 48 / 34 | ✓ 自绘控件的状态语义齐全 |

### 4.11 JS 现代 API：工具没覆盖的部分（P3，多数不做）

| 项 | 计数 | 判定 |
| --- | ---: | --- |
| `Intl.*` | **1**（`textStats.ts:27` `Intl.Segmenter`） | 日期/数字全手写：`padStart(2,"0")` 11 处。**不做 Intl 重写**：`08-04` 是 261112 定稿格式，换成 locale 格式会破坏快照与用户预期 |
| 相对时间手写（刚刚/分钟前） | 1（`electron/webApi/static.ts:266`） | 若移动端也要，可用 `Intl.RelativeTimeFormat`；本轮不做 |
| `structuredClone` | 2 ✓ | 已用 |
| `toSorted/reversed/with` | 1 | 见 §3.3（53 处候选） |
| `Object.groupBy` / `URL.parse` / `AbortSignal.any` | 0 / 0 / 0 | 不做（无收益，老 WebView 要兜底） |
| `crypto.randomUUID()` | 50 | ✓ 已是现代写法（无需 uuid 库） |
| `JSON.parse(JSON.stringify())` 深拷贝 | 1（`UniverSheetEditor.tsx:67`） | 做（`structuredClone`） |

### 4.12 安全面：没有洞，但两处可以顺手收紧（P3）

| 项 | 计数 | 判定 |
| --- | ---: | --- |
| CSP | 6（`index.html` `%VITE_CSP%`、`mobile.html` `%MOBILE_CSP%`、`assetServer.ts:322`、恢复页、dev 注入） | ✓ 单一来源 + 有测试卡住（`mobileCspSingleSource.test.ts`） |
| `sandbox: true` / `contextIsolation` / `nodeIntegration: false` | 4 / 5 / 4 | ✓（`main.ts:312-314`） |
| HTML 注入点 | 4 处真实注入 + 2 处注释（`quickNoteToolbarWidgets`/`kernelConfig` 用本地常量、`SearchPanel`/`SearchSheet` 只插入已转义 snippet、另 2 处为说明注释） | ✓ 无未转义外部 HTML |
| DOMPurify / Trusted Types | 0 / 0 | **不做**（无用户 HTML 渲染入口；引入 Trusted Types 会打穿内核与第三方 DOM 写入） |
| `target="_blank"` / `rel="noopener"` | 4 / 1 | P3：补 `rel="noopener noreferrer"`（`core/lakeDocForm.ts:38` 生成的外链 HTML 也要补） |

### 4.13 「已现代」清单（**不要再重写**，逐条有证据）

| 能力 | 证据 |
| --- | --- |
| CSS `@layer` 层序 + 构建兜底 | `scripts/vendorCssLayer.ts` + `cssLayers.test.ts` + `window.__cssLayerProbe()` |
| `content-visibility` + `contain-intrinsic-size` | `shell.css:397`、`outline.css:397`、`inkPad.desktop.css:210` |
| `visualViewport` 单例 + `useSyncExternalStore` | `mobile/hooks/useKeyboard.ts`（38 处 `useSyncExternalStore`） |
| `inert` 分页隔离 | `HomePage.tsx:239-243` |
| `dvh` / `overscroll-behavior` / `safe-area` / `touch-action` | 14 / 24 / 7 / 37 |
| `mask-image` 滚动渐变 + 只在有裁剪时出现 | `useScrollFade` + `kit.css:529` |
| `:focus-visible` 统一焦点环 | 60 处声明 + `vendor-focus.css` 收口第三方宿主 |
| `@starting-style` 浮层入场（不做 rAF 门控） | `dialogs.css:10` 等 6 处（DESIGN Motion 规则） |
| `prefers-reduced-motion` 统一兜底 | `a11y.css` + 20 处引用（组件不写自己的分支） |
| `accent-color` / `::selection` | 5 处 / `kernel-theme.css:140` |
| 每主题 `color-scheme` | 4 主题文件 + 移动 2 个主题文件 |
| React 现代用法 | `createRoot` 5、`React.lazy` 53、`Suspense` 103、`useSyncExternalStore` 38、`useId` 9；无 `ReactDOM.render` |
| 内核懒加载/prefetch（首屏预算） | `desktopKernelLazy.test.ts` + `kernelPrefetch.ts`（三档触发） |
| 桌面 keep-alive 分页（替代整页重建） | `faster-spa-view-transitions` 的正解，比 View Transitions 更稳 |
| 原生 `accent-color` 用于 range | `mobileBitable.css:86/257/553/807` |

## 5. 问题清单（按优先级，A01–A30）

> 优先级：P0 = 真实用户可见 bug；P1 = 该做且收益明确；P2 = 值得做但要试点；P3 = 顺手/机会。

| ID | 问题 | 端 | 优先级 | 成本 | 证据 | 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | 33 处 Enter 未做 IME guard（已有 10 处内联、无共享判据） | D/M | **P0** | 0.5 天 | §3.2 | 抽 `core/ime.ts` + 33 处替换 + Composition 测试 |
| A02 | 桌面模态不 inert 背景；29 处自绘 dialog 无 top-layer | D/M | **P1** | 试点 0.5 天 / 全量 3–5 天 | §4.1 | 试点 2–3 处原生 `<dialog>` |
| A03 | OS 文字缩放未接（0 meta、字号全 px、449 固定高） | D/M | **P1** | 2–3 天（分两步） | §4.5 | meta + 阅读类 token rem 化 |
| A04 | Tooltip：移动端无提示、focusin 摘 title、无 `aria-describedby` | D/M | **P1** | 1 天 | §4.3 | 三处小修，不重写拦截器 |
| A05 | 10k 目录树 DOM 20 万（content-visibility 已上，仍需窗口化） | D | **P1** | 3–5 天 | §4.9 | 按 HANDOFF 大库项立项 |
| A06 | 长任务无让步（`scheduler.yield` 0；`useDeferredValue` 0） | D/M | **P1** | 1–2 天 | §4.9 | 先搜索/筛选，再 docx/便携包 |
| A07 | 首帧主题闪浅色（无 meta color-scheme / 无 `:root` 默认） | D/M | **P1** | 0.5 天 | §4.7 | `index.html`/`mobile.html` 补 meta + `boot.html` 补 `color-scheme` |
| A08 | `boot.html` 476KB 内联 APNG/PNG | D | **P1** | 0.5 天 | §4.6 | 移出 HTML 或改 CSS 动画（保留 reduced-motion poster） |
| A09 | `aria-modal` 15 vs `role=dialog` 29 不一致 | D/M | P2 | 0.5 天 | §4.10 | 按「模态/非模态」逐个校准 |
| A10 | 33 处可点 div 无 role/tabIndex | D/M | P2 | 1 天 | §4.10 | 列清单，能换 `<button>` 的换 |
| A11 | (`command`/`commandfor` 0，待 A02 之后) | D | P2 | 随 A02 | §4.2 | 新 `<dialog>` 一律声明式触发 |
| A12 | `field-sizing: content` 只 1 处（AI 输入框仍 JS 自增高） | D | P2 | 0.5 天 | §3.4 | 改 CSS + 保留上限滚动 |
| A13 | 自研 `Select` 的技术前提已过期（base-select 可用） | D | P2 | 试点 0.5 天 | §4.4 | 单点试点，不全量替换 |
| A14 | `enterKeyHint` 只 1 处（搜索/重命名仍是默认键） | M | P2 | 0.5 天 | §4.4 | 搜索/重命名/新建三处 |
| A15 | 图片懒加载/解码/优先级缺失（lazy 8、decoding 2、fetchpriority 0） | D/M | P2 | 1 天 | §4.6 | 只做小记卡与预览 |
| A16 | `forced-colors`/`prefers-contrast` 0（Windows 高对比度） | D | P2 | 1 天 | §4.7 | 关键控件加 `forced-colors` 兜底 |
| A17 | 容器查询仅 1 处，组件级自适应仍看 viewport | D/M | P2 | 按组件 | §4.7 | 新组件优先 `@container` |
| A18 | `text-wrap: balance/pretty` 仅 2 处 | D | P3 | 0.2 天 | §4.7 | 标题/正文各一条 |
| A19 | `-webkit-overflow-scrolling` 5 处（no-op） | M | P3 | 0.1 天 | §4.8 | 删 |
| A20 | `will-change` 18 处（移动 16）需核常驻 | D/M | P3 | 0.5 天 | §4.7 | 只留动画期间 |
| A21 | `will-change` 之外的 JS API：`toSorted` 53 / `cause` 11 / `Promise.withResolvers` 2 / `structuredClone` 1 | D/M/E | P3 | 半天/批 | §3.3 | 按文件顺手做，不做全仓机械替换 |
| A22 | 外链缺 `rel="noopener noreferrer"`（4 处 target=_blank，1 处 noopener） | D/M | P3 | 0.2 天 | §4.12 | 补 rel |
| A23 | 手写浮层定位（无 anchor positioning / `position-try-fallbacks`） | D | P3 | 试点 1 天 | §4.1/4.3 | 仅元素锚定的气泡试点，点锚菜单保留 |
| A24 | `outline: none` 35 处需确认都有替代焦点环 | D/M | P3 | 0.5 天 | §4.10 | 逐个核（有 `:focus-visible` 的放行） |
| A25 | `-webkit-mask` 2 处缺标准属性 | M | P3 | 0.1 天 | §3.4 | 补 `mask-image`（保留前缀） |
| A26 | `dark-mode` 的 `<meta color-scheme>` 缺失（同 A07） | D/M | P2 | 并入 A07 | §3.4 | 一次改完 |
| A27 | `boot.html` 深色不跟随（只 `prefers-color-scheme`） | D | P3 | 并入 A07 | §3.4 | `color-scheme` 后系统会接管 |
| A28 | 26 处 `pagehide/visibilitychange` 与 7 处 `beforeunload` 无统一生命周期原语 | D/M | P3 | 2 天 | §4.9 | 暂不做（各有语义，合并风险大） |
| A29 | 无 `<main>`/`<search>` 等语义容器（3/0） | D/M | P3 | 0.5 天 | §4.10 | 随 A10 一起，不单独立项 |
| A30 | 日期/时长手写格式化 11 处 | D/M/E | **不做** | — | §4.11 | `08-04` 是定稿格式，换 Intl 会破坏既有预期 |

## 6. 实施顺序

### Phase 0（本周，低风险、可见收益）

1. **A01 IME**（33 处 + 共享判据 + 测试）——唯一 P0。
2. **A12 field-sizing**、**A25 `-webkit-mask` 补标准属性**、**A19 删 `-webkit-overflow-scrolling`**。
3. **A07/A26/A27 + A08**：`color-scheme` meta + `:root` 默认 + `boot.html` 补 `color-scheme`，并把 476KB APNG 移出 HTML。

验收：`tsc` + 相关 vitest + `git diff --check`；`ui-metrics`（若动 CSS）；桌面 `check-stylesnap` 只跑受影响态（启动页/对话框态），移动若无 UI 变化不跑。

### Phase 1（两周，a11y 与输入）

4. **A03 文字缩放第一步**（meta + 阅读类 token rem）+ 200%/320px 走查。
5. **A04 Tooltip 三修**（移动挂载、focusin 不摘 title、`aria-describedby`）。
6. **A09 + A10 + A24**：模态/非模态校准、33 处可点 div 清单化、`outline:none` 复核。
7. **A14 enterKeyHint**、**A15 图片懒加载/解码**（小记 + 预览）。

验收：桌面 42 态按需定点，移动改 `src/mobile/**` 必须 `android-build.sh --sync --install` 后设备点收；快照态只在动到该屏时跑并重烤基线。

### Phase 2（一个月，浮层体系试点）

8. **A02 试点 2–3 个 `<dialog>`**（焦点回归、嵌套、滚动锁、内核 portal、baseline 影响）。
9. 成功后 **A11 `command`/`commandfor`**、**A13 Select 单点试点**、**A23 anchor positioning 试点**。
10. **A05/A06**：10k 树窗口化 + `useDeferredValue`/`scheduler.yield`。

验收：每个试点单独提交、可回滚；不把「现代化」与功能改动混在一提交。

### Phase 3（长期，机会项）

11. **A16 forced-colors**、**A17 容器查询**、**A18 text-wrap**、**A20 `will-change` 收敛**、**A21 JS API 顺手批**、**A22 rel**、**A29 语义容器**。

## 7. 不做清单（后续会话不要重新立项）

| 项 | 理由 |
| --- | --- |
| 全仓字号/间距 rem 重写 | 会同时打穿 449 处固定高、2 套视觉基线与内核宿主；只做「阅读类 token + 新代码」 |
| 一次性把 29 处 `role=dialog` 换成 `<dialog>` | 每处都绑着焦点/层序/测试；只做试点 + 新代码 |
| Web Components / Shadow DOM | React 18 + 设计系统已收敛；guide 的 custom-elements 系列是给「跨框架组件分发」场景的 |
| Temporal / 时区体系 | 无跨时区会议、无纳秒时间戳、界面固定 zh-CN；引入成本与风险不成比 |
| Trusted Types | 无用户 HTML 渲染入口；会打穿内核与第三方 DOM 写入 |
| View Transitions 全站 | 桌面壳层无路由；移动分页已用 keep-alive（更稳）；只在新交互试点 |
| 原生 dialog 替代 `ImageLightbox`/`AttachmentPreview` | 这两处是内容查看器，不是模态表单；换成 dialog 会牵动键盘/滑动手势 |
| `srcset` / `image-set()` | 本地资产单档缩略已按 `?w=1024` 定稿；多密度只会增加缓存条目 |
| `oklch()` 重做主题 | 牵动 WCAG 门禁与 4 套主题令牌，收益仅「色相计算更直观」 |
| `light-dark()` 替换主题体系 | 主题是用户显式选择（guide 允许例外）；class 体系还承载「自定义 CSS」 |
| HTTP/2 | 261114 已实测慢 7–20×（HANDOFF §0），不要重开 |
| PWA / Built-in AI / WASM / WebMCP / passkeys | 产品形态不适用（§2.3） |

## 8. 复现命令（本轮实际用过的）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
REPO=$(cd <repo> && pwd)

# 1) 发布版扫描（35 规则）
npx --yes modern-web-guidance@latest legacy-scan "$REPO" --json | jq '.totalFindings,.activeGuideCount'

# 2) 源码版扫描（52 规则，需先 clone 语料仓并装依赖）
git clone --depth 1 https://github.com/GoogleChrome/modern-web-guidance-src.git /tmp/mwg-src
cd /tmp/mwg-src && pnpm install            # 只装分析器运行依赖
node --experimental-strip-types /tmp/mwg-src/src/analyzing/cli.ts legacy-scan "$REPO" --json

# 3) 只看一条规则
node --experimental-strip-types /tmp/mwg-src/src/analyzing/cli.ts legacy-scan "$REPO" --json --guide ime-safe-enter-submit

# 4) 只扫源码（排除 dist/android 产物，得 108 条）
node --experimental-strip-types /tmp/mwg-src/src/analyzing/cli.ts legacy-scan "$REPO/src" "$REPO/electron" --json

# 5) 运行时内核版本（桌面；实测 Chromium 152.0.7977.167）
cd "$REPO" && env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron -e "require('electron').app.whenReady().then(()=>{console.log(process.versions);require('electron').app.quit()})"

# 6) 设备侧（移动）：minSdk / WebView 版本以 adb 为准
adb shell getprop ro.build.version.sdk
adb shell dumpsys package com.google.android.webview | grep versionName
```

> 逐条计数脚本（§1.4 口径，1183 文件）不在仓库内——它是一次性审计工具。要复算某个数字，直接按 §1.4 的排除规则用 `grep -rn` 即可；不要为此往仓库加扫描脚本（AGENTS §3#17）。

## 9. 残余未知

1. **Android 真实 WebView 版本分布**：本审计只确认 `minSdk 24` 与本地模拟器同代（Chromium 152），没做「老设备普查」；凡本文明写 feature detect 的项（dialog/popover/commandfor/interestfor/base-select/field-sizing/anchor positioning）都必须在设备上先探测。
2. **触控 44 与 200% 字号的实测**：靠既有装置（`smallTap`/`stylesnap`/`mobile-snap`），本轮没有重跑；这些是「待验证 32」的主体。
3. **读屏**：VoiceOver/TalkBack 从未跑过（PRODUCT 已声明不承诺 WCAG），A02/A04/A10 的收益目前是「代码层正确」，不是「读屏实测通过」。
4. **grader 可用性**：`pnpm grade` 面向语料仓自带 demo；能否指向我们的浏览器端预览未验证（若成立，可把 dialog/tooltip 两篇变成可回归的自动判据）。
5. **INP 数据**：本轮只有静态证据（0 `scheduler.yield`/0 `useDeferredValue`），没有 long-animation-frame 实测；10k 库的建议顺序（先窗口化还是先并发渲染）需要一次实测决定。
6. **`boot.html` 的 APNG 是否仍被引用**：HANDOFF 记录「已删除 APNG/poster」，但文件里确实还在（476KB）。需要确认是「回滚」还是「记录与实现不一致」——本轮只报事实，不猜原因。

## 10. 变更记录

### v2（本轮，261115）

**新增**（v1 没有的结论）：

- 252 篇语料的**逐类覆盖判定**（§2）：命中 13 / 部分 68 / 干净 1 / 待验证 32 / 不适用 138 + 不适用逐类理由 + 待验证验证手段。
- **运行时内核实测**：Electron 44.9.3 / Chromium **152.0.7977.167** / Node 24.22.0（v1 写「Electron 44」，未验证 Chromium，导致「能不能用 dialog/base-select」只能定性）。
- **`NativeTitleTips` 拦截器**的存在与其三个缺口（v1 把 283 处 title 当成「裸 title」，结论方向对、根因错了）。
- **`content-visibility` 已正确用于目录树/大纲**（v1 把它列在「性能机会」，实际已落地，且带 `contain-intrinsic-size` 精确到行高）——HANDOFF 的「10k 未虚拟化」是 DOM/内存问题，不是 CSS 问题。
- **`boot.html` 476KB 内联 APNG**（v1 未测首屏字节）。
- **`:root` 无默认 `color-scheme` / 无 meta** ⇒ 首帧闪浅色（v1 只报了 boot.html 一处）。
- **`scheduler.yield`/`useDeferredValue` 全缺**（v1 只在「手工审计」里泛泛提到性能）。
- **`aria-modal` 15 vs `role=dialog` 29 不一致**；桌面背景 `inert` = 0。
- **`-webkit-overflow-scrolling` 5 处 no-op**、**`will-change` 18 处**、**`outline:none` 35 处**、**`text-wrap` 2 处**、**`@container` 仅 2 行**。
- 问题清单 30 条（A01–A30）带优先级/成本/证据；不做清单 12 项。

**校正 v1 的数字**：

| 项 | v1 | v2 实测 |
| --- | --- | --- |
| `title=` | 约 327 处 | 523 出现；**283** 在原生标签上 |
| `<form>` | 1 处 | **0** |
| `<input>` | 约 117 | 81 |
| checkbox/radio | 约 68 | 64 |
| `<img>` | 约 139 | 57 |
| `loading=lazy`/`decoding` | 约 8 | 8 / 2 |
| `@container` | 3 处 | 2 行 / 1 文件（`container-type` 1） |
| `dangerouslySetInnerHTML` | 约 6 | 6 处真实注入点 |
| 原生 `<dialog>` / popover | 0 | 0（确认，且 `role=dialog` 29 / 22 文件） |

**未变**：方向结论（不是旧语言，是旧平台用法）、Phase 0 先做 IME 的建议、不重写 React/内核/画布的边界。

### v1（同日早版）

- 首版：两条 analyzer 口径（35 / 108）、手工六类（浮层/tooltip/字体/表单/图片/滚动条）、Phase 0–3。

## 11. 实施状态（261115 起，分支 `modernize/web-platform-261115`）

> 前置：`master`（`7e2db298`）已双推 Gitee + GitHub 并打注解 tag **`backup/master-261115`**；
> 本分支**不合并回 master**，需用户明确同意后才合。下文 commit 均指本分支。

| ID | 问题 | 状态 | 落地 | 护栏 / 备注 |
| --- | --- | --- | --- | --- |
| A01 | IME 回车误提交 | **已修** | `f55bc35b` | 35 处 / 27 文件（33 analyzer + 2 人工补漏）；`src/core/ime.ts` 唯一判据；`ime.test.ts` + `imeEnterWiring.test.ts` + `InlineRenameInput` 组合态例 |
| A02 | 原生 `<dialog>` / top-layer | **已完成 26 处（含顶部对齐）；浮动 6 处明确定为保留** | `145d50dd` + `496744fb` + `229e78ec` + `64ef15b4` + 本轮 | 阻塞项（菜单在普通层）已解：模态内菜单/气泡现在带 `popover="manual"` 进 top layer 并已实测（设置对话框内下拉 `:popover-open`=true、命中测试在菜单内）。`NativeDialog`（`<dialog>` + `showModal`）已迁移 **24 处**：删除确认、目录重命名、命名/标签/附件重命名、**useConfirm 全家族（全站确认与提示）**、导入进度/结果、S3 迁移码、资源浏览器 3 处确认、粘贴表格过大、保存冲突、同步记录、草稿恢复、移动目标、小记筛选/标签管理/转化、标签合并、多维表 4 处。实测：`:modal`、居中 0 偏差、输入框全选、IME 组合态回车不提交、**可信 Esc（CDP Input）可关闭**。顶部对齐 2 处（SearchPanel / BitableRelationPicker）已迁：新增 `align="top"` 变体（`inset: 12vh 0 auto; margin: 0 auto`，实测 top=12.0%、水平居中、`:modal`、可信 Esc 可关）。**浮动/可拖拽 6 处（Settings/History/PublishDoc/SaveQuickNote/Trash/NoteInfo）保留自绘 Overlay**：它们靠 `transform: translate(-50%,-50%)` + `useFloatingDialog` 的拖拽/缩放/`interactionRef` 外点语义，而 a11y 缺口（背景 inert / Esc / 焦点圈闭）已由既有实现补齐 —— 换 top-layer 的收益只剩「架构统一」，风险是拖拽坐标与 transform 交互，按 §3#17 不做 |
| A03 | OS 文字缩放 | **第一步已修；第二步待重烤后做** | `75153e8e` | `<meta text-scale>` + 桌面 11 档 / 移动 10 档字号令牌 rem 化（rem×16 = 改前 px，默认档位视觉零变化）；`textScale.test.ts` 钉等价；第二步（449 处固定高 → `min-height` + 200% 逐屏走查）待做 |
| A04 | Tooltip 三缺口 | **已修** | `88bd4211` | 逻辑抽到 `src/lib/nativeTitleTip.ts`；桌面 `.ln-tip` / 移动 `.mb-tip` 各自薄壳（守「两端 UI 不共享组件/CSS」红线，`mobileIndependence` 绿）；移动长按 450ms、focusin 只在「另有可访问名」时摘 title、`aria-describedby` 增删复原；24 例新护栏 |
| A05 | 10k 树窗口化 | **不做（用户 261115 裁决「先不做」）** | — | `content-visibility` + `contain-intrinsic-size` 已在位（省布局/绘制）；DOM 数量/内存问题留给专门项目。**不要再重新立项**，除非用户明确点名 |
| A06 | 长任务让步 / INP | **待实测后决定** | — | 审计口径即「先量再改」；`useDeferredValue` 会把「输入即筛选」的同步断言变异步，必须连同测试一起改，并附 long-animation-frame 实测证据 |
| A07 | 首帧 color-scheme | **已修** | `14dcdf15` | 两份入口加 `<meta name="color-scheme" content="light dark">`；**更正**：`:root` 本来就有 `color-scheme`（`themes/light.css` 的 `:root,[data-theme=light]`），审计 v2 原描述有误 |
| A08 | `boot.html` 476KB | **已修** | `14dcdf15` | 图片外置：HTML 476KB → **1.9KB**（+328KB APNG +28KB PNG 独立文件）；`build.files` 已补；`electron/bootAssets.test.ts` 5 例。**字节总量不变**（APNG 仍加载），再减需品牌决策（改 CSS 动画） |
| A09 | 模态背景 inert | **已修（inert 部分）** | `84dc8005` | 对话框对 body 其它顶层子节点加 inert（引用计数、跳过自有浮层 portal、drawer 不动）；4 例 jsdom 护栏。`aria-modal` 与 29 处 `role=dialog` 的逐个校准仍待 |
| A10 | 可点 div 33 处 | **已修（复核后真缺口 3 类）** | 见 `git log --grep A10` | 33 处逐条复核：12+ 是遮罩/背板（`aria-hidden`，Esc/返回是等价出口）、5 处 `stopPropagation` 容器、2 处已带 `role=button` ⇒ **不是缺口**；真正 mouse-only 的是 ①色板全部色块 + 默认/无填充行、②历史快照/未引用列表的「点标题预览」、③移动端「打开标签」行。三处补键盘激活（`role=button`/`tabIndex`/Enter·Space，历史列表保持单 tab 停点只就地激活选中行），色板补 `:focus-visible` 环；护栏 `keyboardActivationGates.test.ts` |
| A11 | `command`/`commandfor` | **不适用（已核实）** | — | 全仓没有「静态声明式触发」点：对话框都由 React 状态/菜单项打开（`onClick` → setState），没有可加 `commandfor` 的固定按钮-目标对子。新写的静态对话框（不经过 React 状态）再用它；已写进 `NativeDialog` 的 JSDoc |
| A12 | `field-sizing` | **已修** | `7a0dc111` | AI 输入条改 CSS 自增高，删掉逐键 `scrollHeight` |
| A13 | `base-select` 试点 | **调研完成，暂不做** | — | 能力对照 15 项：可替 10 项（定位/matchWidth/aria/键盘/disabled/焦点回归），**不可替 2 项**（`useScrollFade` 的按需渐隐、lucide 描边箭头/对勾只能字符）+ **1 个真风险**（闭态 ↑/↓ 直接改值并派发 `change`，而设置页全部即时保存）。按调研的退出判据停在此处：试点前置 = 设计接受字符图标 + 逐档取值可接受；否则保持自研 `Select`（`Select.tsx` 一行未改） |
| A14 | `enterKeyHint` | **已修** | `c4b47e9b` | 搜索 = `search`（全局搜索 / 文档内查找）、命名与新建 = `done`（5 个入口）；护栏 `src/mobile/ui/enterKeyHint.test.ts` |
| A15 | 图片解码/懒加载 | **已修** | `1d07fd60` | 9 宿主 10 处 `<img>`；资源浏览器预览**保持不 lazy**（既有护栏禁止）；`imageAttrGates.test.ts` |
| A16 | `forced-colors` | **已修** | `ea10e334` | a11y.css 高对比度兜底（系统色关键字，正常模式零影响）；cssLayers 基线 15→23 |
| A17 | 容器查询 | **已修（首选 1 处）** | 见 `git log --grep A17` | 属性弹窗折列判据从 **视口 `@media (max-width:600px)`** 改为 **自身宽度 `@container (max-width:600px)`**：弹窗是用户可 8 向拖拽改宽的面，视口 1400 + 拖到 420 时旧判据永不触发（两列各 180px）。`container-type: inline-size` +1 声明（dialog.css 231→232），实测 720 宽 = 两列、560/500 宽 = 单列；`note-info` 快照态 0 差异。其余候选（小记面板/设置表单/编辑栏）按「改动面 × 重烤成本」推迟，编辑栏明确不做（layout containment 会改 fixed 包含块，与内核全屏浮层冲突） |
| A18 | `text-wrap` | **已修** | `7a0dc111` | 对话框正文 `pretty`、确认框标题 `balance` |
| A19 | `-webkit-overflow-scrolling` | **已修** | `7a0dc111` | 删 4 处 no-op |
| A20 | `will-change` 常驻 | 核实后**不改** | — | 10 处真实使用全部绑动画/位移；`mobile.css` 已有「转场结束即撤」注释与 `is-settled` 实现，属已处理 |
| A21 | JS 现代 API | **已修**（用户裁决升 lib） | `3d135f54` + 本轮 | `cause`×4 + `AbortSignal.timeout`×1；**`tsconfig` target/lib 升 ES2024**（用户 261115 裁决）后：`[...arr].sort()`→`arr.toSorted()` / `[...x].reverse()`→`toReversed()` / `.slice().sort()`→`toSorted()` 共 62 处（37 文件）；`Promise.withResolvers()`×2；**运行时兜底** `src/lib/es2024Fallback.ts`（老 Android WebView 缺这三个 API，两端入口首行幂等补齐，3 例护栏）；Set/Map 源保留展开（`[...set].toSorted()`，tsc 兜底） |
| A22 | 外链 `rel` | 核实**已满足** | — | 4 处 `target="_blank"` 全带 `noreferrer`/`noopener`（`noreferrer` 隐含 noopener） |
| A23 | anchor positioning | **前半已修（top layer）/ 后半未采用** | `145d50dd` | 模态内菜单/气泡改 `popover="manual"` 进 top layer（这一步是 A02 的前置）；`usePopoverPosition` 手算落位保留——点锚右键菜单需要指针坐标，anchor positioning 覆盖不到 |
| A24 | `outline: none` 35 处 | **已修（2 处真缺口 + 33 处核实）** | `2d5f5b2d` | 补桌面目录筛选 wrapper 内嵌环、移动端标题输入框 `:focus-visible` 环；其余 33 处逐条核对为「wrapper `:focus-within` 画环 / 分隔条 `::after` 点亮 / `vendor-focus.css` 收口」；护栏 `focusRingGates.test.ts` |
| A25 | 标准 `mask` | **已修** | `7a0dc111` | 2 处补标准属性，保留前缀 |
| A26 | `<meta color-scheme>` | **已修** | `14dcdf15` | 同 A07 |
| A27 | 启动页深色不跟随 | **已修** | `14dcdf15` | `boot.html` 用 `color-scheme: light dark` + `light-dark()` |
| A28 | 生命周期原语统一 | **不做**（审计原判） | — | 各处语义不同（pagehide/beforeunload/App 后台），合并风险 > 收益 |
| A29 | `<main>`/`<search>` | **已修（等价物）** | 见 `git log --grep A29` | 桌面工作区原本就是 `<main>`；移动壳补 **`role="main"`**（不换标签：stage 包住两层，换标签要连带改溢出/定位选择器）；两端搜索面补 **`role="search"`**（`<search>` 标签在 React 18 会打 unrecognized 告警且**不产生隐式角色**）；护栏 `landmarkGates.test.ts` |
| A30 | 日期/时长格式化 | **不做**（审计原判） | — | `08-04` 是定稿格式 |

### 11.1 本批的形状（为什么不是「一次性全改」）

- 已落地 17 个 commit，全部**行为等价或默认档位零视觉变化**：IME、字号 rem（等值）、boot 外置（视觉不变）、
  `field-sizing`（同样自增高）、`decoding=async`（只影响解码线程）、`mask` 补标准属性、`text-wrap`（单行不生效）、
  `forced-colors`（仅高对比度模式）、inert（只改可聚焦性）、Tooltip（行为补齐 + 桌面时序不变）。
- 真正会改观感的留到设备/视觉批次：原生 dialog/popover 迁移、可点 div 换 button、容器查询、树窗口化。
- 判据仍是「不做会不会有代价」（AGENTS §3#17）：一行 CSS/属性可解且零视觉风险的，本批做完；
  需要重烤视觉基线或设备验收的，单独立项。

### 11.2 下一批入口（按依赖顺序）

1. **A02/A11 已收口**：26 处原生 `<dialog>`（普通 + 顶部对齐），浮动 6 处与 `commandfor` 都写明「为什么不做」（见上两行）。剩：设备/视觉全量门禁里补一次「对话框态」快照复核。
2. **A10**：可点 div → button（33 处，逐处复位样式），一次视觉回归。
3. **A03 第二步**：固定高 → `min-height`，200% 字号逐屏走查 + 重烤基线。
4. **A05 + A06**：大库夹具上先量 INP，再决定窗口化与并发渲染的先后。
5. **移动端视觉门禁已完成**：`lake_gate`（5556）+ 门禁夹具 + 新构建，10 态**全部 +1 元素**（= 新增的 `MobileTitleTips` 单例）⇒ 重烤基线后连跑 0 差异；23 屏走查随后跑。
5. **A13 / A17**：小步机会项（`base-select` 与容器查询，各需视觉回归）。

### 11.3 本批验收（实测，261115）

| 端 | 装置 | 结果 |
| --- | --- | --- |
| 桌面 | 隔离 `LAKE_USER_DATA` + **`LAKE_RENDERER=scheme`**（读 dist）+ CDP 9333 | boot ready **463ms**（renderer-ready，无 ERR_CONNECTION_REFUSED）；根字号 16px；全仓计算字号档 = **10 / 11 / 12 / 13 / 14 / 15.5 / 18px**（= 令牌 rem×16，默认档位与改前等值） |
| 桌面（第二轮） | 同上 + **重新 `vite build`**（scheme 模式读 dist，旧构建会验到旧代码） | 设置对话框内「正文字号」下拉：`popover="manual"`、`:popover-open`=true、rect 391×229、`elementFromPoint` 命中菜单项；同一时刻 `#root` 带 `inert`（A09 在真实应用生效） |
| 桌面（第五轮，顶部对齐） | 同上 | 全文搜索（顶部对齐）：`dialog[open]` + `:modal`、top=98px（12.0%）、水平居中 0 偏差、输入框聚焦、**可信 Esc 关闭**；关联选择器（多维表）改按同一变体（源码断言已同步） |
| 桌面（第四轮，批量迁移） | 同上 | 新建笔记本（NamePrompt，经「新建」菜单）：`dialog[open]` + `:modal`、460×158、居中 0 偏差、输入框聚焦且**全选**、取消即关；可信 Esc（`Input.dispatchKeyEvent`）关闭原生对话框 |
| 桌面（第三轮，原生 `<dialog>`） | 同上 | ① 删除确认（⋮→删除）：`dialog[open]` + `:modal`、420×170、`centerDelta [0,0]`、无 `.ln-scrim`、取消后关闭；② 目录重命名（⋮→重命名）：460px、`:modal`、输入框聚焦且**默认全选**、**IME 组合态回车不提交**、真回车提交并关闭、目录标题变为「重命名验证」 |
| 移动（第五轮，重装后） | `lake_mobile`（5554，API 36）`android-build.sh --sync --install`（41.57MB debug） | `.mobile-app` 挂载、4 个可见 `[title]`、`.mb-tip` 计算 `position: fixed`（样式生效）、logcat **0 FATAL**；`enterKeyHint`/标题焦点环随源码打包（未逐屏点收） |
| 移动 | `lake_mobile`（5554，API 36）`android-build.sh --sync --install` | 安装启动成功，logcat **0 FATAL**；`.mobile-app` 挂载；4 个可见 `[title]` 元素；CDP 合成长按 700ms 后 `#lake-mobile-title-tip` 显示「设置」、底色 = `--lake-tooltip-bg`(rgb(216,221,232))、锚点写入 `aria-describedby="lake-mobile-title-tip"` |

未跑（本批未改外壳几何，建议随下一批视觉改动一起做）：桌面 `stylesnap` 42 态、移动 `mobile-snap` 10 态、23 屏走查、窗口矩阵、2GB 便携包真机导入。

> **视觉门禁（桌面 42 态，已完成）**：本机缓存里没有合成夹具 ⇒ 按 `scripts/css-audit/README.md` 用 `make-fixture.mjs` 重新生成（冻结到 `~/Library/Caches/lakex-local-notes-css-audit/fixture`），再在隔离实例上跑 `check-stylesnap`。结果：**41/42 态逐元素 0 差异**；9 态按预期重烤并写明理由——
> · `search:1315:light/warm`、`search-empty:1315:light`：迁 `<dialog>` 后少 1 个包裹元素（2548→2547）；
> · `settings-data/editor/trash` + `settings:1315:dark/warm`：新夹具的资源数据（孤儿/缺失行）与表单控件在 `color-scheme` 声明下的计算值变化（2718→2741）；
> · `settings-about`、`note-info`：浮动面板几何/异步内容导致的**跨实例抖动**（同实例两轮同值、换实例翻面，元素数不变）——记为已知 flaky，**不据此改代码**。
> 只重烤差异态而不是整份重烤：其余 33 态在**换夹具之后仍逐元素相同**，这是比整份重烤更强的回归证据。移动端 `mobile-snap` 10 态已按新构建重烤（+1 元素 = `MobileTitleTips` 单例）并复核 0 差异。

> 环境残留：桌面 smoke 用独立 profile 并已删除；CDP 只按端口 9333 定位杀进程（未用 pkill Electron）；`lake_mobile` 保持安装态供复验。
