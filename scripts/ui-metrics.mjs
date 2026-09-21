#!/usr/bin/env node
/**
 * UI 重设计硬指标度量（P7 收尾用；也可随时跑到看进度）。
 * 用法：node scripts/ui-metrics.mjs [--json]
 *
 * 口径（与 docs/UI-REDESIGN-260921/README.md 第 1 节一致）：
 *  - 「桌面侧样式」= src 下的 .css，排除 src/b3/siyuan 与 src/vendor；**再排除 src/mobile**（移动端本批不动）
 *  - 颜色字面量只允许出现在 src/styles/themes（主题文件）
 *  - !important 分别统计「我们」与「思源层」
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'dist-mobile', 'vendor', '.git']);
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { if (!SKIP_DIRS.has(e)) walk(full, out); }
    else if (/\.(css|scss|tsx|ts)$/.test(e)) out.push(full);
  }
  return out;
}
const files = walk(join(ROOT, 'src'));
const isSiyuan = (p) => p.includes('/src/b3/siyuan/');
const isMobile = (p) => p.includes('/src/mobile/');
const isTheme = (p) => p.includes('/src/styles/themes/');
const allCss = files.filter((p) => p.endsWith('.css') && !isSiyuan(p));
const desktopCss = allCss.filter((p) => !isMobile(p));
const mobileCss = allCss.filter(isMobile);
const count = (s, re) => (s.match(re) || []).length;
function scan(list) {
  let b3 = 0, hex = 0, rgb = 0, imp = 0;
  const b3Top = [], litTop = [];
  for (const p of list) {
    // 先剥掉块注释：注释里提到 !important / #hex 不算真声明（早期口径把它们算进去过）
    const s = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const refs = count(s, /var\(--b3-[a-z0-9-]+/g);
    if (refs) { b3 += refs; b3Top.push([relative(ROOT, p), refs]); }
    imp += count(s, /!important/g);
    if (isTheme(p)) continue;
    const h = count(s, /#[0-9a-fA-F]{3,8}\b/g);
    const r = count(s, /\b(?:rgb|rgba|hsl|hsla)\(/g);
    hex += h; rgb += r;
    if (h || r) litTop.push([relative(ROOT, p), h + r]);
  }
  return { b3, hex, rgb, imp, b3Top: b3Top.sort((a, b) => b[1] - a[1]), litTop: litTop.sort((a, b) => b[1] - a[1]) };
}
// 桌面样式图 = 从 src/styles/index.css 出发、沿 @import 可达的 .css。
// P7-b 起 src/b3/*.css **桌面已不再加载**（只被移动端入口 import），所以不计入桌面指标 —— 否则会
// 把"保留给移动端的思源文件"算成桌面残留，指标永远归不了零。
function reachableCss(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const p = queue.pop();
    if (seen.has(p) || !existsSync(p) || !p.endsWith('.css')) continue;
    seen.add(p);
    const src = readFileSync(p, 'utf8');
    for (const mm of src.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)) {
      const spec = mm[1];
      if (spec.startsWith('.')) queue.push(resolve(join(p, '..'), spec));
      else if (spec.startsWith('/')) queue.push(join(ROOT, spec));
      // 裸包名（如 @dlient/lakex-doc-react/style.css）是第三方，不入我们的指标
    }
  }
  return seen;
}
const desktopGraph = desktopCss.filter((p) => reachableCss(join(ROOT, 'src/styles/index.css')).has(resolve(p)));
const onlyMobileB3 = desktopCss.filter((p) => p.includes('/src/b3/') && !desktopGraph.includes(p));
const d = scan(desktopGraph);
const m = scan(mobileCss);
const siyuanImportant = files.filter(isSiyuan).reduce((a, p) => a + count(readFileSync(p, 'utf8'), /!important/g), 0);
const appDir = join(ROOT, 'src/styles/app');
const pairs = existsSync(appDir) ? readdirSync(appDir).filter((f) => f.endsWith('.css') && existsSync(join(ROOT, 'src/styles', f))) : [];
const entry = readFileSync(join(ROOT, 'src/styles/index.css'), 'utf8');
const b3ImportLines = entry.split('\n').filter((l) => l.includes('b3/')).length;
const r = {
  desktop: { files: desktopGraph.length, b3VarRefs: d.b3, colorHex: d.hex, colorRgb: d.rgb, important: d.imp },
  desktopOnlyMobileB3: onlyMobileB3.map((p) => relative(ROOT, p)),
  mobileUntouched: { files: mobileCss.length, b3VarRefs: m.b3, important: m.imp },
  targets: { b3VarRefs: 0, colorLiterals: 0, important: 10, b3ImportLines: 0, sameNamePairs: 0 },
  b3TopTen: d.b3Top.slice(0, 10),
  colorTopTen: d.litTop.slice(0, 10),
  importantSiyuan: siyuanImportant,
  sameNamePairs: pairs,
  entryB3ImportLines: b3ImportLines,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
else {
  console.log('== 桌面侧（目标口径） ==');
  console.log('  样式文件            ', r.desktop.files, '（入口可达；另有', r.desktopOnlyMobileB3.length, '个 b3 文件已仅移动端加载）');
  console.log('  var(--b3-*) 引用    ', r.desktop.b3VarRefs, ' / 目标 0');
  console.log('     top:', r.b3TopTen.map(([f, n]) => f + ':' + n).join('  ') || '（无）');
  console.log('  颜色字面量(非主题)  ', 'hex=' + r.desktop.colorHex, 'rgb=' + r.desktop.colorRgb, ' / 目标 0');
  console.log('     top:', r.colorTopTen.map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('  !important          ', r.desktop.important, ' / 目标 ≤10');
  console.log('  入口 b3 import 行数 ', r.entryB3ImportLines, ' / 目标 0');
  console.log('  同名文件对          ', r.sameNamePairs.join(', ') || '（无）');
  console.log('== 移动端（本批不动，仅记录） ==');
  console.log('  样式文件', r.mobileUntouched.files, ' var(--b3-*)', r.mobileUntouched.b3VarRefs, ' !important', r.mobileUntouched.important);
  console.log('== 思源层 !important  ', r.importantSiyuan, '（随 b3 一起删） ==');
}