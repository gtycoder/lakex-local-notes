import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_PACKAGE_FILE_PREFIXES,
  ASAR_UNPACKED_DIR,
  BOOT_SPLASH_ASSETS,
  BOOT_SPLASH_FILE,
  ELECTRON_ASAR_UNPACK,
  ELECTRON_MAIN_ENTRY,
  ELECTRON_MAIN_FILE,
  ELECTRON_OUT_DIR,
  ELECTRON_PACKAGE_FILES,
  PRELOAD_SOURCE_FILE,
  SOURCE_TREE_PACKAGE_FILES,
  appDirOf,
  bootSplashPath,
  preloadPath,
} from "./buildTarget.js";
import { stripComments } from "./testing/sourceText.js";

/**
 * 打包内容与产物布局契约（批次 A-8 / A-9，2026-11-16）。
 *
 * 出处：`docs/arch/ELECTRON-LAYERING-AUDIT.md` §4.1（P1 preload 路径 / P2 启动页 404 / P3 APP_DIR
 * 漂移 / P4 main 字段不一致 / P5 external 漏项）与 §5 批次 A。
 *
 * 这些问题的共同点：**只在打包后才炸，dev 全绿**。所以护栏必须是「不构建也能查」的静态断言：
 * - `electron/buildTarget.ts` 是产物布局的唯一来源（入口 / 输出目录 / 源树直接进包清单 / 路径派生）；
 * - `vite.config.ts` 与 `electron/main.ts` 必须**引用**它，而不是再写一份字面量；
 * - `package.json build.files` 必须与它逐字相等（package.json 不能 import TS ⇒ 用断言当契约）。
 *
 * 与 `electron/bootAssets.test.ts` 分工：那边是启动页**正向**契约（HTML 不内联图片、files 含三件），
 * 这里是**负向**契约（哪些东西不许进包、路径必须从常量派生）。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

interface PackageJson {
  main?: string;
  build?: { files?: string[]; asarUnpack?: string[] };
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as PackageJson;
const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** 源码断言必须剥注释：否则把实现改回去、注释留着，门禁照绿（261116 review P1-4）。 */
const readCode = (rel: string): string => stripComments(readSource(rel));

describe("产物布局契约：electron/buildTarget.ts 内部自洽", () => {
  it("main 文件 = 输出目录 + /main.js", () => {
    expect(ELECTRON_MAIN_FILE).toBe(ELECTRON_OUT_DIR + "/main.js");
    expect(path.posix.join(ELECTRON_OUT_DIR, "main.js")).toBe(ELECTRON_MAIN_FILE);
  });

  it("入口在源树里、且在 vite 可达位置（防止把入口写进产物目录）", () => {
    expect(fs.existsSync(path.join(ROOT, ELECTRON_MAIN_ENTRY))).toBe(true);
    expect(ELECTRON_MAIN_ENTRY.startsWith("electron/")).toBe(true);
  });

  it("preload 与启动页三件确实存在于源树（否则打包后才发现缺文件）", () => {
    for (const rel of [PRELOAD_SOURCE_FILE, BOOT_SPLASH_FILE, ...BOOT_SPLASH_ASSETS]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel + " 不存在").toBe(true);
    }
  });
});

describe("package.json 打包清单 = 契约常量（A-8/A-9）", () => {
  it("main 字段指向产物入口（改 outDir 忘改 main ⇒ 打包版 Cannot find module）", () => {
    expect(pkg.main).toBe(ELECTRON_MAIN_FILE);
  });

  it("build.files 与 ELECTRON_PACKAGE_FILES 逐字相等", () => {
    expect(
      pkg.build?.files,
      "package.json build.files 与 electron/buildTarget.ts::ELECTRON_PACKAGE_FILES 不一致：\n"
      + "这是在保护「打包输入与源码目录分离」——两者必须同步改（files 是 electron-builder 的输入白名单）。",
    ).toEqual([...ELECTRON_PACKAGE_FILES]);
  });

  it("build.asarUnpack 与 ELECTRON_ASAR_UNPACK 逐字相等，且每项都在 files 里", () => {
    expect(pkg.build?.asarUnpack).toEqual([...ELECTRON_ASAR_UNPACK]);
    for (const entry of ELECTRON_ASAR_UNPACK) {
      expect(pkg.build?.files, entry + " 必须同时在 files 里（否则 asar 里没有可解包的文件）").toContain(entry);
    }
  });

  it("正向条目只允许「产物目录」或「已登记的源树直接进包文件」", () => {
    const files = pkg.build?.files ?? [];
    const unregistered = files
      .filter((entry) => !entry.startsWith("!"))
      .filter((entry) => !ALLOWED_PACKAGE_FILE_PREFIXES.some((prefix) => entry.startsWith(prefix)))
      .filter((entry) => !(SOURCE_TREE_PACKAGE_FILES as readonly string[]).includes(entry));
    expect(
      unregistered,
      "build.files 出现未登记的源树文件：要么它属于产物目录，要么必须登记进 buildTarget.ts 的"
      + " SOURCE_TREE_PACKAGE_FILES（并想清楚是否该改走「构建期复制进产物目录」——见审计 §5 批次 C）。",
    ).toEqual([]);
  });

  it("测试与夹具绝不进包（思源改造前的原病：files 写整目录 electron ⇒ 34 个 *.test.js 进包）", () => {
    const files = pkg.build?.files ?? [];
    const leaked = files.filter((entry) => /\.test\.[cm]?[jt]sx?/.test(entry) || entry.includes("fixtures"));
    expect(leaked, "打包清单里出现测试/夹具路径").toEqual([]);
    // 同时确认：files 里没有任何「整个源码目录」的条目（那是思源改造前的写法）
    const wholeDir = files.filter((entry) => entry === "electron" || entry === "electron/" || entry === "electron/**");
    expect(wholeDir, "不允许把整个 electron/ 源码目录作为打包输入").toEqual([]);
  });

  it("排除项都是 ! 前缀（负向 glob 写错会静默变成「包含」）", () => {
    const negatives = (pkg.build?.files ?? []).filter((entry) => entry.includes("node_modules"));
    for (const entry of negatives) expect(entry.startsWith("!")).toBe(true);
  });
});

