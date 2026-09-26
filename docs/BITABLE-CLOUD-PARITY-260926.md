# 多维表对标云端精仿（260926）

> **性质**：以**真实登录态浏览器（Edge 实例 54ead0c6）**走查语雀云端多维表原文 <https://todoo.yuque.com/ex813k/stock/ls7d44lq2n5q0q2u>，逐项取 `lakex-table-*` 真实 DOM 与 CSS，产出「云端规格 vs 我方现状」差距清单与对标批次。
> **上游**：`docs/BITABLE-PRODUCT-SPEC-260919.md`（260919 语雀/钉钉实机走查）· `docs/BITABLE-FEATURE-GAP-260926.md`（与主流对标）。
> **证据等级**：`[实测]` = 本会话浏览器/DOM/CSS 实测（截图 sha 见 §7）· `[推断]` 未直接验证 · `[决定]` 结论。
> **红线不变**：本地优先、单用户、无服务端；协作/权限/分享/自动化/AI/API 仍不做（`AGENTS §3 #17`）。
> **用户口径（260926 追加）**：**行首框是"点选"，不是"打开详情"**（否则无法多选）；行展开做成云端的 ⤢ 样式；整体功能与 UI **精仿云端**。

---

## 0. 一句话

云端的精致来自一套**克制且统一的设计令牌 + 交互细节**：行高 36、行首列 80、单元格内距 7×8、字号 14、圆角 6、9 级灰阶；行首三件套（拖拽/勾选/展开）24×24、悬停才显；表头左对齐 + hover 才露下拉；列菜单 11 项；记录详情是**无遮罩右侧面板 + 标签 168px 左列**；字段弹窗是锚定小卡。
**我方最"糙"的四处**：① 行首语义反了（点行号=开详情，勾选框被盖住，无法多选）；② 网格度量（行高 32 / 行首 46 / 字号 13 / 内距）与云端不一致；③ 表头居中、动作按钮规格不一；④ 记录详情被做成竖向表单 +（本会话刚改成）模态抽屉，与云端"非模态右侧面板 + 横向两列"不符。

---

## 1. 云端设计令牌（[实测] 取自内联 `--lt-*` + `lakex_table_yq.*.chunk.css`）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--lt-size-grid-row-height` | **36px** | 表头/行高（"低"档） |
| `--lt-size-grid-index-col-width` | **80px** | 行首列宽 |
| `--lt-size-grid-col-default-width` | **180px** | 默认列宽 |
| `--lt-size-grid-cell-padding-h` | **7px** | 单元格上下内距 |
| `--lt-size-grid-cell-padding-w` | **8px** | 单元格左右内距 |
| `--lt-size-font-size` | **14px** | 正文/表头字号 |
| `--lt-size-border-radius` | **6px** | 通用圆角 |
| `--lt-base-white` | 255,255,255 | 表面 |
| `--lt-base-grey-1` | 250,250,250 | 极浅底 |
| `--lt-base-grey-2` | 244,245,245 | **网格线 / 表头分隔** |
| `--lt-base-grey-3` | 239,240,240 | 三级底 |
| `--lt-base-grey-4` | 231,233,232 | **hover 浅底** |
| `--lt-base-grey-5` | 216,218,217 | 描边 |
| `--lt-base-grey-6` | 190,192,191 | 禁用/占位 |
| `--lt-base-grey-7` | 138,143,141 | **行号 / caption 文字** |
| `--lt-base-grey-8` | 88,90,90 | 次级文字 |
| `--lt-base-grey-9` | 38,38,38 | **正文主色** |
| `--lt-base-cyan-4` | 94,211,217 | **选区高亮**（`rgba(94,211,217,.1)`） |

> 映射到本仓库 `AGENTS §3 #14`：桌面颜色**只允许出现在 `src/styles/themes/`**。对标时应先在主题里加一组 `--lake-grid-*` 令牌（或复用现有 `--lake-*`），bitable CSS 只引用令牌，不写死 hex。**本批先做几何/交互，颜色映射单列一批**。

---

## 2. 云端关键组件实测（真实 DOM + CSS）

