# A · IconPark 官方能力调研（可行性判定）

> 调研日期：2026-11-16 ｜ 调研对象：官网 iconpark.oceanengine.com、GitHub bytedance/IconPark、npm `@icon-park/react|svg|compiler`（在 `/tmp` 实测解包 1.4.2）
> 对照现状：仓库 `lakex-local-notes` 分支 `modernize/web-platform-261115`，`lucide-react@1.61.0`（ISC），**178 处 `from "lucide-react"` 导入 / 185 个文件提及 / 186 个唯一图标**，另有 13 个文件内联自绘 SVG（`notebookIcons.tsx`、`noteRefIcon.tsx`、`FileBadgeIcon.tsx`、`AiSparkIcon.tsx`、`imageIcons.tsx` 等）；描边 1.75 的唯一来源 = `src/styles/app/base.css:27` 的 `svg.lucide { stroke-width: 1.75 }`。
> 本文件只做调研判定，不含实施改动；仓库代码全程只读。

## 0. 结论先行

**不建议现在就做「全量替换」。** 技术上接得进来（npm 包离线可用、Apache-2.0、按需 import 实测可 tree-shake），但这是一次**用更差的维护性换一套风格**的迁移，且与 AGENTS §3#14（图标只用 lucide / 描边 1.75）和 §3#22（依赖准入四问）正面冲突；用户设想的「自绘图标也统一」只能统一到「几何规范 + 组件外壳」，**四主题与官方图标包的四风格不会自动适用于自绘图标**。

三条最硬的证据：

