# 更严格修改的剩余清单（261116 · v2 审计之后）

> 用途：回答「确定都做好了吗？如果要做更严格的修改，还有什么要做的」。
> 关系：[MODERN-WEB-AUDIT.md](../MODERN-WEB-AUDIT.md) v2（261115）给的是**审计与处置**；本文只做**事后核对 + 更严格候选 + 批次建议**，不重复审计全文。
> 纪律：本轮**只读仓库代码**（未改 src/、scripts/、package.json，未 commit）；依赖与语料一律在 `/tmp`。本文是唯一写入。
> 快照：分支 `modernize/web-platform-261115`，HEAD `80ead487`（60 commit，master 仍 `7e2db298`）。读取时工作树有**并行会话的未提交改动**（A13 原生下拉 `align-items:center` + 6 个 stylesnap 态重烤、移动开关几何、设置动作行对齐）——本文结论以 **HEAD 已提交代码** + 本轮只读实测为准，不依赖工作树状态；行号按 HEAD，工作树有并行改动时可能漂移 1–6 行。
> 复跑：扫描 **1194 个文件**（`src/**` + `electron/**` + 根 `index.html`/`mobile.html`，排除 `*.test.*`、docs/scripts/android/dist/vendor；v2 口径 1183）；targeted vitest **7 文件 / 34 例**（读取时全绿；写作末尾并行会话改动后复跑 1 红，见 §1）；`node scripts/ui-metrics.mjs` 全过；运行时 CDP 只读探针（Chromium 152.0.7977.167 / Electron 44.9.3）。

## 0. 结论先行

**「都做好了吗？」——没有到「全绿」，但到了「用户可见的主干已收口，剩的是验证与收尾」。**

- **30 项盘点**：**22 项已落地/已验证**；**4 项要补验证或重开** = A03（200% 全屏未走）、A06（长任务只测了搜索）、**A20（v2 结论被本轮实测推翻）**、A23（anchor positioning 后半有意不采用）；**4 项明确不做/不适用** = A05（用户裁决）、A11（无静态触发）、A28（风险>收益）、A30（定稿格式）。
- **最关键的反例（本轮新证据）**：A20 写「`will-change` 10 处真实使用全部绑动画/位移」，但 `src/styles/app/shell.css:777-781` 的 `.tree-row` 是**常驻** `will-change: transform`。CDP `LayerTree` 实测：注入 `.tree-row{will-change:auto}` 前后合成分层 **31 → 65**（差 34 = 当页 34 行）；10k 库（HANDOFF §1 实测 10,022 行）意味着最多约 1 万个常驻合成层。A20 必须重开。
- **真正值得做的「更严格」只剩 7 件**（§5/§6，按优先级）：① A20 `will-change` 收敛（P1）② 200% 字号进快照门禁（P1）③ A13 原生下拉 picker 图标/对勾收尾（P2）④ `forced-colors` 门禁态 + 扩展（P2）⑤ boot 图片解码/首屏字节（P2）⑥ 移动 `enterKeyHint` 扩展（P2）⑦ 多维表表单「首个错误聚焦 + aria-invalid」（P2/P3）。
- **其余一律不建议**（§7 逐条给理由，含 v2 §7 全部 12 项、减 `!important`、`@property`、`interestfor` 重写、移动 Sheet 迁 `<dialog>` 等）。不做不是懒：每条都写了「不做会付什么代价 / 为什么收益不抵风险」。
- **验证底座（不是引用）**：targeted vitest 读取时 34 例 pass（写作末尾并行改动后 1 红，非本文改动，见 §1）；`ui-metrics` desktop `!important` **9/9 清单**、mobile **19/19 基线**、颜色字面量 0、跨文件重复 45/45、`shadowedDecls` 0；HANDOFF §1 记录桌面 42 态 / 移动 10 态 / 多维表 3 态 / 23 屏走查 23/23 / 平板窗口矩阵 7 档 pass。

## 1. 口径、快照与边界

| 项 | 本轮值 | 说明 |
| --- | --- | --- |
| HEAD | `80ead487`（261116） | 60 commit；master 仍 `7e2db298`，tag `backup/master-261115` |
| 工作树 | 写作期间并行会话持续改动（末尾 10 文件 modified + 3 个新目录；含 A13 居中 + 6 态重烤、开关/设置动作、主题/图标 WIP） | 本文不碰；只读核对。**当前 `cssLayers` 有 1 红：`styles/kit.css` 712→713（并行改动，非本文）** |
| 扫描文件 | 1194 | v2 为 1183；排除规则同上 |
| 运行时 | Electron 44.9.3 / Chromium 152.0.7977.167 | CDP UA 实测，与 v2 一致 |
| 已跑 | targeted vitest（styles/overlay 7 文件 34 例，读取时全绿）、`ui-metrics`、CDP 只读探针 | 未跑全量 vitest / 42 态 stylesnap / 设备；写作末尾并行会话改动后 `cssLayers` 1 红（见下） |
| 未跑 | 全量套件、桌面 42 态、移动 10 态、Android 设备点收 | 本轮是文档任务，不把整轮扫描当阻塞项（modern-web-verify 并行复跑） |
| 行号 | 按 HEAD | `kit.css` 有并行改动，行号可能漂移；涉及处已用选择器名兜底 |

**计数口径提醒**：本文所有静态计数都是「源码命中行/元素」；带注释的文件（如 `kit.css`）按 grep 口径会偏高。凡与 v2 数字不同，本文给出差异原因（§9）。

## 2. A01–A30 逐项现状（不信 v2 自述，逐项核对代码）

> 图例：✅ 已落地且证据在位；◐ 部分/验证未闭环；❗ 结论需重开；⛔ 明确不做/不适用。commit 均为本分支短 hash。

