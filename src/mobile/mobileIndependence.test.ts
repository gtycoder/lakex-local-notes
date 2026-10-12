/**
 * 移动端 UI 独立性围栏（P0 · 261012 立项）
 *
 * 口径（用户 261012 定稿）：移动端要有自己的适配与 UI 规则，仅共享「必要逻辑」，**不共享样式与 UI**。
 * 本文件把这条口径变成可断言的不变量：**允许红、基线只许降**（对齐桌面 cssLayers 的做法）。
 *
 * 依据：docs/MOBILE-UI-REDESIGN.md §6（P0）· docs/MOBILE-TECH-STACK.md §9.3 · docs/MOBILE-DESKTOP-DECOUPLING.md §4
 *
 * 三条判据：
 *   ① src/mobile/** 不得 import 桌面样式（src/styles/** 与桌面 feature CSS）；内核（@dlient/lakex-doc-react）
 *      与第三方（@univerjs/**）样式属 ① 层（两端共用一个内核），允许；
 *   ② 移动端源码里的桌面类名 token（ln-* / config-* / b3-* / fn__*）计数只许降；
 *   ③ 桌面 CSS 为移动端开的分支（mobile-app）只许降（解耦是双向的）。
 *
 * 计数口径（必须写清，否则数字无法复核）：
 *   - 类名计数 = **去掉注释后**、在**单/双引号字符串字面量内**出现的 ln-/config-/b3-/fn__ 前缀 token 数。
 *     实测：移动端无「模板字符串里写这四类前缀」的用法（仅 home-section / mobile-settings-page），
 *     故不需要处理反引号字面量。该口径是宽松上界（含 className 之外的字符串），服务的是「单调下降」，
 *     **不等于「JSX 类名数」**，与文档里另一种口径的 grep（56 + 8）不可直接比较。
 *   - 基线只许降：某个文件实际归零时必须把那一行删掉，否则 stale 断言会失败。
 *   - 允许清单同理：某条 import 被消灭后，必须从 ALLOWED_DESKTOP_STYLE_IMPORTS 里删掉。
 *
 * 允许清单 = 「本批要还的债」：P0 冻结现状，P1–P7 逐条消灭并同步删行。
 * 报告模式：MOBILE_INDEPENDENCE_REPORT=1 npx vitest run src/mobile/mobileIndependence.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const MOBILE = path.join(SRC, "mobile");
const REPORT = !!process.env.MOBILE_INDEPENDENCE_REPORT;

/** 内核 / 第三方样式：① 层，两端共用一个内核，允许（不是我们的设计系统）。 */
const VENDOR_STYLE_PREFIXES = ["@dlient/lakex-doc-react", "@univerjs/"];

/**
 * 桌面样式 import 允许清单（冻结现状，只许降）。
 * 键 = 相对 src/ 的文件路径；值 = 允许的 import 说明符。
 * styles/fonts/** 是**资源**不是设计系统（MOBILE-TECH-STACK §9.3 第 4 条）⇒ 允许，
 * 但字号/行高/密度必须由移动端令牌决定（P1 起）。
 */
const ALLOWED_DESKTOP_STYLE_IMPORTS: Record<string, string[]> = {
  "mobile/main.tsx": [
    "../features/editor/image-lightbox.css", // P6 变体化
    "../features/attachment/attachment-preview.css", // P6 变体化
    "../styles/fonts/misans/misans.css", // 资源（MiSans，与桌面同一逻辑）
    "../styles/fonts/jetbrains-mono/jetbrains-mono.css", // 资源
    "../styles/compat.css", // P2/P5 消灭（config-*/b3-*/fn__*）
    "../styles/kit.css", // P2 消灭（改用 mb-*）
    "../styles/components.css", // P2/P3 消灭
    "../styles/app/quick-notes.css", // P5 消灭（小记外壳移动端自有）
    "../styles/dialog.css", // P3 消灭（改 mb-sheet/mb-dialog）
  ],
  "mobile/trash/TrashPreviewPage.tsx": ["../../styles/fonts/font-overrides.css"], // 资源
  "mobile/editor/DocumentEditor.tsx": ["../../styles/fonts/font-overrides.css"], // 资源
};

/**
 * 桌面类名 token 基线（每文件，只许降；口径见文件头）。
 * 261012 P0 冻结实测（当时工作区 = 261012 移动端批交付后）。
 */
