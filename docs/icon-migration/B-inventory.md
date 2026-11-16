# B 卷 · 图标现状清点（替换面 / 不可动边界 / 门禁 / 工作量）

> 任务：把「要换的东西」数清楚，供 Lead 出迁移方案。**本卷只清点，不含方案**。
> 基线：仓库 `lakex-local-notes`，分支 `modernize/web-platform-261115`。
> 纪律：只读 `src` / `package.json` / `node_modules`；除本文件外零改动；一次性统计脚本全部放 `/tmp`；依赖只装到 `/tmp/iconpark-probe`。
> 所有数字可复现，命令与脚本见 **§7 附录**。`§3#14`/`§3#22` 指 `AGENTS.md` 长期红线。

---

## 0. 结论（先看这一页）

### 0.1 三个最关键的数字

| # | 数字 | 含义 |
| --- | --- | --- |
| 1 | **178 个文件 / 213 个唯一图标 / 884 个静态 JSX 调用点**（另有 1139 处标识符出现，含动态渲染与类型） | lucide-react 的替换面规模。884 个点里 **435 个（49.2%）落在 15 个「核心几何图标」**上（Plus/X/Check/Chevron* 等）⇒ 高杠杆、低视觉风险 |
| 2 | **替换面 98.1% 在 IconPark 有对应**（209/213；59 个同名、150 个近义、仅 4 个无对应 = CheckCheck/SquarePlus/Subscript/Superscript，合计 4 个调用点） | 覆盖率不是瓶颈；瓶颈是**视觉基线**与**红线审批**（见 0.2） |
| 3 | **桌面 42 态 + 移动 10 态 + 多维表 3 态快照基线全部会红**；单份桌面快照里 **12426/21794 = 57% 的指纹行是裸 SVG 图元**（`svgraw$*`） | 替换 ⇒ 全量重烤基线，是**最贵的隐性成本**；桌面与移动端**必须分两批**（移动端还要装机验收） |

### 0.2 对两条红线的正面回答（必须先过这两关）

**§3#14「图标只用 lucide（描边 1.75），禁 emoji/系统字形」——现状是「合规，但有一份例外清单」。**

| 现状 | 证据 | 对迁移的含义 |
| --- | --- | --- |
| 全仓 UI 图标 = lucide 单源 | 178 个 import 文件、213 个唯一图标；**0 个 ESLint/脚本门禁**（§5 开头） | 换成 IconPark **直接违反本条文字** ⇒ 必须**用户裁决 + 同步改 `AGENTS.md`**，不能由执行方自行解释 |
| 「描边 1.75」是**一条全局 CSS**，不是组件参数 | `src/styles/app/base.css:27` `svg.lucide { stroke-width: 1.75; }`（注释自称唯一来源；`tokens.css:11` 复述）+ 移动端 2 处 scoped 复写（`src/mobile/mobile.css:16-19`、`src/mobile/kit.css:431`）+ 3 处显式 prop | IconPark 的 class 是 `i-icon`、viewBox 是 48 ⇒ 这条规则**自动失效**；48 格要 `strokeWidth=3.5` 才等价于 24 格的 1.75（§2.4 / H1） |
| 现已存在的 11 个自绘图标**不是违规**，是「内核/云端 1:1 对齐」或「用户定稿设计稿」 | 见 §3（imageIcons 9 个是云端 lake 1:1、noteRef/lockedText 是 72 格 symbol、notebookIcons 17 个是用户点单的语雀插画） | 本仓既有口径是「**默认 lucide，例外写清理由**」；IconPark 迁移只能按同一口径逐条登记例外，不能整体换库 |
| 「禁 emoji」在 UI 代码里成立：emoji 只以**数据**存在 | `lakeEmojis.ts`(1088 行) / `lakeEmojiGroups.ts`(8 行) / `emojiZhKeywords.ts`(1087 行) / `emojiRecents.ts`；渲染入口是 `EmojiPanel`（表情输入）与 `NodeIconGlyph`（**用户数据**：目录节点图标历史值） | 迁移**不得碰**这条链路（§3#25② 日记图标可改、节点图标是同步字段） |

**§3#22「依赖准入四问」——按现有证据，IconPark 现在过不了四问；以下是逐问结论（`@icon-park/react@1.4.2` 实测数据来自 /tmp 独立安装，见 §7）：**

| 问 | 结论 | 证据/数字 |
| --- | --- | --- |
| ① 解决已验证痛点（有实测证据，不是「更优雅/以后可能」） | **不成立** | 清点未发现「lucide 不够用/图标缺失」的证据：213 个图标里 209 个有 IconPark 对应，反向也说明 lucide 侧没有明显缺口。自绘 11 个的存在理由全是内核/云端对齐，不是 lucide 不满足。按 §3#17「为统一/优雅加抽象层」= 过度设计信号 |
| ② 会否引入第二套样式/令牌/preflight | **是，撞 §3#14** | 第二套 icon runtime（`IconProvider` 的 theme/colors/strokeWidth）、第二套 class 前缀（`svg.lucide` → `svg.i-icon`）、第二套网格（24 → 48）、第二套描边单位（1.75 → 3.5）。并存期 = 两套视觉归一口径 |
| ③ 体积/离线/许可/打包成本算过 | **可算，代价可控但需实测** | Apache-2.0 ✅、零 runtime deps ✅、纯本地资源可离线 ✅。包体：unpacked **10.97 MB**（`dist.unpackedSize`）、`es/` 21 MB、**2659 个图标**；单图标 gzip 均值 **419 B**（抽 40 个）vs lucide **384 B**（抽 40 个）⇒ 213 图标等量≈ **89 KB gz** vs 现状 ≈ **82 KB gz**（+9%），且全部在异步 chunk 里，受 `check:bundle` 的 `app-js 300 KB gz` 预算约束，需实测。**并存期 = 两套都在 node_modules** |
| ④ 退出成本与护栏（门禁覆盖、删得掉） | **删得掉，但没有护栏 ⇒ 全靠视觉回归** | 无 ESLint、无脚本门禁（`grep -rin 'lucide' scripts` 仅 1 处注释命中）；退出成本 = 178 文件 import + 3 个注册表 + 42+10+3 态快照重烤 + 4 处测试硬编码（§5）。单一 import 路径是优点 |

**⇒ 结论：IconPark 全量迁移在当前红线下属「需用户裁决的破坏性改造」，不是「执行方可以自行决定的技术优化」。** 若用户裁决要做，最小可行路径 = 先做 §6.2 的 B0 试点（设置页 52 点/11 文件）拿到真实观感与门禁代价，再决定是否全量；**不要**先铺 178 文件。

---

## 1. 统计口径（先对齐，否则数字对不上）

| 口径 | 定义 | 数量 |
| --- | --- | --- |
| 「import 文件」 | `src/**/*.ts(x)` 中含 `from "lucide-react"` 的文件 | **178** |
| 「唯一图标」 | import 具名说明符去重后的**组件**名；`LucideIcon` 是类型，不计 | **213**（+`LucideIcon` 类型 1） |
| 「import 说明符」 | 所有文件所有具名 import 的条数（含 lucide 类型） | **900** |
| 「静态 JSX 调用点」 | 源码里字面出现的 `<IconName … />` 标签数（**不含**动态渲染） | **884** |
| 「标识符出现」 | 去掉 import 行后 `IconName` 词边界出现次数（含注册表引用/透传/类型） | **1139**（纯图标 1138） |
| 动态渲染（不在 884 内） | `FileKindIcon` 的 `<Icon>`（11 映射）、`SheetIcon` 的 `<Icon>`（37 映射）、`treeIcons` 返回图标组件 | 3 个间接入口 |
| 排除范围 | 测试文件**计入**（也会因换库而红）；`vendor/`、`node_modules/`、`dist*`、`electron/` 不计入 lucide 面 | — |

