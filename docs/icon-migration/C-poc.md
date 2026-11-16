# C · POC：lucide → IconPark 是否「一模一样」、能否离线接入（实测）

> 任务：task-3（POC）。只读仓库代码，唯一写入 = 本文件。所有依赖装在 `/tmp/icon-poc`，未触碰仓库 `node_modules` / `package.json`，无 commit。
> 姊妹文档：A（IconPark 官方能力/许可/自定义图标）、B（仓内图标资产清点）由其它任务产出，本文不重复；本文只回答**视觉是否等价**与**工程接入面是否可接受**。

## 0. 结论先行

### 0.1 「换完是不是一模一样」= **不是**

| 维度 | 实测结论 | 关键数字 |
|---|---|---|
| 结构/形状 | 4/10 完全一致（Plus、Chevron×3），其余同族但几何不同 | 4/10 墨迹覆盖**逐像素级相同** |
| 视觉重量 | 需换算 stroke-width，且换算后仍有个体差 | 换算规则 `3.5@48` = `1.75@24`；换算后 10 对平均偏差 **9.2%**，最差 X **+32%** |
| 光学尺寸 | 逐个图标不同，不能全局归一 | X 墨迹盒 14→**18px**（+28.6%），Search 20→21px，Delete 20×22→22×22 |
| 视觉中心 | 多数 <0.2px（不可感知），少数可感知 | 最大 Δ **1.05px**（Search 上移 1.05px；CheckSmall +0.5/+0.39；其余≤0.5） |
| viewBox | **不需要**手写 48→24 归一 | `size={24}` 在两套库都是 24px，viewBox 自动缩放；差异在「画在 48 里的光学留白」，只能逐图标修 `size` |

一句话：**换成 IconPark 可以得到「同一套线性语言」，但得不到「一模一样」**——10 个高频图标里 4 个逐像素一致，**3 个偏差 >20%**（X +32%、Pencil +22%、Search +22%），余下 3 个 5–6%（Check/Trash/Trash2，密集 UI 里不易察觉）。

### 0.2 「工程上能否离线接入」= **能，但有 3 个真实成本**

1. **第二套样式范式（撞 AGENTS §3#14 红线）**：IconPark 每个图标渲染成 `span.i-icon > svg`（不是裸 `<svg>`），自带 `styles/index.css`（512 B / gzip 269 B，全局 `.i-icon` 类族 + `vertical-align:-.125em` + `@keyframes i-icon-spin`），并有 outline/filled/two-tone/multi-color **4 套主题**。它不基于 `--lake-*` 令牌。
2. **仓库的「描边单一来源」会失效**：全仓 stroke-width 唯一来源是 `src/styles/app/base.css#L27` 的 `svg.lucide { stroke-width: 1.75 }`（`src/styles/tokens.css#L11` 明文登记）。IconPark 的 `<svg>` **没有 class**（class 落在 span 上），这条规则不再命中；必须改用 `IconProvider` 注入或新写 `.i-icon svg{...}`（后者就是第二套范式）。
3. **CSS 直系选择器要逐条迁移**：仓库有 **29 条 `> svg` 直系选择器**（24 个 CSS 文件涉及 svg），IconPark 多插一层 `span` 后 `父 > svg` 全部失配（例：`src/mobile/kit.css#L429`、`src/mobile/mobile.css#L644`）。

被排除的非问题（实测 PASS）：**bundle 增量**（全量外推 ≈ **+6.2 KB gzip**，app-js 预算 300 KB gzip 的 ~2%）、**离线**（0 个外部请求，断网仍渲染 6/6）、**CSP**（仓库生产 CSP 下 0 违规）、**许可**（Apache-2.0）。真正的风险是 **4 年未维护**（1.4.2，2022-07-04；lucide 为 1.73.0 / 2026-11-14）。

### 0.3 三选一：**不替换（推荐）**；若产品坚持，则「部分替换」= 只换 lucide 的 178 个文件，自绘 19 文件另议

- **不替换**：无已验证痛点（§3#17 三问缺一不做）+ 撞 §3#14 / §3#22 两条红线 + 替换后视觉效果不一致（本文 §2）。
- **部分替换**：改动面 178 文件 / 897 处 named import / ~917 个 JSX 渲染点 / 214 个图标映射 / 58 处未传 size；必须先由**用户裁决改红线**，再按 §5.2 的 7 步落地。
- **全量替换**：在部分替换之上再加 19 个自绘 SVG 文件（48 处内联 `<svg>`）重绘，收益不增加、风险最高。