### 2.1 网格与单元格
```css
.lakex-viewer-grid-cell {
  width: var(--lt-size-grid-col-default-width);
  padding: var(--lt-size-grid-cell-padding-h) var(--lt-size-grid-cell-padding-w); /* 7px 8px */
  border-right: 1px solid var(--lt-color-grid-cell-border-right); /* grey-2 */
  color: var(--lt-color-text-primary); /* grey-9 */
  align-items: flex-start; display: flex; position: relative; overflow: hidden;
}
.lakex-viewer-grid-cell.selected { background-color: var(--lt-color-bg-primary); }        /* 白 */
.lakex-viewer-grid-cell.in-select { background-color: var(--lt-color-grid-cell-selected-background); } /* cyan-4 @ .1 */
```

### 2.2 表头
```css
.lakex-viewer-grid-header { height: var(--lt-size-grid-row-height); border-bottom: 1px solid var(--lt-color-grid-border); background: white; display:flex }
.lakex-viewer-grid-header-column { width:180px; height:100%; padding:0 8px; font-size:14px; align-items:center; display:flex; position:relative }
.lakex-viewer-grid-header-column:before { /* 右侧 1px 分隔线 */ }
.lakex-viewer-grid-header-column:hover { background-color: var(--lt-color-bg-primary-hover) }
.lakex-viewer-grid-header-column-content .lakex-viewer-grid-header-column-icon { margin-right:6px }
.lakex-viewer-grid-header-column-dropdown { width:24px; height:24px; border-radius:4px; display:none }  /* hover 才 flex */
.lakex-viewer-grid-header-column.in-filter { border-top:2px solid <accent> }
```
**要点**：表头**左对齐**（icon + 名称 + 省略号），不是居中；下拉按钮 24×24、圆角 4、hover 才出现。

### 2.3 行首三件套（用户重点）
真实结构（`lakex_table_yq` 实测）：
```html
<div class="lakex-viewer-grid-row-index" style="width:80px">
  <div class="lakex-viewer-grid-row-dragger"><span class="lt-icon lt-icon-Drag">…</span></div>
  <label class="ant-checkbox-wrapper lakex-viewer-grid-row-checkbox"><input type="checkbox">…</label>
  <div class="lakex-viewer-grid-row-expander lt-tooltip"><span class="lt-icon lt-icon-RowExpand">…</span></div>
</div>
```
```css
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-number,
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-checkbox { color: var(--lt-color-text-caption); margin-top:8px }
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-dragger,
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-expander {
  visibility:hidden; width:24px; height:24px; border-radius:4px; font-size:16px;
  display:flex; align-items:center; justify-content:center; position:absolute; top:7px;
}
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-dragger { left:4px }
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-expander { right:0 }
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-dragger:hover,
.lakex-viewer-grid-row-index .lakex-viewer-grid-row-expander:hover { background-color: var(--lt-color-bg-primary-hover-light); cursor:grab }
```
- 展开按钮 tooltip 文案 = **"展开行（Space）"**（[实测] observe 抓到 `tooltip "展开行（Space）"`）。
- 展开图标 = `lt-icon-RowExpand` 的 SVG（四角外扩箭头，path 已抄录，见 `BITABLE-PRODUCT-SPEC`/本会话记录），可直接内联进我方。
- **语义**：行号/勾选框负责**选中**；⤢ 负责**打开详情**；键盘 Space 展开当前行。

### 2.4 列头 ⋯ 菜单（**11 项**）[实测]
`编辑列 / 复制列` ｜ `向左插入列 / 向右插入列` ｜ `按本列分组 / 按本列筛选` ｜ `升序 / 降序 / 高亮重复值` ｜ `文本颜色 ⌘+Shift+E` ｜ `删除列`
> 我方只有 8 项（缺 **按本列分组 / 高亮重复值 / 文本颜色**）。

### 2.5 记录详情（**非模态右侧面板 + 横向两列**）[实测]
- 无遮罩；右侧面板覆盖表格一半，表格仍可见（`lakex-ui-modal-mode-drawer`）。
- 顶栏：标题 + 编辑 / 展开 / 上一条↓ / 下一条↑ / ⋯ / 关闭。
- 表单 **`layout-lite`**：`.lakex-table-expand-record-form-item-label { width:168px; height:32px; padding:0 8px }` + `.form-item-content { flex:1; width:calc(100% - 168px) }`；标题 `font-size:22px`。**标签左、值右**。
- 记录**正文**：`点击输入正文内容` = 完整 Lake 编辑器（云端有；我方 260919 决定不做）。
- 附件格：`image-list/file-list` 边框 + 圆角 6 + min-height 120/max 200。

