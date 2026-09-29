/**
 * 多维表里的资产 URL 构造 + 附件打开（**单一来源**）。
 *
 * 附件/图片单元格、看板卡片缩略图、画册封面、关联记录选择器都用这一处：
 * 原图 = `ASSET_ORIGIN/{noteId}/{磁盘名}`；缩略图再按 CSS 像素档位加 `?w=`（最后统一带访问令牌）。
 * 不要在各组件里另拼一遍（历史上拼了 4 处，顺序还各不相同）。
 */
import { ASSET_ORIGIN, assetThumbWidthForCss, withAssetAccessToken } from "../../lib/assetPort.js";
import { withAssetWidth } from "../../core/assetUrl.js";
import { openAssetEntry } from "../attachment/openAssetEntry.js";
import type { BitableAttachment } from "../../core/bitableDoc.js";

/** `cssPx` = 该图在界面上的 CSS 像素边长（决定 `?w=` 档位；不传则取原图）。 */
export function bitableAssetUrl(noteId: string, file: string, cssPx?: number): string {
  const base = ASSET_ORIGIN + "/" + noteId + "/" + file;
  const sized = cssPx ? withAssetWidth(base, assetThumbWidthForCss(cssPx)) : base;
  return withAssetAccessToken(sized);
}

/**
 * 打开一条多维表附件（图片 → 内置 Lightbox 走 `onOpenImages` 那条路；这里只管**非图片/整条文件**）。
 * 表格单元格、关联选择器整表、看板卡片三处共用 —— 点击语义是同一个（「点附件 = 打开它」），
 * 别各自再拼一遍 `openAssetEntry(bitableAssetUrl(...), ...)`。
 */
export function openBitableAttachment(noteId: string, attachment: BitableAttachment): void {
  // kindFrom = 磁盘名：展示名被改成没有扩展名时，类型判定照样正确（音视频仍走应用内播放）
  openAssetEntry(bitableAssetUrl(noteId, attachment.file), attachment.name, attachment.size, { kindFrom: attachment.file });
}
