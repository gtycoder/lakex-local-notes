---
name: LakexLocalNotes
description: 本地优先的 Lake 编辑器笔记应用（Android 端）——自有设计语言，仿语雀形态 + 本项目色阶
colors:
  accent: "#3f5fa0"
  accent-ink: "#33497f"
  accent-text: "#33497f"
  surface-panel: "#ffffff"
  surface-window: "#f3f5f8"   # 261104：外围浅灰蓝，正文/卡片保持白
  surface-block: "#f0f3f7"
  ink-1: "#1f2329"
  ink-2: "#455166"
  ink-3: "#566273"
  ink-4: "#8b93a1"
  hairline: "#d6dde7"
  control-border: "#bcc7d6"
  kernel-green: "#00b96b"
typography:
  fontFamily: "MiSans, -apple-system, 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace"
  scale: ["12px", "13px", "14px", "15px", "16px", "18px", "20px", "24px"]
  body: "16px / 1.5"
  rowTitle: "16px / 1.45 (500)"
  caption: "14px / 1.5"
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
  panel: "250ms"
  press: "250ms"
  fast: "130ms"
  ease-panel: "cubic-bezier(.22,1,.36,1)"
  ease-out: "cubic-bezier(.22,1,.36,1)"
components:
  button: { height: "{geometry.control-height}", rounded: "{rounded.control}", padding: "0 16px" }
  icon-button: { size: "{geometry.control-height}", rounded: "{rounded.control}" }
  row: { minHeight: "{geometry.control-height}", rounded: "{rounded.control}" }
  sheet: { rounded: "{rounded.sheet-top}", scrim: "var(--lake-scrim)" }
  toast: { rounded: "{rounded.card}", surface: "{colors.surface-panel}" }
---

# Design System: LakexLocalNotes

## v2 视觉基线 ·「柔光纸面」（261107 用户定稿，落地中）

> 本节是**移动端视觉的当前基线**，优先级高于本文其余章节里关于「表面/圆角/阴影/顶栏/动效」的旧口径；**信息架构、44 Rule、hit-area 注册表、浮层结构契约、键盘与状态机、平板口径全部不变**。
> 交互稿（唯一视觉参照）：`/Users/admin/file/local-lake/preview/mobile-paper-light.html`（含滚动状态、共享元素转场、纯黑主题、动态取色）。设计语言来自澎湃OS 4「生命感美学 / 柔光玻璃」：材质即层级、光即反馈、去线条化 + 大标题。

### 0.1 五条原则

1. **光场打底**：页面底 = 极轻渐变 + 笔记本主色 6–11% 光晕，不再是死白/死灰。
2. **三层表面**：光场（底）→ 纸面（内容，实色）→ 柔光玻璃（功能层：顶栏/胶囊/dock/Sheet/面板）。同屏 ≤3 个模糊层。
3. **大圆角 + 去线条**：卡片 16 / 浮层 24 / dock 26 / 胶囊 32 / Sheet 28；删除绝大部分 0.5px 发丝线，分组靠底色差 + 一层柔和阴影。
4. **单点强调 + 动态取色**：每本笔记本继承图标色作为主色，只出现在选中、主操作、进度、图标底块；面积 <5%。
5. **光感反馈**：按压光斑 + 转场（卡片→文档）；不做装饰性循环动画。

### 0.2 新增/调整令牌（唯一定义处 `src/mobile/theme/**`）

| 令牌 | 值（浅 / 深） | 用途 |
| --- | --- | --- |
| `--mb-canvas-1` / `--mb-canvas-2` | `#f6f7fa` / `#eef0f4`；深 `#0c0d10` / `#121419` | 页面底渐变两端 |
| `--mb-canvas-glow` | `color-mix(in srgb, var(--mb-accent) 11%, transparent)`；深 20% | 顶部光晕（随主色） |
| `--mb-accent` / `-ink` / `-soft` | 默认 = `--lake-accent` 一套；由 JS 按笔记本覆盖 | 动态主色（见 0.4） |
| `--mb-glass-bg` | `linear-gradient(180deg, rgba(255,255,255,.78), rgba(255,255,255,.60))`；深 `rgba(36,40,48,.82)→rgba(24,26,32,.70)` | 胶囊 / dock 底 |
| `--mb-glass-bg-bar` | 滚动后顶栏用：`rgba(246,247,250,.90)→.76`；深 `rgba(22,24,29,.94)` | 顶栏滚动态 |
| `--mb-glass-border` | `rgba(255,255,255,.40)`；深 `rgba(255,255,255,.12)` | 玻璃 0.5px 描边 |
| `--mb-glass-highlight` | `rgba(255,255,255,.95)`；深 `.14` | 顶边 1px 高光（清透关键） |
| `--mb-blur` | `blur(18px) saturate(140%)`（顶栏）/ `blur(26px) saturate(180%)`（胶囊、dock） | 模糊 |
| `--mb-radius` | 12（控件，原 8） | 按钮/输入/图标钮 |
| `--mb-radius-sm` | 8（小件，原 6） | chip / 徽标 |
| `--mb-radius-card` | **16**（原 12） | 卡片 / 分组卡 / 小记卡 |
| `--mb-radius-sheet` | **28**（原 20） | 底部 Sheet 顶角 |
| `--mb-radius-dock` / `--mb-radius-capsule` | 26 / 32 | dock / 底部胶囊 |
| `--mb-shadow-card` | `inset 0 0 0 .5px rgba(16,24,40,.05), 0 1px 2px rgba(16,24,40,.04), 0 10px 24px -18px rgba(16,24,40,.35)`；深换 8% 白边 + 黑阴影 | 卡片 |
| `--mb-shadow-float` | `inset 0 .5px 0 var(--mb-glass-highlight), 0 8px 20px -10px rgba(16,24,40,.24), 0 24px 48px -24px rgba(16,24,40,.42)` | 胶囊 / dock / FAB |
| `--mb-dur-fast` / `-mid` / `-page` | 180 / 240 / 320ms | 微交互 / 面板 / 页面转场 |
| `--mb-ease` | `cubic-bezier(.2,0,0,1)` | 唯一入场曲线 |
| `--mb-font-page` | 28px / 700 / -0.025em | 页面大标题（设置等） |
| `--mb-font-doc-h1` | 27px / 700 / -0.024em | 文档 H1 覆盖 |