const CLASS_TOKEN_BASELINE: Record<string, number> = {
  // **已清零**：P2 迁 10 个文件（150 → 109），P4 整屏重写设置页（109 → 0）。
  // 这里保持空对象 = 移动端源码里**不允许再出现**任何 ln-/config-/b3-/fn__ 类名 token；
  // 新增使用会被 "grew" 断言直接拦下（要加就说明你又把桌面原语引回移动端了）。
};

/**
 * 桌面/共享 UI 组件件 import 允许清单（冻结现状，只许降）。
 * treeDrag = 拖拽逻辑与 DOM 混合件（§9.2 列为待拆）；P6 组件变体化时一并处置。
 */
const ALLOWED_DESKTOP_COMPONENT_IMPORTS: Record<string, string[]> = {
  "mobile/notebook/NotebookWorkspace.tsx": ["../../components/treeDrag"],
};

/** 桌面侧反向耦合基线（mobile-app 在 src/styles/** 的出现次数，只许降）。 */
const REVERSE_COUPLING_BASELINE: Record<string, number> = {
  "styles/kit.css": 18, // P2：checkbox/radio 的 :is(.app-shell,.mobile-app) 收窄回 .app-shell
};

const read = (abs: string): string => readFileSync(abs, "utf8");
const relOf = (abs: string): string => path.relative(SRC, abs).split(path.sep).join("/");

/** 只走给定目录（跳过 node_modules 与测试文件）。 */
function listFiles(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (exts.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
  }
  return out.sort();
}

/** 去掉块注释与行注释（行注释不误伤 https:// 这类协议头）。 */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/** 拼接所有单/双引号字符串字面量，用于类名 token 计数（口径见文件头）。 */
function stringLiterals(s: string): string {
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? "");
  return out.join(" ");
}

const CLASS_TOKEN = /\b(?:ln-|config-|b3-|fn__)[a-z0-9_-]+/g;

