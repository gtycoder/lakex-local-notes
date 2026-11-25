# C 路径落地计划：自绘图标纳管与补齐（不引图标库）

> 输入（调研三份已删，git 可查）：DECISION.md（不换 IconPark，走 C：只抄单个 SVG）、B-inventory.md（替换面与自绘清单）、C-poc.md（几何换算/工程接入实测）。
> 本文只读仓库、只写这一个文件；所有数字均为本仓实测，复现命令见 §11。
> 基线：分支 `modernize/web-platform-261115`；工作区另有 Lead 正在进行中的设置页改动（`src/styles/kit.css` 开关与 `.ln-select--native`），叠加口径见 §9。

---

## 0. 一页结论

1. **C 路径不是"再换一次图标"，而是三件事**：① 把 11 个真自绘图形逐个定性（冻结/归一/重画）；② 用三条可 grep 的规则把"新图标怎么写"钉死，让自绘与 lucide 共用 `svg.lucide{stroke-width:1.75}` 这一个描边来源；③ 只为"确实要改画"的少数图形付 IconPark 抄单 SVG 的许可成本。
2. **13 个文件里只有 4 个需要动代码**：`ExpandLevelIcon`（删死值）、`SyncStatusPopover` 的 `CloudCheckIcon`（吃全局 1.75）、`LakeColorBoard`（对勾重画到 24 网格 + 2 个 hex 落 token）、`AiTagIcon`（渐变 id 用 `useId()`）；其余 9 个**冻结**（含 2 个画布）。**不搬迁、不建 Icon 门面、不引依赖。**
3. **快照门禁基本看不见这批图标**（铁证）：42 态基线里 `.node-icon-glyph`、`.lake-colorboard`、`.ai-tag`、`.bt-file-badge`、`.outline-sidebar` 的 DOM **命中 0**；10 个移动态里 `.mb-node-glyph` 也是 **0**。⇒ 改这批文件的快照成本≈0，**但"0 红"不等于"没变"**：指纹白名单里没有 `fill/stroke/stroke-width/d/viewBox`（§10），换形状/换颜色可能**静默通过**。验收必须靠 4× 实拍 + 组件级 render 测试。
4. **`className="lucide"` 只能给 24 网格的描边图形**。给 48/72/222/256/1024 网格的 svg 加这个类，会被全局 `stroke-width:1.75` 压成半宽（例：256 网格的图片工具条图标若加类，16px 下描边从 1.25px 变 0.11px）。这条是本文最重要的技术约束（§4.3）。
5. **任务书里"从 IconPark 抄 lucide 缺的 4 个"方向要纠正**：B 卷那 4 个（`CheckCheck/SquarePlus/Subscript/Superscript`）是 **lucide 有、IconPark 无**。走 C（不换库）它们**不是缺口**，反而是"不换库才留得住"的论据；真正值得抄单 SVG 的只有 3 个自绘候选（§7）。
6. **批次 1 选零视觉变化的样本**：`ExpandLevelIcon` 的 `strokeWidth={1.7}` 是**死值**（被 `svg.lucide` 的 CSS 覆盖，实际一直渲染 1.75，§2.3），删掉它像素级 0 变化、0 快照风险 —— 用它验证流程，再动真几何。

### 0.1 13 个文件处置总表（可直接派活）

| # | 文件 | 是什么 | 网格 | 处置 | 一句话理由 |
| --- | --- | --- | --- | --- | --- |
| 1 | `features/ink/InkCanvas.tsx` | 手写板画布本体 | `page.w×page.h` | **NOT-ICON · 不动** | 绘图表面，不是图标 |
| 2 | `features/ink/InkPageStrip.tsx` | 页缩略图 | 同上 | **NOT-ICON · 不动** | 同上 |
| 3 | `features/bitable/bitableEditorModel.tsx`（`RowExpandIcon`） | 多维表「展开行」 | 1024 | **REGISTER · 保持** | 云端 lakex 1:1；候选抄 `FullScreen`（低优先，§7.3） |
| 4 | `features/bitable/FileBadgeIcon.tsx` | ≥28px 纸页 + 扩展名 | 48 | **KEEP · 冻结** | 用户 261020 定稿；`fileBadgeIcon.test.ts` 钉死 `<text>`/`>DOCX<`/27↔28 分界 |
| 5 | `features/outline/ExpandLevelIcon.tsx` | 大纲「展开到级别」 | 24 | **NORMALIZE**（批次 1） | 删 `strokeWidth={1.7}` 死值；AGPL 与本仓同协议（§7.4） |
| 6 | `features/ai/AiTagIcon.tsx` | 工具栏 AI 入口（渐变） | 222 | **NORMALIZE**（批次 2） | 图形不动；固定渐变 id → `useId()`（同屏渲染 2 次 = 重复 DOM id） |
| 7 | `features/ai/AiSparkIcon.tsx` | AI 助手入口（三色） | 24 | **KEEP** | 云端 1:1 + 3 个 `--lake-ai-icon-*` 已就位 |
| 8 | `features/editor/selectionToolbar/imageIcons.tsx` | 图片工具条 9 个 | 256 ×6 / 14 ×3 | **REGISTER · 不重画** | 实测换算已等价（§6.3）；重画 = 与云端分叉 |
| 9 | `features/editor/selectionToolbar/LakeColorBoard.tsx` | 色板选中对勾 | 18 | **REDRAW + TOKEN**（批次 2） | 路径坐标 x≤21/y≤19 超出 18 视窗 = **右下被裁**；2 个 hex 落 token |
| 10 | `features/editor/noteRefIcon.tsx` | 文档引用卡 symbol | 72 | **KEEP-FROZEN** | 内核 sprite 契约；**元素数不可变**（§2.5） |
| 11 | `features/editor/lockedTextIcon.tsx` | 加密文本卡 symbol | 72 | **KEEP-FROZEN** | 同上 + 用户 261024 定稿；1.5px vs 1.0px 差异登记为例外 |
| 12 | `components/app/SyncStatusPopover.tsx`（`CloudCheckIcon`） | 同步完成「云+对钩」 | 24 | **NORMALIZE**（批次 1） | `strokeWidth="2"` 且无 `lucide` 类 ⇒ 比全仓重 15% |
| 13 | `lib/notebookIcons.tsx` | 17 个语雀彩色插画 | 20 | **KEEP-AS-DATA** | 落库值是数据方言 `n:<id>`；判据见 §3 |

---

## 1. 审计口径（为什么这些数字可信）

| 项 | 口径 |
| --- | --- |
| 描边实际像素 | `px = strokeWidth × size / viewBoxWidth`（viewBox 一行代码可验） |
| 颜色来源 | 逐文件数 `#hex` 与 `var(--lake-*)`；「颜色字面量只允许出现在 themes/」的**机器判据只扫 CSS**（§5.3） |
| 快照面 | 用已提交的 42 态全量快照 `.css-audit/snap/base3.json`（107429 行 / 42 态）与移动 10 态 `.css-audit/snap/mob-after.json` **按选择器键实测命中数**，不是猜 |
| 门禁语义 | 读 `scripts/css-audit/check-stylesnap.mjs`、`scripts/css-audit/stylesnap.mjs`（指纹白名单）、`scripts/ui-metrics.mjs`（合规护栏）、`src/styles/cssLayers.test.ts`（声明数棘轮）源码，不靠文档转述 |
| 只读纪律 | 未改 `src/`、`package.json`、`node_modules`；IconPark 证据复用 `/tmp/iconpark-probe`（`@icon-park/react@1.4.2`，Apache-2.0，无 NOTICE 文件） |

### 1.1 各文件 hex / token / 网格实测

| 文件 | `#hex` | `var(--lake-*)` | `<svg>` | viewBox |
| --- | ---: | ---: | ---: | --- |
| InkCanvas.tsx | 0 | 0 | 1 | 动态（页面尺寸） |
| InkPageStrip.tsx | 0 | 0 | 1 | 动态 |
| bitableEditorModel.tsx | 0 | 0 | 1 | `0 0 1024 1024` |
| FileBadgeIcon.tsx | 0 | 0 | 1 | `0 0 48 48` |
| ExpandLevelIcon.tsx | 0 | 0 | 1 | `0 0 24 24` |
| AiTagIcon.tsx | 0 | 2 | 1 | `0 0 222 222` |
| AiSparkIcon.tsx | 0 | 3 | 1 | `0 0 24 24` |
| imageIcons.tsx | 0 | 0 | **9** | `0 0 256 256` ×6 / `0 0 14 14` ×3 |
| LakeColorBoard.tsx | **5** | 0 | 3 | `0 0 18 18` |
| noteRefIcon.tsx | 0 | 0（走 `iconVar()` 拼 `var()`） | 1 symbol | `0 0 72 72` |
| lockedTextIcon.tsx | 0 | 0（同上） | 1 symbol | `0 0 72 72` |
| SyncStatusPopover.tsx | 0 | 0 | 1 | `0 0 24 24` |
| notebookIcons.tsx | **70** | 0 | **18** | `0 0 20 20` |

> 结论：**颜色字面量存量只集中在 2 个文件**（LakeColorBoard 5 个、notebookIcons 70 个）；其余 11 个已经全是 `currentColor` / 令牌，不存在"改颜色"的工作量。notebookIcons 的 70 个按 §3 判据冻结（自带配色的插画），LakeColorBoard 的 5 个按 §5 落 token。

### 1.2 快照里到底有没有这些图标（42 态 / 10 态实测命中）