**允许清单（新增样式只能从这里取值）**：圆角 8/12/16/24/26/28/32/999；阴影 card / float / popover / dialog 四档；模糊仅 `--mb-blur` 两档且只用于固定功能层；颜色只走主题令牌；字号只走 `--lake-font-size-*` + 上述两档页面标题。
**禁止**：给列表项/卡片加 `backdrop-filter`；新增 `!important`（19 条棘轮只许降）；颜色字面量出现在 `theme/` 之外；第二套顶栏/tab/浮层实现。

### 0.3 外壳与组件新口径

- **顶栏**：贴边、高 **52**、初始 `background: transparent`（与光场完全融合、无发丝线）；滚动 >6px 后浮出 `--mb-glass-bg-bar` + 底部 0.5px 线 + 下方 14px 渐隐；首页 tab 收起、居中显示当前页小标题（16/600）。文档页**阅读态**：下滚 >60px 整条 `translateY(-100%)` 隐藏，上滚回来。
- **首页 tab**：纯文字（16/500，选中 600 + `--lake-text-1`），间距 20，无底色/无下划线。
- **卡片**：圆角 16、`--mb-shadow-card`、内距 16；小记卡标题 16/600，摘要 14/1.62，元信息 12（AA）。
- **底部胶囊**：形态/尺寸/命中不变（56 高、r28、3 格），底色改玻璃 + `--mb-shadow-float`；编辑态 above-dock 逻辑不变。
- **编辑 dock**：浮动圆角 26、玻璃 + `--mb-shadow-float`、内容底距重算；**图标分组不做**（用户 261107 明确）。键盘 `--kb-offset` 契约不变。
- **Sheet**：顶角 28、头部玻璃；body/结构/关闭方式不变。
- **设置**：分组卡 r16 + 行高 60 + 组内距 18；每行左侧 34 彩色图标块（`--c` 主色 + 渐变浅底）、右侧可显示当前值（14/`--lake-text-3`）；页面大标题 28/700。
- **知识库**：**置顶在前、笔记本在后**；置顶行右侧灰色图钉（不占主色）；笔记本卡 2 列、图标 44 圆角 14、卡内光晕随笔记本主色。
- **深色**：画布 `#0c0d10→#121419`，卡面 `#16181c` + 8% 白描边；**纯黑（OLED）档**：画布 `#000→#050506`、卡面 `#0f0f10`（后续在设置→外观加三档）。
- **空态/骨架**：空态 = 图标 + 一句说明 + 主 CTA（`mb-empty` 扩展，不改行结构）；骨架沿用 `.mb-skel`。
- **转场**：首页卡片 → 文档用共享元素（FLIP：卡片克隆放大到屏幕 + 文档淡入，320ms/--mb-ease）；返回直切（反向 morph 可后续补）。不做全站转场改造。

### 0.4 动态取色（--mb-accent）

- 主色来源：笔记本图标色；无则回落 `--lake-accent`（墨蓝 `#3f5fa0`）。
- 固定调色板 5 色（墨蓝 / 青绿 `#2f7a6b` / 暖金 `#a9721c` / 紫 `#6b5bd6` / 玫瑰 `#b4506a`），**只允许这 5 个**（保证 AA 与设计一致性）；写入 `core/` 单一来源 + 单测。
- 应用方式：外壳根节点写 `--mb-accent` / `-ink` / `-soft`（`color-mix`），切换时 300ms 过渡；不写正文、不参与同步。

### 0.5 落地顺序与验收

1. theme 令牌 → 2. kit/浮层 → 3. 三屏（首页/文档/设置）→ 4. 交互（滚动/转场）→ 5. 门禁 + 真机截图 → 6. 回写本文与 HANDOFF、重烤快照基线（10 态 + 23 屏）。
一次性完成后再动其它屏（表格/多维表/画板/手写板只跟随令牌，不单独改版）。
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

**The Surface Rule（261104 用户验收修正）.** 首页外围为浅灰蓝，正文、小记卡与胶囊保持白色。
目录与大纲恢复原来的面板底色；工作区与顶部均使用正文表面，编辑页不出现浅灰蓝着色。
使用既有 0.5px 细线区分区域，禁止为了质感给目录、大纲或编辑页染底色。

**The Two-Green Rule.** 语雀绿 `#00b96b`（`--lake-kernel-brand-green`）**只给内核品牌位（「+」）与内核自己的
品牌色**；我们的选中态/强调/链接一律走 `--lake-accent` / `--lake-accent-text`（对语雀的**显式偏离项**）。

**The AA Rule.** 文字档位按「它实际会被铺到的最差表面」标定：说明/空态用 `--lake-text-3`（AA），
`--lake-text-4` 只用于**元信息/占位**（有意 3:1 档）。走查实测：`.config-empty` 曾以 text-4 落在灰卡上
只有 **2.86:1** ⇒ 已改 `--lake-text-3`（`.mb-set-empty`）。**移动端不引入新的低于 AA 的文字用法。**

## Typography

**正文与界面同族：MiSans**（与桌面同一逻辑、同一份内置切片资源）；数字/代码用 JetBrains Mono。
字号**只走令牌**（`--lake-font-size-*`，8 档 12/13/14/15/16/18/20/24 + 徽标 12），禁止字面量 px。

- **Body 16 / 1.5**：列表行、设置行、正文界面（触屏比桌面大一档：桌面 body 是 14）。
- **Row title 16 / 1.45（500）**：两行列表行的标题。
- **Caption 14 / 1.5**：说明、副标题、计数。
- **Micro 13 / Nano 12**：标签、徽标。

**261030 小档整体抬一档（用户反馈「除文档正文外整体偏小」）**：nano 11→12 / micro 12→13 / tiny 13→14 / small 14→15；
body 16 与行标题 16 不动（触屏正文档已达标）。**编辑器正文字号是独立的设置项**（`lakeRuntime` 把 prefsSize 挂在 `.lake-editor-mount` 上），
不归这条 ramp；多维表/表格/卡片/表单等所有走令牌的界面文字随这条 ramp 一起抬。

### Named Rules

