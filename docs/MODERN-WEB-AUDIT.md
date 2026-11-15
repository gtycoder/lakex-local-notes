# 现代 Web 写法审计（261115）

> 审计范围：桌面 + 移动端的自有 Web UI/交互层（React/TSX/CSS/HTML），不含闭源 Lakex 内核、第三方编辑器（Univer/Drawnix/Plait）、画板/手写板/多维表领域引擎。
> 结论：**代码不是“旧语言”，但 UI 层确实有一批系统性的旧式平台用法**；不需要重写 React/TS，应按平台能力分批现代化。
> 快照：`fa97dd6a`（261115）。本文只记录事实、候选与计划，不含代码改动。

## 1. 检查方法

### 1.1 官方发布版分析器

```bash
npx modern-web-guidance@latest legacy-scan . --json
```

结果：**35 findings / 33 guides / 35 rules**。  
这是官方发布包（1.0.0）随包的分析器，官方自述只覆盖约 **20%** 的 guidance 语料；默认跳过 971 个文档/测试文件。

### 1.2 官方源码仓库完整分析器

发布包只有 35 条默认规则；源码仓库 `modern-web-guidance-src` 的 `src/analyzing` 有更多规则：

```bash
git clone --depth 1 https://github.com/GoogleChrome/modern-web-guidance-src.git /tmp/mwg-src
# 安装分析器运行依赖后
node --experimental-strip-types /tmp/mwg-src/src/analyzing/cli.ts legacy-scan <repo> --json
```

结果：**139 findings / 38 guides / 52 rules**。  
其中包含 `dist-electron/`、`dist-mobile/`、`android/app/src/main/assets/public/` 等构建产物；排除这些生成目录后为 **108 条真实源码 findings**（5 个 guide）：

| guide / rule | 数量 |
| --- | ---: |
| `ime-safe-enter-submit` | 33 |
| `js/copying-array-methods` | 53 |
| `js/error-cause` | 11 |
| `js/abort-signal-timeout` | 3 |
| `js/promise-with-resolvers` | 2 |
| `js/structured-clone` | 2 |
| `complex-shapes`（`-webkit-mask`） | 2 |
| `dark-mode` | 1 |
| `form-fields-automatically-fit-contents` | 1 |

> 静态分析输出是**候选**，修复前要按每条规则的 keep/drop rubric 复核；本文人工审计已把明显误报排除，但未逐条改写。

### 1.3 手工 UI 审计

官方规则只覆盖“确定性模式”，无法自动识别：

- 自定义 `<dialog>`/popover 体系；
- tooltip/title；
- 字体是否接 OS 文字缩放；
- 自研 select/表单控件；
- 图片尺寸/优先级；
- 容器查询、View Transitions、Anchor Positioning 等架构级模式。

因此对上述类别做了人工 grep + 抽样阅读，并在桌面/移动端各取代表组件。

## 2. 结论先行

- **确实不止 35 条。** 完整源码分析器 108 条，手工 UI 审计又发现一批规则未覆盖的系统性问题。
- **但不需要“全仓用新语言重写”。** 代码是 TS/React，问题集中在 Web 平台用法，不是语言版本。
- 最值得先做的三类：
  1. **CJK 输入法 Enter 误提交（33 处）**——真实用户可见 bug，风险最低。
  2. **浮层/对话框/Tooltip 体系**——自定义 focus trap/top-layer/title，UI 层面最大的历史包袱。
  3. **字体 px + 无 OS 文字缩放**——无障碍/大字号用户的实际缺口。
- 不应为“现代化”重写内核、画板/手写板、虚拟列表、React 组件模型；这些不是 legacy HTML。

## 3. 确定性 findings（工具报告）

### 3.1 IME-safe Enter（33，P0）

工具：`ime-safe-enter-submit`。  
桌面 20 处、移动 13 处；代表文件：

