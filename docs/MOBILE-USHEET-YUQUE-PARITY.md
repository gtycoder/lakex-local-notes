# 移动端表格（usheet）语雀 App 复刻规格（261020 取证）

> **状态：取证完成；261021 P1/P2 已在 `restart/univer-mobile-formula-bar` 落地。** 工具条 40/34×32、
> 公式栏 21、锚定卡片（插入 / 数字格式分类 / ⋯ 七行图标网格；未支持项置灰）、插行列/合并保留。
> **P3 已落地（261021）**：自绘底栏 32（工作表列表/页签/缩放）、阅读态 5 项轻工具条、隐藏 Univer 页签栏/footer/浮钮、
> 移动端新建表网格 24/120/40/24（旧文档不迁移）。阅读态 5 项按语雀版式保留但内核暂无对应动作 ⇒ 置灰；
> 网格主题色沿用现有令牌映射，未逐色对拍（P4 待做）。
> 现有 `MobileUsheetViewer` 的自绘工具条与语雀 App 差距大（用户 261020 明确要求精确复刻）。
> 本文把语雀 App 表格编辑界面**逐组件量到 CSS/几何层**，作为重做唯一依据。

## 0. 证据来源（一手）

- 设备：emulator-5554（412×842 CSS，DPR 2.625）；语雀安卓 **com.yuque.mobile.android.app 1.2.2**，
  实测文档「测试表格」`https://www.yuque.com/yuqueyonghutxhihv/ro9qct/pg2ex880s9laepwq`。
- 语雀表格是 WebView 里的 web 应用（`lake-sheet-*` 类名）；已接 CDP（9444）取 DOM / 计算样式 / canvas 像素。
- 组件 CSS 已整份导出：`/tmp/lake-sheet-inline.css`（语雀页面内联 style，53KB）；颜色令牌来自页面 `:root` 的 `--yq-*`。
- 我方对照：同设备 `com.locallakexnotes.mobile`（master@88fcb0f8）截图与 DOM。
- 本地证据留存（gitignore，不入库）：`.css-audit/usheet-parity-261020/`（语雀编辑态/阅读态/⋯ 面板截图、我方现状截图、组件 CSS 全文）。

**复现原则：表格页内的 chrome（工具条/公式栏/网格视觉/底栏/面板）精确复刻；应用外壳（我们的工作区顶栏、
底部 4 格胶囊、抽屉）不动** —— 那是本 App 的信息架构（AGENTS 移动端入口分工），不属于表格编辑样式。

## 1. 颜色令牌（语雀 `--yq-*`，浅色）

| 用途 | 令牌 | 值 |
| --- | --- | --- |
| 主文字 | `--yq-text-primary` | `#262626` |
| 正文/次级文字 | `--yq-text-body` | `#585a5a` |
| 说明/占位 | `--yq-text-caption` | `#8a8f8d` |
| 链接/页签选中 | `--yq-text-link` | `#117cee` |
| 面板底（工具条/底栏/卡片） | `--yq-bg-secondary` | `#fafafa` |
| 面板白 | `--yq-bg-primary` | `#ffffff` |
| hover 底 | `--yq-bg-tertiary` | `#f4f5f5` |
| 按下/激活底 | `--yq-bg-primary-hover-light` | `#e7e9e8` |
| 分隔/边框 | `--yq-border-primary` | `#e7e9e8` |
| 网格线 | canvas 实测 | `#e5e5e5` |
| 表头底 | `--yq-bg-tertiary` | `#f4f5f5` |
| 选中表头底（当前行列） | `--yq-yuque-grey-4` | `#e7e9e8` |
| 选区蓝（边框/手柄/编辑环） | `--yq-blue-5` | `#2f8ef4` |
| 选区填充 | canvas 实测 | `#eefbfb` |
| 品牌绿（+ 号/保存点） | `--yq-theme` | `#00b96b` |
| 深灰边（tooltip） | `--yq-yuque-grey-5` | `#d8dad9` |

> 落地：颜色字面量只允许出现在移动端 theme 层；新增表格语义令牌（`--mb-usheet-*`）并在注释写「对齐语雀 1.2.2 表格」。

