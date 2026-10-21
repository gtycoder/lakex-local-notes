/**
 * Univer「排序 / 筛选」插件接线（261021 P5）——**桌面端**（官方桌面 UI 变体）。
 *
 * 为什么现在才接：这两个能力在 Univer 里是**独立可选包**（`@univerjs/sheets-sort(-ui)` /
 * `@univerjs/sheets-filter(-ui)`），不在 `preset-sheets-core` 里 —— 所以 261020 之前两端都**没有**
 * 这个能力（不是"桌面有、移动没有"）。本轮按 `docs/USHEET-UPGRADE.md` playbook 新增，四个包全 1.0.3。
 *
 * 两端分工（**单一来源**）：
 * - 数据插件（`UniverSheetsSortPlugin` / `UniverSheetsFilterPlugin`）**两端都装** —— 否则一端保存了
 *   筛选条件、另一端打开会按"未筛选"处理，同一篇文档两端看到不同的行。
 * - UI 插件按平台取变体：桌面 = `UniverSheetsSortUIPlugin` / `UniverSheetsFilterUIPlugin`
 *   （ribbon 工具栏 + 列头下拉 + 右键菜单）；移动端见 `src/mobile/usheet/mobileSortFilter.ts`。
 *
 * 本模块只声明插件清单，不改任何内核行为；命令/菜单/钩子登记见 `usheetKernelContract.ts`。
 */
import type { IPresetPlugin } from "@univerjs/presets";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsFilterUIPlugin } from "@univerjs/sheets-filter-ui";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsSortUIPlugin } from "@univerjs/sheets-sort-ui";

/** 桌面端：数据插件 + 桌面 UI 插件（菜单进 ribbon 工具栏 / 列头 / 右键）。 */
export function createDesktopSortFilterPlugins(): IPresetPlugin[] {
  return [
    [UniverSheetsSortPlugin],
    [UniverSheetsSortUIPlugin],
    [UniverSheetsFilterPlugin],
    [UniverSheetsFilterUIPlugin],
  ] as unknown as IPresetPlugin[];
}
