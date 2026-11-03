#!/usr/bin/env node
/**
 * 全局架构门禁（P8 · 261103）
 *
 * 三件事（对应架构评审 C 的 C1/W5 结论）：
 *   ① 首屏资源图字节预算：从 dist 与 dist-mobile 各自的 index.html 解析「全部 <script src>（含经典脚本）
 *      + 全部 modulepreload + 入口 CSS」，逐文件 gzip(level 9) 求和。**为什么不沿用 check-bundle-budget
 *      的口径**：那边只量入口 chunk 的字节 + preload 的**条数**，实测移动端入口 78KB 而首屏真实 ≈392KB
 *      （20 条 preload 另有 176KB），预算量错对象 ⇒ 这里量「首屏真正要下载/解析的资源图」。
 *      ⚠️ 桌面 index.html 还有一条**非 module、parser-blocking** 的经典脚本
 *      vendor/cdn/.../lake-codemirror/7.1.3/CodeMirror.js（407KB gzip），评审时的 2.37MB 没算它；
 *      真实桌面首屏 = 2,785,293B，故桌面预算取 3.0MB（把它改 defer/按需后可回收 407KB 并收紧到 2.5MB）。
 *   ② import 方向规则（只扫非测试源码；相对路径按文件真实位置解析）：
 *      · src/core/**  只能 import src/core 内部（core 纯度，与 check-core-boundaries 同义、这里再兜一层）
 *      · src/mobile/** 不得 import electron/** 或 src/desktop/**（移动端不碰主进程/桌面壳）
 *      · src/features/** 不得 import src/desktop/**（features 是共享层，不许反向依赖桌面壳）
 *      已有违规按 KNOWN_IMPORT_VIOLATIONS 冻结（每文件只许降），新增直接失败。
 *   ③ 契约常量导出：FIRST_PAINT_BUDGETS / IMPORT_DIRECTION_RULES / KNOWN_IMPORT_VIOLATIONS /
 *      ARCH_CONTRACT —— 供 check:bundle、CI 与后续护栏测试 import，不另抄一份数字。
 *
 * 用法：
 *   node scripts/check-arch.mjs              # 正常门禁（dist 缺失则跳过对应目标并提示）
 *   node scripts/check-arch.mjs --json       # 机器可读输出
 *   node scripts/check-arch.mjs --verbose    # 打印首屏资源明细
 *   node scripts/check-arch.mjs --require-build  # dist 缺失也算失败（CI 用）
 *
 * 退出码：0 通过 / 1 超预算或出现新增 import 违规。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 首屏资源图 gzip 字节预算（十进制 KB；实测 261103：mobile 391,983 / desktop 2,785,293）。 */
export const FIRST_PAINT_BUDGETS = Object.freeze({
  mobile: 420_000, // ≈420KB；实测 391,983（≈93%）
  desktop: 3_000_000, // ≈3.0MB；实测 2,785,293（≈93%，含经典 CodeMirror 脚本 407KB；见文件头）
});

/** import 方向规则（from → 禁止 import 的路径前缀）。 */
export const IMPORT_DIRECTION_RULES = Object.freeze([
  {
    id: "core-purity",
    from: "src/core/",
    description: "src/core 只能 import src/core 内部（纯域，不得依赖平台/框架）",
    forbidRelativeOutside: "src/core/",
    forbidBare: true,
  },
  {
    id: "mobile-no-electron",
    from: "src/mobile/",
    description: "移动端不得 import electron/**（主进程代码）",
    forbidPrefixes: ["electron/"],
  },
  {
    id: "mobile-no-desktop",
    from: "src/mobile/",
    description: "移动端不得 import src/desktop/**（桌面壳）",
    forbidPrefixes: ["src/desktop/"],
  },
  {
    id: "features-no-desktop",
    from: "src/features/",
    description: "features 不得 import src/desktop/**（共享层不许反向依赖桌面壳）",
    forbidPrefixes: ["src/desktop/"],
  },
]);

