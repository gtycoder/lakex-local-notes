/**
 * 图片显示缩略决策（fail-safe：width>0 且 allowlist 命中才加 ?w=）。
 *
 * 261112 R2-S9：从 lakeRuntime.ts **原样搬出**（纯搬移：导出名/行为零变化）。
 * 公共符号仍由 ./lakeRuntime 门面 re-export；内核 lazy 边界不变（只被 lakeRuntime 静态 import）。
 */
import { withLocalImageThumb } from "../../lib/assetPort";
import { imageThumbKey } from "../../core/quickNoteImageThumb.js";
/**
 * 【task-26】显示缩略决策（fail-safe）：width>0 且 allowlist 命中才加 `?w=`；其余原样。
 * 只影响内核 toDisplaySrc 出口，模型/保存仍用卡片 value（原图 URL）。
 */
export function imageThumbDisplaySrc(src: string, width: number | undefined, allow: ReadonlySet<string> | undefined): string {
  if (!allow || typeof width !== "number" || !(width > 0)) return src;
  const file = imageThumbKey(src);
  if (!file || !allow.has(file)) return src;
  return withLocalImageThumb(src, width);
}