- 桌面：`BatchTagDialog`、`InlineRenameInput`、`SettingsPanel`、`TreeRowFace`、`bitableCells`、`BitableEditor`、`BitableKanbanView`、`AssetRenameDialog`、`lockedTextCard`、`SelectionToolbar`、`InkPageTabForm`、`QuickNotesWorkspace`、`QuickNoteTagPicker`
- 移动：`MobileAiPage`、`MobileBitableFieldSheet`、`MobileBitableRecordSheet`、`MobileBitableTableActions`、`MobileBitableViewActions`、`MobileBitableViewer`、`MobileFindBar`、`CreateNotebookSheet`、`SearchSheet`、`TagsHomeTab`、`NameSheet`

现代写法（官方 guide）：

```ts
function isImeConfirming(e: KeyboardEvent): boolean {
  // 兼容旧 Safari 的 229；Chrome/Android WebView 用 isComposing 即可
  return e.isComposing || e.keyCode === 229;
}

if (event.key === "Enter") {
  event.preventDefault();
  if (isImeConfirming(event)) return;
  // submit / rename / send
}
```

要点：

- 不能只看 `event.key === "Enter"`；中文输入法确认候选词时也会触发 Enter。
- 保留 Shift+Enter（textarea 换行）的既有行为。
- 不要用 `keyCode === 13` 作为“兼容旧代码”的替代；官方 guide 指出旧 keyCode 13 本来就不受 IME 影响，而迁移到 `event.key` 时反而容易引入 bug。

### 3.2 JS 现代 API（71，P3）

| 规则 | 数量 | 现代写法 |
| --- | ---: | --- |
| `copying-array-methods` | 53 | `[...arr].sort()` → `arr.toSorted()`；`reverse()` → `toReversed()`；反向查找 → `findLast()` / `findLastIndex()` |
| `error-cause` | 11 | `new Error(msg, { cause: err })`，不要把 cause 只拼进字符串 |
| `abort-signal-timeout` | 3 | 手写 `AbortController` + `setTimeout` → `AbortSignal.timeout(ms)` |
| `promise-with-resolvers` | 2 | 外部保存 resolve/reject → `Promise.withResolvers()` |
| `structured-clone` | 2 | `JSON.parse(JSON.stringify(x))` → `structuredClone(x)` |

这些不是 UI bug，收益主要是可读性/性能/错误链；建议在改到对应文件时顺手做，不做全仓机械替换。

代表位置：

- `electron/s3Store.ts`、`electron/httpFetcher.ts`、`electron/syncEngineController.ts`
- `src/core/s3v3/`、`src/core/bitable/`、`src/core/quickNoteSort.ts`
- `src/features/usheet/UniverSheetEditor.tsx:67`

### 3.3 CSS/表单（5）

- `complex-shapes`：`src/mobile/usheet/usheet-chrome.css` 使用 `-webkit-mask` 未配标准 `mask`，可加标准属性并保留前缀。
- `dark-mode`：`electron/boot.html:22` 的 dark media 未声明 `color-scheme`，应补 `color-scheme: light dark` 或改用 `light-dark()`。
- `form-fields-automatically-fit-contents`：`src/features/ai/AiAssistantDialog.tsx:187` 手写 `scrollHeight`，应改 `field-sizing: content`。

## 4. 手工 UI 审计（工具未覆盖）

### 4.1 浮层/对话框：自定义体系（P1，大工程）

证据：

- 原生 `<dialog>` / `showModal()`：**0**
- 原生 `popover`：基本 **0**
- 自定义 `Overlay`/`Menu`/`Popover`：约 **54 个文件**引用
- `Overlay.tsx` 自己实现 focus trap、`aria-modal`、Esc、焦点回归、滚动锁、`inert`

官方 `dialog` guide 的说法：

- 模态用原生 `<dialog>` + `showModal()`；
- 非阻断面板用 `<dialog popover>`；
- 菜单/tooltip 不是 dialog，用带 `popover` 的语义元素；
- 浏览器已提供 top-layer、焦点约束、Esc/返回键、焦点回归、`::backdrop`。

