/**
 * 移动端资产 blob 注入（D8，显示层转换，不污染存储）。
 *
 * Lake 正文里图片以 <card value="data:%7B...src...%7D"> URI 编码 JSON 形式存在（也可能出现裸 canonical URL）。
 * 此函数把 card 的 src 或裸 URL 替换为本地字节的 blob URL（仅显示层；编辑/保存用 canonical 原文）。
 * - 同步实现（getAssetBytes / URL.createObjectURL 均同步），保证 LakeEditor 首次挂载即拿到 blob 内容
 *   （LakeEditor 的 setDocument 只在挂载时执行一次，content 变更不触发重设）。
 * - 缺图/未下载 → 保留原样（viewer 侧占位），不污染存储。
 * - blob 生命周期：调用方负责在关文档/切 tab 时 revoke。
 */
import { parseLocalAssetUrl } from "../core/assetUrl.js";
import { bridge } from "./bridge";
import { registerRuntimeBlob, unregisterRuntimeBlob } from "./cachePort.js";

/** 裸 canonical URL：http://127.0.0.1:{port}/{noteId}/{filename} */
const ASSET_URL_RE = /https?:\/\/127\.0\.0\.1:\d+\/[^\s"'<>)]*/g;
/** card 元素 value="data:{uri-encoded-json}" */
const CARD_VALUE_RE = /<card\b[^>]*\bvalue="data:([^"]+)"[^>]*>/g;

export interface BlobInjectedDoc {
  displayContent: string;
  revoke: () => void;
  /** 保存前调用：把内容（getDocument 输出）里的 blob URL 还原为 canonical http。 */
  restore: (content: string) => string;
}

export function injectAssetBlobs(content: string): BlobInjectedDoc {
  const blobUrls: string[] = [];
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return { displayContent: content, revoke: () => {}, restore: (c) => c };
  }
  const seen = new Map<string, string>(); // canonical src -> blobUrl
  const blobToCanonical = new Map<string, string>(); // blobUrl -> canonical src（保存还原用）
  let display = content;

  const srcToBlob = (src: string): string | null => {
    const ref = parseLocalAssetUrl(src);
    if (!ref) return null;
    let blobUrl = seen.get(src);
    if (blobUrl === undefined) {
      const bytes = bridge.getAssetBytes(ref.noteId, ref.filename);
      if (!bytes) return null;
      blobUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]));
      seen.set(src, blobUrl);
      blobUrls.push(blobUrl);
      registerRuntimeBlob(blobUrl);
    }
    return blobUrl;
  };

  // 1) 处理 card value 里的 src（URI 编码 JSON）
  for (const m of display.matchAll(CARD_VALUE_RE)) {
    const full = m[0];
    const encoded = m[1];
    let decoded: string;
    try { decoded = decodeURIComponent(encoded); } catch { continue; }
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(decoded.replace(/^data:/, "")); } catch { continue; }
    if (obj && typeof obj.src === "string") {
      const canonicalSrc = obj.src;
      const blobUrl = srcToBlob(canonicalSrc);
      if (blobUrl) {
        obj.src = blobUrl;
        // 同步到本地的图非"待上传/二进制"：isBinaryType() 检查 original.type==="binary"——
        // 若保持 binary，编辑器创建卡片时按"上传任务"处理并强制 status=pending 清 src。
        // 故改 original.type 非 binary（link）+ status=done + 清 taskId，让卡片走非 binary 路径，
        // 直接以 getSrc()=blob 渲染（内容级修改，编辑器创建时即生效，区别于直接改运行态 _cardValue）。
        obj.status = "done";
        // 改顶层 originalType（fromLake 用 e.originalType 生成 original.type，改 original 对象会被覆盖）
        obj.originalType = "link";
        delete obj.taskId;
        delete obj.clientId;
        blobToCanonical.set(blobUrl, canonicalSrc);
        const newVal = "data:" + encodeURIComponent(JSON.stringify(obj));
        display = display.replace(full, full.replace(encoded, newVal));
      }
    }
  }

  // 2) 直接裸 canonical URL（兜底）
  for (const raw of display.match(ASSET_URL_RE) ?? []) {
    const blobUrl = srcToBlob(raw);
    if (!blobUrl) continue;
    display = display.split(raw).join(blobUrl);
  }

  return {
    displayContent: display,
    revoke: () => { for (const u of blobUrls) { URL.revokeObjectURL(u); unregisterRuntimeBlob(u); } },
    restore: (content: string) => {
      let out = content;
      for (const [blobUrl, canonical] of blobToCanonical) {
        out = out.split(blobUrl).join(canonical);
      }
      return out;
    },
  };
}
