// @vitest-environment jsdom
/**
 * 261106 用户要求：首页返回键**两次确认才退出**（第一次只提示「再按一次退出应用」，2 秒内第二次才退）。
 * 纯判据 + hook 行为都锁；另外静态断言 MobileApp 的兜底确实接到了这个 hook。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOUBLE_BACK_HINT, DOUBLE_BACK_WINDOW_MS, isSecondBack, useDoubleBackExit } from "./useDoubleBackExit";

describe("isSecondBack（纯判据）", () => {
  it("第一次（lastAt=0）永远不算第二次", () => {
    expect(isSecondBack(0, 1000)).toBe(false);
    expect(isSecondBack(0, 0)).toBe(false);
  });

  it("窗口内（含 2s 边界）算第二次；超过窗口不算", () => {
    expect(isSecondBack(1000, 1000)).toBe(true);
    expect(isSecondBack(1000, 1500)).toBe(true);
    expect(isSecondBack(1000, 1000 + DOUBLE_BACK_WINDOW_MS)).toBe(true);
    expect(isSecondBack(1000, 1000 + DOUBLE_BACK_WINDOW_MS + 1)).toBe(false);
  });

  it("时间回拨/非法输入不算第二次（不误退）", () => {
    expect(isSecondBack(2000, 1000)).toBe(false);
    expect(isSecondBack(Number.NaN, 1000)).toBe(false);
    expect(isSecondBack(1000, Number.NaN)).toBe(false);
  });
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let handler: (() => void) | null = null;
let nowValue = 10_000;
const exit = vi.fn();
const hint = vi.fn();

function Harness(): null {
  handler = useDoubleBackExit({ exit, hint, now: () => nowValue });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  exit.mockReset();
  hint.mockReset();
  nowValue = 10_000;
  handler = null;
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useDoubleBackExit（首页兜底）", () => {
  it("第一次只提示、不退出；2s 内第二次才退出；退出后重新计数", () => {
    act(() => handler!());
    expect(hint).toHaveBeenCalledWith(DOUBLE_BACK_HINT);
    expect(exit).not.toHaveBeenCalled();

    nowValue += 1200;
    act(() => handler!());
    expect(exit).toHaveBeenCalledTimes(1);

    // 退出后计数清零：下一次再按又是「第一次」。
    hint.mockClear();
    nowValue += 100;
    act(() => handler!());
    expect(exit).toHaveBeenCalledTimes(1);
    expect(hint).toHaveBeenCalledWith(DOUBLE_BACK_HINT);
  });

  it("超过 2s 再按：重新计并再次提示（不退出）", () => {
    act(() => handler!());
    expect(exit).not.toHaveBeenCalled();
    hint.mockClear();
    nowValue += DOUBLE_BACK_WINDOW_MS + 500;
    act(() => handler!());
    expect(exit).not.toHaveBeenCalled();
    expect(hint).toHaveBeenCalledWith(DOUBLE_BACK_HINT);
    // 新窗口内的第二次才退出。
    nowValue += 800;
    act(() => handler!());
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("MobileApp 的首页兜底确实接到 useDoubleBackExit（不是又直接 exitApp）", () => {
    const src = readFileSync(path.join(process.cwd(), "src/mobile/MobileApp.tsx"), "utf8");
    expect(src).toContain("useDoubleBackExit({ exit: exitApp })");
    expect(src).toContain("onAppExit: handleAppExit");
    expect(src).not.toMatch(/onAppExit:\s*\(\)\s*=>\s*\{[^}]*exitApp\(\)/s);
  });
});
