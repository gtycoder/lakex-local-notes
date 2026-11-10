// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSafeModeState: vi.fn(),
  copySafeModeDiagnostics: vi.fn(),
  exitSafeMode: vi.fn(),
}));
vi.mock("../../lib/native", () => ({ native: h }));

import { SafeModeBanner } from "./SafeModeBanner";

/**
 * 安全模式横幅（261110 第二批）：两个出口迁到按钮梯队（复制诊断 = L3 secondary、
 * 退出安全模式 = L2 outlined，均 compact）；横幅本身几何不动。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.getSafeModeState.mockResolvedValue({ active: true, reason: "启动崩溃 3 次", occurrences: 3, crashTime: "2026-11-10 10:00" });
  h.copySafeModeDiagnostics.mockResolvedValue({ ok: true });
  h.exitSafeMode.mockResolvedValue({ ok: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function flush(): Promise<void> { await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }); }

describe("SafeModeBanner（261110 第二批）", () => {
  it("两个按钮 = ln-btn 梯队（类名只含 ln-*），点击各自接线", async () => {
    act(() => root.render(createElement(SafeModeBanner)));
    await flush();
    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>(".tab-gone-banner button")];
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      const classes = (btn.className || "").split(/\s+/).filter(Boolean);
      expect(classes.every((name) => name.startsWith("ln-"))).toBe(true);
      expect(btn.className).toContain("ln-btn--compact");
    }
    expect(buttons[0]!.className).toContain("ln-btn--secondary");
    expect(buttons[1]!.className).toContain("ln-btn--outlined");
    await act(async () => { buttons[0]!.click(); await Promise.resolve(); });
    expect(h.copySafeModeDiagnostics).toHaveBeenCalledTimes(1);
    await act(async () => { buttons[1]!.click(); await Promise.resolve(); });
    expect(h.exitSafeMode).toHaveBeenCalledTimes(1);
  });

  it("非安全模式不渲染", async () => {
    h.getSafeModeState.mockResolvedValue({ active: false });
    act(() => root.render(createElement(SafeModeBanner)));
    await flush();
    expect(document.body.querySelector(".tab-gone-banner")).toBeNull();
  });
});
