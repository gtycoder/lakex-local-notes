// 去掉"第三方画板 CSS 两份来源"里的**内联那一份**：把 `src/vendor/drawnix-react-text.css` 里已有的规则，
// 从我们自己的样式文件里删掉（逐字节同构的规则才动：选择器 + 全部声明都一致）。
//
// 背景（260916）：`src/styles.css` 原先内联了一整块 6795 字符的第三方画板 CSS，与 `src/vendor/drawnix-react-text.css`
// 去掉空白后**逐字节相同**（6701 字符）。第二档 S3 拆分时按选择器把它机械分到了 `app/vendor-board.css` 与 `app/misc.css`。
// 两份来源的坏处：改动要改两处、且"同一个东西两个值"。做法：删内联、改由 `src/main.tsx` **直接 import vendor 文件**
// （仍是同一层：紧跟 `src/styles.css` 之后、b3 之前），保证首帧就有样式（不会因为 vendor 画板卡懒加载 DrawnixBoardCore 而 FOUC）。
//
// 用法：node scripts/css-audit/dedupe-vendor-board.mjs [--dry]
import fs from "node:fs";
import postcss from "postcss";
import { REPO } from "./paths.mjs";

const dry = process.argv.includes("--dry");
const VENDOR = "src/vendor/drawnix-react-text.css";
const TARGETS = ["src/styles/app/vendor-board.css", "src/styles/app/misc.css"];

const norm = (s) => String(s).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const keyOf = (rule) => norm(rule.selector) + "||" + rule.nodes.filter((n) => n.type === "decl").map((d) => norm(d.prop + ":" + d.value + (d.important ? "!important" : ""))).sort().join(";");

const vendorRoot = postcss.parse(fs.readFileSync(REPO + VENDOR, "utf8"), { from: VENDOR });
const vendorRules = new Set();
let vendorCount = 0;
vendorRoot.walkRules((r) => { if (inKf(r)) return; vendorRules.add(keyOf(r)); vendorCount++; });
console.log(`vendor/${VENDOR.split("/").pop()}：${vendorCount} 条规则作为"已有来源"`);

let removed = 0;
for (const rel of TARGETS) {
  const before = fs.readFileSync(REPO + rel, "utf8");
  const root = postcss.parse(before, { from: rel });
  let n = 0;
  root.walkRules((r) => {
    if (inKf(r)) return;
    if (!vendorRules.has(keyOf(r))) return;
    r.remove();
    n++;
  });
  // 删空掉的 @media/@supports
  root.walkAtRules((a) => { if (/^(media|supports)$/i.test(a.name) && !a.nodes.length) a.remove(); });
  const after = root.toString().replace(/\n{3,}/g, "\n\n");
  if (!dry) fs.writeFileSync(REPO + rel, after);
  removed += n;
  console.log(`  ${rel.padEnd(34)} 删掉 ${n} 条（同构于 vendor 规则）`);
}
console.log(`合计删掉 ${removed} 条${dry ? "（dry-run，未落盘）" : ""}`);
