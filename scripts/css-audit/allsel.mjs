import postcss from "postcss";
import fs from "node:fs";
import { REPO, data } from "./paths.mjs";
const FILES = JSON.parse(fs.readFileSync(data("loadorder.css.json"), "utf8")).filter((f) => f.endsWith(".css"));
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const sels = new Set();
for (const rel of FILES) {
  const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
  root.walkRules((r) => { if (inKf(r)) return; for (const s of r.selector.split(",").map((x) => x.replace(/\s+/g, " ").trim())) if (s) sels.add(s); });
}
fs.writeFileSync(data("allselectors.json"), JSON.stringify([...sels]));
console.log("全部子选择器：", sels.size);
