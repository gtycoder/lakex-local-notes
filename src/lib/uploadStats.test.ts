import { describe, expect, it } from "vitest";
import { UploadStats, formatUploadBurst, type UploadSample } from "./uploadStats.js";

/**
 * 资源上传爆发统计：粘贴整页网页时 60–100 次远程图片上传要能压成一行日志，
 * 否则"卡"到底是 CPU 还是 I/O 仍然分不清。这里锁三条判据：
 * 单张/单附件不打扰、达到次数阈值必报、失败或墙钟超阈值即使次数少也报。
 */

function makeStats(overrides: { minCalls?: number; minWallMs?: number } = {}) {
  const lines: string[] = [];
  const timers: Array<{ fire: () => void; cleared: boolean }> = [];
  const stats = new UploadStats({
    emit: (line) => lines.push(line),
    flushDelayMs: 1500,
    minCalls: overrides.minCalls ?? 3,
    minWallMs: overrides.minWallMs ?? 1500,
    setTimer: (fn) => {
      const entry = { fire: fn, cleared: false };
      timers.push(entry);
      return entry;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  return { lines, timers, stats };
}

const sample = (startedAt: number, endedAt: number, kind: UploadSample["kind"] = "url", ok = true, retries = 0): UploadSample => ({ kind, startedAt, endedAt, ok, retries });

describe("资源上传爆发统计", () => {
  it("单张图 / 单附件（低于阈值）不落日志", () => {
    const { lines, timers, stats } = makeStats();
    stats.record(sample(1000, 1120));
    timers[timers.length - 1].fire();
    expect(lines).toEqual([]);
  });

  it("达到次数阈值：报条数 / 远程数 / 墙钟 / 单次最长", () => {
    const { lines, timers, stats } = makeStats();
    stats.record(sample(1000, 1300));
    stats.record(sample(1000, 2500, "url"));
    stats.record(sample(1100, 1400, "data"));
    timers[timers.length - 1].fire();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("资源上传 3 次");
    expect(lines[0]).toContain("远程 2 / 本地 1");
    expect(lines[0]).toContain("墙钟 1500ms");
    expect(lines[0]).toContain("单次最长 1500ms");
  });

  it("失败即使只有一次也要报（不静默）", () => {
    const { lines, timers, stats } = makeStats();
    stats.record(sample(1000, 1100, "url", false, 2));
    timers[timers.length - 1].fire();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("失败 1 次");
    expect(lines[0]).toContain("重试 2 次");
  });

  it("墙钟超阈值即使次数少也要报（慢单次）", () => {
    const { lines, timers, stats } = makeStats();
    stats.record(sample(1000, 4000));
    timers[timers.length - 1].fire();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("墙钟 3000ms");
  });

  it("每来一条样本重排计时器，只有最后一个是活的", () => {
    const { lines, timers, stats } = makeStats();
    stats.record(sample(1000, 1100));
    stats.record(sample(1000, 1200));
    stats.record(sample(1000, 1300));
    expect(timers.length).toBe(3);
    expect(timers[0].cleared).toBe(true);
    expect(timers[1].cleared).toBe(true);
    expect(timers[2].cleared).toBe(false);
    timers[2].fire();
    expect(lines.length).toBe(1);
  });

  it("flush 后续新样本重新计数（不串账）", () => {
    const { lines, stats } = makeStats();
    stats.record(sample(1000, 1100));
    stats.record(sample(1000, 1200));
    stats.record(sample(1000, 1300));
    stats.flush();
    expect(lines.length).toBe(1);
    stats.record(sample(5000, 5100));
    stats.flush();
    expect(lines.length).toBe(1); // 第二次只有 1 次，低于阈值
  });

  it("格式行是单行、含全部字段（便于 grep）", () => {
    const line = formatUploadBurst({ calls: 66, remote: 66, failed: 0, retries: 1, wallMs: 2431.4, maxMs: 812.6 });
    expect(line.split("\n").length).toBe(1);
    expect(line).toContain("66 次");
    expect(line).toContain("墙钟 2431ms");
    expect(line).toContain("单次最长 813ms");
    expect(line).toContain("重试 1 次");
    expect(line).toContain("失败 0 次");
  });
});