1. **官方开源资产已冻结**：GitHub `bytedance/IconPark` 已归档只读（API `archived=true`，最后 push 2023-02-24，最后 release v1.3.0 = 2021-02-15，799 个 open issue，9,033 stars）；npm `@icon-park/react` 最新版 1.4.2 发布于 **2022-07-04**，此后无任何版本。官网仍在运营（页脚 © 2026 ByteDance），但**官网与 npm 包已分叉**——站点前端文案自己写着「设计同学产出的新图标只更新在对外网站…包里的图标」。见 [GitHub API](https://api.github.com/repos/bytedance/IconPark)、[npm @icon-park/react](https://www.npmjs.com/package/@icon-park/react)、[官网](https://iconpark.oceanengine.com/official)。
2. **几何不是 1:1 等重**：IconPark 是 viewBox 48 / stroke-width 4 / linecap·linejoin=round；24px 下 4×24/48 = **2px**，恰好等于 lucide 默认 2px——**但仓库统一用 1.75**，所以 IconPark 默认会重 **+14.3%**；且 48 网格自带内边距（抽样 Home 主体 30/48 宽 vs lucide 18/24；Search 圆 34/48 vs 18/24），同字号下光学上偏小约 10–20%。想「原地等重」必须显式传 `strokeWidth`/`size`，不能默认替换。依据：解包 `es/icons/Home.js`、`es/runtime/index.js`（见 §5）。
3. **自绘图标「能进体系、不能进四主题」**：官网「项目管理」支持上传自绘图标（`image/*`、单张 ≤50KB），但「组件配置」只做**颜色跟随**（`data-follow-color`/`data-follow-stroke`，USE_CURRENT_COLOR/USE_DEFAULT），产物是 Web Component / SVG Symbol（站内明说「图标原样展现，不支持组件化能力」）/ React·Vue 代码 / NPM 包；四主题是靠 `@icon-park/compiler` 把「按 fill/stroke 分好层」的源 SVG 用 `theme[].order` 重映射出来的（见仓库 `build/build-code.ts`），**上传路径并未承诺自动生成四主题**，且官网路径依赖登录/联网 SaaS（每账号最多 3 个项目）、产物不可复现、不可审计。

### 可行性判定表

| 诉求 / 能力 | 判定 | 依据（关键） |
| --- | --- | --- |
| 用 npm 包替换现有图标渲染 | **能** | `@icon-park/react@1.4.2` 2658 图标，barrel/per-icon 两种按需 import 均可 tree-shake（实测见 §3） |
| 原地替换后保持现有观感（24px、描边 1.75、与 lucide 等重） | **不能**（必须重调） | 48 网格 + 默认 4 描边 = 2px@24px，比仓库 1.75 重 14.3%；48 网格内置边距导致光学偏小（§5） |
| 自绘 SVG 自动获得四主题（线性/填充/双色/多色） | **不能**（自动）/ 待定（官网未承诺） | 四主题依赖 compiler 的 fill/stroke 分层与 `order` 配置；上传只做颜色跟随，SVG Symbol「原样展现」（§2） |
| 自绘 SVG 纳入「一套统一图标体系」 | **能**（但要自建外壳） | 统一 48 网格规范 + 自建 wrapper（可复用 `IconWrapper` 思路）即可，不必须依赖官网（§2/§7） |
| 闭源商用 | **能** | Apache-2.0；仓库与 npm 均为 Apache-2.0，无 NOTICE 文件（§4） |
| Electron/Capacitor 离线运行 | **能**（npm 依赖） / 不能（官网 CDN） | npm 包运行时不联网；官网 `icons_xxx.js` CDN / 项目包需联网，不能进安装包离线路径（§3） |
| 长期维护 / 升级兜底 | **不能**（高风险） | 仓库归档、npm 自 2022-07 冻结、799 open issues、无 issue 响应渠道（§6） |
| 不动设计系统/门禁直接全量替换 | **不能** | className 落在 `span.i-icon`（不是 svg），`svg.lucide` 系列 CSS 全失效；`styles/index.css` 由 JS import 会成未分层 CSS，撞 `cssLayers.test.ts` 层序红线（§7） |
| 回滚 / 退出 | **能但成本高** | 178 处 import、186 个图标、4 个测试文件提及 lucide；建议先收敛单一出口再谈替换（§7） |

### 事实校正（用户口述 vs 仓库实测）

- 用户说「lucide 描边 1.75 为 2」：仓库实际统一 **1.75**（`src/styles/app/base.css:27`，`tokens.css:11` 明确唯一来源），所以 IconPark 默认更重。
- 用户说「178 个文件在 import」：实测 **178 条 import 语句 / 185 个文件提及 lucide / 186 个唯一图标**（去别名、去 `type LucideIcon` 后），另有 **13 个内联自绘 SVG 文件**——「自绘图标」不是未来需求，仓库里已经有一批，需要一起纳入方案。

---

## 1. IconPark 到底是什么形态

- **入口**：官方图标库 `https://iconpark.oceanengine.com/official`（站点一级导航：首页 / 官方图标库 / 插画库 / 项目管理 / 使用指南）。「图标工厂」不是站内独立入口，对应能力是登录后的**项目管理**（我的项目 → 上传图标 → 组件配置 → 导出代码包）。
- **规模与分组**：官网首页/使用指南自述「**2600+ 基础图标，29 种图标分类**」；npm `@icon-park/react@1.4.2` 的 `icons.json` 实测 **2658** 条（含中文名、英文名、分类、作者、标签、rtl 标记）。来源：[官网](https://iconpark.oceanengine.com/home)、本机解包 `icons.json`。
- **风格分组 = 4 个主题**（同一份 SVG 通过属性切换，不是 4 套文件）：
  - `outline`（线性，默认）/ `filled`（填充）/ `two-tone`（双色）/ `multi-color`（四色/多色）；
  - 官网 UI 的筛选叫「图标风格（颜色）：线性 / 填充 / 双色 / 多色」，在线还可调**描边颜色、图标大小、线宽、端点类型、拐点类型**，并可复制 SVG/React/Vue 代码、下载 PNG/SVG、批量下载 SVG。
- **「可切换主题」的真实含义**：不是换 CSS，而是组件按 `theme` + `fill` 重新着色（`IconConverter` 把 4 个色槽映射到 path 的 fill/stroke），所以同一图标的线性/填充视觉是**同一套 path**，四主题共享几何。来源：解包 `es/runtime/index.js`、仓库 [README.zh-CN.md](https://github.com/bytedance/IconPark/blob/master/README.zh-CN.md)。
- **「图标工厂」结论**：没有面向公众的「上传 SVG 自动出四主题」的工厂页；官网的「项目管理」是**图标资产托管 + 组件代码/包生成**（见 §2）。

> 来源：<https://iconpark.oceanengine.com/official> ｜ <https://iconpark.oceanengine.com/home> ｜ <https://github.com/bytedance/IconPark> ｜ <https://github.com/bytedance/IconPark/blob/master/README.zh-CN.md>

---

## 2. 自定义图标能力：能落地到什么程度（决定「自绘也统一」这句话）

### 2.1 官网侧能力（实测前端 bundle + 站内文案）

站点前端 bundle（`main.e395b087.chunk.js`）中可见完整项目管理链路与接口，说明这不是营销词而是真实功能：

- **创建项目** → **上传图标**（`/api/resource/upload`）：上传组件 `accept="image/*"`，单张 **> 50KB 直接报错**「图标 大小超过50KB」；可填中文名/英文名/分组/标签/设计师，可「替换图标」。
- **组件配置**（`/api/resource/update-config`）：在 SVG 元素上打 `data-follow-color`/`data-follow-stroke`，`color_type` 可选 `USE_CURRENT_COLOR`（跟随 `currentColor`）或 `USE_DEFAULT`——**这是单主题内的颜色跟随，不是四主题**。
- **导出**（`/api/group/pkg-download`、`/api/group/npm-publish`、`/api/group/generate-script`）：
  - 复制 Web Component：`<iconpark-icon name="xxx"></iconpark-icon>`；
  - 复制 SVG Symbol：`<svg class="iconpark-icon"><use href="#xxx"></use></svg>`，站内说明「SVG 原生引用形式。**图标原样展现**，不支持组件化能力，但具备更好的兼容性」；
  - 复制 React / Vue 代码；
  - 发布项目 NPM 包（React / Vue，semver 版本号；「图标布局模式」可选 **单独 svg（默认）** 或 **外加 span（与 @icon-park/* 官方包布局兼容，需自行引入 index.css）**）；另有项目级 CDN JS 包（形如 `icons_33138_<hash>.js`）。
- **权限与生命周期**：项目最多 **3 个**；协作者角色（所有者/管理员/可编辑/可阅读）；服务终止后项目文件仅保留 **60 天**（用户协议 §8.3）。来源：[官网](https://iconpark.oceanengine.com/official)、[掘金教程](https://juejin.cn/post/7369485528708218917)、[CSDN 介绍](https://blog.csdn.net/weixin_49562392/article/details/143825083)。

### 2.2 四主题是「编译出来的」，不是「上传就有的」

仓库 `build/build-code.ts` 的 `BUILD_CONFIG` 是权威证据：它给每个图标声明 4 个色槽，再为每个主题声明 `fill + order`：

```ts
theme: [
  { name: 'outline',    fill: [fill(#333,currentColor), background(transparent)], order: [0,1,0,1] },
  { name: 'filled',     fill: [fill(#333,currentColor), background(#FFF)],        order: [0,0,1,1] },
  { name: 'two-tone',   fill: [fill, twoTone(#2F88FF)],                            order: [0,1,0,1] },
  { name: 'multi-color',fill: [outStrokeColor, outFillColor, innerStrokeColor, innerFillColor], order: [0,1,2,3] },
]
```

也就是说：**四主题 = 把源 SVG 里的 4 个颜色槽按 order 重排**。要得到四主题，SVG 必须按 IconPark 的约定把「外描边 / 外填充 / 内描边 / 内填充」分到不同 path/属性上，并跑 `@icon-park/compiler`（仓库工具链：ts-node + gulp + TS 4.1，2022 年后未更新）。官网「上传图标」只是把图片/SVG 存进项目并生成单主题组件，**没有公开承诺自动产出四主题**；站内 SVG Symbol 的「原样展现」说明其产物以原样 SVG 为准。

> 来源：<https://github.com/bytedance/IconPark/blob/master/build/build-code.ts> ｜ <https://www.npmjs.com/package/@icon-park/compiler> ｜ 站点 bundle 文案（`iconpark.oceanengine.com`）

### 2.3 对「自绘图标也统一」的落地判断

- **能统一的部分**：48×48 网格、4px 描边（或换算后的等效描边）、round 端点/拐角、组件 props（size/strokeWidth/fill/theme）、`currentColor` 颜色跟随——这些足以让自绘图标和 IconPark 图标**看起来同一套**。
- **不能统一的部分**：四主题（自绘要四主题必须自己按分层规范重绘 2–4 个 path 并跑编译链）、官网「图标库搜索/多色预览」等 UI 体验、官方后续新增图标（已停更）。
- **两条落地路径**：
  1. **官网项目管理上传**（需登录、联网、每账号 3 个项目）：拿 Web Component / SVG Symbol / React 组件 / NPM 包。优点：零构建；缺点：SaaS 依赖、产物不可复现、上传大小限制（50KB）、平台协议叠加（§4）、服务终止 60 天后删数据。
  2. **本地自建（推荐）**：把需要的官方 SVG（Apache-2.0）和自绘 SVG 一起放仓库，写 10 行级 wrapper（`viewBox 0 0 48 48` + `stroke-width` 由 prop/令牌控制 + `currentColor`），**不新增 npm 依赖**，可离线、可审计、可四主题（若要）。代价：自己维护图标资产与生成脚本。

---

## 3. 工程接入事实（npm / 离线 / 打包）

### 3.1 包与版本

| 包 | 最新版 | 发布日 | 许可 | 说明 |
| --- | --- | --- | --- | --- |
| `@icon-park/react` | **1.4.2** | 2022-07-04 | Apache-2.0 | React 组件；peer `react>=16.9`；`main` lib / `module` es；`sideEffects:["styles/**"]` |
| `@icon-park/svg` | **1.4.2** | 2022-07-04 | Apache-2.0 | 同名函数返回 **SVG 字符串**（非 React），适合 SSR/非 React/导出 |
| `@icon-park/vue-next` | 1.4.2 | 2022-07-04 | Apache-2.0 | 与 React 包同代冻结 |
| `@icon-park/compiler` | 1.0.7 | 2022-04-05 | Apache-2.0（LICENSE 文件） | **库，不是 CLI（无 bin）**；仓库构建靠它生成四主题组件 |

- `@icon-park/react` 解包 **10,968,946 字节 / 10,659 个文件**（`es/icons` 下 2659 个 `.js` = 2658 个图标 + 1 个 `DEFAULT_ICON_CONFIGS.js`，外加 2659 个 `.d.ts`；`es` 侧共 5,326 个文件，另有 lib 构建产物），每图标约 0.9–1.2KB ESM 源码。来源：[npm](https://www.npmjs.com/package/@icon-park/react)（本机 `npm pack` 实测）。
- **没有官方 CLI / 批量导出工具**：批量导出只能走官网 UI（批量下载 SVG、项目包）或自己写脚本调用 `@icon-park/compiler`。

### 3.2 按需 import（三种，实测均可 tree-shake）

```ts
// ① barrel（推荐写法，实测 tree-shake 有效）
import { Home } from "@icon-park/react";
// ② 单图标默认导出（路径稳定，不依赖 babel 插件）
import Home from "@icon-park/react/es/icons/Home";
// ③ babel-plugin-import（官方 README 推荐，libraryDirectory: "es/icons", camel2DashComponentName: false）
```

**我做的体积实测**（esbuild 0.25.0，`--bundle --minify --format=esm --external:react`，`/tmp` 内完成，未动仓库依赖）：

| 集合 | minified | gzip |
| --- | --- | --- |
| 仓库实际用到的 **186 个 lucide 图标** | 97,972 B | **17,323 B** |
| IconPark **190 个图标**（barrel 导入，抽样） | 181,531 B | **25,874 B** |
| IconPark 同上（单图标路径导入） | 180,006 B | 25,327 B |
| IconPark `es/all` 动态 Icon（**全量 2658**，会显著变慢/变大，不建议） | 2,747,631 B | **410,909 B** |

结论：**图标子集体积约 lucide 的 1.5×（+8.6KB gzip）**；这个量级不算致命，但要在 `check:bundle` 的 app-js 300KB 预算里重新算账；绝不能走 `es/all`。

### 3.3 SSR / 浏览器 / 联网 / 离线

- **SSR**：runtime 不用 `window`，可服务端渲染；但 `IconWrapper` 用 `useMemo(guid)`（`Math.random`）生成元素 id，**SSR 水合可能不一致**（Electron/Capacitor 无 SSR，实际无影响；若未来上 Web SSR 需注意）。来源：解包 `es/runtime/index.js`。
- **浏览器兼容**：普通 SVG + React 组件，无 polyfill 需求；peer `react>=16.9`，React 18 可用（函数组件 + Context），**未验证 React 19**。
- **是否必须联网**：**npm 依赖完全不联网**（图标数据随包分发）；联网只发生在「官网下载 / 项目管理 / 项目 CDN 包」路径。离线自托管两种：① 直接依赖 npm 包（推荐，但版本冻结）；② 下载 SVG（Apache-2.0）自己打包成组件（可控、可审计，需自建生成脚本）。
- **样式**：`@icon-park/react/styles/index.css`（约 1KB，`.i-icon` 前缀）负责 `inline-block`、`vertical-align:-.125em`、spin 动画、RTL 翻转。**若由 JS import 会变成未分层 CSS**，在仓库里会撞 `cssLayers.test.ts` 的层序红线，必须走 `@layer vendor`（仓库已有 `scripts/vendorCssLayer.ts` 兜底）。

> 来源：<https://www.npmjs.com/package/@icon-park/react> ｜ <https://www.npmjs.com/package/@icon-park/svg> ｜ <https://www.npmjs.com/package/@icon-park/compiler> ｜ 本机解包实测（`/tmp/ip-research`）

---

## 4. 许可（闭源商用 / 署名 / NOTICE / 图标本身）

- **代码与图标源文件 = Apache-2.0**：GitHub 仓库根 [LICENSE](https://github.com/bytedance/IconPark/blob/master/LICENSE) 为标准 Apache-2.0；npm 三个包的 `license` 字段均为 `Apache-2.0`；官网「了解项目」页也挂 Apache License 2.0 链接。**仓库内 `source/` 下的图标 SVG 属于仓库内容，同受 Apache-2.0 覆盖**（不存在「图标另一套许可」的公开文件）。
- **闭源商用：允许**（Apache-2.0 不限制商用/闭源，也不要求开源你的衍生代码）。
- **NOTICE：不需要额外 NOTICE**（仓库**没有** NOTICE 文件，GitHub `/contents/NOTICE` 404；Apache-2.0 §4(d) 只在作品自带 NOTICE 时触发）。但 §4 要求：保留版权与许可声明、修改过的文件需注明修改。对 Electron 安装包的落地动作 = 在「关于 / 第三方许可」补一条 `IconPark (Apache-2.0)`；仓库根 `NOTICE` 目前只列了 `Lucide：ISC`（见 `NOTICE` 文件），**要加就必须同时把 Lucide 条目保留/替换，不能只加不改**。
- **图标署名**：`icons.json` 每条带 `author`（设计师名），属署名数据、不构成额外许可；Apache-2.0 下可用但建议在第三方许可页写明来源。
- **双轨风险（必须在报告里点明）**：官网是独立 SaaS，其[用户协议]（巨量引擎，站内弹窗文本）§5 给出「基础许可（免费可浏览内容的下载使用许可）/ 拓展许可（付费订阅更多资源）」，§7.2 声明网站资料知识产权归平台、且「不得用于提供与 IconPark 相同、相近或与 IconPark 商业目的存在竞争关系的产品或服务」，§8.3 服务终止后项目文件只留 60 天。
  - 走 **npm / GitHub 代码** ⇒ 只受 Apache-2.0（闭源商用 OK）。
  - 走 **官网批量下载 / 项目管理产物 / CDN 包** ⇒ 同时受平台协议（账号、付费、内容审核、平台可终止服务、数据只留 60 天）。
  - 结论：**工程上只应使用 npm/GitHub 轨道，不要把官网 SaaS 当构建依赖**；这条直接否掉「自绘图标上传官网再导出 NPM 包」作为长期方案。

> 来源：<https://github.com/bytedance/IconPark/blob/master/LICENSE> ｜ <https://www.npmjs.com/package/@icon-park/react> ｜ <https://iconpark.oceanengine.com/about> ｜ 官网用户协议（`iconpark.oceanengine.com` 站内）

---

## 5. 几何规范与「24px 下是否 1:1 等重」

| 项 | IconPark | lucide（仓库现状） |
| --- | --- | --- |
| viewBox | `0 0 48 48` | `0 0 24 24` |
| 默认描边 | `strokeWidth=4`（可 prop/IconProvider 覆盖） | 2（被仓库 CSS 统一改成 **1.75**） |
| 端点 / 拐角 | `round` / `round`（可 prop 改 butt/square、miter/bevel） | round |
| 默认 size | `1em`（跟随字号） | 24 |
| 根元素 | `<span class="i-icon i-icon-{name}">` 包着 `<svg fill="none">` | `<svg class="lucide">`（forwardRef） |
| 颜色槽 | 4 槽（outline 只用 2 槽 + currentColor） | `currentColor` 单色 |

**换算与结论**：

1. 24px 下 IconPark 描边 = `4 × 24/48 = 2px`，与 **lucide 默认 2px 等重**；但仓库统一 1.75 ⇒ IconPark 默认**重 14.3%**（`(2-1.75)/1.75`）。要等重需传 `strokeWidth={3.5}`（24px 时等效 1.75），或把图标渲染到 27.4px 再缩放——前者会改变图标设计师原本的视觉密度，后者影响布局。
2. **光学尺寸也不等**：IconPark 在 48 网格里留了明显内边距。抽样：Home 主体 x 9–39（30/48 = 62.5%）、y 6–42（75%）；lucide Home 主体 x 3–21（75%）、y 2–22（83%）。Search：IconPark 圆 4–38（34/48 = 70.8%）+ 手柄到 41.7，lucide 圆 3–19（16/24 = 66.7%）+ 手柄到 21。⇒ 同字号下 IconPark 光学上偏小约 10–20%，并排会出现「IconPark 更小、更轻或更重」的错位。
3. **暗色主题风险**：`filled` 主题把内层固定为 `#FFF`（`IconConverter` 中 `colors.push('#FFF')`），`two-tone`/`multi-color` 默认色是 `#333/#2F88FF/#FFF/#43CCF8`——都不来自 `--lake-*` 令牌。**深色 UI 里禁用 filled/two-tone/multi-color，只用 outline + currentColor**，否则会出现白底/硬编码蓝。
4. 结论：**不是 1:1 等重，不能原地替换**；「等重」只在 lucide 默认 2px 且具体图标几何恰好接近时成立。要迁移必须做一次视觉基线重烤（桌面 `check-stylesnap` / 移动 `check-mobile-snap` 全量）。

> 来源：解包 `@icon-park/react@1.4.2` 的 `es/icons/Home.js`、`es/icons/Search.js`、`es/runtime/index.js`；lucide 侧 `node_modules/lucide-react/dist/esm/icons/search.mjs`、`home.mjs`；第三方实测（下载的 SVG 为 width/height=24、viewBox 0 0 48 48、stroke-width=4）：<https://www.zhetengya.com/tools/iconpark-icons>

---

## 6. 维护活跃度（迁移风险的核心）

| 指标 | 实测值 | 说明 |
| --- | --- | --- |
| GitHub 仓库状态 | **archived = true（只读）** | API 字段；归档日期无官方公告，第三方复测记录为 **2025-12-08** 转只读 |
| 最后 push | **2023-02-24** | 之后无任何提交 |
| 最后 release | **v1.3.0 / 2021-02-15** | 仓库 release 页仅此一个 |
| open issues | **799** | 归档后无法新建/回复 issue |
| stars / forks | 9,033 / 556 | 采用面还在（反证不是没人用） |
| npm 最新版 | **1.4.2 / 2022-07-04** | React、Vue3、SVG 三包同日冻结；`@icon-park/compiler` 1.0.7 / 2022-04-05 |
| npm 周下载 | **74,315**（2026-11-08~14） | 生态仍在使用，但不再维护 |
| 官网 | 在线，页脚 © 2026 ByteDance | 官网还在加图标/改 UI；**官网 ≠ npm 包版本**（站点文案自证两者分叉） |

**判定**：这不是「低活跃」而是「已归档冻结」。风险不是「以后可能没人修」，而是**现在就没有维护窗口**：React 19/新构建工具兼容、CVE、图标新增请求都不会有响应；再叠加官网与 npm 分叉，「官网有、包没有」会持续扩大。

> 来源：<https://api.github.com/repos/bytedance/IconPark> ｜ <https://github.com/bytedance/IconPark/releases> ｜ <https://www.npmjs.com/package/@icon-park/react> ｜ <https://api.npmjs.org/downloads/point/last-week/@icon-park/react> ｜ <https://www.zhetengya.com/tools/iconpark-icons>（归档日期）

---

## 7. 「整套替换」路径与已知迁移坑

### 7.1 三条路径

| 路径 | 做法 | 成本/风险 | 建议 |
| --- | --- | --- | --- |
| A. npm 全量替换 | 加 `@icon-park/react`，178 处 import 全改，CSS/测试/视觉基线全改 | 图标风格全变；+8.6KB gzip；停更依赖进主链路；退出成本高 | **不推荐**（当前无已验证痛点） |
| B. 增量：只把「自绘图标」统一到 48 网格自有组件 | 保留 lucide 为主，新增自绘统一出口（`components/ui/...`），几何对齐 IconPark 规范 | 不碰红线、零新依赖 | **可做**（把「自绘图标统一」落地成这个） |
| C. 自托管子集 | 从 Apache-2.0 的 `source/`（或官网下载）取所需 SVG（≤所需几十个），自建生成/包装，随仓库分发 | 需自建脚本；但离线、可审计、无停更依赖 | **若坚持 IconPark 风格，选这条** |

### 7.2 已知迁移坑（按影响排序）

1. **`size` 默认值是 `1em`**（不是 24）：仓库绝大多数 `<Icon />` 不传 size，替换后会跟字号走，布局整体跳变。必须全局 `IconProvider` 默认 24 或逐点补 `size`。
2. **`strokeWidth` 默认 4**：等价 24px 下 2px，与仓库 1.75 不同；且 `filled/two-tone/multi-color` 主题**没有描边概念**，`strokeWidth` 无效。
3. **className 落在 span 上**：IconPark 是 `<span class="i-icon i-icon-home ..."><svg/></span>`，仓库现有 `svg.lucide { stroke-width: 1.75 }`（`app/base.css`）、`.mb-row__icon > svg.lucide`（`mobile/kit.css`）、`.toolbar__button > svg.lucide`（`mobile/mobile.css`）等**全部失效**，必须改成 `.i-icon` 选择器或走 props。
4. **图标名映射**：186 个 lucide 图标名 ≠ IconPark 命名（`MoreHorizontal → More`、`TriangleAlert → Caution`、`ChevronDown → Down` 一类），需要一张人工别名表；IconPark 也**不一定有对应语义**的图标（如 `Sparkles`、`ListFilter`、部分多色/自绘语义），全量替换必然出现「找不到对应图标」或「语义被换掉」。
5. **`fill` 语义不同**：lucide 的 `fill="none"|"currentColor"`；IconPark 的 `fill` 是「颜色或颜色数组（最多 4 个）」，与 `theme` 联动；迁移时把 `fill` 当颜色会静默改观感。
6. **硬编码默认色与暗色主题**：`filled` 白底 `#FFF`、多色默认 `#2F88FF` 等不属于 `--lake-*`；深色主题下会出现白块/高饱和蓝，必须在适配层强制 outline+currentColor 或禁用这些主题。
7. **无 `forwardRef`**：IconPark 组件不转发 ref（lucide 有），仓库若有 `ref` 到图标的位置（测量/聚焦/动画）会坏。
8. **CSS 层序**：`styles/index.css` 由 JS import 会成未分层 CSS → 必须走 `@layer vendor`（仓库有 `vendorCssLayer.ts` 兜底），否则 `cssLayers.test.ts`/观感门禁红。
9. **包体积与构建**：子集 +8.6KB gzip（1.5×）；Vite dev 预打包会解析 2658 个模块，**dev 冷启动变慢**需实测；production tree-shake 正常（实测 190 图标 181KB min / 25.9KB gzip）。
10. **视觉门禁全量重烤**：桌面 `check-stylesnap --states`、移动 `check-mobile-snap --states` 必须重烤基线，否则下一次全量必红（AGENTS §3#21③ 口径）。
11. **许可与 NOTICE**：Apache-2.0 需在「关于/第三方许可」加条；仓库 `NOTICE` 的 `Lucide：ISC` 行需要同步处理，不能只加不改。
12. **退出成本**：178 处 import / 186 图标 / 4 个测试文件；没有图标门禁（无「禁止非 lucide 图标」的自动化）。**替换前应先有单一出口（`Icon` 包装）与门禁**，否则回滚=再改一遍。

---

## 8. 对 AGENTS.md 两条红线的回答

### §3#14（桌面 UI 自有设计系统）

- 原文红线：**「图标只用 lucide（描边 1.75），禁 emoji/系统字形」**（`AGENTS.md:51`）；`docs/DESIGN.md:402` 同样写「图标只有 lucide 一族、描边 1.75」；唯一来源 `src/styles/app/base.css:27`。
- 回答：**换 IconPark = 直接改这条红线**，不是普通换库。必须①用户裁决并同步修改 `AGENTS.md` + `docs/DESIGN.md` + `tokens.css` 注释；②接受几何不再由 CSS 单点控制（改为组件 props），`svg.lucide` 相关规则全量重写；③视觉基线重烤。**在用户没有明确改红线之前，任何全量替换都违规。**

### §3#22（依赖准入四问：缺一不引入）

1. **解决已验证痛点？** —— **不通过**。仓库没有「lucide 不好用」的实测证据：186 个图标已覆盖两端 UI，唯一提出的需求是「自绘图标统一」，而这用自建 wrapper 就能解决（见 §2.3/§7.1 路径 B）。按 §3#17「拒绝迎合式找需求」，本轮立项依据不足。
2. **会否引入第二套样式/令牌/preflight？** —— **有中等风险但可收敛**。IconPark 自带 `.i-icon` 样式与 `#333/#2F88FF/#FFF` 默认色（不属于 `--lake-*`）；但它没有 preflight、不写 className 语义、不接管现有组件。可通过「只允许 outline + currentColor + 禁止 filled/two-tone」的包装层把风险收口；`styles/index.css` 必须进 `@layer vendor`。
3. **体积/离线/许可/打包成本算过？** —— **算过**：子集 +8.6KB gzip（1.5×，186 vs 190 抽样）；npm 包 10.9MB / 10,659 文件（仅安装期成本）；运行时不联网（离线 OK）；Apache-2.0 闭源商用 OK、无 NOTICE 但需加第三方许可条目；无 CLI，官网路线不可审计且受平台协议约束。
4. **退出成本与护栏（门禁覆盖、删得掉）？** —— **不通过**。178 处 import / 186 图标 / 4 个测试文件提及；**当前没有图标来源门禁**（没有 lint 拦「非 lucide 图标」），也没有单一出口组件；替换后回滚成本 ≈ 再迁移一次。若要做，必须先补「图标单一出口 + 门禁」再迁移。

**四问结论：① 与 ④ 明确不通过 ⇒ 按「缺一不引入」，本轮不引入。**

---

## 9. 若用户坚持推进：最小验证清单（先做这些再立项）

1. **视觉对照页**：挑 20 个高频图标（ChevronDown/Plus/Search/More/X/Trash2…），同 24px 并排：lucide 1.75 / lucide 2 / IconPark `strokeWidth=4` / IconPark `strokeWidth=3.5`；亮/暗两套主题截图。判据：视觉重量与光学尺寸是否可接受（§5 预判不可 1:1）。
2. **自绘图标方案二选一**：官网项目管理产物（快但 SaaS 依赖、不可审计）vs 本地自建（推荐：48 网格 + 自建 wrapper + 仓库内 SVG 资产）。
3. **维护风险缓解**：把所需图标 SVG 子集（Apache-2.0）落仓库 `assets/icons/`，自建脚本生成组件；或 fork `@icon-park/react` 锁死；**不把官网 CDN/SaaS 放运行时**。
4. **先补门禁**：单一出口（`Icon` 包装）+ 禁止直接 import 第三方图标的 lint/测试；NOTICE 与「关于」页第三方许可先更新；再决定是否替换 178 处。
5. **明确不做**：不引入 filled/two-tone/multi-color 到 UI（暗色主题风险）；不用 `es/all` 动态图标；不在本次做「图标语义重映射」（会悄悄换掉用户语义）。

---

## 10. 调研方法与可复现性

- npm 包在 `/tmp/ip-research` 解包（**未改动仓库 `package.json`/`node_modules`**）：
  `npm pack @icon-park/react@1.4.2 @icon-park/svg@1.4.2`；`node -e "console.log(require('./icons.json').length)"` → **2658**；`es/icons` 下 2659 个 `.js` = 2658 个图标 + `DEFAULT_ICON_CONFIGS.js`（见 §3.1）。
- 体积对比：`esbuild --bundle --minify --format=esm --external:react`，入口为仓库实际 186 个 lucide 图标 vs IconPark 190 个抽样图标；`gzip -9` 取字节数（表格见 §3.2）。
- 仓库侧只读统计：`grep -rh 'from "lucide-react"' src | wc -l` = 178；唯一导出 186；内联 SVG 文件 13；提及 lucide 的测试文件 4。
- 官网能力证据：站点前端 bundle `main.e395b087.chunk.js` 中的接口与文案（`/api/resource/upload`、`/api/group/npm-publish`、`/api/group/pkg-download`、`图标布局模式`、`图标原样展现` 等）；页面：<https://iconpark.oceanengine.com/official>。
- 数据快照：2026-11-16；npm 数据来自 registry API，GitHub 数据来自 REST API（未使用镜像/二手转述，除归档日期一处第三方复测已标注）。
