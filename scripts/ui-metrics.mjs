#!/usr/bin/env node
/**
 * UI 重设计硬指标度量（P7 收尾用；也可随时跑到看进度）。
 * 用法：node scripts/ui-metrics.mjs [--json]
 *
 * 口径（与 docs/UI-PRIMITIVES-PHASE1-260926.md 第 1 节一致）：
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
const isThemeFile = (p) => p.includes('/src/styles/themes/') || p.includes('/src/mobile/theme/');
/** CSS 规则提取器（B0，261016）：穿透 @media/@supports/@layer，只剔除 @keyframes 内部的步骤规则。
 *  为什么不「整块删除 at-rule」：那会把 @media 里的规则整段漏掉（实测：移动端大量规则在 @media 内，
 *  按整块删除的算法统计跨文件重复会少算）。选择器统一压缩空白，便于同名比较。 */
function extractRules(css) {
  const out = [];
  const stack = [];
  let buf = '';
  const inKeyframes = () => stack.some((s) => s.kf);
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (inKeyframes()) { stack.push({ kf: true }); continue; }
      if (/^@keyframes/i.test(prelude)) { stack.push({ kf: true }); continue; }
      if (prelude.startsWith('@')) { stack.push({ at: true }); continue; }
      stack.push({ sel: prelude, body: '' });
      continue;
    }
    if (ch === '}') { const top = stack.pop(); if (top && top.sel !== undefined) out.push(top); buf = ''; continue; }
    if (inKeyframes()) continue;
    const top = stack[stack.length - 1];
    if (top && top.sel !== undefined) top.body += ch; else buf += ch;
  }
  return out;
}
/** 某文件的 (选择器, 属性) 对（去注释、去自定义属性声明）。 */
function declarationsOf(file) {
  const pairs = [];
  for (const rule of extractRules(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))) {
    if (!rule.sel) continue;
    for (const decl of rule.body.split(';')) {
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      const prop = decl.slice(0, idx).trim();
      if (!prop || prop.startsWith('--')) continue;
      pairs.push([rule.sel, prop]);
    }
  }
  return pairs;
}
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
// B0（261016）口径修正：颜色字面量 / !important / 令牌护栏与字号护栏统一用**全部桌面 CSS**（fontScope），
// 不再只看 src/styles/index.css 的 @import 入口图（33 / 58）—— 由组件直接 import 的 25 个文件此前不在指标内。
// 实证：桌面 !important 入口图口径报 10，真实 11，漏掉的正是 features/usheet/usheetEditor.css（该文件注释已自行记录）。
const fontScope = desktopCss.filter((p) => !onlyMobileB3.includes(p));
const d = scan(fontScope);
const m = scan(mobileCss);
const siyuanImportant = files.filter(isSiyuan).reduce((a, p) => a + count(readFileSync(p, 'utf8'), /!important/g), 0);
// ── 字号护栏（261008）：桌面 CSS 里 font-size 一律走 --lake-font-size-* 令牌（含 font: 简写里的尺寸）──
// 口径 = 全部桌面 CSS（fontScope，见上）；与颜色 / !important / 令牌护栏同一集合。
let fontSizeLiterals = 0; const fontSizeTop = [];
for (const p of fontScope) {
  const s = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const n = count(s, /font-size:\s*[0-9.]+px/g) + count(s, /[^-\w]font:\s*[^;{}]*[0-9.]+px/g);
  if (n) { fontSizeLiterals += n; fontSizeTop.push([relative(ROOT, p), n]); }
}
// ── 移动端字号护栏（261013）：与桌面**同一口径**（font-size 一律走令牌），但移动端先做「只许降」——
//    存量 52 处（mobile.css 43 + editor-dock.css 9）是 P1–P7 迁移期的欠账；移动端还在做布局重做，
//    一次性清零会把批次撑爆。这里把它变成**不许新增**的门禁：新增字面量直接 exit 1，清理后记得同步调小。
const MOBILE_FONT_LITERAL_BASELINE = 49;
let mobileFontLiterals = 0; const mobileFontTop = [];
for (const p of mobileCss) {
  const s = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const n = count(s, /font-size:\s*[0-9.]+px/g);
  if (n) { mobileFontLiterals += n; mobileFontTop.push([relative(ROOT, p), n]); }
}
const appDir = join(ROOT, 'src/styles/app');
const pairs = existsSync(appDir) ? readdirSync(appDir).filter((f) => f.endsWith('.css') && existsSync(join(ROOT, 'src/styles', f))) : [];
const entry = readFileSync(join(ROOT, 'src/styles/index.css'), 'utf8');
const b3ImportLines = entry.split('\n').filter((l) => l.includes('b3/')).length;
const r = {
  desktop: { files: desktopGraph.length, scannedFiles: fontScope.length, b3VarRefs: d.b3, colorHex: d.hex, colorRgb: d.rgb, important: d.imp },
  desktopOnlyMobileB3: onlyMobileB3.map((p) => relative(ROOT, p)),
  mobileUntouched: { files: mobileCss.length, b3VarRefs: m.b3, important: m.imp },
  fontGuard: { fontSizeLiterals, fontSizeTop: fontSizeTop.sort((a, b) => b[1] - a[1]) },
  mobileFontGuard: { fontSizeLiterals: mobileFontLiterals, baseline: MOBILE_FONT_LITERAL_BASELINE, fontSizeTop: mobileFontTop.sort((a, b) => b[1] - a[1]) },
  targets: { b3VarRefs: 0, colorLiterals: 0, fontSizeLiterals: 0, important: 10, b3ImportLines: 0, sameNamePairs: 0 },
  b3TopTen: d.b3Top.slice(0, 10),
  colorTopTen: d.litTop.slice(0, 10),
  importantSiyuan: siyuanImportant,
  sameNamePairs: pairs,
  entryB3ImportLines: b3ImportLines,
};
// ── 令牌护栏（260923）：① 禁"过渡别名残用" ② var(--lake-*) 必须已定义 ──
const FORBIDDEN = ['--lake-shell','--lake-panel','--lake-canvas','--lake-surface','--lake-raised','--lake-border','--lake-text','--lake-text-secondary','--lake-text-tertiary','--lake-accent-soft','--lake-accent-soft-strong','--lake-sync-pending','--lake-sync-success','--lake-error','--lake-error-strong','--lake-error-soft','--lake-warning-soft','--lake-success-soft','--lake-shadow-panel','--lake-shadow-soft','--radius-xs','--radius-sm','--radius-md','--radius-xl','--radius-pill','--lake-motion-standard'];
const cssAll = [...fontScope, ...mobileCss];
const definedTokens = new Set();
for (const p of cssAll) for (const m of readFileSync(p, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)) definedTokens.add(m[1]);
const runtimeTokens = new Set();
for (const p of files.filter((x) => /\.(tsx|ts)$/.test(x))) for (const m of readFileSync(p, 'utf8').matchAll(/--lake-[a-z0-9-]+/g)) runtimeTokens.add(m[0]);
const aliasRe = new RegExp('var\\(\\s*(?:' + FORBIDDEN.map((a) => a.replace(/-/g, '\\-')).join('|') + ')\\s*\\)', 'g');
let aliasHits = 0; const aliasTop = [];
let undefHits = 0; const undefTop = [];
for (const p of cssAll) {
  const src = readFileSync(p, 'utf8');
  const a = count(src, aliasRe);
  if (a) { aliasHits += a; aliasTop.push([relative(ROOT, p), a]); }
  let u = 0; for (const m of src.matchAll(/var\(\s*(--lake-[a-z0-9-]+)/g)) if (!definedTokens.has(m[1]) && !runtimeTokens.has(m[1])) u += 1;
  if (u) { undefHits += u; undefTop.push([relative(ROOT, p), u]); }
}
r.tokensGuard = { forbiddenAliasRefs: aliasHits, undefinedLakeRefs: undefHits, aliasTop, undefTop };

// ── 合规护栏（B0，261016）：把「红线」变成可执行判据（基线只许降）──────────────
// 背景：代码 review（docs/CODE-REVIEW-261015.md）发现三条红线只有文字规定、没有机器判据：
//   ① 桌面「非主题颜色字面量 0」此前只报告、不判失败；
//   ② 移动端颜色字面量**完全没有统计**（scripts/check-mobile-ui.mjs 头注释却声称已含）；
//   ③ 「文字一律用 --lake-accent-text」与「同一 (选择器,属性) 不得跨文件重复」都没有判据。
// 基线 = 首次实测存量，**只许降**（清理时同步调小；清理批次见 CODE-REVIEW §7 的 B2）。
const BASELINE = {
  desktopImportant: 11,        // 口径修正后实测（入口图口径曾报 10）；AGENTS §3#14 的目标仍是 ≤10 ⇒ B2 收口
  mobileColorLiterals: 0,      // 261016 B2 已清零：28 处收编进 src/mobile/theme/tokens.css（取值不变）⇒ 现在与桌面同为硬 0
  accentTextMisuse: 36,        // 越界把 --lake-accent 当文字色；目标 0
  crossFileDupGroups: 298,     // 同一 (选择器,属性) 出现在 ≥2 个文件；文件内重复另有 cssLayers/mobileLayers 围栏
};

// ① 桌面非主题颜色字面量（硬目标 0）
const desktopColorLiterals = d.hex + d.rgb;

// ② 移动端非主题颜色字面量（src/mobile/theme/** 除外，那才是移动端的令牌层）
let mobileColorLiterals = 0; const mobileColorTop = [];
for (const p of mobileCss) {
  if (isThemeFile(p)) continue;
  const s = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const n = count(s, /#[0-9a-fA-F]{3,8}\b/g) + count(s, /\b(?:rgb|rgba|hsl|hsla)\(/g);
  if (n) { mobileColorLiterals += n; mobileColorTop.push([relative(ROOT, p), n]); }
}

// ③ 文字色误用裸 --lake-accent（规则：文字一律 --lake-accent-text；accent 只做图形/边框/焦点环/底纹）
let accentTextMisuse = 0; const accentTextTop = [];
for (const p of cssAll) {
  if (isThemeFile(p)) continue;
  const rel = relative(ROOT, p);
  for (const rule of extractRules(readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))) {
    for (const decl of rule.body.split(';')) {
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      if (decl.slice(0, idx).trim() === 'color' && /var\(--lake-accent\)/.test(decl.slice(idx + 1))) {
        accentTextMisuse += 1;
        const hit = accentTextTop.find(([f]) => f === rel);
        if (hit) hit[1] += 1; else accentTextTop.push([rel, 1]);
      }
    }
  }
}
accentTextTop.sort((a, b) => b[1] - a[1]);

// ④ 跨文件重复 (选择器, 属性) —— 「一层层套 CSS」唯一还没有围栏的形态
//    注意：现有 cssLayers/mobileLayers 的 dupGroups 是**按文件内**统计的，跨文件覆盖看不到。
const dupOwners = new Map();
for (const p of cssAll) {
  const rel = relative(ROOT, p);
  for (const [sel, prop] of declarationsOf(p)) {
    const key = sel + ' || ' + prop;
    if (!dupOwners.has(key)) dupOwners.set(key, new Set());
    dupOwners.get(key).add(rel);
  }
}
const crossFileDups = [...dupOwners.entries()].filter(([, owners]) => owners.size > 1);
const crossFileDupTop = crossFileDups
  .map(([key, owners]) => [key, owners.size, [...owners]])
  .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));

