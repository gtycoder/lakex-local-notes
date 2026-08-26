/**
 * 移动端图片卡片 blob 注入（setCardValue 命令版，D8 收尾）。
 *
 * 背景：Lake 编辑器创建图片卡片时强制 original.type=binary → status=pending → 清空 src
 * （无视内容层注入的 src/status）。唯一外部通道是官方命令 setCardValue
 * （dist lakex-editor-react-component.es.js L59905-59909：
 *   renderer.execCommand("setCardValue", isUser, nodeId, value) → setAttribute(value) → commitJob）。
 *
 * 本模块在卡片渲染后（DOM 存在）对每个 image 卡片调用该命令，注入 src=blob + status=done +
 * originalType=link，让卡片走非 binary 路径直接渲染 blob。
 * - 显示层：不动 .lake 存储（getDocument 输出 blob，由 restore() 还原为 canonical）。
 * - 保存还原：restore(content) 把 blob URL 换回 canonical http URL（blob→canonical 映射）。
 */
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";
import { lakeBridge } from "../features/editor/lakeRuntime";
import { parseLocalAssetUrl } from "../core/assetUrl.js";
import { bridge } from "./bridge";
import { registerRuntimeBlob, unregisterRuntimeBlob } from "./cachePort.js";

/**
 * 跨文档进入/模式切换复用的 blob 缓存（图片破裂优化）：
 * canonical src → blob URL + 引用计数。同一张图在文档重开/模式切换间复用同一 blob URL，
 * 注入时可立即命中；引用归零才 revoke（受 cachePort 注册表与"清缓存"统一管理）。
 */
const blobCache = new Map<string, { url: string; refs: number }>();

function cachedBlobUrl(canonicalSrc: string, bytes: Uint8Array): string | null {
  const hit = blobCache.get(canonicalSrc);
  if (hit) {
    hit.refs += 1;
    return hit.url;
  }
  const url = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]));
  blobCache.set(canonicalSrc, { url, refs: 1 });
  registerRuntimeBlob(url);
  return url;
}

function releaseBlobUrl(canonicalSrc: string, url: string): void {
  const hit = blobCache.get(canonicalSrc);
  if (!hit) return;
  hit.refs -= 1;
  if (hit.refs <= 0) {
    blobCache.delete(canonicalSrc);
    URL.revokeObjectURL(url);
    unregisterRuntimeBlob(url);
  }
}

/** card 元素 value="data:{uri-encoded-json}"（含完整 src） */
const CARD_VALUE_RE = /<card\b[^>]*\bname="image"[^>]*\bvalue="data:([^"]+)"[^>]*>/g;

export interface CardBlobInjectResult {
  /** 对当前 editor 所有 image 卡片执行 setCardValue 注入 blob。返回注入的卡片数。 */
  inject(editor: LakeEditorInstance): number;
  /** 编辑器重建后调用：清空幂等集（injectedIds 按 canonicalSrc 去重仅限同一编辑器实例内，
   * 跨重建（viewer↔editor 切换）必须重置，否则重建后的新卡片 DOM 会被幂等挡住永不注入）。 */
  reset(): void;
  /** 把内容（getDocument 输出）里的 blob URL 还原为 canonical http。 */
  restore(content: string): string;
  /** 释放所有 blob URL。 */
  revoke(): void;
}

/**
 * 从文档内容扫描所有 image 卡片的 canonical src（供注入前建立 blob）。
 * 返回 [{ cardId, canonicalSrc, blobUrl }]——cardId 是 value.id，用于匹配 DOM 节点。
 */
function scanImageCards(content: string): Array<{ cardId: string; canonicalSrc: string; blobUrl: string | null }> {
  const out: Array<{ cardId: string; canonicalSrc: string; blobUrl: string | null }> = [];
  for (const m of content.matchAll(CARD_VALUE_RE)) {
    try {
      const obj = JSON.parse(decodeURIComponent(m[1]).replace(/^data:/, ""));
      if (typeof obj.src !== "string") continue;
      const ref = parseLocalAssetUrl(obj.src);
      if (!ref) continue;
      const bytes = bridge.getAssetBytes(ref.noteId, ref.filename);
      out.push({
        cardId: typeof obj.id === "string" ? obj.id : "",
        canonicalSrc: obj.src,
        blobUrl: bytes ? cachedBlobUrl(obj.src, bytes) : null,
      });
    } catch { /* 跳过无法解析的卡片 */ }
  }
  return out;
}

/**
 * 为移动端 editor 建立 blob 注入器：inject() 用 setCardValue 命令把卡片 src 换成 blob，
 * restore() 把 getDocument 输出里的 blob 还原为 canonical（保存前调用）。
 */
