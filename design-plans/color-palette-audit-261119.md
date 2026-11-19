# 颜色取色面合规审计 261119 —— 移动端可选色 ⊆ 桌面端色卡（只读审计）

> 范围：全部文档类型的全部「用户取色面」，两端对照。判据 = **移动端可选值必须逐个精确出现在该面桌面取色 UI 的固定色卡里**（hex 逐字节相等；ΔE 近似不算）。
> 方法：源码/依赖实测取值（hex + file:line），集合包含关系用脚本核对（非目测）。本文件为唯一产出，产品代码零改动。
> 环境：Node 24（nvm v24.18.0）。内核检索顺序按 AGENTS：vendor 源码 → docs/lakexEditor-developer-docs → LAKEX-CONTRACT。
> **并行在修流**（core/colorPalette.ts + 多维表选项色板 70→2 行 ~20 色）在本文一律登记「在修」，不下结论细节（见 §4）。

## 0. 结论速览

| 面 | 判定 | 说明 |
| --- | --- | --- |
| 文档（Lakex）文字色/背景色 | ✅ 合规 | 移动 18 格全部精确 ∈ 内核 70 色阶（脚本核对 0 越界）；ΔE 近似只发生在设计期，运行时写入的是色阶精确值 |
| 小记写作卡 | ✅ 合规 | 移动复用文档 dock（同一组件）；桌面同一 SelectionToolbar/LakeColorBoard |
| 表格（Univer）字体颜色 | ❌ 越界 7 值 | usheetChromeModel.ts:108-114，全部不在 Univer 桌面色卡（45 预设） |
| 表格（Univer）背景填充 | ❌ 越界 13 值 | usheetChromeModel.ts:120-135，同上 |
| 表格（Univer）边框内容色 | ❌ 越界 1 值 | usheetBorders.ts:32 `#c8ccd2`，随正文落盘、桌面边框色板选不出 |
| 多维表 选项色 / 进度色 / 条件填色 / 列文字色 / 看板列色 | ✅ 结构合规（选项色板**在修**） | 移动 70 值 = 桌面 ColorPalette 同一数据源；选项色板本体在并行流改造中 |
| 画板（Drawnix） | ✅ 合规 | 两端同一引擎同一工具条（同色卡恒等） |
| 手写板（ink） | ✅ 合规 | 14 色单源数组两端同组件，且全部 ∈ 内核 70 色阶 |
| 标签/日记/AI/图表/图标等其余扫查面 | ✅ 无取色面 | 详见 §2.M |

**越界合计：16 个去重 hex，全部集中在表格（usheet）一面。**

---

## 1. 「桌面端色卡支持的颜色」基线（实测 hex 清单）

### 1.1 文档（Lakex 富文本）——内核自带色板
来源：vendored 内核 `vendor/lakex-doc-react/src/components/lakex/lakex.js`，调色板常量 `Zc`（**122960–123045**），`Zd.getColors()`（123057–123061）即色板数据源；色板组件 `erD`（129540–129680）结构 = 默认/无填充行 + 7 组 × 10 色 + 「渐变色」附加行 + 「最近使用自定义颜色」+「更多颜色」（RGBA 自选器 `erx`，任意色）。

固定色卡 70 色（与 `src/core/colorPalette.ts` 的 `COLOR_BOARD_GROUPS` **逐值一致**，已比对）：

```
行1  #000000 #262626 #595959 #8C8C8C #BFBFBF #D9D9D9 #E9E9E9 #F5F5F5 #FAFAFA #FFFFFF
行2  #F5222D #FA541C #FA8C16 #FADB14 #52C41A #13C2C2 #1890FF #2F54EB #722ED1 #EB2F96
行3  #FFE8E6 #FFECE0 #FFEFD1 #FCFCCA #E4F7D2 #D3F5F0 #D4EEFC #DEE8FC #EFE1FA #FAE1EB
行4  #FFA39E #FFBB96 #FFD591 #FFFB8F #B7EB8F #87E8DE #91D5FF #ADC6FF #D3ADF7 #FFADD2
行5  #FF4D4F #FF7A45 #FFA940 #FFEC3D #73D13D #36CFC9 #40A9FF #597EF7 #9254DE #F759AB
行6  #CF1322 #D4380D #D46B08 #D4B106 #389E0D #08979C #096DD9 #1D39C4 #531DAB #C41D7F
行7  #820014 #871400 #873800 #614700 #135200 #00474F #003A8C #061178 #22075E #780650
```

