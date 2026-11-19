/**
 * 移动端顶部 Chrome 契约护栏（方案 B · docs/MOBILE-TOP-CHROME-REFACTOR.md）
 *
 * 1. 顶部表面必须声明 data-mb-topbar + data-edge（viewport / overlay / nested / sheet）；
 *    消费 --mb-chrome-content-h 的表面（.mobile-topbar 家族 / .mobile-model-head）还必须声明 data-size。
 * 2. var(--mobile-top-safe-area) 的直接引用只允许出现在「喂值通道 / 非 chrome 消费者」允许清单里；
 *    业务顶部表面一律走 topChrome.css 派生的 --mb-chrome-inset-top（防「每个局部组件各自消费
 *    全局安全区」这族 bug 复发：261027 / 261103 / 261110 / 261115 / 261117 / 桌面 261006 同型）。
 * 3. 契约映射本身被钉死：viewport / overlay ⇒ 消费安全区一次；nested / sheet ⇒ 0。
 *
 * iOS 复用口径见 topChrome.css 头注释（edge 语义平台无关，喂值后端可换）。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

/** 顶部表面类名 token → 是否必须声明 data-size（几何消费 --mb-chrome-content-h 的表面）。 */
const SURFACE_MARKERS: { token: string; needsSize: boolean }[] = [
  { token: "mobile-topbar", needsSize: true },
  { token: "mobile-settings-head", needsSize: false },
  { token: "mobile-page-head", needsSize: false },
  { token: "mobile-model-head", needsSize: true },
  { token: "mb-sel-topbar", needsSize: false },
  { token: "mb-usheet-topbar", needsSize: false },
  { token: "mbt-header", needsSize: false },
  { token: "mb-sheet__head", needsSize: false },
  { token: "attachment-preview__toolbar", needsSize: false },
  // 261119（task-5 + 跳变审计 F-G）：多维表只读行详情页顶栏（overlay，整页从屏幕顶展开）；
  // 菜单 Sheet 整屏子菜单（overlay，下钻层 top:0 直贴状态栏的潜伏项，登记后护栏钉住）。
  { token: "mbt-page-bar", needsSize: false },
  { token: "mb-menusheet__submenu", needsSize: false },
  // 261119 F-A（lead 集成补录）：文档内查找条 = 覆盖式浮条（nested —— 锚 .mobile-workspace-body 顶部，不消费安全区）。
  { token: "mb-find", needsSize: false },
];
const EDGE_VALUES = ["viewport", "overlay", "nested", "sheet"];
const SIZE_VALUES = ["compact", "regular"];