| 探针（快照键包含） | 42 态命中的态数 | 说明 |
| --- | ---: | --- |
| `svg.lucide` | **42**（83 行/态；settings 态 101 行） | 我们自己那层 lucide 图标，是快照主体 |
| `svgraw$path` | 42（868 行/态） | 裸 SVG 图元（无 class 的自绘/内核图形都在这） |
| `symbol$icon-lake-note-ref` | **42**（1 行/态） | 内核 sprite 里的 symbol：**隐藏且在 DOM 里** |
| `symbol$icon-lake-locked-text` | **42**（1 行/态） | 同上 |
| `node-icon-glyph`（笔记本插画） | **0** | 夹具里没有用了自定义插画的节点 |
| `mb-node-glyph`（移动端插画） | **0**（10 态全 0） | 同上 |
| `lake-colorboard` | **0** | 色板从未在快照里打开 |
| `ai-tag` / `ai-spark` | **0** | AI 对话/工具条未进夹具 |
| `bt-file-badge` | **0** | ≥28px 纸页图标未渲染 |
| `bt-file-icon` | **1**（仅 `resources:1315:light`，1 行） | 小尺寸线性附件图标 |
| `outline-sidebar` | **0** | **注意**：快照里的 `outline-*` 态是**内核 TOC 侧栏**（`ne-normal-toc-sidebar`），不是我们的 `OutlineSidebar` |
| `selection-toolbar` | 42（1 行/态 = 宿主 `div.lake-selection-toolbar-host`，内部无图标） | 工具条本体未展开 |
| `mb-*图标.…` | 移动 10 态只有 `mb-btn`/`mb-iconbtn` 等原语 | 13 个文件里的图形在移动端快照里 **0 命中** |

**推论**：这 13 个文件的改动，**桌面 42 态 + 移动 10 态 + 多维表 3 态预计 0 红**（唯一例外见 §2.5 的 noteRef/lockedText「元素数」陷阱）。

---

## 2. 逐文件审计（13 个，含实测几何）

### 2.1 InkCanvas / InkPageStrip —— 不是图标

| 项 | InkCanvas | InkPageStrip |
| --- | --- | --- |
| 用途 | 手写板画布本体（pointer 事件、背景 `<image>`、笔迹 `fill={stroke.color}`） | 页缩略图（同一画布的子集渲染） |
| 网格 | `viewBox = 0 0 page.width page.height`（**动态**，来自 inkDoc 页面数据） | 同上 |
| 描边 | 笔迹是**填充路径**（`fill`），不是 stroke 图标；缩略图 `strokeWidth={Math.max(1.5, stroke.width)}` 是笔宽 | 同 |
| 颜色 | `stroke.color` = **用户数据**（页面里存的笔色） | 同 |
| 尺寸档 | 不适用 | 不适用 |
| 处置 | **不动**。归到"用户数据/绘图表面"，与本计划无关 | |

### 2.2 RowExpandIcon（bitableEditorModel.tsx）+ FileBadgeIcon.tsx —— 保持，只登记

| 项 | RowExpandIcon | FileBadgeIcon |
| --- | --- | --- |
| 用途 | 多维表行「展开」按钮（`size=15`） | 附件类型大图标（≥28px：多维表卡片 46px / 预览台） |
| 网格 | `0 0 1024 1024`（云端 lakex `lt-icon-RowExpand`） | `0 0 48 48` |
| 描边 | **无描边**：单条 `<path fill="currentColor">` | **无描边**：`<path>` 填充 + `<text>` |
| 颜色 | `currentColor`（由父按钮决定） | 页身 `currentColor`（外层 `.bt-file-icon--<kind>` 给 `--lake-file-*`）；折角/文字 `--lake-text-on-accent` |
| 尺寸档 | 15 | 28–46+（`FILE_BADGE_MIN_SIZE = 28`） |
| 能否换 24 网格 1.75 currentColor | 技术上能，但**是填充图形**，强行线性化 = 观感换一种语言；且它是"云端 1:1"登记项 | **不能**：任何图标库都没有"纸页 + 扩展名文字"，且测试钉死 `<text>`/`>DOCX<` |
| 处置 | **REGISTER**（保持 + 加来源/网格头注释）；候选抄 IconPark `FullScreen` 备选（§7.3），非本批 | **KEEP 冻结** |

### 2.3 ExpandLevelIcon.tsx —— 发现一个"死值"（批次 1 样本）

```tsx
<svg className="lucide" width={size} height={size} viewBox="0 0 24 24"
     fill="none" stroke="currentColor" strokeWidth={1.7} ...>
```

- 用途：大纲头部第 4 枚按钮「展开到级别」；来源 **思源 litheness `iconExpandLevel`（AGPL-3.0）**，文件头已署名。
- 网格 24 ✅；`currentColor` ✅；无 hex ✅；尺寸档 14。
- **死值**：它既写 `strokeWidth={1.7}`（presentation attribute）又带 `className="lucide"`。`src/styles/app/base.css:27` 的 `svg.lucide{stroke-width:1.75}` 是 **CSS 声明**，在层叠里**永远压过展示属性** ⇒ 实际渲染一直是 **1.75**（14px 下 1.02px），`1.7` 从来没生效。
- 处置：**删 `strokeWidth={1.7}`**（1 行），并在注释里写明"描边由 `svg.lucide` 统一"。**像素级 0 变化**，是批次 1 的理想样本（验证"改这一处要跑哪些门禁"）。
- 许可：思源 AGPL-3.0 与本仓自有代码 AGPL-3.0-only **同协议**，文件头已署名，**不构成新风险**；按 §7.4，"为许可而换图"的动机不成立。

### 2.4 AiTagIcon / AiSparkIcon —— 图形不动，各修一处实现细节

| 项 | AiTagIcon | AiSparkIcon |
| --- | --- | --- |
| 用途 | 选区工具条 / 图片卡工具条的 AI 入口（`size=18`） | AI 助手头像 + 输入区（`size=14 / 18`） |
| 网格 | `0 0 222 222`（云端 `larkui-icon-icon-ai-tag-new` 原样） | `0 0 24 24`（云端 `larkui-icon-icon-queque-ai` 原样） |
| 描边 | 无描边（填充 + 线性渐变） | 无描边（三块填充） |
| 颜色 | `linearGradient` 两个 `<stop style={{stopColor:"var(--lake-ai-tag-from/-to)"}}` ⇒ `themes/base.css:9-10` | `currentColor` + `--lake-ai-icon-soft/-ink/-star` ⇒ `themes/base.css:5-7` |
| hex | 0 ✅ | 0 ✅ |
| 问题 | `<linearGradient id="ai-tag-grad">` **固定 id**，而 `SelectionToolbar` 同屏渲染 2 次（`:859` 与 `:908`）⇒ 页面里出现**重复 DOM id**；任一实例卸载后另一实例的 `url(#ai-tag-grad)` 在部分引擎里会失效 | 无 |
| 处置 | **批次 2**：`const gid = useId()`，`id={gid}`，`fill` 用字符串拼接引用该 id（与 `notebookIcons.tsx` 的 clipPath 同手法） | **KEEP** |

### 2.5 noteRefIcon / lockedTextIcon —— 内核 symbol，元素数是雷

- 两者都**只渲染一个 `<symbol id=... viewBox="0 0 72 72">`**，交给内核 sprite，面板用 `<use xlink:href="#id">` 引用；颜色只能靠 `style={{fill:"var(--lake-note-ref-icon-*)"}}` **继承进 shadow 树**（`var()` 写在展示属性里浏览器不认，这是"禁止内联样式"的唯一例外）。
- 网格 72，尺寸档：插入面板图标盒 **36px** ⇒ 0.5 缩放：
  - noteRef：描边声明 2 → **1.0px**；底框 1.8 → 0.9px
  - lockedText：锁描边声明 3 → **1.5px**；底框 1.8 → 0.9px
  - ⇒ **同一插入面板里两张卡的描边不等（1.0 vs 1.5px）**。登记为例外（锁体加重是有意的辨识度），不要"统一"成 1.0。
- **元素数陷阱**（实测）：这两个 symbol 在 42 态里各出现 1 行（隐藏 sprite 内），因为**隐藏 ⇒ 盒恒为 0**，改路径几何/改颜色**不改变快照指纹**；但只要**增删一个 `<path>/<rect>/<circle>`**，`svgraw$*` 多重集的元素数变化 ⇒ **42 态全红**。
- 处置：**KEEP-FROZEN**，在文件头补一行「**不得增删图形元素**（快照风险 42 态）」。`noteRef.test.ts` 已经钉死：symbol id、`viewBox="0 0 72 72"`、**不得出现 `(fill|stroke)="#`（即不许 hex）**、每个 `iconVar()` 名字必须在 `themes/base.css` 与 `themes/dark.css` **都**有定义。

### 2.6 LakeColorBoard.tsx 的对勾 —— 唯一需要"重画"的图形（批次 2）

```tsx
<svg viewBox="0 0 18 18"><path fill={checkFill(color)} d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" /></svg>
```