> ⚠️ 任务书里「ui-metrics 的直属 SVG 计数」**实测不存在**：`scripts/ui-metrics.mjs`、`check-mobile-ui.mjs`、`audit-primitives.mjs`、`audit-lookalike.mjs` 对 `svg` 的命中数均为 **0**（命令见 §7.3⑦）。真正钉死图标的是**快照指纹**（§5.4/§5.5），不是 ui-metrics。方案里若引用「ui-metrics 会拦图标」需更正。

---

## 2. lucide-react 全量清点

### 2.1 总量

| 指标 | 值 |
| --- | --- |
| import 文件 | **178**（177 个真有静态 JSX 标签；`src/mobile/ui/SelectionActionBar.tsx` 只 import 类型） |
| 唯一图标组件 | **213** |
| 静态 JSX 调用点 | **884** |
| 平均每文件 | 4.97 个唯一图标 / 4.96 个调用点 |
| 单文件最多 | `src/features/bitable/BitableEditor.tsx` 58 点 / 28 图标；`bitableCells.tsx` 44 点 / 26 图标 |
| 前 10 个文件点数合计 | **249**（占 28.2%） |
| 依赖版本 | `lucide-react@^1.61.0`（devDependencies，ISC，零 runtime deps；`node_modules/lucide-react` 46 MB，`dist/esm/icons` 下 **2171 个**单图标模块） |

### 2.2 Top 30 频次表（调用点降序）

| # | 图标 | 调用点 | 文件 | 占 1138 | IconPark 对应 | 置信度 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 1 | Plus | 69 | 49 | 6.1% | Plus | 同名 |
| 2 | X | 66 | 50 | 5.8% | Close | 高 |
| 3 | Check | 49 | 29 | 4.3% | Check | 同名 |
| 4 | ChevronRight | 36 | 30 | 3.2% | Right | 高 |
| 5 | Trash | 33 | 23 | 2.9% | Delete | 高 |
| 6 | Search | 31 | 24 | 2.7% | Search | 同名 |
| 7 | Pencil | 30 | 21 | 2.6% | Pencil | 同名 |
| 8 | Trash2 | 27 | 16 | 2.4% | DeleteOne | 高 |
| 9 | ChevronDown | 23 | 16 | 2.0% | Down | 高 |
| 10 | Sparkles | 21 | 15 | 1.8% | Magic | 中 |
| 11 | Tag | 20 | 16 | 1.8% | Tag | 同名 |
| 12 | Copy | 20 | 14 | 1.8% | Copy | 同名 |
| 13 | ChevronLeft | 18 | 17 | 1.6% | Left | 高 |
| 14 | FileText | 17 | 11 | 1.5% | FileText | 同名 |
| 15 | Paperclip | 16 | 13 | 1.4% | Paperclip | 同名 |
| 16 | Pin | 16 | 13 | 1.4% | Pin | 同名 |
| 17 | History | 15 | 14 | 1.3% | History | 同名 |
| 18 | Download | 14 | 11 | 1.2% | Download | 同名 |
| 19 | File | 14 | 11 | 1.2% | FileCabinet | 中 |
| 20 | Image | 13 | 10 | 1.1% | Picture | 高 |
| 21 | Feather | 13 | 8 | 1.1% | Write | **低** |
| 22 | RotateCcw | 12 | 10 | 1.1% | Return | 中 |
| 23 | MoreHorizontal | 12 | 9 | 1.1% | More | 高 |
| 24 | TriangleAlert | 12 | 9 | 1.1% | Caution | 高 |
| 25 | FolderOpen | 11 | 10 | 1.0% | FolderOpen | 同名 |
| 26 | Clock | 11 | 9 | 1.0% | Time | 高 |
| 27 | Lock | 11 | 9 | 1.0% | Lock | 同名 |
| 28 | Filter | 11 | 8 | 1.0% | Filter | 同名 |
| 29 | RefreshCw | 11 | 7 | 1.0% | Refresh | 高 |
| 30 | ArrowLeft | 9 | 8 | 0.8% | ArrowLeft | 同名 |

> 213 行完整频次表在 `/tmp/lucide-stats.json` 的 `rows`（生成脚本见 §7.3①）。映射置信度口径：同名 59 / 高 82 / 中 39 / 低 29 / 无对应 4。

### 2.3 长尾分布（决定「最后一批」有多贵）

| 调用点区间 | 图标数 | 说明 |
| --- | ---: | --- |
| 1 次 | **79** | 其中 78 个是真图标（另 1 个是 `LucideIcon` 类型，只出现 1 次）；79/213 = 37% 的图标只出现一次 ⇒ 逐个替换的边际成本最高、视觉收益最低 |
| 2 次 | 35 | |
| 3–5 次 | 49 | |
| 6–10 次 | 22 | |
| 11–20 次 | 19 | |
| 21+ 次 | **10** | Plus/X/Check/ChevronRight/Trash/Search/Pencil/Trash2/ChevronDown/Sparkles |
| 合计 | 213 | 79+35+49+22+19+10 = 214，减 `LucideIcon` = 213 |

另一条长尾：**88 个图标只出现在 1 个文件里**。

### 2.4 尺寸与描边现状（「统一入口」的真相）

**描边：唯一入口是 1 条全局 CSS，不是组件封装。**

| 位置 | 规则/写法 | 说明 |
| --- | --- | --- |
| 桌面 | `src/styles/app/base.css:27` `svg.lucide { stroke-width: 1.75; }` | 注释：「lucide 默认 2px 描边在 14–20px 下显重」；`src/styles/tokens.css:11` 复述「唯一来源」 |
| 移动 | `src/mobile/mobile.css:16-19`（`.toolbar__button > svg.lucide` 等 4 组）、`src/mobile/kit.css:431`（`.mb-row__icon`/`.mb-tree-icon`） | 只在容器作用域内复写 1.75 |
| 显式 prop | 仅 **3 处**：`SelectionActionBar.tsx:49` `size={19} strokeWidth={1.75}`、`WorkspaceTopBar.tsx:80` `size={18} strokeWidth={1.75}`、`NotebookGrid.tsx:87` `size={20} strokeWidth={1.9}`（**1.9 是隐性不一致**） | 3/884 = 0.34% |

**尺寸：97% 显式写 `size={N}`，共 19 个档位（散落）。**

| size | 14 | 16 | 15 | 13 | 18 | 12 | 20 | 17 | 19 | 22 | 11 | 24 | 26/28 | 其他(9,10,21,40) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 调用点 | 235 | 173 | 134 | 85 | 63 | 59 | 31 | 17 | 9 | 8 | 7 | 6 | 4 | 4 |

- 显式 `size=`：**859/884 = 97.2%**；动态 `size={size}`：24 处（透传）；无 size（靠 CSS/默认 24）：1 处。
- **前 6 档（14/16/15/13/18/12）= 749 点 = 87.2%** ⇒ 视觉核对只需盯 6 个尺寸档；剩下 13 档是零散例外。
- 迁移含义：IconPark 的 `size` 默认值是字符串 `'1em'`，lucide 是数字；859 处显式数字传入可原样兼容，**但「无 size」的 1 处与靠 CSS 兜底的地方会改变行为**。

### 2.5 有没有统一 Icon 封装？（结论：**没有**，只有 3 个注册表 + 4 个类型入口 + 16 个别名）

| 类型 | 位置 | 规模 | 迁移时改哪里 |
| --- | --- | --- | --- |
| 半封装：目录树图标函数 | `src/components/app/treeIcons.tsx` | 8 个 lucide（Book/Database/File/Folder/FolderOpen/PenLine/PenTool/Table），返回 `nodeIcon()` | 1 个文件 |
| 半封装：附件类型注册表 | `src/features/bitable/FileKindIcon.tsx` | `KIND_ICON: Record<AssetFileKind, LucideIcon>` = **11 个** | 1 个文件（**0 个静态 JSX 标签，只有动态 `<Icon>`**） |
| 半封装：表格 chrome 注册表 | `src/mobile/usheet/SheetIcon.tsx` | `ICONS` 映射 **37 项**（minus/plus/type/bold/italic/…/clear-style） | 1 个文件（`SheetIconName` 是 37 个业务键，键不能改名） |
| 类型入口（透传图标组件） | `FileKindIcon.tsx`、`mobile/ui/CreateSheet.tsx`、`mobile/ui/MobileSheetMenu.tsx`、`mobile/ui/SelectionActionBar.tsx` | `LucideIcon` 类型 4 处（1 次实际使用） | 跟着注册表改 |
| 本地别名 | 16 处（`Image as ImageIcon` ×8、`Tag as TagIcon` ×4、`Image as Info` ×3 …） | 16 | 别名本身要重命名，否则 IconPark 的 `Image` 不存在会报错 |
| 全局容器 | 无 `<Icon>` 门面、无 `IconProvider`、无尺寸令牌 | — | 需新建（B0，见 §6.2） |