export function createCardBlobInjector(content: string): CardBlobInjectResult {
  const cards = scanImageCards(content);
  const blobToCanonical = new Map<string, string>();
  for (const c of cards) {
    if (c.blobUrl) blobToCanonical.set(c.blobUrl, c.canonicalSrc);
  }
  const blobUrls = cards.map((c) => c.blobUrl).filter((u): u is string => u !== null);
  /** 已注入的卡片（按 canonicalSrc 幂等）：MutationObserver/多次尝试重复触发不再重注入，避免闪烁。 */
  const injectedIds = new Set<string>();

  return {
    inject(editor) {
      let injected = 0;
      // 从 DOM 拿 image 卡片节点（NE-CARD）
      const cardEls = Array.from(document.querySelectorAll("NE-CARD[data-card-name=\"image\"], ne-card[name=\"image\"]"));
      // renderer（编辑态 fallback 用 execCommand）
      const renderer = lakeBridge(editor).renderer;
      const canExec = !!renderer && typeof renderer.execCommand === "function";
      const execCmd = canExec && renderer?.execCommand
        ? (name: string, ...args: unknown[]) => renderer.execCommand!(name, ...args)
        : null;
      // 按 cardId（value.id）匹配；匹配不到按顺序对应
      for (const c of cards) {
        if (!c.blobUrl) continue;
        if (injectedIds.has(c.canonicalSrc)) continue; // 幂等：已注入的卡片跳过（Observer/重试不重复注入）
        const byCardId = cardEls.find((el) => el.getAttribute("id") === c.cardId);
        const el = byCardId || cardEls[cards.indexOf(c)];
        if (!el) continue;
        const nodeId = el.getAttribute("id") || "";
        try {
          // 路径 1：viewer 卡片有 cardData → _resetCardValue + sync(false)（真机实测有效）
          const inst = (el as unknown as { _neRef?: { _instance?: { cardData?: unknown } } })._neRef?._instance;
          const cd = inst?.cardData as unknown as {
            getCardValue?: () => Record<string, unknown>;
            _cardValue?: Record<string, unknown>;
            _resetCardValue?: (v: Record<string, unknown>) => void;
            sync?: (isUser: boolean) => unknown;
          } | undefined;
          if (cd && typeof cd._resetCardValue === "function" && typeof cd.sync === "function") {
            const old = (typeof cd.getCardValue === "function" ? cd.getCardValue() : cd._cardValue) ?? {};
            const newValue = {
              ...old,
              src: c.blobUrl,
              status: "done",
              originalType: "link", // 非 binary，走非上传路径
            };
            delete (newValue as Record<string, unknown>).taskId;
            delete (newValue as Record<string, unknown>).clientId;
            cd._resetCardValue(newValue);
            cd.sync(false); // 必须传 boolean（set-card-value-command.ts:17 断言）
            injected++;
            injectedIds.add(c.canonicalSrc);
            continue;
          }
          // 路径 2：编辑态卡片无 cardData → execCommand("setCardValue")（官方命令通道）
          if (execCmd && nodeId) {
            const newValue = {
              src: c.blobUrl,
              originalType: "link",
              status: "done",
              name: c.canonicalSrc.split("/").pop() ?? "image",
              size: 0,
              width: undefined,
              height: undefined,
              from: "ui",
              id: nodeId,
            };
            execCmd("setCardValue", true, nodeId, newValue);
            injected++;
            injectedIds.add(c.canonicalSrc);
          }
        } catch { /* 单卡片失败不阻断 */ }
      }
      return injected;
    },
    reset() {
      injectedIds.clear();
    },
    restore(content) {
      let out = content;
      for (const [blobUrl, canonical] of blobToCanonical) {
        // Lake 会给 img src 的 blob URL 追加 ?date= 缓存破坏参数；split(blobUrl) 匹配不到带参形态，
        // 导致保存时 blob 无法还原为 canonical → 污染存储。用 uuid 前缀正则，容忍任意参数后缀。
        // 形态 2：card value 里 blob URL 是 URI 编码（blob%3Ahttps%3A%2F%2Flocalhost%2Fuuid）——
        // 明文正则匹配不到 → 还原失败、blob 污染存储（改动文字保存后图片裂的根因）。
        // 两种形态都还原；编码形态替换为编码 canonical（保持 value 的 URI 编码一致性）。
        const uuid = (blobUrl.split("/").pop() ?? "").split("?")[0];
        if (!uuid) continue;
        const re = new RegExp("(?:blob:|blob%3A)[^\\s\"'<>]*?" + uuid + "(?:\\?[^\\s\"'<>]*)?", "g");
        const encodedCanonical = encodeURIComponent(canonical);
        out = out.replace(re, (m) => (m.startsWith("blob%3A") ? encodedCanonical : canonical));
      }
      return out;
    },
    revoke() {
      // 释放缓存引用（引用归零才真正 revoke + 注销注册表；跨进入复用的 blob 保留）
      for (const c of cards) {
        if (c.blobUrl) releaseBlobUrl(c.canonicalSrc, c.blobUrl);
      }
    },
  };
}