| ID | v2 判定 | 本轮代码/实测证据（HEAD） | 结论 | 更严格? |
| --- | --- | --- | --- | --- |
| A01 | P0 命中 | `src/core/ime.ts:28-31` 唯一判据；调用 **35 处 / 27 文件**（复测 `isImeConfirming(` 37 次 / 28 文件，含定义）；`ime.test.ts` + `imeEnterWiring.test.ts`；`f55bc35b` | ✅ | 无 |
| A02 | P1 命中 | `Overlay.tsx:348` `NativeDialog`、`:413` `<dialog>`、`:362-363` `showModal()`；源码 `<NativeDialog` **28 调用 / 26 模块**（26 普通 + 2 顶部对齐）；保留浮动 6（`SettingsPanel.tsx:26` / `HistoryPanel.tsx:267` / `TrashPanel.tsx:451` / `NoteInfoDialog.tsx:134` / `PublishDocDialog.tsx:73` / `SaveQuickNoteDialog.tsx:38`）+ `Drawer` 1；`overlay.css:61-79` 原生表面 + `::backdrop`；`980a5619/496744fb/229e78ec/64ef15b4/b5e6fecd/4181198c` | ✅（6 浮动=有意保留） | `closedby` 无真实缺口 → 不做（§7） |
| A03 | P1 命中 | 两端 `<meta name="text-scale">`（`index.html:10`/`mobile.html:16`）；字号令牌 11 档全 rem（`themes/base.css:108-118`）；28 条文字容器 `height→min-height`；复测纯 `height:Npx` **287**（D160/M125/E2）+ `min-height` **108**；200% 程序化扫描桌面剩 2 处（1px 屏读/装饰）；400% 桌面 27→2；移动 200%/400% 各 9 处固定 chrome（接受）；`75153e8e/60d851fe/db793240/6c0fdfa0/8a828e74/87b3dbc1/bff0c792/4cf6e783` | ◐ 主体完成，验证未闭环 | 200% 快照门禁（§5 S2） |
| A04 | P1 命中 | `lib/nativeTitleTip.ts:47-59` 可访问名判据、`:67-252` 拦截器、`:131-133` `aria-describedby`；桌面 `App.tsx:1039`、移动 `MobileApp.tsx:854` 各挂一次；`aria-describedby` 21/8 文件；`88bd4211` | ✅ | `interestfor` 重写不建议（§7） |
| A05 | P1 | 无 commit；`content-visibility` 3 处（`shell.css:398`/`outline.css:399`/`inkPad.desktop.css:210`）；10k 库 10,022 行 / 约 20.1 万 DOM（HANDOFF §1） | ⛔ 用户裁决不做 | 不重开 |
| A06 | P1 | `scheduler.yield` 0、`useDeferredValue` 0、`startTransition` 0；LoAF 只测「全文搜索输入」= 0 个 >50ms；导入路径**本来就让出**（`importPortable.ts:131/215` `setTimeout(0)`、`markdownImportPipeline.ts:307/318` `nextFrame/sleep`）；`ff06bdff` | ◐ 结论成立但测量面窄 | 补测导入/导出（§5 S8） |
| A07 | P1 命中 | `index.html:8`、`mobile.html:14` `<meta name="color-scheme">`；`boot.html:6/11/12`；`themes/light.css` 的 `:root` 本就有 `color-scheme`；`14dcdf15` | ✅ | 无 |
| A08 | P1 命中 | `electron/boot.html` **1,864 B**；`boot-anim.apng` **328,449 B** + `boot-poster.png` **27,756 B** 仍在启动页（`boot.html:36-37`；APNG 必然加载，poster 未加 lazy、是否真下载未测）；`14dcdf15` | ✅ 已修（字节未减） | 解码/延迟（§5 S5） |
| A09 | P1 命中 | `Overlay.tsx:83-112` 背景 inert（引用计数/跳过自有 portal/drawer 不动）；`Overlay.test.ts:105-152` 4 例；`MobileSheet.tsx:51-77` + `MobileSheetInert.render.test.tsx`；`84dc8005/de4fb006`；源码 `role="dialog"` **17 元素**、`aria-modal` **14**，差的 3 个是**非模态**（`EditorDock.tsx:836`、`InkPagesPanel.tsx:268`、`InkPageTabButton.tsx:61`） | ✅（v2「aria-modal 校准仍待」已过期） | 无 |
| A10 | P2 | `keyboardActivationGates.test.ts:20-39` 钉 3 类真缺口（色板/历史列表/移动标签行）；`4d6d9e39`；`role="button"` 28/23 文件 | ✅ | gate 只覆盖 3 处 → 可选扩，不建议单独立项 |
| A11 | P2 | `commandfor`/`command=` **0**（复测）；运行时 `commandForElement` 在 `HTMLButtonElement.prototype` 为 true（CDP）；对话框全由 React 状态打开 | ⛔ 不适用 | 新静态 dialog 约定用，不立项 |
| A12 | P2 | `features/ai/aiDialogParts.css:52-53` `field-sizing: content` + 上限滚动；`AiAssistantDialog.tsx:185` 注释；`modernCssGates.test.ts:32-35`；`7a0dc111`；全仓实际 2 条 `field-sizing`（另一条 `bitableEditor.css:415`） | ✅ | 无需扩（12 个 textarea 多为定高/读只） |
| A13 | P2 | `NativeSelect.tsx:17-23`、`AdaptiveSelect.tsx:17-22`、`<AdaptiveSelect` **13 个调用点**（13 例 rollout 测试）；`kit.css` `.ln-select--native` + `::picker(select)`；`Select.tsx` 一行未改（`git diff 7e2db298..HEAD` 为空）；运行时 `CSS.supports('appearance','base-select')=true`；`fd39d1bd/5e7a8cd8/bec6edab/80ead487` | ✅ 13/13 | **picker 图标/对勾/selectedcontent 未做**（§5 S3） |
| A14 | P2 | `enterKeyHint` 6 次 / 5 文件；`mobile/ui/enterKeyHint.test.ts:18-24` 钉 5 个入口；`c4b47e9b` | ✅（审计范围） | 其余移动文本输入约 15 处缺（§5 S6） |
| A15 | P2 | `loading="lazy"` **10**、`decoding="async"` **11**；`imageAttrGates.test.ts:19-30` 钉 9 宿主/10 图；`1d07fd60`；boot 2 张图两者都缺 | ✅（审计范围） | boot/2 处启动图 + 少量 data URL 图（§5 S5） |
| A16 | P2 | `kit.css` `@media (forced-colors: active)` 1 块 **8 声明**（按钮/图标钮/输入/菜单/气泡/dialog/行/勾选）；`prefers-contrast` **0**；`ea10e334/fc31e534` | ✅ 原语级 | **没有模拟高对比度实测/门禁态**（§5 S4） |
| A17 | P2 | `@container` **2**（`panels.css:62` 回收站、`dialog.css:103` 属性弹窗）+ `container-type` 2；`ceb1e150` | ✅ | 无需扩（其余候选改动面×重烤成本不划算） |
| A18 | P3 | 源 CSS **4 条声明**：`overlay.css:113` pretty、`:128` balance、`settings.css:117` balance、`dialog.css:28` balance；构建产物副本使全仓 grep 为 9 | ✅ | 不建议扩（单行标题不生效） |
| A19 | P3 | `-webkit-overflow-scrolling` **0**；`7a0dc111` | ✅ | 无 |
| A20 | P3 | `will-change` 18 行（含注释）/ **8 条真实声明**；**`.tree-row` 常驻**（`shell.css:777-781`，自 `9025426b` 起）；CDP：注入 `.tree-row{will-change:auto}` 后合成分层 31→65（差 34=当页 34 行） | ❗ **重开**（v2 结论不成立） | **收敛**（§5 S1，P1） |
| A21 | P3 | `toSorted` 63/35 文件、`toReversed` 8、`withResolvers` 7、`cause` 4、`AbortSignal.timeout` 3 处代码、`structuredClone` 2；tsconfig ES2024 + `es2024Fallback` 两端入口（`main.tsx:10`/`mobile/main.tsx:14`）；`84af9e42/69631b9c` | ✅ | 无 |
| A22 | P3 | 4 处 `target="_blank"` 全带 `rel`：`lakeDocForm.ts:38`、`QuickNotePreview.tsx:43`、`MobileBitableValue.tsx:100`、`AiMarkdown.tsx:25` | ✅ | 无 |
| A23 | P3 | 模态内菜单/气泡 `popover="manual"` 进 top layer（`Overlay.tsx:155-195`、`overlay.css:133-137`）；`anchor-name/position-anchor/anchor()` **0**；`980a5619`；运行时 `anchor-name`/`position-try-fallbacks` 支持=true | ◐ 前半已修/后半不采用 | 不建议（§7） |
| A24 | P3 | `outline:none/0` **39 行 / 20 文件**；`focusRingGates.test.ts:18-30` 钉 5 条 wrapper 环；审计后新增 5 行均带替代（`git diff` 复核）；`2d5f5b2d` | ✅ | gate 只钉 5 条 → 可选扩，不建议单独立项 |
| A25 | P3 | `usheet-chrome.css:260-261/278-279` 标准 `mask` + `-webkit-mask` 各 2；`modernCssGates.test.ts:37-41` 计数相等；`7a0dc111` | ✅ | 无 |
| A26 | P2 | 同 A07；`14dcdf15` | ✅ | 无 |
| A27 | P3 | `boot.html` `color-scheme: light dark` + `light-dark()`；`14dcdf15` | ✅ | 无 |
| A28 | P3 | 无 commit；`pagehide/visibilitychange` 26 + `beforeunload` 7（v2 计数，本轮未变） | ⛔ 不做（原判） | 不重开 |
| A29 | P3 | `App.tsx` `<main className="workspace"`；`MobileApp` `role="main"`；两端搜索面 `role="search"`；`landmarkGates.test.ts`；`ef02a966` | ✅ | 无 |
| A30 | 不做 | 无 commit；`Intl` 仅 `textStats.ts`；`padStart(2,"0")` 11 处 | ⛔ 不做（定稿格式） | 无 |