- 用途：色板 swatch 的选中对勾（2 处复用：`Swatch` 与"默认"行）。
- **几何 bug（可验算）**：路径是 24 网格的 Material 风格对勾，坐标 **x ∈ [3.5, 21]**、**y ∈ [5.59, 19]**，但 `viewBox="0 0 18 18"` ⇒ 右下两部分（`21,7` 与 `9,19`）**超出视窗被裁**（SVG 默认 `overflow:hidden`）。这就是"对勾右下缺一角"的来源。
- 颜色：`checkFill()` 返回 `#8C8C8C` / `#FFFFFF`（**2 个 hex**），另 `#000000` 作"默认文字色"色块背景、`#FFFFFF` 再出现 1 次 ⇒ 共 **5 个 hex**，全部违反「颜色字面量只允许出现在 themes/」。
- 另 1 处 `<use xlinkHref="#icon-right-arrow">` = 内核 sprite 图标（`.ne-icon-kitchen`），**不动**。
- 处置（批次 2）：
  1. 对勾重画到 **24 网格**（`viewBox="0 0 24 24"`，路径不出 24 边界），仍用 `fill`（对勾是填充图形，不参与 1.75 描边体系，**不加** `lucide` 类）。
  2. `checkFill()` 的两个值 → `themes/base.css` 新增 `--lake-colorboard-check-ink` / `--lake-colorboard-check-paper`（深/浅主题各一份）；`#000000` → `--lake-colorboard-default-swatch`。
  3. **先定义 token 再改引用**（`ui-metrics` 的未定义令牌护栏会红，见 §5.3）。

### 2.7 imageIcons.tsx —— 9 个，登记不重画（附换算证明）

- 6 个 256 网格：`strokeWidth="20"` ⇒ 16px 下 **20 × 16/256 = 1.25px**；3 个 14 网格的是**纯 fill**（无描边）。
- 对照全仓 lucide：`1.75 × 16/24 = 1.17px`。差 **0.08px**（不可感知）⇒ **没有重画收益**；而 recolor/重画的风险是"与云端 lake 工具条分叉"（文件头写明这是刻意 1:1）。
- 反例警告：若给它加 `className="lucide"`，会被 `stroke-width:1.75` 压成 `1.75 × 16/256 = 0.11px` —— 几乎消失。**绝对不能加**（§4.3 的由来）。
- 处置：**REGISTER**（头注释补「网格/换算/来源/不许加 lucide 类」），代码 0 改动。

### 2.8 CloudCheckIcon（SyncStatusPopover.tsx）—— 1 行归一（批次 1）

```tsx
<svg ... viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" ...>
```

- 用途：顶栏同步按钮里「同步完成」态（`size=14` 固定；同处其它状态用 lucide `Cloud/CloudOff/CloudUpload/LoaderCircle/TriangleAlert/HardDrive`）。
- **不一致**：没有 `className="lucide"` ⇒ 不吃全局 1.75，14px 下 **2 × 14/24 = 1.17px**，而同一行相邻的 lucide 图标是 **1.02px** ⇒ 比邻居重 **15%**。这是"同一交互语义两套几何"的实例。
- 处置（批次 1）：加 `className="lucide"`、删 `strokeWidth`。视觉：1.17 → 1.02px（−13%），必须在 14px/深色下 4× 实拍自证（§10）。
- 快照影响：夹具里云同步=未配置/禁用 ⇒ 走 `CloudOff` 分支，**这个图标不在 42 态里**（`sync-status` 探针 28 行/态都来自按钮容器）⇒ 预计 0 红；仍按流程抽 1 态复检。

### 2.9 notebookIcons.tsx —— 数据资源，冻结（判据见 §3）

- 17 个图形 / 18 个 `<svg>` / 70 个 hex / 20×20 / 自带配色（stroke 0.976 或纯 fill）/ 1 个用 `useId()` 的 clipPath。
- 落库值 `n:<id>`（≤16 字符），随同步上传；`nodeIcons.test.ts` 钉死 17 个 / id 唯一 / `n:` 前缀 / 往返一致 / 旧 `i:` 只出 unknown。
- 处置：**KEEP-AS-DATA**；只加一条守卫测试（§3.2）。

---

## 3. "留在数据/保持现状"的判据（可套用到任何未来自绘图形）

一个图形**允许脱离 24 网格 / 1.75 描边体系**，当且仅当同时满足下面 4 条中的**至少 1 条硬判据**，且其余 3 条不违反：

| # | 判据 | 说明 | notebookIcons | noteRef/lockedText | imageIcons | FileBadge |
| --- | --- | --- | --- | --- | --- | --- |
| J1 | **落库值即图形**（图形 id 是同步字段的一部分，换图形 = 换数据/协议） | `tree_nodes.icon` ≤16 字符、`n:<id>` 方言、17 个被测试钉死 | ✅ 命中 | — | — | — |
| J2 | **机制上无法用 React 组件**（必须是 symbol / mask / 数据 URL） | 内核 `slash.icon` 只接受全限定 symbol id；只有继承能把颜色带进 shadow 树 | — | ✅ 命中 | — | — |
| J3 | **与外部权威 1:1 对齐**（云端 ku / 内核 sprite 的既有几何，改了就是视觉分叉） | 必须写清"对齐谁 + 换掉的代价" | ✅（语雀） | — | ✅（云端 lake 工具条） | — |
| J4 | **多色/渐变/文字**（不是"线性单色图标"，1.75 描边语义不适用） | 多色图形不得引入第二套描边规范，但也不受 1.75 约束；颜色必须走 `--lake-*` 或声明为数据自带色 | ✅ 17 个全多色 | ✅ 多色（`--lake-note-ref-icon-*`） | — | ✅ 文字 + 填充 |
| — | 附加（非放行条件，但必须登记） | 版权/许可来源、尺寸换算、快照敏感度 | 语雀抓取（注释已写"对外分发需换自有图形"） | AGPL 同协议 | Apache 无关 | 用户定稿 261020 |

**使用方式**：新图形先问「是否 J1–J4 命中」；命中 ⇒ 走 §4.2 的"例外通道"，必须写文件头登记；不命中 ⇒ **必须**是 24 网格 + `className="lucide"` + 不写 `strokeWidth`。

### 3.1 反判据（这几种理由不成立，别用来放行）

- ✗「重画很麻烦」/「图形太复杂」——图像复杂度不是判据；
- ✗「以后可能要多色」——§3#17 过度设计信号；
- ✗「IconPark 有近似图形」——近似 ≠ 对齐，且换掉 J3 图形就是与云端分叉；
- ✗「顺便统一描边」——J4 图形统一描边会破坏其视觉语义（见 lockedText 的 1.5px）。

### 3.2 notebookIcons 的守卫测试建议（批次 3，成本极低）

在 `src/lib/nodeIcons.test.ts` 追加一条（**不新增文件**）：

```ts
it("笔记本插画是数据资源：20×20 自带配色、不引主题令牌（改了要重走 §3 判据）", () => {
  const svg = renderToStaticMarkup(createElement(NotebookIconsHarness)); // 或直接扫源码
  expect((svg.match(/viewBox="0 0 20 20"/g) || []).length).toBe(NOTEBOOK_ICONS.length);
  expect(svg).not.toContain("var(--lake-");          // 数据资源不参与主题化
  expect((svg.match(/#[0-9a-fA-F]{3,8}/g) || []).length).toBeGreaterThan(0); // 自带配色是有意的
});
```

> 这条测试的价值：把"70 个 hex 是例外而不是漏改"钉在代码里，避免下一轮 review 反复重启这个话题。

---

## 4. 统一纳管方案（极薄，刻意不做抽象层）

### 4.1 目录规范

| 类型 | 放哪 | 命名 | 例子 |
| --- | --- | --- | --- |
| **通用**自绘图标（≥2 个消费方） | `src/components/ui/icons/`（**新建**） | `<功能名>Icon.tsx`，一文件一图标，具名导出 | `icons/CloudCheckIcon.tsx` |
| **单消费方**自绘图标 | **留在 feature 目录**（现状即最优，不搬迁） | 保持现状 | `features/outline/ExpandLevelIcon.tsx` |
| 内核 symbol | `features/editor/*Icon.tsx`（**必须**留这里，由 `ensureCustomCardIcons` 注册） | 现状 | `noteRefIcon.tsx` |
| 数据资源（插画） | `src/lib/notebookIcons.tsx`（数据 + 编码器同处） | 现状 | — |

**为什么不搬 13 个文件**：搬动 = 13 处 import + 快照键变化风险 + 0 视觉收益（§3#17「为统一而统一」）。只在**新建通用图标**时才用 `ui/icons/`。

### 4.2 图标文件头模板（4 行，可 grep 断言）

```tsx
/** <中文名> · <一句话用途>
 * 来源：自绘 | IconPark 1.4.2 es/icons/<Name>.js | 云端 lake symbol #<id> | 思源 iconExpandLevel
 * 网格：24（或登记例外：48/72/222/256/1024/20/18/14 + 换算）
 * 描边：继承 svg.lucide 1.75（或登记例外：不参与）· 许可：AGPL-3.0 / Apache-2.0
 */
```

### 4.3 三条渲染规则（本文的核心约束）

| # | 规则 | 机器可判据 | 违反后果 |
| --- | --- | --- | --- |
| **R1** | **描边图形**：`viewBox="0 0 24 24"` + `className="lucide"`（与 lucide-react 输出同构）+ `stroke="currentColor"` + `fill="none"` + `strokeLinecap/Linejoin="round"`，**禁止写 `strokeWidth`** | `grep -n 'strokeWidth' src/components/ui/icons/*.tsx` 应 0 命中（登记例外除外） | 写 `strokeWidth` = 出现第二个描边来源（现状 ExpandLevelIcon 的 1.7 就是死值陷阱） |
| **R2** | **填充图形**（对勾/折角/纸页）：`viewBox="0 0 24 24"`（新图形必须；存量按登记例外），颜色只用 `currentColor` 或 `var(--lake-*)`，**不需要** `lucide` 类（描边权重与它无关） | `grep -n '#[0-9a-fA-F]\{3,8\}' src/**/*.tsx` 应 0 命中（数据资源例外） | 加 `lucide` 类到 fill 图形无害但无意义；写 hex 违反 themes 红线 |
| **R3** | **非 24 网格**（云端 1:1 / 内核 symbol / 数据插画）：**禁止加 `className="lucide"`**，必须登记 viewBox + 描边换算 | 头注释含「网格：」行；`grep -B2 'viewBox="0 0 \(48\|72\|222\|256\|1024\|20\|18\|14\)' ...` 与 `lucide` 同类文件不应同时命中 | **加类即几何崩坏**：256 网格 16px 下描边被压到 0.11px；1024 网格同理 |

