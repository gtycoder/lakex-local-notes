---
name: Lake Notes Mobile
description: 本地优先的 Lake 编辑器笔记应用（Android 端）——自有设计语言，仿语雀形态 + 本项目色阶
colors:
  accent: "#3f5fa0"
  accent-ink: "#33497f"
  accent-text: "#33497f"
  surface-panel: "#ffffff"
  surface-window: "#ffffff"   # 261013：浅色下窗底即白（原 #f3f4f6 整屏发灰）
  surface-block: "#f4f6f8"
  ink-1: "#1f2329"
  ink-2: "#4e5969"
  ink-3: "#5f6874"
  ink-4: "#8b93a1"
  hairline: "#e6e8ec"
  control-border: "#d3d7de"
  kernel-green: "#00b96b"
typography:
  fontFamily: "MiSans, -apple-system, 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace"
  scale: ["11px", "12px", "13px", "14px", "16px", "18px", "20px", "24px"]
  body: "16px / 1.5"
  rowTitle: "16px / 1.45 (500)"
  caption: "13px / 1.5"
geometry:
  topbar: "44px"
  bottom-bar: "56px"
  tap-min: "44px"
  control-height: "44px"
  control-height-lg: "48px"
  control-height-sm: "36px"
  list-item: "56px"
  page-padding: "16px"
rounded:
  control: "8px"
  card: "12px"
  compact: "6px"
  sheet-top: "20px"
  pill: "999px"
motion:
  panel: "150ms"
  press: "90ms"
  fast: "130ms"
  ease-panel: "cubic-bezier(0,.0,.2,1)"
  ease-out: "cubic-bezier(.22,1,.36,1)"
components:
  button: { height: "{geometry.control-height}", rounded: "{rounded.control}", padding: "0 16px" }
  icon-button: { size: "{geometry.control-height}", rounded: "{rounded.control}" }
  row: { minHeight: "{geometry.control-height}", rounded: "{rounded.control}" }
  sheet: { rounded: "{rounded.sheet-top}", scrim: "var(--lake-scrim)" }
  toast: { rounded: "{rounded.card}", surface: "{colors.surface-panel}" }
---

# Design System: Lake Notes Mobile

## Overview

**Creative North Star: "口袋里的一支笔"**（与桌面「安静的工作台」同源，但形态按触屏重做）。

移动端是**正式端之一**，不是桌面的缩小版。它有自己的设计语言：**取值与几何移动端自有**，
只与桌面共享**词表**（`--lake-*` 变量名与语义）与**必要逻辑**（命令字典 / 色板数据 / 应用语义 / 内核宿主）。

三条口径（用户 261012 定稿，长期有效）：

1. **信息架构冻结**：小记·知识库 → 笔记 → 笔记本文档树 → 文档；设置九页；回收站/历史/属性抽屉。
   结构（哪些区域、怎么从属）**不动**；页内交互形态与外观**可以重做**。
2. **形态仿语雀、取值用我们的**：几何/密度/触达/弹层形态照语雀 App 实测档位；色阶与字体用本项目
   （MiSans），**不抄语雀配色**。
3. **一个交互语义只有一套原语**：`mb-*` 就是移动端的唯一来源；不许再出现桌面 `ln-*`/`config-*`/`b3-*`
   （由 `mobileIndependence.test.ts` 卡成 0，且**不允许回涨**）。

## Colors

色阶取自本项目主题（浅/深两套，暖色暂不做）。**取值定义在 `src/mobile/theme/{light,dark}.css`** ——
桌面 `styles/themes/**` 不是移动端契约（护栏卡住 import）。

### Named Rules

**The Own-Values Rule.** 移动端取值的唯一来源是 `src/mobile/theme/**`；桌面改色板**不得**连带改到移动端。

**The White Rule（261013 用户定稿）.** 浅色主题下**窗底就是白**：不再用灰色页面去衬托白卡；要表达分组就用 1px 细线，
不用把整屏压灰。深色主题不受此条约束（近黑窗底 + 提亮面板仍是它的层级手段）。

