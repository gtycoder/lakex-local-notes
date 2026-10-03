// @vitest-environment jsdom
/**
 * 块选区「块容器」行为测试（261004）。
 *
 * 直接跑 vendor 的纯 DOM 辅助函数（无内核依赖）：
 *  - 顶层多块：容器 = .ne-engine；
 *  - **引用内部**：选区落在同一个 ne-quote 内时，容器 = 该 ne-quote（引用内每个 brick 都是顶层块）——
 *    这是云端「引用内列表可单独/批量块编辑」的 DOM 基础（见 docs/LAKEX-CONTRACT.md §5.8.6）；
 *  - 列表父项 + 子项 = 一个整段，不算多块选区（Issue 3 语义不变）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { blockSpanElements, hasMultiBlockSelection, selectedTopBlocks } from "../../../vendor/lakex-doc-react/src/components/BlockHoverHandle/blockMenuHelpers";

function mountEngine(html: string): HTMLElement {
  document.body.innerHTML = '<div class="ne-engine">' + html + "</div>";
  return document.querySelector(".ne-engine") as HTMLElement;
}

function selectBetween(start: Node, end: Node): void {
  const range = document.createRange();
  range.setStartBefore(start);
  range.setEndAfter(end);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("selectedTopBlocks 的块容器（261004）", () => {
  it("顶层多块：返回选区相交的顶层块", () => {
    const eng = mountEngine('<ne-p id="a">A</ne-p><ne-p id="b">B</ne-p>');
    selectBetween(eng.children[0], eng.children[1]);
    expect(selectedTopBlocks().map((el) => el.id)).toEqual(["a", "b"]);
    expect(hasMultiBlockSelection()).toBe(true);
  });

  it("引用内部：选区在同一 ne-quote 内 ⇒ 按该引用的子块识别（不是外层 quote）", () => {
    const eng = mountEngine('<ne-quote id="q"><ne-tli id="t1" ne-level="0">1</ne-tli><ne-tli id="t2" ne-level="0">2</ne-tli></ne-quote><ne-p id="after">x</ne-p>');
    const quote = eng.children[0];
    selectBetween(quote.children[0], quote.children[1]);
    const blocks = selectedTopBlocks();
    expect(blocks.map((el) => el.id)).toEqual(["t1", "t2"]);
    expect(hasMultiBlockSelection()).toBe(true);
  });

  it("列表父项 + 子项（同一整段）不算多块选区", () => {
    const eng = mountEngine('<ne-tli id="p" ne-level="0">p</ne-tli><ne-tli id="c" ne-level="1">c</ne-tli>');
    const parent = eng.children[0] as HTMLElement;
    selectBetween(parent, eng.children[1]);
    expect(blockSpanElements(parent).map((el) => el.id)).toEqual(["p", "c"]);
    expect(hasMultiBlockSelection()).toBe(false);
  });
});
