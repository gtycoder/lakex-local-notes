import postcss from "postcss";
import fs from "node:fs";
import { REPO, data } from "./paths.mjs";
const MOBILE = new Set(["src/features/editor/image-lightbox.css","src/features/attachment/attachment-preview.css","src/b3/theme-daylight.css","src/b3/theme-midnight.css","src/styles/tokens.css","src/b3/dark.css","src/b3/siyuan.scss","src/styles/overlays.css","src/mobile/editor/editor-dock.css","src/mobile/mobile-theme.css","src/styles/dialog.css"]);
const safe = JSON.parse(fs.readFileSync(data("imp-safe.json"), "utf8")).filter((d) => !MOBILE.has(d.file));
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
const out = [];
for (const rel of [...new Set(safe.map((d) => d.file))]) {
  const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
  const bySel = new Map();
  root.walkRules((r) => {
    if (inKf(r)) return;
    const sel = norm(r.selector); const n = bySel.get(sel) || 0; bySel.set(sel, n + 1);
    r.walkDecls((d) => {
      const hit = safe.find((x) => x.file === rel && x.line === d.source.start.line && x.prop === d.prop);
      if (hit) out.push({ file: rel, selector: sel, occ: n, prop: d.prop, value: norm(d.value), important: true, dropImportant: true, line: d.source.start.line });
    });
  });
}
fs.writeFileSync(data("plan-imp.json"), JSON.stringify(out, null, 1));
console.log("计划条数：", out.length, "文件数：", new Set(out.map((o) => o.file)).size, "（已排除移动端共享文件）");
const byFile = {}; for (const o of out) byFile[o.file] = (byFile[o.file] || 0) + 1;
console.log(byFile);
