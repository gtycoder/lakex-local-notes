/**
 * AI 会话图片存档（261023 P2.5）：让历史里“看到图”，而不只是 [图片] 占位。
 *
 * 目录（App 私有 Data）：`ai/conversations/{conversationId}/images/{imageId}.{ext}`
 * · 只存**字节文件**，会话 JSON 只存 `{id,mime,ext}` 引用（不把 base64 塞进 JSON/预算）；
 * · 单会话图片总量上限 `AI_CONVERSATION_IMAGES_MAX_BYTES = 20MiB`（超出时新图不归档、历史仍显示占位）；
 * · 模型侧仍只发“当轮附件”（历史不重发图），存档仅用于**展示**；
 * · 删除/清空会话时整目录删除。
 */
import { Directory, Filesystem } from "@capacitor/filesystem";

const ROOT = "ai/conversations";
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const EXT_RE = /^[a-z0-9]{2,5}$/;
export const AI_CONVERSATION_IMAGES_MAX_BYTES = 20 * 1024 * 1024;

export interface AiStoredImageRef {
  id: string;
  mime: string;
  ext: string;
}

export function imageExtOf(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  return "jpg";
}

export function mimeOfExt(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "image/jpeg";
}

export function isValidImageRef(ref: unknown): ref is AiStoredImageRef {
  if (!ref || typeof ref !== "object") return false;
  const value = ref as { id?: unknown; mime?: unknown; ext?: unknown };
  return typeof value.id === "string" && ID_RE.test(value.id)
    && typeof value.mime === "string" && value.mime.startsWith("image/")
    && typeof value.ext === "string" && EXT_RE.test(value.ext);
}

function imageDir(conversationId: string): string {
  if (!ID_RE.test(conversationId)) throw new Error("非法会话 id");
  return ROOT + "/" + conversationId + "/images";
}

function imagePath(conversationId: string, image: AiStoredImageRef): string {
  if (!isValidImageRef(image)) throw new Error("非法图片引用");
  return imageDir(conversationId) + "/" + image.id + "." + image.ext;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** 单会话图片已占用字节（读目录元数据，不读文件内容）。 */
async function usedImageBytes(conversationId: string): Promise<number> {
  try {
    const listing = await Filesystem.readdir({ path: imageDir(conversationId), directory: Directory.Data });
    return (listing.files ?? []).reduce((sum, file) => sum + Number(file.size ?? 0), 0);
  } catch {
    return 0;
  }
}

/** 存档一张图片；超单会话上限/写入失败返回 null（调用方保留 [图片] 占位）。 */
export async function saveConversationImage(conversationId: string, image: AiStoredImageRef, bytes: Uint8Array): Promise<boolean> {
  if (!isValidImageRef(image) || bytes.length === 0) return false;
  try {
    if ((await usedImageBytes(conversationId)) + bytes.length > AI_CONVERSATION_IMAGES_MAX_BYTES) return false;
    await Filesystem.writeFile({
      path: imagePath(conversationId, image),
      data: bytesToBase64(bytes),
      directory: Directory.Data,
      recursive: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** 读存档图片为 data URL（历史/聊天展示用；失败返回 null）。 */
export async function readConversationImageDataUrl(conversationId: string, image: AiStoredImageRef): Promise<string | null> {
  try {
    const result = await Filesystem.readFile({ path: imagePath(conversationId, image), directory: Directory.Data });
    const base64 = typeof result.data === "string" ? result.data : bytesToBase64(await result.data.arrayBuffer().then((buffer) => new Uint8Array(buffer)));
    return "data:" + (image.mime || mimeOfExt(image.ext)) + ";base64," + base64;
  } catch {
    return null;
  }
}

/** 递归删目录（当前 Filesystem 的 rmdir 不支持 recursive）。 */
async function removeDirectory(path: string, depth = 0): Promise<void> {
  if (depth > 4) return;
  let listing;
  try {
    listing = await Filesystem.readdir({ path, directory: Directory.Data });
  } catch {
    return; // 不存在
  }
  for (const file of listing.files ?? []) {
    const child = path + "/" + file.name;
    if (file.type === "directory") await removeDirectory(child, depth + 1);
    else await Filesystem.deleteFile({ path: child, directory: Directory.Data }).catch(() => undefined);
  }
  await Filesystem.rmdir({ path, directory: Directory.Data }).catch(() => undefined);
}

export async function deleteConversationImages(conversationId: string): Promise<void> {
  await removeDirectory(imageDir(conversationId));
  // 会话目录只剩空壳时一并删掉（JSON 正文在上一级）。
  await Filesystem.rmdir({ path: ROOT + "/" + conversationId, directory: Directory.Data }).catch(() => undefined);
}

/**
 * 清理没有任何 DB 记录对应的会话图片目录（DB 丢行/早期删除失败留下的孤儿）。
 * 只删目录，不碰 `.json` 正文文件。
 */
export async function sweepOrphanConversationDirs(validIds: readonly string[]): Promise<void> {
  try {
    // 首次使用（还没有任何会话）时目录不存在：先建出来再读——
    // 否则 Capacitor Filesystem 的 readdir 会拒一次并打 console.error（regression 261029 P1-2）。
    await Filesystem.mkdir({ path: ROOT, directory: Directory.Data, recursive: true }).catch(() => undefined);
    const listing = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    const valid = new Set(validIds);
    for (const entry of listing.files ?? []) {
      if (entry.type !== "directory") continue;
      if (valid.has(entry.name)) continue;
      await removeDirectory(ROOT + "/" + entry.name);
    }
  } catch { /* 目录不存在 */ }
}

/** data URL → bytes（拍照/相册临时图存档用）。 */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.slice(0, comma).startsWith("data:")) return null;
  try { return base64ToBytes(dataUrl.slice(comma + 1)); } catch { return null; }
}
