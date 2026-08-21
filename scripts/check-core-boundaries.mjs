#!/usr/bin/env node
/**
 * lake-core 边界检查（V5 Phase 1 §6）
 * 扫描 src/core/** 禁止泄漏平台依赖：electron / node: / DOM / react / better-sqlite3 / sharp / safeStorage。
 * 用法：node scripts/check-core-boundaries.mjs [--verbose]
 * 退出码：0 = 通过；1 = 发现违规。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CORE_DIR = join(ROOT, "src", "core");
const verbose = process.argv.includes("--verbose");

const FORBIDDEN_IMPORT_PREFIXES = [
  "electron",      // 主进程模块
  "node:",         // Node 内置
  "react",         // React（含 react-dom）
  "better-sqlite3",
  "sharp",
  "safeStorage",
];
const FORBIDDEN_IMPORT_SUBSTRINGS = ["/electron/", "electron/"];

// 源码中出现的平台 API（DOM / Node 全局）也视为泄漏
const FORBIDDEN_GLOBALS = [
  "document.", "window.", "localStorage", "sessionStorage", "navigator.",
  "HTMLElement", "XMLHttpRequest", "requestAnimationFrame", "cancelAnimationFrame",
  "process.", "Buffer", "__dirname", "require(",
  "globalThis.fetch", "Deno.",
];

function collectTs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "vendor") continue;
      collectTs(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".mts") || entry.endsWith(".cts")) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, "utf8");
  const issues = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, idx) => {
    const n = idx + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    // import / export ... from / import(...) 语句
    const importMatch = /\b(?:import|export)\b[^;]*\bfrom\s*["']([^"']+)["']/.exec(line)
      || /\bimport\s*\(\s*["']([^"']+)["']/.exec(line);
    if (importMatch) {
      const spec = importMatch[1];
      if (FORBIDDEN_IMPORT_PREFIXES.some((p) => spec === p || spec.startsWith(p + "/"))) {
        issues.push(`L${n} 禁止导入平台模块：${spec}`);
      }
      if (FORBIDDEN_IMPORT_SUBSTRINGS.some((s) => spec.includes(s))) {
        issues.push(`L${n} 禁止导入 electron 侧路径：${spec}`);
      }
      // 依赖面收紧：core 只能导入 core 内部模块 + 共享类型（../lib/types.js）+ 测试框架 vitest
      if (!spec.startsWith("./") && !spec.startsWith("../core/") && spec !== "../lib/types.js" && spec !== "./types.js" && spec !== "vitest") {
        issues.push(`L${n} 禁止导入 core 之外模块（仅允许 ./ 内部 / ../lib/types.js）：${spec}`);
      }
    }

    // 平台全局 API
    for (const g of FORBIDDEN_GLOBALS) {
      if (line.includes(g)) {
        issues.push(`L${n} 出现平台全局：${g}`);
        break;
      }
    }
  });

  return { rel, issues };
}

const files = collectTs(CORE_DIR);
let total = 0;
let failures = 0;
for (const file of files) {
  const { rel, issues } = scanFile(file);
  total += 1;
  if (issues.length > 0) {
    failures += issues.length;
    console.log(`✗ ${rel}`);
    for (const issue of issues) console.log(`    ${issue}`);
  } else if (verbose) {
    console.log(`✓ ${rel}`);
  }
}

console.log(`\ncore 文件数：${total}，违规：${failures}`);
if (failures > 0) {
  console.error("lake-core 边界检查失败：src/core 不允许出现 electron/node/DOM/react/better-sqlite3/sharp/safeStorage。");
  process.exit(1);
}
console.log("lake-core 边界检查通过 ✓");
