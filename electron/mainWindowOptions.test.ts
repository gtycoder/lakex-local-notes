/**
 * 主窗口构造选项的平台分支（261123 · win32 融合标题栏批）。
 * - win32：hidden + 原生窗口控制按钮 overlay + 菜单栏只藏视觉（默认菜单快捷键保留）；
 * - darwin：hiddenInset + 红绿灯居中（参考形态，零变化）；
 * - 其它（Linux）：默认框 + 默认菜单栏（不动）。
 * 另钉 overlay 配色常量与 src/styles/themes/{light,dark}.css 的单一来源关系
 * （主进程读不到 CSS 变量 ⇒ 常量镜像令牌，改令牌不同步这里会红）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMainWindowOptions, shouldHideMenuBar, TITLE_BAR_OVERLAY_COLORS, TITLE_BAR_OVERLAY_HEIGHT, titleBarOverlayFor } from "./mainWindowOptions.js";
import { TOPBAR_HEIGHT, TOPBAR_SEAM, TRAFFIC_LIGHT_DIAMETER } from "../src/lib/layoutMetrics.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bounds = { x: 12, y: 34, width: 1280, height: 800 };
const preload = "/p/preload.cjs";

describe("buildMainWindowOptions 平台分支", () => {
  it("win32：融合标题栏（hidden + overlay + 菜单栏只藏视觉、快捷键保留）", () => {
    const o = buildMainWindowOptions({ platform: "win32", bounds, dark: false, preload });
    expect(o.titleBarStyle).toBe("hidden");
    expect(o.titleBarOverlay).toEqual({ color: "#e9edf3", symbolColor: "#1f2329", height: TITLE_BAR_OVERLAY_HEIGHT });
    expect(o.trafficLightPosition).toBeUndefined();
    // 菜单栏只藏视觉（保留默认菜单快捷键）：判据 shouldHideMenuBar + main.ts 的 setMenuBarVisibility 接线
    expect(shouldHideMenuBar("win32")).toBe(true);
    const main = readFileSync(path.join(ROOT, "electron/main.ts"), "utf8");
    expect(main).toContain("if (shouldHideMenuBar(process.platform)) win.setMenuBarVisibility(false);");
  });

  it("darwin：hiddenInset + 红绿灯居中（参考形态零变化；不带 overlay、不藏菜单栏）", () => {
    const o = buildMainWindowOptions({ platform: "darwin", bounds, dark: false, preload });
    expect(o.titleBarStyle).toBe("hiddenInset");
    expect(o.titleBarOverlay).toBeUndefined();
    expect(shouldHideMenuBar("darwin")).toBe(false);
    expect(o.trafficLightPosition).toEqual({ x: 14, y: (TOPBAR_HEIGHT + TOPBAR_SEAM - TRAFFIC_LIGHT_DIAMETER) / 2 });
  });

  it("linux / 其它平台：默认框 + 默认菜单栏（本批不动）", () => {
    for (const platform of ["linux", "freebsd"] as NodeJS.Platform[]) {
      const o = buildMainWindowOptions({ platform, bounds, dark: false, preload });
      expect(o.titleBarStyle).toBeUndefined();
      expect(o.titleBarOverlay).toBeUndefined();
      expect(shouldHideMenuBar(platform)).toBe(false);
      expect(o.trafficLightPosition).toBeUndefined();
    }
  });

  it("共享选项（几何 / 底色 / 沙箱 / PDF 插件）与现状一致；浅档底色纯白、深档 #1e2126", () => {
    const light = buildMainWindowOptions({ platform: "win32", bounds, dark: false, preload });
    expect(light.x).toBe(12);
    expect(light.y).toBe(34);
    expect(light.width).toBe(1280);
    expect(light.height).toBe(800);
    expect(light.minWidth).toBe(560);
    expect(light.minHeight).toBe(480);
    expect(light.show).toBe(false);
    expect(light.backgroundColor).toBe("#FFFFFF");
    expect(light.webPreferences).toMatchObject({ preload, contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true });
    const dark = buildMainWindowOptions({ platform: "darwin", bounds, dark: true, preload });
    expect(dark.backgroundColor).toBe("#1e2126");
  });

  it("overlay 高度 = 可见头区（顶栏 + 拼接缝）；深档配色走 dark 档", () => {
    expect(TITLE_BAR_OVERLAY_HEIGHT).toBe(TOPBAR_HEIGHT + TOPBAR_SEAM);
    expect(titleBarOverlayFor("dark")).toEqual({ color: "#191a1d", symbolColor: "#e7e8ea", height: TITLE_BAR_OVERLAY_HEIGHT });
    expect(titleBarOverlayFor("light").height).toBe(TOPBAR_HEIGHT + TOPBAR_SEAM);
  });
});

describe("overlay 配色 ↔ 主题令牌（glue：改 themes 令牌不同步常量会红）", () => {
  it("常量与 themes/{light,dark}.css 的 --lake-bg-window / --lake-text-1 逐值相等", () => {
    for (const scheme of ["light", "dark"] as const) {
      const css = readFileSync(path.join(ROOT, `src/styles/themes/${scheme}.css`), "utf8");
      const bg = css.match(/--lake-bg-window:\s*(#[0-9a-fA-F]{6})/);
      const text = css.match(/--lake-text-1:\s*(#[0-9a-fA-F]{6})/);
      expect(bg, `${scheme}.css 未找到 --lake-bg-window`).not.toBeNull();
      expect(text, `${scheme}.css 未找到 --lake-text-1`).not.toBeNull();
      expect(TITLE_BAR_OVERLAY_COLORS[scheme].color).toBe(bg?.[1].toLowerCase());
      expect(TITLE_BAR_OVERLAY_COLORS[scheme].symbolColor).toBe(text?.[1].toLowerCase());
    }
  });

  it("win32 顶栏 = 标题栏：tabs.css .platform-win 右侧 138px 按钮让位 + drag；mac 82px 规则零变化", () => {
    const tabs = readFileSync(path.join(ROOT, "src/styles/app/tabs.css"), "utf8");
    expect(tabs).toMatch(/\.platform-win \.tab-bar \{[^}]*padding-right: 138px;[^}]*-webkit-app-region: drag;/);
    expect(tabs).toMatch(/\.platform-mac \.tab-bar \{\s*\n\s*padding-left: 82px;/);
    // 附件预览（portal 全窗浮层）的右侧让位与顶栏同值（138px；组件侧 .is-win 判定见 attachmentPreviewController.test）
    const preview = readFileSync(path.join(ROOT, "src/features/attachment/attachment-preview.css"), "utf8");
    expect(preview).toMatch(/\.attachment-preview\.is-win \.attachment-preview__toolbar \{[^}]*padding-right: 138px/);
    // 全屏（F11）撤掉让位（window-chrome.css 同款收口）
    const chrome = readFileSync(path.join(ROOT, "src/styles/window-chrome.css"), "utf8");
    expect(chrome).toMatch(/:root\.window-fullscreen \.platform-win \.tab-bar \{[^}]*padding-right: 10px;[^}]*-webkit-app-region: no-drag;/);
  });
});
