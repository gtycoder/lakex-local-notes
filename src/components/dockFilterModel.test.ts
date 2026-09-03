/** 隐藏式筛选状态机：展开/收起、清空时机、失焦与外部写入的一致性。 */
import { describe, expect, it } from "vitest";
import { initialDockFilterState, isFilterActive, stepDockFilter } from "./dockFilterModel";

const CLOSED = { open: false };
const OPEN = { open: true };

describe("筛选词生效判定", () => {
  it("空串与纯空格都不算生效", () => {
    expect(isFilterActive("")).toBe(false);
    expect(isFilterActive("   ")).toBe(false);
    expect(isFilterActive("向量")).toBe(true);
  });
  it("初始状态跟随宿主已有筛选词（避免看不见却在筛选）", () => {
    expect(initialDockFilterState("")).toEqual(CLOSED);
    expect(initialDockFilterState("abc")).toEqual(OPEN);
  });
});

describe("图标开关", () => {
  it("收起 -> 展开：聚焦输入框，不清空内容", () => {
    expect(stepDockFilter(CLOSED, { kind: "toggle" })).toEqual({ state: OPEN, clearValue: false, focus: true });
  });
  it("展开 -> 收起：清空筛选词（不留隐藏筛选）", () => {
    expect(stepDockFilter(OPEN, { kind: "toggle" })).toEqual({ state: CLOSED, clearValue: true, focus: false });
  });
});

describe("输入 / Esc / 失焦", () => {
  it("输入保持展开、不重复聚焦（打字时不能抢光标）", () => {
    expect(stepDockFilter(OPEN, { kind: "input" })).toEqual({ state: OPEN, clearValue: false, focus: false });
  });
  it("Esc 清空并收起", () => {
    expect(stepDockFilter(OPEN, { kind: "escape" })).toEqual({ state: CLOSED, clearValue: true, focus: false });
  });
  it("失焦：有内容保持展开，空内容自动收起", () => {
    expect(stepDockFilter(OPEN, { kind: "blur", value: "x" }).state).toEqual(OPEN);
    expect(stepDockFilter(OPEN, { kind: "blur", value: "  " }).state).toEqual(CLOSED);
    expect(stepDockFilter(OPEN, { kind: "blur", value: "x" }).clearValue).toBe(false);
  });
});

describe("外部写入筛选词", () => {
  it("别处写入非空 => 自动展开；已展开不动", () => {
    expect(stepDockFilter(CLOSED, { kind: "external-value", value: "abc" }).state).toEqual(OPEN);
    expect(stepDockFilter(OPEN, { kind: "external-value", value: "abc" }).state).toEqual(OPEN);
  });
  it("外部清空不自动收起（由用户操作决定，避免打字途中被折叠）", () => {
    expect(stepDockFilter(OPEN, { kind: "external-value", value: "" }).state).toEqual(OPEN);
  });
});
