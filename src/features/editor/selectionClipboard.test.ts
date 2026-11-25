import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 护栏：复制/剪切的共享管线只有一套实现（selectionClipboard），LakeEditor 与小记写作卡都必须挂它。
 * 两处各写一份 = 图片来源/换行归一化迟早分叉（其中一份忘了取原图就会把 ?w=1024 缩略写进剪贴板）。
 *
 * **显式契约例外**：桌面文档编辑器 EditorTab 有独立 copy 管线（对任意非折叠选区全量接管，
 * 外发微信/Word 的历史口径）——这是已知且有意的例外（见 selectionClipboard.ts 文件头与
 * docs/audit-261125/02-desktop-ui.md D-01；是否合并语义 = 裁决点 C，未裁决前不算漂移）。
 * 但两套管线的 cut **删除**必须同走 deleteSelectionKernelFirst（内核命令优先、DOM 兜底，260917）。
 */
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const BRIDGE = read("./selectionClipboard.ts");
const LAKE_EDITOR = read("./LakeEditor.tsx");
const QUICK_NOTE_EDITOR = read("../quickNotes/QuickNoteEditor.tsx");
const EDITOR_TAB = read("./EditorTab.tsx");

describe("selectionClipboard（复制/剪切共享管线）", () => {
  it("桥本身走 clipboardHtml.buildClipboardPayload（图片来源/换行归一化都只有一处）", () => {
    expect(BRIDGE).toContain("buildClipboardPayload");
    expect(BRIDGE).toContain("addEventListener(\"copy\"");
    expect(BRIDGE).toContain("addEventListener(\"cut\"");
  });

  it("只在选区含图片时接管（纯文字/表格/画板选区交回内核，保留 ne-clipboard 卡片语义）", () => {
    expect(BRIDGE).toContain("selectionHasImage");
    expect(BRIDGE).toMatch(/!selectionHasImage\(range\)\) return;/);
  });

  it("共享宿主挂的是共享桥，不再内联第二份 copy/cut 处理器", () => {
    expect(LAKE_EDITOR).toContain("attachSelectionClipboard(host");
    expect(LAKE_EDITOR).toContain("detachSelectionClipboard()");
    expect(LAKE_EDITOR).not.toContain("buildClipboardPayload");
    expect(LAKE_EDITOR).not.toContain("copyRichSelection");
  });

  it("小记写作卡也挂共享桥（否则显示缩略会被 WebView 原生复制外发）", () => {
    expect(QUICK_NOTE_EDITOR).toContain("attachSelectionClipboard(host");
    expect(QUICK_NOTE_EDITOR).toContain("detachSelectionClipboard()");
  });

  it("EditorTab 有独立 copy 管线是显式契约例外（全量接管待裁决点 C；删除仍与共享桥同源）", () => {
    expect(EDITOR_TAB).toContain("copyHandler");
    expect(EDITOR_TAB).toContain("cutHandler");
    // 例外只到 copy/paste/cut 的**载荷**为止：删除统一走共享实现（editorCut.test.ts 钉判据）
    expect(EDITOR_TAB).not.toContain("attachSelectionClipboard(");
    expect(EDITOR_TAB).toContain("deleteSelectionKernelFirst(");
    // 共享桥自己也必须声明这份例外（防后续审计把例外当漂移重提）
    expect(BRIDGE).toContain("`EditorTab` 有自己的 copy 管线");
  });
});