> R3 的定量证据：`stroke-width` 是 **CSS 属性**，`svg.lucide{1.75}` 对**任何** viewBox 的 svg 都生效；渲染像素 = `1.75 × size / viewBoxWidth`。24 网格正好给 1.75@24 的等价量，其它网格全错。

### 4.4 为什么**不做** `<Icon>` 门面 / IconProvider / iconMap

- 现状 884 个调用点直接 `import { Plus } from "lucide-react"`，包体靠 tree-shake；加门面会破坏 tree-shake 或退化成动态映射（体积 + 类型丢失）。
- 唯一意图是"自绘图标也能被统一渲染"，而 R1 三条规则已经用 **1 个 class + viewBox** 达成，0 运行时成本。
- C 路径的收益本来就是"不新增范式"；建门面 = 自造第二范式（§3#22②）。
- **门禁成本**：门面要新写 render 测试 + 可能要改 884 处 import ⇒ 与"零风险小样本"完全冲突。

### 4.5 自绘图标如何"挂进"现有约定（三种接线，全部已存在）

| 场景 | 接线方式 | 例子 |
| --- | --- | --- |
| React 直接用 | `<XxxIcon size={14} />`（组件内部写死 viewBox/class） | ExpandLevelIcon、CloudCheckIcon |
| 注册表（业务键 → 组件） | 现有 3 个注册表之一：`treeIcons.tsx` / `FileKindIcon.tsx` 的 `KIND_ICON` / `SheetIcon.tsx` 的 `ICONS` | `FileBadgeIcon` 由 `FileKindIcon` 按 size 分支返回 |
| 内核 sprite | 组件只渲染 `<symbol>`，由 `kernelConfig.ensureCustomCardIcons()` 收集 | `NoteRefIconSymbol` / `LockedTextIconSymbol` |

---

## 5. 颜色怎么落 token（含门禁盲区）

### 5.1 命名与落点（先分清 themes 里有两类令牌）

| themes 文件 | 放什么 | 现有例子 |
| --- | --- | --- |
| `light.css` / `dark.css` / `warm.css` / `chat.css` | **随主题变的语义令牌**（表面/文字/边框/开关轨道…） | `--lake-bg-sunken`、`--lake-switch-off-track`（后者是 Lead 本轮 261116 新加的，四个主题各一份） |
| `base.css` | **专用调色板 / 数据图形色**（不随主题语义变，随"图形语义"变） | `--lake-ai-icon-*`、`--lake-ai-tag-*`、`--lake-file-*`、`--lake-note-ref-icon-*` |

色板对勾属于**第二类**：它的取色判据是"swatch 底色深浅"（`isLightColor`），与主题明暗无关 ⇒ 只需要 `base.css` **一份**，不需要 dark 覆盖。

| 现有 hardcode | 新 token（`src/styles/themes/base.css`） | 说明 |
| --- | --- | --- |
| `checkFill()` → `#8C8C8C` | `--lake-colorboard-check-ink` | swatch 底色是**任意用户色** ⇒ 只能用两组固定高对比色，不能跟主题语义色走 |
| `checkFill()` → `#FFFFFF` | `--lake-colorboard-check-paper` | 同上；默认行对勾也复用它 |
| 默认文字色块 `#000000` | `--lake-colorboard-default-swatch` | 它是"黑色文字"的色样，不是 UI 语义色 ⇒ 必须独立令牌，**不要**复用 `--lake-text-1`（换主题会变色样） |

**顺序铁律：先定义 token（本次只需要 `base.css`），再改 tsx 引用。** 反了会红 `ui-metrics`（§5.3）。

### 5.2 为什么这些颜色不能"就地复用语义令牌"

- 色板对勾是**在任意颜色底上**画的对勾 ⇒ 需要固定高对比，跟主题明暗无关；
- 而 `--lake-text-*` 是按"会铺到的最浅/最深表面"标定的（AGENTS §3#14）⇒ 套上去在极端 swatch 上会失去对比；
- ⇒ 正确做法就是"专用令牌 + 明确注释这是**对比色而非语义色**"，避免下一轮 review 又提"为什么不用语义令牌"。

### 5.3 门禁真相（三条，实测自源码）

| 门禁 | 覆盖范围 | 对本计划的影响 |
| --- | --- | --- |
| 「颜色字面量只允许出现在 themes/」 | `scripts/ui-metrics.mjs` 的 `desktopColorLiterals/mobileColorLiterals` **只遍历 `.css`**（`desktopCss/mobileCss`） | **tsx 里的 hex 门禁抓不到**（LakeColorBoard 5 个、notebookIcons 70 个都在"雷达外"）⇒ 只能靠评审/新增审计脚本 |
| `var(--lake-*)` 未定义 | 扫**全部 css** + 把 **tsx 里出现过的** `--lake-*` 放进 `runtimeTokens` 豁免 | 新 token 若只在 tsx 用、CSS 没定义，**不会红**（豁免）；但仍必须定义，否则运行时取不到值（对勾变黑/透明） |
| `cssLayers.test.ts` 声明数棘轮 | 只对 `FILES` 白名单里的桌面/移动 CSS 计数（`kit.css` 基线 **711 → 713**，Lead 本轮 +2；`compat.css` 也随设置页布局 +声明） | **`styles/themes/*.css` 不在白名单** ⇒ 加 token 不触发棘轮；若批次给 `kit.css` 等加声明则必须同步 bump |
| `font-size` 字面量 | 只扫 CSS | 与图标无关 |

### 5.4 已落地（261116，报告型非门禁）：`scripts/audit-icons.mjs`

与 `audit-dead-css.mjs` 同档的**报告型**脚本：**不进 CI、不阻塞任何流程、退出码恒 0**（末行显式 `process.exitCode = 0`，头注释写明"这是报告，不是门禁"）。`package.json` 只加了 `"audit:icons"` 一条 script，**没有**接进任何 `check:*` 链。

- 用法：`node scripts/audit-icons.mjs [--json]` / `npm run audit:icons`。
- 判据来源（脚本头同样写明）：AGENTS §3#14（颜色字面量只允许在 `src/styles/themes/`；图标只用 lucide、描边 1.75）+ 本文 §4.3 的 **R1/R2/R3**。
- 实现范围：① `src/**/*.tsx` 里的颜色字面量（`#[0-9a-fA-F]{3,8}`、`rgb()/rgba()`、`hsl()/hsla()`、`data:image/`），按文件分组、带行号与总数；② 三个 svg 上下文计数（内联 svg 标签总数 / 带 `className=lucide` 的自绘 svg / 无 `className` 的内联 svg）；③ 每行额外标注是否落在内联 `<svg>…</svg>` 区间。
- **与原设想（②③④）的差**：viewBox 汇总、"lucide 类但 viewBox ≠ 24"、"strokeWidth 位置" 三类**未做**——它们与 §4.3 表格里已给的 `grep` 断言重复，加进脚本只会制造第二套口径；真要门禁化再做（届时先过 §3#17）。
- 行数：**103 行**（含 18 行头注释；纯逻辑约 85 行）。比原估 40 行多，主要花在 `--json`、in-svg 标注、测试文件计数。

#### 5.4.1 首次运行基线（干净 HEAD `cc066930`，261116）

复现方式（**不碰工作区**，用 git archive 取干净 HEAD）：

```bash
rm -rf /tmp/audit-head && mkdir -p /tmp/audit-head
/usr/bin/git archive HEAD src | tar -x -C /tmp/audit-head
AUDIT_ROOT=/tmp/audit-head node scripts/audit-icons.mjs
```

```
扫描 415 个 .tsx；命中 14 文件 / 39 行 / 90 处
（落在内联 <svg> 区间 70 处；测试文件 6 个）
svg 上下文：内联 svg 标签 40 个；带 className=lucide 1 个；无 className 36 个
```

> **这是快照，不是承诺**：写本文时批次 1/2 正在并行改图标组件（`CloudCheckIcon` 加 `lucide` 类、`ExpandLevelIcon` 删 `strokeWidth`、`LakeColorBoard` 落 token），同一时刻工作区实测已漂到 **14 文件 / 36 行 / 86 处**、svg **39 / 3 / 33**。所以：**以运行结果为准**；本表只用来回答"首次跑出来长什么样"。

| # | 文件 | 处数 | 性质 | 处置 |
| --- | --- | ---: | --- | --- |
| 1 | `src/lib/notebookIcons.tsx` | 70 | **数据资源自带配色**（§3 J1+J4；17 个语雀插画） | **不违规**，冻结；建议按 §3.2 加守卫测试 |
| 2 | `src/features/editor/selectionToolbar/LakeColorBoard.tsx` | 5 | 色板对勾/默认 swatch 的 hex | **批次 2 整改**（落 `--lake-colorboard-*` 令牌；写本文时正在改，命中数会下降） |
| 3 | `src/features/ink/inkPageTexts.render.test.tsx` | 2 | 测试夹具里的 `#262626` | 非 UI，可不处理 |
| 3 | `src/mobile/settings/UpdateCenterSection.tsx` | 2 | TS 颜色常量（`#3f5fa0` / `#5b6472`） | 待看：是否该走令牌 |
| 3 | `src/mobile/usheet/MobileSignaturePad.tsx` | 2 | `#1f2329` + `rgba(0,0,0,0)` | 待看（签名笔迹色可能需数据驱动例外） |