/**
 * 已有违规冻结（只许降；清零时把对应行删掉，stale 断言会提醒）。
 * 现状（261103）：features/outline/OutlineSidebar 取桌面壳的布局常量 —— 应把常量下沉到
 * src/desktop/shellTypes 或 core 布局模块后清掉；在清掉之前不允许新增第二条。
 */
export const KNOWN_IMPORT_VIOLATIONS = Object.freeze({
  "src/features/outline/OutlineSidebar.tsx": 1,
});

/** 聚合契约（供其它脚本/测试直接 import，避免数字抄两份）。 */
export const ARCH_CONTRACT = Object.freeze({
  firstPaintBudgets: FIRST_PAINT_BUDGETS,
  importDirectionRules: IMPORT_DIRECTION_RULES,
  knownImportViolations: KNOWN_IMPORT_VIOLATIONS,
});

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-mobile", "dist-electron", "vendor", ".git", ".css-audit", "release"]);
const STATIC_IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const gz = (bytes) => zlib.gzipSync(bytes, { level: 9 }).length;

/** 收集 { ... } 下的非测试 .ts/.tsx 源码。 */
function walkSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkSources(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 从 html 里取资源引用：入口脚本 / modulepreload / 样式表。 */
function resourcesFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const distDir = path.dirname(htmlPath);
  const pick = (href) => {
    const clean = href.replace(/^(\.\/|\/)/, "");
    return path.join(distDir, clean);
  };
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => /\bsrc=/.test(attrs))
    .map((attrs) => pick(attrs.match(/\bsrc="([^"]+)"/)[1]));
  const links = [...html.matchAll(/<link\b([^>]*)>/g)].map((m) => m[1]);
  const preloads = links
    .filter((attrs) => /\brel="modulepreload"/.test(attrs) && /\bhref=/.test(attrs))
    .map((attrs) => pick(attrs.match(/\bhref="([^"]+)"/)[1]));
  const stylesheets = links
    .filter((attrs) => /\brel="stylesheet"/.test(attrs) && /\bhref=/.test(attrs))
    .map((attrs) => pick(attrs.match(/\bhref="([^"]+)"/)[1]));
  return { scripts, preloads, stylesheets };
}

/** 首屏资源图：去重后逐文件求 gzip 字节。 */
export function collectFirstPaint(htmlPath) {
  const { scripts, preloads, stylesheets } = resourcesFromHtml(htmlPath);
  const groups = [
    ["entry-js", scripts],
    ["preload", preloads],
    ["entry-css", stylesheets],
  ];
  const seen = new Set();
  const files = [];
  for (const [kind, list] of groups) {
    for (const abs of list) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!fs.existsSync(abs)) throw new Error(`首屏资源不存在：${rel(abs)}（先构建？）`);
      const bytes = fs.readFileSync(abs);
      files.push({ kind, file: rel(abs), raw: bytes.length, gzip: gz(bytes) });
    }
  }
  const byKind = (k) => files.filter((f) => f.kind === k).reduce((s, f) => s + f.gzip, 0);
  return {
    html: rel(htmlPath),
    files,
    counts: { entryJs: scripts.length, preload: preloads.length, entryCss: stylesheets.length },
    gzip: { entryJs: byKind("entry-js"), preload: byKind("preload"), entryCss: byKind("entry-css") },
    totalGzip: files.reduce((s, f) => s + f.gzip, 0),
    totalRaw: files.reduce((s, f) => s + f.raw, 0),
  };
}

/** 扫描 import 方向违规。返回 [{file,line,spec,resolved,rule}]。 */
export function scanImportDirections() {
  const violations = [];
  for (const target of ["src/core", "src/mobile", "src/features"]) {
    const absDir = path.join(ROOT, target);
    if (!fs.existsSync(absDir)) continue;
    for (const abs of walkSources(absDir)) {
      const file = rel(abs);
      const rule = IMPORT_DIRECTION_RULES.find((r) => file.startsWith(r.from));
      if (!rule) continue;
      const source = fs.readFileSync(abs, "utf8");
      STATIC_IMPORT_RE.lastIndex = 0;
      let m;
      while ((m = STATIC_IMPORT_RE.exec(source))) {
        const spec = m[1] || m[2];
        const line = source.slice(0, m.index).split("\n").length;
        if (spec.startsWith(".")) {
          const resolved = rel(path.resolve(path.dirname(abs), spec));
          if (rule.forbidRelativeOutside && !resolved.startsWith(rule.forbidRelativeOutside)) {
            violations.push({ file, line, spec, resolved, rule: rule.id });
          }
          for (const prefix of rule.forbidPrefixes ?? []) {
            if (resolved.startsWith(prefix)) violations.push({ file, line, spec, resolved, rule: rule.id });
          }
        } else if (rule.forbidBare) {
          violations.push({ file, line, spec, resolved: spec, rule: rule.id });
        }
      }
    }
  }
  return violations;
}

