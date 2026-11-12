/**
 * 预览资产的**档位决策**（纯函数，无 React / 无平台 API）。
 *
 * 三种 intent（用户裁决 Q02：打开大图后换原图；261112 审计 02 报告 §3.4）：
 * - display     列表/卡片里的显示 src：本地可缩图片加离散档位 ?w=1024（与封面同档 ⇒ 同一张图同一 URL、
 *               浏览器/服务端缓存只解码一次）；GIF/SVG/非图片（PDF/音视频/附件）原样；
 * - original    放大看大图：去掉显示用 w/date、**保留 token**（token 是渲染层注进来的访问令牌，
 *               去掉就 401）；与复制路径共用同一套 URL 规范化（features/editor/clipboardHtml）；
 * - materialized 复制/导出物化：在 original 基础上加 base64=1（资产服务返回原文件 data URL）。
 *
 * 为什么单独成模块：审计发现「图片来源 4 套」（02 报告 §1.5）——列表走 ?w=1024、放大也拿 1024、
 * 复制另走 ?base64=1、资源页走 native.readAssetPreview。档位语义不统一 ⇒ 用户报「放大后还是糊」。
 * 本模块只做「引用 + intent → URL」，**不做取数**（取数仍是资产服务/原生读）。
 *
 * 非本地资产（data: / blob: / 外部 http）一律原样返回：我们无权也无需缩放或物化。
 */
import { localAssetHttpUrl, parseLocalAssetUrl } from "../../core/assetUrl.js";
import { withLocalImageThumb } from "../../lib/assetPort.js";
import { canonicalAssetUrlForCopy } from "../editor/clipboardHtml";
import type { PreviewAssetIntent, PreviewAssetRef } from "./types";

/** 列表/卡片显示档位：与封面同一档（资产服务只有 128/256/512/1024 四档）。 */
export const PREVIEW_DISPLAY_THUMB_WIDTH = 1024;

/** 引用 → 原始 URL（没有 src 时按 noteId+filename 现拼 canonical URL）。 */
export function resolvePreviewAssetRef(ref: PreviewAssetRef): string {
  const src = typeof ref.src === "string" ? ref.src.trim() : "";
  if (src) return src;
  if (!ref.noteId || !ref.filename) return "";
  return localAssetHttpUrl(ref.noteId, ref.filename);
}

/**
 * 引用 + intent → 预览用 URL。
 * @example resolvePreviewAssetUrl({ noteId, filename, src }, "original") // 放大
 */
export function resolvePreviewAssetUrl(ref: PreviewAssetRef, intent: PreviewAssetIntent): string {
  const raw = resolvePreviewAssetRef(ref);
  if (!raw) return "";
  // 非本地资源（外链/data/blob）：三种 intent 都原样。
  if (!parseLocalAssetUrl(raw)) return raw;
  if (intent === "display") return withLocalImageThumb(raw, PREVIEW_DISPLAY_THUMB_WIDTH);
  const original = stripDisplayParams(raw);
  if (intent === "original") return original;
  return withMaterializedParam(original);
}

/** 去掉显示用参数（w/date），保留 token 等其它 query。http 本地形态与复制路径共用同一实现。 */
function stripDisplayParams(raw: string): string {
  if (/^https?:/i.test(raw)) return canonicalAssetUrlForCopy(raw);
  // lake-asset:// 等非 http 本地形态：canonicalAssetUrlForCopy 只处理资产服务前缀 ⇒ 按同一语义就地处理。
  try {
    const parsed = new URL(raw);
    parsed.searchParams.delete("w");
    parsed.searchParams.delete("date");
    return parsed.toString();
  } catch {
    return raw;
  }
}

/** 物化请求：加 base64=1（资产服务直接回原文件 data URL；已存在则覆盖为 1）。 */
function withMaterializedParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("base64", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}
