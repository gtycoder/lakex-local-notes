/**
 * Univer「排序 / 筛选」插件接线（261021 P5）——**移动端**。
 *
 * 与桌面共用数据插件，UI 取 **移动变体**：
 * `UniverSheetsSortMobileUIPlugin` / `UniverSheetsFilterMobileUIPlugin`（1.0.3 实装已核对，
 * 它们 `DependentOn(UniverSheetsMobileUIPlugin, UniverMobileUIPlugin)` —— 正好是
 * `mobileUniverPreset.ts` 给移动端装的那套 UI 插件族，不会象桌面 UI 变体那样因依赖缺失而启动失败）。
 *
 * 入口是**我们自己画的**（⋯ 卡「排序 / 筛选」），不依赖内核在移动端渲染工具栏；
 * 排序直接派发命令、筛选走 `smart-toggle-filter`（内核自己弹它的移动筛选面板）。
 */
import type { IPresetPlugin } from "@univerjs/presets";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsFilterMobileUIPlugin } from "@univerjs/sheets-filter-ui";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsSortMobileUIPlugin } from "@univerjs/sheets-sort-ui";

/** 移动端：数据插件 + 移动 UI 变体（不装桌面 UI 变体：依赖桌面 UI 插件族，装上会启动失败）。 */
export function createMobileSortFilterPlugins(): IPresetPlugin[] {
  return [
    [UniverSheetsSortPlugin],
    [UniverSheetsSortMobileUIPlugin],
    [UniverSheetsFilterPlugin],
    [UniverSheetsFilterMobileUIPlugin],
  ] as unknown as IPresetPlugin[];
}
