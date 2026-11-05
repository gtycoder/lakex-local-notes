import { describe, expect, it } from "vitest";
import {
  HISTORY_FALLBACK_BACKOFF_BASE_MS,
  HISTORY_FALLBACK_BACKOFF_MAX_MS,
  HISTORY_FALLBACK_CHUNK_SIZE,
  HISTORY_FALLBACK_DEFAULT_MINUTES,
  HISTORY_FALLBACK_MAX_NOTES,
  HISTORY_FALLBACK_TIME_BUDGET_MS,
  historyFallbackBackoffMs,
  historyFallbackMinutes,
  isHistoryFallbackRetryDue,
  selectHistoryFallbackNotes,
  shouldRunHistoryFallback,
} from "./historyFallbackPolicy.js";

const note = (id: string, bodyMtimeMs: number) => ({ id, bodyMtimeMs });

describe("兜底快照选择（只挑有正文变化的文档）", () => {
  it("账本为空 ⇒ 全部入选；mtime 从新到旧", () => {
    const picked = selectHistoryFallbackNotes({
      notes: [note("a", 1000), note("b", 3000), note("c", 2000)],
      ledger: new Map(),
    });
    expect(picked.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("mtime 未变（等于账本）⇒ 不选中；变新才选中（严格大于）", () => {
    const ledger = new Map([["a", 1000], ["b", 2000]]);
    expect(selectHistoryFallbackNotes({ notes: [note("a", 1000), note("b", 2000)], ledger })).toEqual([]);
    expect(selectHistoryFallbackNotes({ notes: [note("a", 1000), note("b", 2001)], ledger }).map((n) => n.id)).toEqual(["b"]);
  });

  it("亚毫秒差异不算变化（mtime 浮点 vs 账本整数毫秒，按毫秒粒度比较）", () => {
    const ledger = new Map([["a", 1000]]);
    expect(selectHistoryFallbackNotes({ notes: [note("a", 1000.4)], ledger })).toEqual([]);
    expect(selectHistoryFallbackNotes({ notes: [note("a", 1001.2)], ledger }).map((n) => n.bodyMtimeMs)).toEqual([1001]);
  });

  it("非法 mtime / 重复 id 跳过（不制造空快照、不重复处理）", () => {
    const picked = selectHistoryFallbackNotes({
      notes: [note("a", Number.NaN), note("b", 0), note("c", -1), note("d", 10), note("d", 20)],
      ledger: new Map(),
    });
    expect(picked.map((item) => item.id)).toEqual(["d"]);
    expect(picked[0].bodyMtimeMs).toBe(10);
  });

  it("单轮上限生效：先处理最新的，其余留到下一轮", () => {
    const notes = Array.from({ length: 5 }, (_, index) => note("n" + index, 1000 + index * 100));
    const picked = selectHistoryFallbackNotes({ notes, ledger: new Map(), maxNotes: 2 });
    expect(picked.map((item) => item.id)).toEqual(["n4", "n3"]);
    // 非法 maxNotes 回落默认上限
    expect(selectHistoryFallbackNotes({ notes, ledger: new Map(), maxNotes: Number.NaN })).toHaveLength(5);
    expect(HISTORY_FALLBACK_MAX_NOTES).toBeGreaterThan(0);
  });

  it("时钟回拨（mtime 变小）不入选：说明上次已处理过更新的版本", () => {
    const ledger = new Map([["a", 5000]]);
    expect(selectHistoryFallbackNotes({ notes: [note("a", 4000)], ledger })).toEqual([]);
  });
});

describe("P2-A：失败退避 / 分片常量", () => {
  it("指数退避：1x/2x/4x… 封顶 24h；成功（failCount=0）无退避", () => {
    expect(historyFallbackBackoffMs(0)).toBe(0);
    expect(historyFallbackBackoffMs(-1)).toBe(0);
    expect(historyFallbackBackoffMs(1)).toBe(HISTORY_FALLBACK_BACKOFF_BASE_MS);
    expect(historyFallbackBackoffMs(2)).toBe(HISTORY_FALLBACK_BACKOFF_BASE_MS * 2);
    expect(historyFallbackBackoffMs(3)).toBe(HISTORY_FALLBACK_BACKOFF_BASE_MS * 4);
    expect(historyFallbackBackoffMs(100)).toBe(HISTORY_FALLBACK_BACKOFF_MAX_MS); // 封顶
    expect(HISTORY_FALLBACK_BACKOFF_MAX_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("退避到期判据：缺失/非法 = 已到期；>= now 才未到期", () => {
    expect(isHistoryFallbackRetryDue(undefined, 1000)).toBe(true);
    expect(isHistoryFallbackRetryDue(Number.NaN, 1000)).toBe(true);
    expect(isHistoryFallbackRetryDue(1000, 1000)).toBe(true);
    expect(isHistoryFallbackRetryDue(1001, 1000)).toBe(false);
  });

  it("分片/预算常量在合理区间（10~20 篇让出；预算 ≤1 分钟）", () => {
    expect(HISTORY_FALLBACK_CHUNK_SIZE).toBeGreaterThanOrEqual(10);
    expect(HISTORY_FALLBACK_CHUNK_SIZE).toBeLessThanOrEqual(20);
    expect(HISTORY_FALLBACK_TIME_BUDGET_MS).toBeGreaterThan(0);
    expect(HISTORY_FALLBACK_TIME_BUDGET_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("兜底间隔（默认 10 分钟、0 = 关闭）", () => {
  it("默认值与归一", () => {
    expect(HISTORY_FALLBACK_DEFAULT_MINUTES).toBe(10);
    expect(historyFallbackMinutes(undefined)).toBe(10);
    expect(historyFallbackMinutes("x")).toBe(10);
    expect(historyFallbackMinutes(-1)).toBe(10);
    expect(historyFallbackMinutes(0)).toBe(0);
    expect(historyFallbackMinutes(10.9)).toBe(10);
  });

  it("0 = 关闭；>0 才跑", () => {
    expect(shouldRunHistoryFallback(0)).toBe(false);
    expect(shouldRunHistoryFallback(-5)).toBe(false);
    expect(shouldRunHistoryFallback(Number.NaN)).toBe(false);
    expect(shouldRunHistoryFallback(1)).toBe(true);
    expect(shouldRunHistoryFallback(HISTORY_FALLBACK_DEFAULT_MINUTES)).toBe(true);
  });
});