function formatBytes(n) {
  return n.toLocaleString("en-US") + "B (" + (n / 1000).toFixed(1) + "KB)";
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const verbose = argv.includes("--verbose");
  const requireBuild = argv.includes("--require-build");
  const failures = [];
  const report = { firstPaint: {}, importViolations: [], budgets: FIRST_PAINT_BUDGETS, contract: ARCH_CONTRACT };

  for (const [target, html] of [
    ["mobile", path.join(ROOT, "dist-mobile/index.html")],
    ["desktop", path.join(ROOT, "dist/index.html")],
  ]) {
    if (!fs.existsSync(html)) {
      report.firstPaint[target] = { skipped: true, reason: "dist 不存在（先构建）" };
      if (requireBuild) failures.push(`${target}: 缺少 ${rel(html)}（--require-build）`);
      continue;
    }
    const data = collectFirstPaint(html);
    const budget = FIRST_PAINT_BUDGETS[target];
    const pass = data.totalGzip <= budget;
    report.firstPaint[target] = { ...data, budget, pass, headroom: budget - data.totalGzip };
    if (!pass) failures.push(`${target} 首屏资源图 ${formatBytes(data.totalGzip)} > 预算 ${formatBytes(budget)}`);
  }

  const violations = scanImportDirections();
  report.importViolations = violations;
  const byFile = new Map();
  for (const v of violations) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
  for (const [file, count] of byFile) {
    if (count > (KNOWN_IMPORT_VIOLATIONS[file] ?? 0)) {
      failures.push(`import 方向新增违规：${file}（${count} 条，冻结上限 ${KNOWN_IMPORT_VIOLATIONS[file] ?? 0}）`);
    }
  }
  for (const file of Object.keys(KNOWN_IMPORT_VIOLATIONS)) {
    if (!byFile.has(file)) failures.push(`import 违规已清零但冻结清单未删：${file}（把该行从 KNOWN_IMPORT_VIOLATIONS 删掉）`);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("== check-arch（P8 全局架构门禁）==");
    for (const target of ["mobile", "desktop"]) {
      const d = report.firstPaint[target];
      if (!d || d.skipped) {
        console.log(`[${target}] 跳过：${d?.reason ?? "无数据"}`);
        continue;
      }
      console.log(
        `[${target}] 首屏资源图 gzip=${formatBytes(d.totalGzip)} / 预算 ${formatBytes(d.budget)} ` +
          `=> ${d.pass ? "PASS" : "FAIL"}（余量 ${formatBytes(d.headroom)}；entry-js ${formatBytes(d.gzip.entryJs)} / preload ×${d.counts.preload} ${formatBytes(d.gzip.preload)} / css ${formatBytes(d.gzip.entryCss)}）`,
      );
      if (verbose) for (const f of d.files) console.log(`   - [${f.kind}] ${f.gzip.toLocaleString("en-US")}B gz  ${f.file}`);
    }
    console.log(`[import 方向] 违规 ${violations.length} 条（允许清单合计 ${Object.values(KNOWN_IMPORT_VIOLATIONS).reduce((a, b) => a + b, 0)} 条）`);
    for (const v of violations) console.log(`   - ${v.file}:${v.line} ${v.rule} → ${v.spec}`);
    if (failures.length === 0) console.log("check-arch 通过 ✓");
    else for (const f of failures) console.error("✗ " + f);
  }
  if (failures.length > 0) process.exitCode = 1;
}

main();
