/**
 * Univer（表格内核）**触点契约** —— 我们依赖的所有内核符号、配置键、DOM 钩子集中在这里。
 *
 * 为什么单独一个文件：这些字符串是**升级时最容易静默失效**的东西（内核改了菜单 id / 配置键 /
 * 命令 id，我们这边不会报错，只会"功能悄悄没了"）。集中一处 + `univerContract.test.ts` 在
 * `npm test` 时对着 **node_modules 里实装的内核产物**逐个核对，升级就能在本地立刻发现漂移。
 * 升级流程与路线见 `docs/USHEET-UPGRADE.md`。
 *
 * ⚠️ 这里的字符串**必须与实装内核一致**，不能"看着像"就改；每个条目后面注明了它被谁用、失效会怎样。
 */
import { USHEET_DEFAULT_COLUMNS, USHEET_DEFAULT_ROWS } from "../../core/usheetDoc.js";

/** 我们注册/覆盖的命令 id。 */
export const UNIVER_COMMAND_IDS = {
  /** 内核「插入浮动图片」；**图片粘贴钩子无条件返回这条命令** ⇒ 我们在 DOM 层拦纯图片粘贴（见 usheetImagePaste.ts）。 */
  insertFloatImage: "sheet.command.insert-float-image",
  /** 内核「插入单元格图片」（无参版本会开文件选择器）⇒ 我们重映射到自己的 usheet.insert-cell-image。 */
  insertCellImage: "sheet.command.insert-cell-image",
  /** 工作表标签「＋」插入工作表；footer 配置只影响这个入口。 */
  insertSheet: "sheet.command.insert-sheet",
  /** 我们自己注册的命令（不是内核的）。 */
  ourInsertFloatImage: "usheet.insert-float-image",
  ourInsertCellImage: "usheet.insert-cell-image",
  /** 排序（261021 P5，`@univerjs/sheets-sort-ui`）：**无参**，排的是**当前选区**；`-ext` = 扩展到整块数据区。
   *  失效表现 = 移动端 ⋯ 卡「升序/降序」点了没反应，或只排了选中那一格。 */
  sortRangeAsc: "sheet.command.sort-range-asc",
  sortRangeDesc: "sheet.command.sort-range-desc",
  sortRangeCustom: "sheet.command.sort-range-custom",
  /** 筛选（261021 P5，`@univerjs/sheets-filter`）：smart-toggle = 按当前选区建/撤筛选范围并开面板；
   *  criteria 写入 worksheet 快照（filterModel）⇒ 这是**文档数据**，两端必须同版本。 */
  /** 查找替换（261021 P5）：open 是 **operation**；移动端用它打开官方 mobile bar。
   *  失效表现 = ⋯ 卡「查找替换」/读态「查找」点了没反应。 */
  openFindDialog: "ui.operation.open-find-dialog",
  openReplaceDialog: "ui.operation.open-replace-dialog",
  closeFindDialog: "ui.operation.close-find-dialog",
  /** sheets 适配器的「替换一格」（替换会写 cellData；桌面 Ctrl+H 与移动共用）。 */
  sheetReplace: "sheet.command.replace",
  smartToggleFilter: "sheet.command.smart-toggle-filter",
  /** 261022 P1：超链接（insert-hyper-link = 对当前单元格开编辑弹层；toolbar 变体是开关型）。
   *  失效表现 = 桌面「插入 → 链接」/移动端 ⋯「链接」点了没反应。 */
  insertHyperLink: "sheet.operation.insert-hyper-link",
  insertHyperLinkToolbar: "sheet.operation.insert-hyper-link-toolbar",
  /** 261022：十字高亮（纯视图 operation，不写正文）。失效表现 = 默认不亮、移动端 ⋯「十字高亮」无效。 */
  crosshairEnable: "sheet.operation.enable-crosshair-highlight",
  crosshairDisable: "sheet.operation.disable-crosshair-highlight",
  crosshairToggle: "sheet.operation.toggle-crosshair-highlight",
  /** 261022 P1：单元格备注（桌面右键/插入；移动端暂无 UI）。 */
  noteTogglePopup: "sheet.command.toggle-note-popup",
  setFilterCriteria: "sheet.command.set-filter-criteria",
  removeSheetFilter: "sheet.command.remove-sheet-filter",
} as const;

