#!/usr/bin/env node
/**
 * CSS 指标统计（V5 Phase 1 §6 顺手项）：!important 与 @layer 计数（可重复统计）。
 * 用法：node scripts/check-css-metrics.mjs [--fail-important=N] [--fail-layer=N]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const failImportant = parseFlag(args, "--fail-important");
const failLayer = parseFlag(args, "--fail-layer");

function parseFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return Number(args[i + 1]);
}

function collectCss(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "vendor" || entry === "dist") continue;
      collectCss(full, out);
    } else if (entry.endsWith(".css") || entry.endsWith(".scss")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectCss(ROOT);
let totalImportant = 0;
let totalLayer = 0;
for (const file of files) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, "utf8");
  const important = (source.match(/!important/g) || []).length;
  const layers = (source.match(/@layer/g) || []).length;
  totalImportant += important;
  totalLayer += layers;
  if (important > 0 || layers > 0) {
    console.log(`${rel}: !important=${important} @layer=${layers}`);
  }
}
console.log(`\n合计：!important=${totalImportant} @layer=${totalLayer}（文件数 ${files.length}）`);

let failed = false;
if (failImportant !== null && totalImportant > failImportant) {
  console.error(`!important 超限：${totalImportant} > ${failImportant}`);
  failed = true;
}
if (failLayer !== null && totalLayer > failLayer) {
  console.error(`@layer 超限：${totalLayer} > ${failLayer}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
