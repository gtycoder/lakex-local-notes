// @vitest-environment jsdom
/**
 * useSafeModeStatus / readSafeModeStatus（P2-C：fail-closed）。
 *
 * P2-8 回归点：旧实现 IPC 失败时把状态兜底成 inactive（fail-open）⇒ 会话照写、标签照恢复。
 * 现在失败/形状不对一律 **unknown**：调用方据此 skip（不写/不清会话、不恢复标签）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({ getSafeModeState: vi.fn() }));
vi.mock("../lib/native", () => ({ native: nativeMock }));

import { readSafeModeStatus, useSafeModeStatus, type SafeModeStatus } from "./useSafeModeStatus";

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

describe("readSafeModeStatus（fail-closed）", () => {
  it("形状正确才给 active/inactive", async () => {
    nativeMock.getSafeModeState.mockResolvedValue({ active: true });
    await expect(readSafeModeStatus()).resolves.toBe("active");
    nativeMock.getSafeModeState.mockResolvedValue({ active: false });
    await expect(readSafeModeStatus()).resolves.toBe("inactive");
  });

  it("IPC 失败 / 返回 null / active 不是布尔 ⇒ unknown（绝不 fail-open 成 inactive）", async () => {
    nativeMock.getSafeModeState.mockRejectedValue(new Error("ipc down"));
    await expect(readSafeModeStatus()).resolves.toBe("unknown");
    nativeMock.getSafeModeState.mockResolvedValue(null);
    await expect(readSafeModeStatus()).resolves.toBe("unknown");
    nativeMock.getSafeModeState.mockResolvedValue({});
    await expect(readSafeModeStatus()).resolves.toBe("unknown");
    nativeMock.getSafeModeState.mockResolvedValue({ active: "yes" });
    await expect(readSafeModeStatus()).resolves.toBe("unknown");
  });
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

  it("IPC 返回 inactive ⇒ inactive", async () => {
    nativeMock.getSafeModeState.mockResolvedValue({ active: false });
    await render();
    await act(async () => { await Promise.resolve(); });
    expect(seen[seen.length - 1]).toBe("inactive");
  });

  it("IPC 失败 ⇒ 保持 unknown（P2-8：不再兜底成 inactive）", async () => {
    nativeMock.getSafeModeState.mockRejectedValue(new Error("ipc down"));
    await render();
    await act(async () => { await Promise.resolve(); });
    expect(seen[seen.length - 1]).toBe("unknown");
  });
});