/** 允许直接引用 var(--mobile-top-safe-area) 的规则（喂值通道 + 非 chrome 消费者；只许减不许增）。 */
const SAFE_AREA_ALLOWLIST: { file: string; selectorIncludes: string; why: string }[] = [
  { file: "mobile/topChrome.css", selectorIncludes: 'data-edge="viewport"', why: "契约映射：viewport/overlay 派生 --mb-chrome-inset-top 的唯一入口" },
  { file: "mobile/pad/pad.css", selectorIncludes: 'data-form-factor="expanded"', why: "平板悬浮锚点定位（--pad-float-top，非顶栏 chrome）" },
  { file: "mobile/mobile.css", selectorIncludes: ".mobile-qn-screen", why: "全屏写作卡屏幕容器起点（非顶栏 chrome）" },
  { file: "mobile/floating.css", selectorIncludes: ".mb-toast-host", why: "Toast 浮层顶部锚点（非顶栏 chrome）" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 极简 JSX 标签切分：只收 depth-0 的 <Tag ... />（字符串与 {} 表达式里的 <> 不切）。 */
function extractTags(text: string): string[] {
  const tags: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c !== "<" || !/[A-Za-z]/.test(text[i + 1] ?? "")) { i++; continue; }
    const prev = text[i - 1] ?? "";
    if (prev && !/[\s({=,;&|!?:]/.test(prev)) { i++; continue; }
    let j = i + 1;
    let depth = 0;
    let quote = "";
    for (; j < n; j++) {
      const ch = text[j];
      if (quote) {
        if (ch === "\\") { j++; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
      else if (ch === ">" && depth === 0) break;
    }
    if (j < n) tags.push(text.slice(i, j + 1));
    i = j + 1;
  }
  return tags;
}

function hasClassToken(tag: string, token: string): boolean {
  const esc = token.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[\\s\"'{+])" + esc + "([\\s\"'}+]|$)").test(tag);
}

function attrValue(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp("\\b" + attr + "\\s*=\\s*(\"[^\"]*\"|\\{[^}]*\\})"));
  return m ? m[1] : null;
}

/** 属性值合法：字面量必须是枚举值；表达式若带字符串字面量则逐个校验（纯 prop 透传放行）。 */
function checkAttrValue(value: string | null, enumValues: string[]): string | null {
  if (value === null) return "缺失";
  const literals = value.startsWith('"') ? [value.slice(1, -1)] : Array.from(value.matchAll(/"([^"]*)"/g)).map((m) => m[1]);
  for (const lit of literals) {
    if (!enumValues.includes(lit)) return "非法值 " + lit;
  }
  return null;
}

describe("mobile top chrome contract", () => {
  it("所有顶部表面都声明 data-mb-topbar + data-edge（消费内容高的再声明 data-size）", () => {
    const tsxFiles = walk(SRC).filter((p) => /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p));
    const found = new Map<string, number>();
    const violations: string[] = [];
    for (const file of tsxFiles) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8");
      for (const tag of extractTags(text)) {
        for (const marker of SURFACE_MARKERS) {
          if (!hasClassToken(tag, marker.token)) continue;
          found.set(marker.token, (found.get(marker.token) ?? 0) + 1);
          const at = rel + " " + tag.slice(0, 90).replace(/\s+/g, " ");
          if (!/\bdata-mb-topbar\b/.test(tag)) violations.push(at + "：缺 data-mb-topbar");
          const edge = attrValue(tag, "data-edge");
          const edgeErr = edge === null ? "缺失" : checkAttrValue(edge, EDGE_VALUES);
          if (edgeErr) violations.push(at + "：data-edge " + edgeErr);
          if (marker.needsSize) {
            const size = attrValue(tag, "data-size");
            const sizeErr = size === null ? "缺失" : checkAttrValue(size, SIZE_VALUES);
            if (sizeErr) violations.push(at + "：data-size " + sizeErr);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
    for (const marker of SURFACE_MARKERS) {
      expect(
        found.get(marker.token) ?? 0,
        "顶部表面 " + marker.token + " 在 src/ 里找不到实例（选择器改名？同步更新本护栏与 topChrome 契约）",
      ).toBeGreaterThan(0);
    }
  });

  it("var(--mobile-top-safe-area) 只出现在允许清单（业务顶部表面一律走 --mb-chrome-inset-top）", () => {
    const cssFiles = walk(HERE).filter((p) => p.endsWith(".css"));
    const violations: string[] = [];
    for (const file of cssFiles) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      let idx = css.indexOf("var(--mobile-top-safe-area)");
      while (idx >= 0) {
        const before = css.slice(0, idx);
        const open = before.lastIndexOf("{");
        const close = before.lastIndexOf("}");
        let s = open - 1;
        while (s > close && !/[{};]/.test(css[s])) s--;
        const selector = css.slice(s + 1, open).trim().replace(/\s+/g, " ");
        const allowed = SAFE_AREA_ALLOWLIST.find((a) => a.file === rel && selector.includes(a.selectorIncludes));
        if (!allowed) {
          violations.push(rel + " 直接引用 --mobile-top-safe-area（规则头：" + selector.slice(0, 80) + "）");
        }
        idx = css.indexOf("var(--mobile-top-safe-area)", idx + 1);
      }
    }
    expect(
      violations,
      violations.join("\n") + "\n（新增直接引用点需评审后进 SAFE_AREA_ALLOWLIST；顶部 chrome 应消费 --mb-chrome-inset-top）",
    ).toEqual([]);
  });

  it("契约映射被钉死：viewport/overlay ⇒ 安全区一次；nested/sheet ⇒ 0", () => {
    const css = readFileSync(path.join(HERE, "topChrome.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\[data-mb-topbar\]\[data-edge="viewport"\][\s\S]{0,160}var\(--mobile-top-safe-area\)/);
    expect(css).toMatch(/\[data-mb-topbar\]\[data-edge="nested"\][\s\S]{0,160}--mb-chrome-inset-top:\s*0px/);
    expect(css).toContain("--mb-chrome-content-h");
  });
});