**解读（比总数更重要）**：90 处里 **70 处（77.8%）是 notebookIcons 的有意例外**；扣掉后真正的待办面 = **20 处 / 13 个文件**，其中批次 2 只涉及 `LakeColorBoard` 的 5 处。另有 3 处 `data:image/`（`BoardEditor.tsx:483` 的 accept/上传分支 + 2 个测试夹具）**不是颜色**，是正则按任务书纳入的噪音——读报告时按 `[svg]` 标注与文件性质过滤即可。

> 口径提醒：这份报告**只回答"哪些 tsx 里有颜色字面量"**，不回答"这个颜色是否该是令牌"；判定仍按 §5.1 的两类令牌 + §3 的 J1–J4。

---

## 6. 几何对齐：24 网格 / 1.75 描边的换算与现值

### 6.1 唯一换算式

```
渲染描边(px) = strokeWidth(用户单位) × 显示尺寸(px) / viewBox 边长
等价条件：strokeWidth / viewBox边长 = 1.75 / 24 = 0.0729…
```

| viewBox | 等价的 strokeWidth | 备注 |
| ---: | ---: | --- |
| 24 | **1.75** | 唯一允许"不写 strokeWidth"的网格（由 `svg.lucide` 提供） |
| 48 | 3.5 | IconPark 默认 4 ⇒ 直接用会重 13%（C-poc §2.1 实测） |
| 72 | 5.25 | 但 noteRef/lockedText 在 36px 下实际用 2/3 ⇒ 1.0/1.5px，是有意的例外 |
| 256 | 18.67 | imageIcons 用 20 ⇒ 1.25px@16px，比 lucide 的 1.17px 重 0.08px（可接受） |
| 1024 | 74.67 | RowExpand 是 fill 图形，不适用 |

### 6.2 各文件在真实尺寸下的描边（实测换算）

| 文件 | 声明 | 尺寸档 | 实际描边 | 与 lucide 同尺寸对比 |
| --- | --- | --- | --- | --- |
| lucide 全仓 | CSS 1.75@24 | 14 / 16 / 18 | 1.02 / 1.17 / 1.31px | 基准 |
| ExpandLevelIcon | 1.7@24（**被 CSS 覆盖**） | 14 | **1.02px** | 一致 ✅ |
| CloudCheckIcon | 2@24 | 14 | **1.17px** | **重 15%** ❌ |
| imageIcons（6 个 256 网格） | 20@256（stroke 属性） | 16 | 1.25px | 重 0.08px ≈ 一致 ✅ |
| imageIcons（3 个 14 网格） | 纯 fill | 16 | — | 不适用 ✅ |
| FileBadgeIcon | 纯 fill | 28–46 | — | 不适用 ✅ |
| RowExpandIcon | 纯 fill@1024 | 15 | — | 不适用 |
| noteRef symbol | 2@72 | 36（0.5 缩放） | 1.0px | 对齐 1.75@24 的 36px 值（2.6px）？**不等**——插入面板图标是"卡图标"不是线性图标，登记例外 |
| lockedText symbol | 3@72 | 36 | 1.5px | 同上，且与 noteRef 不等（有意的锁体加重） |
| notebookIcons | 0.976@20 或 fill | 20 | 0.976px | 多色插画，不适用 |

### 6.3 「对齐 24 网格」到底改什么（不是把 48 等分）

- **只有需要 R1 的图形才重画**（描边线性图标）。本批 = `LakeColorBoard` 对勾（fill 图形，重画原因不是描边而是**视窗裁剪 bug**）。
- imageIcons / FileBadge / RowExpand **不重画**：它们已是正确换算，重画 = 与云端分叉 + 白付快照风险。
- 若将来真要重画 48→24：**路径坐标除以 2**，并把 `strokeWidth` 换成 3.5/2=1.75 的等价（即删掉，交给 CSS）。这一步必须 4× 实拍对照，不能只看 diff。

---

## 7. 从 IconPark 抄单个 SVG（Apache-2.0）：什么时候该抄

### 7.1 先纠正方向（任务书措辞需更新）

B 卷的 4 个"无对应"图标 = `CheckCheck`（`SyncConflictsPanel`「全部标记已读」）、`SquarePlus`（`InkPad` 新建页）、`Superscript` / `Subscript`（移动 dock 上标/下标）——**这些是 lucide 有、IconPark 没有**。

⇒ 走 C（不换库）时它们**根本不是缺口**；反过来，它们是"不换库"的**收益证据**：换 IconPark 反而要自己补 4 个图形（B 卷 §2.5 的低置信度项）。

**C 路径下"抄单 SVG"只该用于 3 类动机**：① 现有自绘图形的**许可/来源更干净**（IconPark Apache-2.0 vs 语雀抓取）；② 现有自绘图形**几何不达标**（裁剪/描边/网格错）且重画不值得；③ 想给某个已有语义换一位"同一套线性语言"的图形。

### 7.2 候选清单（3 个 + 1 个不建议）

| 现状 | IconPark 候选 | 网格 | 判定 | 备注 |
| --- | --- | --- | --- | --- |
| `CloudCheckIcon`（24 网格、2px、无类） | `LinkCloudSucess`（云 + 内嵌对勾，48 网格 2 条 path） | 48 | **备选**（优先级低于"直接加 lucide 类"） | 形状更接近 lucide `Cloud` 家族；但要重画到 24 或保留 48+显式 3.5（不能加 lucide 类，R3） |
| `RowExpandIcon`（四角外扩箭头，1024 fill） | `FullScreen`（四角折角，48 网格 4 条 path，纯描边） | 48 | **备选（低优先）** | 语义对得上（四角），但从"填充"变"线性"= 观感换语言；且 `check:bitablesnap` 3 态会红 |
| `LakeColorBoard` 对勾 | `Check` / `CheckSmall`（48 网格单 path） | 48 | **不推荐** | 对勾是 **fill 图形**（叠在任意色块上），IconPark 的是 stroke 图形 ⇒ 仍需自己重画；且 24 网格手画一条 `M4 12.5 9 17.5 20 6.5` 就够了 |
| `ExpandLevelIcon`（思源 AGPL，24 网格） | `ExpandDown` / `ClickToFold` | 48 | **不建议** | 语义不等（"列表 + 上下箭头" vs "方块 + 箭头"）；且 AGPL 与本仓同协议，**没有换的许可动机** |

**结论**：本计划**不含**必须抄 IconPark 的项。抄图流程作为"备选工具箱"写下，等真有需要（例如用户要求把同步图标换成云端同款）再启用。

### 7.3 抄单 SVG 的 6 步规范（任何一次抄都必须走完）

1. **取证**：`/tmp/iconpark-probe/node_modules/@icon-park/react/es/icons/<Name>.js`（已装 1.4.2），记下 `viewBox`、每个 `path/rect` 的 `d`/坐标、默认 `strokeWidth`（outline=4）。
2. **判网格**：48 网格 ⇒ 想要 1.75@显示 ⇒ **重画到 24（坐标 ×0.5）**，或保留 48 并显式 `strokeWidth={3.5}` 且**不加** `lucide` 类（登记为 R1 例外）。
3. **去 React 包装**：只保留图形元素，**不要**抄 `IconWrapper`/`props.colors`/`theme`（那是它的运行时；抄进来就是第二范式）。
4. **配色归一**：`props.colors[0]` → `currentColor`；多色（`colors[1..3]`）→ 只用 `var(--lake-*)` 或按 J4 登记。
5. **落文件 + 头注释**：新建 `src/components/ui/icons/<Name>Icon.tsx`，用 §4.2 模板，来源写死 `IconPark 1.4.2 es/icons/<Name>.js`。
6. **登记许可**（见 §7.4）+ 4× 实拍（抄来的图形必须和邻居 lucide 一起看）。

### 7.4 许可义务（Apache-2.0）+ NOTICE 一行

- IconPark `@icon-park/react@1.4.2` 是 **Apache-2.0**（实测 `package.json.license`），**包内无 NOTICE 文件**（`ls | grep -i notice` 为空）⇒ Apache-2.0 §4(d) 的 NOTICE 传递义务**不触发**。
- 仍需履行：**§4(a)** 保留版权/许可声明、**§4(b)** 修改过的文件要注明改动、**§4(c)** 保留 LICENSE 副本。实操：
  1. 把 IconPark 的 `LICENSE` 随仓入库（现行落点 `LICENSES/IconPark-APACHE-2.0.txt`）；
  2. 抄来的文件头写 3 行 provenance（来源文件 / 原 viewBox / 是否改动几何）；
  3. 在仓库根 `NOTICE` 的「二、其它第三方」追加一行：

```text
- IconPark（@icon-park/react 1.4.2，Apache-2.0，bytedance）：src/components/ui/icons/<Name>Icon.tsx 的图形几何
  取自其 es/icons/<Name>.js（原 viewBox 0 0 48 48），本项目仅重写渲染包装、未改图形；不依赖其运行时。
  上游仓库已归档（2023-02-24），故不引为依赖。完整许可见 LICENSES/IconPark-APACHE-2.0.txt。
```