---

## 1. 实验条件（可复现）

| 项 | 值 |
|---|---|
| 仓库 | `lakex-local-notes`，分支 `modernize/web-platform-261115`（只读） |
| lucide 版本 | **1.61.0**（仓库 lock 的版本，非最新 1.73.0） |
| IconPark 版本 | `@icon-park/react` **1.4.2**（`@icon-park/svg` 同版本备用） |
| 独立工程 | `/tmp/icon-poc`（`npm init -y` + 上两包 + `react@18`/`react-dom@18`/`esbuild`） |
| 渲染器 | Google Chrome **155.0.8059.85** `--headless=new`，CDP 驱动 |
| 渲染条件 | 24px CSS 盒（与仓库实际显示尺寸一致，见 §3.7），白底 `#fff`，图标 `#000`，设备像素比 **4×**（96×96 像素） |
| 采样 | lucide 用例 = `strokeWidth 1.75`（对齐 `base.css` 全局规则）；IconPark 用例 = `strokeWidth 3.5`（等价换算）与 `4`（IconPark 默认，用于证明「不换算会更粗」） |
| 度量 | 把序列化后的 `<svg>` 以 96×96 画到 canvas（alpha>8 记为墨迹），得到：墨迹像素数/覆盖率、墨迹外接盒、墨迹质心（=视觉中心）相对 24×24 框中心的偏移 |

**选样方法（可复现）**：扫 `src/**/*.{ts,tsx}` 里 `from 'lucide-react'` 的 named import，按「import 次数 + JSX 出现次数」排序。实测：**178 个文件 / 178 条 import / 214 个不同图标 / 897 处 named import / 约 917 个 JSX 渲染点**。取前 10 名 = X、Plus、Check、Search、Trash、Pencil、ChevronRight、ChevronLeft、Trash2、ChevronDown（前 10 名合计 **275 次 import / 357 个 JSX 渲染点**）。

**IconPark 映射**（人工策展，见 §2.5 的候选对比）：
`X→Close`、`Plus→Plus`、`Check→CheckSmall`、`Search→Search`、`ChevronRight→Right`、`ChevronLeft→Left`、`ChevronDown→Down`、`Trash→Delete`、`Trash2→Delete`、`Pencil→Pencil`。

复现命令（全部在 `/tmp/icon-poc`）：

```bash
node make-compare.mjs    # 用仓库 lucide 1.61.0 + /tmp 的 IconPark 做 SSR，生成 compare.html（每图标 3 格：lucide / park@3.5 / park@4）
node measure.mjs         # headless Chrome：逐格 4x 截图 + 画布墨迹计量 -> measure.json
node assemble.cjs        # 汇总成 §2.4 的表
node bundle-measure.mjs  # esbuild 按需 import 的 bundle 增量（raw + gzip）
node csp-offline.mjs     # 生产 CSP 注入页 + Network offline 渲染验证
```

截图目录：`/tmp/icon-poc/shots/`（每格 `<图标>--<变体>@4x.png` 96×96、每行 `row-NN@4x.png` 带标签、整页 `_overview@2x.png`、候选变体 `alternates@3x.png`）。

---

## 2. 视觉对照（10 对，24px 实显，4× 设备像素）

![总览](/tmp/icon-poc/shots/_overview@2x.png)

（每行三格依次为：lucide stroke 1.75 / IconPark strokeWidth 3.5 / IconPark 默认 strokeWidth 4。单格 4× 原图见 `/tmp/icon-poc/shots/<图标>--lucide@4x.png` 等。）

### 2.1 是否需要换算 stroke-width？**需要，换算系数 = ×2（48-viewBox 单位）**

- IconPark outline 默认 `strokeWidth: 4`，viewBox 是 `0 0 48 48` ⇒ **等于 24px 下的 2px**；仓库 lucide 是 24-viewBox 下的 **1.75**。
- 换算规则：`strokeWidth_IconPark = 1.75 × (48/24) = 3.5`。**等价、可全局一次设定**（`IconProvider` 的 `strokeWidth: 3.5`），不需要逐处调。
- 实测证据 A（换算正确）：`Plus` 与 3 个 Chevron 在 1.75 vs 3.5 下墨迹覆盖**完全一致**（10.16% vs 10.16%；6.27% vs 6.27%），墨迹盒也一致 → 换算没有过度/不足。
- 实测证据 B（不换算会更粗）：同一图标 `strokeWidth=4` 相对 `3.5` 的墨迹覆盖率比值 = 1.181 / 1.068 / 1.19 / 1.123 / 1.191 / 1.191 / 1.191 / 1.016 / 1.016 / 1.153，**均值 1.132**（理论 2/1.75 = 1.143，偏差来自 4× 栅格化的 alpha 阈值）→ 直接用 IconPark 默认会整体**重 ~13%**。
- ⚠️ 关键工程后果：换算**不能靠仓库现有的 CSS** 完成。`svg.lucide { stroke-width: 1.75 }` 只命中 lucide 的 class，而 IconPark 的 `<svg>` 无 class；必须走 `IconProvider`（React context，要包两端根）或新增 `.i-icon svg{stroke-width:3.5}`（= 第二套范式，见 §3.5）。