**The Two-Green Rule.** 语雀绿 `#00b96b`（`--lake-kernel-brand-green`）**只给内核品牌位（「+」）与内核自己的
品牌色**；我们的选中态/强调/链接一律走 `--lake-accent` / `--lake-accent-text`（对语雀的**显式偏离项**）。

**The AA Rule.** 文字档位按「它实际会被铺到的最差表面」标定：说明/空态用 `--lake-text-3`（AA），
`--lake-text-4` 只用于**元信息/占位**（有意 3:1 档）。走查实测：`.config-empty` 曾以 text-4 落在灰卡上
只有 **2.86:1** ⇒ 已改 `--lake-text-3`（`.mb-set-empty`）。**移动端不引入新的低于 AA 的文字用法。**

## Typography

**正文与界面同族：MiSans**（与桌面同一逻辑、同一份内置切片资源）；数字/代码用 JetBrains Mono。
字号**只走令牌**（`--lake-font-size-*`，7 档 12/13/14/16/18/20/24 + 徽标 11），禁止字面量 px。

- **Body 16 / 1.5**：列表行、设置行、正文界面（触屏比桌面大一档：桌面 body 是 14）。
- **Row title 16 / 1.45（500）**：两行列表行的标题。
- **Caption 13 / 1.5**：说明、副标题、计数。
- **Micro 12 / Nano 11**：标签、徽标。

### Named Rules

**The Token-Size Rule.** 要「整体抬一档」就改 `src/mobile/theme/tokens.css` 的档位值，**不要**去改使用处。

## Layout & Geometry

几何档位来自语雀安卓 RN bundle 的数值分布（字号 286 / 圆角 286 / 高度 1105 / 内距 152 处）实测主档，
用**我们的**色阶与字体表达。令牌见 `src/mobile/theme/tokens.css` 的「移动端密度/几何档」。

| 维度 | 档位 |
| --- | --- |
| 顶栏 | **44**（261013 A 批：48 → 44，对齐语雀标题条） |
| 底部胶囊 | 高 **56** / 圆角 **28**（= 高/2）/ 宽上限：**首页（3 项）192＝4 槽**、工作区（4 项）288＝6 槽（**不再由高度推导**，见 `--mobile-bottom-bar-slot` 与 `.mobile-bottom-bar--home`；261014 设备实测首页 192×56、每项 64px） |
| 触达 | 主 **48** / 常规 **44** / 紧凑 **36**（44 是触屏最小点按目标） |
| 列表行 | 单行 **44** / 两行 **56**；设置页行 **48** |
| 行高档收敛（261013 A） | 只用 **44 / 48 / 56** —— 原先并存的 40 与 52 已消除 |
| 页面左右内距 | **16** |
| 圆角 | 控件 **8** / 卡片 **12** / 小件 6 / 面板顶 **20** / 胶囊 999 |

**外壳（冻结的结构）**：顶栏（返回 / 标题 / 编辑·完成 / 同步）→ 内容 → 底部 dock；抽屉（文档树 / 大纲 /
标签页 / 更多）从两侧进出；首页 = 小记 | 知识库 两个 tab + 底部悬浮操作条。
**首页顶栏右上角（261014 用户定稿）**：固定挂**两枚**图标 = 排序（小记）/ 视图（知识库）+ **云同步**（恒在最右、不随 tab 变）；
左上补一格等宽空槽 `.mobile-topbar-gap` ⇒ tab 仍居中（冷启动骨架同构：左 2 槽 / tab / 右 2 槽）。
**底部胶囊 = 搜索 · ＋ · AI**（排序/视图与云同步都**不在**胶囊里）。
**工作区胶囊 = 文档树 · 标签页 · 大纲 · 切换笔记本**（261014：原「更多」已删 —— 编辑走顶栏「编辑 / 完成」、新建走抽屉 ＋ 与行内 ＋；
工作区菜单里也不再放搜索 / 设置）。**笔记本的编辑入口 = 首页「知识库」长按卡片**（重命名 / 设置图标 / 删除笔记本；
**不含**新建文档·新建分组）；抽屉里的笔记本行只展示「图标 + ＋」，不放 ⋮。长按唯一实现 = `src/mobile/ui/useLongPress.ts`。
`＋` 是**统一加号**（不再按 tab 换成「新建知识库」图标）：**短按** = 开新建面板。
**速记 = "整块触发"**（261014 二轮定稿，照语雀）：按住**整条胶囊任意处** ≈260ms → 条目淡出、**整块**变成强调色的「小记」；
继续上滑越过触发线松手 = 速记一条小记；不上滑松手 = 取消（用户明确"长按容易误触"，不做"长按即建"）；
没长按到点 = 什么都不做（条目自己的 onClick 照常，短按语义不变）。判定唯一来源 `src/mobile/ui/createPress.ts`（纯函数 + 单测）；
**容器级手势不要 `setPointerCapture`**（会把 click 重定向到容器，子按钮 onClick 全失效 —— AGENTS §7.30），改挂 window 监听。
新建面板 = 新建小记（空白小记 / 拍摄 / 图片 / 待办）+ 新建文档知识库（空白文档 / 知识库）：**不做模板**；
**不做 OCR 识图**（我们没有该能力）；AI 位只占位（接入方案另行立项）。