/** 单元格右键菜单：菜单位置 → 分组 →「插入」子菜单（facade 的 appendTo 逐段 merge，元素是**单个 key**，
 *  写成点号拼接的整串会挂到错误层级）。注意是可变数组：facade 的签名是 `string | string[]`。 */
export const UNIVER_CONTEXT_MENU_INSERT_PATH: string[] = ["contextMenu.mainArea", "contextMenu.layout", "sheet.menu.cell-insert"];

/** 我们通过 updateMenuConfig 隐藏/重映射的菜单项（⚠️ 只列该位置专属的 id，见 USHEET_HIDDEN_TOOLBAR_ITEMS 注释）。 */
export const UNIVER_MENU_ITEM_IDS = [
  "sheet.menu.paste",
  "sheet.command.set-range-font-family",
  "sheet.command.numfmt.set.percent",
  "sheet.command.numfmt.set.currency",
  "base-ui.operation.toggle-shortcut-panel",
  /** 261022：十字高亮的移动端菜单项（我们不渲染内核 toolbar，但插件仍会 merge；用作契约存在性）。 */
  "sheet.menu.mobile.crosshair-highlight",
] as const;

/** 依赖的内核配置键 / 字段（工作表标签「＋」的默认尺寸只在这里可配）。 */
export const UNIVER_CONFIG_KEYS = ["sheets-ui.config", "addSheetButtonConfig", "defaultRowCount", "defaultColumnCount", "sheets-crosshair-highlight.config"] as const;