**The Token-Size Rule.** 要「整体抬一档」就改 `src/mobile/theme/tokens.css` 的档位值，**不要**去改使用处。

## Layout & Geometry

**261105 密度分工（用户定稿）**：正文、目录、大纲与编辑工具维持紧凑；设置适度舒展。
设置组标题 15px/600、组间距 24px、组内间隔 8/12px；输入框保留触屏 44px，不整体加高设置行。
设置 Item/Switch 删除多余弹性空白，标签与说明取得完整剩余宽度，控件保持右对齐。
说明间隔 4px、名称 500、主列 basis=0 只由 `.mobile-settings-content` 提供；多维表编辑面
复用 `mb-set-*` 时仍使用原来的 basis=auto、间隔 2px 与 400 字重。
Pad 设置根菜单仍为抽屉，子页恢复全屏（440px 规则排除 `--full`）；正文限宽 960px 居中，
手机仍满宽，避免过长输入行；编辑区没有限宽变化。

**属性与确认浮层（261105 第二批）**：属性操作使用已有 `mb-btn--secondary --sm`，
视觉36px、有效命中44px；值列保留原15px/34px行密度，分组标题600、数字等宽。
确认标题16px/600、后果说明15px，略收上下内距，避免用留白撑大确认面板。
只改信息与操作层级，附件与历史列表高度、底部Sheet形态、返回键和确认语义不变。

几何档位来自语雀安卓 RN bundle 的数值分布（字号 286 / 圆角 286 / 高度 1105 / 内距 152 处）实测主档，
用**我们的**色阶与字体表达。令牌见 `src/mobile/theme/tokens.css` 的「移动端密度/几何档」。

| 维度 | 档位 |
| --- | --- |
| 顶栏 | **44**（261013 A 批：48 → 44，对齐语雀标题条） |
| 底部胶囊 | 高 **56** / 圆角 **28**（= 高/2）/ 宽上限：工作区（4 项）288＝6 槽（**不再由高度推导**，见 `--mobile-bottom-bar-slot`）。**261110 用户点单：首页改固定五格 Dock + 中央悬浮＋**，首页胶囊用法与 `.mobile-bottom-bar--home`（4 槽/192px）已删，胶囊只剩工作区/表格阅读态 |
| 触达 | 主 **48** / 常规 **44** / 紧凑 **36**（44 是触屏最小点按目标） |
| 列表行 | 单行 **44** / 两行 **56**；设置页行 **48** |
| 行高档收敛（261013 A） | 只用 **44 / 48 / 56** —— 原先并存的 40 与 52 已消除 |
| 页面左右内距 | **16**（`--mb-page-pad`） |
| 阅读面左右内距 | **20**（`--mb-reader-pad`，261030：只给「连续长文/整页阅读」的容器 —— 文档正文 / 记录详情；表单与列表仍 16） |
| 圆角 | 控件 **8**（`--mb-radius`）/ 卡片 **12**（`--mb-radius-card`）/ 小件 6（`--mb-radius-sm`）/ 面板顶 **20**（`--mb-radius-sheet`）/ 胶囊 999（`--lake-radius-pill`）——**不写字面量** |

**外壳（冻结的结构）**：顶栏（返回 / 标题 / 编辑·完成 / 同步）→ 内容 → 底部 dock；抽屉（文档树 / 大纲 /
标签页 / 更多）从两侧进出；首页 = 小记 | 知识库 两个 tab + 底部悬浮操作条。
**首页顶栏右上角（261014 用户定稿）**：固定挂**两枚**图标 = 排序（小记）/ 视图（知识库）+ **云同步**（恒在最右、不随 tab 变）；
左上补一格等宽空槽 `.mobile-topbar-gap` ⇒ tab 仍居中（冷启动骨架同构：左 2 槽 / tab / 右 2 槽）。
**底部胶囊 = 搜索 · ＋ · AI**（排序/视图与云同步都**不在**胶囊里）。
**261110 用户点单改版（取代上面这条，Dock 方案 A）**：首页 = **底部五格 Dock（小记 / 知识库 / 日记 / AI / 标签）+ 中央悬浮＋**。
- 五格 = 五个一级空间，图标 + 10px 标签；**左右滑动仍是同一个分页容器**（`HOME_TABS` 唯一来源），点格与滑动同源；
- 顶栏 = 设置（左）| 当前空间标题（中）| 空间内动作（排序/视图）+ **搜索** + **云同步（恒可见、恒最右）**；
- 「＋」= 悬浮在 Dock **上方**中央（52 圆、主色实心）：短按开新建面板，**长按 260ms + 上滑 = 速记**（提示气泡：继续上滑 / 松手记一条）；
- AI = **第 4 格分页**（内嵌 AI 页，`embedded` 模式；不再是全屏路由），返回键回上一个非 AI 空间；
- 写作会话 / 多选态期间 Dock 与＋隐藏（底部让给文档编辑 dock）；首页滚动区底距 = Dock + ＋ 占位（124 + safe）；
- 旧胶囊（`.mobile-bottom-bar--home` 首页用法、`.mobile-block-quick`、首页 `.mobile-htab` 行）**已下线**；`.mobile-htab` 仍被 NodeIconPicker 的 Sheet 页签使用，勿删该原语。
**胶囊显隐（261103 二轮）**：**文档编辑态常显**胶囊并抬到 dock 上方（`.mobile-bottom-bar--above-dock`；编辑态也可能没光标，需要能切目录/大纲/标签/笔记本）；**允许被覆盖** —— 键盘弹起时隐藏（`capsuleHidden` 里的 `keyboardOpen`），dock 二级工具栏展开时靠层序盖住（胶囊 z=2 < dock 容器 z=4）。表格/多维表/画板/手写板编辑态仍隐藏。表格**阅读态**抬到 Univer 工具条之上（`.mobile-bottom-bar--above-sheet`）。**底距 = status + gap + safe − `--mobile-capsule-drop`（12）**（261103 整体下移一档；只改这一个令牌）。
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
**261015 的一个回例**：`＋` 面板改方块网格后，`Aa` 面板按用户要求压缩上下间距 ⇒ 条目视觉高 44 → **40**，
`.med-f-btn` 因此**回到注册表**（命中区由 `::after` 补到 44）。判据不变：视觉被压住 ⇒ 进注册表；真的 44 ⇒ 出注册表。
**密度不够时的口径 = 「一屏 8 格 + 横滑」，不要靠缩小命中区硬塞**（261014 表情面板分类条，用户二次定稿）：
分类条先试过"10 格挤一屏"（每格 41px + ::after 补足、相邻命中区重叠约 3px），用户判定**可点目标太多**⇒ 改成
**一屏 8 格（每格固定 --mb-tap-min=44）+ 横向滚动**（对标微信，它的表情行也是 8 个）；**末尾动作键钉在轨道右侧、不参与滚动**
（返回/清除必须永远够得着）。横滑安全性靠 `data-prevent-swipe`（面板根已挂，外壳手势本就排除它）——
**任何"横滑"都必须是这个姿势**：先挂 `data-prevent-swipe`，再让容器自己 `overflow-x: auto`。

