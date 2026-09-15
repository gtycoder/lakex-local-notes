/**
 * 壳层 CSS「多层覆盖」防回归围栏（260915）。
 *
 * 背景：这个项目的样式是分层加载的（基础骨架 → 思源主题/组件 → 壳层打磨层），
 * 同一个 (选择器, 属性) 经常被写 2~8 次，谁赢取决于加载顺序 + !important：
 * 改一处要同时改几个文件，跨宽度/跨主题还会"另一边没跟上"（用户报过多次）。
 * §2.40/§2.41 已把这类重复清过一轮，这条用例负责**不让它再长回来**：
 *   · 每个文件的声明总数、以及「同一 (选择器, 属性) 被写≥2 次」的组数，都不得**超过**记录值；
 *   · 减少（清理）随时允许 —— 那正是我们想要的方向。
 * 基线数字来自 260915 清理后的实测值；清理得更多时，顺手把基线调小即可。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

/** 我们自己的样式文件（不含 vendor：src/b3/siyuan/** 与 lakex 包内样式）。 */
const FILES = [
  "styles.css",
  "b3/animations.css", "b3/base.css", "b3/components.css", "b3/dark.css", "b3/layout.css",
  "b3/theme-daylight.css", "b3/theme-midnight.css",
  "features/attachment/attachment-preview.css", "features/editor/image-lightbox.css", "features/outline/outline.css",
  "styles/dialog.css", "styles/document-status.css", "styles/editor-bridge.css", "styles/layout-contract.css",
  "styles/motion-contract.css", "styles/overlays.css", "styles/quick-notes.css", "styles/shell.css",
  "styles/tokens.css", "styles/ui-polish.css",
];

/** 基线（260916 第三/四轮清理后按本文件的 scan() 实测）。只允许变小。 */
const BASELINE: Record<string, { decls: number; dupGroups: number }> = {
  "styles.css": { decls: 1778, dupGroups: 33 },
  "b3/animations.css": { decls: 5, dupGroups: 0 },
  "b3/base.css": { decls: 16, dupGroups: 1 },
  "b3/components.css": { decls: 151, dupGroups: 0 },
  "b3/dark.css": { decls: 56, dupGroups: 0 },
  "b3/layout.css": { decls: 197, dupGroups: 1 },
  "b3/theme-daylight.css": { decls: 163, dupGroups: 0 },
  "b3/theme-midnight.css": { decls: 148, dupGroups: 0 },
  "features/attachment/attachment-preview.css": { decls: 78, dupGroups: 0 },
  "features/editor/image-lightbox.css": { decls: 57, dupGroups: 0 },
  "features/outline/outline.css": { decls: 257, dupGroups: 0 },
  "styles/dialog.css": { decls: 227, dupGroups: 8 },
  "styles/document-status.css": { decls: 107, dupGroups: 2 },
  "styles/editor-bridge.css": { decls: 12, dupGroups: 0 },
  "styles/layout-contract.css": { decls: 5, dupGroups: 0 },
  "styles/motion-contract.css": { decls: 3, dupGroups: 0 },
  "styles/overlays.css": { decls: 444, dupGroups: 1 },
  "styles/quick-notes.css": { decls: 9, dupGroups: 0 },
  "styles/shell.css": { decls: 43, dupGroups: 0 },
  "styles/tokens.css": { decls: 83, dupGroups: 0 },
  "styles/ui-polish.css": { decls: 166, dupGroups: 5 },
};