**首页 tab = 语雀式纯文字 tab（261013 A 批定）**：选中 = **加粗 + `--lake-text-1`**，未选 = 常规 + `--lake-text-3`，
**没有下划线/底色指示线**（原实现是桌面 `.ln-tabs` 的墨线语言；桌面侧有自己的一套，移动端按「两端 UI 不共享」自走语雀形态）。
`min-width: var(--mb-tap-min)` 是 44 Rule 的兜底 —— 纯文字 tab 的宽度由字数决定，单字标签会掉到 44 以下。

### Named Rules

**The 44 Rule.** 任何可点元素的有效命中区 **≥44×44**（含伪元素撑开的命中区，如 `.mb-switch::after`）。
实现口径（261013 定）：**视觉尺寸刻意小于 44 的类，一律用 `::after` 把命中区补到 `--mb-tap-min`，不改视觉盒子**
（因此整页几何快照不受影响）；唯一来源是 `src/mobile/mobile.css` 的「触达补足注册表」，新控件把类名加进去即可。
**不要**靠调大按钮本身来达标 —— 那会改行密度与面板高度。走查装置会按**算上伪元素后的有效命中区**报 `smallTap`。
⚠️ 但**该调大时就得调大**（261013 A：dock 条目 40 → 44、搜索/文档行 40 → 44、设置行 52 → 48）——
补足注册表只服务「视觉尺寸被刻意压住」的那批；已经真的到 44 的类**必须从注册表移除**，不许"既调大又补足"两套并存。
**密度不够时的口径 = 「一屏 8 格 + 横滑」，不要靠缩小命中区硬塞**（261014 表情面板分类条，用户二次定稿）：
分类条先试过"10 格挤一屏"（每格 41px + ::after 补足、相邻命中区重叠约 3px），用户判定**可点目标太多**⇒ 改成
**一屏 8 格（每格固定 --mb-tap-min=44）+ 横向滚动**（对标微信，它的表情行也是 8 个）；**末尾动作键钉在轨道右侧、不参与滚动**
（返回/清除必须永远够得着）。横滑安全性靠 `data-prevent-swipe`（面板根已挂，外壳手势本就排除它）——
**任何"横滑"都必须是这个姿势**：先挂 `data-prevent-swipe`，再让容器自己 `overflow-x: auto`。

## Elevation & Depth

浮层用 `--lake-shadow-popover`；卡片用 `--lake-shadow-card`；**同一面不用「细边 + 大软阴影」两套**。

**浅色下没有"灰底 vs 白卡"的明度层级了**（261013 用户定稿）：`--lake-bg-window` = `--lake-bg-panel` = **#ffffff**，
原来铺在 body / 顶栏 / 小记卡 / 文档区 / 设置页上的 `#f3f4f6` 让整屏发灰（用户原话「灰蒙蒙」）。
层级改由**细线 + 阴影**承担：