## 2. 版式（自上而下）

| 区块 | 高度 | 关键值 |
| --- | --- | --- |
| 文档标题行（阅读态 `.m-doc-title`） | **44** | 属语雀文档页，非表格组件（我方由工作区顶栏承担，不复刻） |
| 编辑工具条 `.lake-sheet-toolbar` | **40**（content 39） | bg `#fafafa`；上下边框各 1px `#e7e9e8`（`border-width:1px 0`） |
| 公式栏 `.lake-sheet-formula-container` | **21** | 下边框 1px `#e7e9e8`；bg 白 |
| 网格 canvas `.lake-sheet-canvas-container` | 余量（top:60 / bottom:32） | bg 白 |
| 底栏 `.lake-sheet-footer` | **32** | bg `#fafafa`；上边框 1px `#e7e9e8` |

### 2.1 一级工具条（常驻行）

按钮 CSS 逐字（`.lake-sheet-button`）：`height:32; min-width:32; padding:0 7px; border:1px solid transparent;
border-radius:3px; font-size:14px; line-height:32px; color:#262626; background:transparent`；hover 底 `#f4f5f5`；
active/current 底 `#e7e9e8`；disabled `opacity:.25`；图标 18；图标+文字时文字 12（`.lake-sheet-button-inner-text`）。
区域 `.lake-sheet-toolbar-area{padding:4px 6px 3px;height:39px;border-left:1px solid #e7e9e8}`，首区无左边框。

| # | id | 宽×高 | 内容 | 行为 |
| --- | --- | --- | --- | --- |
| 1 | `toolbar-card` | 34×32 | 绿色实心圆 +（18，fill `#00b96b`） | 打开「插入卡」（2.4） |
| — | 分组 | | 区域间 1px `#e7e9e8` 左边框 | |
| 2 | `toolbar-save` | 34×32 | 保存图标 18；未保存时右上 6px 圆点（`--yq-theme`，top/right 6） | 手动保存 |
| 3 | `toolbar-undo` | 34×32 | undo 18（不可用 opacity .25） | 撤销 |
| 4 | `toolbar-redo` | 34×32 | redo 18（同上） | 重做 |
| 5 | `toolbar-formatPainter` | 34×32 | 格式刷 18 | 格式刷 |
| 6 | `toolbar-clearStyle` | 34×32 | 清除格式（橡皮）18 | 清格式 |
| — | 分组 | | | |
| 7 | `toolbar-datatypes` | **55**×32 | 当前格式文字（默认「常规」）+ ▾ 14 | 数字格式菜单（2.5） |
| 8 | `toolbar-decimal-inc` | 34×32 | 小数位 + 图标 18 | 增小数位 |
| — | 分组 | | | |
| 9 | `toolbar-more` | 34×32 | ⋯ 18；打开时底 `#e7e9e8` | 「更多」面板（2.3） |

### 2.2 公式栏

- 容器 h=**21**、下边框 1px `#e7e9e8`。
- 名称框 `.lake-sheet-formula-cell`：**w=40**、text-align:center、padding-left:8、font **12px**/lh 19。
- 值区 `.lake-sheet-formula-value`：absolute **left=64**、font **12px**、h=21、`white-space:pre`、overflow-y:auto、contenteditable。
- 编辑单元格覆盖层：`box-shadow:0 0 0 2px #2f8ef4`、margin 1px、min-height 21 ⇒ **选中/编辑格 = 2px 蓝环**。

### 2.3 「⋯ 更多」面板（二级，7 行）

锚定下拉卡（`.lake-sheet-button-set-list-hoz`）：实测 **x=161,y=87,206×275**，bg `#fafafa`、1px `#e7e9e8`、r**8**、
阴影 `0 2px 10px rgba(0,0,0,.12)`、z 400；内部按行（每行一个 `.lake-sheet-toolbar-area`，h39）：

