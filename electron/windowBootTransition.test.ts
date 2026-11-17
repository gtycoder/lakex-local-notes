import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("主窗口 / boot 窗口切换", () => {
  it("主窗显式设置主题底色，避免重载时闪纯白", () => {
    expect(MAIN).toContain('backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e2126" : "#E9EDF3"');
  });

  it("揭示主窗时先藏 boot、再 show 主窗、最后 destroy boot", () => {
    const hide = MAIN.indexOf("if (boot && !boot.isDestroyed()) boot.hide();");
    const show = MAIN.indexOf("win.show();", hide);
    const destroy = MAIN.indexOf("if (boot && !boot.isDestroyed()) boot.destroy();", show);
    expect(hide).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(hide);
    expect(destroy).toBeGreaterThan(show);
  });

  it("renderer 崩溃重载期间重新挂 boot，并保留超时兜底", () => {
    expect(MAIN).toContain("mainWindowRevealed = false;\n    win.hide();\n    createBootWindow();");
    expect(MAIN).toContain('revealMainWindow("crash-fallback-timeout")');
  });
});
