#!/usr/bin/env node
/**
 * 桌面 ↔ 移动「同名令牌取值差异」报告（261017 C5-4）。
 *
 * 用途：两端**共享令牌词表**（--lake-*），但取值由各自 theme/** 定义。
 * 本脚本把「同名但取值不同」的令牌列成表，让「有意不同」与「漂移」可区分；
 * 判定数据来自源码解析（不跑浏览器）。用法：node scripts/token-parity.mjs [--md]
 *
 * 口径：
 * - 桌面 = src/styles/themes/{base,light,dark,warm}.css
 * - 移动 = src/mobile/theme/{tokens,light,dark}.css（无暖色）
 * - 同名对比：浅色 ↔ 浅色、深色 ↔ 深色；只列「同名但至少一档不同」的令牌。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const parse = (rel) => {
  const map = new Map();
  const txt = strip(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const re = /(--lake-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(txt))) map.set(m[1], m[2].trim().replace(/\s+/g, " "));
  return map;
};
const merge = (...maps) => {
  const out = new Map();
  for (const m of maps) for (const [k, v] of m) out.set(k, v);
  return out;
};

const dBase = parse("src/styles/themes/base.css");
const dLight = merge(dBase, parse("src/styles/themes/light.css"));
const dDark = merge(dBase, parse("src/styles/themes/dark.css"));
const mBase = parse("src/mobile/theme/tokens.css");
const mLight = merge(mBase, parse("src/mobile/theme/light.css"));
const mDark = merge(mBase, parse("src/mobile/theme/dark.css"));

/** 已知「有意不同」的说明（新增差异时补这里，否则报告里就是"待确认"）。 */
const INTENT = {
  "--lake-bg-window": "移动浅色窗底 = 白（261013 用户定稿，对齐语雀 App；桌面仍是 #f3f4f6）",
  "--lake-font-size-body": "移动触屏正文档（P2 密度适配）",
  "--lake-font-size-micro": "移动触屏字号档（P2）",
  "--lake-font-size-nano": "移动触屏字号档（P2）",
  "--lake-font-size-small": "移动触屏字号档（P2）",
  "--lake-font-size-tiny": "移动触屏字号档（P2）",
  "--lake-line-height-normal": "移动端行高按触屏收敛（P2）",
  "--lake-line-height-reading": "移动端行高按触屏收敛（P2）",
  "--lake-line-height-snug": "移动端行高按触屏收敛（P2）",
  "--lake-motion-panel": "移动端动效更短（P2）",
};

const names = [...new Set([...dLight.keys(), ...dDark.keys(), ...mLight.keys(), ...mDark.keys()])].sort();
const same = [], diff = [], dOnly = [], mOnly = [];
for (const n of names) {
  const dl = dLight.get(n), dd = dDark.get(n), ml = mLight.get(n), md = mDark.get(n);
  const inD = dl !== undefined || dd !== undefined;
  const inM = ml !== undefined || md !== undefined;
  if (inD && !inM) dOnly.push(n);
  else if (!inD && inM) mOnly.push(n);
  else if (dl === ml && dd === md) same.push(n);
  else diff.push({ n, dl, dd, ml, md, note: INTENT[n] ?? "**待确认（新增差异）**" });
}

const md = process.argv.includes("--md");
const summary = {
  desktopTokens: dLight.size,
  mobileTokens: mLight.size,
  identical: same.length,
  differing: diff.length,
  desktopOnly: dOnly.length,
  mobileOnly: mOnly.length,
  unacknowledged: diff.filter((d) => d.note.startsWith("**")).length,
};

if (!md) {
  console.log(JSON.stringify(summary, null, 1));
  console.log("\n同名但取值不同的令牌：");
  for (const d of diff) console.log(`  ${d.n}\n    桌面 浅=${d.dl ?? "-"} 深=${d.dd ?? "-"}\n    移动 浅=${d.ml ?? "-"} 深=${d.md ?? "-"}\n    说明：${d.note}`);
  console.log("\n桌面独有：" + (dOnly.join(", ") || "（无）"));
  console.log("移动独有：" + (mOnly.join(", ") || "（无）"));
} else {
  console.log(`> 自动生成：\`node scripts/token-parity.mjs --md\`（261017 C5-4）。同名令牌 **${same.length} 个完全一致**，**${diff.length} 个取值不同**（其中待确认 ${summary.unacknowledged}），桌面独有 ${dOnly.length} 个、移动独有 ${mOnly.length} 个。\n`);
  console.log("| 令牌 | 桌面（浅 / 深） | 移动（浅 / 深） | 说明 |");
  console.log("| --- | --- | --- | --- |");
  for (const d of diff) console.log(`| \`${d.n}\` | \`${d.dl ?? "-"}\` / \`${d.dd ?? "-"}\` | \`${d.ml ?? "-"}\` / \`${d.md ?? "-"}\` | ${d.note} |`);
  console.log("\n**桌面独有**（移动端未定义、也不需要）：" + (dOnly.map((n) => "\`" + n + "\`").join(" · ") || "（无）"));
  console.log("\n**移动独有**：" + (mOnly.map((n) => "\`" + n + "\`").join(" · ") || "（无）"));
}