**22 个 ✅ 项里只有 2 个是「文档层面没写清」而不是「代码没做」**：A09 的 `aria-modal` 校准实际已满足（3 个非模态面板正确不带 `aria-modal`），A18 的「9 处」是构建产物副本造成的高计数。**A20 是唯一「v2 结论被代码推翻」的项。**

## 3. v2 §2.4「待验证 32 篇」：能定性的都定掉

> v2 把 32 篇归成 7 组；本轮逐组给结论。**不能定性只剩两组**：浮层三层同屏、200% 逐屏（进入 §5 S2/S4）。

| 组 | 篇数 | 本轮结论 | 证据 | 剩余 |
| --- | --- | --- | --- | --- |
| 触控命中/形态适配 | 6 | **已验证（装置级）** | `mobile-walkthrough.mjs:17/38/51` 有 `smallTap` 口径；HANDOFF §1：23 屏走查 23/23、平板窗口矩阵 7 档 pass | 200% 单独归 A03 |
| 键盘/读屏语序 | 6 | **不做（用户 261116 裁决）**；既有 `aria-*`/`inert`/焦点环保留 | `6f0dcce7`；PRODUCT 明确不承诺读屏 | 键盘可达性仍在基线（`focusRingGates`/`keyboardActivationGates`） |
| 图文/媒体优先级 | 4 | **已验证（不适用）**：LCP 两端都是文字 | 移动冷启动 LCP **88ms**（`span.mb-launch__label`）；桌面 **1536ms**（内核 `ne-p`）；`fetchpriority` 0 有依据；`0dedaf9e/8640ea17` | 无 |
| combo/筛选控件语义 | 4 | **已定性**：桌面筛选/设置类下拉已全走原生 `<select>`（A13 13/13）；自研 `Select` 只在 `baseSelectSupported()=false` 时兜底，且本身有 `aria-haspopup=listbox`/`role=listbox`/`role=option`/`aria-selected`（`Select.tsx:16,89-134`） | 13 例 rollout 测试（`nativeSelectRollout.render.test.tsx`，双路径） | 无真实输入型 combobox 场景；不建议再造测试 |
| 长任务/INP | 4 | **部分**：搜索输入实测 0 个 >50ms；导入链路本来就让出（`setTimeout(0)`/`nextFrame`），不是「无让步」；docx/批量导出/10k 筛选未测 | A06 行；`importPortable.ts:131/215`、`markdownImportPipeline.ts:307/318` | 补测导入/导出（§5 S8，只测不改） |
| 浮层层序/嵌套 | 8 | **部分已验证**：overlay-matrix 抓到并修了 2 个真问题（模态 dialog 内菜单挂进 dialog、关闭后焦点不落 body），并有 jsdom 护栏 + 应用内 CDP 实测 | `4181198c`、`Overlay.tsx:39-59/155-195`、`Overlay.test.ts`、`overlayContainer.test.ts`、`MobileSheetInert.render.test.tsx`、v2 §11.3 | **内核 portal（`.ne-overlay-container`）× 自绘 overlay × 移动 Sheet 三层同屏**未测（§10 残余未知 2） |
| 400% 字号（v2 附加） | — | **桌面已收口**（设置页文字溢出 27→2；余 2 处是 1px 屏读/装饰）；移动 9 处固定 chrome **接受** | v2 §11 A03；MERGE-REVIEW §4 | 200% 逐屏归 §5 S2 |

## 4. v2 §4 手工 findings：剩余项逐节核对

### 4.1 浮层体系（原 P1，最大一块）
- 现状：原生 `<dialog>` **1 个组件（28 调用）**、`showModal` 有；自绘浮动 `<Dialog>` **6** + `Drawer` **1**（有意保留，拖拽/缩放/外点语义）；源码 `role="dialog"` 17 元素、`aria-modal` 14（3 个非模态正确缺）；`createPortal` 收敛在 Overlay。
- 还差的不是「迁移数量」，是**新能力的完整性**：`closedby` 0、`<selectedcontent>`/picker 图标 0（A13 遗留）、`forced-colors` 未覆盖原生 dialog/backdrop。前两项本轮判定**不建议**（无真实失败面，§7）；picker 图标列入 §5 S3。
- 不建议一次性迁剩余 6 浮动：它们靠 `transform: translate(-50%,-50%)` + `useFloatingDialog` 拖拽坐标，换 top-layer 的收益只剩架构统一，风险是拖拽坐标/缩放交互（AGENTS §3#17 + v2 已裁决）。