| 行 | 内容（左→右，按钮宽） |
| --- | --- |
| 1 | 小数位−（34） |
| 2 | 字号「12px ▾」（58）· **B**(34) · **I**(34) · **S**(34) · **U**(34) |
| 3 | 字色（26）+ 色板▾（17）· 背景色（26）+ ▾（17）· 边框（26）+ ▾（17） |
| 4 | 水平对齐▾（48）· 垂直对齐▾（48）· 溢出/换行▾（48）· 合并（34） |
| 5 | 筛选（34）· 排序▾（48）· 条件格式▾（48） |
| 6 | 链接（32）· 选择（32）· 图表▾（44）· 公式▾（44） |
| 7 | 冻结▾（48）· 保护▾（48）· 查找替换（34） |

> 我方暂不支持的项（图表/条件格式/保护/查找替换…）**按语雀原样保留位置、置灰并给说明**，不删项破坏版式。

### 2.4 「+ 插入」下拉卡

实测 **x=26,y=87,216×324**；样式同 2.3 卡片；内 ant-menu 白底 padding 6；项高 35、标题 14 `#585a5a`、
左 18 图标、右 hotkey 12 `#8a8f8d`；hover 底 `#f4f5f5`；分隔线 1px `#e7e9e8`。

项（实测顺序）：**复选框 · 下拉列表** ｜**图片 · 链接（Ctrl+K）· 附件 · 备注 · 图表 · 公式**。
（这是「插入数据/内容」，**不是**插行插列；插行列在单元格/选区菜单。）

### 2.5 数字格式菜单（`toolbar-datatypes`）

锚定卡：实测 **x=233,y=87,136×304**，样式同 2.3。入口按钮显示当前格式（默认「常规」）+ ▾。
实测含分类子菜单 **货币 / 日期 / 时间 / 日期时间**；完整清单（自动/文本/数字/百分比/自定义…）Phase 2 逐项截图后回填。

### 2.6 底栏

从左到右：① 工作表列表按钮 32×32（图标 16）；② 工作表页签横滑：项高 32、font **12/500**、padding 0 16、
右侧 1px `#e7e9e8`；**选中文字 `#117cee`（不填底）**，名字后有下拉箭头；③ 右侧「视图/高亮」图标 16 + 缩放：
减号（24×25，font16，padding 3 4）+ 比例（**45 宽、font 14、lh24、r2**）+ 加号。

### 2.7 阅读态

- 工具条仅 5 项：`toolbar-overflow`（48，列表/视图+▾）、`toolbar-filter`（34）、`toolbar-sort`（48+▾）、
  `toolbar-frozen`（48+▾）、`toolbar-search`（34）。
- **无公式栏**；canvas `top:40`；底栏保留。
- 右下浮动胶囊（web 内）：两格各 **46×40**（x=311/357,y=631）：「目录」（列表图标+12px 文字）/「编辑」（铅笔+文字）；
  白底圆角胶囊+阴影（父容器样式 Phase 4 补）。

### 2.8 网格（canvas 像素实测 ÷ DPR 2.625）

| 项 | 值 |
| --- | --- |
| 行头宽 | **40**（device 102） |
| 列头高 | **24**（device 63） |
| 行高 | **24** |
| 列宽 | **120**（device 315 含线） |
| 网格线 | `#e5e5e5` 1px |
| 表头底 / 文字 | `#f4f5f5` / `#585a5a`（约 12px） |
| 当前列/行表头底 | `#e7e9e8` |
| 表头分界 | 约 `#c0c2c1`~`#d8dad9` 1px |
| 单元格文字 | `#262626` |
| 选区 | 填充 `#eefbfb`、边框 **2px** `#2f8ef4`、右下圆点手柄 `#2f8ef4`（约 8） |
| 滚动条 | 3px 圆角 `#d8dad9` |
| 冻结线 | 1px 深灰（`#d8dad9` 档） |

## 3. 图标映射（本项目只许 lucide，描边 1.75；+ 号例外：18px 自绘圆底 #00b96b）