**⚠️ 3 处语义错位（迁移时必须纠正，不能机械映射）：** `AboutSection.tsx:4`、`MaintenanceSection.tsx:4`、`useSettingsPanelScope.tsx:20` 都把 lucide 的 **`Image` 别名成 `Info`** 当「设置分组信息图标」用。若按「`Image` → IconPark `Picture`」机械映射，会把设置页的信息位换成图片图标。

### 2.6 按业务域分组

| 业务域 | 文件 | 调用点 | 唯一图标 | Top 5 |
| --- | ---: | ---: | ---: | --- |
| 移动端（全部 `src/mobile/**`） | 75 | 241 | 82 | Plus×22 X×15 ChevronRight×11 Check×11 ChevronLeft×9 |
| 多维表 | 14 | 152 | 55 | Plus×10 ChevronDown×5 Trash2×5 X×5 Check×4 |
| 外壳（桌面：`App.tsx`/`src/desktop`/`components/app` 其余） | 25 | 145 | 56 | X×13 History×7 Trash×5 Clock×5 File×4 |
| 小记 | 5 | 54 | 22 | Check×4 X×3 ChevronDown×2 Plus×2 Search×2 |
| 目录树 | 9 | 54 | 31 | Lock×3 Pin×3 Book×2 Database×2 PenLine×2 |
| 设置页 | 11 | 52 | 28 | Archive×3 HardDrive×3 Sparkles×3 Image×3 Trash×3 |
| 编辑器（含选区工具条） | 9 | 48 | 28 | X×5 Pencil×3 Pin×3 Copy×2 File×2 |
| AI 写作/助手 | 10 | 44 | 24 | X×3 Sparkles×3 ChevronRight×3 Check×2 Copy×2 |
| 手写板 | 6 | 39 | 20 | Plus×4 LayoutGrid×3 ChevronLeft×2 ChevronRight×2 Eraser×2 |
| 标签 | 1 | 16 | 12 | Check/FileText/GripVertical/MoreVertical/Merge 各×1 |
| 日记 | 1 | 14 | 11 | CalendarDays/ChevronRight/Feather/FileText/MoreVertical 各×1 |
| 公共（ui/lib/core/hooks） | 7 | 10 | 8 | ChevronRight×2 Check×2 ChevronLeft×1 X×1 ChevronDown×1 |
| 附件/预览/导入 | 1 | 6 | 4 | ExternalLink/FolderOpen/Paperclip/X 各×1 |
| 大纲 | 2 | 6 | 6 | ChevronsDownUp/ChevronsUpDown/Filter/Focus/Pin |
| 表格（Univer） | 1 | 3 | 3 | ChevronDown/ChevronUp/TriangleAlert |
| **画板** | **0** | **0** | **0** | 画板 UI 全部来自 Drawnix（§4.4），**不受迁移影响** |
| 合计 | 177(+1 类型文件) | 884 | 213 | |

**移动端子域（75 文件 / 241 点拆开看）：**

| 子域 | 文件 | 调用点 | 唯一图标 |
| --- | ---: | ---: | ---: |
| `mobile/bitable` | 13 | 48 | 24 |
| `mobile/settings` | 12 | 37 | 25 |
| `mobile/notebook`（树/工作区） | 10 | 34 | 19 |
| `mobile/ui`（通用原语/面板） | 16 | 25 | 17 |
| `mobile/home` | 4 | 22 | 16 |
| `mobile/editor`（dock/查找/大纲） | 4 | 21 | 17 |
| `mobile/usheet` | 9 | 18 | 13 |
| `mobile/ai` | 2 | 17 | 12 |
| `mobile/tags` | 2 | 9 | 7 |
| `mobile/diary` | 1 | 7 | 5 |
| `mobile/trash` | 1 | 2 | 2 |
| `mobile/ink` | 1 | 1 | 1 |

### 2.7 双端重叠（决定「能不能一次换完」）

| 集合 | 图标数 | 说明 |
| --- | ---: | --- |
| 桌面+移动都用的图标 | **68** | Archive/ArrowLeft/Book/Check/Chevron*/Clock/Copy/Download/File/FileText/FolderOpen/Image/Info/Lock/Pin/Plus/Search/Tag/Trash* 等 |
| 仅桌面 | 74 | 桌面特有业务 |
| 仅移动 | 14 | 移动端独有语义 |

⇒ 68 个共享图标是**视觉一致性风险最高**的一组：同一图标两端字号/容器不同（桌面 14/16 为主，移动 15/16/18 为主），换库后两端**必须一起看**；而移动端验收要走装机（§5.5），所以**双端不能同一批交付**。

---

## 3. 自绘 / 内联 SVG 清单（13 个文件逐个 + 容易数错的旁支）

**先纠正一个计数：13 个 `inline <svg>` 文件里有 2 个不是图标。** `src` 内 `<svg` 命中共 **19 个文件**：13 个任务书点名文件 + 6 个旁支（`clipboardHtml.ts`、`quickNoteToolbarWidgets.ts`、`quickNoteModel.test.ts`、`clipboardHtml.test.ts`、`boardExport.test.ts`、`usePanelDrag.test.ts`）。