- **本项目自有代码是 AGPL-3.0-only**（`NOTICE` 首行）：Apache-2.0 与 AGPL-3.0 **兼容**（可单向并入），无冲突。
- **禁止事项**：① 不要把 `@icon-park/react` 写进 `package.json`（违反 DECISION 结论）；② 不要抄 `es/styles/index.css`（第二套图标样式）；③ 不要抄整个 `es/` 目录或超过"少量单图形"的量（量大了就该重走依赖准入四问）。

---

## 8. 三批次实施计划

> 前置：全部批次**只动 tsx**，不动 CSS 声明（除批次 2 在 `themes/*.css` 加 token —— 那不在 `cssLayers.test.ts` 白名单内）。移动端 `src/mobile/**` 全程 0 改动 ⇒ **不需要装机验收**（AGENTS §3#21④）。
> 通用门禁（每批都跑）：`npx tsc --noEmit` → `npx vitest run <受影响测试>` → `node scripts/ui-metrics.mjs` → `git diff --check`。

### 批次 1（低风险小样本 · 预计 <1 小时 · 快照 0 红）

| 项 | 内容 |
| --- | --- |
| 文件 | ① `src/features/outline/ExpandLevelIcon.tsx`：删 `strokeWidth={1.7}`，头注释补「描边由 svg.lucide 统一」<br>② `src/components/app/SyncStatusPopover.tsx`：`CloudCheckIcon` 加 `className="lucide"`、删 `strokeWidth="2"`<br>③（建议同批）`src/features/outline/ExpandLevelIcon.render.test.tsx`（新）：断言 `svg.lucide`、无 `stroke-width` 属性、`viewBox="0 0 24 24"` |
| 视觉变化 | ① **0**（死值删除，像素级相同）；② 14px 下 1.17→1.02px（−13%，需要人眼确认"不再比邻居重"） |
| 测试 | `npx vitest run src/features/outline src/components/app`（新增 render 测试 + 现有 SyncStatus 相关） |
| 门禁成本 | `ui-metrics`：0 变化（无 CSS/无 token）· `cssLayers.test.ts`：0（无 CSS）· **stylesnap**：预计 42 态 **0 红**（`outline-sidebar` 在夹具 0 命中；`CloudCheckIcon` 分支不渲染）⇒ 按 §3#21② 只抽 **1 态**复检：`--states "plain:1315:light"` · **mobilesnap**：0（不动移动端）· `check:bitablesnap`：0 |
| 风险 | 低。「加 `className="lucide"`」是 `svg.lucide` 选择器命中条件的改变 ⇒ 若该 svg 上有其它依赖 `svg` 的样式（`SyncStatusPopover` 内无 `> svg` 直系选择器）需 grep 一次确认 |
| 验收 | ① render 测试绿；② 顶栏 4× 截图（同步完成态 / 深色）；③ 1 态 stylesnap 复检 0 差异；④ `git diff` 只有 2 个文件 + 1 个新测试 |

### 批次 2（几何归一 + 颜色落 token · 预计 2–3 小时 + 重烤 1 态/主题）

| 项 | 内容 |
| --- | --- |
| 文件 | ① `themes/base.css`（**只这一个主题文件**，理由见 §5.1）：新增 3 个 `--lake-colorboard-check-ink/paper、--lake-colorboard-default-swatch`<br>② `LakeColorBoard.tsx`：对勾重画到 24 网格（修裁剪）、5 个 hex → token（3 个引用点）<br>③ `AiTagIcon.tsx`：`useId()` 替换固定 `id="ai-tag-grad"`<br>④ `imageIcons.tsx` / `bitableEditorModel.tsx` / `FileBadgeIcon.tsx`：**只补头注释**（网格/换算/来源/R3 警告）<br>⑤ 新 render 测试：`selectionToolbar/LakeColorBoard.render.test.tsx`（断言 24 viewBox、无 hex、token 名、对勾路径不出界） |
| 视觉变化 | ① 对勾不再被裁（右下补齐）；② AI 渐变视觉不变（只是 id 唯一化）；③ 注释 0 变化 |
| 测试 | `npx vitest run src/features/editor/selectionToolbar src/features/ai src/features/bitable` |
| 门禁成本 | `ui-metrics`：颜色字面量计数**本来就只扫 CSS** ⇒ 改 tsx 的 hex **不改变数字**；新增 token 会让「未定义令牌」检查走 tsx 豁免 ⇒ **仍必须定义**（否则运行时取不到色）· `cssLayers.test.ts`：0（themes 不在白名单）· **stylesnap**：`lake-colorboard` 42 态 0 命中、`ai-tag` 0 命中 ⇒ 预计 **0 红**；但批次 2 动了 `themes/*.css`（**全局令牌文件**），保守做法 = 抽 **4 态**复检：`plain:1315:light,plain:1315:dark,plain:1315:warm,settings:1315:light` · mobilesnap：0（`src/mobile/**` 未动） |
| 风险 | 中低。① 对勾颜色依赖 `isLightColor(hex, 210)` 判定 ⇒ 重画只动路径、**不能动判定函数**（否则选中色一变全色板观感都变）；② `themes/base.css` 是 Lead 也可能在改的文件（他改的是 `kit.css`，冲突面小，但需先 `git diff` 一次）；③ 深色主题下 token 值要人眼确认对比 |
| 验收 | ① 色板在浅/深/暖三主题下 4× 实拍（含白底 swatch、浅黄 swatch、黑底 swatch 三种极端）；② 对勾四角完整（放大到 4× 看）；③ `AiTagIcon` 两处同屏（选区工具条 + 图片卡工具条）DOM 里只有一个 `id`；④ 4 态 stylesnap 0 差异 + 人眼复核 |

### 批次 3（冻结 + 守卫 + 登记 · 预计 1–2 小时 · 快照 0 红）

| 项 | 内容 |
| --- | --- |
| 文件 | ① `noteRefIcon.tsx` / `lockedTextIcon.tsx`：头注释补「**不得增删图形元素**（42 态快照风险）」+ 描边例外说明（1.0 / 1.5px）<br>② `nodeIcons.test.ts`：追加插画守卫测试（§3.2）<br>③ `notebookIcons.tsx`：头注释指向本文件 §3 判据（"冻结，不是漏改"）<br>④ `docs/icon-migration/C-PATH-PLAN.md`：把 §0.1 处置表回填"已完成/批次号"（本文件即唯一登记处） |
| 已裁定不做 | `RowExpandIcon` 换 `FullScreen`（留 §7.2 备选，需用户点单）；`ExpandLevelIcon` 换 IconPark（语义不等 + 无许可动机）；notebookIcons 换自有图形（版权注释已写明"对外分发时"才需要，属发版决策不是重构） |
| 门禁成本 | 全 0 变化（只加注释 + 测试）· `vitest`：`src/lib/nodeIcons.test.ts` · stylesnap/mobilesnap/bitablesnap：**不跑**（无行为变化；按 §3#21② 只在动了视觉那层才跑） |
| 风险 | 低。唯一风险是"注释写了规则但没人守" ⇒ 用 §5.4 的审计脚本兜（可选） |
| 验收 | ① 新守卫测试在**故意改坏**时能红（自证一次）；② `git diff` 只含注释 + 测试 |

### 8.1 依赖与顺序（必须遵守）

1. **批次 1 可立即做**（不与任何人的改动交叉：无 CSS、无基线）。
2. **批次 2 与 Lead 的改动无文件重叠，但基线只有一份**：我的 3 个 token 落 `themes/base.css`（Lead 改的是 `light/dark/warm/chat.css` + `kit.css` + `compat.css`）。真正的耦合是 `scripts/css-audit/baseline/stylesnap.json`（Lead 已 M）—— 两人同时 `--write-baseline` 会互相覆盖。策略：批次 2 **只跑 `--states` 复检、不重烤**；若人眼判定确实有差异（预期没有），等 Lead 基线落地后由 Lead 统一重烤。
3. **批次 3 最后做**（它把前两批的结论固化成注释/测试）。

---

## 9. 与「设置页 CSS 改动」叠加时的注意事项

> 本节按"审计时实测到的 Lead 工作区状态"写；他在我审计期间还扩过一次面（从 `kit.css` 扩到 themes/compat/设置页 JSX），所以下面按**文件级**给口径，不按"他大概只会改哪些"。

Lead 当前工作区（`git diff --stat` 实测，10 个 M）：

| 文件 | 改了什么 |
| --- | --- |
| `src/styles/kit.css` | `.ln-switch` 几何（32×19→36×20、knob 15→16、位移 13→16px、关态轨道改实体）+ `.ln-select--native` `align-items:center` |
| `src/styles/compat.css` | 设置页块状行布局：`.config-block > .config-block__actions` 右对齐、新增 `.config-stats` 统计行 |
| `src/styles/themes/{light,dark,warm,chat}.css` | 新增 `--lake-switch-off-track`（四个主题各一份） |
| `src/components/app/settings/sections/{AboutSection,BackupSection}.tsx` | 设置页 JSX（动作组/统计行） |
| `src/styles/cssLayers.test.ts` | `kit.css` 711→713 基线（行内注释同步） |
| `scripts/css-audit/baseline/stylesnap.json` | 设置相关态重烤结果 |