附加项（桌面能选、移动不提供，属桌面超集，不构成违规）：
- 渐变色 4 组（仅**字色**板；`appendColors`，lakex.js:130064，数据 `E2/E3` 83607–83622）：light `rgb(42,188,191)→rgb(56,54,221)` / `rgb(34,73,254)→rgb(199,74,168)` / `rgb(255,111,4)→rgb(243,48,171)` / `rgb(244,170,6)→rgb(229,70,49)`（dark 组为 E2）。
- 最近使用自定义颜色（历史桶）+ 更多颜色（RGBA 自选，任意 hex/alpha）。
- 内核固定栏「当前色」初值 `editor.color.default` = light #DF2A3F / dark #CA3F4F、`editor.bgColor.default` = #FBDE28 / #C2AC19（`src/features/editor/selectionToolbar/colorMemory.ts:34-37`）——不在 70 卡内，但属**内核桌面自身**能力，移动端不产生该值，不算移动越界。

我们桌面的选区浮栏色板 `LakeColorBoard`（`src/features/editor/selectionToolbar/LakeColorBoard.tsx:101-115`）= 同一 70 色 + `<input type="color">` 自选；挂载点 `lakeRuntime.ts:550`（所有桌面内核宿主）。

### 1.2 表格（Univer）——Univer 自带 ColorPicker
来源：`node_modules/@univerjs/design/lib/index.js` **:3433–3472**（`colorPresets`，5 行 × 9 = 45 色）；字体色 / 背景填充 / 边框色三面同一 `ColorPicker`（`node_modules/@univerjs/sheets-ui/lib/index.js`：TextColorSelector **:18944**、BackgroundColorSelector **:18997**、BorderPanel 颜色下拉 **:26893**），另有「更多」光谱 + hex + alpha 自选对话框。

固定色卡 45 色：

```
行1  #FFFFFF #E1EFFE #FDE8E8 #FEECDC #FFF4B9 #DEF7EC #D5F5F6 #EDEBFE #FCE8F3
行2  #CDD0D8 #A4CAFE #F8B4B4 #FDBA8C #FAC815 #84E1BC #7EDCE2 #CABFFD #F8B4D9
行3  #979DAC #3F83F8 #F05252 #FF5A1F #D49D0F #0DA471 #0694A2 #9061F9 #E74694
行4  #414657 #1A56DB #C81E1E #B43403 #9A6D15 #046C4E #036672 #6C2BD9 #BF125D
行5  #000000 #233876 #771D1D #8A2C0D #634312 #014737 #014451 #4A1D96 #751A3D
```

桌面挂载 = `src/features/usheet/UniverSheetEditor.tsx:305`（`toolbar: showToolbar` ⇒ Univer 原生工具栏含上述取色面板）。移动端把 Univer 自带 chrome 全部隐藏（`src/mobile/mobile.css:875-890`，只放行移动公式栏/查找条；`MobileUsheetViewer.tsx:635` `toolbar:false`）⇒ **移动表格只有我们 dock 的色板这一条取色路**。

### 1.3 多维表——应用内统一色板 ColorPalette
来源：`src/components/ui/ColorPalette.tsx:138-157` = `COLOR_BOARD_GROUPS` 70 色（= 内核 70）+ 最近使用 + `<input type="color">` 自选。移动字段编辑面 = 同一数据源 `COLOR_BOARD_VALUES`（`src/mobile/bitable/MobileBitableFieldEditorSheet.tsx:38,262-322`）。

