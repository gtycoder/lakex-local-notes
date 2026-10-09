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
] as const;

/** 依赖的内核配置键 / 字段（工作表标签「＋」的默认尺寸只在这里可配）。 */
export const UNIVER_CONFIG_KEYS = ["sheets-ui.config", "addSheetButtonConfig", "defaultRowCount", "defaultColumnCount"] as const;

/** 依赖的内核函数/概念名（用于升级时确认整条机制还在）。 */
export const UNIVER_FEATURE_NAMES = [
  /** 剪贴板图片钩子：无条件返回浮动图命令；且 sheets-ui 的 _executePaste 是"所有钩子 mutations 串起来执行" ⇒ 只能在 DOM 层拦。 */
  "onPasteFiles",
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
