import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 列表/预览图片的解码契约（261115，MODERN-WEB-AUDIT A15）。
 *
 * 判据：这些"一次渲染很多张"的宿主里，**每个真实 <img> 都带 decoding="async"**；
 * 非首屏列表里的还要 loading="lazy"。
 * 期望数量按文件写死（不从 "<img" 出现次数推——注释里也会提到 <img>，那种计数会假红）。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(HERE, "..");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");
const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

/** 文件 → { imgs: 期望的图片元素数, lazy: 是否要求 loading=lazy } */
const FILES: Record<string, { imgs: number; lazy: boolean }> = {
  "components/app/HistoryPanel.tsx": { imgs: 1, lazy: true },
  // 资源浏览器的大图预览是**点开即看**的单张图：不 lazy（既有护栏 assetsBrowser.test.ts 明确禁止），只要求 async 解码。
  "components/app/AssetsBrowser.tsx": { imgs: 1, lazy: false },
  "components/app/NoteInfoDialog.tsx": { imgs: 1, lazy: true },
  "features/bitable/bitableCells.tsx": { imgs: 2, lazy: true },
  "features/bitable/BitableGalleryView.tsx": { imgs: 1, lazy: true },
  "features/quickNotes/QuickNotePreview.tsx": { imgs: 1, lazy: true },
  "mobile/bitable/MobileBitableGalleryView.tsx": { imgs: 1, lazy: true },
  "mobile/bitable/MobileBitableValue.tsx": { imgs: 1, lazy: true },
  "mobile/ai/AiMessageImages.tsx": { imgs: 1, lazy: true },
};

describe("图片解码/懒加载契约（A15）", () => {
  it("每个宿主里的 <img> 都有 decoding=async（列表还要求 loading=lazy）", () => {
    const offenders: string[] = [];
    for (const [rel, { imgs, lazy }] of Object.entries(FILES)) {
      const source = read(rel);
      const decoding = countOf(source, 'decoding="async"');
      if (decoding < imgs) offenders.push(rel + "（期望 " + imgs + " 个 decoding，实际 " + decoding + "）");
      if (lazy && countOf(source, 'loading="lazy"') < imgs) offenders.push(rel + "（缺 loading=lazy）");
    }
    expect(offenders).toEqual([]);
  });
});
