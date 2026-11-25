#!/usr/bin/env node
/**
 * UI 重设计硬指标度量（P7 收尾用；也可随时跑到看进度）。
 * 用法：node scripts/ui-metrics.mjs [--json]
 *
 * 口径（与 docs/DESIGN.md 第 1 节一致）：
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
const MOBILE_FONT_LITERAL_BASELINE = 0;
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
  targets: { b3VarRefs: 0, colorLiterals: 0, fontSizeLiterals: 0, important: 5, b3ImportLines: 0, sameNamePairs: 0 },
  b3TopTen: d.b3Top.slice(0, 10),
  colorTopTen: d.litTop.slice(0, 10),
  importantSiyuan: siyuanImportant,
  sameNamePairs: pairs,
  entryB3ImportLines: b3ImportLines,
};
// ── 令牌护栏（260923）：① 禁"过渡别名残用" ② var(--lake-*) 必须已定义 ──
const FORBIDDEN = ['--lake-shell','--lake-panel','--lake-canvas','--lake-surface','--lake-raised','--lake-border','--lake-text','--lake-text-secondary','--lake-text-tertiary','--lake-accent-soft','--lake-accent-soft-strong','--lake-sync-pending','--lake-sync-success','--lake-error','--lake-error-strong','--lake-error-soft','--lake-warning-soft','--lake-success-soft','--lake-shadow-panel','--lake-shadow-soft','--radius-xs','--radius-sm','--radius-md','--radius-xl','--radius-pill','--lake-motion-standard',
  // 261125 审计 T-04：--shell-* 恒等别名族已整体删除（使用点直连 --lake-*）；补进禁表防回流。
  '--shell-accent','--shell-accent-strong','--shell-accent-soft','--shell-text','--shell-text-secondary','--shell-text-tertiary','--shell-ease'];
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
// 背景：代码 review（AGENTS.md）发现三条红线只有文字规定、没有机器判据：
//   ① 桌面「非主题颜色字面量 0」此前只报告、不判失败；
//   ② 移动端颜色字面量**完全没有统计**（scripts/check-mobile-ui.mjs 头注释却声称已含）；
//   ③ 「文字一律用 --lake-accent-text」与「同一 (选择器,属性) 不得跨文件重复」都没有判据。
// 基线 = 首次实测存量，**只许降**（清理时同步调小；清理批次见 CODE-REVIEW §7 的 B2）。
const BASELINE = {
  desktopImportant: 5,        // = IMPORTANT_ALLOWLIST.length（见下）；只许降，且不得出现清单外的 !important（261125 S-05 删 .seg 4 条：9 → 5）
  mobileImportant: 19,         // 移动端 !important 棘轮（主要是 edit-surface-kernel.css 压内核未分层样式）
  mobileColorLiterals: 0,      // 261016 B2 已清零：28 处收编进 src/mobile/theme/tokens.css（取值不变）⇒ 与桌面同为硬 0
  // 261125 T-04 恒等替换 --shell-accent-strong → var(--lake-accent) 后暴露 3 处既有命中（此前被别名掩盖、护栏看不见）：
  // outline.css 的 .outline-sidebar__activity-button:hover/.active 与 tabs.css 的 .tab-switcher.open。
  // 三处 color 都画**图标/字形**（rail 图标钮、ChevronDown），无文字 ⇒ 属 AGENTS「--lake-accent 只做图形」的合法用法，
  // 是护栏口径把一切 color: 当文字色的误报；换 --lake-accent-text 反而是错误语义 + 视觉取值变更（T-04 要求恒等、零视觉变化）。
  // 暂记 3 处例外；根治 = 门禁口径按「图标色/字形」豁免（M 批），届时回 0。
  accentTextMisuse: 3,         // 261016 B2 清零（原 36）：文字色一律 --lake-accent-text；261125 见上注（0 → 3，已知误报例外）
  // 261103：统计口径修正（逗号选择器按**单个选择器**拆分后比较，见 splitSelectorList）——
  // 旧口径下「a, b { x }」与「a { x }」不算重复，pad.css ↔ mobile.css 的 9 组双归属全部漏检。
  // 修正后实测 116 组；同日把平板通用几何整体迁进 pad.css（A4 单一归属）后 **105**；此后只许降。
  crossFileDupGroups: 2,       // 261125 M-05（只降，按实测收紧）：33 → 2 = ①契约对（a11y reduced-motion / reduced-transparency）加标注豁免出棘轮（16 组，历史兼容 #16 不许删的必然形态）；②S-07 栅格三态单源、M-01 残影清理后再降 6 组。剩 2 组欠账·同层：.settings-panel||border-color（shell 共享规则只被部分压——共享选择器还有活的，261112 那类）、.workspace||grid-column（宽 col3 / 窄 col2 互补 @media，S-07 同型待收）。旧口径注：45 → 33 = S-01/S-03/T-03 清理；口径 = 同一端内同一 (选择器,属性) 出现在 ≥2 文件；跨端重复不计（C4-5 要求两端都写）
  // 261112 Q1：被更高层压掉的 legacy 声明数（同 at-rule 上下文 + 同选择器 + 同属性）。
  // 261112 删 35 条后实测 21（原 58）：feature.css 3（未分层的 bitableEditor/boardEditor 压 feature 层）
  //        + misc.css 4（a11y 已接管 reduced-motion，legacy 副本可下批删）
  //        + 14 条"共享规则里只有部分选择器被压"（同一条规则还有生效的兄弟选择器 ⇒ 不能整条删，只能等重构）。只许降。
  shadowedDecls: 0,             // 261112 Q1：21 → 0（feature.css 3 / misc.css 4 / quick-notes.css 4 / shell.css 10 的 legacy 侧全部删除；只删被上层压死的声明，胜者不动）
};

// ── !important 允许清单（Q2，261016；用户定："确实有必要用 !important 可以保留，不是一点不能用"）──
// 规则：**总数不得超过清单长度**，且**不得出现清单外的 !important** —— 数字上限从此变成"逐条有理由"。
// 唯一允许的例外（AGENTS §3#14）：压内核/第三方写进 element 的 inline style，或压 legacy 层里的 !important。
// 每条都必须写明"压的是谁"；删掉某条时应同时从本表移除（本脚本会把"清单里但已找不到"的条目列出来提醒）。
const IMPORTANT_ALLOWLIST = [
  // 261125 审计 S-05：.seg/.seg__item 死实现整块删除（全仓 TSX 零引用，段控件已迁 kit .ln-segment）⇒ 4 条 !important 随之出表（桌面 9 → 5）。

  { file: 'styles/tokens.css', sel: '.create-menu, .context-menu', prop: 'backdrop-filter', why: 'prefers-reduced-transparency 契约：要压所有浮层的毛玻璃，含第三方/内核浮层' },
  { file: 'styles/tokens.css', sel: '.create-menu, .context-menu', prop: '-webkit-backdrop-filter', why: '同上（-webkit- 前缀）' },
  { file: 'styles/tokens.css', sel: '.create-menu, .context-menu', prop: 'background', why: '同上（改用不透明面板底）' },
  { file: 'styles/app/quick-notes.css', sel: '.quick-notes-pane .lake-editor-mount.ne-ui-fullscreen', prop: 'position', why: '内核 legacy 里有 position:fixed!important（实测仍会盖住红绿灯）' },
  { file: 'features/usheet/usheetEditor.css', sel: '.usheet-editor section:has([data-u-comp="slide-tab-bar"])', prop: 'height', why: '内核把高度写成 **inline style** style="height: 36px"（实测；非类非变量）' },
];
/** 收集一组文件里 !important 声明的条数。 */
function collectImportantAll(files) {
  let n = 0;
  for (const p of files) n += collectImportant(p).length;
  return n;
}
/** 收集某文件里所有带 !important 的声明（选择器 + 属性）。 */
function collectImportant(file) {
  const out = [];
  for (const rule of extractRules(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))) {
    if (!rule.sel) continue;
    for (const decl of rule.body.split(';')) {
      if (!/!important/.test(decl)) continue;
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      out.push({ sel: rule.sel, prop: decl.slice(0, idx).trim() });
    }
  }
  return out;
}

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