| # | 文件 | 用途 | 是图标？ | 品牌/语义特殊？ | 可被现成图标替代？ | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `features/ink/InkCanvas.tsx` | **手写板画布本体**（`viewBox = page.width × page.height`、pointer 事件、背景图/`<image>`） | **否，是绘图表面** | 否 | 否 | **不动**（不是图标） |
| 2 | `features/ink/InkPageStrip.tsx` | **页缩略图**（同画布的子集渲染，含 `?w=256` 背景图） | **否，是缩略图** | 否 | 否 | **不动**（不是图标） |
| 3 | `features/bitable/bitableEditorModel.tsx` | `RowExpandIcon`（云端 lakex `lt-icon-RowExpand`，1024 格四角外扩） | 是（1 个） | 云端 1:1 | 可（IconPark `ExpandRight`/`FullScreen` 近似）但会丢 1024 网格细节 | 可替换，**低优先级** |
| 4 | `features/bitable/FileBadgeIcon.tsx` | 附件**大尺寸**（≥28px）纸页 + 扩展名文字（`<text>`，按 label 长度调字号） | 是（1 个复合） | 语义特殊（把扩展名印在纸上，见 `fileBadgeIcon.test.ts` 断言 `<text>`/`>DOCX<`） | **否**：任何图标库都没有「带扩展名的纸页」，且测试钉死 `<text>` | **不动**（自绘是 261020 用户点单的设计决策） |
| 5 | `features/outline/ExpandLevelIcon.tsx` | 思源 litheness `iconExpandLevel`「展开到级别」 | 是（1 个） | 源出思源（AGPL-3.0） | **可**（IconPark `ExpandDown`/`ClickToFold` 近似）；它是大纲头部第 4 枚按钮的唯一图形 | 可替换，**低优先级**；若换需同步 AGPL 署名口径 |
| 6 | `features/ai/AiTagIcon.tsx` | 云端语雀工具栏 AI 入口（`larkui-icon-icon-ai-tag-new`，222 格 + 渐变） | 是（1 个） | **云端 1:1 + 品牌绿渐变（`--lake-ai-tag-*`）** | 否（IconPark 无同形；换 = 与云端视觉分叉） | **不该换**（与云端对齐是明确目的） |
| 7 | `features/ai/AiSparkIcon.tsx` | 云端语雀 AI 助手入口（`larkui-icon-icon-queque-ai`，24 格 + 三色令牌） | 是（1 个） | **云端 1:1 + 品牌三色** | 否（同上） | **不该换** |
| 8 | `features/editor/selectionToolbar/imageIcons.tsx` | 图片浮动工具条 **9 个**（裁剪/旋转/宽高/链接/描述/对齐/样式/边距/批量） | 是（9 个） | **云端 lake 1:1**（注释明确「内核 kitchen-iconfont 没有这些图形，故不再手绘/lucide 兜底」） | 技术上可，**但会与云端工具栏视觉分叉**；3 个 viewBox 是 14/256 混合网格 | **不该换**（除非用户要求与云端脱钩） |
| 9 | `features/editor/selectionToolbar/LakeColorBoard.tsx` | 色板选中对勾（18 格，2 处复用）+ 1 处内核 `<use #icon-right-arrow>` | 是（1 个对勾图形） | 语义绑定色板（`checkFill()` 动态填充色） | **可**（IconPark `Check`/`CheckSmall`） | 可替换，**低优先级** |
| 10 | `features/editor/noteRefIcon.tsx` | 「文档引用」卡**插入面板图标**：只产出 `<symbol id=icon-lake-note-ref viewBox="0 0 72 72">` | 是（symbol，不是组件） | **内核 sprite 契约**（`<use xlink:href="#id">` 引用；颜色只能靠 `style` 里的 CSS 变量继承进 shadow 树） | **否**：IconPark 是 React 组件，无法塞进内核 sprite 的 `slash.icon` 通道 | **不可换**（内核机制约束） |
| 11 | `features/editor/lockedTextIcon.tsx` | 「加密文本」卡插入面板图标：同样只产出 `<symbol id=icon-lake-locked-text 72×72>` | 是（symbol） | 同上 + 用户 261024 设计定稿（圆角底板 + 挂锁） | **否**（同上） | **不可换** |
| 12 | `components/app/SyncStatusPopover.tsx` | `CloudCheckIcon`「云 + 对钩」（24 格、stroke 2、思源式组合） | 是（1 个） | 否（语义 = 同步完成） | **可**（IconPark `LinkCloudSucess` 近似，形态差异大） | 可替换，**中优先级**（状态图标易被用户察觉） |
| 13 | `lib/notebookIcons.tsx` | **17 个笔记本/分组彩色插画**（语雀 web 抓取，20×20，自带配色） | 是（17 图形 / 18 个 `<svg>` 标签） | **是**：语雀抓取、版权注释「将来对外分发需换自有图形」；且**落库值是数据方言 `n:<id>`** | **否**：不是「图标组件」，是**数据资源 + 编解码** | **不动**（见 §3.1） |

**小计：** 13 个文件里 **11 个真图标/图形源**（共 **45 个图形**：imageIcons 9 + notebookIcons 17 + FileBadge 1 + 其余 12 个单图形 + 色板对勾 1 + LakeColorBoard 内核 use 1）、**2 个是画布**（InkCanvas/InkPageStrip）。

### 3.1 目录节点图标 = 数据，不是组件（必须单独说明）

| 文件 | 角色 | 规模 | 为什么不能按「图标」换 |
| --- | --- | --- | --- |
| `src/lib/nodeIcons.ts`（52 行） | **编解码 + 方言判据**：`parseNodeIcon()` 解析 `tree_nodes.icon` 短串 | 2 种有效方言：表情（历史值）、`n:<id>`（17 插画）；`i:<id>:<色号>` 是**已删除的旧方言**，只识别为 unknown 画中性问号 | 值存在 SQLite `tree_nodes.icon` **随同步上传**；硬约束 **≤16 字符**（`core/treeRules.assertNodeIcon` + `electron/noteMetadataRepository.setNodeIcon` 两端校验）。换图形 = 换落库值 = 数据/同步协议问题，不是 UI 问题 |
| `src/components/ui/NodeIconGlyph.tsx`（31 行） | 桌面渲染器：emoji → 原样字符；notebook → `<NbSvg/>`；unknown → lucide `CircleHelp` | 1 个 lucide 图标 | 渲染器可改，但**图形集合由 `NOTEBOOK_ICONS` 数据决定** |
| `src/mobile/ui/NodeIconGlyph.tsx`（25 行） | 移动端独立渲染器（同判据、`mb-*` 类名） | 1 个 lucide | 同上；两端 UI 独立，**不共享组件** |
| 护栏 | `src/lib/nodeIcons.test.ts` | 断言 `NOTEBOOK_ICONS` **恰好 17 个**、id 唯一、`n:` 前缀、≤16 字符、往返一致、旧 `i:` 只出 unknown | 换数量/换 id = 直接红 |

> 🚫 **迁移红线**：任何「图标库替换」都不能动 `nodeIcons.ts` 的方言、`notebookIcons.tsx` 的 17 个图形、以及 `tree_nodes.icon` 的取值域（§3#25② 只开放日记本本体改名/换图标）。

### 3.2 旁支：4 处 CSS mask 图标 + 2 段裸 SVG 字符串（换库时会漏）

| 位置 | 内容 | 影响 |
| --- | --- | --- |
| `src/mobile/usheet/usheet-chrome.css:260/261/278/279` | **4 条** `mask: url("data:image/svg+xml,…")`，图形是 lucide 的 `corner-down-left`（回归）与 `maximize-2`（展开），**参数写死 stroke-width 1.75** | 「lucide 图形被硬编码成 CSS 资产」；换库后**不会跟着变** ⇒ 视觉分叉。需单独登记（或改成 mask 令牌） |
| `src/features/quickNotes/quickNoteToolbarWidgets.ts:116-117` | `EMOJI_SEARCH_ICON` / `EMOJI_RECENT_ICON` 两段裸 SVG 字符串（24 格、**stroke-width 2**，不是 1.75） | 小记写作卡表情面板两个按钮；**描边不一致的既有债**，换库容易漏 |
| `src/features/editor/clipboardHtml.ts` | 不是图标：解析粘贴 HTML 里的 `data:image/svg+xml`（判断空 SVG 并剥离） | **不动**（安全/清洗逻辑） |

---

## 4. 其它图标来源与「不可动边界」

总表：**来源 / 位置 / 规模 / 判定 / 理由**。判定三档：**不可替换**（机制或数据约束）、**不该替换**（品牌/云端对齐/用户定稿）、**可替换但本批不建议**。

