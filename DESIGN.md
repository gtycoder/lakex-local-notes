---
name: Lake Notes
description: 本地优先的 Lake 编辑器笔记应用（桌面端）——克制的品类标准
colors:
  accent: "#3f5fa0"
  accent-ink: "#33497f"
  accent-tint: "#eef2fa"
  surface-window: "#f3f4f6"
  surface-panel: "#ffffff"
  surface-block: "#f4f6f8"
  surface-sunken: "#eceef1"
  ink-1: "#1f2329"
  ink-2: "#4e5969"
  ink-3: "#6f7784"
  ink-4: "#8b93a1"
  hairline: "#e6e8ec"
  control-border: "#d3d7de"
  status-sync: "#2a6b80"
  status-pending: "#8f5f0e"
  status-ok: "#2b7350"
  status-error: "#b3382f"
  kernel-green: "#00b96b"
typography:
  body:
    fontFamily: "MiSans, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  body-lg:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.35
  display:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
  h1:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.35
  label:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
  tiny:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
  nano:
    fontFamily: "MiSans, -apple-system, 'PingFang SC', sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  hairline: "2px"
  "2xs": "4px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  card: "12px"
  lg: "14px"
  xl: "20px"
  pill: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  xxl: "20px"
  xxxl: "24px"
components:
  control-height:
    height: "27px"
    rounded: "{rounded.sm}"
  button-primary:
    backgroundColor: "{colors.accent-ink}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0 11px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.sm}"
    padding: "0 11px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.sm}"
    size: "27px"
  input:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.sm}"
    height: "27px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.xs}"
    height: "27px"
  row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.sm}"
    height: "27px"
  menu-surface:
    backgroundColor: "{colors.surface-panel}"
    rounded: "{rounded.md}"
  dialog-surface:
    backgroundColor: "{colors.surface-panel}"
    rounded: "{rounded.lg}"
---

# Design System: Lake Notes

## Overview

**Creative North Star: "The Quiet Workbench"（安静的工作台）**

这是一个**效率工具**，不是作品展示：用户的成功是"把笔记写完、把数据找出来"，不是"被界面打动"。
所以这套系统的第一原则是**先成为这一类产品里最好的那一个**——对齐、间距、字阶、状态都做到位，
然后才谈性格。性格体现在**精确的细节**里：一条看得见的输入框边、一个不多不少的主色、
一套只说一次的状态语言。

界面不属于任何"世界"。它不借用档案柜、印刷品、仪表盘或任何器物的外形；它借的只是
**排版、调色板、密度与一个签名动作**。背景是表面，不是画布；装饰只有一条纪律：**能删就删**。

**Key Characteristics:**

- **中性为主，主色是锚点不是装饰**——主色只出现在焦点 / 选中 / 主操作 / 链接上。
- **三级表面**（窗底 < 面板 < 抬升），用表面价值与一条细线表达层级，不堆阴影。
- **一套状态**：同一交互语义全仓只有一个外观；禁用只有一种口径，焦点只有一种环。
- **等宽只用于数字与代码**，中文正文用 MiSans；数字用 `tabular-nums` 避免跳动。
- **布局冻结**：区域与构图不随"设计"变化；这套系统只改主题类的观感。

## Colors

调色板的性格是**印刷式的克制**：近白纸面、近黑墨、一枚墨蓝主色，颜色承担语义而不是气氛。

### Primary
- **Ink Blue**（`#3f5fa0`，实心钮/链接用更深的 `#33497f`）：焦点环、选中态、主操作、链接。它在屏幕上**很少**出现——这是它有效的原因。
- **Ink Blue Tint**（`#eef2fa`）：选中行/选中项的底衬；与 `Ink Blue` 成对使用，永远不单独出现。

