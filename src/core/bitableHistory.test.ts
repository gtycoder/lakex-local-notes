import { describe, expect, it } from "vitest";
import { createSnapshotHistory } from "./bitableHistory";

describe("快照历史 createSnapshotHistory", () => {
  it("push 后可 undo/redo；redo 后新编辑清空 future", () => {
    const h = createSnapshotHistory<string>();
    expect(h.canUndo).toBe(false);
    h.push("a"); h.push("b");
    expect(h.canUndo).toBe(true);
    expect(h.undo("c")).toBe("b");
    expect(h.undo("b")).toBe("a");
    expect(h.canRedo).toBe(true);
    expect(h.redo("a")).toBe("b");
    h.push("x");
    expect(h.canRedo).toBe(false);
  });
  it("超过 limit 丢弃最旧", () => {
    const h = createSnapshotHistory<number>(2);
    h.push(1); h.push(2); h.push(3);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeNull();
  });
  it("空栈 undo/redo 返回 null", () => {
    const h = createSnapshotHistory<string>();
    expect(h.undo("a")).toBeNull();
    expect(h.redo("a")).toBeNull();
  });
});
