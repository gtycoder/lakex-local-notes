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

/** 分享内容显式分类（261102 T2-C：原生按 mime/后缀判定，JS 不再靠 imageFilename 猜）。 */
export type SharedContentKind = "image" | "pdf" | "file";

export interface SharedContent {
  text?: string;
  /** 原生复制出的文件名（新字段；与 imageFilename 同值，旧字段保留给旧 APK/回滚）。 */
  filename?: string;
  /** image | pdf | file；旧 APK 没有该字段 ⇒ JS 按 mime/后缀兜底（见 sharedContentKind）。 */
  kind?: SharedContentKind;
  /** @deprecated 旧字段，语义见 kind；新代码用 filename。 */
  imageFilename?: string;
  mimeType?: string;
  /** 原生流式读取/大小校验失败时的可见原因（只带文本时也可能出现）。 */
  imageError?: string;
}

/** PDF 导入 UI 尚未接通（T2-B）：分享 PDF 先给可见提示，不要静默丢。 */
export const SHARED_PDF_IMPORT_HINT = "PDF 分享暂未接入导入，请从手写板内「导入 PDF」";
export const SHARED_FILE_UNSUPPORTED_HINT = "暂不支持该分享类型";

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

/**
 * 分享内容的分类（不含 text 的纯文本分享没有 kind ⇒ "file" 也无妨，seed 只看图片分支）。
 * 优先级：原生 kind > mime > 文件名后缀。旧 APK 只给 imageFilename/mimeType ⇒ 这层兜底保证
 * 「PDF/其它文件不再被当图片读进小记」（261102 T2-C 的防静默失败核心）。
 */
export function sharedContentKind(content: SharedContent): SharedContentKind {
  if (content.kind === "image" || content.kind === "pdf" || content.kind === "file") return content.kind;
  const mime = (content.mimeType ?? "").toLowerCase();
  const name = (content.filename ?? content.imageFilename ?? "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|avif)$/.test(name)) return "image";
  if (mime.startsWith("application/pdf") || name.endsWith(".pdf")) return "pdf";
  return "file";
}

/** pdf/file 分享的可见提示（调用方 toast；image ⇒ null）。 */
export function sharedContentUnsupportedHint(content: SharedContent): string | null {
  const kind = sharedContentKind(content);
  if (kind === "pdf") return SHARED_PDF_IMPORT_HINT;
  if (kind === "file") return SHARED_FILE_UNSUPPORTED_HINT;
  return null;
}

/** 分享内容 → 轻量框 seed（**只有 image 才读字节**；pdf/file 不创建小记，先清理临时文件并返回 null）。 */
export async function sharedContentToSeed(content: SharedContent): Promise<QuickNoteSeed | null> {
  const text = typeof content?.text === "string" ? content.text : "";
  const filename = content?.filename ?? content?.imageFilename ?? "";
  const kind = sharedContentKind(content);
  const path = filename ? "shared-inbox/" + filename : "";
  if (path && kind !== "image") {
    // 261102 T2-C：PDF/文件分享还没有消费方（PDF 导入 UI 未接通）⇒ 不读、不进小记、不静默当图片；
    // 顺手删掉原生复制的临时文件，避免 shared-inbox 堆积（提示由调用方 sharedContentUnsupportedHint 给）。
    void Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
    return null;
  }
  const images: QuickNoteSeed["images"] = [];
  if (path) {
    try {
      const file = await Filesystem.readFile({ path, directory: Directory.Data });
      const base64 = typeof file.data === "string" ? file.data : "";
      if (base64) images.push({ filename, mimeType: content.mimeType || "application/octet-stream", bytes: base64ToBytes(base64) });
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
    return content && (content.text || content.filename || content.imageFilename || content.imageError) ? content : null;
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
