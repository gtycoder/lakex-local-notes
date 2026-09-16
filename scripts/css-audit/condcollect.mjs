import postcss from "postcss";
import fs from "node:fs";
import { REPO, data } from "./paths.mjs";
const FILES = JSON.parse(fs.readFileSync(data("loadorder.css.json"), "utf8")).filter((f) => f.endsWith(".css"));
const inKf = (r) => { for (let p = r.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true; return false; };
const conds = new Set();
for (const rel of FILES) {
  const root = postcss.parse(fs.readFileSync(REPO + rel, "utf8"), { from: rel });
  root.walkRules((r) => { if (inKf(r)) return; for (let p = r.parent; p && p.type === "atrule"; p = p.parent) if (p.name === "media") conds.add(p.params.replace(/\s+/g, " ").trim()); });
}
fs.writeFileSync(data("conditions.json"), JSON.stringify([...conds], null, 1));
console.log("媒体条件：", conds.size, [...conds]);