### 2.2 是否需要 viewBox 48→24 归一？**不需要手写归一，但需要逐图标校光学尺寸**

- `size={24}` 在两套库里都输出 `width/height=24`，viewBox 由各库自带 ⇒ **不存在「忘记换 viewBox 导致图形变形/裁切」的问题**（实测 SVG 盒 24×24、图形完整）。
- 真正的差异是「**画在 48×48 里留多少白**」。实测同一像素尺寸下，墨迹外接盒差异最大到 **4px/24px（X：14→18）**：
  - X：IconPark `Close` 画 18×18，lucide `X` 只画 14×14 ⇒ 直接用会**显大 28.6%**；等效 size 系数 0.78（即 `size≈19` 才对齐）。若换 `CloseSmall` 则是 12×12（偏小 14%），两个变体都不精确。
  - Search：20→21（+5%），Trash：20×22→22×22，Pencil：22×22→21×21。
- 结论：**需要一张「逐图标 size/变体校正表」**（214 个图标都要过一遍），不能只做全局换算。

### 2.3 视觉中心偏移（墨迹质心 vs 24×24 框中心）

- 多数图标 ≤0.2px：**不可感知**（Plus/ChevronDown 0；Trash 0.05px；Pencil 0.24px；Chevron 0.5px 横向）。
- 可感知的 3 个：`Search` **上移 1.05px**（左 0.65px）——在 14px 显示尺寸下是 0.6px，放大到 24px 后约 1px，密集工具栏里能看出来；`CheckSmall` 右+0.5/下+0.39；`Pencil`（IconPark Pencil）0.17/0.17。
- 若用 `Edit` 替代 Pencil，则中心下移 **1.63px**（更差，已排除）。

### 2.4 10 对逐项数字（strokeWidth 3.5 对齐 1.75；覆盖率分母 = 24×24 框面积，4× 采样）

| lucide | IconPark | lucide 墨迹覆盖 | IconPark@3.5 | 比值 | lucide 墨迹盒(px) | IconPark 墨迹盒(px) | 等效 size 系数 | 视觉中心 Δ(px) |
|---|---|---|---|---|---|---|---|---|
| X | Close | 11.94% | 15.76% | **1.32** | 14.00×14.00 | 18.00×18.00 | 0.78 | (0.00, 0.00) |
| Plus | Plus | 10.16% | 10.16% | **1.00** | 16.00×16.00 | 16.00×16.00 | 1.00 | (0.00, 0.00) |
| Check | CheckSmall | 8.18% | 7.70% | 0.94 | 18.00×13.00 | 17.00×12.00 | 1.07 | (+0.50, +0.39) |
| Search | Search | 19.11% | 23.26% | **1.22** | 20.00×20.00 | 21.00×21.00 | 0.95 | (−0.65, **−1.05**) |
| ChevronRight | Right | 6.27% | 6.27% | **1.00** | 8.00×14.00 | 8.00×14.00 | 1.00 | (+0.50, 0.00) |
| ChevronLeft | Left | 6.27% | 6.27% | **1.00** | 8.00×14.00 | 8.00×14.00 | 1.00 | (+0.50, 0.00) |
| ChevronDown | Down | 6.27% | 6.27% | **1.00** | 14.00×8.00 | 14.00×8.00 | 1.00 | (0.00, 0.00) |
| Trash | Delete | 31.05% | 32.62% | 1.05 | 20.00×22.00 | 22.00×22.00 | 0.95 | (+0.01, −0.05) |
| Trash2 | Delete | 31.05% | 32.62% | 1.05 | 20.00×22.00 | 22.00×22.00 | 0.95 | (+0.01, −0.05) |
| Pencil | Pencil | 21.23% | 25.85% | **1.22** | 22.00×22.00 | 21.00×21.00 | 1.05 | (−0.17, +0.17) |