/** 依赖的内核函数/概念名（用于升级时确认整条机制还在）。 */
export const UNIVER_FEATURE_NAMES = [
  /** 剪贴板图片钩子：无条件返回浮动图命令；且 sheets-ui 的 _executePaste 是"所有钩子 mutations 串起来执行" ⇒ 只能在 DOM 层拦。 */
  "onPasteFiles",
  /** 撤销栈计数（IUndoRedoService.getUndoRedoStatus；令牌从 @univerjs/presets 转发拿，不直连 core 包）：
   *  移动端 dock 的撤销/重做置灰靠它（facade 只有 undo()/redo()，没有可用态查询）。
   *  失效表现 = 两枚按钮退回常亮（不报错、不锁死，见 MobileUsheetViewer.refreshHistory 的兜底）。 */
  "getUndoRedoStatus",
  /** 双击落光标：原生 dblclick 后轮询 isCellEditing，等编辑器画布就绪，再走文档渲染单元的
   *  DocSelectionRenderService.setCursorManually()（Univer facade 未暴露点击落点）。
   *  失效表现 = 双击仍全选单元格内容，或光标不跟随点击位置。 */
  "setCursorManually",
  "DocSelectionRenderService",
  "DOCS_NORMAL_EDITOR_UNIT_ID_KEY",
  /** 移动公式栏（261021）：点按底部公式栏后按坐标落光标 —— 公式栏编辑器 unit + render unit 查询。 */
  "DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY",
  "IRenderManagerService",
  "getRenderUnitById",
  /** 等待编辑态建立；编辑器内部双击选词由画布 id 区分，不靠这个判据。 */
  "isCellEditing",
  /** 排序服务（261021 P5）：**命令无参**，排序对象 = 当前选区；所以 ⋯ 卡入口必须先有选区，
   *  失败返回 false（我们据此 toast，不静默）。失效表现 = 排序按钮恒提示「当前选区不能排序」。 */
  "SheetsSortUIService",
  /** 筛选服务（261021 P5）：筛选条件落在 worksheet 快照里（`SHEET_FILTER_SNAPSHOT_ID`）；
   *  失效表现 = 筛选结果不随文档保存/跨端同步。 */
  "SheetsFilterService",
  "SHEET_FILTER_SNAPSHOT_ID",
  /** 查找替换（261021 P5）：基础层 = find-replace（`@univerjs/find-replace`），
   *  表格适配 = sheets-find-replace（`SheetsFindReplaceController` / `SheetReplaceCommand`）。
   *  失效表现 = 查找面板能开但搜不到单元格 / 替换不生效。 */
  "FindReplaceService",
  "IFindReplaceService",
  "SheetsFindReplaceController",
  /** 默认字号机制（用户 261119）：工作表级 `defaultStyle` 是**实际被消费**的渲染底
   *  （Worksheet.getDefaultCellStyleInternal → getComposedCellStyle 底层；我们由
   *  normalizeUsheetWorkbook 统一写 USHEET_DEFAULT_FONT_SIZE=11）。
   *  失效表现 = 升级后未设式样单元格的字号不再由正文 defaultStyle 决定，回到内核兜底/漂移值。 */
  "getDefaultCellStyleInternal",
  /** 内核兜底默认样式常量（DEFAULT_STYLES.fs；1.0.3 = 11，恰好同值）。
   *  **不是我们的落点**（内核内部常量、升级可漂移），只作升级漂移哨兵；
   *  失效表现 = 升级后 usheetDefaults.test 的漂移哨兵报红，提醒复核默认字号链路。 */
  "DEFAULT_STYLES",
  /** 表格粘贴（261122 现场）：Univer 的 ⌘V 是 keydown 快捷键，自己读剪贴板、用 Excel 风格解析外部 HTML
   *  （Lake/语雀表格卡只剩左上角一格）且**不派发 paste 事件** ⇒ 宿主只能在 keydown 里做「纠正式覆盖」：
   *  **不拦**（拦了内部复制/图片/纯文本全废），读出外部表格（无 data-copy-id）后用矩阵写回。
   *  失效表现 = 从文档表格卡粘贴只落一格。 */
  "sheet.command.paste",
  /** 表格剪贴板（261121 现场）：Univer 1.0.3 的**外部** HTML 粘贴走它自己的 Excel 风格解析器（HtmlToUSMService），
   *  Lake/语雀表格卡的 HTML（`<table class="ne-table">` + 单元格内嵌 div）只解析出左上角一格；
   *  我们自己的复制带 `data-copy-id`（内部走 copyContentCache，保样式/合并）。
   *  ⇒ 宿主在 window 捕获阶段接管「外部表格 / 多行 TSV」并用 facade `setValues` 写入
   *  （src/features/usheet/usheetClipboardTable.ts）；**内部复制不接管**。
   *  失效表现 = 从文档表格卡复制再粘进表格只剩一格。升级后先跑 usheetClipboardTable.test + 手工复验。 */
  "HtmlToUSMService",
  /** 自动行高字段（261121）：工作表快照 `rowData[row].ia = 1`（SetWorksheetRowIsAutoHeightMutation 的字段），
   *  行高随后按换行内容自动撑开；`rowData[row].h` 是手动高度（我们不改已有 h 的行）。
   *  失效表现 = 长文本只换行、行高不变（或被裁掉）。 */
  "SetWorksheetRowIsAutoHeightMutation",
  /** 自动行高**渲染缓存**（261123）：内核 getRowHeight 对 ia 行取 `rowData[row].ah`（缺 ah 掉回 h/默认 24）；
   *  `ah` 由 SetWorksheetRowAutoHeightMutation 写回（AutoHeightService 重算结果），随正文持久化。
   *  失效表现 = 重开表格换行文字的行掉回 24px（行高乱）。 */
  "SetWorksheetRowAutoHeightMutation",
  /** 打开期行高自愈的触发点（261123，`sheet.operation.mark-dirty-row-auto-height`）：内核**打开时不重算**，
   *  打开后发该 Operation 让 AutoHeightService 按当前列宽/字号重算（不推 undo 栈）。
   *  失效表现 = 旧正文（缺 ah / 缓存过期）重开行高仍乱。 */
  "MarkDirtyRowAutoHeightOperation",
] as const;