| # | 来源 | 位置 | 规模（实测） | 判定 | 理由 |
| --- | --- | --- | --- | --- | --- |
| 4.1 | **内核 lakex SVG sprite** | `public/vendor/lakex-doc/kitchen-iconfont.js`；`vendor/lakex-doc-react/dist/**`；运行时注入隐藏 `<svg><symbol id="icon-*">` | **215 个 symbol**（`symbol id="icon-…"` 去重）；vendor 包装层 `vendor/lakex-doc-react/src/components/lakex/icon.tsx`（自挂 sprite，**我们直接 `Doc.createOpenEditor` ⇒ 该层从不运行**，AGENTS §2⓪） | **不可替换** | 内核工具栏/卡片/图标全按 `#icon-*` 引用，由闭源 vendor bundle 渲染；改它 = 改 vendor（§3#18 只走 `LOCAL-CHANGES.md` 最小改动） |
| 4.1b | 我们**注入内核 sprite** 的 2 个符号 | `noteRefIcon.tsx`（`icon-lake-note-ref`）、`lockedTextIcon.tsx`（`icon-lake-locked-text`），72×72 grid | 2 个 symbol | **不可替换** | 内核自定义卡 `slash.icon` 只接受**全限定 symbol id**；React 组件进不去。颜色只能走 `style={{ fill: "var(…)" }}` 继承进 `<use>` shadow 树 |
| 4.2 | **kitchen-iconfont**（名字叫 font，实际是 sprite 注入脚本） | `public/vendor/lakex-doc/kitchen-iconfont.js`（320 KB） | 同上 215 symbol；`icon-hand / icon-redo / icon-undo / icon-fit-viewport …` | **不可替换** | 内核资产，随 `setup:lakex` 恢复；不属于我们的图标层 |
| 4.3 | **Univer（表格）** | `node_modules/@univerjs/**`（153 MB，19 个精确锁定包） | Univer 自有图标体系（其 UI 包自带） | **不可替换** | 第三方 UI 树在我们 DOM 之外；AGENTS：Univer 只走 `docs/USHEET-UPGRADE.md` playbook、一次全升、**不要 npm update** |
| 4.4 | **Drawnix（画板）** | `node_modules/lakex-drawnix*`（876 KB + 68 KB + 44 KB）自带 `icons-*.js` chunk；patch `patches/lakex-drawnix+*`（删除按 UA 过滤 hand 工具） | 自带图标 chunk；画板**无 1 个 lucide import**（§2.6） | **不可替换** | 第三方画板 UI；补丁只有 1 处且禁止新增。画板观感只能在 Drawnix 主题/令牌层调 |
| 4.5 | **目录节点 emoji（用户数据）** | `src/lib/lakeEmojis.ts`(1088 行)/`lakeEmojiGroups.ts`(8 行)/`emojiZhKeywords.ts`(1087 行)/`emojiRecents.ts`；渲染 `NodeIconGlyph` + `EmojiPanel` | 2347 行含 emoji 字面量，其中 **2175 行是数据表** | **不可替换** | 是 `tree_nodes.icon` 的**历史取值**（同步字段，≤16 字符）；AGENTS「禁 emoji」约束的是 **UI 图标**，不是用户自选节点图标（§3 节点图标与文内表情解耦） |
| 4.6 | **移动端 mb-* 自有图标/表情** | `mobile/ui/EmojiPanel.tsx`（微信式 9 分类 + 动作键）、`mobile/ui/TopBarIconButton.tsx`（图标按钮原语，icon 由调用方传）、`mobile/usheet/SheetIcon.tsx`（37 项 lucide 注册表）、`mobile/usheet/usheet-chrome.css` 4 条 mask | 表情面板 1 组件；注册表 37 项；mask 4 条 | 表情面板 **不可替换**；SheetIcon **可替换但键不能改**；mask **需单独登记** | 移动端 UI 独立（两端不共享组件/CSS）；SheetIcon 的 37 个键是业务名（`row-above`/`clear-style`…），换图形不改键 |
| 4.7 | **品牌/启动标记** | `public/brand/14a-paper-finch-mark.png`（44 KB）、`electron/boot-anim.apng`（328 KB）、`electron/boot-poster.png`（28 KB）、`build/icon.icns`/`icon.png`、`android/**/mipmap-*/ic_launcher*` | 6 类资产 | **不可替换** | 品牌资产（14A Paper Finch），与图标库无关；`BrandLaunchMark` 桌面/移动各一份、只共享资源 |
| 4.8 | **PDF/预览第三方图标** | `public/vendor/pdfjs/` 与 pdfjs 依赖 | 第三方 viewer chrome | **不可替换** | 第三方 UI |
| 4.9 | **Emoji/符号在注释与日志里** | 约 170 行散布（`⚠️` `✅` `→` 等） | 非 UI 图形 | **不动** | 不是界面图标；不影响 §3#14 |

### 4.10 内核边界的结论（直接影响「全量」这个词）

- 内核图标经 `<use xlink:href="#icon-xxx">` + `.ne-icon` / `.ne-icon-symbol` 样式消费；我们唯一的自定义入口是 `ensureCustomCardIcons()`（`src/features/editor/kernelConfig.ts:217`）把 **2 个 symbol** 合并进同一 sprite。
- 因此**「图标全量换 IconPark」字面上做不到 100%**：内核内部工具栏/卡片工具条（`BookmarkToolbar`、图片卡工具条、块菜单、`+ 插入面板`）不在我们的 React 树里。可替换面 = 我们 React 组件里的 **884 个点 + 11 个自绘 + 3 个注册表**；内核面（215 symbol）必然是另一套风格。
- 后果：自有面换 IconPark 后，编辑态会出现「选区工具条 = IconPark、紧邻的内核卡工具条 = 语雀 1024 网格」的贴合断层（H6）。

---

## 5. 门禁与测试约束（哪些会红、红在哪一行）

> 结论先行：**没有任何 ESLint / 脚本门禁拦住「import lucide」或「用 emoji」**（`grep -rin 'lucide' scripts` 只有 1 处注释命中；仓库无 eslint 配置）。会红的是 **测试断言** 与 **视觉快照基线**。

### 5.1 测试里硬编码 lucide 的（换库必红）

| 文件 | 钉死的内容 | 影响 |
| --- | --- | --- |
| `src/components/app/sidebarRendering.test.ts:10-21` | `vi.mock("lucide-react", …)` 并**替换 `File` 图标**来数渲染次数 | 换库后 `vi.mock("lucide-react")` 仍在但组件不再被引用 ⇒ 计数恒 0，测试语义失效（**假通过**，比红更危险） |
| `src/mobile/bitable/mobileBitableViewer.test.ts:212-214` | 断言 HTML 含 **`lucide-layout-list` / `lucide-table-properties` / `lucide-list-filter`** 三个 class | 这三条**必红**；IconPark 的 class 是 `i-icon-<name>` |
| `src/mobile/bitable/mobileBitableViewer.test.ts:156` | 注释：「每个图标类名形如 `lucide … bt-file-icon …` ⇒ 用 `--` 形态计数」；断言 `bt-file-icon--` 计数 = 2 | 计数方式绕开 lucide 前缀，**可能仍通过**，但注释口径失效 |
| `src/mobile/ui/selectionMode.render.test.tsx:9,117-118` | `import { Paperclip, Trash } from "lucide-react"` 直接作为 `icon` prop 传入 | 换库后测试自身 import 会编译失败，**必须先改测试** |
| `src/features/aiWriting/AiWritingSidebar.render.test.tsx:137-139` | 「每一项都有 lead 图标（lucide 14 / aria-hidden）」+ `querySelector("svg")` | 断言是「有 svg」，**换库不会红**，但 size=14 口径注释失效 |
| `src/mobile/ink/MobileInkPad.render.test.tsx:250` | `[aria-label="画笔"] svg` 的 `width` 必须 = `"18"` | IconPark 同样把 size 写成 `width` 属性 ⇒ 大概率通过 |
| `src/mobile/settings/DefaultNotebookPickerSheet.render.test.tsx:58-59` | `.mb-list-item__check svg` 存在性 | 大概率仍通过 |
| `src/mobile/ai/aiAssistantProgress.test.ts:63` | `svg.spin` 的 `aria-hidden` | 若 class/结构变化则红 |

### 5.2 自绘/数据相关测试（不是 lucide，但会被「顺手重构」碰红）

| 文件 | 钉死 |
| --- | --- |
| `src/lib/nodeIcons.test.ts` | 17 个插画、`n:` 前缀、≤16 字符、往返、`i:` → unknown |
| `src/features/bitable/fileBadgeIcon.test.ts` | `<text>`/`>DOCX<`、27px vs 28px 分界、`badgeLabelOf` 规则 |
| `src/features/editor/noteRef.test.ts:168-172` | `NOTE_REF_ICON_ID === "icon-lake-note-ref"`、组件含 `<symbol id={NOTE_REF_ICON_ID} viewBox="0 0 72 72"` |
| `src/styles/cssLayers.test.ts` | 逐 CSS 文件**声明数 + 重复组**只许降；新增图标层 CSS（如 `svg.i-icon` 规则）会**加声明数 ⇒ 直接红**，必须同步更新巨型基线表 |
| `src/features/ink/*.render.test.tsx` | `.ink-page-svg` 数量/属性（画布，不受影响） |
| `src/mobile/ui/NodeIconPicker.test.ts:82-83` | `.mb-node-glyph--notebook svg` = 1、`--unknown svg` = 2（unknown 走 lucide `CircleHelp`） |