/** import 说明符（含 import "x" 这种副作用导入）。 */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /import\s+(?:[^"']*?from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

const isVendorStyle = (spec: string): boolean => VENDOR_STYLE_PREFIXES.some((p) => spec.startsWith(p));

/** CSS 说明符是否指向 src/mobile 之外的「我们的」样式（含桌面 feature CSS）。 */
function isForeignOwnCss(spec: string): boolean {
  if (!spec.endsWith(".css")) return false;
  if (spec.startsWith("./") || spec.startsWith("../mobile/")) return false;
  if (isVendorStyle(spec)) return false;
  return true;
}

describe("移动端 UI 独立性围栏（P0）", () => {
  it("src/mobile 不得新增桌面样式 import（允许清单只许降）", () => {
    const surprises: string[] = [];
    const seen = new Set<string>();
    for (const abs of listFiles(MOBILE, /\.(tsx|ts)$/)) {
      const rel = relOf(abs);
      for (const spec of importSpecifiers(read(abs))) {
        if (!isForeignOwnCss(spec)) continue;
        seen.add(rel + " :: " + spec);
        const allowed = ALLOWED_DESKTOP_STYLE_IMPORTS[rel] ?? [];
        if (!allowed.includes(spec)) surprises.push(rel + " -> " + spec);
      }
    }
    const stale: string[] = [];
    for (const [rel, specs] of Object.entries(ALLOWED_DESKTOP_STYLE_IMPORTS)) {
      for (const spec of specs) if (!seen.has(rel + " :: " + spec)) stale.push(rel + " -> " + spec);
    }
    if (REPORT) {
      console.log("== 桌面样式 import（现状） ==\n" + [...seen].sort().join("\n"));
      console.log("== 已消灭、应从允许清单删掉 ==\n" + stale.join("\n"));
    }
    expect(
      surprises,
      "以下 import 让移动端又依赖了桌面样式（移动端不得共享桌面样式；内核/第三方样式与 styles/fonts 资源除外）：\n  " +
        surprises.join("\n  ")
    ).toEqual([]);
    expect(
      stale,
      "以下 import 已不存在，请从 ALLOWED_DESKTOP_STYLE_IMPORTS 删掉（基线只许降）：\n  " + stale.join("\n  ")
    ).toEqual([]);
  });

  it("移动端源码里的桌面类名 token 计数不超过基线（只许降）", () => {
    const actual: Record<string, number> = {};
    for (const abs of listFiles(MOBILE, /\.(tsx|ts)$/)) {
      const rel = relOf(abs);
      const n = (stringLiterals(stripComments(read(abs))).match(CLASS_TOKEN) ?? []).length;
      if (n > 0) actual[rel] = n;
    }
    const grew: string[] = [];
    for (const [rel, n] of Object.entries(actual)) {
      const base = CLASS_TOKEN_BASELINE[rel] ?? 0;
      if (n > base) grew.push(rel + ": " + base + " -> " + n);
    }
    const stale = Object.keys(CLASS_TOKEN_BASELINE).filter((rel) => !actual[rel]);
    if (REPORT) {
      console.log("== 桌面类名 token（现状） ==\n" + JSON.stringify(actual, null, 1));
      console.log("TOTAL = " + Object.values(actual).reduce((a, b) => a + b, 0));
    }
    expect(
      grew,
      "以下文件新增了桌面类名（ln-*/config-*/b3-*/fn__*）。移动端新 UI 一律用 mb-*，不要再用桌面原语：\n  " +
        grew.join("\n  ")
    ).toEqual([]);
    expect(
      stale,
      "以下文件已归零，请从 CLASS_TOKEN_BASELINE 删掉（基线只许降）：\n  " + stale.join("\n  ")
    ).toEqual([]);
  });

  it("桌面 CSS 里的移动端分支不超过基线（反向耦合只许降）", () => {
    const actual: Record<string, number> = {};
    for (const abs of listFiles(path.join(SRC, "styles"), /\.css$/)) {
      const n = (read(abs).match(/mobile-app/g) ?? []).length;
      if (n > 0) actual[relOf(abs)] = n;
    }
    const grew: string[] = [];
    for (const [rel, n] of Object.entries(actual)) {
      const base = REVERSE_COUPLING_BASELINE[rel] ?? 0;
      if (n > base) grew.push(rel + ": " + base + " -> " + n);
    }
    const stale = Object.keys(REVERSE_COUPLING_BASELINE).filter((rel) => !actual[rel]);
    if (REPORT) console.log("== 反向耦合（现状） ==\n" + JSON.stringify(actual, null, 1));
    expect(grew, "桌面样式里新增了为移动端开的分支（移动端应有自己的原语）：\n  " + grew.join("\n  ")).toEqual([]);
    expect(stale, "以下桌面文件已无移动端分支，请从基线删掉：\n  " + stale.join("\n  ")).toEqual([]);
  });

  it("src/mobile 不得 import 桌面/共享的 UI 组件件（只共享必要逻辑）", () => {
    const surprises: string[] = [];
    const seen = new Set<string>();
    for (const abs of listFiles(MOBILE, /\.(tsx|ts)$/)) {
      const rel = relOf(abs);
      for (const spec of importSpecifiers(read(abs))) {
        if (!/components\//.test(spec) || spec.endsWith(".css")) continue;
        seen.add(rel + " :: " + spec);
        const allowed = ALLOWED_DESKTOP_COMPONENT_IMPORTS[rel] ?? [];
        if (!allowed.includes(spec)) surprises.push(rel + " -> " + spec);
      }
    }
    const stale: string[] = [];
    for (const [rel, specs] of Object.entries(ALLOWED_DESKTOP_COMPONENT_IMPORTS)) {
      for (const spec of specs) if (!seen.has(rel + " :: " + spec)) stale.push(rel + " -> " + spec);
    }
    expect(
      surprises,
      "移动端不得复用桌面的 UI 组件件（MOBILE-TECH-STACK §9.3 第 2 条）；需要在移动端自建，或按 P6 做变体化：\n  " +
        surprises.join("\n  ")
    ).toEqual([]);
    expect(stale, "以下 import 已消灭，请从 ALLOWED_DESKTOP_COMPONENT_IMPORTS 删掉（只许降）：\n  " + stale.join("\n  ")).toEqual([]);
  });

  it("移动端不得 import 桌面 themes/**（取值层归 src/mobile/theme/**）", () => {
    const bad: string[] = [];
    for (const abs of listFiles(MOBILE, /\.(tsx|ts)$/)) {
      for (const spec of importSpecifiers(read(abs))) {
        if (/styles\/themes\//.test(spec)) bad.push(relOf(abs) + " -> " + spec);
      }
    }
    expect(
      bad,
      "桌面 themes/** 是桌面取值层；移动端取值只允许来自 src/mobile/theme/**：\n  " + bad.join("\n  ")
    ).toEqual([]);
  });
});