**The Panel Grid Rule（261015 定；`＋` / 「更多」面板）。** 形态 = **方块网格**（用户点单"照参考图的方块样式"），**内容允许超出键盘高度、由面板内部上下滑**：
- **同一面板内所有格子等宽** ⇒ 没有"某一行更窄"的两档节奏（旧版 3 列行 116.1 与双卡行 84.8 并存就是"乱"的主因）。**列数按"每组项数是列数的整数倍"选**：
  · **`＋` = 4 列**：按用户指定分 **两组（8 + 10）**（① 拍照 图片 附件 音频 视频 表情 状态 日期；② 表格 引用 分割线 代码块 高亮块 分栏 折叠块 链接 文档引用 日历）⇒ ① 2 行**零空洞**、② 3 行（末行 2 项）；格宽 **93**；
  · **「更多」= 分行白卡 + 每项文字说明**（261017 三改用户点单，不再用方块网格）：① 公式 · 上标 · 下标 · 格式刷（图标+文字）② 首行缩进 · 减少缩进 · 增加缩进（图标+文字）③ **行高**（行首标签 + 6 个数值）④ 画图占位 5 项（纯文字 + 置灰）。**主工具栏 = 中间 8 项横滑 + 键盘固定尾键**（加粗回原位；撤销/重做在更多之后；按钮各 49px、间距不变；键盘键不参与滚动、永远可见）。
  · 硬约束：**除末组外，每组项数必须是列数的整数倍** —— 否则组界会落在行中间、那半行只能留空位（`＋` 的 8 = 2×4 满足）。
- **方块高 52**（用户 261015 定："先做 52 试试，不用太大"；图标 22 / 文字 13 / 圆角 12 = `--mb-radius-card`）。- **高度**：`＋` 5 行 ⇒ `5×52 + 组内 3×6 + 组间 16 + 面板内距 12 = 306 ≤ 311` ⇒ **一屏放下**（用户已授权可上下滑，故列数/块高仍按观感定、超出一屏就交给内部滚动）。
  ⚠️ **面板自身高度与工具栏位置不改**（由 JS 的 `--kb-offset` 驱动）—— 改它会把 261014 修好的「编辑区跳动 / 光标被盖」再引回来；要改是另一件事，需同时改 `editSurfaceModel` 并重跑编辑面不变量。
- **分组分隔 = 组间 16px（组内行距 6px 的 2.7 倍）**，靠留白而不是线（白块浮在灰底上时，留白的对比已经足够）。
- **面板底 = `--lake-bg-block`（浅灰）+ 方块 = `--lake-bg-panel`（白）**：延续既有面板分组取色；261104 的外围/内容面分工不改变面板排布。
- 判据 = `scripts/mobile-audit/insert-panel-geometry.mjs`（G1 单一列宽 / G2 每行填满 / G3 溢出可滚且末行完整可达 / G4 零截断 / G5 命中区 ≥44 / G6 方块形态 / G7 组间 ≥ 组内 2 倍 / **G8 组界落在行界**）。

## Elevation & Depth

**261105 六项收口**：菜单/Sheet和对话框的既有阴影改为近、远两层，减少大范围灰雾，
不增加模糊滤镜与动画。卡片档保持原样，不给纸面与编辑画布增加阴影，白色目录/大纲/编辑页保持。
自有工具栏、按钮、Sheet头与目录图标统一1.75描边；只作用于列明的自有控件直属Lucide，
不修改内核、表格、画板正文图元。直属SVG不压缩、不增加命中盒或行高。
搜索失败显示具体原因与重试按钮；正常空结果仍显示无匹配。清空关键词/关闭面板立即使旧请求失效。

浮层用 `--lake-shadow-popover`；卡片用 `--lake-shadow-card`；**同一面不用「细边 + 大软阴影」两套**。

**261104 用户验收修正**：首页窗底 `#f3f5f8`，目录、Pad 两侧栏与大纲恢复 `--lake-bg-panel`；
工作区整体与顶部改用 `--lake-bg-canvas`，编辑页无底色突变。小记卡、正文与胶囊保持白色。
层级由**表面明度差 + 既有细线**承担，沿用已有阴影，不增加滤镜或装饰动效：

- 分组边界 = **0.5px** `--lake-border-2`（设置页的分组卡 `.mb-set-section` 就是靠它从白底上"显形"的 —— 语雀的设置页同样是"白底 + 细线分组"，不是灰底白卡）；
- 卡片/输入/胶囊底栏 = 本来就有的 **0.5px** `--lake-border-1` + `--lake-shadow-card`；
- 行分隔 = `--lake-bg-block` / `--lake-border-2` 的 **0.5px** 线；
- **细线一律 0.5px**（261029 与桌面同一口径）；例外只有必须被看见的图形描边（`outline` 焦点环 2px、对勾/勾选符号、进度环、画板笔迹）。
- 按压/悬浮反馈仍走 `--lake-bg-hover` / `--lake-bg-press`（在白底上比原来更明显）。

**深色窗底仍是 #191a1d**，目录与大纲保留原面板底色；边界、辅助文字与选中底同步增强。