### 1.4 画板（Drawnix）
两端同一引擎同一工具条（`loadDrawnixBoardCore`，移动 `src/mobile/board/MobileBoardViewer.tsx`、桌面 `src/features/board/BoardEditor.tsx`）⇒ 色卡天然恒等。实测 `node_modules/lakex-drawnix/index.mjs`（~2051–2085，数组 `li`）：

```
none(NO_COLOR) / default #333333（@plait/core DEFAULT_COLOR，plait-core.mjs:4363）
#FFFFFF #808080 #1E90FF #FF4500 #2ECC71 #FFD700 #8A2BE2 #FFA500 #FFB3BA #00CED1 #8B4513 #228B22 #D3D3D3
```

freehand 预设/主题另有 `#06ADBF #6D89C1 #E9C358 #42ABE5` 等主题描边色（`mi`，同文件 ~2110–2125）——两端同源。

### 1.5 手写板（ink）
两端同一组件同一数组（桌面 `InkToolbarDesktop.tsx:50` / 移动坞 `InkPad.tsx:1483`，数组单一来源 `src/features/ink/inkPalette.ts:21-26`）：14 色 = #262626 #8C8C8C + MOBILE_BOARD_SOLID.slice(1)（#FF4D4F #D46B08 #D4B106 #73D13D #096DD9 #722ED1）+ MOBILE_BOARD_LIGHT（#FFE8E6 #FFECE0 #FFEFD1 #E4F7D2 #DEE8FC #EFE1FA）。

---

## 2. 逐面判定与越界清单

### A. 文档（Lakex）文字色 / 背景色 —— ✅ 合规
- 移动取色面：编辑 dock「Aa」面板（`src/mobile/editor/EditorDock.tsx:798-821`）：字色快捷行 `QUICK_TEXT_COLORS` 5 色 + 背景板 `MOBILE_BOARD_LIGHT` 6 色 + `MOBILE_BOARD_SOLID` 7 色 + 默认/无填充格（UI 侧画）。值定义 `src/core/colorPalette.ts:30-58`。
- 落正文值 = 数组里的 hex 原样经内核命令写入（`pickColor` EditorDock.tsx:381-392 → `colorApplyCommand` selectionToolbarModel.ts:68-81 → `persistentColor` 内核 `toPersistentValue` lakex.js:36378，纯色 hex 恒等透传）。
- **ΔE 近似映射核对**：ΔE 就近映射只发生在**设计期**（对语雀 Android 实测采样的换算，逐色 ΔE 记录在 colorPalette.ts 注释）；数组存储值已全部是内核色阶精确值，运行时无二次映射 ⇒ **不存在「映射后≠内核色阶精确值」的违规**。
- 脚本集合核对：QUICK_TEXT_COLORS ∪ MOBILE_BOARD_LIGHT ∪ MOBILE_BOARD_SOLID（14 唯一值）⊆ 内核 70，**0 越界**。
- 备注（非违规）：移动色板没有「最近使用/更多颜色/渐变」，是桌面超集的子集，方向安全。

### B. 小记写作卡 —— ✅ 合规
- 移动：`src/mobile/home/QuickNoteComposer.tsx:457-460` 直接复用文档 dock（EditorDockHost，同一份组件）⇒ 取色面与 A 完全相同。
- 桌面：小记用同一内核宿主 ⇒ 同一 SelectionToolbar/LakeColorBoard（70 + 自选）。两端无独立自造色板。

### C. 表格（Univer）字体颜色 —— ❌ 越界（7 值）
- 移动面：SheetDockPanel「字体颜色」8 格（默认 + 7 色，`src/mobile/usheet/SheetDockPanel.tsx:262-281`），值 `SHEET_FONT_COLORS`（`src/mobile/usheet/usheetChromeModel.ts:106-115`）。
- 桌面基线 = Univer 45 预设（§1.2）。逐值判定（脚本核对）：

