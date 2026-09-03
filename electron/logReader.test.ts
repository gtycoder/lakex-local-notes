import { describe, expect, it } from "vitest";
import { tailLinesMatching } from "./logReader.js";

const SAMPLE = [
  "2026-09-03 10:00:00 [info] sync start",
  "2026-09-03 10:00:01 [info] GC reconcile ok",
  "2026-09-03 10:00:02 [info] sync done",
  "2026-09-03 10:00:03 [warn] trash purge 2 items",
  "2026-09-03 10:00:04 [info] sync start",
].join("\n");

describe("tailLinesMatching（F1 日志读取纯函数）", () => {
  it("无关键字 → 取末尾 maxLines 行", () => {
    const r = tailLinesMatching(SAMPLE, { maxLines: 2 });
    expect(r.map((x) => x.line)).toEqual([
      "2026-09-03 10:00:03 [warn] trash purge 2 items",
      "2026-09-03 10:00:04 [info] sync start",
    ]);
    expect(r.every((x) => !x.hit)).toBe(true);
  });

  it("关键字过滤 → 命中行 + 上下文，尾部优先", () => {
    const r = tailLinesMatching(SAMPLE, { keyword: "purge", maxLines: 10, context: 1 });
    expect(r.some((x) => x.hit && x.line.includes("purge"))).toBe(true);
    // purge 命中行(索引3) ±1 → 展示 索引2(sync done)、3(purge)、4(sync start)
    expect(r[0].line).toContain("sync done");
    expect(r[r.length - 1].line).toContain("sync start");
    expect(r.length).toBe(3);
  });

  it("关键字大小写不敏感", () => {
    const r = tailLinesMatching(SAMPLE, { keyword: "GC", maxLines: 10, context: 0 });
    expect(r.some((x) => x.hit)).toBe(true);
  });

  it("无命中 → 空数组", () => {
    expect(tailLinesMatching(SAMPLE, { keyword: "zzz-nothing", maxLines: 10 })).toEqual([]);
  });

  it("大量命中时封顶 maxLines", () => {
    const big = Array.from({ length: 50 }, (_, i) => "2026-09-03 [info] sync #" + i).join("\n");
    const r = tailLinesMatching(big, { keyword: "sync", maxLines: 5, context: 0 });
    expect(r.length).toBe(5);
  });
});
