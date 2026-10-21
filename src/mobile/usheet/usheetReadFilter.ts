/**
 * 移动端表格**阅读态筛选 = 本机视图**（261021 用户定稿语义）：
 * 「读态筛选只对当前设备生效，**绝不写正文**」。
 *
 * 实现口径：读态开着筛选时，筛选条件只存在于 Univer 运行时（`SHEET_FILTER_PLUGIN` 的 plugin resource），
 * 在**任何落盘路径前**（capture / 切回编辑态 / 卸载）先 `remove-sheet-filter` 还原，
 * 于是 `book.save()` 拿到的正文与打开时逐字节一致 ⇒ 不标脏、不进 S3。
 *
 * 两个安全边界（都在调用方执行，判据在这里单一来源）：
 * 1. 文档**本身已带筛选**（桌面存的）⇒ 读态不允许再叠本机筛选（会先移除文档数据），入口直接置灰并给理由；
 * 2. 恢复必须用 `syncExecuteCommand`（同步），否则 capture 先跑会把筛选写进正文。
 */
import { parseUsheetBody } from "../../core/usheetDoc.js";

interface ResourceLike { name?: string; data?: string }

/** 正文里是否**已经存了**筛选条件（空壳 `{}` 不算）。 */
export function hasPersistedFilter(content: string): boolean {
  try {
    const workbook = parseUsheetBody(content)?.workbook as unknown as { resources?: ResourceLike[] } | undefined;
    const entry = workbook?.resources?.find((item) => item?.name === "SHEET_FILTER_PLUGIN");
    const data = (entry?.data ?? "").trim();
    return data !== "" && data !== "{}";
  } catch {
    return false;
  }
}

/** 阅读态筛选入口的可用性 + 理由（移动端没有 hover，理由要能直接展示）。 */
export function readFilterAvailability(content: string): { enabled: boolean; reason?: string } {
  if (hasPersistedFilter(content)) return { enabled: false, reason: "这篇表格已有保存的筛选，回编辑态调整" };
  return { enabled: true };
}