| 功能 | 语雀 icon | lucide |
| --- | --- | --- |
| 插入 + | icon-add-to | CirclePlus（或自绘圆+加号） |
| 保存 | icon-save | Save / HardDriveDownload |
| 撤销/重做 | undo/redo | Undo2 / Redo2 |
| 格式刷 / 清格式 | paintformat / clean | Paintbrush / Eraser |
| 数字格式/字号 ▾ | 文本 + ▾ | ChevronDown 14 |
| 小数位 ± | decimal-inc/dec | 自绘 18（.0+±） |
| 更多 | new-ellipsis | MoreHorizontal |
| B/I/U/S | bold/italic/underline/strikethrough | Bold / Italic / Underline / Strikethrough |
| 字色/背景色 + ▾ | svgs / cell-bg-color | Baseline / PaintBucket + ChevronDown |
| 边框 + ▾ | border-all | Grid2x2 + ChevronDown |
| 水平/垂直对齐 + ▾ | left / middle | AlignLeft / AlignVerticalJustifyCenter + ChevronDown |
| 溢出/换行 + ▾ | overflow | WrapText |
| 合并 | table-merge-cell | Merge |
| 筛选 / 排序 + ▾ | filter / asc | Filter / ArrowUpDown + ChevronDown |
| 条件格式 + ▾ | conditionformat | Table2 |
| 链接 | field-link | Link2 |
| 公式 + ▾ | formula | Sigma + ChevronDown |
| 冻结 + ▾ | frozen-cell | Snowflake |
| 保护 + ▾ | protect | Lock |
| 查找替换 | searchreplace | Search |
| 工作表列表/页签▾ | sheet-list / sheet-arrow | List / ChevronDown |
| 缩放 −/+ | editor-hr / add | Minus / Plus |
| 视图/高亮 | highlight-area | LayoutGrid |
| 目录/编辑胶囊 | list / pencil | List / Pencil |

## 4. 行为/交互（实测）

1. 一级按钮**无文字**（仅「数字格式」「字号」= 文字+▾）；下拉全部是**锚在按钮附近的卡片**（不是底部 Sheet），
   点外部/再点按钮关闭；点主体=应用上次值，点 ▾=展开选择。
2. 保存 = 显式按钮 + 未保存绿点（保存后消失）。
3. 选区：单击选中；右下圆点拖拽扩选；当前行列表头变 `#e7e9e8`；单元格 2px 蓝框 + `#eefbfb` 填充。
4. 编辑单元格：双击/输入进入 → canvas 覆盖 textarea（2px 蓝环），公式栏同步地址+内容。
5. 底栏页签横滑；≡ 打开工作表列表；缩放 ±（步进 Phase 4 量）。
6. 阅读态：无公式栏、5 项工具条、右下「目录/编辑」胶囊；点编辑进入编辑态。

## 5. 我方现状 vs 语雀（差距清单）

| 面 | 语雀 | 我方现状 | 结论 |
| --- | --- | --- | --- |
| 工具条 | 40 / #fafafa / 上下 1px #e7e9e8 | 44 / 白 / 仅下边框 | 重做 |
| 一级项 | +｜保存·撤销·重做·格式刷·清格式｜常规▾·小数位｜⋯ | +▾ ↶ ↷ ｜ B I U S T▾ ⋯ ● | 项/顺序/分组全错 |
| 二级面板 | ⋯ 七行图标面板（B/I/U/S、字号、颜色、边框、对齐、合并、筛选排序、公式、冻结…） | 无 | 新建 |
| + 插入卡 | 8 项「插入数据」 | 我们的 + 是插入行/列/合并 | 语义不同，按语雀重做 |
| 数字格式 | 「常规▾」文字按钮 + 分类菜单 | 自绘「数字格式」九档挂在 ⋯ 里 | 入口/样式改语雀形态 |
| 公式栏 | 21 / 名框 40 / 值区 64 / 12px / 下边框 | 约 27 / 名框约 77 / 14px / 无 | 重做 |
| 网格 | 行24·列120·行头40·列头24；表头 #f4f5f5/当前 #e7e9e8；线 #e5e5e5；选区 #eefbfb+2px #2f8ef4 | 列宽 88；当前列仅细蓝线；选区白底细框；行头/列头 46/20 | 改主题/默认属性 + 覆盖 |
| 底栏 | 32 / #fafafa / 页签 12/500 选中 #117cee / 视图 / 缩放 | Univer Workbench footer（另一套） | 自绘替换 |
| 阅读态 | 5 项工具条 + 无公式栏 + 浮动胶囊 | 工具条整条隐藏 | 新增 |
| 未保存指示 | 保存按钮右上绿点 | 工具条最右绿点（自造） | 改 |
| 顶栏/底胶囊 | 语雀 RN 顶栏+会话栏 | 我方工作区顶栏+4 格胶囊 | 不改（外壳） |

