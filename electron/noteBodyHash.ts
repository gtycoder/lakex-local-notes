import crypto from "node:crypto";

/**
 * 正文内容 hash（Batch4-D 保存版本守卫）：**唯一**算法来源。
 * 打开文档时随 NoteDocument.contentHash 回给渲染层当 baseHash；保存时重算磁盘正文比较。
 * 用 sha256(utf8) 十六进制 —— 与 note_history.content_hash / 同步 contentHash 同族，便于对账。
 */
export function noteBodyHash(body: string): string {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}
