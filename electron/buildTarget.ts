/**
 * 主进程「构建产物布局」契约 —— **唯一来源**（批次 A，2026-11-16）。
 *
 * 出处：`docs/arch/ELECTRON-LAYERING-AUDIT.md` §5 批次 A（A-8/A-9）与 §4.1 P1/P2/P3/P4/P5。
 *
 * ## 为什么要有这个文件
 * 「产物放在哪、入口叫什么、哪些源树文件直接进包、哪些 import 必须 external」这四个答案
 * 原先各写一份字面量，分散在四处：
 *   - `vite.config.ts`（entry / outDir / external 派生）
 *   - `package.json`（main / build.files / build.asarUnpack）
 *   - `electron/main.ts`（APP_DIR / boot.html / preload 两条分支的硬编码相对路径）
 *   - 测试（`bootAssets.test.ts` 只断言启动页三件在 files 里）
 * 改一处漏一处的代价是**只在打包后才炸**：preload 路径错 = 全部 IPC 报「不是函数」；
 * 启动页路径错 = 打包版白屏 8s；external 漏项 = 原生模块被打进 bundle（历史事故：
 * sharp 的 @img 平台包，见 scripts/ci-packaged-smoke.sh 头注释）。
 *
 * ## 纪律
 * - **不 import electron / 不读 import.meta.url**：产物目录的绝对路径由入口传入，
 *   所以 vite 配置、运行期入口、测试三边都能 import 本文件；
 * - 新增「源树文件直接进包」必须同时改 `ELECTRON_PACKAGE_FILES`，否则
 *   `electron/buildContract.test.ts` 与 `electron/bootAssets.test.ts` 会红；
 * - 想彻底去掉「源树进包」（把 public 资源挪进产物目录）是 §5 批次 C 的事，
 *   本文件是那一步的前置：先把「哪里说了算」收敛成一个模块。
 */
import path from "node:path";

/** vite 主进程产物的输出目录（相对仓库根）。`vite.config.ts` 与 `package.json main` 共用。 */
export const ELECTRON_OUT_DIR = "dist-electron";

/** 主进程构建入口（相对仓库根）。 */
export const ELECTRON_MAIN_ENTRY = "electron/main.ts";

/** electron 运行期入口文件（= `package.json main`）。 */
export const ELECTRON_MAIN_FILE = `${ELECTRON_OUT_DIR}/main.js`;

/** 原生 CJS preload：**不进 Vite 构建**，由 files/asarUnpack 直接收进包（见 ipcChannelParity.test.ts 头注释）。 */
export const PRELOAD_SOURCE_FILE = "electron/preload.cjs";

/** 启动遮罩页与它的两张图：源树文件直接进包（build.files 里逐个列出）。 */
export const BOOT_SPLASH_FILE = "electron/boot.html";
/** 261120：去掉带动画 APNG（它带薄荷圆盘）——启动页只留透明折纸 poster。 */
export const BOOT_SPLASH_ASSETS = ["electron/boot-poster.png"] as const;

/** Electron 打包后 asar 外层解包目录名（固定名，不能改）。 */
export const ASAR_UNPACKED_DIR = "app.asar.unpacked";

/** `build.asarUnpack`：必须解包的文件（沙箱 preload 在 asar 内解析有坑）。 */
export const ELECTRON_ASAR_UNPACK = [PRELOAD_SOURCE_FILE] as const;

/**
 * `build.files` 的**唯一来源**。`package.json` 必须与本清单逐字相等
 * （由 `electron/buildContract.test.ts` 断言；package.json 不能 import TS，所以用断言而非生成）。
 *
 * 结构分三类：产物目录（dist / dist-electron）、源树直接进包（preload + 启动页三件）、
 * 排除项（`!` 前缀的负向 glob）。
 */
