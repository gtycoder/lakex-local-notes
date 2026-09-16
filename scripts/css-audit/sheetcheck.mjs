// 「磁盘 == 浏览器」守卫：dev 实例在改文件 / git restore / 切分支之后**不一定重读样式表**，
// 页面可能继续用旧 CSS —— 此时任何 A/B 都会给出假的"0 差异"。跑验证前先过这一关。
// 判据用「样式标签里的原始文本」直接和磁盘比对（不走 CSSOM：CSSOM 会把简写展开成长属性，
// 声明条数和 !important 个数都会被放大，历史上因此误判过）。
// 用法：node scripts/css-audit/drive.mjs 9222 scripts/css-audit/sheetcheck.mjs
import fs from "node:fs";
import path from "node:path";
import { REPO, data } from "./paths.mjs";

const loadFile = data("loadorder.json");
const fallback = data("loadorder.css.json");
const FILES = fs.existsSync(loadFile)
  ? JSON.parse(fs.readFileSync(loadFile, "utf8"))
  : JSON.parse(fs.readFileSync(fallback, "utf8"));

const stat = (text) => ({
  chars: text.length,
  important: (text.match(/!important/g) || []).length,
});

// `@import` 编排入口（例：260916 S3 之后的 src/styles.css）：磁盘上是若干行 @import，
// 浏览器里是**内联后的整份内容**，两边文本本来就不相等 —— 改判"每个被导入文件的内容都能在内联结果里按序找到"。
const inlineCheck = (rel, diskText, liveText) => {
  const imports = [...diskText.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
  if (!imports.length) return null;
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const live = norm(liveText);
  let cursor = 0;
  const problems = [];
  for (const imp of imports) {
    const file = path.resolve(path.dirname(REPO + rel), imp);
    if (!fs.existsSync(file)) { problems.push(`${imp} 不存在`); continue; }
    const body = norm(fs.readFileSync(file, "utf8"));
    const at = live.indexOf(body, cursor);
    if (at < 0) problems.push(`${imp} 的内容没能在内联结果里按序找到`);
    else cursor = at + body.length;
  }
  return { imports: imports.length, problems };
};

export default async ({ page }) => {
  const live = await page.evaluate(`(() => {
    const out = {};
    for (const ss of document.styleSheets) {
      const id = ss.ownerNode && ss.ownerNode.getAttribute ? ss.ownerNode.getAttribute("data-vite-dev-id") : null;
      if (!id) continue;
      const i = id.indexOf("/src/");
      if (i < 0) continue;
      const rel = "src/" + id.slice(i + 5);
      out[rel] = ss.ownerNode.textContent || "";
    }
    return out;
  })()`);

  const rows = [];
  let bad = 0;
  for (const rel of FILES) {
    if (!fs.existsSync(REPO + rel)) continue;
    if (rel.endsWith(".scss")) { rows.push(`– ${rel}（SCSS 源，浏览器里是编译产物，跳过）`); continue; }
    const d = stat(fs.readFileSync(REPO + rel, "utf8"));
    const l = live[rel];
    if (!l) { rows.push(`${rel}: 浏览器里没有这张表`); bad++; continue; }
    const ls = stat(l);
    const inlined = inlineCheck(rel, fs.readFileSync(REPO + rel, "utf8"), l);
    if (inlined) {
      const ok = inlined.problems.length === 0;
      if (!ok) bad++;
      rows.push(`${ok ? "✓" : "✗"} ${rel.padEnd(40)} @import ×${inlined.imports} 已按序内联${ok ? "" : " — " + inlined.problems.join("; ")}`);
      continue;
    }
    const ok = d.important === ls.important && d.chars === ls.chars;
    if (!ok) bad++;
    rows.push(`${ok ? "✓" : "✗"} ${rel.padEnd(40)} 字符 ${String(d.chars).padStart(6)}/${String(ls.chars).padStart(6)}   !important ${String(d.important).padStart(3)}/${String(ls.important).padStart(3)}`);
  }
  console.log(rows.join("\n"));
  console.log(bad ? `\n✗ ${bad} 张表"磁盘 ≠ 浏览器"——先让页面重读样式（reload），否则后面的比对全是假的` : "\n✓ 全部一致：磁盘 == 浏览器");
  return { files: rows.length, mismatch: bad };
};
