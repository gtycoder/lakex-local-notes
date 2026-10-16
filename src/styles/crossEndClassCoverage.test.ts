/**
 * 跨端共享组件「两端都要有样式」契约（C4-5，261016）。
 *
 * ## 为什么需要它
 * 移动端**不共享桌面样式层**（用户 261012 定稿：逻辑共享、外观各端自有）⇒ 同一批结构类名
 * （.image-lightbox* / .attachment-preview* / .quick-note-preview* …）被两端**各写一份外观**。
 * 这本身是设计，但有个盲区：**共享组件新增一个结构类名时只补一端 ⇒ 另一端渲染成「裸元素」**
 * （不报错、也没有样式，最难发现）。
 *
 * 现有护栏盖不住它：移动快照 6 态 + 走查 23 屏**不打开** Lightbox / 附件预览
 * （src/mobile/features.css 头注释自认「不在 22 屏走查覆盖里」）。
 *
 * ## 本测试干三件事
 * ① **防清单腐烂**：移动端 import 到的 UI 组件里，凡会发出自有静态类名的，必须登记进 SHARED；
 * ② **防僵尸清单**：登记过的组件必须仍被移动端使用（不再共享就从 SHARED 移除）；
 * ③ **查覆盖**：登记组件发出的每个静态类名，**两端的自有 CSS 都必须有规则**；
 *    已在 KNOWN_GAPS 登记的缺口只报警告（**只许减**），新增缺口直接失败。
 *
 * 只统计**字符串字面量**形式的类名（className="a b" / 模板串 / 字符串表达式）；
 * 条件表达式或拼装出来的类名一律跳过 —— 宁可漏报，也不要误报。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");
const SKIP = new Set(["node_modules", "dist", "dist-mobile", "dist-electron", ".git", "vendor"]);

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, exts, out); }
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

/** 已登记为「跨端共享」的 UI 组件（相对 src/）：发出的结构类名必须两端都有样式。 */
const SHARED = [
  "features/attachment/AttachmentPreview.tsx",   // 附件/图片预览：移动端外观见 mobile/features.css
  "features/editor/ImageLightbox.tsx",           // 图片放大：同上
  "features/editor/LakeEditor.tsx",              // 编辑器宿主：出错态 .editor-error
  "features/quickNotes/QuickNoteEditor.tsx",     // 小记写作区宿主：.quick-note-editor
  "features/quickNotes/QuickNotePreview.tsx",    // 小记只读预览：mobile/quick-notes.css
];

/** 已知缺口（只许减）：登记后只报警告；补上对应端的样式后请删掉该条。 */
const KNOWN_GAPS: Record<string, string[]> = {
  // 261016 发现：LakeEditor 在 error 态渲染 .editor-error（桌面 misc.css:8 有规则），
  // 移动端 TrashPreviewPage 也会挂 LakeEditor，但 mobile CSS 里没有这条 ⇒ 出错时是裸元素。
  // 修法 = 在 src/mobile/features.css 按移动端令牌补一条（属移动端视觉，需设备验收）。
  "features/editor/LakeEditor.tsx": ["editor-error"],
};

const FOREIGN = /^(ne-|ant-|lakex-|plait-|univer-|b3-|fn__|drawnix)/;
const CLS_ATTR = /className=(?:"([^"]+)"|\{\x60([^\x60]*)\x60\}|\{"([^"]+)"\})/g;

/** 组件发出的自有静态类名（排除内核/第三方，以及两端 kit 传入的 ln-* / mb-*）。 */
function classTokens(file: string): string[] {
  const out = new Set<string>();
  for (const m of readFileSync(file, "utf8").matchAll(CLS_ATTR)) {
    for (const t of (m[1] ?? m[2] ?? m[3] ?? "").split(/[^A-Za-z0-9_-]+/)) {
      if (/^[a-z][a-z0-9_-]*$/i.test(t) && !FOREIGN.test(t) && !t.startsWith("ln-") && !t.startsWith("mb-")) out.add(t);
    }
  }
  return [...out].sort();
}

/** 移动端 import 到的 UI 组件（相对路径解析到真实文件）。 */
function mobileImportedUi(): string[] {
  const out = new Set<string>();
  const files = walk(path.join(SRC, "mobile"), [".ts", ".tsx"]).filter((f) => !f.endsWith(".test.ts"));
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue;
      const base = path.normalize(path.join(path.dirname(f), spec));
      const hit = [base + ".tsx", base + ".ts", base].find((c) => c.endsWith(".tsx") && existsSync(c));
      if (hit && (hit.startsWith(path.join(SRC, "features")) || hit.startsWith(path.join(SRC, "components")))) out.add(hit);
    }
  }
  return [...out].sort();
}

const isTheme = (p: string) => p.includes("/styles/themes/") || p.includes("/mobile/theme/");
const desktopCss = walk(SRC, [".css"]).filter((p) => !isTheme(p) && !p.includes("/mobile/") && !p.includes("/vendor/"));
const mobileCss = walk(path.join(SRC, "mobile"), [".css"]).filter((p) => !isTheme(p));
const cssText = (files: string[]) => files.map((f) => readFileSync(f, "utf8")).join("\n");

describe("跨端共享组件：两端都要有样式（C4-5）", () => {
  it("移动端 import 的 UI 组件里，会发自有类名的必须登记进 SHARED（防清单腐烂）", () => {
    const unregistered = mobileImportedUi()
      .filter((f) => classTokens(f).length > 0)
      .map(rel)
      .filter((f) => !SHARED.includes(f));
    expect(unregistered, "以下组件被移动端使用且会发出自有类名，但没登记进 SHARED：\n  " + unregistered.join("\n  ")).toEqual([]);
  });

  it("SHARED 里登记的组件必须仍被移动端使用（防僵尸清单）", () => {
    const live = new Set(mobileImportedUi().map(rel));
    const stale = SHARED.filter((f) => !live.has(f));
    expect(stale, "以下组件已不被移动端使用（不再共享），请从 SHARED 移除：\n  " + stale.join("\n  ")).toEqual([]);
  });

  it("每个结构类名在两端都有规则；新增缺口直接失败（已知缺口只许减）", () => {
    const desktopText = cssText(desktopCss);
    const mobileText = cssText(mobileCss);
    const fresh: string[] = [];
    const known: string[] = [];
    for (const f of SHARED) {
      for (const cls of classTokens(path.join(SRC, f))) {
        const missDesktop = !desktopText.includes("." + cls);
        const missMobile = !mobileText.includes("." + cls);
        if (!missDesktop && !missMobile) continue;
        const line = f + " → ." + cls + (missDesktop ? "（缺桌面）" : "") + (missMobile ? "（缺移动）" : "");
        if ((KNOWN_GAPS[f] ?? []).includes(cls)) known.push(line);
        else fresh.push(line);
      }
    }
    if (known.length) console.warn("[C4-5] 已知跨端样式缺口（待补，见 KNOWN_GAPS，只许减）:\n  " + known.join("\n  "));
    expect(fresh, "以下结构类名只在一端有样式（另一端会渲染成裸元素）：\n  " + fresh.join("\n  ")).toEqual([]);
  });
});