### 4.2 声明式触发 `command`/`commandfor`
- 复测 **0**；运行时 `commandForElement` 在 Chromium 152 为 true。结论不变：**不适用**——本仓对话框全由 React 状态/菜单打开，没有「静态按钮 ↔ 固定目标」对子。已写进 `NativeDialog` JSDoc；新静态 dialog 再用。不立 backlog 项。

### 4.3 Tooltip / `title`
- A04 已修：共享 `nativeTitleTip.ts` + 两端薄壳（桌面 `App.tsx:1039`、移动 `MobileApp.tsx:854`）；focusin 只在「另有可访问名」时摘 title（`nativeTitleTip.ts:47-59/143-148`）；显示期间补 `aria-describedby`（`:131-133`）；移动长按 450ms（`:189-205`）。运行时当前页 **219 个 `[title]` 元素**（CDP），拦截器是承重的。
- 更严格的原生路线（`interestfor` + `popover="hint"` + anchor positioning）运行时**全部支持**（`interestForElement` 在 button/anchor 为 true、`anchor-name`/`position-try-fallbacks` true），但 guide 要求「内容在 DOM 里、每个触发器有固定目标」——283 处裸 `title` 要逐处变成 `<span popover>` +`interestfor`，改动面与 A04 的收益完全不成比。**不建议**（§7）。

### 4.4 表单与输入
- `<form>` 复测 **1**（`InkPagesPanel.tsx:88`，页签表单；不是提交语义；v2 写 0 是口径差）；`enterKeyHint` 6 次/5 文件；`field-sizing` 2 条；`:user-invalid` **0**；`aria-invalid` 只在设置原语（`settingsPrimitives.tsx:41/61`、`mobile/ui/settingsPrimitives.tsx:58/80`）。
- **真缺口（v2 提到但未进 A 清单）**：多维表表单必填校验只有底部一条 `role="alert"`（桌面 `BitableFormView.tsx:65-77/186`；移动 `MobileBitableFormView.tsx:88-107`），没有字段级 `aria-invalid`、没有把焦点送到第一个缺失字段。列入 §5 S7。
- 不建议引入原生 `required`/`:user-invalid` 体系：本仓没有提交语义、全即时保存，原生约束校验会引入浏览器气泡与新的 Enter 语义；按 AGENTS §3#17 不做。

### 4.5 OS 文字缩放
- 见 A03：meta 2、令牌 rem、28 条容器 min-height、200%/400% 扫描；移动 200%/400% 各 9 处固定 chrome 是**已知接受项**（超出 WCAG AA 的自愿范围，可见溢出非隐藏裁切）。状态栏成对改高整条跳过（要同时重算 `--statusbar-reserve:42px` 与 22px 档，风险>收益）。
- 仍缺的是**验证**而不是改造：200% 只在设置页与小记两道程序化扫描过，没有进 42 态基线；见 §5 S2。

### 4.6 图片 / 媒体 / 首屏字节
- 源码 `<img src>` **26 个**（含导出 HTML 模板；交互面 9 宿主 10 图被 `imageAttrGates` 钉住）；`loading=lazy` 10、`decoding=async` 11；`ImageLightbox`/`AttachmentPreview` 有意不 lazy（点开即看）。
- 首屏：`boot.html` 已从 476KB 降到 1.9KB，但 **328KB APNG + 27.7KB PNG 仍在启动页**（A08 只减了 HTML 解析，未减字节）；两张 `<img>` 都缺 `decoding=async`，poster 是 `display:none` 且没有 `loading=lazy`（是否真下载本轮未实测）。列入 §5 S5。
- LCP 是文字（88ms/1536ms），所以 `fetchpriority` 保持 0 是对的；多密度 `srcset` 仍不做（本地单档 `?w=1024` 已定稿）。

### 4.7 CSS 现代特性矩阵
- `@property` **0**；`@container` **2**/`container-type` 2；`prefers-contrast` **0**；`text-wrap` 源 **4 条**（构建副本 9）；`forced-colors` **8 声明**；`will-change` 18 行（A20 重开）；独立 `transform` 属性 0（随动效专项，不建议）；`-webkit-mask` 已补标准；滚动条自绘成对写是设计选择。
- 不推荐项：`@property`（无用户可见问题，会牵动 4 主题 + 快照序列化）、`oklch`（v2 §7 已否）、独立 transform（动效专项）。`prefers-contrast` 可选（§7 观望）。

### 4.8 移动端视口 / 键盘 / 手势
- 整体已现代：`dvh` 10 处、`visualViewport` 单例、`--mb-app-h` 只在与视口不同时写、`overscroll-behavior` 24、safe-area 7、`touch-action` 37。残留 2 处 `100vh` 是**内核菜单夹高**（`mobile.css:898-899`），可换 `100dvh` + 老 WebView 回退，但只影响键盘态菜单高度，**可选不立项**。
- `-webkit-overflow-scrolling` 已清零（A19）。

### 4.9 长列表与 INP
- `content-visibility: auto` 3 处真实使用（tree/outline/ink panel）；10k 树仍是 20.1 万 DOM（A05 用户裁决不做）；`requestAnimationFrame` 70 处（drag/scroll/measure，非「无谓 rAF」）、`requestIdleCallback` 17；`scheduler.yield`/`useDeferredValue`/`startTransition` 仍 0。
- 本轮新增结论：**导入/导出不是「无让步」**——`importPortable` 按页/批 `setTimeout(0)` 让出，Markdown 导入每段 `nextFrame`/`sleep`。所以 `scheduler.yield` 的严格版只剩「补测 + 量到 >50ms 再换」，不建议先改代码（§5 S8）。

### 4.10 无障碍语义
- 桌面/移动背景 inert 都已做（A09）；`role="dialog"` 17/`aria-modal` 14 已自洽；`outline:none` 39 行（20 文件）里新 5 行均带替代，gate 只钉 5 条 wrapper 环；`:focus-visible` 68；`role="button"` 28/23。**不建议**为了「更严格」把可点 div 全量换 `<button>`（A10 已按真缺口收口，换标签会带来样式复位与 DOM 结构变化）。
- 表单字段级错误（§5 S7）是这块唯一剩下的真实收益。

### 4.11 JS 现代 API
- A21 已收口：`toSorted`/`toReversed`/`withResolvers` + runtime 兜底；`cause` 4、`AbortSignal.timeout` 3、`structuredClone` 2。`Intl` 只用于 `textStats` 是**定稿格式**，不做重写（A30）。

### 4.12 安全面
- 无洞；`rel` 已全（A22）；CSP 单一来源不变；Trusted Types 仍不做（v2 §7）。

## 5. 更严格候选（S1–S8）：只列「有真实收益且不撞红线」的

