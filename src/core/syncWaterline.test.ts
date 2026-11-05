import { describe, expect, it } from "vitest";
import { advanceWaterline, normalizeWaterline, WATERLINE_FUTURE_SKEW_MS } from "./syncWaterline.js";

const NOW = Date.parse("2026-11-05T08:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

describe("syncWaterline（P1-3：墓碑水线单调、拒绝未来值）", () => {
  it("读取归一并拒绝未来值：合法保留 / 0 / 非法 / 超前容差外 ⇒ \"0\"", () => {
    expect(normalizeWaterline("2026-11-05T07:00:00.000Z", NOW)).toBe("2026-11-05T07:00:00.000Z");
    expect(normalizeWaterline("0", NOW)).toBe("0");
    expect(normalizeWaterline(undefined, NOW)).toBe("0");
    expect(normalizeWaterline("not-a-date", NOW)).toBe("0");
    expect(normalizeWaterline(iso(NOW + WATERLINE_FUTURE_SKEW_MS + 1), NOW)).toBe("0");
    // 容差内的轻微超前仍接受（时钟抖动不该把全部墓碑重发）
    expect(normalizeWaterline(iso(NOW + 60_000), NOW)).toBe(iso(NOW + 60_000));
  });

  it("推进：永不写未来、只增不减（时钟回拨不倒退）", () => {
    expect(advanceWaterline("0", iso(NOW + 86_400_000), NOW)).toBe(iso(NOW)); // 未来候选 ⇒ 夹到 now
    expect(advanceWaterline("0", iso(NOW - 60_000), NOW)).toBe(iso(NOW - 60_000));
    expect(advanceWaterline(iso(NOW - 60_000), iso(NOW - 120_000), NOW)).toBe(iso(NOW - 60_000)); // 回拨不倒退
    expect(advanceWaterline(iso(NOW - 60_000), iso(NOW - 30_000), NOW)).toBe(iso(NOW - 30_000)); // 前进
    expect(advanceWaterline("garbage", iso(NOW - 30_000), NOW)).toBe(iso(NOW - 30_000)); // 坏基线当 0
  });
});