/** 「开始」页签里我们**不用**的内核工具项（走公开 MenuManager 的 updateMenuConfig({hidden:true}) 隐藏）。
 *  ⚠️ 只列**该位置专属**的 id：实测这 5 个只挂在 ribbon.start；反例 `sheet.command.paste` 同时挂在右键菜单上，
 *  隐藏会连带干掉右键粘贴 ⇒ 粘贴只藏 `sheet.menu.paste`。 */
export const USHEET_HIDDEN_TOOLBAR_ITEMS: Record<string, unknown> = {
  "sheet.command.set-range-font-family": { hidden: true },     // 字体：统一走 --lake-font-family，禁自定义
  "sheet.menu.paste": { hidden: true },                        // 粘贴（右键菜单另有一套 sheet.command.paste）
  "sheet.command.numfmt.set.percent": { hidden: true },        // 百分比
  "sheet.command.numfmt.set.currency": { hidden: true },       // 货币
  "base-ui.operation.toggle-shortcut-panel": { hidden: true }, // 快捷键面板
};

/** 依赖的 DOM 钩子（内核 data-u-comp 名）；失效会表现为：量不到几何（状态栏/收起按钮错位）或样式覆盖失效。 */
export const UNIVER_DOM_HOOKS = [
  "ribbon-toolbar",        // 「收起/展开」按钮定位 + 右侧槽位 padding 覆盖
  "ribbon-header-menu",    // 收起时藏掉页签行
  "slide-tab-bar",         // 计算条：状态栏让位实测 + 高度压缩选择器
  "render-canvas",         // 探针脚本里定位网格画布
  "defined-name",          // 探针脚本里判断"网格就绪"
  "sheet-bar-append-button", // 探针脚本里点「＋」
  "sort-panel-item-handler", // 排序面板（261021 P5）：探针判定"排序面板已弹出/已收起"
  "sheets-filter-panel", // 桌面筛选面板（261021 P5）：探针判定面板容器 + 几何
  "mobile-sheets-filter-drawer", // 移动端筛选抽屉（261021 P5 设备实测）：筛选/按值/按颜色/按条件/清除筛选
  "mobile-find-replace-bar", // 移动端查找条（261021 P5 设备验收靠它判定"查找面板打开了"）
  "mobile-find-replace-settings", // 移动端查找设置（区分大小写/按公式等）
  "find-replace-dialog", // 桌面查找对话框（Ctrl/Cmd+F）
  "mobile-sheets-filter-by-values", // 移动端筛选抽屉内的「按值」页签
  "mobile-sheets-filter-by-conditions", // 移动端筛选抽屉内的「按条件」页签
] as const;

/**
 * 工作表标签「＋」新建工作表的默认尺寸（内核默认 1000×20；只有 preset 的 footer 能改）。
 * ⚠️ 显式给全 footer 的四个开关：只给 addSheetButtonConfig 会把 sheetBar/统计条/菜单/缩放顶掉。
 */
export const USHEET_FOOTER_CONFIG = {
  sheetBar: true,
  statisticBar: true,
  menus: true,
  zoomSlider: true,
  addSheetButtonConfig: {
    show: true,
    defaultRowCount: USHEET_DEFAULT_ROWS,
    defaultColumnCount: USHEET_DEFAULT_COLUMNS,
  },
} as const;