r.complianceGuard = {
  desktopColorLiterals,
  desktopImportant: d.imp,
  mobileColorLiterals,
  mobileColorTop: mobileColorTop.sort((a, b) => b[1] - a[1]),
  accentTextMisuse,
  accentTextTop,
  crossFileDupGroups: crossFileDups.length,
  crossFilePairTotal: dupOwners.size,
  crossFileDupTop: crossFileDupTop.slice(0, 10),
  baseline: BASELINE,
};

if (desktopColorLiterals) process.exitCode = 1;
if (d.imp > BASELINE.desktopImportant) process.exitCode = 1;
if (mobileColorLiterals > BASELINE.mobileColorLiterals) process.exitCode = 1;
if (accentTextMisuse > BASELINE.accentTextMisuse) process.exitCode = 1;
if (crossFileDups.length > BASELINE.crossFileDupGroups) process.exitCode = 1;
if (aliasHits || undefHits) process.exitCode = 1;
if (fontSizeLiterals) process.exitCode = 1;
if (mobileFontLiterals > MOBILE_FONT_LITERAL_BASELINE) process.exitCode = 1;

if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
else {
  console.log('== 桌面侧（目标口径） ==');
  console.log('  样式文件            ', r.desktop.files, '入口图 /', r.desktop.scannedFiles, '实际扫描（B0 起颜色/!important/令牌与字号同口径；另有', r.desktopOnlyMobileB3.length, '个 b3 文件已仅移动端加载）');
  console.log('  var(--b3-*) 引用    ', r.desktop.b3VarRefs, ' / 目标 0');
  console.log('     top:', r.b3TopTen.map(([f, n]) => f + ':' + n).join('  ') || '（无）');
  console.log('  颜色字面量(非主题)  ', 'hex=' + r.desktop.colorHex, 'rgb=' + r.desktop.colorRgb, ' / 目标 0');
  console.log('     top:', r.colorTopTen.map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('  !important          ', r.desktop.important, ' / 目标 ≤10');
  console.log('  字号字面量(非令牌)  ', r.fontGuard.fontSizeLiterals, ' / 目标 0');
  console.log('     top:', r.fontGuard.fontSizeTop.map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('  入口 b3 import 行数 ', r.entryB3ImportLines, ' / 目标 0');
  console.log('  同名文件对          ', r.sameNamePairs.join(', ') || '（无）');
  console.log('== 移动端 ==');
  console.log('  样式文件', r.mobileUntouched.files, ' var(--b3-*)', r.mobileUntouched.b3VarRefs, ' !important', r.mobileUntouched.important);
  console.log('  字号字面量        ', r.mobileFontGuard.fontSizeLiterals, ' / 基线', r.mobileFontGuard.baseline, '（只许降；新增直接失败）');
  console.log('     top:', r.mobileFontGuard.fontSizeTop.map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('== 思源层 !important  ', r.importantSiyuan, '（随 b3 一起删） ==');
  console.log('== 令牌护栏（260923） ==');
  console.log('  禁别名残用          ', r.tokensGuard.forbiddenAliasRefs, ' / 目标 0', r.tokensGuard.aliasTop.map(([f,n])=>f+':'+n).join(' ')||'');
  console.log('  var(--lake-*) 未定义', r.tokensGuard.undefinedLakeRefs, ' / 目标 0', r.tokensGuard.undefTop.map(([f,n])=>f+':'+n).join(' ')||'');
  const g = r.complianceGuard;
  console.log('== 合规护栏（B0，261016；基线只许降） ==');
  console.log('  桌面颜色字面量(非主题)', g.desktopColorLiterals, ' / 目标 0');
  console.log('  桌面 !important        ', g.desktopImportant, ' / 基线', g.baseline.desktopImportant, '（红线目标仍 ≤10 ⇒ B2 收口）');
  console.log('  移动端颜色字面量(非主题)', g.mobileColorLiterals, ' / 基线', g.baseline.mobileColorLiterals);
  console.log('     top:', g.mobileColorTop.map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('  文字色误用裸 accent    ', g.accentTextMisuse, ' / 基线', g.baseline.accentTextMisuse, '（应改 --lake-accent-text）');
  console.log('     top:', g.accentTextTop.slice(0, 6).map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('  跨文件重复(选择器,属性)', g.crossFileDupGroups, ' / 基线', g.baseline.crossFileDupGroups, '（全部对', g.crossFilePairTotal + '）');
  console.log('     top:', g.crossFileDupTop.slice(0, 4).map(([k, n]) => k + ' ×' + n).join('  ') || '（无）');
}