### 2.6 字段编辑弹窗（锚定小卡）[实测]
`数据表列名 [文本]` / `列类型 [当前类型 ▸]` / `默认值 [请输入]` / `[取消] [确定]`；白卡、圆角、阴影，锚在列头下方；主按钮 = 语雀绿。类型行带 ▸ 子菜单（18 种）。

### 2.7 工具栏 [实测]
`表格配置 ｜ 筛选 ｜ 分组 ｜ 排序 ｜ 行高 ｜ 搜索 ｜ + 添加记录`，右侧 `生成表单`。
> 我方**缺"分组"**；其余已具备。

### 2.8 其它交互
- **点列头 = 选中整列**，底部角标"已选择 N 个单元格"（我方已有范围选择，但点表头选列？需核）。
- 底部中间"**4 条记录**"；每列头有"统计"入口（我方 260919 决定不做）。
- 行拖拽键盘可达（`role=button aria-roledescription=sortable`，aria 文案"press space to pick up"）。

---

## 2bis. 补查（260926 第二遍走查）

### 2bis.1 分组（**单级**）[实测]
- 工具栏「分组」→ 白卡面板：空态只有一行 `选择一列进行分组 ⌄`（**无确定按钮，选完即生效**）。
- 选定后：面板行变为 `[✕] [◉ 单选 ⌄] [升序 | 降序]`（分段控件，默认升序）；**没有"添加分组"入口 ⇒ 云端是单级分组**。
- 表格：组头 `▾ (空)`（折叠三角 + 组值；空值显示 `(空)`），组内行号连续、整体在组头下缩进；`.lakex-viewer-grid-header.has-group` 时表头高度 = 2×行高。
- 移除：点 `✕`。

### 2bis.2 筛选面板 [实测]
- 面板：`当 [字段⌄] [操作符⌄] [值] [⋯]` + `+ 添加筛选规则` + `🗑 删除筛选`。
- **打开面板即自动生成一条空规则**，工具栏按钮出现 `1 个筛选` 角标（规则是视图一等对象）。
- 规则行尾 `⋯`（更多）。

### 2bis.3 行高 [实测]
- 菜单仅 **低 / 中 / 高** 三档（当前档打 ✓，每项带行高小图标）。
- ⇒ 我方现有 `low/medium/high/xhigh/custom` 比云端多；**建议保留自定义但把"低"对齐 36**。

### 2bis.4 其它补记
- 表头「文本」点击 = 选中整列（底部 `已选择 N 个单元格`）；单元格范围选中为青色 tint。
- `表格配置` 面板：字段行 = 拖拽柄 + 类型图标 + 名称 + 眼睛 + ⋯（与 spec 一致）。
- 记录详情（上一轮已看到）：**非模态右侧面板** + `layout-lite` 横向两列（标签 168px）。

---

## 3. 功能对标：云端有 / 我方缺（含既有决策）

| 功能 | 云端 | 我方 | 建议 |
|---|---|---|---|
| 字段类型 | 18（+高级创建/修改时间） | 7 | 维持用户既定精简；**建议补：数字格式、创建/修改时间**（低成本） |
| 视图 | 6（表格/看板/画册/日历/图表/表单） | 2（表格/表单） | 先补**看板**（依赖分组） |
| 分组 | ✅ 单级 | ✅ 已做（B4） | — |
| 逐列统计 | ✅ | ❌（用户说不做） | 复议：可只做数字/单选轻量统计 |
| 记录正文（Lake） | ✅ | ❌（用户否决） | 不做 |
| 高亮重复值 | ✅ | ❌ | 做（低成本，配合条件着色） |
| 文本颜色 / 条件着色 | ✅ | ❌ | 做（P2） |
| 行高多档 | ✅（含自定义） | ✅ | 对齐数值（低=36） |
| 撤销/重做 | ✅ | ❌ | **做**（P0，见 GAP 文档） |
| 键盘导航/块粘贴 | ✅ | 部分 | **做**（P0/P1） |
| 冻结列 | ✅ | ❌ | 做（P1） |
| CSV 导入导出 | ✅ | ❌ | 建议复议 |
| 统计/仪表盘/AI/自动化/权限/分享/协作 | ✅ | ❌ | 红线不做 |

---

## 4. 我方现状（差距，按用户可见度排序）

> **更新（B1 已做，260926 本会话）**：下列 **1–5 已修复**（行首语义/展开按钮/网格度量/表头左对齐/表头下拉）。剩余 6–10 见 §5 后续批次。

