/**
 * 表格 Univer 实例的**单一创建入口**（261022）：编辑器与"隐藏预热画布"共用同一份配置，
 * 避免两边 preset / locale / 主题漂移（漂移的症状是预热实例和真实例行为不一致，且很难查）。
 *
 * 为什么拆出来：预热画布需要在用户点开表格之前就把 Univer 实例建好，之后再"搬"进真实宿主；
 * 两边必须完全同一套 presets（core/drawing/sort+filter/find-replace + 同一份 zh-CN locale）。
 */
import { createUniver, LocaleType, mergeLocales, type FUniver } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import drawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import sortZhCN from "@univerjs/sheets-sort-ui/locale/zh-CN";
import findZhCN from "@univerjs/preset-sheets-find-replace/locales/zh-CN";
import filterZhCN from "@univerjs/sheets-filter-ui/locale/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/sheets-sort-ui/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import { UniverSheetsHyperLinkPreset } from "@univerjs/preset-sheets-hyper-link";
import hyperLinkZhCN from "@univerjs/preset-sheets-hyper-link/locales/zh-CN";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import noteZhCN from "@univerjs/preset-sheets-note/locales/zh-CN";
import "@univerjs/preset-sheets-note/lib/index.css";
import { UniverSheetsCrosshairHighlightPlugin } from "@univerjs/sheets-crosshair-highlight";
import { CROSSHAIR_LOCALE_ZH } from "./usheetCrosshair";
import crosshairZhCN from "@univerjs/sheets-crosshair-highlight/locale/zh-CN";
import "@univerjs/sheets-crosshair-highlight/lib/index.css";
import "@univerjs/sheets-filter-ui/lib/index.css";
import { createDesktopSortFilterPlugins } from "./univerSortFilter";
import { buildUniverTheme } from "./univerTheme";
import { USHEET_FOOTER_CONFIG } from "./usheetKernelContract";
import { lakeFontFamily } from "./usheetFont";

export type UsheetUniverCore = ReturnType<typeof createUniver>["univer"];

export interface CreateUsheetUniverOptions {
  /** 内核挂载容器的元素 id（必须已存在或由内核按 id 创建）。 */
  container: string;
  /** 是否挂工具栏 + 公式栏（历史快照预览传 false）。 */
  toolbar: boolean;
  formulaBar: boolean;
}

/** 创建一个 usheet Univer 实例（不含 workbook；调用方随后 createWorkbook）。 */
export function createUsheetUniver({ container, toolbar, formulaBar }: CreateUsheetUniverOptions): { univer: UsheetUniverCore; univerAPI: FUniver } {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(zhCN as never, drawingZhCN as never, sortZhCN as never, filterZhCN as never, findZhCN as never, hyperLinkZhCN as never, noteZhCN as never, crosshairZhCN as never, CROSSHAIR_LOCALE_ZH as never),
    },
    theme: buildUniverTheme() as never,
    presets: [
      UniverSheetsCorePreset({
        container,
        toolbar,
        formulaBar,
        // 字体策略（非工具栏工程）：字体表收窄成唯一一项 = 应用字体令牌 MiSans。
        customFontFamily: { override: true, list: [{ value: lakeFontFamily(), label: "MiSans" }] },
        // 工作表标签「＋」新建的工作表默认 50 行 × 16 列（用户 261010）。内核默认是 1000×20，
        // 只有这个入口能配（footer.addSheetButtonConfig），所以显式给全 footer 的四个开关避免覆盖掉默认值。
        // ⚠️ 两处口径必须一致：空表在 src/core/usheetDoc.ts 的 emptyUsheetWorkbook（同一组 50×16）。
        footer: USHEET_FOOTER_CONFIG,
      }),
      UniverSheetsDrawingPreset(),
      // 261021 P5：排序 / 筛选（Univer 独立可选包，不在 preset-sheets-core 里）。
      { plugins: createDesktopSortFilterPlugins() },
      // 261021 P5：查找替换（sheets 适配器 + 基础层；preset 包已把两者组合好）。
      UniverSheetsFindReplacePreset(),
      // 261022 P1：超链接（urlHandler → window.open；主进程 setWindowOpenHandler 转系统浏览器）。
      UniverSheetsHyperLinkPreset({ urlHandler: { navigateToOtherWebsite: (url) => { window.open(url, "_blank", "noopener"); } } }),
      // 261022 P1：单元格备注 / 批注（桌面 UI；移动端暂无移动版 UI，不装）。
      UniverSheetsNotePreset(),
      // 261022：十字高亮（行列高亮）—— 默认关闭由内核决定，编辑器在 createWorkbook 后统一开启。
      { plugins: [UniverSheetsCrosshairHighlightPlugin] },
    ],
  });
  return { univer, univerAPI };
}
