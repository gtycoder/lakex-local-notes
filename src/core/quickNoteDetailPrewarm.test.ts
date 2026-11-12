import { describe, expect, it } from "vitest";
import { QUICK_NOTE_DETAIL_PREWARM_LIMIT, quickNotePrewarmIds } from "./quickNoteDetailPrewarm";

const item = (id: string, contentHash = "h-" + id) => ({ id, contentHash });

describe("小记首屏正文预热判据（261112 闪屏）", () => {
  it("缓存缺失的按列表顺序取前 limit 条", () => {
    expect(quickNotePrewarmIds([item("a"), item("b"), item("c")], new Map(), 2)).toEqual(["a", "b"]);
  });

  it("已缓存且 contentHash 相同 ⇒ 跳过（零额外 IPC）", () => {
    const cached = new Map([["a", "h-a"], ["b", "h-b"]]);
    expect(quickNotePrewarmIds([item("a"), item("b"), item("c")], cached, 8)).toEqual(["c"]);
  });

  it("contentHash 变了 ⇒ 重新预热（同步/他端改动后缓存已被失效）", () => {
    const cached = new Map([["a", "stale"]]);
    expect(quickNotePrewarmIds([item("a", "fresh")], cached, 8)).toEqual(["a"]);
  });

  it("上限严格生效，且 limit<=0 不预热", () => {
    const items = Array.from({ length: 30 }, (_, index) => item("n" + index));
    expect(quickNotePrewarmIds(items, new Map(), 3)).toEqual(["n0", "n1", "n2"]);
    expect(quickNotePrewarmIds(items, new Map(), 0)).toEqual([]);
    expect(QUICK_NOTE_DETAIL_PREWARM_LIMIT).toBeGreaterThan(0);
    expect(QUICK_NOTE_DETAIL_PREWARM_LIMIT).toBeLessThan(24); // 小于虚拟窗口阈值：只预热一屏，不搬整个窗口
  });

  it("空列表 / 全部命中缓存 ⇒ 不预热", () => {
    expect(quickNotePrewarmIds([], new Map())).toEqual([]);
    expect(quickNotePrewarmIds([item("a")], new Map([["a", "h-a"]]))).toEqual([]);
  });
});
