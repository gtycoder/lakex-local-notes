/**
 * AI 写作 · 附件（261116 Phase 1 + 第四稿）的**展示换算**。
 *
 * 只做「引用 → 展示」的渲染层换算：文档资产图片走资源服务器直链；本机文件只有名称/大小/类型
 * （**绝对路径与字节只在主进程**，渲染层没有缩略图数据）。不读字节、不转 base64、不过 IPC。
 */
import { localAssetHttpUrl, withAssetWidth } from "../../core/assetUrl";
import { aiWritingAttachmentLabel, isAiWritingLocalAttachment, type AiWritingAttachment } from "../../core/aiWriting";
import type { AiAssetRef } from "../../core/aiProviders";
import { ASSET_PORT, withAssetAccessToken } from "../../lib/assetPort";

/** 缩略图档位（与资源服务器的离散档位对齐；128 是 ASSET_THUMB_WIDTHS 的最小档）。 */
export const AIW_ATTACH_THUMB_WIDTH = 128;
/** 与主进程 AI_MAX_TOTAL_IMAGE_BYTES 同口径（core/aiChatMessages 侧 10MB/张、20MB/次）。 */
export const AIW_ATTACH_TOTAL_BYTES = 20 * 1024 * 1024;

/** 文档资产图片的缩略图 URL（本机文件没有 URL，用 FileKindIcon 文件名 chip）。 */
export function aiWritingAttachmentUrl(asset: AiAssetRef, width: number | null = AIW_ATTACH_THUMB_WIDTH): string {
  const raw = localAssetHttpUrl(asset.noteId, asset.filename, { port: ASSET_PORT });
  return withAssetAccessToken(withAssetWidth(raw, width));
}

/** 附件 → 缩略图 URL（仅资产图片）；本机文件返回 null。 */
export function aiWritingAttachmentPreviewUrl(ref: AiWritingAttachment): string | null {
  if (isAiWritingLocalAttachment(ref)) return null;
  return aiWritingAttachmentUrl(ref);
}

/**
 * 本机**图片**附件 → 资源服务直链（261116 用户反馈：本机选的图片不能预览）。
 *
 * 主进程 assetServer 的 /ai-local/<token> 只放行 image 类、按 token 读盘流式返回；
 * 路径与字节仍不进渲染层，这里只是把不透明 token 拼成 <img> 可用的 URL。
 * 非图片（文本/PDF）或 token 失效时返回 null / 404（<img> 自然空白，不伪造占位）。
 */
export function aiWritingLocalImageUrl(ref: AiWritingAttachment, width: number | null = AIW_ATTACH_THUMB_WIDTH): string | null {
  if (!isAiWritingLocalAttachment(ref)) return null;
  if (!(ref.mimeType || "").startsWith("image/")) return null;
  const base = "http://127.0.0.1:" + ASSET_PORT + "/ai-local/" + encodeURIComponent(ref.token);
  return width == null ? base : base + "?w=" + width;
}

export { aiWritingAttachmentLabel };

/** 人类可读体积（B/KB/MB 三档，避免为一行数字引入更大依赖）。 */
export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return Math.round(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