1. **行首语义反了 [实测] **：`BitableEditor.tsx` 中 `bt-row-num`（行号按钮）`onClick={() => openDrawer(...)}` 打开详情；`bt-row-check`（勾选框）是绝对定位且**渲染在行号之下层**（DOM 顺序 grip→check→num，num 最后 ⇒ 命中 num），所以点勾选框实际打开详情 → **无法多选**。这正是用户报的问题。
2. **缺行展开按钮**：没有 ⤢；详情入口错放在行号上。
3. **网格度量偏小**：行高 `32`（云 36）、行首列 `46`（云 80）、正文字号 `13`（云 14）、单元格内距 `4px 8px`（云 7px 8px）、行号色/线色未对齐灰阶。
4. **表头居中**：`.bt-th-inner { justify-content:center }`（云左对齐 + icon 6px + 名称省略号）。
5. **表头下拉规格**：`.bt-th-more` 绝对定位、无 24×24 圆角 hover 底。
6. **列菜单缺 3 项**。
7. **记录详情方向不对**：我方竖向（label 上/值下）+ 本会话改成了**模态抽屉**；云端是**非模态右侧面板 + 标签 168px 横向两列**。
8. **字段弹窗居中**（云锚定在列头下）。
9. **工具栏缺"分组"**。
10. 详情/面板阴影、圆角、hover 底、图标规格未统一。

---

## 5. 对标批次（建议执行顺序）

- **B1 行首与网格度量 —— ✅ 已做（260926 本会话）**：`BitableEditor.tsx` 行首重构为「行号/勾选框=选中，⤢=展开详情（tooltip「展开行（Space）」）」；`.bt-row-handle` 三件套（grip / checkbox / expander 24×24、圆角 4、hover 底）；行高 **36**、行首列 **80**、表头左对齐 + 24×24 下拉、字号 14。门禁全绿（tsc / 1317 tests / 双端 build / cssLayers 基线 820→840）。**未做**：字号/内距/线色的灰阶令牌映射（留 B5），故暂用现有 `--lake-*` 令牌。
- **B2 表头与列菜单 —— 部分已做（260926）**：表头左对齐 + 24×24 下拉（B1）；列菜单已补「按本列分组」并按云端顺序重排（编辑/复制 ｜ 左/右插入 ｜ 按本列分组/按本列筛选 ｜ 升序/降序 ｜ 删除列）；点表头 = 选中整列（底栏「已选择 N 个单元格」）；筛选面板「打开即建一条规则」+「删除筛选」。**仍缺**：高亮重复值、文本颜色（归 B5）。
- **B3 记录详情 —— 已做（260926）**：Overlay 新增 kind="drawer"（无遮罩 / 不锁滚动 / 不锁焦点、Esc 关闭、右侧停靠且顶部对齐 --topbar-height，表格仍可交互）；BitableRecordDrawer 改用 Drawer；表单改云端 layout-lite（标签 168px 横向两列、标题 22px、抽屉宽 460）。
- **B4 单级分组 —— 已做（260926）**：BitableView.groups? + groupRecords()（组内保序/组间排序/空值组最后）+ 工具栏「分组」面板（选择列 + 升序/降序 + 取消）+ 组头「▾ 值 (计数)」折叠；单测 src/core/bitableGroup.test.ts。
- **B5 高亮重复值 + 文本颜色 —— 已做（260926）**：高亮重复值 = 视图级列开关（highlightDuplicateFieldIds）+ 重复值叠 --lake-status-pending-soft；文本颜色 = 列菜单「文本颜色」打开 8 色 + 清除调色板（复用选项调色板，未新增颜色令牌），视图级 columnTextColors 应用到该列文字。单测 bitableHighlight.test.ts。唯一未做：--lake-grid-* 灰阶令牌映射（当前用现有 --lake-* 近似）。
- **B6 撤销/重做 + 键盘导航 —— 已做（260926）**：新增 src/core/bitableHistory.ts（快照历史，单测 bitableHistory.test.ts），组件里 Cmd/Ctrl+Z 撤销、Shift+Cmd/Ctrl+Z 重做（只快照 doc.tables，不记导航态；上限 100）；网格 Tab/Shift+Tab 切单元格、Enter/Shift+Enter 上下移、Esc 退出编辑。TSV 多行多列块粘贴此前已实现（pasteSelection 按换行/制表符解析）。
- **B7 记录正文**（若用户复议；成本高）。

> 每批走门禁（`tsc` / `vitest` / 双端 build / `cssLayers` / `uiPrimitives`）并出云端对照截图。

---