- 分组边界 = 1px `--lake-border-2`（设置页的分组卡 `.mb-set-section` 就是靠它从白底上"显形"的 —— 语雀的设置页同样是"白底 + 细线分组"，不是灰底白卡）；
- 卡片/输入/胶囊底栏 = 本来就有的 1px `--lake-border-1` + `--lake-shadow-card`；
- 行分隔 = `--lake-bg-block` / `--lake-border-2` 的 1px 线；
- 按压/悬浮反馈仍走 `--lake-bg-hover` / `--lake-bg-press`（在白底上比原来更明显）。

**深色主题不变**（窗底仍是 #191a1d 的近黑，层级照旧靠明度差）。

## Floating Surfaces

**移动端没有「居中对话框」这一形态**（用户 261012 定稿 C1）：破坏性确认走 ActionSheet，其余统一底部 Sheet。
原语在 `src/mobile/floating.css`，结构契约固定：

```
Sheet        .mb-scrim + .mb-sheet > (.mb-sheet__head > .mb-sheet__title, .mb-sheet__body)
ActionSheet  .mb-scrim--state.is-open + .mb-actionsheet > (.mb-actionsheet__group, .mb-actionsheet__cancel)
菜单 Sheet    .mb-scrim--state.is-open + .mb-menusheet > (__title, __items > __item[.is-show > __submenu])
Toast        .mb-toast-host > .mb-toast[--error] > (.mb-toast__text, .mb-toast__close)
```

- **两种遮罩进场**：`.mb-scrim`（挂载即淡入，配合 `{open && …}` 条件渲染）/ `.mb-scrim--state`（常挂载 +
  `.is-open`，用于自带 presence 状态、需要**退出也淡出**的浮层）。表面与层序只有一份。
- **关闭方式三件套**：遮罩点击、下拉手势（`useSwipeToClose`）、安卓返回（`backStack`，先退子菜单再关面板）。
- 安全区：底部内距一律含 `--mobile-bottom-safe-area`。
- **禁止原生 `<select>` 的系统弹层**（用户 261012 反馈"有点丑"）：系统弹层不跟主题/字号走（深色下也是白底、
  选中态是系统蓝绿圈），与移动端浮层语言割裂。选项类交互一律走 `PickerSheet`（底部 Sheet 列表 + 打勾），
  触发器沿用 `.mb-select` 外观但是 `<button>`。与桌面 kit 的同类规则同源（桌面也不用原生 select 弹层）。

## Components

原语库 = `src/mobile/kit.css`（`mb-*`）+ `src/mobile/floating.css`。清单：

`mb-btn`（--primary/--secondary/--ghost/--danger、--lg/--sm/--block）· `mb-iconbtn`（--compact）·
`mb-row`（--two-line、__icon/__main/__title/__sub/__meta/__chevron/__action/__actions、.is-selected）·
`mb-list`/`mb-list-item`（__text/__meta）· `mb-input`（--num）· `mb-select` · `mb-tag`(--pending/--ok/--error) ·
`mb-segment`/__item · `mb-card`（__head/__body）· `mb-form__desc` · `mb-menu-note`/`mb-menu-head-action` ·
`mb-chevron`/--spacer · `mb-tree-icon` · `mb-indent` · `mb-spacer`/`mb-flex1`/`mb-ellipsis` ·
**选择器 = `PickerSheet`（`mb-select--trigger` 触发器 + `mb-sheet--picker` 底部列表、选中项打勾）** ·
**设置页骨架** `mb-set-group/title/items/section/item(--field)/name/desc/note/ctl/error/block/stats` ·
**空态 = `mb-empty`（+ `--inset` 变体；261013 A 批把 `.mobile-empty` / `.mb-set-empty` / `.mb-sheet__empty` 三套收敛成一件）** ·
**表情面板 = `mb-emoji-panel`(`--fill`)/`cats`/`cat`(`--action`)/`body`/`grid`/`cell`/`empty`（微信样式：顶部分类条 + 浅灰底大格子；
分类条末尾**动作键**`mb-emoji-cat--action` 语义随入口：**输入态（小记/文档 dock）= 返回**（退出表情选择、回「＋」面板）、
**选图标态（知识库/文档图标）= 清除图标**；「最近」首格那块清除格已于 261014 撤掉 —— 同一动作只留一个入口）** ·
**首页文字 tab = `.mobile-htab`（选中加粗 + `--lake-text-1`）** ·
**冷启动骨架 = `.mb-skel`（--icon/--tab/--group/--row/--baritem；结构与首页同构、尺寸同源，填充不跳动；
`prefers-reduced-motion` 下关掉呼吸）** ·
`mb-switch` · `mb-kbd` · **勾选原语**（`.mobile-app input[type=checkbox|radio]`，排除内核待办框）。

