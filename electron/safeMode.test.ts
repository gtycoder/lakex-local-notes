import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSafeModeDiagnostics,
  CRASH_REPEAT_WINDOW_MS,
  crashTimesOf,
  decideSafeMode,
  exitSafeModeState,
  readSafeModeState,
  removeSafeModeState,
  repeatedCrashReason,
  safeModePath,
  SAFE_MODE_FILE,
  writeSafeModeState,
  type SafeModeState,
} from "./safeMode.js";
import { readCrashMarker, removeCrashMarker, writeCrashMarker, type CrashMarker } from "./startupRecovery.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lake-safe-mode-"));
}

function marker(overrides: Partial<CrashMarker> = {}): CrashMarker {
  return { time: "2026-11-05T00:00:00.000Z", reason: "boom", stack: "", occurrences: 1, ...overrides };
}

describe("安全模式判定（纯函数）", () => {
  const now = new Date("2026-11-05T01:00:00.000Z");

  it("没有崩溃标记 / 只崩过一次 ⇒ 正常启动", () => {
    expect(decideSafeMode({ now }).active).toBe(false);
    expect(decideSafeMode({ crashMarker: marker({ occurrences: 1 }), now }).active).toBe(false);
  });

  it("上一次崩溃只有一次且超出窗口 ⇒ 正常（不因单次异常进入安全模式）", () => {
    const old = marker({ time: "2026-11-04T00:00:00.000Z", occurrences: 1, recentTimes: ["2026-11-04T00:00:00.000Z"] });
    expect(decideSafeMode({ crashMarker: old, now }).active).toBe(false);
    expect(CRASH_REPEAT_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  it("occurrences>=2 ⇒ 进入安全模式，原因里带次数", () => {
    const decision = decideSafeMode({ crashMarker: marker({ occurrences: 2 }), now });
    expect(decision.active).toBe(true);
    expect(decision.reason).toContain("2 次未捕获异常");
    expect(decision.state).toMatchObject({ active: true, since: now.toISOString(), occurrences: 2, reason: decision.reason });
  });

  it("30 分钟内连续 2 次（即便 occurrences 只记到 1）也进入安全模式", () => {
    const recent = marker({
      time: "2026-11-05T00:50:00.000Z",
      occurrences: 1,
      recentTimes: ["2026-11-05T00:40:00.000Z", "2026-11-05T00:50:00.000Z"],
    });
    expect(repeatedCrashReason(recent, now)).toContain("30 分钟内连续");
    expect(decideSafeMode({ crashMarker: recent, now }).active).toBe(true);
  });

  it("两次崩溃但都超出 30 分钟窗口 ⇒ 不进入（窗口判据不误伤偶发）", () => {
    const spread = marker({
      time: "2026-11-04T20:00:00.000Z",
      occurrences: 1,
      recentTimes: ["2026-11-04T19:00:00.000Z", "2026-11-04T20:00:00.000Z"],
    });
    expect(repeatedCrashReason(spread, now)).toBeNull();
    expect(decideSafeMode({ crashMarker: spread, now }).active).toBe(false);
  });

  it("上次已进入安全模式且用户没退出 ⇒ 继续安全模式（保住 since/原因）", () => {
    const previous: SafeModeState = { active: true, since: "2026-11-05T00:10:00.000Z", reason: "上次运行累计捕获 3 次未捕获异常" };
    const decision = decideSafeMode({ previous, crashMarker: null, now });
    expect(decision.active).toBe(true);
    expect(decision.state.since).toBe(previous.since);
    expect(decision.reason).toBe(previous.reason);
  });

  it("用户显式退出过（active:false）⇒ 除非再次连崩，否则正常启动", () => {
    const previous: SafeModeState = { active: false, exitedAt: "2026-11-05T00:20:00.000Z" };
    expect(decideSafeMode({ previous, crashMarker: marker({ occurrences: 1 }), now }).active).toBe(false);
    expect(decideSafeMode({ previous, crashMarker: marker({ occurrences: 2 }), now }).active).toBe(true);
  });
});

describe("安全模式状态文件（userData/safe-mode.json）", () => {
  it("读写往返；active 不是布尔/文件损坏 ⇒ null（启动路径不因状态文件再失败一次）", () => {
    const dir = tempDir();
    expect(safeModePath(dir)).toBe(path.join(dir, SAFE_MODE_FILE));
    expect(SAFE_MODE_FILE).toBe("safe-mode.json");
    expect(readSafeModeState(dir)).toBeNull();
    expect(writeSafeModeState(dir, { active: true, since: "S", reason: "R" })).toBe(true);
    expect(readSafeModeState(dir)).toMatchObject({ active: true, since: "S", reason: "R" });
    fs.writeFileSync(safeModePath(dir), "{not json");
    expect(readSafeModeState(dir)).toBeNull();
    fs.writeFileSync(safeModePath(dir), JSON.stringify({ active: "yes" }));
    expect(readSafeModeState(dir)).toBeNull();
  });

  it("显式退出写 active:false + exitedAt（ok:true）；删文件后回到未记录", () => {
    const dir = tempDir();
    writeSafeModeState(dir, { active: true });
    const exited = exitSafeModeState(dir, new Date("2026-11-05T02:00:00.000Z"));
    expect(exited.ok).toBe(true);
    expect(exited.state).toEqual({ active: false, exitedAt: "2026-11-05T02:00:00.000Z" });
    expect(readSafeModeState(dir)).toMatchObject({ active: false, exitedAt: "2026-11-05T02:00:00.000Z" });
    removeSafeModeState(dir);
    expect(readSafeModeState(dir)).toBeNull();
    expect(fs.existsSync(safeModePath(dir))).toBe(false);
  });

  it("退出写盘失败 ⇒ ok:false + 可读原因，且磁盘状态保持原样（P2-C：旧实现忽略失败仍报成功）", () => {
    const dir = tempDir();
    writeSafeModeState(dir, { active: true, reason: "连崩" });
    // 让写盘必失败：把 safe-mode.json 换成同名**目录**（writeFileSync EISDIR，writeSafeModeState 捕获返回 false）。
    removeSafeModeState(dir);
    fs.mkdirSync(safeModePath(dir));
    const exited = exitSafeModeState(dir, new Date("2026-11-05T02:00:00.000Z"));
    expect(exited.ok).toBe(false);
    expect(exited.reason).toContain("写入安全模式状态失败");
    expect(exited.state.active).toBe(false);
    // 磁盘上仍是目录（没被误删/误写），下一次启动读状态得到 null ⇒ 仍按 crash-marker 判定，不会误当已退出成功。
    expect(fs.statSync(safeModePath(dir)).isDirectory()).toBe(true);
    expect(readSafeModeState(dir)).toBeNull();
  });

  it("崩溃标记累积 recentTimes（最多 5 条；旧标记没有该字段也能读）", () => {
    const dir = tempDir();
    for (let i = 0; i < 7; i += 1) {
      writeCrashMarker(dir, new Error("boom " + i), new Date("2026-11-05T00:0" + i + ":00.000Z"));
    }
    const read = readCrashMarker(dir);
    expect(read?.occurrences).toBe(7);
    expect(read?.recentTimes).toHaveLength(5);
    expect(read?.recentTimes?.[4]).toBe("2026-11-05T00:06:00.000Z");
    // 旧标记：手写只有 time/reason/occurrences
    removeCrashMarker(dir);
    fs.writeFileSync(path.join(dir, "crash-marker.json"), JSON.stringify({ time: "2026-11-05T00:00:00.000Z", reason: "x", occurrences: 1 }));
    expect(crashTimesOf(readCrashMarker(dir))).toEqual(["2026-11-05T00:00:00.000Z"]);
  });
});

describe("诊断文本（复制诊断）", () => {
  it("含版本/环境/数据目录/日志/进入原因/崩溃现场，未崩溃时也明说", () => {
    const text = buildSafeModeDiagnostics({
      state: { active: true, since: "2026-11-05T00:00:00.000Z", reason: "上次运行累计捕获 2 次未捕获异常" },
      crashMarker: marker({ occurrences: 2, stack: "Error: boom\n  at foo" }),
      appVersion: "9.9.9",
      platform: "darwin",
      dataDir: "/data",
      logPath: "/data/logs/lakex-local-notes.log",
      now: new Date("2026-11-05T03:00:00.000Z"),
    });
    expect(text).toContain("LakexLocalNotes 安全模式诊断");
    expect(text).toContain("版本：9.9.9");
    expect(text).toContain("数据目录：/data");
    expect(text).toContain("日志：/data/logs/lakex-local-notes.log");
    expect(text).toContain("进入原因：上次运行累计捕获 2 次未捕获异常");
    expect(text).toContain("上次崩溃：2026-11-05T00:00:00.000Z · 累计 2 次");
    expect(text).toContain("堆栈：");
    const without = buildSafeModeDiagnostics({
      state: { active: true }, crashMarker: null, appVersion: "9.9.9", platform: "darwin",
      dataDir: "/data", logPath: "/log",
    });
    expect(without).toContain("上次崩溃：无");
  });
});