> 每条含：现状证据 / 要做什么 / 改动面 / 风险 / 门禁成本 / 红线与 §7 / 建议批次。**不建议项见 §7（v2 §7 的 12 项 + 本轮 13 条额外候选）。**

### S1 · A20 重开：`.tree-row` 常驻 `will-change` 收敛（P1，推荐）
- **证据**：`shell.css:777-781` `.tree-row { transition: transform …; will-change: transform; }`（`9025426b` 起）；`git log -S 'will-change: transform' -- src/styles/app/shell.css` 只有它；CDP `LayerTree` 实测：注入 `.tree-row{will-change:auto}` 前 **65** 层 / 后 **31** 层，差 **34 = 当页 `.tree-row` 数**；10k 库 ≈ 10,022 行。
- **要做什么**：把 `will-change` 从基类挪到「拖拽/排序窗口」——例如 Sidebar 拖拽开始时给 `.app-shell` 加 `data-tree-sorting`（或复用 `is-dragging` 类），CSS 写 `.app-shell[data-tree-sorting] .tree-row { will-change: transform; }`；排序动画结束撤掉。保留 `.tree-row` 的 transition 不变。
- **改动面**：`shell.css` 1 条 + `Sidebar.tsx` 1–2 处状态类 + 2 个 stylesnap 态（`drag:1315:light/dark` 的 PROPS 含 `willChange`）+ 1 个 10k 实测；**桌面**。
- **风险**：中——若层提升晚于首帧，拖拽/排序首帧可能掉帧。**先测后改**：10k seed 下量 LayerTree 层数 + 拖拽 LoAF/帧率；掉帧就回退（只这一条 CSS + 1 个类）。视觉零变化。
- **门禁成本**：`check-stylesnap --states drag:1315:light,drag:1315:dark` 2 态重烤；`ui-metrics`/`cssLayers` 无声明数变化（只是移动规则）；全量 42 态不必重烤（其余态 `willChange` 计算值不变）。
- **红线/§7**：不撞；与 A05「不做窗口化」正交（不做窗口化也能收敛层数）。
- **批次**：**批 2**（先测后改）。

### S2 · 200% 字号进快照门禁（P1，推荐）
- **证据**：`textScale.test.ts:47-62` 只钉「令牌 rem / 默认等价 / 无根字号覆盖」；`stylesnap.mjs:148-193` 的 `pin()` 只支持 `Emulation.setEmulatedMedia`，**没有根字号档位**；42 态全在 16px 下；200% 仅在设置/小记两道程序化扫描（桌面剩 2 处 1px 屏读，移动 9 处固定 chrome 接受）。
- **要做什么**：给 `stylesnap.mjs` 加一个 `fontScale` 状态钩子（reload 后 `document.documentElement.style.fontSize = "32px"`，等 DOM 稳定再采）；新增 3 个态（`plain/settings/quicknotes @1315 light, 32px`），首轮用审计的「`overflow:hidden` 且 `scrollHeight>clientHeight` 的文字元素」探针把差距量出来，再决定是否修。**产品代码不动**（除非量出可修的真实裁切）。
- **改动面**：`scripts/css-audit/stylesnap.mjs` +1 参数、`check-stylesnap.mjs` 透传、baseline +3 态；**桌面**（移动 10 态另议，需设备）。
- **风险**：低（新态只加不删；异步内容需沿用 `settle()`）。不要把 200% 态并入严格比对前先跑两轮一致。
- **门禁成本**：新增 3 态基线（`--from <warm>.json --write-baseline`）；现有 42 态不重烤；日常 `--states` 范围跑。
- **红线/§7**：不撞；**不做全仓 rem/覆盖根字号**（§7）。
- **批次**：**批 3**（验证型，收益是长期护栏）。

### S3 · A13 收尾：`::picker-icon` / `option::checkmark` / `<selectedcontent>`（P2，推荐）
- **证据**：`kit.css` `.ln-select--native::picker(select)` 与 `option:checked` 已样式化；`::picker-icon`/`::checkmark`/`selectedcontent` 全仓 **0**（grep）；v2 A13 自述「字符箭头与 option::checkmark 未做（保持 UA 默认）」；运行时 `base-select` 支持 true。
- **要做什么**：先 1 处 POC——用 lucide `chevron-down`/`check` 的 data URI（与 `usheet-chrome.css` 现有 mask 写法同源）替换 `::picker-icon` 与 `option::checkmark`；不支持则撤。若要做多行/图标选项，再评估 `<selectedcontent>`（当前选项纯文本，可跳过）。
- **改动面**：`kit.css` 1 个规则块（+6–10 声明）+ `cssLayers.test.ts` 基线 + `NativeSelect.render.test.tsx` 1–2 例；**桌面 only**（移动不走 base-select）。
- **风险**：低——弹层内部视觉；老内核忽略伪元素；加声明要在基线写理由（本仓允许「合法新增非覆盖」）。
- **门禁成本**：`ui-metrics` + `cssLayers` + 该 render test；**无 42 态重烤**（没有态打开下拉；`::picker` 不进计算值快照）；如担心可单跑 `settings:1315:light` 1 态确认 0 差异。
- **红线/§7**：不撞；图标必须 lucide、颜色用令牌（§3#14）；写在原语文件（primitives.test.ts 禁止 feature 覆盖 `.ln-*`）。
- **批次**：**批 1**（最低风险、可见收尾）。

### S4 · `forced-colors` 门禁态 + 缺口扩展（P2，推荐先测后改）
- **证据**：A16 只在 `kit.css` 原语层有 1 块 8 声明（按钮/图标钮/输入/菜单/气泡/dialog/行/勾选）；`forced-colors` 全仓只有这一处；`stylesnap.mjs:151` 已支持 media 模拟；v2 没有模拟高对比度的运行记录。
- **要做什么**：先加 2 个态（`fc:1315:light`、`fc:1315:dark`，`media: {"forced-colors":"active"}`），用快照/截图/计算值找「边框与选中态消失」的面；只对失败面补规则（大概率是 `:modal` backdrop、菜单项选中、原生 select、分段控件）。仍用系统色关键字、不写色值、不用 `!important`。
- **改动面**：`stylesnap.mjs` STATES +2、`baseline/stylesnap.json` +2；产品 CSS `kit.css` 预计 +6–12 声明；**桌面**（Windows 高对比度场景）。
- **风险**：低（只在 forced-colors 模式生效，正常模式零影响）；但必须**先量后改**，别凭猜扩展到全站。
- **门禁成本**：新增 2 态基线；现有 42 态不重烤；`ui-metrics`/`cssLayers` 基线 + 理由。
- **红线/§7**：不撞；**写在原语文件**（primitives 门禁），`prefers-contrast` 另议（§7）。
- **批次**：**批 2**。