### 5.3 ui-metrics：**不统计 SVG**（纠正任务书假设）

- `node scripts/ui-metrics.mjs` 口径 = 桌面/移动 CSS 文件数、颜色字面量、`!important` 允许清单、字号字面量、`var(--lake-*)` 未定义、跨文件重复、被压声明、令牌别名 —— **没有 svg / icon 计数**（`grep -ic svg` = 0）。
- 换图标**不会**让 ui-metrics 红；但若新增 CSS 规则（如给 `svg.i-icon` 写 stroke），会进 `crossFileDupGroups`/`shadowedDecls` 统计，**可能顶破基线**（只许降）。

### 5.4 桌面视觉门禁 = `check-stylesnap`（42 态；SVG 指纹占 57%）

| 项 | 实测 |
| --- | --- |
| 脚本 | `scripts/css-audit/check-stylesnap.mjs`（**不是** `scripts/check-stylesnap.mjs`，后者不存在）+ 采集 `stylesnap.mjs` |
| 基线 | `scripts/css-audit/baseline/stylesnap.json`：**42 态**，每态只存 `{n: 元素数, hash: 折叠哈希}`（几 KB，可入 git） |
| 单份全量快照 | `.css-audit/snap/before.json`（8 态）：**21794 行**计算值指纹，其中 **12426 行（57.0%）是 `svgraw$<tag>`** |
| 裸 SVG 处理 | `stylesnap.mjs:43` `RAW_SVG` 集合（svg/g/rect/path/circle/…/lineargradient）；每个图元按 `(tag, 计算样式指纹)` **排序后落地** ⇒ **图元顺序无关，但图元集合与样式一变更就变** |
| 命中后果 | 换任何图标 = `svgraw$path` 行集合改变 + `n` 变化 + `hash` 变化 ⇒ **42 态全红** |
| 处置 | AGENTS §3#21③：动几何/重灌夹具 ⇒ `--from <warm>.json --write-baseline` **先重烤**；§3#21②：只跑受影响 1~2 态（`--states`） |
| 隐藏成本 | 重烤期间「旧基线 vs 新基线」的差异**只能人眼判断是预期还是回归**（尤其 57% 是 SVG 指纹） |

### 5.5 移动端/多维表视觉门禁

| 项 | 实测 |
| --- | --- |
| 移动端 | `scripts/mobile-audit/check-mobile-snap.mjs` → `snap-gate.mjs`；基线 `scripts/mobile-audit/baseline/mobile-snap.json` = **10 态**（home-library / home-quicknotes / home-create-sheet / home-library-list / home-doc / settings / settings-appearance / settings-s3 / settings-backup / settings-about），每态 `{n, hash}` |
| 多维表 | `check-bitable-snap.mjs` = **3 态**（表单 / 内容·表格 / 内容·卡片） |
| 前置 | 必须**设备**（AVD `lake_gate` CDP 9336 + 固定夹具 `gate-fixture.mjs`）；浏览器预览跑不起来（依赖 Capacitor 原生 SQLite） |
| 去抖 | 首轮有差异自动重跑一遍，两轮都差异才判红 |
| 交付纪律 | AGENTS §3#21④：动 `src/mobile/**` ⇒ 必须先 `bash scripts/android-build.sh --sync --install` 让用户当场验收 |

### 5.6 `verify-svg-csp.mjs`：**与图标无关**（不要误列进迁移门禁）

`scripts/verify-svg-csp.mjs` 验证「CSP(sandbox) 下 `<img src=*.svg>` 能否显示、`evil.svg` 的 `<script>` 是否被拦」= **用户上传/资源服务里的 SVG 资产安全**，不是 UI 图标。图标换库不经过它。

### 5.7 其它相关预算

| 门禁 | 约束 | 迁移影响 |
| --- | --- | --- |
| `check:bundle` → `check-bundle-budget.mjs` | `app-js` 入口 **300 KB gz**（261103 收紧） | 图标库本体在业务 chunk，不在入口；若 B0 把 `IconProvider` 放进入口/共享层，需实测 |
| `check:arch` | 桌面首屏 600 KB、内核 lazy 边界（`desktopKernelLazy.test.ts` 为准） | 若图标门面被内核组件静态引用，可能打破 lazy 边界 |
| `audit-vendor-css.mjs` | 第三方 CSS 必须进 `@layer vendor` | IconPark npm 包自带 `styles/`；**若 import 其 CSS 会触发未分层风险**（AGENTS 踩坑「JS import 的 CSS 一定未分层」） |

---

## 6. 工作量与风险估算

### 6.1 规模公式

```
替换面 = 884 调用点 + 3 注册表（8/11/37 项）+ 11 自绘图标 + 4 条 CSS mask + 2 段裸 SVG 字符串
视觉核验成本 ≈ 图标数 × 尺寸档位 × 主题数 × 端数
            = 213 × 6 主档 × 3 主题（light/dark/warm）× 2 端   ← 实际按批抽样，不逐项
门禁成本 = 桌面 42 态 + 移动 10 态 + 多维表 3 态 基线重烤（每次重烤要人眼判 SVG 指纹差异）
```

**关键判断：真正的成本不是「换 884 个点」（可 codemod），而是「重烤 55 个快照态 + 双端视觉核验」，其中 57% 的桌面快照行是 SVG 指纹。**

### 6.2 分批方案（先哪批、后哪批）

> 前置铁律：**同一语义，全仓只有一套视觉**（§3#14）。所以**不能按文件随机推进**，必须按「图标语义族 × 业务域」成批，每批都能独立跑门禁。

| 批 | 内容 | 文件 | 调用点 | 图标 | 验证装置 | 风险/理由 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| **B0**（地基，0 用户可见变化） | ① `<Icon>` 门面 + `IconProvider`（`theme="outline"`、`strokeWidth=3.5`、`size` 数字）② 生成「lucide→IconPark」映射表 ③ 保留 `svg.lucide` 兼容选择器 ④ 试点面选**设置页**（11 文件/52 点/28 图标） | 新建 1~2 + 设置页 11 | 52 | 28 | tsc + 设置页 stylesnap 6 态 + 人眼 | **go/no-go 闸门**。设置页图标密度高、无内核、无移动端，是成本最低的试金石 |
| **B1**（核心几何 15 图标） | Plus/X/Check/Chevron{Left,Right,Up,Down}/Search/Minus/MoreHorizontal/ArrowLeft/Copy/Trash/Trash2/Pencil | **128**（桌面 75 + 移动 53） | **435（49.2%）** | 15 | 桌面 42 态 + 移动 10 态（需装机） | 高杠杆：15 个形状覆盖近半调用点；风险在「尺寸档位」（14/15/16/18）与「双端同形」。**必须双端同批做**，否则 §3#14「同一语义一套视觉」被破坏 |
| **B2**（桌面外壳面） | 外壳 145 + 目录树 54 + 设置页 52 + 小记 54 + 标签 16 + 日记 14 + 大纲 6 = 251 | 45 | 251 | 56 | 桌面 42 态（含 quicknotes/settings/outline 屏） | 桌面纯自有 UI，无内核；`treeIcons` 8 图标 + `NodeIconGlyph` 的 `CircleHelp` 是唯二半封装 |
| **B3**（桌面编辑面） | 编辑器 48 + AI 44 + 手写板 39 = 221（含 11 自绘中的 9 个） | 34 | 221 | ~60 | 桌面 42 态 + 手写板/画板专项 | **最贵**：贴近内核（选区工具条与内核工具条并排）、AI 有品牌色自绘、手写板有共享 CSS 校验（`inkSharedCssParity.test.ts`） |
| **B4**（多维表/表格） | 多维表 152 + 表格 3 = 155；含 2 个注册表（FileKindIcon 11、SheetIcon 37）与 FileBadgeIcon | 15 | 155 | 55 | 桌面 42 态 + `check:bitablesnap` 3 态 | 注册表是「换 1 处影响 37 个按钮」的杠杆点；FileBadgeIcon **不动** |
| **B5**（移动端剩余） | 241 减 B1 中的移动部分；含 37 项 SheetIcon、EmojiPanel 的 3 个 lucide、4 条 CSS mask | 75 | ~180 | 82 | 移动 10 态 + 多维表 3 态 + **装机** | 独立批次：设备装置 + 装机验收 + 双端一致性复核（68 个共享图标） |
| **B6**（长尾） | 79 个「只用 1 次」图标 + 13 个低频尺寸档 | 视情况 | ~120 | 79 | 定点 `--states` | 边际收益最低；可后置，或用「新代码用新库、旧代码不动」并存策略（违反单源原则，需用户裁决） |

