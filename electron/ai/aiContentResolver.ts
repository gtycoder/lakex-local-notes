import type { AiAssetRef, AiChatMessage } from "../../src/core/aiProviders.js";
import { AppError } from "../../src/core/storeErrors.js";
import type { AiResolvedContentPart, AiResolvedMessage } from "./aiClient.js";
import { toImageDataUrl } from "./aiImages.js";
import { AI_LOCAL_TEXT_MAX_BYTES, AI_LOCAL_TEXT_TOTAL_CHARS, localAttachmentKindOf, type AiLocalFileReader } from "./localAttachments.js";
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
export async function resolveAiMessages(
  messages: AiChatMessage[],
  reader: AiAssetReader,
  localFiles?: AiLocalFileReader,
): Promise<AiResolvedMessage[]> {
  let totalImageBytes = 0;
  let imageCount = 0;
  let localTextChars = 0;
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
      // 文档资产图片 / PDF（Phase 1 链路，字节从 note-assets 读）。
      if (part.type === "image" || part.type === "document") {
        const asset = part.asset;
        const file = reader.readAssetBytes(asset.noteId, asset.filename);
        if (!file) throw new AppError("NotFound", "附件文件不存在：" + label(asset));
        if (part.type === "image") {
          imageCount += 1;
          if (imageCount > 10) throw new AppError("InvalidInput", "一次最多发送 10 张图片");
          if (file.size > AI_MAX_IMAGE_BYTES) throw new AppError("InvalidInput", "图片过大：" + label(asset) + "（上限 " + mb(AI_MAX_IMAGE_BYTES) + "）");
          totalImageBytes += file.size;
          if (totalImageBytes > AI_MAX_TOTAL_IMAGE_BYTES) throw new AppError("InvalidInput", "本次图片总大小超过上限 " + mb(AI_MAX_TOTAL_IMAGE_BYTES));
          parts.push({ type: "image_url", image_url: { url: await toImageDataUrl(file.bytes, label(asset)) } });
        } else {
          if (!isPdf(file.mimeType, asset.filename)) throw new AppError("InvalidInput", "暂不支持读取该附件类型：" + label(asset) + "（当前仅支持 PDF）");
          const extracted = await extractPdfText(file.bytes, asset.noteId + "/" + asset.filename + "/" + file.size);
          parts.push({ type: "text", text: "【附件：" + label(asset) + "】\n" + extracted.text });
        }
        continue;
      }
      // 本机文件（261116 第四稿）：主进程按 token 读；渲染层从未接触字节。
      if (!localFiles) throw new AppError("InvalidInput", "本机文件附件通道未接入");
      const local = localFiles.readLocalFile(part.file);
      if (!local) throw new AppError("NotFound", "本机文件附件已失效：" + part.file.name + "（应用重启或文件被移动），请重新选择");
      const kind = localAttachmentKindOf(local.name);
      if (kind === "image") {
        imageCount += 1;
        if (imageCount > 10) throw new AppError("InvalidInput", "一次最多发送 10 个图片附件");
        if (local.size > AI_MAX_IMAGE_BYTES) throw new AppError("InvalidInput", "图片过大：" + local.name + "（上限 " + mb(AI_MAX_IMAGE_BYTES) + "）");
        totalImageBytes += local.size;
        if (totalImageBytes > AI_MAX_TOTAL_IMAGE_BYTES) throw new AppError("InvalidInput", "本次图片总大小超过上限 " + mb(AI_MAX_TOTAL_IMAGE_BYTES));
        parts.push({ type: "image_url", image_url: { url: await toImageDataUrl(local.bytes, local.name) } });
        continue;
      }
      if (kind === "text") {
        if (local.size > AI_LOCAL_TEXT_MAX_BYTES) {
          throw new AppError("InvalidInput", "文本附件过大：" + local.name + "（上限 " + Math.round(AI_LOCAL_TEXT_MAX_BYTES / 1024) + "KB）");
        }
        const text = local.bytes.toString("utf8");
        if (text.includes("\u0000")) throw new AppError("InvalidInput", "暂不支持二进制文件：" + local.name + "（当前支持图片与文本/代码文件）");
        const remain = AI_LOCAL_TEXT_TOTAL_CHARS - localTextChars;
        if (remain <= 0) throw new AppError("InvalidInput", "附件总长度超过上限（" + AI_LOCAL_TEXT_TOTAL_CHARS + " 字符），请减少附件");
        const clipped = text.length > remain ? text.slice(0, remain) + "\n…（已截断）" : text;
        localTextChars += Math.min(text.length, remain);
        parts.push({ type: "text", text: "【附件：" + local.name + "】\n" + clipped });
        continue;
      }
      if (kind === "pdf") {
        let extracted = local.pdf;
        if (!extracted) {
          try {
            extracted = await extractPdfText(local.bytes, "local/" + local.name + "/" + local.size);
          } catch (error) {
            const reason = error instanceof Error ? error.message : "文件损坏或不是有效的 PDF";
            throw new AppError("InvalidInput", "PDF 解析失败：" + local.name + "（" + reason + "）。请换用可复制文字的 PDF，或取消密码保护后重试。");
          }
        }
        const remain = AI_LOCAL_TEXT_TOTAL_CHARS - localTextChars;
        if (remain <= 0) throw new AppError("InvalidInput", "附件总长度超过上限（" + AI_LOCAL_TEXT_TOTAL_CHARS + " 字符），请减少附件");
        const clipped = extracted.text.length > remain ? extracted.text.slice(0, remain) + "\n…（已截断）" : extracted.text;
        localTextChars += Math.min(extracted.text.length, remain);
        const head = "【附件：" + local.name + "（PDF，" + extracted.pages + " 页" + (extracted.truncated ? "，原文过长已截断" : "") + "）】\n";
        parts.push({ type: "text", text: head + clipped });
        continue;
      }
      throw new AppError("InvalidInput", "暂不支持该文件类型：" + local.name + "（支持图片、文本/代码与 PDF）");
    }
    out.push({ role: message.role, content: parts.length ? parts : "" });
  }
  return out;
}