### S5 · boot 图片解码/首屏字节（P2，推荐）
- **证据**：`electron/boot.html` 1,864 B；`boot-anim.apng` 328,449 B + `boot-poster.png` 27,756 B；`boot.html:36-37` 两个 `<img>` 都无 `decoding="async"`，poster 用 `display:none` 做 reduced-motion 切换，未加 `loading=lazy`（是否随普通启动下载未实测，但**没有理由让它进首屏**）；A08 只把 data URI 外置，**字节总量未减**。
- **要做什么**：① 两张图补 `decoding="async"`；② poster 加 `loading="lazy"`（预期正常模式不进视口即不下载；reduced-motion 切显示后按需拉——需用 Resource Timing 实测确认）；③ 可选 `fetchpriority="low"`；④ 若品牌允许，把 APNG 换 CSS 关键帧（可去掉 328KB，但要用户确认启动观感，不在本批自动做）。
- **改动面**：`electron/boot.html` + `electron/bootAssets.test.ts`（5 例）+ 打包 smoke；**桌面**。
- **风险**：低；唯一风险是 poster 的 lazy 在某些内核延迟到显示后，可接受（reduced-motion 用户会多等一次本地文件）。
- **门禁成本**：`bootAssets.test.ts`；`git diff --check`；无 stylesnap 态（boot 是独立 BrowserWindow）；打包/启动 smoke 复核 ready 时间。
- **红线/§7**：不撞；**不引入图片库/不重写品牌动画**（CSS 动画需用户点头）。
- **批次**：**批 1**。

### S6 · 移动 `enterKeyHint` 扩展（P2，推荐）
- **证据**：A14 只钉 5 个入口（`enterKeyHint.test.ts:18-24`）；复测仍只有 6 次 `enterKeyHint` / 5 文件；移动仍有约 15 个文本输入没有：`AiCorpusSheet.tsx:56`、`AiHistoryPage.tsx:135`、`MobileBitableTableDrawer.tsx:52`、`NoteTagsSheet.tsx:114`、`BatchTagPickerSheet.tsx:55`、`MoveTargetTreeSheet.tsx:80`、`MobileBitableFieldEditorSheet.tsx:141/213`、`MobileBitableFieldSheet.tsx:83`、`MobileBitableTableActions.tsx:61`、`MobileBitableViewActions.tsx:62`、`MobileBitableRecordSheet.tsx:140` 等（`type=file/range/checkbox` 排除）。
- **要做什么**：按语义补 `search`（搜索类）/ `done`（命名/新建）/ `next`（多字段表单）；同步扩 `enterKeyHint.test.ts` 的 SITES 清单。
- **改动面**：约 10–15 个移动 tsx + 1 个 test；**移动 only**。
- **风险**：低（纯属性，不改值/几何）；但移动改动按 AGENTS §3#21④ 必须 `android-build.sh --sync --install` 后点收。
- **门禁成本**：`tsc` + `enterKeyHint.test.ts` + `check:mobileui`；**不需要 mobile-snap 重烤**（视觉/几何不变）；设备安装后抽查 2 屏。
- **红线/§7**：不撞；不碰桌面。
- **批次**：**批 1**。

### S7 · 多维表表单「首个错误聚焦 + `aria-invalid`」（P2/P3，推荐小做）
- **证据**：桌面 `BitableFormView.tsx:65-77` 与移动 `MobileBitableFormView.tsx:88-107` 的必填校验只 `setError`，错误只渲染成底部一条 `role="alert"`（`BitableFormView.tsx:186`）；字段没有 `aria-invalid`/`aria-describedby`，也没有把焦点送到第一个缺失字段；`:user-invalid` 0。
- **要做什么**：`missing` 计算已经给出字段对象——给缺失字段的控件加 `aria-invalid="true"` + 错误说明 `id`（`aria-describedby`），提交失败时 `focus()` 第一个缺失字段（桌面/移动各自实现，共享 `missingRequiredBitableFields` 判据不变）；不引入原生 `required`。
- **改动面**：`BitableFormView.tsx` + `MobileBitableFormView.tsx` + 若加视觉态再动 bitable CSS 1–2 条 + 2 个测试；**两端（多维表表单）**。
- **风险**：低（只加属性 + 一次聚焦；无几何变化）；注意不要改变提交成功/错误文案。
- **门禁成本**：相关 render/纯函数测试；`check:bitablesnap` 3 态（表单不在快照里，跑一遍确认 0 差异）；移动需装包点收。
- **红线/§7**：不撞；**与「不做读屏承诺」不冲突**——收益是键盘/可见焦点，不新增读屏承诺。
- **批次**：**批 2**（放 S6 之后，避免同批设备装两次）。

### S8 · A06 补测：导入/导出长任务（P2，只测不改）
- **证据**：A06 的 LoAF 只覆盖全文搜索；但导入链路已有 `setTimeout(0)`/`nextFrame` 让步（`importPortable.ts:131/215`、`markdownImportPipeline.ts:307/318`）；`scheduler.yield` 运行时支持 true 但全仓 0。
- **要做什么**：在现有性能装置（`perf-baseline.mjs` 的 longtask 采集 + 大库/便携包夹具）上补 3 条：Markdown/文档导入、2GB 便携包导入、批量导出；量「>50ms 长任务个数/总时长」。**只有量到真长任务才加 `scheduler.yield`**（且要老 WebView 回退），否则结案。
- **改动面**：1 个探针脚本参数/夹具（不改产品代码）；桌面 + 移动（移动导入需设备）。
- **风险**：低（只测）；夹具大，跑一次约几分钟。
- **门禁成本**：无视觉门禁；记录数字进 HANDOFF/本文；不新增 CI 门禁。
- **红线/§7**：不撞；避免「凭 0 个 scheduler.yield 就立项」。
- **批次**：**批 3**（与 S2 同批，验证型）。

## 6. 建议批次（低风险高收益 → 高成本）

| 批次 | 内容 | 成本 | 改动面 | 门禁/验收 | 回滚 |
| --- | --- | --- | --- | --- | --- |
| **批 1**（推荐先做） | S3 picker 收尾、S5 boot 图片、S6 移动 enterKeyHint | 1–2 天 | 桌面 2 文件 + 移动 ~12 文件 + 2 测试 | `tsc` + 相关 vitest + `ui-metrics` + `cssLayers`；桌面 0 态重烤（S3 可选单态）；移动装包抽查 2 屏 | 每条独立 commit，S3/S5 可整段回退 |
| **批 2**（先测后改） | S1 `will-change` 收敛、S4 forced-colors 门禁+扩展、S7 表单错误聚焦 | 2–4 天 | `shell.css`+Sidebar、`stylesnap`+2 态、bitable 表单 2 文件 | 10k seed 层数/LoAF；`--states drag:...` 2 态重烤；fc 2 态新基线；`bitablesnap` 3 态；`tsc`+vitest | 先只加门禁态再改产品 CSS；S1 一条 CSS 回退 |
| **批 3**（验证型） | S2 200% 快照门禁、S8 导入/导出补测 | 3–5 天 | 装置 2 文件 + baseline + 探针；**产品代码 0** | 新态两轮一致后入库；性能数字写回 HANDOFF；不阻塞发版 | 只回退装置/基线 |
| **批 4**（不建议，需用户裁决） | §7 全部（reduce !important、@property、interestfor、移动 Sheet 迁 dialog、全 rem、剩余 dialog、mobile 200% chrome 等） | — | — | 不做 | — |