describe("三条硬编码路径已收口到契约函数（P1/P2/P3）", () => {
  it("appDirOf：产物目录的父级 = 应用根", () => {
    expect(appDirOf(path.join("/app", ELECTRON_OUT_DIR))).toBe("/app");
  });

  it("bootSplashPath：dev 与打包版同一个源树文件", () => {
    const buildDir = path.join("/app", ELECTRON_OUT_DIR);
    expect(bootSplashPath(buildDir)).toBe(path.join("/app", BOOT_SPLASH_FILE));
  });

  it("preloadPath：dev 指向源树", () => {
    const buildDir = path.join("/repo", ELECTRON_OUT_DIR);
    expect(preloadPath(buildDir, false)).toBe(path.join("/repo", PRELOAD_SOURCE_FILE));
  });

  it("preloadPath：打包版指向 app.asar.unpacked（asar 内沙箱 preload 有解析 Bug）", () => {
    // 真实布局：<X>.app/Contents/Resources/app.asar/dist-electron/main.js
    const resources = path.join("/Applications/LakexLocalNotes.app/Contents/Resources");
    const buildDir = path.join(resources, "app.asar", ELECTRON_OUT_DIR);
    expect(preloadPath(buildDir, true)).toBe(path.join(resources, ASAR_UNPACKED_DIR, PRELOAD_SOURCE_FILE));
  });

  it("打包版 preload 路径必须与 build.asarUnpack 登记的相对路径一致", () => {
    const resources = path.join("/Applications/LakexLocalNotes.app/Contents/Resources");
    const buildDir = path.join(resources, "app.asar", ELECTRON_OUT_DIR);
    const unpackedRoot = path.join(resources, ASAR_UNPACKED_DIR);
    const relativeToUnpacked = path.relative(unpackedRoot, preloadPath(buildDir, true)).split(path.sep).join("/");
    expect([...ELECTRON_ASAR_UNPACK]).toContain(relativeToUnpacked);
  });

  it("Electron 运行时无关：preloadPath 只做路径拼接（不读 env/不碰 electron）", () => {
    const buildDir = path.join("/repo", ELECTRON_OUT_DIR);
    expect(preloadPath(buildDir, false)).toBe(preloadPath(buildDir, false));
    expect(preloadPath(buildDir, true).includes(ASAR_UNPACKED_DIR)).toBe(true);
  });
});

describe("构建配置与运行期入口都引用契约，而不是复制字面量", () => {
  it("vite.config.ts 用契约常量做 entry/outDir，并用共享 external 判据", () => {
    const viteConfig = readCode("vite.config.ts");
    expect(viteConfig, "vite.config.ts 必须 import 契约模块").toMatch(/from "\.\/electron\/buildTarget"/);
    expect(viteConfig, "entry 必须来自契约").toContain("entry: ELECTRON_MAIN_ENTRY");
    expect(viteConfig, "outDir 必须来自契约").toContain("outDir: ELECTRON_OUT_DIR");
    expect(viteConfig, "external 必须是包了 dependencies 的派生函数").toContain("external: externalForMainProcess");
    // 防回退：字面量写法不允许再出现
    expect(viteConfig.includes(`entry: "${ELECTRON_MAIN_ENTRY}"`), "entry 又写回字面量了").toBe(false);
    expect(viteConfig.includes(`outDir: "${ELECTRON_OUT_DIR}"`), "outDir 又写回字面量了").toBe(false);
  });

  it("electron/main.ts 的三条路径都走契约函数（不许再出现裸相对路径）", () => {
    const main = readCode(path.join("electron", "main.ts"));
    expect(main, "main.ts 必须 import 契约函数").toMatch(/from "\.\/buildTarget\.js"/);
    expect(main).toContain("appDirOf(BUILD_DIR)");
    expect(main).toContain("bootSplashPath(BUILD_DIR)");
    expect(main).toContain("preloadPath(BUILD_DIR, app.isPackaged)");
    // 防回退：这三条老字面量是「打包版才炸」的高危点，出现即红
    for (const literal of ['"../electron/preload.cjs"', '"../../app.asar.unpacked', '"../electron/boot.html"']) {
      expect(main.includes(literal), `main.ts 里又出现硬编码路径 ${literal}`).toBe(false);
    }
  });
});