### Neutral
- **Paper**（`#ffffff`）：面板与文档画布，正文所在的最亮面。
- **Window**（`#f3f4f6`）：窗底，面板与面板之间的通道。
- **Block**（`#f4f6f8`）：块面（代码块、表格斑马、内嵌卡片的底）。
- **Sunken**（`#eceef1`）：下沉面（禁用字段、内嵌槽）。
- **Ink 1–4**（`#1f2329` / `#4e5969` / `#6f7784` / `#8b93a1`）：正文、次级、辅助、元信息；**每一级都有可测的对比度**（4.5:1 / 4.5:1 / 3:1 递增的克制）。
  - **文字档位按「最差表面也达标」取档（261012）**：`ink-3` 的 canonical `#6f7784` 是按**白底**标定的（4.52:1），
    但 `--lake-text-3` 实际会被铺到 `--lake-bg-hover / -block / -window`（`#f0f1f3/#f4f6f8/#f3f4f6`）⇒ 掉到 **4.00–4.36**、不达 AA 4.5。
    ⇒ 文字档位改用 ramp 深一档 **`#5f6874`**（暖色同值；深色对应提一档 **`#9398a1`**，最严表面 4.86–4.95）。
    **色板 canonical 不变**（`#6f7784` 仍是 ink-3 的色板值，见 `.impeccable/design.json` 的 `tonalRamp`；`#5f6874` 本就是该 ramp 的既有档位）。
  - `--lake-text-4`（`#8b93a1`，深色 `#6f7278`）是**有意的 3:1 档**（元信息/占位）—— 不追 AA 4.5；要提升就得整档提亮并与 text-3 合并成一层。
- **Hairline**（`#e6e8ec`）与 **Control Border**（`#d3d7de`）：前者分隔区域，后者是**控件静息边**。两者不能互换。

### Named Rules

**The One Anchor Rule.** 一屏之内，主色只标记"当前在哪 / 能点什么"。它不铺底、不做装饰、不用来表达"重要"。

**The Printed Ink Rule.** 颜色字面量只允许出现在 `src/styles/themes/*`。其他任何 CSS 里出现 hex/rgb 都算缺陷。

## Typography

**Display Font:** 与正文同族（MiSans 人文黑体，系统栈回退）
**Body Font:** MiSans（中文正文与界面）；数字/代码用 **JetBrains Mono**
**Character:** 界面字与正文同族、只差字号与字重——安静、少噪音；等宽只服务数字对齐与代码。

### Hierarchy
- **Title**（600，18px / 1.35）：面板标题、设置分组标题。
- **Body Large**（400，15.5px / 1.6）：对话框标题以下的正文。
- **Body**（400，14px / 1.6）：界面正文与编辑器正文（编辑器行高可到 1.85 的阅读档）。
- **Label**（500，13px）：控件标签、菜单项、列表行。
- **Micro**（500，11.5px）：徽标、计数、元信息。

### Named Rules

**The Tabular Rule.** 一切会变化的数字（计数、字数、进度、表格数值）必须 `font-variant-numeric: tabular-nums`，否则切换时整行会抖。

**The One-Step Rule.** 相邻层级的字重差**至少一档**（400↔500↔600），不要靠 1px 字号差表达层级。

## Layout

固定外壳：顶栏 / 标签条 / 面包屑 / 目录 / 正文 / 大纲 / 状态栏。**区域与构图是冻结的**——
本设计系统不重排它们。空间节奏由 `--lake-space-*`（2/4/6/8/12/16/20/24/32/40）承担；
控件高度由 `--lake-ctl-h`（27）与 `--lake-ctl-h-sm`（22）两个令牌统一，**字段类在多维表表单场景可放宽到 30**。

分组用**表面差 + 一条细线**，不用卡片堆叠；同一屏内不出现两层以上嵌套卡片。

## Elevation & Depth

混合制：**表面价值为主（三级），阴影为辅（三段）**。

### Shadow Vocabulary
- **card**（`0 1px 2px rgba(16,24,40,.04), 0 6px 16px -8px rgba(16,24,40,.10)`）：抬升的小面（分段控件选中段、卡片）。
- **popover**（`0 0 0 1px rgba(16,24,40,.05), 0 10px 28px -10px rgba(16,24,40,.14), 0 24px 56px -24px rgba(16,24,40,.16)`）：菜单、气泡、提示条。
- **dialog**（`0 0 0 1px rgba(16,24,40,.06), 0 16px 40px -12px rgba(16,24,40,.16), 0 40px 88px -32px rgba(16,24,40,.20)`）：对话框。

### Named Rules

**The Flat-By-Default Rule.** 静息态是平的。阴影只回答一个问题："这一层比下一层高多少"。没有偏移与模糊的"光圈"是装饰，不是纵深。

**The One Declaration Rule.** 一个面要么靠 1px 边，要么靠阴影，不要「细边 + 大软阴影」同时上（那是幽灵卡片）。

## Shapes

形体语言是**克制的小圆角**：控件 8px（紧凑件 6px），浮层表面 10px，对话框 14px，胶囊只用于开关与徽标。
边界一律 1px；**禁止 >1px 的单侧色条**（卡片、列表项、提示条上的左侧粗色条是 AI 生成界面的典型痕迹）。

## Components

