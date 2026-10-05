import type { AiAssetRef } from "../../../core/aiProviders.js";
import { parseAssetRef } from "./selectionToolbarModel.js";

/**
 * 选区内的图片 → 资产引用（多模态 · 261005）。
 *
 * 取法：\`range.cloneContents()\` 拿到选区克隆片段，再在片段里找图片卡片。
 * 比逐节点 \`intersectsNode\` 更直接（片段里就是被选中的内容），也不依赖内核 view 映射。
 * 只认**本地资产 URL**（\`parseAssetRef\`）：data:/外链解析不到 ⇒ 主进程也读不到，直接跳过。
 * 同一张图按**磁盘名**去重。
 */
export const SELECTION_IMAGE_SELECTOR = "ne-card[data-card-name='image'] img, img.ne-image";

export function collectSelectionImageRefs(range: Range | null): AiAssetRef[] {
  if (!range || range.collapsed) return [];
  let frag: DocumentFragment;
  try { frag = range.cloneContents(); } catch { return []; }
  const out: AiAssetRef[] = [];
  const seen = new Set<string>();
  for (const img of Array.from(frag.querySelectorAll<HTMLImageElement>(SELECTION_IMAGE_SELECTOR))) {
    const ref = parseAssetRef(img.getAttribute("src") ?? "");
    if (!ref || seen.has(ref.filename)) continue;
    seen.add(ref.filename);
    out.push({ noteId: ref.noteId, filename: ref.filename });
  }
  return out;
}

/** 图片卡片 src → 资产引用（图片浮栏「AI」入口用）；非本地资产返回 null。 */
export function imageCardAssetRef(src: string | null | undefined): AiAssetRef | null {
  const ref = parseAssetRef(src ?? "");
  return ref ? { noteId: ref.noteId, filename: ref.filename } : null;
}
