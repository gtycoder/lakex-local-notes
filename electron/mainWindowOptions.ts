/**
 * 主窗口构造选项的纯函数构造器（261123 · Windows 融合标题栏批）。
 *
 * 把 `electron/main.ts` 里内联的 BrowserWindow 选项收成可测纯函数，平台差异集中在一处：
 * - **darwin**：`hiddenInset` + 红绿灯居中（现状 = 参考形态，零变化）；
 * - **win32**：融合标题栏（`titleBarStyle: "hidden"` + 原生窗口控制按钮 overlay + 菜单栏隐藏视觉）；
 * - **其它（Linux）**：维持系统默认框与默认菜单栏（本批不动）。
 *
 * 平台判据 = `process.platform`（与 main.ts 既有判据同源）；渲染层平台标记在
 * `src/App.tsx` 的 `shellPlatformClass`（platform-mac / platform-win / platform-native-titlebar）。
 * 平台分支行为由 `mainWindowOptions.test.ts` 钉住。
 */
import type { BrowserWindowConstructorOptions } from "electron";
import { TOPBAR_HEIGHT, TOPBAR_SEAM, TRAFFIC_LIGHT_DIAMETER } from "../src/lib/layoutMetrics.js";

/** win32 融合标题栏：原生窗口控制按钮（Window Controls Overlay）的高度 = 可见头区（顶栏 + 拼接缝），
 *  与 macOS 红绿灯居中口径同一个「头区」定义（单一来源 = src/lib/layoutMetrics.ts）。 */
export const TITLE_BAR_OVERLAY_HEIGHT = TOPBAR_HEIGHT + TOPBAR_SEAM;

/** win32 窗口控制按钮 overlay 配色（**浅 / 深两档**；暖色、清爽属浅档）。
 *  主进程读不到 CSS 变量 ⇒ 常量镜像主题令牌，单一来源关系由 `mainWindowOptions.test.ts`
 *  对 `src/styles/themes/{light,dark}.css` 逐值校验（改主题令牌不同步这里会测试红）：
 * - `color`      = 窗底带底色（`.tab-bar` 透明、透出 `--lake-bg-window`）；
 * - `symbolColor` = 窗口控制符号色（`--lake-text-1`，与顶栏图标 .toolbar__item 同色）。
 *  运行时按渲染层上报的主题色阶二选一（`applyTheme` → IPC set-title-bar-overlay）。 */
export const TITLE_BAR_OVERLAY_COLORS: Readonly<Record<"light" | "dark", { color: string; symbolColor: string }>> = {
  light: { color: "#e9edf3", symbolColor: "#1f2329" },   // = light.css --lake-bg-window / --lake-text-1
  dark: { color: "#191a1d", symbolColor: "#e7e8ea" },    // = dark.css --lake-bg-window / --lake-text-1
};

/** win32 窗口控制按钮 overlay 完整选项：主题色阶 → 配色；高度恒为可见头区。 */
export function titleBarOverlayFor(scheme: "light" | "dark"): { color: string; symbolColor: string; height: number } {
  return { ...TITLE_BAR_OVERLAY_COLORS[scheme], height: TITLE_BAR_OVERLAY_HEIGHT };
}

/** 菜单栏只藏视觉（main.ts 用 `win.setMenuBarVisibility(false)`）：win32 融合标题栏不再显示
 *  「File/Edit/View/Window」默认菜单栏，但**默认菜单的快捷键全部保留**（Ctrl+R / F11 / Ctrl+± 等
 *  照旧生效）——不 setApplicationMenu(null) 是怕砍掉没有替代入口的功能，逐项对照表见交付简报。
 *  darwin 走自定义应用菜单（appMenu.ts，AGENTS §4）、Linux 不动 ⇒ 只有 win32 需要藏。 */
export function shouldHideMenuBar(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export interface BuildMainWindowOptionsInput {
  platform: NodeJS.Platform;
  /** 恢复后的窗口几何（x/y/width/height）。 */
  bounds: { x: number; y: number; width: number; height: number };
  /** 首帧前的主题色阶（true = 深档）：决定窗口底色（与 boot 窗一致）与 win32 overlay 兜底配色。 */
  dark: boolean;
  /** preload 路径（规则单一来源 = electron/buildTarget.ts::preloadPath，main.ts 算好传入）。 */
  preload: string;
}

/** 纯函数：产出主窗口 BrowserWindow 构造选项；不碰 Electron 运行时（便于单测钉平台差异）。 */
export function buildMainWindowOptions(input: BuildMainWindowOptionsInput): BrowserWindowConstructorOptions {
  const { platform, bounds, dark, preload } = input;
  const options: BrowserWindowConstructorOptions = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 560,
    minHeight: 480,
    show: false,
    // 与 boot 窗同一个主题底色：渲染进程重载/首帧失败时也不能闪纯白。
    // 同 boot 窗：浅色档纯白（首帧前的那一层）；深色档 #1e2126。
    backgroundColor: dark ? "#1e2126" : "#FFFFFF",
    webPreferences: {
      // 打包版直接指向 app.asar.unpacked 里的真实文件（asar 内 preload 在 Electron 33 有解析 Bug）。
      // 两条分支的路径规则是构建产物契约的一部分，统一在 electron/buildTarget.ts::preloadPath。
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      // 260923：preload 已在 package.json 的 build.asarUnpack 中（asar 内沙箱 preload 的旧 Bug 不适用）；
      // 开渲染进程沙箱 = OS 级纵深防御，contextIsolation 仍开启。
      sandbox: true,
      // PDF 内联预览：plugins 默认 false（electron.d.ts 注释确认）会禁用 <embed> 插件渲染
      // → PDF viewer 空白（实测）。plugins: true 启用 Chromium PDF viewer。
      plugins: true,
    },
  };
  if (platform === "darwin") {
    options.titleBarStyle = "hiddenInset";
    // 红绿灯垂直居中到「可见头区」中心：y + 直径/2 = (TOPBAR_HEIGHT + TOPBAR_SEAM)/2。
    // **别再把 y 写成常数**：曾因顶栏 38→32 而红绿灯没跟、中心错位 3px（用户 260923 报）。
    options.trafficLightPosition = { x: 14, y: (TOPBAR_HEIGHT + TOPBAR_SEAM - TRAFFIC_LIGHT_DIAMETER) / 2 };
    return options;
  }
  if (platform === "win32") {
    // 融合标题栏（261123 用户点单「顶部 2 层太臃肿」）：去掉系统标题栏 + 默认菜单栏两层，
    // 应用顶栏（.tab-bar）即标题栏（拖拽 / 双击最大化由 -webkit-app-region: drag 承担），
    // 原生最小化 / 最大化 / 关闭按钮以 overlay 浮在右上（保留 Win11 贴靠布局与系统行为，不自绘）。
    options.titleBarStyle = "hidden";
    options.titleBarOverlay = titleBarOverlayFor(dark ? "dark" : "light");
    // 菜单栏视觉由 main.ts 的 setMenuBarVisibility(false) 收（shouldHideMenuBar 同处判据）：
    // 只藏视觉、保留默认菜单快捷键；不 setApplicationMenu(null) 是怕砍掉没有替代入口的功能。
    return options;
  }
  // Linux 及其它平台不动：系统默认框（titleBarStyle 默认值）+ 默认菜单栏。
  return options;
}