| 移动值 | file:line | ∈ Univer 45？ | 最近预设（仅供参考） |
| --- | --- | --- | --- |
| #8b8d98 | usheetChromeModel.ts:108 | ❌ | #979DAC |
| #e5484d | :109 | ❌ | #F05252 / #C81E1E |
| #f76b15 | :110 | ❌ | #FF5A1F |
| #ffb224 | :111 | ❌ | #FAC815 |
| #30a46c | :112 | ❌ | #0DA471 |
| #0091ff | :113 | ❌ | #3F83F8 / #1A56DB |
| #8e4ec6 | :114 | ❌ | #9061F9 / #6C2BD9 |

### D. 表格（Univer）背景填充 —— ❌ 越界（13 值）
- 移动面：SheetDockPanel「背景填充」2 行（`SheetDockPanel.tsx:283-321`），值 `SHEET_FILL_LIGHT`（usheetChromeModel.ts:118-126）+ `SHEET_FILL_STRONG`（:128-136）。

| 移动值 | file:line | ∈ Univer 45？ | 最近预设 |
| --- | --- | --- | --- |
| #fde2e2 | :120 | ❌ | #FDE8E8 |
| #fde8d7 | :121 | ❌ | #FEECDC |
| #fdf3cf | :122 | ❌ | #FFF4B9 |
| #e3f5e3 | :123 | ❌ | #DEF7EC |
| #e0ecfb | :124 | ❌ | #E1EFFE |
| #f0e6fb | :125 | ❌ | #EDEBFE |
| #d9d9d9 | :129 | ❌ | #CDD0D8 |
| #e5484d | :130 | ❌ | #F05252 |
| #f76b15 | :131 | ❌ | #FF5A1F |
| #d9a300 | :132 | ❌ | #D49D0F |
| #30a46c | :133 | ❌ | #0DA471 |
| #0091ff | :134 | ❌ | #3F83F8 |
| #8e4ec6 | :135 | ❌ | #9061F9 |

### E. 表格（Univer）边框内容色 —— ❌ 越界（1 值）
- `USHEET_BORDER_COLOR = "#c8ccd2"`（`src/mobile/usheet/usheetBorders.ts:32`）：边框**类型**用户可选、**颜色**是固定常量，但它**随正文落盘**（注释自述「文档里的边框颜色」）⇒ 属「文档里出现的桌面色卡选不出的颜色」。桌面 Univer 边框色板同 §1.2 45 色，无 #c8ccd2（最近 #CDD0D8）。

### F. 多维表 选项色 —— ✅ 结构合规；色板本体「在修」（不结论）
- 桌面：`FieldEditorModal.tsx:308` → ColorPalette（70 + 自选）；移动：`MobileBitableFieldEditorSheet.tsx:262-267` → `COLOR_BOARD_VALUES`（70）。同一数据源 ⇒ 移动 ⊆ 桌面恒成立。
- 当前选项色默认池 `BITABLE_OPTION_PALETTE = DEFAULT_LIGHT_COLORS`（`src/core/bitable/types.ts:411`）；**并行流正在把 70 色收成 2 行深浅 ~20 色（core/colorPalette.ts + 多维表选项色板）——登记「在修」，本审计不结论**。
- 旧命名色 `LEGACY_OPTION_COLOR_HEX`（`src/core/bitable/values.ts:61-68`：#e8e8e8 #d6e6fb #d3f0df #fde4d3 #f8d6cf #eadcf7）只是**只读兼容映射**（历史值回显），不是可选面、不产生新色。

### G. 多维表 进度条颜色 —— ✅ 合规（同 F 数据源）
- 桌面 `FieldEditorModal.tsx:320`（recentKey bitable-progress）/ 移动 `MobileBitableFieldEditorSheet.tsx:316-322`，均 70 色同源。跟随在修流。

### H. 多维表 条件填色 —— ✅ 合规（移动无取色面）
- 桌面 `BitableFillEditor.tsx:154-169` → ColorPalette（70 + 自选）；新规则默认色 = `DEFAULT_LIGHT_COLORS` 轮转（:59）∈ 70。
- 移动端只做只读投影（`MobileBitableViewer.tsx:592-615`，`fillSurfaceColor` 混色渲染），**无移动取色面** ⇒ 不产生移动独有色。AGENTS §3#19 条件求值/alpha 混色口径未动。