汇总：**4/10 完全一致；平均绝对偏差 9.2%；最差 X 1.32×；最大视觉中心偏移 1.05px。**
说明：`lucide 1.61.0` 里 `Trash` 与 `Trash2` 的 SVG 标记**完全相同**（渲染字符串逐字节相等，属 lucide 的历史别名），所以两行映射到同一个 IconPark `Delete`。

### 2.5 映射本身要人工策展（这是隐藏成本）

IconPark `@icon-park/react` 共 **2659 个图标**（`Close/CloseSmall/CloseOne/CloseRemind…` 变体命名），没有 lucide 名称对照表。以本 POC 的 5 个「有歧义」图标为例，**同名/近义候选实测差异巨大**：

| lucide | 候选（墨迹覆盖 / 外接盒） | 取舍 |
|---|---|---|
| X | Close 15.76%/18²、CloseSmall 10.03%/12²、CloseOne 27.56%/22²（圈+x） | 无精确对应；`Close` 最接近语义，需 size≈19 校正 |
| Check | Check 9.58%/21×15、CheckSmall 7.70%/17×12、Correct 18.97%/22×17、CheckOne 26.58%/22² | 选 `CheckSmall`（尺寸最接近） |
| Trash | Delete 32.62%/22²、DeleteOne 27.28%/20×21、DeleteFour 25.60%/18×21、DeleteFive 29.89%/18×21 | 选 `Delete`（剪影最接近 lucide 垃圾桶） |
| Pencil | Pencil 25.85%/21²、Edit 21.65%/20²（中心下移 1.63px）、EditOne 28.59%/19×22 | 选 `Pencil`（形状同族；`Edit` 是铅笔+横线语义不同） |
| ChevronRight | Right 6.27%/8×14、ArrowRight 12.15%/20×14（箭头+横线） | 选 `Right`（**逐像素一致**） |

候选对比图：`/tmp/icon-poc/shots/alternates@3x.png`

![候选变体](/tmp/icon-poc/shots/alternates@3x.png)

→ 214 个图标全部映射 = 一份需要 reviewer 的策展表 + 每个图标一次像素级校正；这不是「改 import 就行」的机械替换。

---

## 3. 工程接入面实测

### 3.1 按需 import 的 bundle 增量（gzip，与 lucide-react 同条件）

esbuild 单入口（react 18 + react-dom 18 打底，minify，`gzip -9`），差量法：

| 场景 | raw | gzip |
|---|---|---|
| 基线（无图标） | 142,251 B | 45,604 B |
| + 第 1 个 lucide 图标（X） | +4,271 B | **+1,698 B** |
| + 第 1 个 IconPark 图标（Close） | +3,838 B | **+1,187 B** |
| 第 2–10 个图标（边际，每个）lucide | +185 B | **+60 B** |
| 第 2–10 个图标（边际，每个）IconPark | +625 B | **+92 B** |
| IconPark 必需 CSS（`styles/index.css`） | 512 B | **+269 B** |

- 单图标「首个成本」IconPark 反而更低（共享运行时更小）；**边际成本 IconPark 是 lucide 的 ~1.5× gzip**（每个图标自带完整 path + 包装调用）。
- 按仓库规模外推（214 个不同图标）：lucide ≈ **+14.1 KB gzip**，IconPark ≈ **+20.3 KB gzip** ⇒ 净增 **≈+6.2 KB gzip**（+0.27 KB CSS）。相对 `scripts/check-bundle-budget.mjs` 的 **app-js 300 KB gzip** 预算 ≈ **+2%**，不构成阻碍。
- 和「包里有 2659 个图标」无关：`package.json` 的 `sideEffects: ["styles/**"]` 让 JS 可 tree-shake（实测包 44 MB 在 `node_modules`，产物只含用到的图标）。

### 3.2 离线可用性：**OK，0 外部依赖**

- `@icon-park/react` 是纯本地 npm 包：`es/**` 里 **0 处 `http(s)://`**、**0 个 `<script>`**、无 postinstall 脚本（`package.json` 无 `scripts`）⇒ 除了 `npm install` 那一次，构建与运行都不出网，与 lucide 同条件。
- 实测（`csp-offline.mjs`）：`Network.emulateNetworkConditions offline:true` + `navigator.onLine=false` 下，页面 **6/6 图标全部渲染**（`totalSvg=6, allRendered=true`）。
- 请求记录：只有页面本身 + favicon，**0 个外部请求**（`externalRequests: []`）。
- 结论：**不需要 CDN，不需要运行时网络**；仓库的「资源全本地化」口径（`vite.config.ts` CSP 注释）不受影响。