**例外（261015 / 261017 用户点单）**：**所有一级面板**（`＋` / 「更多」/ `Aa`）统一「浅灰底 + 白块」——`＋`/「更多」是方块网格（见 Layout 的 The Panel Grid Rule），`Aa` 是浅灰底 + 白色分组卡；
面板取色继续沿用该规则；常驻页面按外围浅色、内容白色的表面分工取色。

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
- **底部 Sheet 骨架已收敛为 `ui/MobileSheet.tsx`（MOB-11）**：scrim / 右滑关闭 / 返回栈 / 焦点 / 滚动锁只此一份。
  头部结构或语义不同的浮层（AI 三面板的文字动作按钮头、无头的新建面板、带 listbox 的选择器、ActionSheet 语义的
  确认框/附件菜单、可下钻的菜单 Sheet）**保留各自原语**，逐条理由见 `docs/MOBILE-SHEET-EXCEPTIONS.md`。
  **不要为统一改交互，也不要在原语里加视觉开关。**
- **禁止原生 `<select>` 的系统弹层**（用户 261012 反馈"有点丑"）：系统弹层不跟主题/字号走（深色下也是白底、
  选中态是系统蓝绿圈），与移动端浮层语言割裂。选项类交互一律走 `PickerSheet`（底部 Sheet 列表 + 打勾），
  触发器沿用 `.mb-select` 外观但是 `<button>`。与桌面 kit 的同类规则同源（桌面也不用原生 select 弹层）。

## Components

- **小记写作卡（261111 用户点单）**：写作 = **全屏编辑会话**，不是浮卡 —— `capture`（长按图标）与正常新建共用 `.mobile-qn-screen` 容器（状态栏安全区以下、dock/键盘以上）；去掉外距/圆角/阴影死区；正文唯一滚动，标签行 + 取消/保存并同步/保存 + 编辑 dock 固定在可视区内，键盘开合只让正文伸缩。写作时隐藏首页顶栏，退出恢复。图片显示：内核内图片经 display-only 钩子走资产服务 `?w=1024`，仅对卡片已带 original 尺寸的图生效（缺 original 的历史卡保持原图；见 LAKEX-CONTRACT §5.51/§5.52）；**移动端文档编辑器同档启用**（编辑+阅读，allowlist 按正文解析），新插入图片在上传确认 origin 后当会话即缩略；大图预览取原图。
- **小记列表卡：封面与预览不重复首图（261112 用户报）**：卡片上方用 `note.firstImage` 渲染封面（`qn-card__img`），`QuickNotePreview` 经 `hiddenMediaNames` 跳过同一张 image 卡（`HomePage` 传 `new Set([note.firstImage])`）；被隐藏节点全占满时预览不占位（回退文字）。只跳 image（附件/音视频无封面语义）；内核只读兜底路径仍可能重复（按正文自渲染）。

**节点图标（目录 / 知识库）**：`ui/NodeIconPicker.tsx`与`ui/NodeIconGlyph.tsx`是移动端独立实现，样式只在`ui/nodeIcon.css`。
40枚lucide线性图标配八档浅渐变圆角底块；图标与emoji共用1.15em居中槽。颜色/字号自行定义在移动端`theme/tokens.css`，不import桌面CSS。
节点选择器的表情页与文内输入`EmojiPanel`**彻底分离**，只共享资源表与最近记录逻辑，最近使用仍只写`icon`桶。
类型页初始按`nodeIconPickerMode`：笔记本/分组→图标，文档/表格/数据表→表情。顶部「移除」为图标+文字，44触达；选资源后保持打开，关闭/遮罩/滑动沿用宿主Sheet。
网格按可用宽度安排列数，每格至少44；新建知识库里的窄内容区可换行与滚动，末行必须完整可达。

原语库 = `src/mobile/kit.css`（`mb-*`）+ `src/mobile/floating.css`。清单：

`mb-btn`（**4 语义 + 危险 + 链接**：--primary/--outlined/--secondary/--ghost + --danger/--danger-text + --link；默认 44 / --sm 36 / --block；default/press/disabled/focus-visible/is-selected 六态；261110 与桌面同模型、独立实现，原 `--settings` 已收敛为 `--outlined`；触屏几何沿用 44/36，不对齐桌面 27/22）· `mb-iconbtn`（--compact）·
`mb-row`（--two-line、__icon/__main/__title/__sub/__meta/__chevron/__action/__actions、.is-selected）·
`mb-list`/`mb-list-item`（__text/__meta）· `mb-input`（--num）· `mb-select` · `mb-tag`(--pending/--ok/--error) ·
`mb-segment`/__item · `mb-chip`/`mb-chip-row`（选项胶囊：字段类型/筛选值/多选值；261030 把 bitable 并存的 `.mbt-feditor__choice`/`.mbt-chip`/`.mbt-form-chip` 三套收敛成这一件）· `mb-card`（__head/__body）· `mb-form__desc` · `mb-menu-note`/`mb-menu-head-action` ·
`mb-chevron`/--spacer · `mb-tree-icon` · `mb-indent` · `mb-spacer`/`mb-flex1`/`mb-ellipsis` ·
**选择器 = `PickerSheet`（`mb-select--trigger` 触发器 + `mb-sheet--picker` 底部列表、选中项打勾）** ·
**设置页骨架** `mb-set-group/title/items/section/item(--field)/name/desc/note/ctl/error/block/stats` ·
**空态 = `mb-empty`（+ `--inset` 变体；261013 A 批把 `.mobile-empty` / `.mb-set-empty` / `.mb-sheet__empty` 三套收敛成一件）** ·
**文内输入表情 = `mb-emoji-panel`(`--fill`)/`cats`/`cat`(`--action`)/`body`/`grid`/`cell`/`empty`（微信样式：顶部分类条 + 浅灰底大格子；
分类条末尾动作键是「返回」，退出表情选择、回「＋」面板。目录/知识库自定义图标不再使用此组件，见独立节点选择器）** ·
**首页 = 固定五格 Dock（`.mb-home-dock__item.is-active` = 主题色 + label 加粗）+ 中央 `.mb-home-fab`（261110 起；`.mobile-htab` 现只被 NodeIconPicker 的 Sheet 页签使用）** ·
**冷启动骨架 = `.mb-skel`（--icon/--tab/--group/--row/--baritem；结构与首页同构、尺寸同源，填充不跳动；
`prefers-reduced-motion` 下关掉呼吸）** ·
`mb-switch` · `mb-kbd` · **勾选原语**（`.mobile-app input[type=checkbox|radio]`，排除内核待办框）。