## 6. 复现方案（文件级）

> 路线：**自绘 chrome + Univer 作渲染内核**（Univer 只管 canvas 网格/选区/编辑/公式；工具条/公式栏/底栏/面板全部替换）。
> 不改 vendor、不给 Univer 打新补丁。

1. **隐藏 Univer 自带 UI**：移动 preset 关闭 toolbar（已关）+ 关闭/隐藏内置 formula-bar、workbench footer、浮动按钮。
2. **新增 `src/mobile/usheet/` UI 层**：
   - `usheetChromeModel.ts`：**单一来源**（一级按钮、⋯ 七行、数字格式分类、字号档、插入卡项、图标映射、禁用判据），纯数据+单测。
   - `UsheetToolbar.tsx` / `UsheetMorePanel.tsx` / `UsheetInsertCard.tsx` / `UsheetDataTypesMenu.tsx` / 二级选择器组件
     （字号/颜色/边框/对齐/公式/冻结…）。
   - `UsheetFormulaBar.tsx`（21/40/64/12，复用现有 cellInfo 同步）。
   - `UsheetFooter.tsx`（≡+页签横滑+视图+缩放，数据来自 facade）。
   - `UsheetReadingBar.tsx`（P4：5 项 + 目录/编辑胶囊）。
3. **样式**：新增 `src/mobile/usheet/usheet-chrome.css`（登记 `mobileLayers.test.ts` FILES/BASELINE）；
   令牌进 `src/mobile/theme/tokens.css`（`--mb-usheet-*`，注释对齐语雀 1.2.2）；浮层用移动端原语，禁止手写 createPortal。
4. **网格视觉**：`buildUniverTheme()` 调表头/网格线/选区/文字色；`emptyUsheetBody()` 新表默认
   `defaultColumnWidth:120 / rowHeader.width:40 / columnHeader.height:24 / defaultRowHeight:24`
   （旧文档不迁移，渲染尊重文档自带尺寸 —— AGENTS #7）。
5. **图标**：lucide 1.75/18px（§3 对照表）。
6. **护栏/验收**：chrome 模型单测 + SSR 结构测试；设备几何探针（40/21/32/24/120/40/24/选区色）；
   与语雀同状态同宽截图并排对拍；既有能力（冻结/行高列宽/数字格式/常用公式/新建/保存）回归；
   `check:mobilesnap` 按 §3#21 定点/重烤。
7. **分阶段**：
   - **P1** 一级骨架（工具条40 + 公式栏21 + 底栏32 + 网格主题/默认尺寸 + 隐藏 Univer UI）
   - **P2** ⋯ 七行面板 + 数字格式菜单 + 插入卡（不支持的项置灰带说明）
   - **P3** 二级选择器（字号/颜色板/边框/对齐/公式/冻结；颜色板按 `lake-colorboard` 取证）
   - **P4** 阅读态工具条 + 目录/编辑胶囊 + 保存态/tooltip + 暗色取证
   - **P5** 交互打磨与全量设备对拍

## 7. 待用户拍板 / 待补取证

1. **外壳**：保持现有工作区顶栏 + 底部 4 格胶囊（默认），还是连语雀的文档标题行/会话底栏也仿？
2. **专有项**（复选框/下拉/附件/备注/图表/条件格式/保护/查找替换）：保留位置置灰+说明（默认），还是先隐藏？
3. **图标**：lucide 近似（默认，许可干净），还是复用语雀 SVG 资源（需确认版权红线）？
4. **待补取证（实施时逐项回填）**：数字格式完整分类、字号档位、颜色板 `lake-colorboard`、边框面板、
   对齐/垂直/溢出菜单、公式菜单、冻结菜单、插入卡 hover/激活态、工作表列表、缩放步进、暗色令牌、tooltip 文案。