### 3.3 CSP 兼容：**OK，0 违规；且与 `verify-svg-csp.mjs` 无关**

- 先厘清仓库两套 CSP 的职责：
  - `scripts/verify-svg-csp.mjs` 验证的是**附件/资产服务器下发的 SVG 文件**（`electron/assetServer.ts#L322`：`sandbox; default-src 'none'; img-src data:; …`）——即用户上传的 `.svg` 被当 `<img>`/顶层文档打开时的行为矩阵。
  - 应用自身的 **inline SVG 图标**受页面 CSP 约束：`vite.config.ts#L26` 的 `PROD_CSP`（`default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; …`）。
  IconPark 与 lucide 一样是 **React 渲染的 inline `<svg>`**（不是 `<img src=…svg>`、不带 `data:`、不注入脚本、无内联 `style`），因此**不改动、也不触发**资产服务器那条 `sandbox` CSP；`verify-svg-csp.mjs` 的结论不受本次替换影响。
- 实测（`csp-offline.mjs`）：把 `PROD_CSP` **原文**注入独立页面，渲染 6 个 IconPark 图标：**0 条 CSP 违规**；6/6 渲染成功；`viewBox=0 0 48 48`、`stroke-width=3.5` 生效；包装 `span` 计算样式 `display:inline-block`。
- 唯一与 CSP 相关的点是 **CSS 的交付方式**：`styles/index.css` 经 JS import 由 Vite 打进产物（同源样式表），`style-src 'self'` 满足；若改为内联 `<style>` 也已被 `style-src 'unsafe-inline'` 放行。

### 3.4 `aria-hidden` / className / DOM 结构差异（会打到现有 CSS 与测试）

同一 props 渲染对比（`size=16, strokeWidth=1.75/3.5, aria-hidden, className='ln-x'`）：

```html
<!-- lucide 1.61.0 -->
<svg class="lucide lucide-search ln-x" aria-hidden="true" width=16 height=16 viewBox="0 0 24 24" …>
<!-- @icon-park/react 1.4.2 -->
<span aria-hidden="true" class="i-icon i-icon-search ln-x"><svg width=16 height=16 viewBox="0 0 48 48" …>
```

| 差异 | 影响（实测/静态核查） |
|---|---|
| `aria-hidden` 落到 `span` 而非 `svg` | 无障碍语义等价（整棵子树被隐藏），但**选择器/测试口径变了**：仓库现有 325 处 `aria-hidden`（含非图标元素），其中不少直接挂在图标上；若有用例断言 `svg[aria-hidden]` 会失败（静态核查：`src/**` 无 `.lucide` 类断言，但 `querySelector('svg')` 类用例仍可过，因为 svg 仍是后代） |
| `className` 落到 `span` | `svg` 失去业务 class ⇒ 依赖 `svg.xxx` 的样式/测试失配；`querySelector('.mb-list-item__check svg')` 这类**后代**选择器仍命中 |
| `<svg>` 无 class | 仓库 stroke-width 唯一来源 `svg.lucide{stroke-width:1.75}`（`src/styles/app/base.css#L27`）失效；`svg.lucide` 规则共 **9 条**需改 |
| 多一层 `span` | **29 条 `> svg` 直系选择器**失配（24 个 CSS 文件涉及 svg），需逐条改成 `.i-icon > svg` 或改结构 |
| 尺寸默认值不同 | lucide 默认 `size=24`；IconPark 默认 **`size='1em'`**（跟字体大小走）。仓库 **58 处**图标未传 `size`，替换后会随所在文字字号缩小（如 13px 正文里变成 13px） |
| 随机 id | 52 个图标用 `clipPath` + `props.id`（`useMemo(guid)` → `Math.random`）：同一图标每次挂载 id 不同，**快照/SSR 测试**会出现不稳定差异（本仓无 SSR，但 render 测试若要断言完整标记会抖） |

### 3.5 是否引入「第二套样式范式」？**是（撞 §3#14）**

