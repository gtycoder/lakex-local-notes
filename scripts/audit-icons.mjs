#!/usr/bin/env node
/**
 * 图标资产「报告型」审计 —— **这是报告，不是门禁**：不进 CI、不阻塞任何流程、退出码恒 0。
 *
 * 为什么需要它：ui-metrics 的颜色字面量口径只遍历 .css，tsx 里内联 svg 的颜色
 *   （hex / rgb() / hsl() / data:image）完全在门禁雷达外（C-PATH-PLAN §5.3 实测）。
 *
 * 判据来源：AGENTS §3#14（颜色字面量只允许在 src/styles/themes/；图标只用 lucide、描边 1.75）
 *   + docs/icon-migration/C-PATH-PLAN.md §4.3 的 R1/R2/R3（描边图形 / 填充图形 / 非 24 网格）。
 *
 * 输出：按文件分组、带行号的颜色字面量清单 + 总数；另给三个上下文计数：
 *   svg 标签总数 / 带 className=lucide 的自绘 svg / 无 className 的内联 svg。
 * 用法：node scripts/audit-icons.mjs [--json]；AUDIT_ROOT=<dir> 可指向快照目录（复现干净 HEAD 基线）
 * 首次基线（干净 HEAD cc066930，261116）：415 个 tsx；14 文件 / 39 行 / 90 处；top3 见 C-PATH-PLAN §5.4.1。
 */
import fs from 'node:fs';
import path from 'node:path';

// 默认扫本仓；AUDIT_ROOT 可指向快照目录（复现"干净 HEAD 基线"，见 C-PATH-PLAN §5.4.1）
const ROOT = process.env.AUDIT_ROOT ? path.resolve(process.env.AUDIT_ROOT) : path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|data:image\//g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const at = (src, re) => [...src.matchAll(re)].map((m) => m.index);
const insideSvg = (pos, opens, closes) =>
  opens.filter((i) => i < pos).length > closes.filter((i) => i < pos).length;

const files = walk(path.join(ROOT, 'src')).sort();
const report = { scannedFiles: files.length, svg: { total: 0, lucideClass: 0, noClassName: 0 }, files: [] };
let hitLines = 0;
let hitCount = 0;

for (const abs of files) {
  const src = fs.readFileSync(abs, 'utf8');
  for (const tag of src.match(/<svg\b[^>]*>/g) || []) {
    report.svg.total += 1;
    const cm = tag.match(/className\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/);
    const cls = cm ? (cm[1] ?? cm[2] ?? '') : null;
    if (cls === null) report.svg.noClassName += 1;
    else if (/lucide/.test(cls)) report.svg.lucideClass += 1;
  }
  const opens = at(src, /<svg\b/g);
  const closes = at(src, /<\/svg>/g);
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') starts.push(i + 1);

  const lines = [];
  src.split('\n').forEach((text, i) => {
    const matches = text.match(COLOR_RE);
    if (!matches) return;
    lines.push({ line: i + 1, inSvg: insideSvg(starts[i], opens, closes), matches: [...matches] });
    hitLines += 1;
    hitCount += matches.length;
  });
  if (lines.length) {
    report.files.push({
      file: path.relative(ROOT, abs),
      test: /\.test\.tsx$/.test(abs),
      count: lines.reduce((a, l) => a + l.matches.length, 0),
      lines,
    });
  }
}

report.files.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
Object.assign(report, {
  hitFiles: report.files.length,
  hitLines,
  hitCount,
  testFiles: report.files.filter((f) => f.test).length,
  inSvgCount: report.files.reduce(
    (a, f) => a + f.lines.filter((l) => l.inSvg).reduce((n, l) => n + l.matches.length, 0), 0),
});

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const out = [
    '图标颜色字面量审计（报告型 · 非门禁 · 退出码恒 0）',
    '扫描 ' + report.scannedFiles + ' 个 .tsx；命中 ' + report.hitFiles + ' 文件 / ' + report.hitLines +
      ' 行 / ' + report.hitCount + ' 处（落在内联 <svg> 区间 ' + report.inSvgCount + ' 处；测试文件 ' +
      report.testFiles + ' 个）',
    'svg 上下文：内联 svg 标签 ' + report.svg.total + ' 个；带 className=lucide ' +
      report.svg.lucideClass + ' 个；无 className ' + report.svg.noClassName + ' 个',
    '',
  ];
  for (const f of report.files) {
    out.push(f.file + '（' + f.count + ' 处）');
    for (const l of f.lines) {
      out.push('  ' + String(l.line).padStart(4) + (l.inSvg ? ' [svg] ' : '       ') + l.matches.join(' '));
    }
  }
  console.log(out.join('\n'));
}
// 报告型：无论命中多少都恒 0；改成非 0 就会被误接成门禁。
process.exitCode = 0;
