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

/** PDF 分享读取失败（损坏/权限/旧 APK）时的可见提示：文件保留可重试，不静默丢。 */
export const SHARED_PDF_IMPORT_HINT = "PDF 文件读取失败，已保留可重试；也可从手写板「插入」里导入 PDF";
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

/**
 * 读取 pdf/file 分享的字节（261102 分享→自动导入的读取口；图形分支不走这里）。
 *
 * API：`readSharedContentBytes(content): Promise<{ bytes: Uint8Array; filename: string } | null>`
 * · 仅 kind=pdf / kind=file 且带 filename 时才读；image / 纯文本 / 无文件名 ⇒ null（不碰文件）；
 * · **读取成功后才删除** shared-inbox 临时文件（消费语义：读到即接管，删掉防堆积）；
 * · 读失败 / 空文件 ⇒ 返回 null 且**保留**文件（便于排查与重试；不要为了"清理"把失败样本删掉）；
 * · 删除失败不影响返回（字节已经读到，最坏是 shared-inbox 多留一个文件）。
 *
 * 调用方（分享→自动导入路由）拿到 bytes 后自己落资产/导入；本函数只负责「读 + 消费」。
 */
export async function readSharedContentBytes(content: SharedContent): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const kind = sharedContentKind(content);
  if (kind !== "pdf" && kind !== "file") return null;
  const filename = content?.filename ?? content?.imageFilename ?? "";
  if (!filename) return null;
  const path = "shared-inbox/" + filename;
  let base64: string;
  try {
    const file = await Filesystem.readFile({ path, directory: Directory.Data });
    base64 = typeof file.data === "string" ? file.data : "";
  } catch {
    // 读失败：保留文件（不删），返回 null 让调用方给可见提示/重试
    return null;
  }
  const bytes = base64 ? base64ToBytes(base64) : new Uint8Array();
  if (bytes.length === 0) return null; // 空文件：同样保留
  // 读取成功 ⇒ 消费掉临时文件（失败只忽略，字节已到手）
  // 删除失败不影响导入：字节已到手，最坏 shared-inbox 多留一个文件（下次启动可再清）。
  try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch { /* 删除临时文件失败不影响本次读取结果 */ }
  return { bytes, filename };
}

/** 分享内容 → 轻量框 seed（**只有 image 才读字节**；pdf 交给 readSharedContentBytes，file 无消费方则清理）。 */
export async function sharedContentToSeed(content: SharedContent): Promise<QuickNoteSeed | null> {
  const text = typeof content?.text === "string" ? content.text : "";
  const filename = content?.filename ?? content?.imageFilename ?? "";
  const kind = sharedContentKind(content);
  const path = filename ? "shared-inbox/" + filename : "";
  if (kind !== "image") {
    // 261102 T2-C：pdf/file 不创建小记、不静默当图片。
    // · pdf：**不删文件** —— 交给 readSharedContentBytes 读成功后再消费（分享→自动导入路由）；
    // · file：仍无消费方，删掉临时文件避免 shared-inbox 堆积。
    if (kind === "file" && path) {
      void Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
    }
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
