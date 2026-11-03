/**
 * 手写板导入完成提示（261103 十三批，P2）：把「这次导入会产生多少资产、首次同步要传多少」说清楚。
 * 只做文案/格式化（纯函数）；UI 由 InkPad 的 status banner 承担。
 */
export function formatImportBytes(bytes: number | null | undefined): string {
  const value = Number.isFinite(bytes) && (bytes ?? 0) > 0 ? Number(bytes) : 0;
  if (value <= 0) return "0 KB";
  if (value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + " KB";
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

/** 图片页导入完成：`已导入 3 页，图片约 1.2 MB（首次同步会一起上传）`。 */
export function inkImageImportNotice(pageCount: number, uploadedBytes: number): string {
  if (pageCount <= 0) return "";
  if (uploadedBytes <= 0) return "已导入 " + pageCount + " 页";
  return "已导入 " + pageCount + " 页，图片约 " + formatImportBytes(uploadedBytes) + "（首次同步会一起上传）";
}

/** PDF 导入完成（可带截断说明）：`已导入 12 页（共 20 页），图片约 4.5 MB（首次同步会一起上传）`。 */
export function inkPdfImportNotice(importedPages: number, totalPages: number, uploadedBytes: number, truncated: boolean): string {
  if (importedPages <= 0) return "";
  const head = truncated && totalPages > importedPages
    ? "已导入 " + importedPages + " 页（共 " + totalPages + " 页）"
    : "已导入 " + importedPages + " 页";
  if (uploadedBytes <= 0) return head;
  return head + "，图片约 " + formatImportBytes(uploadedBytes) + "（首次同步会一起上传）";
}