**排序理由**：批 1 全是「属性/弹层内部」改动，视觉零风险且不需要重烤基线；批 2 的收益最大（10k 库层数/Windows 高对比度）但需要测量与 2–2 态重烤；批 3 只补验证，不改产品代码；批 4 每条都撞「收益 < 复杂度」或已有用户裁决。

## 7. 明确不建议（含 v2 §7 全部 12 项，逐条理由）

### 7.1 v2 §7 不做清单：本轮逐条复核，**全部同意不做**

| v2 §7 项 | 本轮结论 | 理由（带证据） |
| --- | --- | --- |
| 全仓字号/间距 rem 重写 | 同意不做 | A03 已把**字号令牌**全 rem；剩 287 条纯 `height`/108 条 `min-height` 多为图标/轨道/画布/内核宿主，全 rem 会打穿 42+10 态与内核，收益是「统一」而非用户问题 |
| 一次性 29 处 `role=dialog` 换 `<dialog>` | 同意不做 | 实际已 28 调用/26 模块迁原生；剩 6 浮动是拖拽/缩放面板，换 top-layer 风险 > 架构统一收益；移动 Sheet 另议（也不做） |
| Web Components / Shadow DOM | 同意不做 | React 18 + 设计系统已收敛；无跨框架分发需求 |
| Temporal / 时区体系 | 同意不做 | 无跨时区/纳秒需求，界面固定 zh-CN |
| Trusted Types | 同意不做 | 无用户 HTML 渲染入口；会打穿内核/第三方 DOM 写入 |
| View Transitions 全站 | 同意不做 | 单页壳无路由；移动分页 keep-alive 更稳 |
| 原生 dialog 替代 ImageLightbox/AttachmentPreview | 同意不做 | 内容查看器，不是模态表单；换 dialog 会牵动键盘/滑动手势 |
| `srcset` / `image-set()` | 同意不做 | 本地资产 `?w=1024` 单档已定稿，多密度只增缓存条目 |
| `oklch()` 重做主题 | 同意不做 | 牵动 4 主题 + WCAG 门禁，收益仅「色相计算直观」 |
| `light-dark()` 替换主题体系 | 同意不做 | 主题是用户显式选择（guide 允许例外）；class 体系还承载自定义 CSS |
| HTTP/2 | 同意不做 | 261114 实测慢 7–20×（HANDOFF §0） |
| PWA / Built-in AI / WASM / WebMCP / passkeys | 同意不做 | 产品形态不适用（Electron/Capacitor 壳，无 SW/网络 AI/端侧 WASM） |

### 7.2 本轮额外不建议（v2 没写死，但「更严格」会撞墙）

| 候选 | 不建议理由 |
| --- | --- |
| 减 `!important`（W2 重构） | 现状 desktop **9/9 允许清单**、mobile **19/19 基线**，逐条有根因：层序 `!important` 反转（`components.css:322-333`）、reduced-transparency 契约（`tokens.css:30-34`）、内核 inline style（`usheetEditor.css`）。要减必须按端拆文件/迁 `.ln-segment`，风险在移动端观感；AGENTS §3#14「清单只许降」+ §3#17 三问 ⇒ 收益<风险，**需用户裁决才做** |
| `@property` 注册令牌 / container style queries | 全仓 0 个 `@property`；没有用户可见问题；注册颜色会让计算值序列化/快照变化，且 DESIGN 要求「颜色/背景瞬时切换」，无过渡需求；改 4 主题 + 42 态，复杂度不成比 |
| `interestfor` + `popover="hint"` 重写 tooltip | 平台支持（CDP 实测 true）但 guide 要求每触发器有 DOM 内容/固定目标；本仓是 283 处裸 `title` + 单例 tip，重写成本 >> A04 收益；A04 已修 3 缺口 |
| 移动 Sheet 迁 `<dialog>` | 移动 Sheet 有右滑关闭/返回键/键盘稳定/keep-alive（`MobileSheet.tsx:120-133`），迁原生要重做手势与 Android 返回桥；A02 明确「成功后再说」，当前无真实失败面 |
| `:user-invalid` / 原生 `required` 表单体系 | 本仓无 `<form>` 提交语义、全即时保存；原生约束校验会引入浏览器气泡/Enter 语义变化；真正缺口是表单首错聚焦（S7），用 `aria-invalid` 即可，不必上原生校验 |
| `prefers-contrast: more` | Windows 高对比度由 `forced-colors` 覆盖（S4 先补）；`prefers-contrast` 主要 macOS「增强对比度」，当前无用户报障；可作 S4 之后的观望项，不立项 |
| `text-wrap` 扩到全站 | 源 4 条已覆盖对话框标题/正文/属性路径；单行标题不生效，多行列表行保持省略号；再加只是「更现代」不是用户问题 |
| 用 `scheduler.yield` 替换现有 `setTimeout(0)` | 导入链路已让出（`importPortable.ts:131/215`），`scheduler.yield` 只是换让出原语；老 WebView 还要回退；无实测长任务前不改（S8 先测） |
| `closedby` / `autofocus` / `commandfor` 补齐 | 原生 modal 默认 `closedby=closerequest`，各 busy dialog 已在 `onDismiss` 拦（`BitableAiGenerateDialog.tsx:39`、`MoveTargetTreeDialog.tsx:129`）；没有「Esc 误关导致数据丢」的复现 ⇒ 不为「更严格」加状态 |
| 移动端 200%/400% 固定高 chrome 重构 | 44/52 是用户定稿几何；超出 WCAG AA 的自愿范围；内容可见溢出非隐藏裁切（v2 §11 A03、MERGE-REVIEW §4） |
| `content-visibility` 再加到多维表/小记列表 | 树/大纲/手写板已 3 处；多维表已有有界行窗口（`docs/BITABLE-VIEWPORT.md`），小记有虚拟列表；再加会与 `contain-intrinsic-size`/滚动锚点打架 |
| 独立 `transform` 属性（`scale:`/`translate:`） | 动效专项（v2 §4.7 已定 P3 随动效做）；现在换会牵动 42 态动效门禁，收益只是避免 `transform` 覆盖 |
| 100vh→dvh（`mobile.css:898-899` 2 行） | 只影响键盘态内核菜单夹高；可做但收益极小，且老 WebView 要回退；**可选顺手项，不进批次** |