**Sheet 内页内容的两件契约（261030 固化为原语）**：页内距用 `mb-sheet__body--form`（= `--mb-page-pad`；行内列表再给自带内距的类时用 `--flush` 语义的裸 body），
底部动作栏用 `mb-sheet__foot`（左右页内距 + 底部安全区 + 发丝线；不要再在业务里写 footer padding）。
多维表「修改字段 / 编辑记录 / 视图配置 / 视图列表 / 选择日期 / 数据表操作」六个面板已统一到同一骨架。

**设置行语义（261102 定稿）**：`Item` = 左标题右控件（选择器/开关/短数字/动作，一行放得下）；`Field` = 内容输入类（标签与说明在上、控件独占下一行且吃满行宽；`.mb-set-item--field .mb-set-item__ctl > .mb-input/.mb-select--trigger` 补了 flex/width/min-width 硬约束）；`Block` = 标题 + 全宽内容。**「一行放不下、换行丑」的输入项一律用 Field，不要给 input 另写一套行。**

**Sheet body 三类（261102 补全）**：① 内容面板 = `mb-sheet__body--form`（左右 `--mb-page-pad`、底 20 + 安全区）；② 行内列表 = 裸 body，行自带左右内距；③ 菜单/动作 Sheet（`.mb-menusheet__items` / `.mb-actionsheet`）= 8 + 安全区，**这是明确例外**。侧栏（大纲 / 文档列表）不是 Sheet body：只挂 `.side-panel-body`（8 / 24 + 安全区），不要再叠 `.mb-sheet__body` 或 `.mb-list`（后加载会覆盖底部安全区）。

**小记标签（261102）**：`.qn-tag` = 浅灰绿实底 `--lake-quick-tag-bg`（浅/深两套）+ `border:0` + 内距 `--lake-space-lg` + `--lake-text-1`；选中态保留 accent（筛选选中要一眼可辨）。颜色只落 `theme/light.css` / `theme/dark.css`。

**手写板（261102，布局 v3：悬浮 overlay + 精简工具）**：页面 / 纸张 / 笔迹都是正文数据 —— **纸张只能编辑态改**；翻页 / 缩放 / 全局预览是视图操作，两端（阅读/编辑）都可用且不写盘。移动端 = **顶部悬浮 pill**（翻页 ｜ 缩放 ｜ 全局预览 ｜ **页签**，阅读/编辑同一条，absolute 不占布局；页码用紧凑写法 `n / N`，页签按钮打开底部 Sheet 打标记/写说明、只读态可看不可改）+ **底部悬浮工具坞仅编辑态**（absolute、bottom 8 + 安全区）：工具行收成一屏 7 键（笔/高亮/橡皮 + 当前色 + 当前笔宽 + 撤销/重做，44 盒；颜色 28 视觉内圆、点开悬浮色板；笔宽点开 4 档小面板），纸张行 40（视觉 36 + `::after` 命中 44）；**全局预览为悬浮覆盖**（导航下方、45dvh 内滚动、不推画布）；阅读态无工具坞/说明行，底部只剩工作区胶囊（pad 让位走「状态栏 + 间隔 + 安全区 + 胶囊 + 8」tokens 表达式）。悬浮面用 `--lake-bg-panel` + 0.5px 边 + `--lake-shadow-popover`，**不做毛玻璃/backdrop-filter**。纸面在「悬浮导航—悬浮工具坞」之间的可视区居中（stage 上下补出 `--ink-mobile-nav-h` / `--ink-mobile-dock-h`；只读态只补顶部），不再按整屏居中。

**手写板笔迹色板（261103 批4）**：唯一来源 `src/features/ink/inkPalette.ts` 的 `INK_STROKE_COLORS` —— **14 色 = 2 行 × 7**（深灰 + 中灰 + 红/橙/琥珀/绿/蓝/紫 + 6 个淡色，淡色行给高亮/浅标注用），桌面工具条与手机/平板悬浮色板共用这一份；颜色只是正文值（`InkStroke.color: string`），**inkDoc 版本与点编码不变**，加色不需要动格式。移动端色板容器 = 网格 `repeat(7, var(--mb-tap-min))`，命中盒仍 44×44。

页内交互（② 层）已定：设置页 = 抽屉九页 + 移动端自有版式原语（`src/mobile/ui/settingsPrimitives.tsx`，
`data-set-id` 契约与桌面 `settingsSearch.ts` 对齐，**只共享语义不共享组件**）；小记 = 时间线 + 写作卡九项工具条。

## Pad shell（平板外壳，261102 起）

判据唯一来源 = `src/mobile/pad/formFactor.ts`（按**窗口宽**三档：<600 compact / 600–799 medium / ≥800 expanded，写 `html[data-form-factor]`）。外壳规则只在 `src/mobile/pad/pad.css`，手机（compact）零命中。