> **不建议的顺序**：① 先全量 codemod 再统一核验（55 态一起红，无法定位）；② 先移动端（装机成本高且桌面口径未定）；③ 先内核面（不可替换，§4.1）。

### 6.3 高风险点（逐条给证据）

| # | 风险 | 证据/数字 | 代价 |
| --- | --- | --- | --- |
| H1 | **IconPark 48 网格 vs lucide 24 网格** | IconPark 组件源码：`viewBox:"0 0 48 48"`、`fill:"none"`、每 path `strokeWidth: props.strokeWidth`；默认 `strokeWidth:4`。要让线宽等价于 lucide 1.75@24 格 ⇒ **`strokeWidth=3.5`@48 格**（1.75×48/24） | 全局描边入口必须从 1 条 CSS 改为 `IconProvider` 配置；任何漏配的局部 = 线宽翻倍/偏粗 |
| H2 | **outline theme 的 colors 机制** | `IconConverter`：theme=outline ⇒ `colors=[currentColor,'none',currentColor,'none']`；但图标 JSX 里出现 `fill: props.colors[1]`（如 Home 的第 2 个 path）⇒ **带双色/填充语义的图标在 outline 下填充变 `none`**，与 lucide 的「纯描边」不完全等价，部分形状可能「缺块」 | 必须逐个看 59 同名 + 150 近义图标的实际渲染（尤其 Archive/File*/Folder*/Grid*/Layout*） |
| H3 | **icon 组件额外产物** | 每个 IconPark 组件都 `useId` + `useContext` + 生成 `id`；`className` 为 `i-icon i-icon-<kebab>` | 884 点 = 884 个额外 context 订阅；快照里 svg 的 class 变化也进指纹 |
| H4 | **尺寸档位 19 档 / 前 6 档 87%** | §2.4：14(235)/16(173)/15(134)/13(85)/18(63)/12(59) | 不能只看 16px；IconPark 48 网格小尺寸细节更多，13/14px 档最可能「糊」 |
| H5 | **移动端一致性与装机** | 241 点 / 82 图标 / 75 文件；10 态 + 3 态多维表；AGENTS §3#21④ 必须装机 | 每轮移动端改动都要设备验证；68 个双端共享图标要两端并排核对 |
| H6 | **内核内嵌 UI 必然保留异风格** | 215 kernel symbol + 2 自定义 symbol（§4.1）；内核工具栏/卡片工具条/块菜单不在我们 React 树 | 观感出现「自有面 IconPark、内核面语雀」断层；编辑态最明显 |
| H7 | **A11y** | `aria-label` 1024 处、`aria-hidden` 306 处（`src/**/*.tsx`）；68 个测试文件含 `aria-label` 断言；`MobileInkPad` 断言 `svg width=18` | 只换图形不改语义则大多安全；若替换时误删 `aria-hidden` ⇒ 读屏多念 |
| H8 | **快照基线重烤** | 桌面 42 态、移动 10 态、多维表 3 态；单份全量快照 57% 行是 SVG 指纹（12426/21794） | 重烤 = 全量跑窗口矩阵/设备 + 人眼判断 55 态差异；一次迁移至少 2~3 轮（B0/B1/B5） |
| H9 | **注册表与别名的语义陷阱** | `Image as Info` ×3（§2.5）、`Sparkles→Magic`（中）、`Feather→Write`（低）、29 个低置信映射共 69 点 | 机械映射会把「信息/羽化/AI 星」换成语义错的形状；低置信 69 点必须人工过 |
| H10 | **数据/同步面被误伤** | `tree_nodes.icon` ≤16 字符、`n:<id>` 方言、17 插画、`nodeIcons.test.ts` 钉 17 | 任何「把节点图标也换成线性图标」的想法都会撞数据 + 测试 + §3#25② |
| H11 | **无门禁 ⇒ 回归靠人** | 无 ESLint、无脚本拦 lucide/emoji；ui-metrics 不统计 SVG | 「换完但漏了 N 处」不会自动暴露，只能靠 `grep 计数归零` + 快照 + 人眼；建议 B0 就加「禁止新增 lucide import」的守护（脚本或 `no-restricted-imports`），否则永远收不了尾 |
| H12 | **依赖四问未过** | §0.2 | 合规前置：用户裁决 + 改 `AGENTS.md` §3#14/§3#22，否则执行方无权动 |

### 6.4 一句话工作量

- **能自动化**：884 个 import/调用点机械改写（映射表已 98.1% 覆盖）+ 3 个注册表 + 4 处测试硬编码。
- **不能自动化**：55 个快照态重烤与判读、213 图标 × 6 主尺寸档 × 3 主题的抽样视觉核验、68 个双端共享图标并排对比、移动端装机验收、内核贴合度评估。
- **量级判断**：B0 试点（52 点）≈ 1 人日；全量 ≈ **8~15 人日**（含 2~3 轮快照重烤与设备验收），其中约**一半**花在视觉核验而非代码。

---

## 7. 附录：可复现命令与脚本

### 7.1 环境

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lakex-local-notes   # 或 $(git rev-parse --show-toplevel)
```

### 7.2 一行命令（可直接抄）

```bash
# ① lucide import 文件数（=178）
grep -rln 'from "lucide-react"' src | wc -l

# ② 内联 <svg> 文件（=19；任务书点名的 13 个是其中的图标子集）
grep -rln '<svg' src --include='*.tsx' --include='*.ts'

# ③ lucide 描边唯一入口
grep -rn 'svg.lucide' src/styles src/mobile --include='*.css' | grep stroke-width

# ④ 注册表 / 别名 / 类型入口
grep -rn 'LucideIcon' src | sort
grep -rn ' as ImageIcon\| as TagIcon\| as Info' src

# ⑤ 内核 sprite symbol 数（=215）
grep -o 'symbol id="icon-[a-z0-9-]*"' public/vendor/lakex-doc/kitchen-iconfont.js | sort -u | wc -l

# ⑥ CSS mask 图标（=4 条，均在 mobile/usheet/usheet-chrome.css）
grep -rn 'mask: url("data:image/svg' src --include='*.css'

# ⑦ 桌面 / 移动快照基线态数（=42 / 10）
node -e "const b=require('./scripts/css-audit/baseline/stylesnap.json');console.log('desktop',Object.keys(b.states).length)"
node -e "const b=require('./scripts/mobile-audit/baseline/mobile-snap.json');console.log('mobile',Object.keys(b.states).length)"

# ⑧ ui-metrics 是否统计 svg（=0，即不统计）
grep -ic svg scripts/ui-metrics.mjs

# ⑨ 门禁是否拦 lucide/emoji（无 ESLint；脚本无命中）
grep -rin 'lucide\|emoji' scripts --include='*.mjs' | head
```

### 7.3 统计脚本（一次性，全部放 /tmp）

**① `/tmp/lucide-stats.mjs` —— 唯一图标 / 调用点 / top30 / 别名**

关键点：`lucide-react` 的 import 常跨多行，**不能**用 `grep -o` 直接数；必须解析 `import … from "lucide-react"` 块，再对**本地名**做词边界计数。

```js
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(path.join(root, 'src'));

