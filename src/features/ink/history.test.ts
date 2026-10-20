import { describe, expect, it } from "vitest";
import { pushBoundedHistory } from "./history.js";

describe("手写板撤销栈边界", () => {
  it("同时受条数上限约束", () => {
    const stack: string[] = [];
    for (let i = 0; i < 5; i += 1) pushBoundedHistory(stack, `v${i}`, 3, 100);
    expect(stack).toEqual(["v2", "v3", "v4"]);
  });

  it("同时受总字符预算约束", () => {
    const stack: string[] = [];
    pushBoundedHistory(stack, "aaaa", 60, 10);
    pushBoundedHistory(stack, "bbbb", 60, 10);
    pushBoundedHistory(stack, "cccc", 60, 10);
    expect(stack).toEqual(["bbbb", "cccc"]);
  });

  it("单条超过预算时不会留下无法撤销的内存副本", () => {
    const stack: string[] = [];
    pushBoundedHistory(stack, "123456", 60, 5);
    expect(stack).toEqual([]);
  });
});
