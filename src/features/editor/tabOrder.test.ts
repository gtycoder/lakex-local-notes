/**
 * 标签槽位排序单测（261012）：分屏合并标签拖拽后**不许丢页、不许打散组**。
 */
import { describe, expect, it } from "vitest";
import { expandTabSlots, moveSlot } from "./tabOrder";

describe("moveSlot（槽位内移动）", () => {
  it("向后/向前移动", () => {
    expect(moveSlot(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveSlot(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("原位/越界 from 时原样返回（不改引用，避免无意义的重排）", () => {
    const slots = ["a", "b", "c"];
    expect(moveSlot(slots, 1, 1)).toBe(slots);
    expect(moveSlot(slots, -1, 1)).toBe(slots);
    expect(moveSlot(slots, 5, 1)).toBe(slots);
  });

  it("to 越界时夹到端点", () => {
    expect(moveSlot(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveSlot(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
  });
});

describe("expandTabSlots（槽位 → 真实标签顺序）", () => {
  it("分屏组的两页整块落回合并标签所在槽位，保持组内次序", () => {
    // 槽位 = [X, 合并标签(代表 R), Y]，真实模型里组是 {R, L}
    expect(expandTabSlots(["X", "R", "Y"], "R", ["R", "L"])).toEqual(["X", "R", "L", "Y"]);
  });

  it("拖到末尾：组整体跟着走，且组内两页仍相邻", () => {
    const slots = moveSlot(["X", "R", "Y"], 1, 2);
    expect(expandTabSlots(slots, "R", ["R", "L"])).toEqual(["X", "Y", "R", "L"]);
  });

  it("没有分屏组时是恒等映射（不改变旧行为）", () => {
    expect(expandTabSlots(["a", "b"], null, [])).toEqual(["a", "b"]);
  });

  it("槽位里若混进组内非锚点成员，也不会被重复列出（防御）", () => {
    expect(expandTabSlots(["X", "R", "L", "Y"], "R", ["R", "L"])).toEqual(["X", "R", "L", "Y"]);
  });

  it("组员只剩一个（自愈中的一帧）也不会丢页", () => {
    expect(expandTabSlots(["X", "R", "Y"], "R", ["R"])).toEqual(["X", "R", "Y"]);
  });
});
