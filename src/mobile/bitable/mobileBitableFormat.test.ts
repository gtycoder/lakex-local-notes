import { describe, expect, it } from "vitest";
import { formatGroupLabel, submitStateText } from "./mobileBitableFormat";
import { createBitableField } from "../../core/bitableDoc";

const dateField = createBitableField("date", "日期", "f-date");
const textField = createBitableField("text", "内容", "f-content");
const now = new Date("2026-10-30T00:00:00+08:00");

describe("formatGroupLabel（移动端分组头）", () => {
  it("同年日期 → M月D日；跨年带年份", () => {
    expect(formatGroupLabel(dateField, "2026-06-09", now)).toBe("6月9日");
    expect(formatGroupLabel(dateField, "2025-12-31", now)).toBe("2025年12月31日");
  });

  it("空值组 → 未填写；非日期字段 / 非标准日期原样", () => {
    expect(formatGroupLabel(dateField, "(空)", now)).toBe("未填写");
    expect(formatGroupLabel(textField, "(空)", now)).toBe("未填写");
    expect(formatGroupLabel(textField, "group-a", now)).toBe("group-a");
    expect(formatGroupLabel(undefined, "2026-06-09", now)).toBe("2026-06-09");
    expect(formatGroupLabel(dateField, "2026-6-9", now)).toBe("2026-6-9");
    expect(formatGroupLabel(dateField, "2026-13-40", now)).toBe("2026-13-40");
  });
});

describe("submitStateText（提交后的落点说明）", () => {
  it("按云同步状态如实说明；未知/未取到回落中性文案", () => {
    expect(submitStateText("auto")).toContain("稍后自动同步");
    expect(submitStateText("manual")).toContain("手动同步");
    expect(submitStateText("offline")).toContain("云同步已关闭");
    expect(submitStateText("unconfigured")).toContain("未启用云同步");
    expect(submitStateText(null)).toContain("唯一的写入");
    // 绝不出现"已同步"这种没发生过的承诺
    for (const s of ["auto", "manual", "offline", "unconfigured", null] as const) expect(submitStateText(s)).not.toContain("已同步");
  });
});
