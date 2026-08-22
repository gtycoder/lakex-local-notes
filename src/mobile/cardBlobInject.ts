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

/** card 元素 value="data:{uri-encoded-json}"（含完整 src） */
const CARD_VALUE_RE = /<card\b[^>]*\bname="image"[^>]*\bvalue="data:([^"]+)"[^>]*>/g;

export interface CardBlobInjectResult {
  /** 对当前 editor 所有 image 卡片执行 setCardValue 注入 blob。返回注入的卡片数。 */
  inject(editor: LakeEditorInstance): number;
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
        blobUrl: bytes ? URL.createObjectURL(new Blob([bytes as unknown as BlobPart])) : null,
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

  return {
    inject(editor) {
      let injected = 0;
      // 从 DOM 拿 image 卡片节点（NE-CARD），用 cardData._resetCardValue + sync(false) 注入 blob。
      // 真机实测：这是唯一有效的外部通道（内容注入被强制 pending，setCardValue 命令无重渲染）。
      const cardEls = Array.from(document.querySelectorAll("NE-CARD[data-card-name=\"image\"], ne-card[name=\"image\"]"));
      // 按 cardId（value.id）匹配；匹配不到按顺序对应
      for (const c of cards) {
        if (!c.blobUrl) continue;
        const byCardId = cardEls.find((el) => el.getAttribute("id") === c.cardId);
        const el = byCardId || cardEls[cards.indexOf(c)];
        if (!el) continue;
        try {
          const inst = (el as unknown as { _neRef?: { _instance?: { cardData?: unknown } } })._neRef?._instance;
          const cd = inst?.cardData as unknown as {
            getCardValue?: () => Record<string, unknown>;
            _cardValue?: Record<string, unknown>;
            _resetCardValue?: (v: Record<string, unknown>) => void;
            sync?: (isUser: boolean) => unknown;
          } | undefined;
          if (!cd || typeof cd._resetCardValue !== "function" || typeof cd.sync !== "function") continue;
          // 保留原 value 全部字段，只改 src/status/originalType（确保 width/height/crop 等不丢）
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
        } catch { /* 单卡片失败不阻断 */ }
      }
      return injected;
    },
    restore(content) {
      let out = content;
      for (const [blobUrl, canonical] of blobToCanonical) {
        out = out.split(blobUrl).join(canonical);
      }
      return out;
    },
    revoke() {
      for (const u of blobUrls) URL.revokeObjectURL(u);
    },
  };
}
