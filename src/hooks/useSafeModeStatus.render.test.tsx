// @vitest-environment jsdom
/**
 * useSafeModeStatus：一个 App 只问一次主进程并缓存；IPC 失败按「非安全模式」兜底（既有行为）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({ getSafeModeState: vi.fn() }));
vi.mock("../lib/native", () => ({ native: nativeMock }));

import { useSafeModeStatus, type SafeModeStatus } from "./useSafeModeStatus";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
let seen: SafeModeStatus[] = [];

function Harness(): null {
  seen.push(useSafeModeStatus());
  return null;
}

async function render(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Harness />); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  seen = [];
  nativeMock.getSafeModeState.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("useSafeModeStatus", () => {
  it("首帧 unknown，IPC 返回 active 后变 active（只问一次）", async () => {
    nativeMock.getSafeModeState.mockResolvedValue({ active: true });
    await render();
    expect(seen[0]).toBe("unknown");
    await act(async () => { await Promise.resolve(); });
    expect(seen[seen.length - 1]).toBe("active");
    expect(nativeMock.getSafeModeState).toHaveBeenCalledTimes(1);
  });

  it("IPC 返回 inactive ⇒ inactive；失败 ⇒ 兜底 inactive（不把排查态误判成常态）", async () => {
    nativeMock.getSafeModeState.mockResolvedValue({ active: false });
    await render();
    await act(async () => { await Promise.resolve(); });
    expect(seen[seen.length - 1]).toBe("inactive");
    await act(async () => root?.unmount());
    root = null;
    host.remove();
    seen = [];
    nativeMock.getSafeModeState.mockRejectedValue(new Error("ipc down"));
    await render();
    await act(async () => { await Promise.resolve(); });
    expect(seen[seen.length - 1]).toBe("inactive");
  });
});
