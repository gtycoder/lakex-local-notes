/**
 * 多维表「设备本地导航」：当前数据表 / 每张表的当前视图（261006 用户选 C）。
 *
 * 口径（桌面与移动端共用）：切表/切视图**只写这里**（localStorage，按 noteId），**不进正文、不同步**；
 * 正文侧序列化恒写默认导航（第一表 / 第一视图）⇒ 换台设备各记各的、也不会把导航带上 S3。
 * 桌面（`BitableEditor`）与移动端（`MobileBitableViewer`）都从这里读写，避免两份实现漂移。
 */
import type { BitableDoc } from "../../core/bitableDoc";
import { writeLocalStorage } from "../../lib/localStorageSafe";

export const BITABLE_NAV_KEY_PREFIX = "lake-notes-v3.bitable-nav.";

export interface BitableNav {
  tableId?: string;
  viewIds?: Record<string, string>;
}

export function readBitableNav(noteId: string): BitableNav {
  try {
    const raw = localStorage.getItem(BITABLE_NAV_KEY_PREFIX + noteId);
    const parsed = raw ? (JSON.parse(raw) as BitableNav) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeBitableNav(noteId: string, nav: BitableNav): void {
  writeLocalStorage(BITABLE_NAV_KEY_PREFIX + noteId, JSON.stringify(nav));
}

/**
 * 把设备本地导航应用到文档模型（表格/视图都失效时回落到正文里的默认值）。
 * 纯函数：不读 storage，便于单测与「历史快照不走导航」这类分支复用。
 */
export function applyBitableNav(doc: BitableDoc, nav: BitableNav): BitableDoc {
  const tables = doc.tables.map((table) => {
    const viewId = nav.viewIds?.[table.id];
    return viewId && table.views.some((view) => view.id === viewId) ? { ...table, activeViewId: viewId } : table;
  });
  const wanted = nav.tableId;
  const activeTableId = wanted && tables.some((t) => t.id === wanted) ? wanted
    : tables.some((t) => t.id === doc.activeTableId) ? doc.activeTableId
    : tables[0]?.id ?? "";
  return { ...doc, tables, activeTableId };
}
