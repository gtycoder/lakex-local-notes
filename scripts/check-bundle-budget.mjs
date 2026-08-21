#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const dist = path.resolve("dist/assets");
const files = fs.readdirSync(dist);
const pick = (pattern) => {
  const file = files.find((name) => pattern.test(name));
  if (!file) throw new Error(`未找到 bundle: ${pattern}`);
  return file;
};
const budgets = [
  { name: "app-js", file: pick(/^index-.*\.js$/), gzip: 2_900_000 },
  { name: "drawnix-js", file: pick(/^drawnix-.*\.js$/), gzip: 1_400_000 },
  { name: "app-css", file: pick(/^index-.*\.css$/), gzip: 2_000_000 },
];
let failed = false;
for (const budget of budgets) {
  const bytes = fs.readFileSync(path.join(dist, budget.file));
  const gzip = zlib.gzipSync(bytes, { level: 9 }).length;
  console.log(`${budget.name}: ${budget.file} raw=${bytes.length} gzip=${gzip} budget=${budget.gzip}`);
  if (gzip > budget.gzip) { failed = true; console.error(`Budget exceeded: ${budget.name}`); }
}
if (failed) process.exitCode = 1;
