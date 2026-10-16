/**
 * 系统分享（ACTION_SEND）接入。
 *
 * 原生 SharedContentPlugin 只把分享内容接住：文本原样、图片/文件复制到 filesDir/shared-inbox/。
 * 这里把它转成「小记」轻量框的 seed（文本 + 图片字节）；冷启动走 consume()，热启动走 "shared" 事件。
 */
import { Directory, Filesystem } from "@capacitor/filesystem";
import { registerPlugin } from "@capacitor/core";
/**
 * 系统分享带入的初始内容（文本 + 图片字节）。
 * 261010 从已删除的轻量框 `QuickNoteFlashComposer` 迁到此处 —— 它本来就是**本模块的产物形状**。
 */
export interface QuickNoteSeed {
  text: string;
  images: Array<{ filename: string; mimeType: string; bytes: Uint8Array }>;
}

export interface SharedContent {
  text?: string;
  imageFilename?: string;
  mimeType?: string;
}

interface SharedContentPluginApi {
  consume(): Promise<SharedContent>;
  addListener(eventName: "shared", listenerFunc: (data: SharedContent) => void): Promise<{ remove(): Promise<void> }>;
}

const SharedContent = registerPlugin<SharedContentPluginApi>("SharedContent");

function isNativePlatform(): boolean {
  return (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 分享内容 → 轻量框 seed（图片从 shared-inbox 读回；读不到就只带文本）。 */
export async function sharedContentToSeed(content: SharedContent): Promise<QuickNoteSeed | null> {
  const text = typeof content?.text === "string" ? content.text : "";
  const images: QuickNoteSeed["images"] = [];
  if (content?.imageFilename) {
    const path = "shared-inbox/" + content.imageFilename;
    try {
      const file = await Filesystem.readFile({ path, directory: Directory.Data });
      const base64 = typeof file.data === "string" ? file.data : "";
      if (base64) images.push({ filename: content.imageFilename, mimeType: content.mimeType || "application/octet-stream", bytes: base64ToBytes(base64) });
    } catch { /* 读不到就只带文本 */ }
    // 读完即删原生复制过来的临时文件（内容已进轻量框/落盘），避免 shared-inbox 堆积。
    void Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
  }
  if (!text.trim() && images.length === 0) return null;
  return { text, images };
}

/** 冷启动：取一次性分享内容（取完即清）。 */
export async function consumeSharedContent(): Promise<SharedContent | null> {
  if (!isNativePlatform()) return null;
  try {
    const content = await SharedContent.consume();
    return content && (content.text || content.imageFilename) ? content : null;
  } catch {
    return null;
  }
}

/** 热启动：接收新的分享（onNewIntent）。返回取消订阅函数。 */
export function subscribeSharedContent(onShared: (content: SharedContent) => void): () => void {
  if (!isNativePlatform()) return () => undefined;
  let disposed = false;
  let handle: { remove(): Promise<void> } | null = null;
  void SharedContent.addListener("shared", (content) => { if (!disposed) onShared(content); })
    .then((h) => { if (disposed) void h.remove(); else handle = h; })
    .catch(() => undefined);
  return () => { disposed = true; void handle?.remove(); };
}