/** 把逗号选择器列表拆成单选择器（尊重 () [] 与引号内的逗号）。
 *  261103 评审 W3：原先用整段 selectorText 做 key ⇒「a, b { x }」与「a { x }」不算重复，
 *  双归属规则因此全漏检（pad.css 与 mobile.css 的 9 组同属性规则从未被看见）。 */
function splitSelectorList(sel) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  for (const ch of sel) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

// ④ 跨文件重复 (选择器, 属性) —— 「一层层套 CSS」唯一还没有围栏的形态
//    注意：现有 cssLayers/mobileLayers 的 dupGroups 是**按文件内**统计的，跨文件覆盖看不到。
// ⚠️ 口径（261016 修正）：只统计**同一端内**的跨文件重复 —— 那才是「一层层套 CSS」。
// 跨端重复（桌面与移动写同一批结构类名）是**设计允许**的（用户 261012「逻辑共享、外观各端自有」），
// 而且 C4-5 护栏还**要求**两端都写 ⇒ 把它算进棘轮会让指标失去意义。
// 实证：修正前共 308 组，其中纯跨端 295 组、同一端内只有 13 组 —— 补 .editor-error 到移动端那 10 条
// 全是「合法跨端」，却把旧口径的 298 基线顶爆，正是这次修正的起因。
const dupOwners = new Map();
for (const p of cssAll) {
  const rel = relative(ROOT, p);
  const isMobileFile = p.includes('/src/mobile/');
  for (const [selList, prop] of declarationsOf(p)) {
    for (const sel of splitSelectorList(selList)) {
      const key = sel + ' || ' + prop;
      if (!dupOwners.has(key)) dupOwners.set(key, { desktop: new Set(), mobile: new Set() });
      (isMobileFile ? dupOwners.get(key).mobile : dupOwners.get(key).desktop).add(rel);
    }
  }
}
const LAYER_RANK = { vendor: 0, legacy: 1, tokens: 2, kit: 3, shell: 4, feature: 5, overlay: 6, a11y: 7, unlayered: 9 };
const layerRanks = layerRankMap();   // 文件 → { rank, order }（M-05 同层/跨层分组与 M-01 判死共用）
// ── M-05（261125）：重复组报告面 —— 全清单 + 分类（纯报告改动）────────────────
// 45→N 组里混着两类：真欠账 vs **契约形态**（a11y reduced-motion 的同名覆盖对、tokens.css 的
// prefers-reduced-transparency 对）——后者是「层序即优先级」契约的必然形态（历史兼容清单 #16：不许删），
// 不是叠层债 ⇒ 加标注**豁免出棘轮**（否则数字永远压不动、真欠账被淹）；其余按「同层/跨层」分组显示。
const dupCtx = new Map();   // `${sel}||${prop}` → [{ file, ctx }]（分类用：契约对看 at-rule 上下文）
for (const p of cssAll) {
  const rel = relative(ROOT, p).replace(/^src\//, '');
  const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const decl of declsWithContext(src)) {
    for (const sel of splitSelectorList(decl.sel)) {
      const key = sel + ' || ' + decl.prop;
      if (!dupCtx.has(key)) dupCtx.set(key, []);
      dupCtx.get(key).push({ file: rel, ctx: decl.ctx });
    }
  }
}
function classifyDupGroup(key) {
  const members = dupCtx.get(key) || [];
  const rt = members.some((m) => /prefers-reduced-transparency/.test(m.ctx));
  const rm = members.some((m) => /prefers-reduced-motion/.test(m.ctx) || m.file === 'styles/a11y.css');
  if (rt) return '契约·reduced-transparency';
  if (rm) return '契约·a11y/reduced-motion';
  return null;
}
const sameEndDups = [...dupOwners.entries()].filter(([, e]) => e.desktop.size > 1 || e.mobile.size > 1);
const crossEndDups = [...dupOwners.entries()].filter(([, e]) => e.desktop.size > 0 && e.mobile.size > 0);
const crossFileDupTop = sameEndDups
  .map(([key, e]) => {
    const files = [...e.desktop, ...e.mobile];
    const cls = classifyDupGroup(key) || (files.every((f) => (layerRanks.get(resolve(join(ROOT, 'src', f))) ?? { rank: 9 }).rank === (layerRanks.get(resolve(join(ROOT, 'src', files[0]))) ?? { rank: 9 }).rank) ? '欠账·同层' : '欠账·跨层');
    return [key, files.length, files, cls];
  })
  .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
