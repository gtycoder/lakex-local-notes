import { describe, expect, it } from "vitest";
import { mobileViewTabLabel, mobileViewTabs, resolveMobileDefaultViewId } from "./mobileBitableViewTabs";
import { createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

describe("移动端视图页签 / 默认视图", () => {
  it("默认视图 = 第一个表单视图（用户 261030：进来默认选中表单）", () => {
    const table = createDefaultBitableTable("表");
    table.views = [createBitableView("grid", "表格", "v-grid"), createBitableView("form", "表单", "v-form")];
    table.activeViewId = "v-grid";
    expect(resolveMobileDefaultViewId(table)).toBe("v-form");
  });

  it("没有表单视图时回落正文 activeViewId，再回落第一视图", () => {
    const table = createDefaultBitableTable("表");
    table.views = [createBitableView("kanban", "看板", "v-k"), createBitableView("grid", "表格", "v-grid")];
    table.activeViewId = "v-grid";
    expect(resolveMobileDefaultViewId(table)).toBe("v-grid");
    table.activeViewId = "gone";
    expect(resolveMobileDefaultViewId(table)).toBe("v-k");
  });

  it("页签短标签按类型收敛；同类型第 2 个起自动编号（不改存储名）", () => {
    expect(mobileViewTabLabel(createBitableView("form", "A", "a"))).toBe("表单");
    expect(mobileViewTabLabel(createBitableView("grid", "B", "b"))).toBe("表格");
    expect(mobileViewTabLabel({ id: "c", name: "C", type: "weird" })).toBe("C");

    const table = createDefaultBitableTable("表");
    table.views = [
      createBitableView("grid", "表格一", "v1"),
      createBitableView("grid", "表格二", "v2"),
      createBitableView("form", "我的表单", "v3"),
      createBitableView("grid", "第三张", "v4"),
    ];
    const tabs = mobileViewTabs(table);
    // 按类型出现顺序编号：第 1 个表格 = 表格，第 2 个 = 表格 2，第 3 个 = 表格 3；表单独立编号
    expect(tabs.map((tab) => tab.label)).toEqual(["表格", "表格 2", "表单", "表格 3"]);
    // 只改展示：存储名一个都不动
    expect(table.views.map((view) => view.name)).toEqual(["表格一", "表格二", "我的表单", "第三张"]);
  });

  it("未知类型页签按视图名分组编号（第 2 个同名加序号）", () => {
    const table = createDefaultBitableTable("表");
    table.views = [
      { id: "g1", name: "甘特", type: "gantt" },
      { id: "g2", name: "甘特", type: "gantt" },
      { id: "g3", name: "其他", type: "gantt" },
    ];
    expect(mobileViewTabs(table).map((tab) => tab.label)).toEqual(["甘特", "甘特 2", "其他"]);
  });
});
