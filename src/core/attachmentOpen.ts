/**
 * 附件「用系统应用打开」的策略（261020）。
 *
 * **问题**：macOS 的归档工具（Archive Utility）默认把压缩包**解压到压缩包所在目录**。如果直接把
 * `note-assets/{noteId}/xxx.zip` 交给 `shell.openPath`，解出来的目录会堆进 `note-assets`：
 *   · 它不在 `assets` 表里 ⇒ 不会被上传 S3、不进 manifest（同步不受影响）；
 *   · `detectOrphans` 只登记 `isFile()` 的条目 ⇒ 目录既不进孤儿登记，也就永远不会被任何 GC 清理；
 *   · 用户看到的是一坨永远清不掉的目录，且每次解压都再占一份盘。
 *
 * **策略**：压缩包先落到「打开用临时目录」再交给系统 ⇒ 解压发生在临时目录，`note-assets` 保持干净。
 * 临时副本优先用**硬链接**（同卷零拷贝、不占额外空间），跨卷才回落复制。
 */

/** 会被系统解压工具原地展开的扩展名（与 fileKindOf 的 archive 桶对齐，另加 zst）。 */
export const ATTACHMENT_ARCHIVE_EXTS = ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst"] as const;

/** `app.getPath("temp")` 下的二级目录名（打开用副本的家）。 */
export const ATTACHMENT_OPEN_TEMP_DIR = "lake-open-attachments";

/** 该附件是否由系统解压工具打开（⇒ 需要先挪到临时目录）。 */
export function isArchiveAttachment(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return false;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (ATTACHMENT_ARCHIVE_EXTS as readonly string[]).includes(ext);
}