页内交互（② 层）已定：设置页 = 抽屉九页 + 移动端自有版式原语（`src/mobile/ui/settingsPrimitives.tsx`，
`data-set-id` 契约与桌面 `settingsSearch.ts` 对齐，**只共享语义不共享组件**）；小记 = 时间线 + 写作卡九项工具条。

## Motion

`--mobile-duration-panel: 150ms`（面板/遮罩）、`--mobile-duration-press: 80-90ms`（按压/微入场）；
曲线 `--mobile-ease-panel: cubic-bezier(0,0,.2,1)`（进场）、`--mobile-ease-out: cubic-bezier(.22,1,.36,1)`（进出统一）。
`prefers-reduced-motion: reduce` 下所有浮层/抽屉/指示线动画与过渡关闭（`mobile.css` 与 `floating.css` 各有一份名单，
**新增浮层必须登记进去**）。

## Gates（移动端指标已转门禁）

```bash
npm run check:mobileui     # 独立性 + 层护栏 + 内核样式护栏 + ui-metrics，一条命令
npm run check:mobilesnap   # 设备级：6 态整页计算值快照（0 差异）
node scripts/css-audit/drive.mjs 9335 scripts/css-audit/mobile-walkthrough.mjs   # 设备级：23 屏截图 + 五类探针
```

**基线只许降**的账本：桌面样式 import 白名单（现状 4 条：quick-notes + 2 feature CSS + 字体资源）·
桌面类名 token（**0**，不允许回涨）· 反向耦合（**0**）· 各样式文件声明数/重复组（`mobileLayers.test.ts`）·
`!important`（现状 **18**，新增须写明理由；都是压「内核行内样式 / 未分层内核 CSS」的必需项 ——
未分层的普通声明会压过我们 @layer 里的普通声明，只有「分层里的 !important」才强于「未分层的 !important」，
即 CSS Cascade 5 的 important 层序反转；261013 的 +2 来自压内核桌面引擎几何 `min-height:1024` 与 90px 底内距）·
移动端 **字号字面量**（现状 **47** = mobile.css 38 + editor-dock.css 9，基线 49、只许降；由 `ui-metrics.mjs` 卡住，
新增字面量直接 exit 1 —— 桌面是硬 0，移动端先做单调下降）·
**移动端 CSS 不得再出现桌面类名选择器**（`ln-`/`b3-`/`fn__`/`config-`，`mobileLayers.test.ts` 恒为 0；
261013 立：P5 之后还留着一批挂在 `.ln-row` 上的规则永不命中 —— 拖拽落点线就是这么静默丢的）。

## Do's and Don'ts

### Do
- **Do** 用 `mb-*` 原语；新语义先在本文件登记为原语，再在业务里用。
- **Do** 颜色/几何/字号/动效只走令牌；取值改 `src/mobile/theme/**`。
- **Do** 迁完一屏就删掉对应的桌面 import（护栏会因 stale 条目失败，逼你同步）。
- **Do** 每次改动跑 `check:mobileui` + 设备走查；IA 冻结清单逐条核对。

### Don't
- **Don't** 在移动端 JSX 里用 `ln-*` / `config-*` / `b3-*` / `fn__*`（护栏恒为 0）。
- **Don't** import 桌面 `styles/**`（除字体资源）或桌面 UI 组件件。
- **Don't** 让桌面样式为移动端开分支（`:is(.app-shell, .mobile-app)` 已清零，不许回涨）。
- **Don't** 造第二个「居中对话框」「第二套 toast」「第二套 sheet」——浮层只有 `floating.css` 那四件。
- **Don't** 写内联样式表达静态视觉；`!important` 只用于压内核（且要写理由）。