| 叠加风险点 | 具体态/文件 | 处理口径 |
| --- | --- | --- |
| **基线文件互写**（最高风险） | `scripts/css-audit/baseline/stylesnap.json`（Lead 已 M） | 我这几批**一律不许 `--write-baseline`**；重烤是"一次、单一 owner"：由 Lead 在设置页改动收口后执行。我的批次只跑 `--states` 复检，0 差异就收工 |
| **设置页受影响态（7 个桌面态）** | `settings:1315:light`、`settings:1315:dark`、`settings:1315:warm`、`settings-editor:1315:light`、`settings-data:1315:light`、`settings-trash:1315:light`、`settings-about:1315:light` | 这 7 态的红**全部来自 Lead 的开关/行布局/统计行**，与图标无关。我的抽验态尽量避开（批次 2 的 4 态里保留一个 `settings:1315:light`，用途是"证明我没改到设置页"，不是验收设置页） |
| **移动端设置 5 态** | `settings`、`settings-appearance`、`settings-s3`、`settings-backup`、`settings-about`（移动 10 态） | Lead 改的是**桌面** `kit.css/compat.css`；移动是 `src/mobile/**` 另一份。我全程不动移动 ⇒ 移动 10 态与两人都无关，不必抽 |
| **themes 文件同目录** | `light/dark/warm/chat.css` 正被 Lead 改；`base.css` **未被动** | 批次 2 的 3 个 token 落 **`base.css`**（专用调色板那一类，§5.1）⇒ **与 Lead 零文件重叠**。若评审要求也进主题文件，**必须排在 Lead 之后**，否则同一文件并发编辑 |
| **`cssLayers.test.ts` 同文件编辑** | Lead 已改（`kit.css` 711→713） | 我的批次**不加任何 CSS 声明**（token 在 themes，不在棘轮白名单）⇒ 不碰该文件。若某批必须给 `kit.css` 加声明，**排在 Lead 之后**共享同一次 bump |
| **共享的 `.ln-*` 原语** | `.ln-iconbtn`/`.ln-btn` 的 `> svg { display:block; flex-shrink:0 }` | 图标尺寸沿用调用方（DESIGN 规则），我的改动不碰 `> svg` 直系选择器 ⇒ 与开关/行布局改动零交叉 |
| **设置页搜索项** | `settingsSearch.ts` `SETTING_ITEMS`（AGENTS：每加/改一行必须同步） | 本计划**不加设置行** ⇒ 不需要动 `settingsSearch.test.ts` |
| **人工验收分工** | 4× 截图 | 设置页 7 态由 Lead 出图；我出"顶栏同步按钮（同步完成态/深色）+ 大纲头部 + 色板（3 主题各 3 种 swatch）"局部图，避免重复劳动 |
| **不准顺带"修"设置页** | — | 我看到的设置页差异（若抽验命中）**只记录不修改**；设置页本轮归 Lead |

---

## 10. 门禁盲区（必读）：快照"0 红"不等于"没变"

**指纹白名单**（`scripts/css-audit/stylesnap.mjs` 的 `PROPS`，共 60 项）里**没有** `fill`、`stroke`、`stroke-width`、`d`、`viewBox`、`stroke-linecap`。快照行的 key = `tag + id + class`，签名 = 计算值白名单 + `getBoundingClientRect()`（×2 取整）+ 伪元素。

因此：

| 改动类型 | 快照会不会红 | 原因 |
| --- | --- | --- |
| 换 `d`（路径形状变了但外接盒几乎不变） | **可能不红** | `d` 不入指纹；只有 bbox 变化 ≥0.5px 才通过 rect 反映 |
| 换 `fill`/`stroke` 颜色（含 hex → token） | **不会红** | 颜色属性不在白名单（只有 `color`/`backgroundColor` 等 CSS 属性在） |
| 改 `stroke-width` | **大概率红** | `getBoundingClientRect` 含描边 ⇒ bbox 变 |
| 加/删一个图形元素 | **必红**（该图标渲染的态） | `svgraw$*` 是排序多重集，元素数变化 |
| 加/删一个 class 或外层元素 | **必红** | key 变化 |
| 只改注释 / 只改 `useId()`（DOM id 变了但无 class） | 可能红 | 无 class 的 svg 进 rawSvg（id 不入 key）⇒ 通常不红；若元素带 class 且 id 参与 key，则红 |

**⇒ 验收清单（每批都要做，不能省）**：

1. **4× 实拍**：用 `--force-device-scale-factor=4` 的 CDP 截图，抓"改动图标 + 左右邻居"同框（对比"是不是还和 lucide 一样重"）；
2. **三主题**：浅色必看；动了 `themes/` 必看深色 + 暖色；
3. **render 测试断言结构**：`className` 含 `lucide`、无 `strokeWidth`、`viewBox` 正确、无 hex —— 这是"门禁看不见的部分"唯一的机器护栏；
4. **故意改坏自证**：新守卫测试先制造一次失败（改 viewBox 为 48），确认它真的会红（对应 AGENTS「探针看不见比报错危险」）；
5. 快照只用来回答"我有没有**顺带**改到别处"（0 差异 = 没碰其它元素），**不用来回答"图标对不对"**。

---

## 11. 复现命令（全部只读）

```bash
cd "$(git rev-parse --show-toplevel)"   # 仓库根

# ① 13 个文件的 hex / 令牌 / svg 数 / viewBox（本文 §1.1 的表）
node -e 'const fs=require("fs");const files=[...];for(const f of files){const s=fs.readFileSync(f,"utf8");
 console.log(f,"hex="+(s.match(/#[0-9a-fA-F]{3,8}\b/g)||[]).length,
 "varLake="+(s.match(/var\(--lake-[a-z0-9-]+\)/g)||[]).length,
 "<svg>="+(s.match(/<svg/g)||[]).length,
 "viewBox="+JSON.stringify([...new Set([...s.matchAll(/viewBox="([^"]+)"/g)].map(m=>m[1]))]));}'

# ② 42 态快照里各图标组件的 DOM 命中（本文 §1.2；base3.json = 42 态全量）
node -e 'const j=JSON.parse(require("fs").readFileSync(".css-audit/snap/base3.json","utf8"));
const states=Object.keys(j.states);const probes=["node-icon-glyph","lake-colorboard","ai-tag","bt-file-badge",
 "bt-file-icon","outline-sidebar","note-ref","locked-text","svg.lucide","svgraw$path"];
for(const p of probes){const n=states.filter(s=>j.states[s].rows.some(r=>String(r[0]).includes(p))).length;
 console.log(p,"=>",n,"/",states.length,"states");}'

# ③ 10 态移动快照（同上，用 .css-audit/snap/mob-after.json；探针 mb-node-glyph / mb-btn）
# ④ 门禁基线：42 态 / 10 态 / 多维表 3 态
node -e 'console.log(Object.keys(require("./scripts/css-audit/baseline/stylesnap.json").states).length)'
node -e 'console.log(Object.keys(require("./scripts/mobile-audit/baseline/mobile-snap.json").states).length)'

# ⑤ IconPark 单图标几何（/tmp/iconpark-probe 已装 1.4.2；不污染仓库）
sed -n '1,60p' /tmp/iconpark-probe/node_modules/@icon-park/react/es/icons/FullScreen.js

# ⑥ 只读核对：M 全部来自 Lead 与其它线的并行工作，本计划不应新增任何 M；untracked 里应有 docs/icon-migration/
git status --short
```

---

## 12. 未做 / 边界 / 待裁决

**本次未做**（按只读纪律）：

- 未改 `src/` 任何文件（本文所有处置都是"给执行者的清单"）；未重烤任何快照基线；未跑设备装置（无 Electron/AVD 实例）；未 commit。
- 未逐个 4× 实拍 13 个图形（无运行实例）；本文的"视觉判定"来自声明值 + 换算 + 文件头设计意图，**执行批次时必须补实拍**。
- **工作区在本次审计期间被并行改动过两次**（Lead 的设置页改动从 `kit.css` 扩到 `themes/{light,dark,warm,chat}.css` + `compat.css` + 两个设置页 section）；本文 §9 的口径是**按文件**写的（不按他的改动范围猜），因此仍然成立；但执行批次前必须重跑一次 `git status --short` 与 `git diff --stat` 复核。
- ~~未做 `docs/DESIGN.md` 的措辞更新~~ → **261116 已补**（Lead task-10）：`DESIGN.md:402` 原句不动，句末追加「自绘图标的处置与边界（哪些允许脱离 24 网格 / 1.75 描边、J1–J4 判据）见 `docs/icon-migration/C-PATH-PLAN.md` §3」。

**待 Lead/用户裁决（3 个 → 261116 已结 2 个）**：

1. ~~`RowExpandIcon` 是否换 IconPark `FullScreen`~~ → **261116 用户裁决：换**，已执行（见 §13.1/§13.2）；视觉结论「与 lucide 一致、与云端语雀分叉」记录在 §13.2，回滚点 = 单文件 4 行 path。
2. ~~`docs/DESIGN.md` 是否补"自绘例外"口径~~ → **已结**：261116 已在 `DESIGN.md:402` 原句后追加 §3 指针（见 §12 上一条）。
3. ~~§5.4 的报告型 `scripts/audit-icons.mjs` 要不要做~~ → **已结**：261116 已落地（`scripts/audit-icons.mjs` + `npm run audit:icons`，零门禁、退出码恒 0），首次基线见 §5.4.1。

---

## 13. 执行记录（task-9 · 261116）：B1/B2 落地 + RowExpandIcon 换 IconPark FullScreen

> 只改 `src/` + `NOTICE` + 本文件；未 commit；未跑 `--write-baseline`；未 pkill Electron / 模拟器。

### 13.1 改了哪些文件

