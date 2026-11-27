import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = ["./main.ts", "./window/bootSplash.ts", "./window/createMainWindow.ts"].map((rel) => readFileSync(new URL(rel, import.meta.url), "utf8")).join("\n"); // C-04：窗口层外迁 window/*
const SPLASH = readFileSync(new URL("./window/bootSplash.ts", import.meta.url), "utf8");
const MAIN_WINDOW = readFileSync(new URL("./window/createMainWindow.ts", import.meta.url), "utf8");
const ENTRY = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("主窗口 / boot 窗口切换", () => {
  it("主窗显式设置底色：浅色档纯白（与 boot 窗同色，261120 用户点单「都统一白色」），深色档 #1e2126", () => {
    expect(MAIN).toContain('backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e2126" : "#FFFFFF"');
    // 重载时不再有 #E9EDF3 灰底那层（浅色启动三处同白：boot.html / 主窗底 / loading-screen）
    expect(MAIN).not.toContain('"#E9EDF3"');
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
    expect(MAIN).toContain("mainWindowRevealed = false;\n    win.hide();\n    createBootWindow(splashDeps);");
    expect(MAIN).toContain('revealMainWindow("crash-fallback-timeout")');
  });
});

// 261127 用户报障：macOS 偶发纯白窗口 + Dock 菜单多一条窗口 + Space/Dock 异常，只能重启。
// 根因 = boot splash 也被恢复成全屏/最大化：macOS 启动全屏过渡后 splash 被 hide+destroy 打断，
// 留下无标题的空白 backing window。实测 2×2：只有 splash 进全屏才会出现第二个窗口。
describe("窗口状态恢复（261127 macOS 空白窗口 / 偶发多窗口）", () => {
  it("boot splash 绝不做原生窗口状态转换，并有 fullscreenable/maximizable 兜底", () => {
    expect(SPLASH).not.toMatch(/boot\.(setFullScreen|maximize|setSimpleFullScreen)\(/);
    expect(SPLASH).toContain("fullscreenable: false");
    expect(SPLASH).toContain("maximizable: false");
    // 几何走静态纯函数（最大化/全屏恢复 = 工作区矩形）
    expect(SPLASH).toContain("bootSplashBounds(");
  });

  it("主窗口仍恢复最大化/全屏（能力不回退），原生全屏只允许发生在主窗口", () => {
    expect(MAIN_WINDOW).toContain("if (restored.maximized) win.maximize();");
    expect(MAIN_WINDOW).toContain("if (restored.fullscreen) win.setFullScreen(true);");
    expect(SPLASH).not.toMatch(/\.setFullScreen\(/);
  });

  it("createWindow 先判主窗口单例：已有主窗口直接返回，不再建第二个", () => {
    expect(MAIN_WINDOW).toContain("const existing = deps.getMainWindow();");
    expect(MAIN_WINDOW).toMatch(/if \(existing && !existing\.isDestroyed\(\)\) \{/);
  });

  it("activate / second-instance 只按主窗口单例判定，不再用 getAllWindows 计数", () => {
    expect(ENTRY).not.toContain("BrowserWindow.getAllWindows().length === 0");
    expect(ENTRY).toContain('app.on("second-instance", () => focusOrCreateMainWindow());');
    expect(ENTRY).toContain('app.on("activate", focusOrCreateMainWindow);');
  });
});
