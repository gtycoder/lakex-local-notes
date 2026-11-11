import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 护栏：复制/剪切只有一套实现（selectionClipboard），文档编辑器与小记写作卡都必须挂它。
 * 两处各写一份 = 图片来源/换行归一化迟早分叉（其中一份忘了取原图就会把 ?w=1024 缩略写进剪贴板）。
 */
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const BRIDGE = read("./selectionClipboard.ts");
const LAKE_EDITOR = read("./LakeEditor.tsx");
const QUICK_NOTE_EDITOR = read("../quickNotes/QuickNoteEditor.tsx");

describe("selectionClipboard（复制/剪切单一来源）", () => {
  it("桥本身走 clipboardHtml.buildClipboardPayload（图片来源/换行归一化都只有一处）", () => {
    expect(BRIDGE).toContain("buildClipboardPayload");
    expect(BRIDGE).toContain("addEventListener(\"copy\"");
    expect(BRIDGE).toContain("addEventListener(\"cut\"");
  });

  it("只在选区含图片时接管（纯文字/表格/画板选区交回内核，保留 ne-clipboard 卡片语义）", () => {
    expect(BRIDGE).toContain("selectionHasImage");
    expect(BRIDGE).toMatch(/!selectionHasImage\(range\)\) return;/);
  });

  it("文档编辑器挂的是共享桥，不再内联第二份 copy/cut 处理器", () => {
    expect(LAKE_EDITOR).toContain("attachSelectionClipboard(host)");
    expect(LAKE_EDITOR).toContain("detachSelectionClipboard()");
    expect(LAKE_EDITOR).not.toContain("buildClipboardPayload");
    expect(LAKE_EDITOR).not.toContain("copyRichSelection");
  });

  it("小记写作卡也挂共享桥（否则显示缩略会被 WebView 原生复制外发）", () => {
    expect(QUICK_NOTE_EDITOR).toContain("attachSelectionClipboard(host)");
    expect(QUICK_NOTE_EDITOR).toContain("detachSelectionClipboard()");
  });
});