// 关键：body 用 [^;]*? 限制在单条语句内，避免跨越前一条 import
const importRe = /\bimport\s+(?:type\s+)?([^;]*?)\s+from\s+["']lucide-react["']\s*;?/g;

const fileImports = new Map();
const perIconFiles = new Map();

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m; const list = [];
  while ((m = importRe.exec(src))) {
    const braces = m[1].match(/\{([\s\S]*)\}/);
    if (!braces) continue;
    braces[1].split(',').map(s => s.trim()).filter(Boolean).forEach(spec => {
      const parts = spec.split(/\s+as\s+/);
      const imported = parts[0].trim().replace(/^type\s+/, '');
      const local = (parts[1] || parts[0]).trim();
      if (imported) list.push({ imported, local });
    });
  }
  if (!list.length) continue;
  fileImports.set(f, list);
  for (const it of list) {
    if (!perIconFiles.has(it.imported)) perIconFiles.set(it.imported, new Set());
    perIconFiles.get(it.imported).add(f);
  }
}

// 计调用点：去掉 import 行后对本地名做词边界计数（含注册表/透传，故略高于 884）
const clearImports = s => s.replace(/\bimport\s+(?:type\s+)?[^;]*?\s+from\s+["'][^"']+["']\s*;?/g, '');
const usage = new Map();
for (const [f, list] of fileImports) {
  const src = clearImports(fs.readFileSync(f, 'utf8'));
  for (const it of list) {
    const n = (src.match(new RegExp('\\b' + it.local + '\\b', 'g')) || []).length;
    usage.set(it.imported, (usage.get(it.imported) || 0) + n);
  }
}

const rows = [...perIconFiles.keys()].sort().map(name => ({
  name, files: perIconFiles.get(name).size, usages: usage.get(name) || 0,
}));
console.log(JSON.stringify({
  fileCount: fileImports.size,
  uniqueCount: rows.length,
  totalUsages: rows.reduce((a, b) => a + b.usages, 0),
  top30: [...rows].sort((a, b) => b.usages - a.usages || b.files - a.files).slice(0, 30),
  rows,
}, null, 2));
```
**② `/tmp/tag-stats.mjs` —— JSX 调用点 / size / strokeWidth 分布**

与 ① 同一套 import 解析，取到 `local → imported` 后对 `<Local …>` 标签计数，并正则取 `size=` / `strokeWidth=`：

```js
const tagRe = new RegExp('<' + local + '\\b([^>]*?)/?>', 'g');   // 逐标签扫
const sm = attrs.match(/size=\{([^}]*)\}|size="([^"]*)"/);        // 显式 size 859 / 动态 24 / 无 1
const sw = attrs.match(/strokeWidth=\{([^}]*)\}|strokeWidth="([^"]*)"/); // 仅 3 处（1.75×2、1.9×1）
```

输出 884 / 859 / 3，以及 19 档 size 直方图（§2.4 的表）。

**③ `/tmp/domain.mjs` —— 业务域聚合**

按路径前缀分组（首条命中即归类），输出「文件/调用点/唯一图标/Top5」：

| 域 | 前缀 |
| --- | --- |
| 移动端 | `src/mobile/` |
| 手写板 / 画板 / 多维表 / 表格 / 编辑器 | `src/features/{ink,board,bitable,usheet,editor}/` |
| AI 写作/助手 | `src/features/{aiWriting,ai}/` |
| 小记 / 标签 / 日记 / 大纲 / 搜索 / 附件 | `src/features/{quickNotes,tags,diary,outline,search,attachment,preview,import}/` |
| 设置页 | `src/components/app/settings/` |
| 目录树 | `src/components/app/` 下的 sidebar / Sidebar / treeIcons / NodeIconPicker |
| 外壳（桌面） | `src/App.tsx` / `src/desktop/` / `src/components/app/` 其余 |
| 公共 | `src/components/ui/` / `src/lib/` / `src/core/` / `src/hooks/` |

**④ IconPark 候选集（/tmp 独立目录，不污染仓库）**

```bash
mkdir -p /tmp/iconpark-probe && cd /tmp/iconpark-probe && npm init -y
npm install --no-audit --no-fund @icon-park/react@1.4.2

# 版本/许可/体积
node -e "const p=require('./node_modules/@icon-park/react/package.json');console.log(p.version,p.license)"
npm view @icon-park/react dist.unpackedSize     # 10968946

# 图标名单（=2659）
ls node_modules/@icon-park/react/es/icons/*.js | sed 's|.*/||; s|\.js$||' | sort > /tmp/iconpark-names.txt
wc -l /tmp/iconpark-names.txt

# 单图标 gzip 均值（抽 40 个；lucide 同法 = 384B，IconPark = 419B）
total=0; n=0
for f in $(ls node_modules/@icon-park/react/es/icons/*.js | head -40); do
  s=$(gzip -c $f | wc -c); total=$((total+s)); n=$((n+1))
done
echo "avg=$((total/n))"

# viewBox / 默认描边 / theme 机制
grep -n 'viewBox\|strokeWidth' node_modules/@icon-park/react/es/icons/Home.js | head
sed -n '1,120p' node_modules/@icon-park/react/es/runtime/index.js   # DEFAULT_ICON_CONFIGS / IconConverter
```
**⑤ 映射覆盖（`/tmp/coverage.mjs` → `/tmp/mapping.mjs`）**

1. `/tmp/coverage.mjs`：读 `/tmp/lucide-stats.json` 的 `rows` 与 `/tmp/iconpark-names.txt`，算同名交集 = **59**。
2. `/tmp/mapping.mjs`：对剩余 154 个图标套人工语义映射字典（每项带置信度），**并校验目标名确实存在于 IconPark 名单**；目标不存在的计入 unmapped。
3. 输出：exact **59** / high **82** / mid **39** / low **29** / unmapped **4**（CheckCheck、SquarePlus、Subscript、Superscript —— IconPark 1.4.2 无对应）。

**⑥ 快照规模 / SVG 指纹占比**

```bash
# 42 / 10
node -e "console.log(Object.keys(require('./scripts/css-audit/baseline/stylesnap.json').states).length)"
node -e "console.log(Object.keys(require('./scripts/mobile-audit/baseline/mobile-snap.json').states).length)"

# 单份全量快照：states=8 / rows=21794 / svgraw=12426
cat > /tmp/snap-count.mjs <<'EOF'
import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('.css-audit/snap/before.json', 'utf8'));
let all = 0, svg = 0;
for (const st of Object.values(j.states || {})) {
  const rows = st.rows || [];
  all += rows.length;
  svg += rows.filter(r => String(r[0]).startsWith('svgraw$')).length;
}
console.log({ states: Object.keys(j.states || {}).length, rows: all, svgraw: svg });
EOF
node /tmp/snap-count.mjs
```

**⑦ 各门禁的 `svg` 命中数（验证「ui-metrics 不统计 SVG」）**

```bash
for f in scripts/ui-metrics.mjs scripts/check-mobile-ui.mjs scripts/css-audit/audit-primitives.mjs scripts/css-audit/audit-lookalike.mjs scripts/css-audit/stylesnap.mjs; do
  printf '%s: ' "$f"; grep -ic svg "$f"
done
# 输出：0 / 0 / 0 / 0 / 10（只有 stylesnap 处理裸 SVG 指纹）
```

### 7.4 未决 / 需 Lead 决策

| # | 未决项 | 为什么必须由用户/Lead 定 |
| --- | --- | --- |
| 1 | 「全量换」是否包含**内核面**（215 symbol） | 技术上不可换；若用户期望「统一观感」，需接受「内核面保留」或另立「改 vendor 主题」项目 |
| 2 | 是否接受 `AGENTS.md` §3#14/§3#22 修订 | IconPark = 第二套图标源，与现行红线文字直接冲突 |
| 3 | 11 个自绘图标是否同步换 | `AiTagIcon/AiSparkIcon/imageIcons` 是**云端 1:1**；换 = 与语雀视觉脱钩，需用户点单 |
| 4 | 并存策略（新代码用新库、旧代码不动）是否可接受 | 违反「同一语义一套视觉」，但能显著压低成本；需用户裁决 |
| 5 | 是否先跑 B0 试点再决定全量 | 建议：**先 B0（设置页 52 点）**，用真实截图与门禁代价换决策依据，避免 8~15 人日沉没 |