**261102 十四批定稿（用户）：平板 = 更宽的移动端外壳，不是桌面板。** 桌面那套工具栏/密度不适合触屏，已整体回退：
- **胶囊 / 底部 dock / 各编辑器工具条与手机完全一致**（Lake 编辑态走 `EditorDockHost`、多维表紧凑工具条、表格手机 dock、手写板 v3 悬浮色板）。**不要再给平板开第二套工具条**（内核固定工具栏/9 项文字条/内联色板/常驻只读 dock 都已试过并回退）。
- **横向手势只对文档开放**（与手机同一条判据）：`usePanelDrag` 的 `allowFrom` 允许从 Lake 正文（contenteditable）起手，`canOpen` 收窄为**只认文档类型**；表格/多维表/画板/手写板自身有横滑语义 ⇒ 手势 no-op（胶囊入口照常可用）。
- **expanded 只多两件事**：① 更宽 —— 正文满宽 + `--mb-reader-pad: 32px`（手机 20）；首页内容宽 = **同一条** `--pad-content-width: min(92%,1200px)`（小记时间线与知识库同宽、随窗口自适应；书架列按 `repeat(auto-fill, minmax(96px,1fr))`）；② 树 / 大纲默认**悬浮覆盖**（`.pad-tree` = `--pad-tree-width: clamp(240px,22vw,360px)` / `.pad-outline` = `--pad-outline-width: clamp(240px,25vw,420px)`，top = `--pad-float-top`；层序 `--mobile-z-drawer`(45)，**不要用桌面 `--lake-z-sidebar`(250)**），收起路径 = 胶囊 / 点正文 / Esc；面板头有**固定按钮**，固定 = `position:static` 停靠进布局（`.pad-main--docked` 三栏、可编辑空间收窄），再次点击回到悬浮。固定状态**持久化**（设备本地 `lakex-local-notes-mobile.pad-panels`，只存 pinned；不进正文/同步；门禁每态前清掉以保证基线稳定）。
- **正文画布吃满可视编辑空间**：`.mobile-doc-body > .lake-editor` 与 `.lake-editor-mount` 在 expanded 下 `height:100%`（内核原本按内容撑成 ~85px ⇒ 下方一大块空白点不到）。
- **261103 六批 A1/A4**：横屏刘海让位 —— `.pad-tree`（padding-left）/ `.pad-outline`（padding-right）接 `--mobile-left/right-safe-area`；**页签关闭已满足 44 Rule** —— 页签内小 × 删除，关闭动作改为顶栏右侧 `.toolbar__button`（44×44，关闭当前页签，无活动页签禁用）；「＋ 打开文档」仍在页签条内 30×30（唯一残留的小目标）。
- 细节规格以 `docs/PAD-ADAPTATION.md` §10 最新一批为准（该文件是长期 pad 规格）。

## Motion

**261029 动效收敛（与桌面同口径）**：状态切换一律**瞬时**（hover / 颜色 / 背景 / 边框不再做过渡），只保留浮层入场/退场与结构展开。
- `--mobile-duration-panel: 250ms`（面板/遮罩/抽屉/路由转场共用这一档；`useRouteTransition` 的时长也钉在它上面）。
- `--mobile-duration-press: 250ms`（令牌保留；**按压反馈已改为即时**，不再做过渡，不要拿它去做动画）。
- 曲线只有一条：`--mobile-ease-panel` = `--mobile-ease-out` = `cubic-bezier(.22,1,.36,1)`（强 ease-out；进出统一 —— 遮罩不再 linear、抽屉不再用思源 Material 曲线）。
- 桌面侧同名令牌的现值是 `--lake-motion-fast/panel/slow = 250ms` + 字面 `ease-out`；移动端这两条是**强 ease-out**（同一意图、更利落的收尾），不要为了"完全一致"改成桌面字面值。
`prefers-reduced-motion: reduce` 下所有浮层/抽屉/指示线动画与过渡关闭（`mobile.css` 与 `floating.css` 各有一份名单，
**新增浮层必须登记进去**）。

## Gates（移动端指标已转门禁）

```bash
npm run check:mobileui     # 独立性 + 层护栏 + 内核样式护栏 + ui-metrics，一条命令
npm run check:mobilesnap   # 设备级：10 态整页计算值快照（0 差异）
node scripts/css-audit/drive.mjs 9335 scripts/css-audit/mobile-walkthrough.mjs   # 设备级：23 屏截图 + 五类探针
```

**基线只许降**的账本：桌面样式 import 白名单（现状 4 条：quick-notes + 2 feature CSS + 字体资源）·
桌面类名 token（**0**，不允许回涨）· 反向耦合（**0**）· 各样式文件声明数/重复组（`mobileLayers.test.ts`）·
`!important`（现状 **19**，新增须写明理由；都是压「内核行内样式 / 未分层内核 CSS」的必需项 ——
未分层的普通声明会压过我们 @layer 里的普通声明，只有「分层里的 !important」才强于「未分层的 !important」，
即 CSS Cascade 5 的 important 层序反转；261013 的 +2 来自压内核桌面引擎几何 `min-height:1024` 与 90px 底内距）·
移动端 **字号字面量为0**（261105：47处迁入现有字号档，ui-metrics基线归零）；
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

## UI 交互机制收口（261105）

- 数字字段失焦/Enter提交，0合法；草稿变化时用data-escape-reset让Pad Esc先撤回，再关闭浮层，组字时不触发快捷键。名称、说明和错误与输入/选择器/开关关联。
- 设置/搜索由DeferredPanel首次打开才加载，关闭时隐藏加载壳，访问后保留表单状态；AI页保持按打开条件挂载。
- PickerSheet保留原来只有标题的头部；与MobileSheet共用焦点/页面锁控制器，补方向键和焦点归还，不增加Tab陷阱。
- 图片/附件预览、普通移动Sheet和桌面Dialog共用lib/pageScrollLock的计数控制。预览优先关闭；Pad Esc先消费返回栈，再处理页面。
- 页面安全区只引用mobile-*-safe-area，env与原生WindowInsets的组合只在theme/tokens.css定义。
- AI表单状态/动作归useAiSettingsForm，分类关闭使读取失效，重开刷新已保存元信息并保留未保存草稿；原生测试异常给出失败/重试提示并撤销验证。AI与基础设置视图归分类组件，SettingsDrawer保留导航与既有数据所有者。

## UI 原语与架构审计（261107）

> 本文档的「原语」= 移动端壳层内**一个交互语义只有一套实现**的 React 组件/纯函数/CSS 类。
> 新代码必须优先复用下表；新增第二套（近似几何、另一套文案组装）先合并再写。

### 分层事实（不要臆造）

- **CSS 分层现状 = 未分层**：`theme/index.css` 只有 `@layer mtokens, mkit, mshell, mfeature, moverlay, ma11y;` 声明，
  base/tokens/light/dark 是裸 `@import`，其余 20 个 CSS 由 JS import ⇒ **规则全部未分层，顺序靠 import 顺序**。
  给单个文件加 `@layer{}` 会被未分层规则全量压过（观感回归）；全端 @layer 迁移是独立项目，**不要分批做**。
- **预算 = `src/mobile/mobileLayers.test.ts` 逐文件声明数 + dupGroups 棘轮**（只许降）。kit/quick-notes/mobile 已在本轮收紧：
  kit 596→**588**、quick-notes 281→**255**、mobile 1665→**1609**。新增规则前先在同一文件删等量，或说明为什么不删。
