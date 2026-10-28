import { describe, expect, it } from "vitest";
import { resolveCaretRect, type CaretRectInput, type CaretRectLike } from "./caretIntoViewTarget";

/** 常见滚动容器可视高度（移动端键盘收起后 ≈ 790，键盘弹出 ≈ 478；取 790 作为基准）。 */
const ROOT_CH = 790;

function caretLike(top: number, height = 21): CaretRectLike {
  return { top, bottom: top + height, left: 100, right: 103, width: 3, height, x: 100, y: top };
}

function input(patch: Partial<CaretRectInput> = {}): CaretRectInput {
  return {
    anchorNodeType: 3,
    inRoot: true,
    anchorIsRoot: false,
    commonAncestorCoversRoot: false,
    anchorIsLeaf: false,
    rangeRectCount: 1,
    rangeRect: caretLike(300),
    targetRect: caretLike(300, 21),
    rootClientHeight: ROOT_CH,
    ...patch,
  };
}

describe("resolveCaretRect（useCaretIntoView 的'是不是用户光标'判据）", () => {
  it("文本节点折叠光标（常见 caret）：接受 range rect", () => {
    const rect = resolveCaretRect(input());
    expect(rect).not.toBeNull();
    expect(rect?.top).toBe(300);
  });

  it("元素级 anchor + range 无 client rects + 自身 rect 覆盖容器（编辑器宿主 div，261027 实测 h≈2874）：拒绝", () => {
    // 这条就是「点完成/切文档/开抽屉后跳到末尾」的根因：.lake-editor 宿主 rect = 整篇正文高度
    const rect = resolveCaretRect(input({
      anchorNodeType: 1,
      anchorIsLeaf: false,
      rangeRectCount: 0,
      rangeRect: null,
      targetRect: { top: 52, bottom: 2926, left: 0, right: 412, width: 412, height: 2874, x: 0, y: 52 },
    }));
    expect(rect).toBeNull();
  });

  it("元素级 anchor 的叶级元素但 rect 也覆盖容器（长段落整块）：拒绝", () => {
    const rect = resolveCaretRect(input({
      anchorNodeType: 1,
      anchorIsLeaf: true,
      rangeRectCount: 0,
      rangeRect: null,
      // 0.6 * 790 = 474 ⇒ 600 也算整块
      targetRect: { top: 0, bottom: 600, left: 0, right: 400, width: 400, height: 600, x: 0, y: 0 },
    }));
    expect(rect).toBeNull();
  });

  it("选区落在滚动容器自身（anchor===root）：拒绝", () => {
    const rect = resolveCaretRect(input({
      anchorNodeType: 1,
      anchorIsRoot: true,
      anchorIsLeaf: false,
      rangeRectCount: 0,
      rangeRect: null,
      targetRect: { top: 52, bottom: 842, left: 0, right: 412, width: 412, height: 790, x: 0, y: 52 },
    }));
    expect(rect).toBeNull();
  });

  it("选区 commonAncestor 包住 root（跨容器选区）：拒绝", () => {
    const rect = resolveCaretRect(input({ commonAncestorCoversRoot: true }));
    expect(rect).toBeNull();
  });

  it("anchor 不在当前正文容器（keep-alive 的别的文档）：拒绝", () => {
    expect(resolveCaretRect(input({ inRoot: false }))).toBeNull();
  });

  it("叶级空 <p>（元素级 anchor、无 range rects、rect 只有一行高）：接受", () => {
    const rect = resolveCaretRect(input({
      anchorNodeType: 1,
      anchorIsLeaf: true,
      rangeRectCount: 0,
      rangeRect: null,
      targetRect: caretLike(420, 24),
    }));
    expect(rect).not.toBeNull();
    expect(rect?.height).toBe(24);
  });

  it("元素级 anchor 但 range 有 client rects（单元格内选区）：接受 range rect", () => {
    const rect = resolveCaretRect(input({
      anchorNodeType: 1,
      anchorIsLeaf: false,
      rangeRectCount: 1,
      rangeRect: caretLike(510, 21),
      targetRect: { top: 400, bottom: 900, left: 0, right: 400, width: 400, height: 500, x: 0, y: 400 },
    }));
    expect(rect?.top).toBe(510);
  });

  it("rect 为 0×0：拒绝（与旧实现的兜底判断同口径）", () => {
    const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
    expect(resolveCaretRect(input({ rangeRect: zero, targetRect: zero }))).toBeNull();
  });

  it("文本 anchor 没有 range 矩形但最近块很小（有的内核折叠 Range 不给 client rects）：接受兜底 rect", () => {
    const rect = resolveCaretRect(input({ rangeRectCount: 0, rangeRect: null, targetRect: caretLike(300, 24) }));
    expect(rect).not.toBeNull();
    expect(rect?.top).toBe(300);
  });

  it("文本 anchor 没有 range 矩形且最近块是整篇（编辑器重建瞬间）：拒绝，不拿整块 rect 顶替", () => {
    const rect = resolveCaretRect(input({
      rangeRectCount: 0,
      rangeRect: null,
      targetRect: { top: 52, bottom: 2926, left: 0, right: 412, width: 412, height: 2874, x: 0, y: 52 },
    }));
    expect(rect).toBeNull();
  });

  it("anchor 既不是元素也不是文本：拒绝", () => {
    expect(resolveCaretRect(input({ anchorNodeType: 9 }))).toBeNull();
  });
});
