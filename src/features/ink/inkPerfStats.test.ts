// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INK_PERF_WARN_BYTES,
  INK_PERF_WARN_PARSE_MS,
  INK_PERF_WARN_SERIALIZE_MS,
  inkPerfStats,
  inkPerfThresholdHits,
  recordInkPerf,
  resetInkPerf,
} from "./inkPerfStats";

describe("手写板性能观测（261103 十一批）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetInkPerf();
  });
  afterEach(() => {
    window.localStorage.clear();
    resetInkPerf();
  });

  it("阈值判据：字节/页数/序列化耗时/解析耗时各自独立触发", () => {
    expect(inkPerfThresholdHits({ kind: "save", ms: 5, bytes: 1024, pages: 3 })).toEqual([]);
    expect(inkPerfThresholdHits({ kind: "save", ms: 5, bytes: INK_PERF_WARN_BYTES + 1, pages: 3 })).toEqual(["bytes>4MiB"]);
    expect(inkPerfThresholdHits({ kind: "save", ms: 5, bytes: 1024, pages: 51 })).toEqual(["pages>50"]);
    expect(inkPerfThresholdHits({ kind: "save", ms: INK_PERF_WARN_SERIALIZE_MS + 1, bytes: 1024, pages: 3 })).toEqual(["serialize>50ms"]);
    expect(inkPerfThresholdHits({ kind: "load", ms: INK_PERF_WARN_PARSE_MS + 1, bytes: 1024, pages: 3 })).toEqual(["parse>300ms"]);
    // 解析阈值不会误伤保存样本（反之亦然）
    expect(inkPerfThresholdHits({ kind: "save", ms: INK_PERF_WARN_PARSE_MS + 1, bytes: 1024, pages: 3 })).toEqual(["serialize>50ms"]);
  });

  it("默认只记数不打日志：样本可被 __inkPerfStats 风格读取，且超过 40 条只留最近", () => {
    expect(inkPerfStats().enabled).toBe(false);
    for (let i = 0; i < 45; i += 1) {
      recordInkPerf({ kind: "save", ms: 1, bytes: 10 + i, pages: 1 });
    }
    const stats = inkPerfStats();
    expect(stats.samples).toHaveLength(40);
    expect(stats.samples[39].bytes).toBe(54);
    expect(stats.thresholds.bytes).toBe(INK_PERF_WARN_BYTES);
    resetInkPerf();
    expect(inkPerfStats().samples).toHaveLength(0);
  });

  it("localStorage 打开 debug 后 enabled=true（日志输出走 console，不参与断言）", () => {
    window.localStorage.setItem("lakex-local-notes-v3.ink-perf-debug", "1");
    expect(inkPerfStats().enabled).toBe(true);
    recordInkPerf({ kind: "load", ms: 2, bytes: 32, pages: 1 });
    expect(inkPerfStats().samples).toHaveLength(1);
  });
});
