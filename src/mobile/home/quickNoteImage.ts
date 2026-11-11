/**
 * 小记卡片图片的**缩略 URL / 比例盒**纯逻辑（移动端，261111 图片内存优化）。
 *
 * 为什么需要：列表卡的图片原先分两种：
 *  · 封面已经走本地资源服务的离散缩略档位（`?w=1024`）；
 *  · **正文内嵌图片仍是原图 URL**（QuickNotePreview 的 `asset.url`），一张 4000×3000 照片
 *    解码就是 ~48MB 位图；一屏多张卡片/多图小记会把 WebView 内存顶穿。
 *
 * 这里把「显示宽度 → 档位」的判据收成一处（不读 DOM，方便单测）：
 *  · 卡片内图片（封面 + 正文预览）统一取 `CARD_IMAGE_THUMB_PX`（最大档 1024 ≈ 360 CSS px × 3 DPR，
 *    与封面同一档 ⇒ **同一张图在封面与正文里是同一个 URL**，浏览器只解码一次）；
 *  · 附件/视频/音频不加 `?w=`（服务端只对图片做缩略，加了也只是原图，白白打散缓存）；
 *  · 宽高元数据可用时给 <img> 补 width/height 属性（固定比例盒，加载完不跳版）；
 *    老数据/附件 width/height 为 null ⇒ 不写属性，维持现状。
 *
 * 档位是离散的（服务端只认 ASSET_THUMB_WIDTHS），所以"同一张图不同调用点"最多产生有限几个 URL，
 * 不会出现连续值把浏览器/服务端缓存打散 —— 单测锁这条语义（同输入 → 同 URL；跨档位数量有界）。
 */
import { ASSET_THUMB_WIDTHS, withAssetWidth } from "../../core/assetUrl.js";
import { isQuickNoteImageMime } from "../../core/quickNoteModel.js";
import { imageBoxAttrs } from "../../lib/imageBox";

/** 卡片内图片统一档位（与封面 261109 的 1024 档一致；最大档 ≈ 360 CSS px × 3 DPR）。 */
export const CARD_IMAGE_THUMB_PX = 1024;

/** 正文预览里的图片：只有 `image/*` 才加离散档位；视频/音频/附件原样（不加无意义的 query）。 */
export function quickNotePreviewAssetUrl(raw: string, mimeType: string): string {
  if (!isQuickNoteImageMime(mimeType)) return raw;
  return withAssetWidth(raw, CARD_IMAGE_THUMB_PX);
}

/** 封面/正文图片共用的缩略 URL（已含 token 的 URL 进、带 `?w=` 的出；重复调用结果稳定）。 */
export function quickNoteImageUrl(raw: string): string {
  return withAssetWidth(raw, CARD_IMAGE_THUMB_PX);
}

/** 比例盒判据的单一来源在 `src/lib/imageBox.ts`（与共享预览组件共用）。 */
export { imageBoxAttrs };

/** 档位取值域（单测/诊断用；与本地资源服务一致）。 */
export function cardImageThumbWidths(): readonly number[] {
  return ASSET_THUMB_WIDTHS;
}
