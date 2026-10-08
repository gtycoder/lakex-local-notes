/**
 * 字体统一护栏（261008，用户要求「彻底检查一遍：除固定特殊字体外全部 MiSans」）。
 *
 * 做法：把**真正被加载**的两个第三方样式里出现的每一种 font-family 值都登记成「已分类」，三者必居其一：
 *  · special —— 功能性字形，**故意不动**（KaTeX 数学、emoji、湖图标 iconfont、inherit）；
 *  · mono    —— 等宽语义，统一到 --lake-font-family-mono（JetBrains Mono）；
 *  · unified —— UI 文本，统一到 --lake-font-family（MiSans）；marker = 我们在 font-overrides.css 或
 *               features/sheet/sheetEditor.css 里用来接管的**选择器片段**。两处覆盖策略不同：
 *               lakex/antd/drawnix 走 layer(feature) > legacy；FortuneSheet 的 CSS 未分层，
 *               只能在未分层的 sheetEditor.css 里用 .sheet-editor 提高特异性。
 *
 * ⇒ 内核升级换字体栈、或有人删掉某条覆盖，这里都会红。
 * ⚠️ 新增例外必须先判定「是不是功能性字形」，再往表里加 —— 不要为了让测试过而改分类。
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const THIRD_PARTY = [
  "../../../node_modules/@dlient/lakex-doc-react/dist/style.css",
  "../../../node_modules/@fortune-sheet/react/dist/index.css",
];
const OUR_OVERRIDES = ["../fonts/font-overrides.css", "../../features/sheet/sheetEditor.css"];

/** 归一化：去引号 + 逗号后不留空格 + 折叠空白 + 小写（两个第三方的引号/换行写法不同）。 */
const norm = (value: string) =>
  value.replace(/["']/g, "").replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim().toLowerCase();

type Kind = "special" | "mono" | "unified";
type Entry = [value: string, kind: Kind, marker: string];

const CLASSIFIED: Entry[] = [
  // —— 功能性字形：故意不覆盖 ——
  ["inherit", "special", "继承父层即可，无需覆盖"],
  ["lake-icon!important", "special", "湖图标 iconfont"],
  ["apple color emoji,segoe ui emoji,notocoloremoji,noto color emoji,segoe ui symbol,android emoji,emojisymbols", "special", "emoji"],
  ["katex_ams", "special", "数学字形"],
  ["katex_caligraphic", "special", "数学字形"],
  ["katex_fraktur", "special", "数学字形"],
  ["katex_main", "special", "数学字形"],
  ["katex_math", "special", "数学字形"],
  ["katex_sansserif", "special", "数学字形"],
  ["katex_script", "special", "数学字形"],
  ["katex_size1", "special", "数学字形"],
  ["katex_size2", "special", "数学字形"],
  ["katex_size3", "special", "数学字形"],
  ["katex_size4", "special", "数学字形"],
  ["katex_typewriter", "special", "数学字形"],
  ["1.21em/1 katex_main,times new roman,serif", "special", "数学字形"],
  // —— 等宽语义 → JetBrains Mono ——
  ["monospace", "mono", ".cm-content"],
  ["cascadia", "mono", ".drawnix .ttd-dialog-output-error p"],
  ["lucida console,consolas,monaco,andale mono,ubuntu mono,monospace", "mono", "textarea.ne-math-input"],
  ["sfmono-regular,consolas,liberation mono,menlo,courier,monospace", "mono", ".CodeMirror"],
  ["sfmono-regular,consolas,liberation mono,menlo,courier,monospace,pingfang sc,hiragino sans gb,microsoft yahei,helvetica neue,helvetica,arial,sans-serif,segoe ui", "mono", "ne-code-content"],
  ["sfmono-regular,consolas,liberation mono,menlo,monospace", "mono", ".mindmap-node-content .mindmap-inline-code"],
  ["ui-monospace,sfmono-regular,sf mono,menlo,monospace", "mono", ".mindmap-text-editor"],
  ["13px/1.55 ui-monospace,sfmono-regular,menlo,monospace", "mono", ".mindmap-import-textarea"],
  // —— UI 文本 → MiSans ——
  ["sans-serif", "unified", "html, body"],
  ["normal normal 400 13px arial,sans,sans-serif", "unified", ".sheet-editor .luckysheet-input-box"],
  ["arial", "unified", ".sheet-editor .fortune-toolbar-subtext"],
  ["arial,helvetica,sans-serif", "unified", ".ant-pagination-jump-prev .ant-pagination-item-container .ant-pagination-item-ellipsis"],
  ["simsun,sans-serif", "unified", ".ant-form-item-required"],
  ["helvetica neue,consolas", "unified", ".ne-toc-sidebar-hover .ne-toc-view .ne-toc-item span.prefix"],
  ["helvetica neue,helvetica,arial,pingfang sc,hiragino sans gb,heiti sc,microsoft yahei,wenquanyi micro hei,sans-serif", "unified", ".sheet-editor .fortune-container"],
  ["chinese quote,segoe ui,pingfang sc,hiragino sans gb,microsoft yahei,helvetica neue,helvetica,arial,sans-serif", "unified", ".ne-engine"],
  ["pingfang sc,hiragino sans gb,microsoft yahei,helvetica neue,helvetica,arial,sans-serif,segoe ui", "unified", ".ne-paragraph-spacing-relax.ne-typography-classic"],
  ["-apple-system,blinkmacsystemfont,segoe ui,roboto,helvetica neue,arial,noto sans,sans-serif,apple color emoji,segoe ui emoji,segoe ui symbol,noto color emoji", "unified", ".ant-statistic-content"],
  ["-apple-system,blinkmacsystemfont,segoe ui,roboto,helvetica neue,arial,sans-serif", "unified", ".text-to-diagram"],
  ["-apple-system,blinkmacsystemfont,segoe ui,roboto,pingfang sc,noto sans,noto sans cjk sc,microsoft yahei,hiragino sans gb,arial,sans-serif", "unified", ".drawnix-tutorial"],
  ["-apple-system,blinkmacsystemfont,segoe ui,pingfang sc,microsoft yahei,sans-serif", "unified", ".ne-image-toolbar"],
  ["-apple-system,blinkmacsystemfont,segoe ui,sans-serif", "unified", ".ne-block-context-menu"],
  ["var(--ui-font)", "unified", ".drawnix .tool-icon__label"],
  ["system-ui,-apple-system,sans-serif", "unified", ".mindmap-context-menu"],
  ["system-ui,sans-serif", "unified", ".mindmap-ctrl-pct"],
  ["13px/1 system-ui,-apple-system,sans-serif", "unified", ".mindmap-dialog-primary"],
  ["13px/1.4 system-ui,-apple-system,sans-serif", "unified", ".mindmap-search-input"],
  ["12px/1.2 system-ui,-apple-system,sans-serif", "unified", ".mindmap-tag-filter"],
];

describe("字体统一护栏（261008）", () => {
  const values = new Set<string>();
  for (const rel of THIRD_PARTY) {
    const css = readFileSync(new URL(rel, import.meta.url), "utf8");
    const ruleRe = /([^{}]+)\{([^{}]*?)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const family = m[2].match(/font-family\s*:\s*([^;}]+)/i);
      if (family) { values.add(norm(family[1])); continue; }
      const shorthand = m[2].match(/(?:^|;)\s*font\s*:\s*([^;}]+)/i);
      if (shorthand) values.add(norm(shorthand[1]));
    }
  }
  const overrides = OUR_OVERRIDES.map((rel) => readFileSync(new URL(rel, import.meta.url), "utf8")).join("\n");

  it("第三方样式里出现的每种字体栈都已分类（新增未登记的栈必须判定后再入表）", () => {
    const known = new Set(CLASSIFIED.map(([value]) => value));
    const unknown = [...values].filter((value) => !known.has(value)).sort();
    expect(unknown, "未分类的第三方字体栈").toEqual([]);
  });

  it("我们自己的 CSS 里不得出现字体字面量（一律 var(--lake-font-*) / inherit）", () => {
    const root = new URL("../../../src/", import.meta.url);
    const offenders: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) {
          walk(child);
          continue;
        }
        if (!entry.name.endsWith(".css")) continue;
        const rel = child.pathname.split("/src/").pop() ?? entry.name;
        // 令牌定义处（themes/）、字体资产（fonts/）、移植进来的第三方样式（vendor/）不在此列
        if (/^(themes|styles\/themes|styles\/fonts|vendor|styles\/vendor)\//.test(rel) || rel.startsWith("styles/themes/") || rel.startsWith("styles/fonts/") || rel.startsWith("vendor/")) continue;
        const css = readFileSync(child, "utf8");
        const ruleRe = /([^{}]+)\{([^{}]*?)\}/g;
        let m: RegExpExecArray | null;
        while ((m = ruleRe.exec(css)) !== null) {
          const family = m[2].match(/font-family\s*:\s*([^;}]+)/i);
          const shorthand = m[2].match(/(?:^|;)\s*font\s*:\s*([^;}]+)/i);
          const value = (family?.[1] ?? shorthand?.[1] ?? "").trim();
          if (!value) continue;
          if (/var\(--lake-font|^(inherit|unset|initial|revert)$/i.test(value)) continue;
          offenders.push(rel + " → " + m[1].trim().replace(/\s+/g, " ").slice(0, 60) + " : " + value.slice(0, 60));
        }
      }
    };
    walk(root);
    expect(offenders, "自带 CSS 里的字体字面量").toEqual([]);
  });

  it("标为 unified/mono 的栈，我们确实有接管规则（marker 在选择器里）", () => {
    const missing = CLASSIFIED.filter(([, kind, marker]) => kind !== "special" && !overrides.includes(marker)).map(
      ([value, , marker]) => value + " → 缺 " + marker,
    );
    expect(missing).toEqual([]);
  });
});
