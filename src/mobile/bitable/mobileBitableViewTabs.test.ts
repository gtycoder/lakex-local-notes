import { describe, expect, it } from "vitest";
import { mobileViewTabLabel, mobileViewTabs, resolveMobileDefaultViewId } from "./mobileBitableViewTabs";
import { createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

describe("移动端视图页签 / 默认视图", () => {
  it("默认视图 = 第一个表单视图（用户 261030：进来默认选中表单）", () => {
    const table = createDefaultBitableTable("表");
    table.views = [createBitableView("grid", "内容", "v-grid"), createBitableView("form", "表单", "v-form")];
    table.activeViewId = "v-grid";
    expect(resolveMobileDefaultViewId(table)).toBe("v-form");
  });

  it("没有表单视图时回落正文 activeViewId，再回落第一视图", () => {
    const table = createDefaultBitableTable("表");
    table.views = [createBitableView("kanban", "看板", "v-k"), createBitableView("grid", "内容", "v-grid")];
    table.activeViewId = "v-grid";
    expect(resolveMobileDefaultViewId(table)).toBe("v-grid");
    table.activeViewId = "gone";
    expect(resolveMobileDefaultViewId(table)).toBe("v-k");
  });

  it("页签短标签按类型收敛；同类型重名时改用视图名", () => {
    expect(mobileViewTabLabel(createBitableView("form", "A", "a"))).toBe("表单");
    expect(mobileViewTabLabel(createBitableView("grid", "B", "b"))).toBe("内容");
    expect(mobileViewTabLabel({ id: "c", name: "C", type: "weird" })).toBe("C");
    const table = createDefaultBitableTable("表");
    table.views = [createBitableView("grid", "内容一", "v1"), createBitableView("grid", "内容二", "v2")];
    expect(mobileViewTabs(table).map((tab) => tab.label)).toEqual(["内容一", "内容二"]);
  });
});
