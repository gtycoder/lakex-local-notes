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

// 入口 chunk 必须从 dist/index.html 取：assets 里的 `index-*.js` 还有一个 ~11KB 的辅助 chunk，
// 按文件名取第一个会挑错（旧实现即如此，等于在给错的文件设预算、真入口没被守）。
const html = fs.readFileSync(path.resolve("dist/index.html"), "utf8");
const entry = (re, label) => {
  const m = html.match(re);
  if (!m) throw new Error(`dist/index.html 未引用入口 ${label}`);
  return path.basename(m[1]);
};

const budgets = [
  { name: "app-js", file: entry(/assets\/(index-[\w.-]+\.js)/, "app-js"), gzip: 2_900_000 },
  // 260923 起画板不再是手工 "drawnix" chunk（手拆会破坏 @plait vendor 绑定，见 vite.config.ts 注释），
  // 改由 BoardEditor/DrawnixBoardCore 动态 import 懒加载 ⇒ 目标分块名 = DrawnixBoardCore-<hash>.js。
  { name: "drawnix-js", file: pick(/^DrawnixBoardCore-.*\.js$/), gzip: 1_400_000 },
  { name: "app-css", file: entry(/assets\/(index-[\w.-]+\.css)/, "app-css"), gzip: 2_000_000 },
];

let failed = false;
for (const budget of budgets) {
  const bytes = fs.readFileSync(path.join(dist, budget.file));
  const gzip = zlib.gzipSync(bytes, { level: 9 }).length;
  console.log(`${budget.name}: ${budget.file} raw=${bytes.length} gzip=${gzip} budget=${budget.gzip}`);
  if (gzip > budget.gzip) { failed = true; console.error(`Budget exceeded: ${budget.name}`); }
}
if (failed) process.exitCode = 1;
