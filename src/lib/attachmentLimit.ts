import { DEFAULT_MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES } from "../core/storeLimits.js";
import { loadSettings } from "./settings";

/** 文件超过本机上传上限时的统一错误；UI 订阅通知后展示，调用方继续走原有失败路径。 */
export class AttachmentLimitExceededError extends Error {
  readonly filename: string;
  readonly sizeBytes: number;
  readonly limitBytes: number;

  constructor(filename: string, sizeBytes: number, limitBytes: number) {
    super(attachmentLimitMessage(filename, sizeBytes, limitBytes));
    this.name = "AttachmentLimitExceededError";
    this.filename = filename;
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

type Listener = (error: AttachmentLimitExceededError) => void;
const listeners = new Set<Listener>();

/** 当前上传上限：设置值夹在 (0, 协议上限]；设置不可读/损坏时回默认 25 MiB。 */
export function effectiveAttachmentLimitBytes(): number {
  let configured: unknown;
  try { configured = loadSettings().maxAttachmentBytes; } catch { configured = undefined; }
  if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_ATTACHMENT_BYTES;
  }
  return Math.min(Math.round(configured), MAX_ATTACHMENT_BYTES);
}

/** 上传错误文案的统一体积口径（二进制单位，和设置页一致）。 */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) {
    const formatted = mib.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${formatted} MiB`;
  }
  const kib = bytes / 1024;
  if (kib >= 1) return `${kib >= 10 ? kib.toFixed(0) : kib.toFixed(1).replace(/\.0$/, "")} KiB`;
  return `${Math.round(bytes)} B`;
}

function safeDisplayName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || "附件";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return "附件";
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "…" : cleaned;
}

export function attachmentLimitMessage(filename: string, sizeBytes: number, limitBytes: number): string {
  const excess = Math.max(0, sizeBytes - limitBytes);
  return `无法插入“${safeDisplayName(filename)}”：文件大小为 ${formatAttachmentSize(sizeBytes)}（比上限多 ${formatAttachmentSize(excess)}），当前附件上限为 ${formatAttachmentSize(limitBytes)}。可在「设置 → 常规 → 附件大小上限」中调整。`;
}

function report(error: AttachmentLimitExceededError): void {
  for (const listener of listeners) {
    try { listener(error); } catch { /* 单个 UI 订阅异常不能改变上传失败语义 */ }
  }
}

/** 超限即发一次全局通知并抛出；等号边界允许通过。 */
export function assertAttachmentWithinLimit(
  sizeBytes: number,
  filename: string,
  limitBytes = effectiveAttachmentLimitBytes(),
): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= limitBytes) return;
  const error = new AttachmentLimitExceededError(filename, sizeBytes, limitBytes);
  report(error);
  throw error;
}

export function subscribeAttachmentLimitErrors(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
