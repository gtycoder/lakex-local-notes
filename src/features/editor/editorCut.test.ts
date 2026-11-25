/**
 * 编辑器「剪切」护栏（260917；261125 D-01② 扩到共享桥）。
 *
 * 背景：cut 在 capture 阶段 stopImmediatePropagation 抢在内核 cut 之前，早前删除用
 * document.execCommand("delete") 做 **DOM 级删除** ⇒ 内核模型不变，点一下块
 * 就被模型重绘回来（实测：选区文字消失 → 点块恢复），转换后的内容同样受影响。
 * 修法：删除统一走内核命令（kernel/editor.execCommand("delete")），DOM 删除仅作兜底 ——
 * 两套 copy 管线（EditorTab 自有 / 共享桥 attachSelectionClipboard）**同走一份删除实现**
 * selectionClipboard.deleteSelectionKernelFirst（此前共享桥 cut 只删 DOM = 同型 bug，D-01②）。
 *
 * vitest 跑在 node 环境、起不了内核，故这里做源码级断言（与 blockMenuNative/cssLayers 同一套路）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EDITOR_TAB = readFileSync(new URL("./EditorTab.tsx", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("./selectionClipboard.ts", import.meta.url), "utf8");
const LAKE_EDITOR = readFileSync(new URL("./LakeEditor.tsx", import.meta.url), "utf8");
const QUICK_NOTE_EDITOR = readFileSync(new URL("../quickNotes/QuickNoteEditor.tsx", import.meta.url), "utf8");

describe("编辑器剪切：删除必须同步内核模型", () => {
  it("共享删除实现：内核命令优先、DOM 删除仅兜底", () => {
    expect(BRIDGE).toMatch(/kernel\.execCommand\("delete"\)/);
    // 内核删除必须存在，且排在裸 DOM 删除兜底之前
    const kernelAt = BRIDGE.indexOf('kernel.execCommand("delete")');
    const domFallbackAt = BRIDGE.indexOf('else document.execCommand("delete")');
    expect(kernelAt).toBeGreaterThan(-1);
    expect(domFallbackAt).toBeGreaterThan(-1);
    expect(kernelAt).toBeLessThan(domFallbackAt);
  });

  it("共享桥 cut 不得只用 DOM delete（必须经 deleteSelection 回调走内核优先实现）", () => {
    // 桥的 cut 删除只经 deleteSelectionKernelFirst / 宿主回调，不再内联裸 DOM 删除
    expect(BRIDGE).toMatch(/deleteSelection\?: \(\) => void/);
    expect(BRIDGE).toMatch(/options\.deleteSelection \?\?/);
    expect(BRIDGE.indexOf("deleteSelectionKernelFirst")).toBeGreaterThan(-1);
  });

  it("EditorTab cutHandler 复用同一删除实现（不内联第二份删除判据）", () => {
    expect(EDITOR_TAB).toMatch(/deleteSelectionKernelFirst\(editorRef\.current\)/);
    expect(EDITOR_TAB).not.toContain('else document.execCommand("delete")');
  });

  it("共享桥两个挂载方都传内核优先删除（LakeEditor / 小记写作卡）", () => {
    for (const src of [LAKE_EDITOR, QUICK_NOTE_EDITOR]) {
      expect(src).toMatch(/deleteSelection: \(\) => deleteSelectionKernelFirst\(/);
    }
  });
});