- **颜色/literals 只在 theme/**；pad 几何只在 `pad/pad.css`；`ink/inkPad.shared.css` 是桌面副本（契约，不是重复）。

### TS 原语台账（本轮新增）

| 原语 | 位置 | 用途 | 规则 |
| --- | --- | --- | --- |
| `SheetFooter` | `src/mobile/ui/SheetFooter.tsx` | 底部 Sheet 的取消/主操作条（`.mb-sheet__foot` + `.mb-btn`），支持 busy/busyLabel/danger/grow/compact | 标准两键/单键一律用它；三键/自定义布局传 `children`（签名板、表格表单、日期选择、资源清理保持原样） |
| `runDocBatch / moveTargetsFromSnapshot / moveParentFromSnapshot / tagOptionsFromTags / confirmTrashDocs` | `src/mobile/ui/docBatch.ts` | 两处文档多选（目录树 `useTreeSelection`、文档列表 `DocListSheet`）的 bridge.batchNotes 汇总、移动目标/当前位置计算、标签目录 options、回收站确认 | 批量动作只走这里；不统一两处动作条文案（树=置顶+短文案，列表=长文案）是**入口语义差异**，不是重复 |
| `formatUpdatedAt / formatRelativeTime / formatDateOnly` | `src/mobile/lib/listTime.ts` | 列表时间统一包装（core/dateFormat + 坏值兜底=空串） | 不要在业务组件里再写 try/catch 包装；需要新措辞先改 core/dateFormat |

既有原语不要重造：`MobileSheet`、`MobileSheetMenu`、`ConfirmDialog`、`toastBus`、`useLongPress`、`useSelectionMode`、`SelectionTopBar/SelectionActionBar/SelectionCheckbox`、`settingsPrimitives`（Item/Switch）、`pushBackHandler/useBackHandler`、`useSwipeToClose`、`haptics`、`dismissKeyboard`、`PanelLoading/DeferredPanel`、`MobileErrorBoundary`。

### CSS 审计结论（本轮已删死规则）

- 全端 23 个样式文件 / 1519 条规则 / 6394 条声明；**完全相同声明块 142 组**，但绝大多数是「同一视觉语义的不同状态选择器」（disabled/selected/active），属有意重复，**不做跨语义大合并**。
- 本轮删除**已验证 0 引用**的死规则 21 条 / 90 声明：quick-notes 的 `.quick-note-emoji-panel*`（已被 ui/EmojiPanel 取代）与 4 个 `qn-tag-manager__*` 死件、mobile 的 `.mbt-tables/.mbt-table-tab*` 与 `.mobile-qn-textarea/images/add`、kit 的 `.mb-spacer/.mb-btn--lg/.mb-row__actions/.mb-tag--ok/error`；同时把 `.mbt-table-tab` 从命中区注册表移除。
- **不做的合并**：两种卡面材质（`.mb-card` vs `.mbt-card` 细边白面）、行首图标槽 4 套、med-* dock vs mb-usheet-* dock、nodeIcon 表情页 vs 输入态 `.mb-emoji-*`、pad.css 几何回流、两套 z 阶梯/时长族/圆角族（词表保留）、动态拼接类名、第三方 `.ne-*/.univer-*/.draw-*`。

### 后续 backlog（按收益/风险，未做）

1. **P1 `toastActionError` 已完成（261107，两轮）**：`src/mobile/lib/actionError.ts`；第一轮收口 22 处 `getNativeErrorMessage` 入口，第二轮再收 12 处 `(e as Error).message` / `instanceof 三目` 入口（累计 34 处 / 12 文件），文案逐字不变。剩余 3 处是「已保存到本机，同步失败…」类自定义前缀 / 带 fallback 文案（「请重试」），保留原生写法。
2. **P1 `EmptyState` 已完成（261107）**：`ui/EmptyState.tsx`，收口 43 处简单空态（25 文件，裸/inset/p/role 四类变体）；带自定义按钮/复杂布局的 6 处保留原生结构。
3. **P1 TopBarIconButton 已完成（261107）**：`ui/TopBarIconButton.tsx` 把 4 处 `<span role=button>` 换成真 `<button>`（WorkspaceDrawers ×2 / WorkspaceOverlayHost / OutlineSheet），`.toolbar__icon` 补 appearance/border/background 重置。**PageHeader 经复核不做**：简单页已是真 button + `.mobile-topbar-title`，HomePage/WorkspaceTopBar 结构差异大，抽层只增耦合。
4. **P2 `.mb-row` 吸收 `.mb-list-item` 已完成（261107）**：kit 588→575（含 glass +4）；list-item 仅保留 `gap:10px` 覆盖，active/meta 合并。
5. **P2 `.mb-glass` / `.mb-surface` 已完成（261107）**：glass = kit +4 条声明替换 5 条稳定玻璃规则的重复 blur（mobile 1609→1603、floating −2、dock −2；顶栏滚动态因瞬态类保留）；surface = bitable 10 组细边白面的 border/radius/background 并成选择器组（bitable 957→**939**）。**`.mb-empty--compact` / `.mb-iconbtn--xs` 复核后不做**：bitable 空态有 3 套内距/对比度语义（text-3/text-4、xxl/giant），28px 方钮有 4 套几何（toast 关闭/树行动作/文件×/色板），强行归一会改变观感且收益仅为数字，按「一个语义一套」原则保留各自实现。
5b. **P2 a11y 行激活部分完成（261107）**：`ui/rowActivation.ts` 接入首页小记卡 + 知识库书架/列表卡；目录行内 ⋯/＋ 在行 button 内（嵌套 button 非法），保留由行语义承载。
6. **P2 大文件拆分（两处完成 261107）**：SettingsDrawer 785→**755**（菜单模型 → `settings/settingsMenu.ts`）；TagsHomeTab 608→**546**（长按拖拽排序 → `tags/useTagDragSort.ts`，行为/判据不变）。剩余（后续独立批次）：SettingsDrawer 子页渲染、HomePage 1116、MobileApp 965、EditorDock 844、MobileUsheetViewer 998。
7. **P2 a11y 已完成（261107）**：`rowActivation` 接入首页小记卡 + 知识库书架/列表；`TopBarIconButton` 把 4 处非嵌套 `span role=button` 改真 button；目录行内 ⋯/＋ 因嵌套 button 非法保持行语义（已记录）。