/** 极简 CSS 扫描器：只取「叶子样式规则」的声明，跳过注释/字符串/声明型 at-rule。 */
function scan(css: string): { decls: number; dupGroups: number; emptyRules: number; emptyAtRules: number } {
  const props = new Map<string, number>();   // `${selector}||${prop}` → 出现次数
  let decls = 0;
  let emptyRules = 0;
  let emptyAtRules = 0;
  let i = 0;
  const n = css.length;
  const skipWs = (j: number) => { while (j < n && /\s/.test(css[j])) j++; return j; };
  const findBlockEnd = (braceIdx: number) => {
    let depth = 0;
    let j = braceIdx;
    for (; j < n; j++) {
      const c = css[j];
      if (c === "/" && css[j + 1] === "*") { j = css.indexOf("*/", j + 2); if (j < 0) return n; j++; continue; }
      if (c === '"' || c === "'") { const q = c; j++; while (j < n && css[j] !== q) { if (css[j] === "\\") j++; j++; } continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return j; }
    }
    return n;
  };
  const walk = (from: number, to: number) => {
    let j = skipWs(from);
    while (j < to && j < n) {
      if (css[j] === "/" && css[j + 1] === "*") { j = skipWs(css.indexOf("*/", j + 2) + 2); continue; }
      const brace = css.indexOf("{", j);
      if (brace < 0 || brace > to) break;
      const head = css.slice(j, brace).trim();
      const end = findBlockEnd(brace);
      if (head.startsWith("@")) {
        if (!/^@(keyframes|-webkit-keyframes|font-face|page|property|charset|import|namespace|layer)\b/i.test(head)) {
          // 空的 @media/@supports 块同样是"清完声明没删壳"的残骸（留了占位注释的除外）。
          const body = css.slice(brace + 1, end);
          if (/^@(media|supports|starting-style|container|layer)\b/i.test(head) && !body.includes("{") && !body.includes(":") && !body.includes("/*")) emptyAtRules++;
          walk(brace + 1, end);
        }
      } else {
        const body = css.slice(brace + 1, end);
        let declarationsInRule = 0;
        for (const raw of body.split(";")) {
          const line = raw.trim();
          const k = line.indexOf(":");
          if (k <= 0 || line.startsWith("@") || line.includes("{")) continue;
          const prop = line.slice(0, k).trim();
          if (!prop || prop.startsWith("//")) continue;
          decls++;
          declarationsInRule++;
          const key = `${head.replace(/\s+/g, " ")}||${prop}`;
          props.set(key, (props.get(key) || 0) + 1);
        }
        // 空壳规则（`选择器 { }`）：清完重复声明后留下的残骸，白占解析与维护成本。
        if (!declarationsInRule && !body.includes("{")) emptyRules++;
      }
      j = skipWs(end + 1);
    }
  };
  walk(0, n);
  let dupGroups = 0;
  for (const count of props.values()) if (count > 1) dupGroups++;
  return { decls, dupGroups, emptyRules, emptyAtRules };
}

describe("CSS 多层覆盖围栏", () => {
  it("每个样式文件的声明数与重复(选择器,属性)组数都不超过基线", () => {
    const grew: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8");
      const got = scan(css);
      const base = BASELINE[rel] ?? { decls: 0, dupGroups: 0 };
      if (got.decls > base.decls) grew.push(`${rel}: 声明数 ${base.decls} → ${got.decls}`);
      if (got.dupGroups > base.dupGroups) grew.push(`${rel}: 重复组 ${base.dupGroups} → ${got.dupGroups}`);
    }
    expect(grew, `以下文件新增了"多层覆盖"，请收敛到一处来源（见 HANDOFF §2.40/§2.41）：\n  ${grew.join("\n  ")}`).toEqual([]);
  });

  it("没有留下「空壳规则」（选择器 { }）——清完重复声明必须连壳一起删", () => {
    const shells: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8");
      const { emptyRules, emptyAtRules } = scan(css);
      if (emptyRules) shells.push(`${rel}: 空规则 ${emptyRules} 条`);
      if (emptyAtRules) shells.push(`${rel}: 空 @media/@supports 块 ${emptyAtRules} 个`);
    }
    expect(shells, `以下文件留下空壳规则（260915 清理时留过一次，260916 已清除）：\n  ${shells.join("\n  ")}`).toEqual([]);
  });
});
