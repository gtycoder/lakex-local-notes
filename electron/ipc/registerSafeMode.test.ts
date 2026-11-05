import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 只 mock electron.clipboard（复制诊断用）；safeMode/startupRecovery 用真实现（临时目录）。 */
const clipboardMock = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock("electron", () => ({ clipboard: { writeText: (text: string) => clipboardMock.writeText(text) } }));

import { registerSafeModeIpc, type SafeModeIpcOptions } from "./registerSafeMode";
import { readCrashMarker, writeCrashMarker } from "../startupRecovery";
import { readSafeModeState, safeModePath, writeSafeModeState } from "../safeMode";

/**
 * 安全模式 IPC（P2-C）：退出安全模式**成功才清 crash-marker / 才 onExit**；
 * 失败返回 ok:false 并保留状态（UI 明说未生效、请重启再试）。
 */
type Handler = (...args: unknown[]) => unknown;

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-safemode-ipc-"));
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map(),
  };
  const onExit = vi.fn();
  const options: SafeModeIpcOptions = {
    userDataDir: dir,
    logPath: path.join(dir, "logs", "lakex-local-notes.log"),
    appVersion: "1.2.3",
    platform: "darwin",
    state: () => ({ active: true, since: "2026-11-05T00:00:00.000Z", reason: "上次运行累计捕获 2 次未捕获异常" }),
    onExit,
  };
  registerSafeModeIpc(ipc as unknown as Parameters<typeof registerSafeModeIpc>[0], options);
  return {
    dir,
    onExit,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
  };
}

beforeEach(() => {
  clipboardMock.writeText.mockReset();
});

describe("registerSafeModeIpc（P2-C 退出失败保留状态）", () => {
  it("退出成功：写 active:false + 清 crash-marker + 通知进程内状态；返回 ok:true", () => {
    const h = harness();
    writeSafeModeState(h.dir, { active: true, since: "2026-11-05T00:00:00.000Z" });
    writeCrashMarker(h.dir, new Error("boom"));
    const result = h.call("exit_safe_mode") as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(readSafeModeState(h.dir)?.active).toBe(false);
    expect(readCrashMarker(h.dir)).toBeNull();
    expect(h.onExit).toHaveBeenCalledTimes(1);
  });

  it("退出失败（状态写不进去）：返回 ok:false + 原因，**保留 crash-marker 与进程内状态**（不 onExit）", () => {
    const h = harness();
    writeCrashMarker(h.dir, new Error("boom"));
    writeSafeModeState(h.dir, { active: true });
    // 让写盘必失败：safe-mode.json 换成同名目录
    fs.rmSync(safeModePath(h.dir));
    fs.mkdirSync(safeModePath(h.dir));
    const result = h.call("exit_safe_mode") as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("写入安全模式状态失败");
    // crash-marker 必须还在（否则下次启动会误判"已退出"；保留 = fail-safe）
    expect(readCrashMarker(h.dir)?.reason).toBe("boom");
    expect(h.onExit).not.toHaveBeenCalled();
  });

  it("读状态：只回快照、不改文件；复制诊断走剪贴板", () => {
    const h = harness();
    const snapshot = h.call("get_safe_mode_state") as { active: boolean; reason?: string; logPath: string };
    expect(snapshot.active).toBe(true);
    expect(snapshot.reason).toContain("未捕获异常");
    expect(snapshot.logPath).toContain("lakex-local-notes.log");
    const copied = h.call("copy_safe_mode_diagnostics") as { ok: boolean; text: string };
    expect(copied.ok).toBe(true);
    expect(clipboardMock.writeText).toHaveBeenCalledWith(expect.stringContaining("安全模式诊断"));
  });
});