- 新增**全局类族** `.i-icon` / `.i-icon-<name>` + 全局 `@keyframes i-icon-spin` + `vertical-align:-.125em`、`display:inline-block`、`line-height:0`（512 B / gzip 269 B）。这些值**不来自 `--lake-*` 令牌**，等于在 `ln-*` 之外新增一套图标几何/对齐模型。
- 该 CSS 从 JS import 时会被 `scripts/vendorCssLayer.ts` 自动包进 `@layer vendor`（层最低）——**这救了层序，但救不了范式**：图标自身的对齐/尺寸/主题仍由第三方模型决定，且我们若想修正只能新写 `.i-icon` 规则（正是「第二套」的定义）。
- 额外一套「图标语言」风险：IconPark 提供 **outline / filled / two-tone / multi-color 4 主题**（`theme` prop + `IconProvider`）。本仓 §3#14 定的是「只用 lucide 描边 1.75」，开放 4 主题等于把「线性单色」这一约束交给使用方自律。
- 与自绘图标的关系：仓库另有 **19 个文件 / 48 处内联 `<svg>`** 的自绘图标（`src/lib/notebookIcons.tsx`、`src/features/editor/noteRefIcon.tsx`、`lockedTextIcon.tsx`、`selectionToolbar/imageIcons.tsx`、`SyncStatusPopover.tsx` 等，描边 1.8/2 的 lucide 风格）。换成 IconPark outline 后，这些自绘图标的「lucide 味」会与 IconPark 的几何观感不同 → **部分替换 = 同一界面两套图标语言**，这正是 §3#14「同一个交互语义全仓只能有一套视觉与几何」要避免的。

### 3.6 维护/许可/安装面（依赖准入 ③）

| 项 | @icon-park/react | lucide-react（现状） |
|---|---|---|
| 版本 / 最后发布 | **1.4.2 / 2022-07-04（4 年 4 个月未更新）** | 仓库锁 1.61.0；最新 **1.73.0 / 2026-11-14** |
| 许可 | **Apache-2.0**（可商用，需保留 NOTICE） | ISC |
| 图标数 | 2659（其中 2528 纯描边、28 纯实心、102 描边+填充混合、52 用 clipPath） | 仓库用 214 |
| 包体积（node_modules） | 44 MB | 49 MB |
| 安装脚本 | 无（无 postinstall） | 无 |
| peer | react >=16.9（本仓 18.3 满足） | react 18 |

### 3.7 替换面规模与退出成本（依赖准入 ④）

- **替换面**：178 个文件 / 178 条 import / 897 处 named import / 约 917 个 JSX 渲染点 / **214 个图标映射**。
- **实际显示尺寸分布**（917 个渲染点）：14px **240**、16px **178**、15px **141**、13px **88**、18px **63**、12px **60**、20px **33**、17px 17、11px 7、19px 10、22px 8、24px 6、其余少量；**58 处未传 size（用 lucide 默认 24）**。
  → 换算系数是线性的（描边与 size 成比例），但**校正表要按这套尺寸逐一验**；小尺寸（13–15px）下 1px 的光学盒差就是 7% 观感差。
- **退出成本**：可逆（单一 import 源 + 映射表），但需要「保留 lucide 一个 release + 适配层可切回」；现有门禁**没有**任何「图标集/描边」断言，样式快照（桌面 stylesnap、移动 mobile-snap 10 态、bitable snap）会整体变色，**必须重烤基线**（AGENTS §3#21③），这本身就是一次全量视觉回归。

---

## 4. 两条红线逐条回答

### §3#14（`AGENTS.md`）：「图标只用 lucide（描边 1.75），禁 emoji/系统字形」+「同一个交互语义全仓只能有一套视觉与几何」

1. **直接冲突**：换成 IconPark 就是「图标源」变更，条文需用户裁决改写；不是 POC 能自行绕过的事项。
2. **描边 1.75 的单一来源会从 1 处变成 2 处**：现在是 `src/styles/app/base.css#L27` 一条 CSS；换后是 `IconProvider(strokeWidth=3.5)`（React 层）+ 可能的 `.i-icon svg` CSS 兜底 —— 「唯一来源」被破坏，需要同步改 `src/styles/tokens.css#L11` 的登记注释。
3. **「一套视觉几何」被打破**：IconPark 与自绘 19 文件（lucide 风格 1.8/2 描边）同屏会出现两种光学体系；若同时保留自绘，则**不满足**该条。

### §3#22（`AGENTS.md`）：依赖准入四问（缺一不引入）+ 末尾「**Lucide 维持**唯一图标源（保持 devDependencies）」