| 文件 | 改动 | 对应计划 |
| --- | --- | --- |
| `src/features/outline/ExpandLevelIcon.tsx` | 删 `strokeWidth={1.7}`（死值：带 `lucide` 类时被 CSS 1.75 压过），头注释写明单一来源 | §0.1 #5 / 批次 1① |
| `src/components/app/SyncStatusPopover.tsx` | `CloudCheckIcon` 加 `className="lucide"`、删 `strokeWidth="2"`；改为具名导出（仅供 render 测试） | 批次 1② |
| `src/features/editor/selectionToolbar/LakeColorBoard.tsx` | 对勾抽成 `BoardCheck` 并把 `viewBox` 18→24（几何不动，修裁切）；4 个绘制 hex → 令牌；`<input type="color">` 的 `#000000` 初值收成具名常量 | 批次 2 |
| `src/styles/themes/base.css` | **+3 个专用调色板令牌**：`--lake-colorboard-check-ink` / `-check-paper` / `-default-swatch`；**未动** `themes/{light,dark,warm,chat}.css`（那是 Lead 的设置页面） | §5.1 |
| `src/features/ai/AiTagIcon.tsx` | 固定 `id="ai-tag-grad"` → `useId()`（`useId().replace(/[:]/g,"")`，同 notebookIcons 手法）⇒ 同屏两实例不再重复 DOM id | 批次 2 |
| `src/features/bitable/bitableEditorModel.tsx` | `RowExpandIcon` 换 IconPark `FullScreen`：48 网格坐标 ÷2 → 24 网格、`currentColor`、`className="lucide"`、4 条 path、不写 strokeWidth | 用户裁决 |
| `NOTICE` | 「二、其它第三方」+ IconPark 一行（Apache-2.0、来源 `es/icons/FullScreen.js`、坐标重写、未引运行时、上游已归档） | §7.4 |
| 新测试 ×5 | `ExpandLevelIcon.render.test.tsx` / `AiTagIcon.render.test.tsx` / `rowExpandIcon.render.test.tsx` / `LakeColorBoard.render.test.tsx` / `cloudCheckIcon.render.test.tsx`（jsdom + createRoot + `IS_REACT_ACT_ENVIRONMENT`，与 `NativeSelect.render.test.tsx` 同范式） | 批次 1/2 验收 |

### 13.2 视觉判断（4× 实拍 + 实测数字）

**实拍与测量产物**（都在 /tmp，可按需拷贝留存）：

| 产物 | 路径 |
| --- | --- |
| 总览 4×（三组图标 旧/新/邻居 并排） | `/tmp/icon-c-path-shots/c-path-icons@4x.png`（4616×2392） |
| 色板对勾 8×（含「放大 4× 示意被裁」行） | `/tmp/icon-c-path-shots/colorboard-check@8x.png` |
| 实测数值（盒/描边/溢出） | `/tmp/icon-c-path-shots/measure.json` |
| 探针脚本（可复跑） | `/tmp/icon-c-path-shots/probe.mjs`；跑法 `node scripts/css-audit/drive.mjs 9222 /tmp/icon-c-path-shots/probe.mjs` |

方法：向**正在运行的 dev 实例**（CDP :9222，`http://127.0.0.1:1421/`）注入一个 `position:fixed` 覆盖层，用**真实 app CSS**（含内核运行时注入的 `.lake-colorboard*`）渲染「旧 / 新 / lucide 邻居」三列，`Page.captureScreenshot` 带 `clip.scale=4`；测完立即移除覆盖层，**不点任何应用控件、不改应用状态**。

| 图标 | 旧 | 新 | 判断 |
| --- | --- | --- | --- |
| **RowExpandIcon**（15px 档） | 1024 网格**实心**对角双箭头；盒 15×15，computed `stroke-width: 1px`（fill 图形，描边无关） | 24 网格描边四角折角；盒 15×15，**computed `stroke-width: 1.75px`**（= 15px 下 1.09px，与 lucide 邻居同值），stroke=`currentColor` | **与 lucide 线性语言一致**（与 15px 参照 lucide 同粗细）；**与云端语雀明显分叉**：由「实心双箭头」变「细线四折角」，视觉份量更轻、四角留白更大。按用户裁决执行；若回看觉得偏弱，回滚点 = `bitableEditorModel.tsx` 的 4 行 path（旧 `d` 在 HEAD） |
| **CloudCheckIcon**（14px 档） | path computed `stroke-width: 2px`（24 网格 ⇒ 14px 下 1.17px） | path computed `1.75px`（⇒ 1.02px），与同按钮 lucide 邻居一致 | 符合预期：14px 下比原来轻 13%，与邻居齐平（原先明显偏重） |
| **LakeColorBoard 对勾** | 12px 盒（内核 CSS 给），path **11.67×8.94**，**溢出右 2.00px / 下 0.67px ⇒ 确认被裁** | 12px 盒，path **8.75×6.70**，右 -1.50 / 下 -2.50（完整） | 裁切修掉。视觉尺寸 11.67 → 8.75px（≈73%）：旧的是把 24 网格路径塞进 18 视窗（放大 1.33× 后裁边），新的是该路径的规范比例。若用户觉得对勾偏小，备选 = 保持 24 网格再把路径放大到 20×20 安全框（一处 `transform`，需再拍一次） |

### 13.3 门禁结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc --noEmit` | **exit 0** |
| 相关 vitest | `npx vitest run src/features/bitable src/features/outline src/features/ai src/features/editor/selectionToolbar src/components/app src/lib/nodeIcons.test.ts` | **102 文件 / 753 测试全绿** |
| 新增 render 测试 | 上述 5 个新文件单独跑 | **12 测试绿**（描边/网格/几何/令牌/唯一 id 全钉） |
| 样式指标 | `node scripts/ui-metrics.mjs` | **exit 0**：桌面颜色字面量 hex=0 rgb=0（目标 0）、未定义令牌 0、`!important` 9/9（允许清单内）、字号字面量 0、跨文件重复 45/45 |
| 层围栏 | `npx vitest run src/styles/cssLayers.test.ts` | **3 测试绿**（未新增 CSS 声明；新令牌在 `themes/base.css`，不在棘轮白名单） |
| 图标报告（非门禁） | `node scripts/audit-icons.mjs` | 按预期把 `LakeColorBoard.tsx` 的唯一 hex（输入初值）列为 1 处，其余改动文件 0 处 |
| **一条无关红** | `npx vitest run src/styles` | `primitives.test.ts` 红：`styles/feature.css :: .settings-panel .config-item > .config-item__ctl > :is(.settings-select, .ln-select--native)` 原语跨所有权覆盖 +1。**来自并行的设置页 CSS 改动**（`feature.css` 不在本任务改动集内），需 Lead 在原语侧加变体或调基线 —— 与本任务无关，未自行修改 |

### 13.4 快照结论：**不重烤、不动基线**

实测（`node /tmp/snapshot-impact.cjs`；`.css-audit/snap/base3.json`=42 桌面色 / `mob-after.json`=10 移动态 / `bitable-after.json`=3 多维表态）：

| 组件 | 桌面 42 态 | 移动 10 态 | 多维表 3 态 |
| --- | --- | --- | --- |
| ExpandLevelIcon（`.outline-sidebar`） | **0 / 42**（`outline-*` 态是**内核 TOC**，不是我们的 OutlineSidebar） | — | — |
| CloudCheckIcon | 42/42 有 `sync-status-icon` **容器**，但夹具按钮带 `workspace-local`（`localOnly`）⇒ 渲染 `HardDrive`，走不到 `synced` 分支 ⇒ **0 红** | 无该组件 | — |
| LakeColorBoard（`.lake-colorboard`） | **0 / 42** | — | — |
| AiTagIcon（`.ai-tag`） | **0 / 42** | — | — |
| RowExpandIcon（`.bt-row-expander`） | **0 / 42** | — | **0 / 3**（这 3 态是移动端 `.mbt-*` DOM，桌面行按钮不在里面） |
| notebookIcons（`.node-icon-glyph` / `.mb-node-glyph`） | 0 / 42 | 0 / 10 | — |

⇒ 按 §5/§10 口径：**命中 0 的不重烤**，本次三份基线都不动、也没有跑 `--write-baseline`。若 Lead 后续在某一态看到差异，先 `check-stylesnap.mjs --states <态>` 复检（注意 §9：设置页 7 态的红归设置页改动，不是图标）；真红再按单一 owner 流程重烤。

### 13.5 遗留与登记

1. **唯一残留 hex**：`LakeColorBoard.tsx` 的 `NATIVE_COLOR_FALLBACK = "#000000"`（`<input type="color">` 的 `value` 属性不能吃 `var()`）。不是绘制色，是全文件唯一残留；`audit-icons.mjs` 会持续列出（预期）。清零方案 = 运行时 `getComputedStyle` 读令牌，但会引入首帧 DOM 读取，不建议。
2. **Apache-2.0 §4(c) 的 LICENSE 副本**：本次只按任务范围改了 `NOTICE` 一行（记来源/改动/未引运行时）；上游 LICENSE 全文随仓入库已落 `LICENSES/IconPark-APACHE-2.0.txt`。
3. **计划 §0.1 处置表状态**：⑤ 已 NORMALIZE、⑨ 已 REDRAW+TOKEN、⑥ 已 useId、③ 已按裁决换图；④⑦⑧⑩⑪⑫⑬ 按计划**保持/冻结不变**。
4. **未做**：没跑设备装置（不涉 `src/mobile/**`，按 §3#21④ 不需要装机验收）；没跑 `check:bitablesnap`（其 3 态是移动端，与本改动无交集，见 §13.4）。