const crossFileDupContract = crossFileDupTop.filter((x) => x[3].startsWith('契约')).length;

// ── ⑤ 被上层压掉的 legacy 声明（Q1，261112）──────────────────────────────────
// 判据：同一 (at-rule 上下文, 单个选择器, 属性) 被**更高层**文件再声明过 ⇒ 低层那份永远不生效
// （@layer 里层序即优先级，与特异性无关；未分层 > 任何层）。
// 层序取自 src/styles/index.css 的 @import ... layer(X)；组件内 JS import 的 CSS 未分层 = 最高。
// 排除：低层声明带 !important（会赢）；只看桌面 CSS（跨端重复是设计允许）。
// 这条护栏把「改错文件」——本轮 03 报告 P1-1 的根因——变成机器可拦，而不是靠 review。
function layerRankMap() {
  const map = new Map();
  let order = 0;
  const entrySrc = readFileSync(join(ROOT, 'src/styles/index.css'), 'utf8');
  for (const m of entrySrc.matchAll(/@import\s+"([^"]+)"(?:\s+layer\(([a-z]+)\))?\s*;/g)) {
    if (!m[1].startsWith('.')) continue;
    const path = resolve(join(ROOT, 'src/styles', m[1]));
    if (map.has(path)) continue;
    // rank 缺省 9 = 未分层入口（kernel-theme / 字体）；order = 入口 @import 顺序（同层后者胜的判据，M-01 形态②）
    map.set(path, { rank: m[2] ? (LAYER_RANK[m[2]] ?? 9) : 9, order: order++ });
  }
  return map;
}
/** 带 at-rule 上下文的声明提取：(ctx, 单选择器, 属性, 值, 是否 !important)。 */
function declsWithContext(css) {
  const rules = [];
  const stack = [];
  let buf = '';
  const atCtx = () => stack.filter((s) => s.at).map((s) => s.at).join('|');
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (/^@(keyframes|font-face|page)/i.test(prelude)) { stack.push({ skip: true }); continue; }
      if (prelude.startsWith('@')) { stack.push({ at: prelude }); continue; }
      if (stack.some((s) => s.skip)) { stack.push({ skip: true }); continue; }
      stack.push({ sel: prelude, body: '', ctx: atCtx() });
      continue;
    }
    if (ch === '}') { const top = stack.pop(); if (top && top.sel !== undefined) rules.push(top); buf = ''; continue; }
    if (stack.some((s) => s.skip)) continue;
    const top = stack[stack.length - 1];
    if (top && top.sel !== undefined) top.body += ch; else buf += ch;
  }
  const out = [];
  let ruleId = 0;
  for (const rule of rules) {
    ruleId += 1;
    const sels = splitSelectorList(rule.sel);
    const body = [];
    let depth = 0;
    let seg = '';
    for (const ch of rule.body) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { body.push(seg); seg = ''; } else seg += ch;
    }
    if (seg.trim()) body.push(seg);
    for (const decl of body) {
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      const prop = decl.slice(0, idx).trim();
      if (!prop || prop.startsWith('--')) continue;
      const value = decl.slice(idx + 1).trim();
      const important = value.includes('!important');
      for (const sel of sels) out.push({ ctx: rule.ctx, ruleId, sel, prop, value, important });
    }
  }
  return out;
}
// M-01（261125 口径放宽一档）：按**整条声明**建模（一条规则里的 (属性) × 其逗号选择器全集），再判「被无条件胜者压死」。
// 与旧口径（ctx+sel+prop 逐选择器逐条）相比新增两种形态，正好补上 S-01 那类「@media 里的残影」盲区：
//   ① 跨层：rank(胜者) > rank(败者)，且胜者在**顶层上下文**或与败者同 at-rule 上下文（层序即优先级，AGENTS §3#14）；
//   ② 同层：rank 相同、胜者在**更晚的文件**（按 index.css @import 顺序）且在顶层上下文（同层同特异性后加载者胜）。
// 保守边界（「先只对高层在顶层上下文的形态判死」）：胜者必须顶层 —— 否则 a11y reduced-motion 这类
// **条件覆盖**会把常驻声明误判为死（a11y 层序反转误判）；宽/窄互补 @media（上下文不同、双方都非顶层）互不判。
// !important 不判死（压得过层序）；共享规则里还有生效兄弟选择器的**整条不算死**（261112 那 14 条教训）；
// 组件 JS import 的 CSS（未入 index.css 入口图）加载顺序未知 ⇒ 形态②对它们不判（形态①照判）。
const declIndex = new Map();   // `${sel}||${prop}` → 声明实例数组
let declSeq = 0;
for (const p of fontScope) {
  const meta = layerRanks.get(resolve(p));
  const rank = meta ? meta.rank : 9;
  const fileOrder = meta ? meta.order : -1;   // -1 = 入口图外（组件 CSS），顺序未知
  const file = relative(ROOT, p).replace(/^src\//, '');
  const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const perRule = new Map();   // `${ruleId}||${prop}` → 实例（同规则同名属性后者覆盖前者）
  for (const decl of declsWithContext(src)) {
    const key = decl.ruleId + ' || ' + decl.prop;
    if (!perRule.has(key)) perRule.set(key, []);
    perRule.get(key).push(decl);
  }
  for (const [key, group] of perRule) {
    const last = group[group.length - 1];
    const inst = {
      id: declSeq++, file, fileOrder, rank, ctx: last.ctx,
      sels: [...new Set(group.flatMap((d) => splitSelectorList(d.sel)))],
      prop: last.prop, value: last.value, important: last.important,
    };
    for (const sel of inst.sels) {
      const gk = sel + ' || ' + inst.prop;
      if (!declIndex.has(gk)) declIndex.set(gk, []);
      declIndex.get(gk).push(inst);
    }
  }
}
/** 胜者判定：W 在败者 X 会生效的**所有**场合都赢（见上方两条形态；W 顶层是保守边界的关键）。 */
function winnerOver(W, X) {
  if (W.id === X.id) return false;
  if (X.important) return false;                       // !important 压得过层序，判不了死
  if (W.ctx !== X.ctx && W.ctx !== '') return false;  // 胜者非顶层且上下文不同：条件互补（如宽/窄 @media），不判
  if (W.rank > X.rank) return true;                   // ① 跨层（层序即优先级；同上下文或胜者顶层）
  if (W.rank === X.rank && W.ctx === '' && W.fileOrder >= 0 && X.fileOrder >= 0 && W.fileOrder > X.fileOrder) return true;   // ② 同层更晚文件（顶层）
  return false;
}
const shadowedSites = [];
for (const [, group] of declIndex) {
  for (const X of group) {
    if (X.important || X._done) continue;
    X._done = true;
    let winner = null;
    let allDead = true;
    for (const sel of X.sels) {
      const w = (declIndex.get(sel + ' || ' + X.prop) || []).filter((W) => winnerOver(W, X))
        .sort((a, b) => (b.rank - a.rank) || (b.fileOrder - a.fileOrder))[0];
      if (!w) { allDead = false; break; }
      winner = winner || w;
    }
    if (!allDead) continue;
    shadowedSites.push({ file: X.file, rank: X.rank, sel: X.sels.join(', '), prop: X.prop, layerValue: X.value, winnerFile: winner.file, winnerValue: winner.value });
  }
}
const shadowedDecls = shadowedSites.length;

// ⑤ !important：桌面按**允许清单**逐条核对；移动端走棘轮
const desktopImportantSites = [];
for (const p of fontScope) for (const site of collectImportant(p)) desktopImportantSites.push({ file: relative(ROOT, p).replace(/^src\//, ''), ...site });
const key = (s) => s.file + ' || ' + s.sel + ' || ' + s.prop;
const allowKeys = new Set(IMPORTANT_ALLOWLIST.map(key));
const foundKeys = new Set(desktopImportantSites.map(key));
const importantUnknown = desktopImportantSites.filter((s) => !allowKeys.has(key(s)));
const importantStale = IMPORTANT_ALLOWLIST.filter((s) => !foundKeys.has(key(s)));
const mobileImportant = collectImportantAll(mobileCss);

// ── 动效用法护栏（M-03，261125）：DESIGN Motion 的机器判据（桌面 + 移动端同一口径）──
// ① transition/animation 声明值里出现 ms 字面量 ⇒ 报（时长/延迟一律走 --lake-motion-* / --mobile-* 令牌档）；
// ② transition 的属性列表含 background/color/border/box-shadow ⇒ 报（装饰性过渡：hover/颜色/边框瞬时切换）。
// 白名单：a11y.css 与 prefers-reduced-motion 契约（1ms 惯用法；「保留透明度与颜色过渡」是契约本身，历史兼容 #16）。
// 基线只许降。261125 上闸前已清存量：editor.css 搜索命中 900ms 背景脉冲按 R-03①「直接删脉冲」、
// outline.css 拖柄 ::after 背景过渡按 R-02「状态切换瞬时」删除（静态命中环/拖柄本体不动）。
const MOTION_BASELINE = 2;   // 261125 M-03 上闸实测：剩 2 处均在本批 scope 外 —— mobile.css 的 0ms 延迟字面量、
//  features/bitable/bitableEditor.css 的 .bt-input border-color/box-shadow 过渡（bitable 密集面另有 R-04 登记口径）；报 lead 后续批次清。
const motionWhitelist = (rel, ctx) => rel.endsWith('styles/a11y.css') || /prefers-reduced-motion/.test(ctx);
const motionHits = [];
for (const p of cssAll) {
  const rel = relative(ROOT, p).replace(/^src\//, '');
  const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const decl of declsWithContext(src)) {
    if (!/^(-webkit-)?(transition|animation)/.test(decl.prop)) continue;
    if (motionWhitelist(rel, decl.ctx)) continue;
    if (/\d(\.\d+)?ms\b/.test(decl.value)) {
      motionHits.push({ file: rel, sel: decl.sel, prop: decl.prop, why: 'ms 字面量', value: decl.value.slice(0, 60) });
    } else if (decl.prop.startsWith('transition')) {
      const items = decl.value.split(',').map((s) => s.trim().split(/\s+/)[0]);
      if (items.some((x) => /^(background|background-color|background-image|color|border|border-color|border-width|border-radius|box-shadow|fill|stroke)$/.test(x))) {
        motionHits.push({ file: rel, sel: decl.sel, prop: decl.prop, why: '装饰性过渡', value: decl.value.slice(0, 60) });
      }
    }
  }
}

// ── 内联 style 棘轮（M-04，261125）────────────────────────────────────────────
// ① style={{}} 计数棘轮（只许降）：组件里不写 style={{}}（AGENTS §3#14 改落点），存量只减不增；
// ② **静态**视觉属性（字面量值的 color/background/font-size/border/radius 族）出现在 style={{}} ⇒ 即报：
//    视觉样式属于 CSS/令牌；动态值是 DESIGN 登记例外（实测坐标、数据驱动颜色），不算。
//    动态几何按属性名白名单（left/top/width/height/--* 变量）；几何脚手架存量只进计数棘轮。
// 261125 上闸前已顺清两处存量：MultiTabEditor 隐藏占位改 .a11y-visually-hidden、EditorTab 静态 width 进 .lake-editor-tab 规则。
const INLINE_STYLE_BASELINE = 86;   // 261125 M-04 上闸实测（清完 2 处存量后只许降；历史 81/87 口径差异来自拆分批并发改动，以本脚本实测为准）
const STATIC_VISUAL = /^(color|background(-color|-image)?|font-size|font-family|border(-[a-z]+)*|box-shadow)$/;
const STATIC_LIT = /^("[^"]*"|'[^']*'|-?[0-9.]+|true|false|null)$/;
let inlineStyleSites = 0;
const inlineStyleStaticVisual = [];
for (const p of files.filter((x) => /\.(tsx|ts)$/.test(x))) {
  const rel = relative(ROOT, p).replace(/^src\//, '');
  const src = readFileSync(p, 'utf8');
  let i = 0;
  while ((i = src.indexOf('style={{', i)) >= 0) {
    inlineStyleSites += 1;
    let depth = 2, k = i + 8;
    while (k < src.length && depth > 0) { const c = src[k]; if (c === '{') depth += 1; if (c === '}') depth -= 1; k += 1; }
    const body = src.slice(i + 8, k - 1).replace(/\}\s*$/, '');
    const parts = []; let d2 = 0, cur = '', q = null;
    for (const c of body) {
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
      if (c === '(' || c === '{' || c === '[') d2 += 1;
      if (c === ')' || c === '}' || c === ']') d2 = Math.max(0, d2 - 1);
      if (c === ',' && d2 === 0) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) parts.push(cur);
    for (const part of parts) {
      const m2 = part.match(/^\s*([\w"'-]+)\s*:\s*([\s\S]+)$/);
      if (!m2) continue;
      const key = m2[1].replace(/["']/g, '');
      if (!STATIC_VISUAL.test(key)) continue;          // left/top/width/height/--* 等几何名不进视觉检查（白名单按属性名）
      if (!STATIC_LIT.test(m2[2].trim())) continue;    // 动态值 = DESIGN 登记例外（数据驱动颜色/实测值）
      inlineStyleStaticVisual.push(rel + ':' + src.slice(0, i).split('\n').length + ' ' + key + ' = ' + m2[2].trim().slice(0, 24));
    }
    i = k;
  }
}

r.complianceGuard = {
  desktopColorLiterals,
  desktopImportant: d.imp,
  desktopImportantSites,
  importantAllowlist: IMPORTANT_ALLOWLIST,
  importantUnknown,
  importantStale,
  mobileImportant,
  mobileColorLiterals,
  mobileColorTop: mobileColorTop.sort((a, b) => b[1] - a[1]),
  accentTextMisuse,
  accentTextTop,
  crossFileDupGroups: sameEndDups.length - crossFileDupContract,   // M-05：契约对豁免出棘轮，只剩欠账组
  crossFileDupContract,
  crossEndDupGroups: crossEndDups.length,
  crossFilePairTotal: dupOwners.size,
  crossFileDupTop,   // M-05：全清单（不再 slice）；每项 = [key, 文件数, 文件列表, 分类]
  shadowedDecls,
  shadowedSites,
  motionGuard: { hits: motionHits.length, sites: motionHits, baseline: MOTION_BASELINE },
  inlineStyleGuard: { sites: inlineStyleSites, baseline: INLINE_STYLE_BASELINE, staticVisual: inlineStyleStaticVisual.length, staticVisualSites: inlineStyleStaticVisual },
  baseline: BASELINE,
};

if (desktopColorLiterals) process.exitCode = 1;
if (d.imp > BASELINE.desktopImportant) process.exitCode = 1;
if (importantUnknown.length) process.exitCode = 1;          // 清单外的 !important：直接失败（Q2）
if (mobileImportant > BASELINE.mobileImportant) process.exitCode = 1;
if (mobileColorLiterals > BASELINE.mobileColorLiterals) process.exitCode = 1;
if (accentTextMisuse > BASELINE.accentTextMisuse) process.exitCode = 1;
if (sameEndDups.length - crossFileDupContract > BASELINE.crossFileDupGroups) process.exitCode = 1;   // M-05：契约对不进棘轮
if (motionHits.length > MOTION_BASELINE) process.exitCode = 1;   // M-03：动效用法（基线只许降）
if (inlineStyleStaticVisual.length) process.exitCode = 1;         // M-04：静态视觉属性进 style={{}} 即报
if (inlineStyleSites > INLINE_STYLE_BASELINE) process.exitCode = 1;   // M-04：style={{}} 计数棘轮
if (shadowedDecls > BASELINE.shadowedDecls) process.exitCode = 1;   // Q1：往 legacy 写会被上层压掉的声明：直接失败
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
  console.log('  !important          ', r.desktop.important, ' / 允许清单', r.complianceGuard.baseline.desktopImportant, '条（逐条有理由；清单外新增直接失败）');
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
  console.log('  桌面 !important        ', g.desktopImportant, ' / 允许清单', g.baseline.desktopImportant, '条（逐条有理由；清单外新增直接失败）');
  if (g.importantUnknown.length) console.log('     ✗ 清单外的 !important:', g.importantUnknown.map((s) => s.file + ' ' + s.sel + ' {' + s.prop + '}').join('  '));
  if (g.importantStale.length) console.log('     ⚠ 清单里但已找不到（请同步删表项）:', g.importantStale.map((s) => s.file + ' ' + s.prop).join('  '));
  console.log('  移动端 !important      ', g.mobileImportant, ' / 基线', g.baseline.mobileImportant, '（只许降）');
  console.log('  移动端颜色字面量(非主题)', g.mobileColorLiterals, ' / 基线', g.baseline.mobileColorLiterals);
  console.log('     top:', g.mobileColorTop.map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('  文字色误用裸 accent    ', g.accentTextMisuse, ' / 基线', g.baseline.accentTextMisuse, '（应改 --lake-accent-text）');
  console.log('     top:', g.accentTextTop.slice(0, 6).map(([f, n]) => f + '(' + n + ')').join('  ') || '（无）');
  console.log('  跨文件重复(选择器,属性)', g.crossFileDupGroups, ' / 基线', g.baseline.crossFileDupGroups, '（欠账组；契约对', g.crossFileDupContract, '组已豁免；全部对', g.crossFilePairTotal + '）');
  for (const [k, n, files, cls] of g.crossFileDupTop) console.log('     [' + cls + '] ' + k + ' ×' + n + '  ' + files.join(','));
  console.log('  被上层压掉的声明  ', g.shadowedDecls, ' / 基线', g.baseline.shadowedDecls, '（只许降；新增直接失败）');
  console.log('  动效用法（M-03）  ', g.motionGuard.hits, ' / 基线', g.motionGuard.baseline, '（ms 字面量 / 装饰性过渡；只许降）');
  for (const s of g.motionGuard.sites) console.log('     ✗ ' + s.file + ' ' + s.sel + ' {' + s.prop + '} ' + s.why + '：' + s.value);
  console.log('  内联 style（M-04）', g.inlineStyleGuard.sites, ' / 基线', g.inlineStyleGuard.baseline, '（计数棘轮）；静态视觉属性', g.inlineStyleGuard.staticVisual, '（即报）');
  for (const s of g.inlineStyleGuard.staticVisualSites.slice(0, 6)) console.log('     ✗ ' + s);
  if (g.shadowedDecls > g.baseline.shadowedDecls) console.log('     ✗ 超基线的被压声明:', g.shadowedSites.slice(0, 8).map((x) => x.file + ' ' + x.sel + ' {' + x.prop + '} ← ' + x.winnerFile).join('  '));
}