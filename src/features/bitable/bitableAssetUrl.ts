/**
 * 多维表里的资产 URL 构造（**单一来源**）。
 *
 * 附件/图片单元格、看板卡片缩略图、画册封面、关联记录选择器都用这一处：
 * 原图 = `ASSET_ORIGIN/{noteId}/{磁盘名}`；缩略图再按 CSS 像素档位加 `?w=`（最后统一带访问令牌）。
 * 不要在各组件里另拼一遍（历史上拼了 4 处，顺序还各不相同）。
 */
import { ASSET_ORIGIN, assetThumbWidthForCss, withAssetAccessToken } from "../../lib/assetPort.js";
import { withAssetWidth } from "../../core/assetUrl.js";

/** `cssPx` = 该图在界面上的 CSS 像素边长（决定 `?w=` 档位；不传则取原图）。 */
export function bitableAssetUrl(noteId: string, file: string, cssPx?: number): string {
  const base = ASSET_ORIGIN + "/" + noteId + "/" + file;
  const sized = cssPx ? withAssetWidth(base, assetThumbWidthForCss(cssPx)) : base;
  return withAssetAccessToken(sized);
}
