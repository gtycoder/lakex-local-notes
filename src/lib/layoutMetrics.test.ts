import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCK_GUTTER, FIXED_RAIL_WIDTH, TOPBAR_HEIGHT, TOPBAR_SEAM, TRAFFIC_LIGHT_DIAMETER } from "./layoutMetrics";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("desktop rail geometry", () => {
  it("uses one shared, slightly wider-than-34px rail", () => {
    expect(FIXED_RAIL_WIDTH).toBe(38);
    expect(FIXED_RAIL_WIDTH).toBeGreaterThan(34);
    expect(FIXED_RAIL_WIDTH).toBeLessThan(40);
    expect(DOCK_GUTTER).toBe(4);
  });
});

describe("top bar ↔ macOS traffic light alignment", () => {
  it("keeps base.css --topbar-height equal to the shared TOPBAR_HEIGHT", () => {
    const css = readFileSync(path.join(ROOT, "src/styles/app/base.css"), "utf8");
    const match = css.match(/--topbar-height:\s*(\d+)px/);
    expect(match, "--topbar-height 未在 base.css 找到").not.toBeNull();
    expect(Number(match?.[1])).toBe(TOPBAR_HEIGHT);
  });

  it("centers the traffic lights on the visible header (topbar + seam) instead of hardcoding y", () => {
    const src = readFileSync(path.join(ROOT, "electron/main.ts"), "utf8");
    // 必须用共享常量算（头区 = 顶栏 + 拼接缝），且不能再出现字面量 y
    expect(src).toContain("(TOPBAR_HEIGHT + TOPBAR_SEAM - TRAFFIC_LIGHT_DIAMETER) / 2");
    expect(src).not.toMatch(/trafficLightPosition:\s*\{\s*x:\s*\d+,\s*y:\s*\d+\s*\}/);
    const y = (TOPBAR_HEIGHT + TOPBAR_SEAM - TRAFFIC_LIGHT_DIAMETER) / 2;
    expect(Number.isInteger(y)).toBe(true);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it("全屏（macOS 独立 Space）下顶栏不再留红绿灯让位：主进程广播 → 渲染层切根类 → CSS 收窄到 10px", () => {
    // 主进程：enter/leave-full-screen 都要广播；renderer-ready 时补一次初始态（启动即全屏的恢复路径）
    const main = readFileSync(path.join(ROOT, "electron/main.ts"), "utf8");
    expect(main).toContain('win.webContents.send("window-fullscreen", win.isFullScreen())');
    expect(main).toMatch(/win\.on\("enter-full-screen", \(\) => \{ persistWindowState\(\); sendWindowFullscreen\(\); \}\)/);
    expect(main).toMatch(/win\.on\("leave-full-screen", \(\) => \{ persistWindowState\(\); sendWindowFullscreen\(\); \}\)/);
    expect(main).toMatch(/revealMainWindow\("renderer-ready"\);\s*\n\s*\/\/[^\n]*初始态\s*\n\s*sendWindowFullscreen\(\);/);
    // IPC 三处同步：preload 暴露 + native 类型/封装
    const preload = readFileSync(path.join(ROOT, "electron/preload.cjs"), "utf8");
    expect(preload).toContain('ipcRenderer.on("window-fullscreen"');
    expect(preload).toContain("onWindowFullscreen");
    const nativeSrc = readFileSync(path.join(ROOT, "src/lib/native.ts"), "utf8");
    expect(nativeSrc).toContain("onWindowFullscreen(callback: (fullscreen: boolean) => void): () => void;");
    expect(nativeSrc).toContain("onWindowFullscreen: (callback: (fullscreen: boolean) => void) => api().onWindowFullscreen(callback),");
    // 渲染层：订阅后切 :root 类（全屏态 CSS 的唯一判据）
    const app = readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
    expect(app).toContain("native.onWindowFullscreen(apply)");
    expect(app).toContain('classList.toggle("window-fullscreen"');
    expect(app).toContain('classList.remove("window-fullscreen"');
    // CSS：全屏 chrome 单一来源 = styles/window-chrome.css（顶栏 10px/no-drag + 附件预览回到 16px）
    const chrome = readFileSync(path.join(ROOT, "src/styles/window-chrome.css"), "utf8");
    expect(chrome).toMatch(/:root\.window-fullscreen \.platform-mac \.tab-bar \{[^}]*padding-left: 10px;[^}]*-webkit-app-region: no-drag;/);
    expect(chrome).toMatch(/:root\.window-fullscreen \.attachment-preview\.is-mac \.attachment-preview__toolbar \{[^}]*padding-left: 16px;/);
    const tabs = readFileSync(path.join(ROOT, "src/styles/app/tabs.css"), "utf8");
    // 窗口/最大化态仍保留 82px 让位（别把原规则一起改掉）；全屏规则不再散落在 tabs.css
    expect(tabs).toMatch(/\.platform-mac \.tab-bar \{\s*\n\s*padding-left: 82px;/);
    expect(tabs).not.toContain("window-fullscreen");
  });
});
