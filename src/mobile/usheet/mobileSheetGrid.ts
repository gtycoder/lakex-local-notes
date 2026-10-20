/**
 * 移动端新建表格的**网格默认**（用户 261020 定稿：语雀口径 行 24 / 列 120 / 行头 40 / 列头 24）。
 *
 * 为什么不改 `core/usheetDoc.ts` 的默认：那个函数桌面与移动端共享，桌面新建表会被移动端的视觉口径带跑
 * （用户 261020 明确：桌面保持原样 ⇒ 走 B 方案）。网格一旦写进正文就**跟着文档走**：
 * 手机上建的表在桌面打开同样是 24/120/40/24；旧文档一律不迁移。
 *
 * 单一来源：这份覆盖值只在本文件定义；`bridge/notes.createUsheet`（新建表）与
 * `MobileUsheetViewer.addSheet`（＋新建工作表）都引用它，避免同一个文档里两套网格。
 */
import { emptyUsheetWorkbook, usheetToBody, type UsheetWorkbook } from "../../core/usheetDoc.js";

/** 移动端新建表格/工作表的几何覆盖（Univer IWorksheetData 字段）。 */
export const MOBILE_USHEET_GRID = {
  defaultColumnWidth: 120,
  defaultRowHeight: 24,
  rowHeader: { width: 40, hidden: 0 },
  columnHeader: { height: 24, hidden: 0 },
} as const;

/** 把移动端网格覆盖套到工作簿的**所有**工作表上（新建时只有一张；插入工作表时用 partial 直接传）。 */
export function withMobileUsheetGrid(workbook: UsheetWorkbook): UsheetWorkbook {
  const sheets = workbook.sheets ?? {};
  for (const sheet of Object.values(sheets)) Object.assign(sheet, MOBILE_USHEET_GRID);
  return workbook;
}

/** 移动端新建表格的正文（50×16 + 移动端网格）。 */
export function emptyMobileUsheetBody(): string {
  return usheetToBody(withMobileUsheetGrid(emptyUsheetWorkbook()));
}