export const ELECTRON_PACKAGE_FILES = [
  "dist/**/*",
  `${ELECTRON_OUT_DIR}/**/*`,
  PRELOAD_SOURCE_FILE,
  BOOT_SPLASH_FILE,
  ...BOOT_SPLASH_ASSETS,
  "!**/*.map",
  "!node_modules/better-sqlite3/deps/**",
  "!node_modules/better-sqlite3/build/Release/obj/**",
  // ---- 打包瘦身（261117）：只裁「运行时永远不加载」的文件，不碰任何 native/入口/asarUnpack ----
  // openai 的 TS 源码（运行时入口是 index.js → dist/*.js；已实测其 js 不引用 ../src）
  "!node_modules/openai/src/**",
  // 类型声明：运行时（Node require/ESM import）只解析 .js/.mjs，.d.ts/.d.mts/.d.cts 永不加载
  "!node_modules/**/*.d.ts",
  "!node_modules/**/*.d.mts",
  "!node_modules/**/*.d.cts",
] as const;

/** 只读区：`files` 里允许出现的正向条目前缀（产物目录 + 已登记的源树直接进包文件）。 */
export const ALLOWED_PACKAGE_FILE_PREFIXES = ["dist/", `${ELECTRON_OUT_DIR}/`] as const;

/** 允许「源树直接进包」的完整文件清单（正向条目里除产物目录之外的例外，逐条登记）。 */
export const SOURCE_TREE_PACKAGE_FILES = [PRELOAD_SOURCE_FILE, BOOT_SPLASH_FILE, ...BOOT_SPLASH_ASSETS] as const;

/**
 * 构建产物目录 → 应用根目录（asar 内的一级目录）。
 * 入口是 `dist-electron/main.js`，故应用根 = 产物目录的父级。
 */
export function appDirOf(buildDir: string): string {
  return path.join(buildDir, "..");
}

/**
 * 渲染进程 preload 的绝对路径。
 *
 * - 打包版：preload 在 `resources/app.asar.unpacked/electron/preload.cjs`
 *   （asar 内沙箱 preload 在 Electron 33 有解析 Bug ⇒ 必须走 unpacked；见 `package.json build.asarUnpack`）；
 * - dev：直接指向源树里的 `electron/preload.cjs`（preload 不进 Vite 构建）。
 *
 * ⚠️ 两条分支都从**产物目录**上溯，所以「产物目录在 asar 内的深度」是硬约束：
 * 换目录层级（例如挪进 `build/electron/`）必须同步改本函数，否则打包版所有 IPC 静默失效。
 */
export function preloadPath(buildDir: string, isPackaged: boolean): string {
  return isPackaged
    ? path.join(buildDir, "..", "..", ASAR_UNPACKED_DIR, PRELOAD_SOURCE_FILE)
    : path.join(buildDir, "..", PRELOAD_SOURCE_FILE);
}

/** 启动遮罩页的绝对路径（源树文件，同样从产物目录上溯）。 */
export function bootSplashPath(buildDir: string): string {
  return path.join(buildDir, "..", BOOT_SPLASH_FILE);
}

/**
 * 主进程 external 判据（**从 `package.json dependencies` 派生，不是硬编码清单**）。
 *
 * 为什么是纯函数：`vite.config.ts` 负责读 package.json 并注入 `runtimeDeps`，
 * 而「这个 spec 该不该 external」的规则要能被单测覆盖（`electron/architecture.test.ts`）——
 * 否则新增原生依赖/传递依赖漏项时，只有打包后才会发现（AGENTS §7#9）。
 *
 * - `node:*` / `electron` / `electron/*`：Electron 运行期注入，永远 external；
 * - `@smithy/*`：`@aws-sdk/client-s3` 的传递依赖，不在 dependencies 里，显式兜底；
 * - 其余：命中 dependencies 的包名（含子路径 `pkg/sub`）即 external。
 */
export function isMainProcessExternal(id: string, runtimeDeps: readonly string[]): boolean {
  if (id.startsWith("node:") || id === "electron" || id.startsWith("electron/")) return true;
  if (id.startsWith("@smithy/")) return true;
  return runtimeDeps.some((dep) => id === dep || id.startsWith(`${dep}/`));
}
