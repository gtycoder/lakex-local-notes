/** 前端撤销栈纯逻辑（261017）：行为对齐思源 LocalUndo 的"一步一停"，并带光标位置。 */
import { describe, expect, it } from "vitest";
import { canRedo, canUndo, createStack, pushSnapshot, redoStep, undoStep } from "./snapshotUndoModel";

const snap = (doc: string, offset = 0) => ({ doc, pos: { blockId: "b1", offset }, sel: null });

describe("snapshotUndoModel", () => {
  it("创建后无可撤销/重做；push 后可撤、清空重做", () => {
    let s = createStack("a");
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
    s = pushSnapshot(s, snap("ab"));
    expect(canUndo(s)).toBe(true);
    expect(canRedo(s)).toBe(false);
  });

  it("内容相同不产生新步（输入法组合期的重复 contentchange）", () => {
    let s = createStack("a");
    s = pushSnapshot(s, snap("ab"));
    const before = s;
    s = pushSnapshot(s, snap("ab", 9));
    expect(s).toBe(before);
  });

  it("undo/redo 按步走且带回光标位置；中途 push 会截断重做分支", () => {
    let s = createStack("a");
    s = pushSnapshot(s, snap("ab", 2));
    s = pushSnapshot(s, snap("abc", 3));
    const u1 = undoStep(s);
    expect(u1.snap?.doc).toBe("ab");
    expect(u1.snap?.pos?.offset).toBe(2);
    // 内核选区 JSON 必须随快照往返（撤销后新输入落点由它决定）
    expect(u1.snap?.sel).toBeNull();
    const u2 = undoStep(u1.stack);
    expect(u2.snap?.doc).toBe("a");
    const r1 = redoStep(u2.stack);
    expect(r1.snap?.doc).toBe("ab");
    const branch = pushSnapshot(r1.stack, snap("abX", 3));
    expect(canRedo(branch)).toBe(false);
    expect(branch.history[branch.index].doc).toBe("abX");
  });

  it("到头后 undo/redo 返回 null 且栈不变", () => {
    const s = createStack("a");
    expect(undoStep(s).snap).toBeNull();
    expect(redoStep(s).snap).toBeNull();
  });

  it("超过条数上限：裁最旧、index 跟随；仍能连续撤销剩余步", () => {
    let s = createStack("0");
    for (let i = 1; i <= 5; i++) s = pushSnapshot(s, snap(String(i)), { maxEntries: 3, maxTotalChars: 1e9 });
    expect(s.history.map((h) => h.doc)).toEqual(["3", "4", "5"]);
    expect(canUndo(s)).toBe(true);
    const u = undoStep(undoStep(s).stack);
    expect(u.snap?.doc).toBe("3");
    expect(canUndo(u.stack)).toBe(false);
  });

  it("超过总字符上限同样裁剪（保留当前项）", () => {
    let s = createStack("aa");
    s = pushSnapshot(s, snap("aaaa"), { maxEntries: 40, maxTotalChars: 8 });
    s = pushSnapshot(s, snap("aaaaaa"), { maxEntries: 40, maxTotalChars: 8 });
    expect(s.history[s.history.length - 1].doc).toBe("aaaaaa");
    expect(s.history.length).toBeLessThanOrEqual(2);
  });
});
