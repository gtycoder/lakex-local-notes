/**
 * AI 写作 · 图片附件（261116 Phase 1）的**展示换算**。
 *
 * 只做「AiAssetRef → 资源服务器 URL」的渲染层换算：不读字节、不转 base64、不过 IPC。
 * 字节由主进程在校验/发送时读取（electron/ai/aiContentResolver.ts），与文档内图片同一条链路。
 */
import { localAssetHttpUrl, withAssetWidth } from "../../core/assetUrl";
import { aiWritingAttachmentLabel } from "../../core/aiWriting";
import type { AiAssetRef } from "../../core/aiProviders";
import { ASSET_PORT, withAssetAccessToken } from "../../lib/assetPort";

/** 缩略图档位（与资源服务器的离散档位对齐；128 是 ASSET_THUMB_WIDTHS 的最小档）。 */
export const AIW_ATTACH_THUMB_WIDTH = 128;
/** 与主进程 AI_MAX_TOTAL_IMAGE_BYTES 同口径（core/aiChatMessages 侧 10MB/张、20MB/次）。 */
export const AIW_ATTACH_TOTAL_BYTES = 20 * 1024 * 1024;

/** 附件缩略图 URL：本地资源服务器直链（带 access token；width=null = 原图）。 */
export function aiWritingAttachmentUrl(asset: AiAssetRef, width: number | null = AIW_ATTACH_THUMB_WIDTH): string {
  const raw = localAssetHttpUrl(asset.noteId, asset.filename, { port: ASSET_PORT });
  return withAssetAccessToken(withAssetWidth(raw, width));
}

export { aiWritingAttachmentLabel };

/** 人类可读体积（附件选择器只用 B/KB/MB 三档，避免为一行数字引入更大依赖）。 */
export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return Math.round(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