/**
 * 表格**默认字号 = 11**（Excel 口径 11pt，用户 261119）：新建/工作表「＋」的未设式样单元格与
 * 默认样式按 11 号渲染；旧文档已有显式 `fs` 的单元格零变化（只改默认，不改存量显式值）。
 *
 * **值的单一来源** = `src/core/usheetDoc.ts` 的 `USHEET_DEFAULT_FONT_SIZE`（本文件只登记内核侧决定点）：
 * - **渲染底（真正落点）** = 每张工作表的 `defaultStyle.fs`（`IWorksheetData.defaultStyle`，
 *   消费处 `Worksheet.getDefaultCellStyleInternal` → `getComposedCellStyle` 底层）——
 *   Univer 1.0.3 实测**只有工作表级 defaultStyle 被内核消费**；workbook 级 `defaultStyle`
 *   （`IWorkbookData.defaultStyle`）只是类型面（随快照往返、不参与渲染），两者都由
 *   `normalizeUsheetWorkbook` 统一写 11 ⇒ 桌面 UniverSheetEditor / 移动 MobileUsheetViewer 同一落点。
 * - **内核兜底** `DEFAULT_STYLES.fs`（`@univerjs/core` 常量）1.0.3 恰好也是 11，但升级可漂移
 *   ⇒ 不作为落点，只由 univerContract / usheetDefaults 的哨兵盯住。
 *
 * 失效表现：未设式样单元格字号不再是 11（新表/旧文档空白格一起漂）；工具栏字号框与移动端
 * 「字号步进」的取值同源漂移。升级时若 `getDefaultCellStyleInternal` / defaultStyle 消费链变了，
 * 这里是第一核对点。
 */

/**
 * 我们对内核打的补丁（`patches/@univerjs+ui+1.6.1.patch`；261127 升级时按 1.6.1 重新生成，语义不变）——**改行为的最小改动**，不是依赖侧清理。
 *
 * 历史（261009）：内核把 floating 层的 portal 容器**无条件挂到 `document.body`**，该容器承载
 * `CanvasPopup`（cell popup、**CellAlert 黄叹号**、下拉/日期/颜色/选区浮层）。当时为了不让黄叹号
 * 逃出标签宿主，我们把容器改挂到实例自己的 mountContainer。
 *
 * 261022 翻案（用户报「排序弹窗点不动、整个 app 卡死」）：容器挂进实例宿主后，**设计系统 Dialog
 * 也被 portal 进宿主**，`overflow:hidden` 宿主 + fixed 遮罩让「自定义排序」进入 measure/reflow
 * 死循环（渲染进程 100%+ CPU ⇒ 整窗点不动）。因此改为：**容器仍挂 `document.body`**
 * （= 内核原始行为，对话框/菜单不再死循环），再用两条守住 261009：
 *  ① 补丁给容器打 `data-lake-univer-floating` + `data-lake-owner="univer-sheet-<noteId>"`；
 *  ② 应用侧 `MultiTabEditor` 按**当前可见标签**把其它实例的容器 `display:none`
 *     （新容器由 MutationObserver 兜底）。卸载仍用 `remove()`（不假定父节点是 body）。
 *
 * 失效表现：① 产物里重新出现 `mountContainer.appendChild(portalContainer)` ⇒ 对话框死循环回归；
 * ② 产物里没有 `data-lake-owner` / 应用侧没按 owner 收起 ⇒ 261009 的黄叹号逃逸回归。
 * 守它的两处：`univerContract.test.ts`（静态）与 `scripts/usheet-kernel-probes.mjs`（运行时）。
 * 升级动作见 `docs/USHEET-UPGRADE.md` §4.7。
 */
export const UNIVER_PATCH_HOOKS = {
  /** 补丁文件（仓库内的唯一 Univer 补丁；缺它 = 换机/CI 拿不到修复）。 */
  patchFile: "patches/@univerjs+ui+1.6.1.patch",
  /** 补丁后**必须存在**：容器挂 body（= 内核原行为；挂宿主会让对话框死循环）。 */
  mountedAtBody: "document.body.appendChild(portalContainer)",
  /** 补丁后**必须存在**：容器带 owner 标记，应用侧据此按可见标签收起。 */
  floatingOwner: "data-lake-owner",
  /** 补丁后**必须存在**：卸载用 remove()，不假定父节点是 body。 */
  removedSafely: "portalContainer.remove()",
  /** 补丁加的运行时标记（探针靠它定位容器）。 */
  floatingMarker: "data-lake-univer-floating",
  /** 已废弃的宿主挂载写法：**必须不存在**，否则 261022 的对话框死循环回归。 */
  legacyHostMount: "mountContainer.appendChild(portalContainer)",
  /** 应用侧收起浮层的落点（静态护栏：这段代码必须还在）。 */
  visibilitySyncFile: "src/features/editor/MultiTabEditor.tsx",
} as const;