## 8. 复现命令（本轮实际用过）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "$(git rev-parse --show-toplevel)"

# 1) 逐项实现证据（不信任文档自述）
git log --oneline -S 'isImeConfirming' -- src/core/ime.ts src | head -3        # A01
git log --oneline -S 'showModal' -- src/components/ui/Overlay.tsx             # A02
git log --oneline -S 'setAttribute("inert"' -- src/components/ui/Overlay.tsx  # A09
git log --oneline -S 'base-select' -- src/components/ui/NativeSelect.tsx      # A13
git log --oneline -S 'will-change: transform' -- src/styles/app/shell.css     # A20（只有 9025426b）

# 2) 静态计数（与本文同口径：src/** + electron/** + 根 html，排除 *.test.*）
grep -rn '<NativeDialog' src --include=*.tsx | grep -v test | wc -l           # 28
grep -rn 'role="dialog"' src --include=*.tsx | grep -v test                    # 17 元素（人工去注释/选择器）
grep -rnE 'commandfor|interestfor|::picker-icon|::checkmark|closedby|:user-invalid|@property' src | wc -l
grep -rn 'will-change' src/styles src/mobile --include=*.css                   # 18 行（含注释）

# 3) 门禁
npx vitest run src/styles/cssLayers.test.ts src/styles/textScale.test.ts   src/styles/modernCssGates.test.ts src/styles/focusRingGates.test.ts   src/components/ui/Overlay.test.ts src/components/ui/NativeDialog.render.test.tsx   src/components/ui/overlayContainer.test.ts                                 # 7 文件 / 34 例
node scripts/ui-metrics.mjs                                                    # 9/9 + 19/19 + 0/0
git diff --check

# 4) 运行时能力（9222 只读 CDP；不要 pkill Electron）
#    Runtime.evaluate: CSS.supports('appearance','base-select') / field-sizing / light-dark /
#    scheduler.yield / interestForElement / closedBy / anchor-name / position-try-fallbacks /
#    matchMedia('(forced-colors: active)') / [title] 元素数

# 5) A20 合成层测量（只读注入 + 立即移除，不改仓库）
#    LayerTree.enable → 注入 style: .tree-row{will-change:auto !important}
#    → layerTreeDidChange.layers.length（31）→ 移除 style → 再取（65）；差 = .tree-row 数
```

> 一次性审计脚本不进仓库（v2 §8：复算用 grep 即可，别为计数加扫描脚本）；本文用到的 Node 小脚本只在 `/tmp`。

## 9. 文档与代码不一致（建议回填，不影响本轮结论）

| 位置 | v2 写法 | 本轮实测/核对 | 建议 |
| --- | --- | --- | --- |
| §11 A20 | 「10 处真实使用全部绑动画/位移」 | `.tree-row` 常驻 `will-change`（`shell.css:777-781`）；CDP 34 行=34 层 | 改为「1 处常驻（tree-row），需按拖拽窗口收敛」；本文 S1 |
| §11 A09 | 「aria-modal 与 29 处 role=dialog 逐个校准仍待」 | 现 17 元素 / 14 aria-modal，差的 3 个是非模态面板（EditorDock/InkPagesPanel/InkPageTabButton），语义正确 | 改为「已满足：非模态正确不带 aria-modal」 |
| §11 / MERGE-REVIEW A02 | 「26 处原生 dialog」 | 28 调用 / 26 模块（26 普通 + 2 顶部对齐；AssetsBrowser 3 个调用算 1 模块） | 补口径说明，避免后续会话按「一行=一处」数出 28 又以为漏了 |
| §2.6 A18 | 「text-wrap 9 处」 | 源 CSS **4 条**；dist/构建副本另计才到 9 | 写「源 4 条，产物副本不计」 |
| §11 A08 | 「字节总量不变（APNG 仍加载）」 | 正确；boot.html 1,864B，APNG 328,449B + PNG 27,756B | 保留，并把「再减需品牌决策」挂到 S5 |
| §11 A03 | 「字号令牌全 rem」 | app 令牌确实全 rem；`boot.html`/`startupRecovery`/`pdfRenderer` 仍有 8 行 px 字号（独立页面，不参与 text-scale） | 补「范围 = 应用 UI 令牌」 |
| HANDOFF §3 | 现代 Web 项写「其余推迟项见审计 §11」 | A20 需重开、新增 7 个代码候选 + 1 个只测项 | 用户裁决后，把本文 §6 批次并入 HANDOFF §3，完成后直接删行 |
| 工作树（并行会话） | — | 写作末尾复跑 targeted 34 例时 `cssLayers` 1 红：`styles/kit.css` 声明数 712→713（并行会话改动，非本文） | 由并行会话收口；Lead 合并前复跑本文 §8 的 7 文件命令 + 全量门禁 |

## 10. 残余未知（本轮没解决，别当成已做）

1. **Android 老 WebView 的能力探测覆盖**：`baseSelectSupported()` 有；但 `field-sizing`/`dvh`/`popover` 等只靠「老内核忽略」或代码分支，**没有旧 WebView 实机回归**。移动端 feature detect 是既有做法，不是本轮新增。
2. **浮层三层同屏**：内核 portal（`.ne-overlay-container`）× 自绘 overlay × 移动 Sheet 的**同时叠加**未做设备矩阵（overlay-matrix 只覆盖了模态 dialog × 菜单/气泡 + 移动 Sheet 背景 inert）。
3. **10k 库的 will-change 层数**：CDP 只在开发库（34 行）量到 34 层；10,022 行要按 S1 在 10k seed 上复测（层数/渲染内存/拖拽帧率）。
4. **200% 逐屏**：只程序化扫过设置页与小记；S2 的门禁态建立后才算可回归。
5. **forced-colors 真实缺口**：没有模拟跑过；S4 先量后改。
6. **本轮未跑全量门禁/42 态/移动 10 态**：targeted 34 例 + ui-metrics 只证明本文涉及的静态契约；写作末尾并行改动使 `cssLayers` 现为 1 红（见 §9），合并前仍需按 HANDOFF §1 跑全量并由 Lead 统一收口。
7. **AI 真实 Key 流式对话**：HANDOFF §1 已记「未跑」，与本清单无关，但「全部做好」口径下要排除。

## 11. 变更记录

- **261116 v1**：首版。基于 HEAD `80ead487` 逐项核对 A01–A30；新测 A20 合成层（34→65）；给 §2.4 七组结论；列出 S1–S8 候选 + 批 1–4；逐条否掉 v2 §7 的 12 项与 13 个额外候选。本轮未改产品代码、未提交。