建议：**不要一次性替换 54 个文件**。先选 2–3 个独立确认框/简单菜单做试点，验证：

- 焦点返回、嵌套浮层、Esc/返回键；
- 滚动锁与 `:modal`/`::backdrop`；
- 与内核自有浮层、portal、右键菜单、移动端 Sheet 的层序；
- Android 旧 WebView 的 fallback。

### 4.2 Tooltip / title（P1–P2）

证据：`title="..."` 约 **327 处**；很多图标按钮同时有 `aria-label`。

问题：

- 触屏无法发现/触发；
- 读屏体验不稳定；
- 不能承载富内容；
- 大量重复的 title 与 aria-label 造成重复朗读。

现代方向（`interest-triggered-tooltips`）：

- `popover="hint"` + `interestfor`；
- 或统一 Tooltip 原语（基于 popover + anchor positioning），新代码不再散写 title。

建议：不要批量替换 327 处；先做统一 `IconButton`/Tooltip 原语，再逐步迁移按钮标题。

### 4.3 字体与 OS 文字缩放（P1，中工程）

证据：

- 桌面/移动字号 token 全部为 px（`10px`–`24px`）；
- 没有 `<meta name="text-scale" content="scale">`；
- 约 316 处固定 `height: Npx`。

官方 `respect-os-text-scale`：

- 用 `rem/em` 和 unitless line-height；
- 不覆盖 root font-size；
- 用弹性高度/换行，避免固定 height/max-height 裁切；
- 在 200% 字号与 320px 宽度下测试 reflow。

风险：字号 token 改 rem 会牵动大量固定高度、工具栏、表格行高；需要单独立项 + 全量视觉/设备回归。

### 4.4 表单/选择器（P2）

证据：

- `<form>`：1 处；
- 原生 `<select>`：3 处；
- `<input>` 约 117 个；checkbox/radio/date/range 约 68 处；
- `Select.tsx` 自述“原生 select 弹层不可控，所以自研”。

现代方向：

- 原生表单 + `requestSubmit()`、原生校验、`:user-invalid`；
- 可定制 `<select>`（`appearance: base-select`）在 Baseline 足够后替换自研 Select/Picker；
- `field-sizing: content` 替代 JS 自动撑高。

当前不紧急；建议新表单优先原生，旧控件按维护节奏演进。

### 4.5 图片尺寸/优先级（P2）

证据：

- `<img>` 约 **139 个**；
- `loading="lazy"`/`decoding="async"` 约 **8 处**；
- 多数没有显式 `width`/`height`（部分用 `imageBoxAttrs`/CSS 比例盒）；
- 没有 `fetchpriority`。

官方 `optimize-image-priority`：

- 首屏/LCP 图 `fetchpriority="high"`；
- 非首屏 `loading="lazy"`；
- `decoding="async"`；
- 有尺寸时写 width/height 或比例盒，减少 CLS。

本地资产多，收益低于公网图；优先小记卡片、文档预览、历史/回收站预览。

### 4.6 滚动条（P3，可能是有意设计）

- `::-webkit-scrollbar` 约 **74 处**；
- 标准 `scrollbar-width/color` 约 41 处；
- 部分 CSS 注释明确说明“Chromium 自绘优先，不能写标准属性”。

这属于平台特定写法；是否改取决于设计系统是否需要自定义滚动条。不要为了现代化强行统一。

### 4.7 响应式（P2/P3）

- `@media` 约 **54 处**，`@container` 约 **3 处**。
- 很多可复用卡片/面板仍按 viewport 宽判断。

不是错误；组件级自适应优先 container query，适合改具体组件时采用，不做全仓重写。

### 4.8 动效/滚动（P3，机会）