| 四问 | 实测回答 | 判定 |
|---|---|---|
| ① 解决已验证痛点（有实测证据） | POC 与仓库文档中**没有**「缺图标/图标不一致/图标导致 bug」的记录；换库动机是「设计语言对齐」而非缺陷修复 ⇒ 属 §3#17 的「为统一/优雅」类改动 | **不通过** |
| ② 会否引入第二套样式/令牌/preflight（撞 14） | **会**：`.i-icon` 全局类族 + 自有 CSS + 4 主题 + span 包裹（§3.5） | **不通过** |
| ③ 体积/离线/许可/打包成本算过 | 体积 **+6.2 KB gzip**（300 KB 预算的 2%）、离线 **0 外部请求**、许可 Apache-2.0、CSP **0 违规** ⇒ 成本可接受 | 通过 |
| ④ 退出成本与护栏（门禁覆盖、删得掉） | 可逆（单点适配层），但**无图标门禁**、快照要重烤、178 文件 917 点改动；「删得掉」但回归成本高 | 有条件通过 |

→ **四问里 ① ② 明确不通过**，且条文本身写明「Lucide 维持唯一图标源」⇒ 按现行 AGENTS，**不能引入 IconPark**；要换必须先由用户裁决修改这两条红线（属于「用户裁决改约束」的级别，需同步 DESIGN.md 图标/描边口径）。

---

## 5. 三选一结论与最小落地路径

### 5.1 方案对比（结论可直接支撑决策）

| 方案 | 改动面 | 视觉结果 | 红线 | 建议 |
|---|---|---|---|---|
| **A 全量替换** | 178 lucide 文件 + 19 自绘文件 + 全套 CSS 选择器 + 快照重烤 | 三种语言（IconPark + 自绘 + 内核 sprite）统一不了，反而更杂 | 需改 §3#14、§3#22 | ❌ |
| **B 部分替换**（只换 lucide 178 文件，自绘另议） | 178 文件 / 897 import / 917 点 / 214 映射 / 58 处补 size / 9+29 条 CSS | lucide 部分被 IconPark 替换，自绘仍是 lucide 风格 ⇒ 同屏两套图标语言 | 仍需改 §3#14、§3#22 | ⚠️ 仅当用户明确要字节视觉语言 |
| **C 不替换** | 0 | 现状（lucide 1.75 单一来源） | 完全合规 | ✅ **推荐** |

**推荐 C（不替换）** 的三条硬理由：
1. 换完**不是一模一样**（4/10 一致，平均偏差 9.2%，X +32%，Search 视觉中心偏 1.05px），达不到「只是换供应商」的预期，会变成一轮全量视觉返工。
2. **撞两条红线**（§3#14 单图标源/单视觉几何、§3#22 四问① ②），且依赖比现状**旧 4 年**（1.4.2 / 2022-07-04 vs 1.73.0 / 2026-11-14）——用「更新更稳」的理由也站不住。
3. 收益只停在「视觉语言更像字节」，属 §3#17 明确点名的过度设计信号（「统一/优雅/以后可能」），而代价是 917 个渲染点 + 214 条人工映射 + 快照全量重烤。

### 5.2 若用户裁决「要换」：最小落地路径（方案 B，分 7 步）

1. **先裁决红线**（阻塞项）：用户确认修改 `AGENTS.md` §3#14 图标条与 §3#22「Lucide 维持唯一图标源」，并在 `docs/DESIGN.md` 写下「图标源 = IconPark outline，描边 = 3.5/48（=1.75/24）」；同时登记 `src/styles/tokens.css#L11` 的单一来源改口。
2. **建唯一适配层**：`src/components/ui/icon.tsx`（唯一允许 `import '@icon-park/react'` 的文件），内部固定 `IconProvider { theme:'outline', strokeWidth:3.5, size }`、透传 `aria-hidden`/`className`/`size`；护栏 = 全仓 grep 只允许该文件 import 包（同 lucide 的单一来源思路）。
3. **214 条映射表 + 光学校正表**：用本 POC 的度量脚本批量出「墨迹覆盖比 / 外接盒 / 视觉中心」，对偏差 >10% 的图标给 `size` 系数或换变体（X→Close@size≈19、Check→CheckSmall、Search 单独校 y、Pencil 保留 Pencil）。映射表落 `src/components/ui/iconMap.ts` 并配一个断言测试（每个 lucide 名都有映射、无遗漏）。
4. **CSS 迁移**：`svg.lucide{stroke-width:1.75}` → 由适配层 `IconProvider` 承担；**逐条**修 29 条 `> svg` 直系选择器（改成 `.i-icon > svg`）与 9 条 `svg.lucide`；`styles/index.css` 仍走 JS import（自动进 `@layer vendor`，不在 kit 层写 `.i-icon`）。
5. **补 size**：58 处未传 `size` 的调用点显式补上（IconPark 默认 `1em`）；917 个渲染点按 §3.7 尺寸分布抽 14/16/15/13px 四档做一次 4× 实拍复核。
6. **门禁**：`npx tsc --noEmit` + `vitest run`（重点 `src/**/*.render.test.tsx`）+ `node scripts/ui-metrics.mjs` + `src/styles/cssLayers.test.ts`；样式快照按 AGENTS §3#21：桌面 `check-stylesnap.mjs --states <受影响态>`、移动 `check-mobile-snap.mjs --states <受影响屏>` **重烤基线**；`npm run check:bundle` 确认 app-js 仍 < 300 KB gzip。
7. **回滚预案**：适配层保留 `ICON_SOURCE=lucide|iconpark` 开关一个 release；`lucide-react` 先降为可选但**不要立即删**（保持 devDependencies），确认一个 release 无回退再删。