### Buttons
- **Shape:** 8px 圆角（`{rounded.sm}`），高 27px，内距 `0 11px`，13px / 500。
- **Primary:** 实心 `{colors.accent-ink}`，白字；hover/press 用 `accent-ink-hover/press`。
- **Secondary / Ghost / Danger:** 描边用 `control-border` / 透明 / `status-error`。
- **Disabled:** 统一 `opacity: .45`（`--lake-disabled-opacity`）。

### Icon Buttons
- **Shape:** 27×27（`--compact` 为 22×22），圆角 8/6；静息透明、hover 用 `surface-hover`、选中用 `accent-tint`。

### Inputs / Selects
- **Style:** 高 27px，圆角 8px，静息边 **`control-border`**（不是发丝线——输入框必须在浅底上看得见）。
- **Focus:** `accent` 边 + 2px 柔光环（`--lake-focus-halo`），**不用硬描边**。
- **Disabled:** 下沉底 + `ink-4` 文字。

### Select（下拉）
- **Style:** 触发器 = 输入框外观 + 右侧 chevron；**弹层用自有菜单表面**（`.ln-menu`），绝不用原生 `<select>` 的系统弹层。
- **Items:** 复用菜单项规格；**整行**高亮（`accent-tint` + `accent-text` + 600），勾选位在**右侧**，标签左对齐。

### Rows / Menu Items
- **Shape:** 通用行/菜单高27px；**桌面目录行**用14px标题（`--lake-font-size-body`，与内核原生大纲同档）、上下2px内距、左右8px，**实测普通行27px / 笔记本行29px**（笔记本行有独立 `min-height` 下限）。261015 试调过 15px 与 14.5px 均偏大，已回滚到 14px；**目录字号不要再单独抬档**。行圆角8px、菜单项圆角6px。
- **States:** hover = `surface-hover`；active = `surface-press`；selected = `accent-tint` + `accent-text` + 600；disabled = `.45` 透明。

### Selection & Hover Surfaces（261017 用户定稿）

- **文字选中背景** = `--lake-select-bg`：主题无关**中性灰**（浅底合成 ≈ `#d9dadc`、深底 ≈ `#3f4144`），不随主题/主色变。
- **内容选区边框**（表格 / 多维表单元格、画板选中框）= **主题主色 `--lake-accent`**（暖色主题下就是橙色边框，这是有意的）。
- **hover 内容预览**（附件/图片名、长文本 / Markdown / AI 字段的整段内容）= 单一 `.ln-tip` 表面（`--lake-tooltip-*`，主题无关）；长内容自动用 `.ln-tip--wide`（≤460px、≤50vh、内部滚动）。
- 不要把三者互相替代：**中性色只给文字选区背景；主题色只给内容选区边框**。

### Switch / Checkbox / Radio
- **Style:** 开关 32×19（胶囊，选中主色实心）；勾选件自绘 15×15（圆角 6，radio 为圆），静息边 `control-border`、选中主色实心、勾选符号用**边框旋转**绘制。

### Menu / Dialog Surfaces
- **Menu:** 实心 `surface-panel` + 1px `hairline` + `popover` 阴影，圆角 10px，内距 6px。
- **Dialog:** 实心 + `dialog` 阴影，圆角 14px。

### Tooltips
- **Style:** `.ln-tip` —— 深墨底 + 白字，圆角 6px，`z-tooltip`；**原生 `title` 一律由全局拦截器换成它**（约 1s 的系统延迟不可接受）。

## Do's and Don'ts

### Do:
- **Do** 颜色只走 `--lake-*` 令牌；令牌的唯一定义处是 `src/styles/themes/*`。
- **Do** 同一种交互语义复用 kit 的 `ln-*` 原语；需要新外观时改原语，不在调用点另写一套。
- **Do** 用表面价值（三级）表达层级，用 1px 边或阴影二选一。
- **Do** 让主色只出现在焦点 / 选中 / 主操作 / 链接上。
- **Do** 交互状态六态齐全：default / hover / active / focus-visible / selected / disabled。

### Don't:
- **Don't** 在组件里写内联 `style={{…}}` 表达静态视觉（动态几何例外：实测坐标、数据驱动颜色）。
- **Don't** 新增 `!important`（全仓上限 10，每条都要写明理由）。
- **Don't** 用单侧 >1px 色条、渐变文字、玻璃拟态、为装饰而加的动效。
- **Don't** 用 emoji 或系统字形充当图标；图标只有 lucide 一族、描边 1.75。
- **Don't** 重新排列外壳区域——布局是冻结的。