### I. 多维表 列文字色 —— ✅ 合规（移动无取色面）
- 桌面 `BitableEditor.tsx:1316`（recentKey bitable-column-text）→ ColorPalette。移动无此入口。

### J. 多维表 看板列色 / 日历颜色字段 —— 随 F
- 看板列色 = 选项色同源；日历「颜色字段」只认单选、取选项色（`src/core/bitable/views.ts:167`）⇒ 同 F 判定。

### K. 画板（Drawnix）—— ✅ 合规（恒等）
- 移动 `MobileBoardViewer.tsx` 编辑态直接显示 Drawnix 工具栏（与桌面同引擎同工具条；AGENTS patch「lakex-drawnix 删除按 UA 过滤 hand 工具 ⇒ 移动端工具条与桌面同款」）⇒ 两端色卡**同一份代码**（§1.4），恒等包含。无移动端自造板颜色。

### L. 手写板（ink）—— ✅ 合规
- 笔迹色：`INK_STROKE_COLORS` 14 色（inkPalette.ts:21-26）单源，桌面 `InkToolbarDesktop.tsx:50` 与移动坞 `InkPad.tsx:1483` 同一数组；脚本核对 14 值全部 ∈ 内核 70 色阶（顺带满足「不自造色」红线）。
- 页内文字块色 = 当前笔色同源（`InkPad.tsx:735`）。
- 页签（`page.note`）：**无颜色**，纯文本/标记（`InkPageTabForm.tsx` 无任何取色控件；`inkOutline.ts:7` 语义）。
- 背景/纸张：非取色面（纸纹走令牌；导出固定浅色常量 `inkSvgRasterize.ts:37` `#ffffff`、`core/inkPaperGeometry.ts:21` 导出线色）——登记备查，不算越界。
- `inkSharedCssParity` 只钉类名集合；本审计另核颜色值：两端共用同一 JS 数组，值无分叉。

### M. 其余一切「选色」字样全扫（grep 面板/色板/swatch/palette/颜色，全仓 566 命中逐类核对）
- **标签**：无取色面（`features/tags/tags.css` 纯令牌，无色板组件）。
- **目录/笔记本图标**：旧「40 线性图标 + 8 档色板」已整体删除（`src/lib/notebookIcons.tsx:9`、`mobile/ui/NodeIconPicker.tsx:15`），现为 emoji/插画，无取色。
- **笔记本动态主色**（`src/mobile/notebook/NotebookWorkspace.tsx:433`）：按笔记本稳定映射固定 5 色装饰（只写外壳 CSS 变量、不进正文）⇒ 非用户取色。
- **SheetMenuBody 圆点色板**（`src/mobile/usheet/SheetMenuBody.tsx:26-37`，`SheetMenuItem.swatch`）：`childLayout:"swatch"` **当前无任何构建方**（全仓无调用点）= 休眠能力，登记。
- **工作表标签「更改颜色」**：`ColorPalette.tsx:5` 注释提及，**未实现**（全仓无调用点）。
- **手写签名**（`MobileSignaturePad.tsx:26-79`）：笔迹色 = 主题计算色（兜底 #1f2329），非取色。
- **高亮块等内核卡自带色板**（`mobile/editor/dockInsertChoosers.test.ts:4`）：内核色板（§1.1），两端同内核 ⇒ 合规。
- **图表**：无（表格插入面 261104 已删图表假入口，usheetChromeModel.ts:48）。
- **日记 / AI 写作 / 搜索 / 设置**：无内容取色面（主题切换是 UI 令牌，不属本文判据）。
- 渲染桥 `src/styles/kernel-theme.css:62-69`（内核命名色板 → 语义令牌）与 `univerTheme.ts` 是**渲染映射**非取色面，登记备查。

---

## 3. 修复计划（仅针对越界：表格三面）

**P0 —— 表格字色/填充/边框收敛到「桌面色卡可选」（两案，落点均在 `src/mobile/usheet/`，不在在修流范围，可并行）**