- View Transitions：**0**
- Anchor Positioning：**0**
- Scroll-driven animations：**0**
- 已有 `@starting-style`、`prefers-reduced-motion`。

现有自定义 morph、滚动监听、虚拟列表有领域原因；新交互可试点 View Transitions/Anchor Positioning，不能简单替换。

### 4.9 HTML 注入面（P2，安全观察）

实际 `dangerouslySetInnerHTML`/innerHTML 约 6 处：

- 搜索摘要 `buildSnippet` 已做完整 HTML 转义；
- QuickNote 工具条图标、内核 SVG sprite 使用本地常量；
- 未发现未转义的外部 HTML 注入。

当前没有明显 XSS 洞；官方 `sanitize-untrusted-html`/`trusted-types` 可作为后续安全加固，但不必为了“现代化”立即引入 Trusted Types。

### 4.10 不要改的“旧写法”

- `document.execCommand`：主要在内核选区/剪贴板/模型同步路径，不能换成普通 Clipboard API。
- 画板/手写板/多维表/canvas：领域实现，不是旧 HTML。
- 虚拟列表/滚动恢复：性能架构，不是 legacy CSS。
- React/TS 本身：不是本审计的现代化对象。
- 现有 `@layer`、`:has`、`@starting-style`、`inert`、`prefers-reduced-motion` 等已经现代，不需要重写。

## 5. 建议的实施顺序

### Phase 0：真实 bug + 小修（优先）

- 33 处 IME-safe Enter：抽共享判据 + 全部接入 + 合成 Composition 测试。
- `AiAssistantDialog` 的 `scrollHeight` → `field-sizing`。
- `electron/boot.html` 补 `color-scheme`。
- 可选：`Error.cause`、`AbortSignal.timeout`、`Promise.withResolvers` 等低风险 JS 现代化。

### Phase 1：可访问性/视觉基础

- 字体 token rem 化 + `meta text-scale`；先做字号与关键面板，再处理固定高度。
- 统一 Tooltip/IconButton 原语，逐步减少 `title`。
- 图片尺寸/懒加载/优先级统一（优先小记/文档/预览）。

### Phase 2：浮层体系试点

- 2–3 个确认框/简单菜单迁移原生 `<dialog>`/`popover`；
- 验证焦点、Esc/返回键、嵌套浮层、内核 portal、移动端 Sheet；
- 成功后再扩大，不一次性替换全部 Overlay。

### Phase 3：渐进平台能力

- 新组件使用 container queries；
- 在明确收益处试用 View Transitions/Anchor Positioning；
- 评估 customizable select 替换自研 Select。

## 6. 验收标准

- 重新跑完整源码 analyzer，目标 guide 的 findings 清零或逐条说明保留理由。
- `npx tsc --noEmit`、相关 vitest、`git diff --check`。
- 桌面 + 移动端设备验证（尤其 IME、焦点、键盘/返回键、浮层层序）。
- 不改变内核模型/同步语义；不触碰正式数据目录。
- 每批改动保持可回滚，不把“现代化”与功能改动混在同一提交。

## 7. 复现命令

```bash
# 官方发布版（较少规则）
npx modern-web-guidance@latest legacy-scan . --json

# 官方源码版（更多规则；需在源码仓库安装分析器依赖）
node --experimental-strip-types /tmp/mwg-src/src/analyzing/cli.ts legacy-scan <repo> --json

# 只查一条规则
npx modern-web-guidance@latest legacy-scan . --json --guide ime-safe-enter-submit
```

## 8. 残余未知

- Android 目标 WebView 的最低版本未在本审计中逐台验证；`dialog`/popover/customizable select/View Transitions 必须按实际最低版本 feature detect。
- 官方 analyzer 仍只覆盖部分 guide；本审计的手工清单不是 208 个 guide 的逐条认证。
- 字体 rem 化、原生浮层替换都属于跨组件工程，需先做试点与视觉/设备回归，不能按“扫描清零”作为唯一目标。
