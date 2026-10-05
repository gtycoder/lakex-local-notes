import type { AiAssetRef, AiChatMessage } from "../../src/core/aiProviders.js";
import { AppError } from "../../src/core/storeErrors.js";
import type { AiResolvedContentPart, AiResolvedMessage } from "./aiClient.js";
import { toImageDataUrl } from "./aiImages.js";
import { extractPdfText } from "./pdfText.js";

/** 图片体积护栏（比供应商（单图 32MiB / 总额 64MiB）更保守）。 */
export const AI_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const AI_MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

/** 主进程读取本地资产的最小端口（Store 实现；单测可注入内存实现）。 */
export interface AiAssetReader {
  readAssetBytes(noteId: string, filename: string): { bytes: Buffer; size: number; mimeType: string } | null;
}

function label(asset: AiAssetRef): string {
  return asset.name && asset.name.trim() ? asset.name.trim() : asset.filename;
}
function isPdf(mimeType: string, filename: string): boolean {
  return mimeType === "application/pdf" || /\.pdf$/i.test(filename);
}
function mb(bytes: number): string {
  return Math.round(bytes / 1024 / 1024) + "MB";
}

/**
 * 把「内容块」解析成供应商可发的消息（**唯一入口**）：
 * - image    → 读本地图片 → image_url data URL（格式 / 尺寸 / 字节护栏）；
 * - document → 读本地文档 → 抽取文本（当前仅 PDF）→ 文本块，带文件名标题。
 * 附件解析失败一律抛 AppError（中文原因），绝不静默降级成空内容。
 */
export async function resolveAiMessages(messages: AiChatMessage[], reader: AiAssetReader): Promise<AiResolvedMessage[]> {
  let totalImageBytes = 0;
  const out: AiResolvedMessage[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    const parts: AiResolvedContentPart[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        if (part.text) parts.push({ type: "text", text: part.text });
        continue;
      }
      const asset = part.asset;
      const file = reader.readAssetBytes(asset.noteId, asset.filename);
      if (!file) throw new AppError("NotFound", "附件文件不存在：" + label(asset));
      if (part.type === "image") {
        if (file.size > AI_MAX_IMAGE_BYTES) throw new AppError("InvalidInput", "图片过大：" + label(asset) + "（上限 " + mb(AI_MAX_IMAGE_BYTES) + "）");
        totalImageBytes += file.size;
        if (totalImageBytes > AI_MAX_TOTAL_IMAGE_BYTES) throw new AppError("InvalidInput", "本次图片总大小超过上限 " + mb(AI_MAX_TOTAL_IMAGE_BYTES));
        parts.push({ type: "image_url", image_url: { url: await toImageDataUrl(file.bytes, label(asset)) } });
      } else {
        if (!isPdf(file.mimeType, asset.filename)) throw new AppError("InvalidInput", "暂不支持读取该附件类型：" + label(asset) + "（当前仅支持 PDF）");
        const extracted = await extractPdfText(file.bytes, asset.noteId + "/" + asset.filename + "/" + file.size);
        parts.push({ type: "text", text: "【附件：" + label(asset) + "】\n" + extracted.text });
      }
    }
    out.push({ role: message.role, content: parts.length ? parts : "" });
  }
  return out;
}