- **案 1（最小改动、不碰第三方）**：把 `SHEET_FONT_COLORS` / `SHEET_FILL_LIGHT` / `SHEET_FILL_STRONG` / `USHEET_BORDER_COLOR` 的值换为 §1.2 Univer 45 预设中的**精确值**（例：#e5484d→#F05252、#f76b15→#FF5A1F、#ffb224→#FAC815、#30a46c→#0DA471、#0091ff→#3F83F8、#8e4ec6→#9061F9、#8b8d98→#979DAC、浅行→#FDE8E8/#FEECDC/#FFF4B9/#DEF7EC/#E1EFFE/#EDEBFE、#d9d9d9→#CDD0D8、#d9a300→#D49D0F、边框 #c8ccd2→#CDD0D8）。排布/文案/几何不动。优点：立即满足「桌面色卡能选出」、零依赖风险；缺点：表格色值与 core/colorPalette 仍是两套。
- **案 2（单一来源，AGENTS 选色红线方向）**：表格色板收口到 `core/colorPalette.ts`（等在修流 ~20 色定稿后取值），**同时**让桌面 Univer 取色面板暴露同一张卡：经 `ComponentManager` 重注册 `COLOR_PICKER_COMPONENT`（sheets-ui 已留该组件槽，见 sheets-ui index.js:18955/20192）为「共享色板 + Univer 自选」复合面板，或在面板首行加共享预设。**不得新增 patch**（patch 额度 4 处已满，AGENTS §3#17）；改动须过 `univerContract.test.ts` + `usheet-kernel-probes`。
- **建议**：先落案 1（解「桌面选不出」），案 2 与在修流合流后再做；若 lead 认可案 2 直达，可跳过案 1，但要在 ~20 色定稿后再落值，避免来回改。

**P1 —— 护栏（防回潮）**
- 新增单测钉两件事：①「`SHEET_*`/边框值 ⊆ 桌面基线」（基线 45 色以常量 + 来源注释 `@univerjs/design/lib/index.js:3433` 写进测试）；②「`MOBILE_BOARD_*`/`QUICK_TEXT_COLORS`/`INK_STROKE_COLORS` ⊆ 内核 70」（基线快照来源 `lakex.js:122960`）。仿 `inkPadWiring.test.ts` 的源码钉法即可。
- 顺带修两处过时注释：`usheetBorders.ts:8` 引用的 `COLOR_NAMES` 已不存在；`colorPalette.ts` 头注释补「70 色阶来源 = vendor lakex.js Zc（122960）」。

**不修（有意保留）**
- 移动文档色板不加「更多颜色/渐变/最近使用」：移动 ⊆ 桌面方向安全，加自选反而制造桌面卡外颜色（撞本次判据）。
- 内核默认「当前色」#DF2A3F/#FBDE28 等内核自有能力值不动（桌面基线的一部分）。

---

## 4. 与在修流（多维表选项色 / core/colorPalette）的边界

- **在修流范围**：`core/colorPalette.ts` + 多维表选项色板（70 色 → 2 行深浅对应 ~20 色）。涉及面（F 选项色 / G 进度色 / H 条件填色默认色 / J 看板列色、日历颜色字段）本审计只登记「**在修**」，不结论细节、不给修改建议。
- **本审计越界清单（C/D/E，共 16 hex）在 `src/mobile/usheet/**`，不在在修流范围** ⇒ 可独立修；若采用案 2 则取值需等 ~20 色定稿后落。
- **交叉提醒（给在修流）**：改 `core/colorPalette.ts` 时须保持 `MOBILE_BOARD_LIGHT/SOLID`、`QUICK_TEXT_COLORS`、`INK_STROKE_COLORS`、`COLOR_BOARD_GROUPS` 的值仍**精确 ∈ 内核 70 色阶**（lakex.js Zc），否则文档/手写板面会新增越界（本次它们全绿）。若 ~20 色是从 70 里取子集则天然安全；若引入新 hex 需先过本判据。
- 本审计未改任何产品代码；唯一产出 = 本文件。