**自绘的 19 文件另议**：`notebookIcons.tsx`、`noteRefIcon.tsx`、`lockedTextIcon.tsx`、`selectionToolbar/imageIcons.tsx`、`SyncStatusPopover.tsx`、`ExpandLevelIcon.tsx`、`AiTagIcon.tsx`、`AiSparkIcon.tsx`、`FileBadgeIcon.tsx`、`bitableEditorModel.tsx` 等（48 处内联 `<svg>`，多为语义化插图/状态图形，非通用线性图标）。它们的描边是 1.8/2（lucide 风格手绘），与 IconPark 的 48 网格体系不同源，**建议保持现状**；若强行重绘，等于把「线性图标」和「插图」两件事一起做，成本与风险都不划算。

---

## 6. 复现与产物清单

| 产物 | 路径 |
|---|---|
| 独立工程（依赖全在 /tmp） | `/tmp/icon-poc`（`react@18`、`react-dom@18`、`lucide-react`、`@icon-park/react@1.4.2`、`@icon-park/svg@1.4.2`、`esbuild`） |
| SSR 对照页 | `/tmp/icon-poc/compare.html`（30 格：10 图标 × lucide/park@3.5/park@4） |
| 度量结果 | `/tmp/icon-poc/measure.json`、`/tmp/icon-poc/measure2.json`（候选变体） |
| 总览截图 | `/tmp/icon-poc/shots/_overview@2x.png` |
| 逐格 4× 截图 | `/tmp/icon-poc/shots/` 下的 `<图标名>--lucide@4x.png`、`<图标名>--park35@4x.png`、`<图标名>--park4@4x.png`（每张 96×96；图标名取 §2.4 表的 10 个） |
| 逐行带标签 4× | `/tmp/icon-poc/shots/row-01@4x.png` … `row-10@4x.png` |
| 候选变体（X/Check/Trash/Pencil/Search/Chevron 的 IconPark 同义变体） | `/tmp/icon-poc/shots/alternates@3x.png`（度量 `measure2.json`） |
| bundle 结果 | `/tmp/icon-poc/build/*.js`、`/tmp/icon-poc/bundle-measure.mjs` |
| CSP/离线结果 | `/tmp/icon-poc/csp-offline-result.json`、`/tmp/icon-poc/csp-test.html` |

⚠️ `/tmp` 是临时目录：需要长期留存请先 `cp -R /tmp/icon-poc /tmp/icon-poc-backup`（或按上表把 `shots/` 拷到仓库外归档目录）；本文档按任务要求引用 `/tmp` 绝对路径。

### 本次未做 / 边界

- 只在**独立工程 + SSR 同款 props** 下验证，**没有**在真实 Electron/移动端应用内跑替换；仓库代码只读（未改 `src`/`package.json`/`node_modules`，无 commit）。
- 只测 **outline 主题 + 单色 #000 on #fff**；未测深色主题、品牌色、hover/active 态、红点/徽标叠加场景。
- 只取 **top 10 高频图标**做逐像素对照；其余 204 个图标的映射与光学校正未逐个验证（§2.5 已证明这是必要工作量）。
- CSP 测试是把 `PROD_CSP` 原文注入独立页面，未跑完整应用构建；`verify-svg-csp.mjs`（资产服务器 SVG 矩阵）未改动、其结论不受影响（§3.3）。
- 未跑样式快照门禁（只读仓库）；§5.2 第 6 步列出替换时必须重烤的基线。