## 6. 与既有决策的冲突需用户拍板

1. **记录详情是否改回"非模态右侧面板"**（更贴云端）——本会话刚改成模态 Dialog；精仿应改回。
2. **记录正文（每条一篇 Lake）**：云端有，用户 260919 否决；是否复议。
3. **颜色令牌**：为精仿需新增 `--lake-grid-*` 一组令牌（灰阶 9 级 + cyan 选区），需同意。
4. **列菜单 3 项 + 工具栏分组**是否纳入近期。

---

## 7. 证据（本会话）

- 云端 URL：<https://todoo.yuque.com/ex813k/stock/ls7d44lq2n5q0q2u>（Edge 实例 `54ead0c6`，已登录；走查后已 `browser_session stop`，未改云端数据）。
- 样式来源：`https://gw.alipayobjects.com/os/chair-script/skylark/lakex_table_yq.44e13a84.chunk.css`（283KB，实际 `lakex-viewer-grid-*` 规则）与页面内联 `--lt-*` 令牌。
- 截图 sha256（走查留档）：全页 `26e32204…`、行首 `6e9118d9…`、表格配置 `906af3d2…`、记录详情 `6ccb7a81…`、列菜单 `c51cf38a…`、字段弹窗 `e3438c9b…`。
- 未覆盖：新增视图菜单（6 类型）/筛选/排序/行高/搜索面板细节、单元格下拉与日期选择器、批量选择多行、统计菜单——下次续走查。

## 8. 实测验证（260926，真实 Electron 构建版 + CDP）

用隔离数据目录（LAKE_USER_DATA=/tmp/lake-verify-bit + LAKE_RENDERER=scheme，即构建产物 lake://app）起桌面实例，CDP 播一个多维表并实操：

- **行首语义（用户报的问题）**：点行号 -> selectedRows=1 且 drawer=false；再点第二行 -> selectedRows=2（可多选）、drawer=false；点勾选框 -> 取消该行；只有展开按钮 -> drawer=true。修复确认。
- **行首三件套**：2 行时 handle/expander/num 各 2。
- **记录详情非模态抽屉**：.ln-scrim--drawer 存在且 pointer-events:none（表格可交互）、body overflow 未锁、.bt-drawer-row 为 flex-direction:row（layout-lite）；Esc 关闭。
- **分组**：面板占位「选择一列进行分组」；选列后 groupRows=1，组头 (空)、计数 2。
- **列菜单**：实测 11 项且顺序与云端一致。
- **文本颜色**：调色板 19 色 + 「无颜色」；点选后单元格 style.color 生效。
- **高亮重复值**：两行文本同为 dup 后 2 格命中 .in-highlight，底色 rgb(247,240,227)。
- **撤销/重做**：加一条记录 2->3，Cmd+Z 后 3->2。

验证后已停实例、删除隔离数据与临时脚本；仓库无 .tmp-* 残留。

## 9. 追加精仿（260926 续，用户点名）

1. **单行详情可左右拖拽调宽**：抽屉左缘 .bt-drawer-resize（col-resize），宽度持久化 localStorage[lake-notes-v3.bitable-drawer-width]（320-1000，默认 460）。实测 460 -> 570 且落盘。
2. **图片和附件（对齐行为，外观用自有设计；按用户 GIF 重做）**：表格默认正常显示、**点一下**进编辑态；记录详情**常驻**编辑态。编辑框 = **独立「+」按钮**（选文件）+ **独立提示文案**「粘贴或拖拽至此」（点它/空白聚焦本区）+ 附件；整区是粘贴/拖拽目标；空态才显示提示，有附件时只「+」+ 附件；点外部收起（抽屉常驻不收起）；**不做预览/单元格工具**。**根因修复**：表格全局 Cmd/Ctrl+V 处理器（TSV 粘贴）原先对 Cmd+V 无条件 preventDefault，把原生 paste 挡掉 → 附件格 onPaste 永不触发；现「焦点在输入/可编辑区或附件格时不拦截」。**实测**：表格点一下→聚焦→真实剪贴板图片 Cmd+V 粘贴成功（chips 0→1）、未选中无 +/提示；抽屉 chips 1→2。
3. **表格配置面板字段拖拽排序**：面板按视图 fieldOrder 渲染全部字段（含隐藏），拖拽改视图 fieldOrder（视图级，不动全局 table.fields），网格列顺序跟随。实测「日期」拖到首位后，配置面板与网格表头同步变为 日期/文本/单选/图片和附件。
