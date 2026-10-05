import { describe, expect, it, vi } from "vitest";
import { applyModelRange, captureModelRange, positionAfterModelRange, type CapturedModelRange } from "./aiModelSelection";

/**
 * AI 回写落点/选区护栏（261005）。
 *
 * 背景：用户报「插入到选区后」把 4 项无序列表压成 1 项（只剩一个项目符号）、每行块句柄消失。
 * 根因 = 旧实现用「原文(纯文本) + AI」整体 insertAtSelection 替换原选区，块结构被 markdown 重解析。
 * 现在改为：只把 AI 结果用 insertAtPosition 插到「选区末端所在顶层块」之后。这里锁两件事：
 *   ① 落点按**模型父子关系**算（内核把「某元素之后」的 DOM 映射少 1，不能用）；
 *   ② applyModelRange 走 kernel.execCommand（editor.execCommand 会抛且被静默吞掉）。
 */

/** 假模型节点：id 放外层（内核有的节点把 id 放 _id）。 */
function node(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, _children: [], ...extra };
}
/** 文本节点（没有 id，用 _id；没有 _children）。 */
function text(id: string, data = "x"): Record<string, unknown> {
  return { _id: id, _data: data, _parent: null };
}

describe("positionAfterModelRange：顶层块之后", () => {
  it("4 项列表：末端在最后一项 ⇒ offset = 4（不是内核 DOM 映射的 3）", () => {
    const root = node("root");
    const items = [0, 1, 2, 3].map((i) => node("li" + i));
    const texts = items.map((_, i) => text("t" + i));
    items.forEach((li, i) => { li._parent = root; li._children = [texts[i]]; texts[i]._parent = li; });
    root._children = items;

    const range: CapturedModelRange = { start: { node: texts[0], offset: 0 }, end: { node: texts[3], offset: 2 } };
    expect(positionAfterModelRange(range)).toEqual({ id: "root", offset: 4 });
  });

  it("选区末端在中间块 ⇒ 只插到那一块之后", () => {
    const root = node("root");
    const p1 = node("p1"), p2 = node("p2");
    const t1 = text("t1"), t2 = text("t2");
    p1._parent = root; p2._parent = root; t1._parent = p1; t2._parent = p2;
    p1._children = [t1]; p2._children = [t2]; root._children = [p1, p2];

    const range: CapturedModelRange = { start: { node: t1, offset: 0 }, end: { node: t1, offset: 1 } };
    expect(positionAfterModelRange(range)).toEqual({ id: "root", offset: 1 });
  });

  it("末端在容器（高亮块）内部 ⇒ 落到整个容器之后", () => {
    const root = node("root");
    const alert = node("alert"), p = node("p"), t = text("t");
    alert._parent = root; p._parent = alert; t._parent = p;
    alert._children = [p]; p._children = [t]; root._children = [alert];

    expect(positionAfterModelRange({ start: { node: t, offset: 0 }, end: { node: t, offset: 1 } }))
      .toEqual({ id: "root", offset: 1 });
  });

  it("末端就是根（空文档）⇒ 落在末尾；无 range ⇒ null", () => {
    const root = node("root");
    root._children = [node("p1"), node("p2")];
    expect(positionAfterModelRange({ start: { node: root, offset: 0 }, end: { node: root, offset: 0 } }))
      .toEqual({ id: "root", offset: 2 });
    expect(positionAfterModelRange(null)).toBeNull();
    expect(positionAfterModelRange({ start: { node: {}, offset: 0 }, end: { node: null, offset: 0 } } as unknown as CapturedModelRange)).toBeNull();
  });
});

describe("applyModelRange：走 kernel.execCommand", () => {
  const range: CapturedModelRange = { start: { node: { _id: "a" }, offset: 0 }, end: { node: { _id: "b" }, offset: 2 } };

  it("优先用 kernel.execCommand（editor.execCommand 拿模型节点会抛）", () => {
    const kernelExec = vi.fn((_name: string, _arg: unknown) => true);
    const editorExec = vi.fn((_name: string, _arg: unknown) => true);
    const editor = { kernel: { execCommand: kernelExec }, execCommand: editorExec };
    expect(applyModelRange(editor, range)).toBe(true);
    expect(kernelExec).toHaveBeenCalledTimes(1);
    expect(kernelExec.mock.calls[0][0]).toBe("selection");
    expect(editorExec).not.toHaveBeenCalled();
  });

  it("没有 kernel 时退回 editor.execCommand；抛错返回 false 不炸", () => {
    const editorExec = vi.fn(() => true);
    expect(applyModelRange({ execCommand: editorExec }, range)).toBe(true);
    expect(editorExec).toHaveBeenCalledTimes(1);
    expect(applyModelRange({ execCommand: () => { throw new Error("boom"); } }, range)).toBe(false);
    expect(applyModelRange({}, range)).toBe(false);
    expect(applyModelRange({}, null)).toBe(false);
  });
});

describe("captureModelRange", () => {
  it("从 kernel.document.selection.firstRange 取 start/end；拿不到返回 null", () => {
    const editor = { kernel: { document: { selection: { firstRange: { start: { node: { _id: "a" }, offset: 1 }, end: { node: { _id: "b" }, offset: 3 } } } } } };
    expect(captureModelRange(editor)).toEqual({ start: { node: { _id: "a" }, offset: 1 }, end: { node: { _id: "b" }, offset: 3 } });
    expect(captureModelRange({})).toBeNull();
    expect(captureModelRange({ kernel: { document: { selection: { firstRange: { start: {}, end: {} } } } } })).toBeNull();
  });
});
