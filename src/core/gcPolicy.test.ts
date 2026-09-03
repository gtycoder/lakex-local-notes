import { describe, expect, it } from "vitest";
import { gcCutoffMs, isPastWindow, parseIsoMs, pendingKeyReason, GC_DAY_MS } from "./gcPolicy.js";

describe("gcPolicy 保留窗口判定", () => {
  it("gcCutoffMs：retention 正常 → now-retention；<=0/非法 → now（全到期）", () => {
    const now = 1_700_000_000_000;
    expect(gcCutoffMs(now, 7)).toBe(now - 7 * GC_DAY_MS);
    expect(gcCutoffMs(now, 0)).toBe(now);
    expect(gcCutoffMs(now, -3)).toBe(now);
    expect(gcCutoffMs(now, Number.NaN)).toBe(now);
  });

  it("isPastWindow：<=cutoff 已过窗；>cutoff 窗口内；缺失/非法 → false（保守）", () => {
    const now = 1_700_000_000_000;
    const cutoff = gcCutoffMs(now, 7);
    const past = new Date(cutoff - 1000).toISOString();
    const inside = new Date(cutoff + 1000).toISOString();
    expect(isPastWindow(past, cutoff)).toBe(true);
    expect(isPastWindow(inside, cutoff)).toBe(false);
    expect(isPastWindow(undefined, cutoff)).toBe(false);
    expect(isPastWindow("not-a-date", cutoff)).toBe(false);
    expect(isPastWindow("", cutoff)).toBe(false);
  });

  it("parseIsoMs：合法 ISO 返回毫秒；非法返回 null", () => {
    expect(parseIsoMs("2020-01-01T00:00:00.000Z")).not.toBeNull();
    expect(parseIsoMs("  ")).toBeNull();
    expect(parseIsoMs(null)).toBeNull();
  });
});

describe("pendingKeyReason（D2 待回收键分类）", () => {
  it("按前缀分类", () => {
    expect(pendingKeyReason("objects/abc-123")).toBe("旧正文（清单不再引用）");
    expect(pendingKeyReason("assets/abc-123/img.png")).toBe("旧资源（清单不再引用）");
    expect(pendingKeyReason("manifests/2020-01.json")).toBe("旧清单（链外滞后裁剪）");
    expect(pendingKeyReason("quick-notes/x")).toBe("小记冗余");
    expect(pendingKeyReason("weird-key")).toBe("未知类型");
  });
});
