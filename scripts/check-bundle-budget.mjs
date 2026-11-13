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
  // 261103 P12：桌面内核 lazy 后入口 app-js 从 1.91MB → ~150KB gz ⇒ 预算从 2.9MB 收紧到 300KB。
  { name: "app-js", file: entry(/assets\/(index-[\w.-]+\.js)/, "app-js"), gzip: 300 * 1024 },
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

// ── 移动端首屏预算（MOB-15）──────────────────────────────────────────────
// 目标值（拆包/减重后应达到）：入口 modulepreload ≤ 12 条、入口 JS gzip ≤ 80KB、入口 CSS gzip ≤ 120KB。
// 当前基线（261028 收盘实测）：23 条 / 69KB / 137KB。为了「现状不回归」先把 preload 与 CSS 预算
// 定在实测值；JS 已在目标值以内，直接用目标值。后续首屏瘦身完成后再把前两项收紧到目标值。
// 21 条那份实测早于后续轮次：reportMobileActionError / nativeErrors / toastBus（动作失败可观测 +
// 首屏 toast/错误文案，均在入口图里）和 core/textStats（bridge 读正文统计）后来进入入口预加载。
// 本批已把 SearchSheet 改按需加载（-1 条 report 依赖链），净额仍到 23 ⇒ 预算随实测更新为 23；
// 这是「把过期护栏对齐现状」，不是放宽目标：目标仍是 ≤12，首屏瘦身时再收紧。
//
// 261103 P9-1：bridge/sync 的 v3 重依赖改按需后，rolldown 把 entry 与懒 chunk **共享**的模块
// （historyRepository 33.3KB gz / s3Store / syncUtils / storeUtils / assetUrl / nativeAssetSync /
// colorPalette / syncDecisions）提升成共享入口 chunk ⇒ preload 条数 20 → 28，但**字节反而降了**
// （首屏 392,977 → 366,792B gz，-26.2KB；真正的字节预算在 check-arch）。故条数预算随实测更新为 30：
// 条数只防「又有一坨静态依赖回到入口」，字节由 check-arch 守；不要因这个数回退 P9-1 的懒加载。
// 只做护栏，不改构建；dist-mobile 不存在（没跑移动构建）时跳过并提示。
// 261107：本批改动前的 HEAD 实测已是 33 条 / 65,460B gz（不是本批引入；历史批次未跑 check:bundle）。
// 先按现状冻结为防回归护栏（目标仍是 ≤12 条），把「移动端入口瘦身」记入 HANDOFF 待办，下一次专门做时收紧。
//
// 261111 移动端首屏瘦身（专项，已完成）：入口静态图砍掉非首屏必需项（便携包编排 / Markdown 与 PDF 分享
// 导入 / 更新中心自动检查 / 粘贴拦截器 / 图标选择器表情数据表 / 原生调试契约），再用 vite.mobile.config.ts
// 的 codeSplitting groups 把「entry 与懒 chunk 共享」的碎片块收敛成 3 个域块（bridge-data / 图标 / 轻量 UI）。
// 实测：**preload 47 → 6 条**、**入口 JS 61,148 → 59,638B gz**、首屏 393,720 → 347,809B gz。
// ⇒ 三条预算按目标值收口（preload 目标 ≤12、入口 JS 目标 ≤60KB），并留出实测余量：
//    preload 6（预算 12，+6 条余量）/ JS 59,638B（预算 61,440B，+1,802B 余量）。
// 真入口字节的第一道护栏仍是 check-arch 首屏资源图（347,809 / 360,000B）。
const MOBILE_ENTRY_PRELOAD_BUDGET = 12;
// 261103 P10：设置抽屉改按需后入口 79,032 → 53,496B gz ⇒ 预算从 80KB 收紧到 60KB。
// 261111：达标后维持 60KB 目标值（实测 59,638B）。
// 261114（入口瘦身第二批）：把「点击才出现」的四个浮层（ImageLightbox / AttachmentPreview /
// CreateNotebookSheet / DefaultNotebookPickerSheet）+ 非首 tab 的标签页与知识库网格（TagsHomeTab /
// NotebookGrid）改成 lazy；实测入口 61,006 → **48,759B gz**（首屏 353,397 → 341,652）⇒ 按目标收口到
// 50KB，留 2,441B 余量（preload 10 / 预算 12；入口 CSS 139,210 / 138KB 上限不变）。
const MOBILE_ENTRY_JS_GZIP_BUDGET = 50 * 1024;
// 入口 CSS 不在本轮目标内（首屏 ≤360KB 由 check-arch 守）；维持 261103 的现状冻结值。
const MOBILE_ENTRY_CSS_GZIP_BUDGET = 138 * 1024;

const mobileHtml = path.resolve("dist-mobile/index.html");
if (!fs.existsSync(mobileHtml)) {
  console.log("dist-mobile 不存在，跳过移动端首屏预算检查（先跑 npx vite build -c vite.mobile.config.ts）");
} else {
  const mobileDist = path.resolve("dist-mobile/assets");
  const html = fs.readFileSync(mobileHtml, "utf8");
  // 必须从 <script src> / <link rel=stylesheet href> 取真入口：assets 里还存在按模块名命名的
  // index-*.js 懒 chunk（261028 实测），按文件名猜会挑错文件、等于在给错的文件设预算。
  const mobileEntry = (re, label) => {
    const m = html.match(re);
    if (!m) throw new Error(`dist-mobile/index.html 未引用入口 ${label}`);
    return path.basename(m[1]);
  };
  const preloadCount = (html.match(/<link[^>]+rel="modulepreload"/g) ?? []).length;
  const mobileBudgets = [
    { name: "mobile-entry-js", file: mobileEntry(/<script\b[^>]*\bsrc="([^"]+\.js)"/, "mobile-entry-js"), gzip: MOBILE_ENTRY_JS_GZIP_BUDGET },
    { name: "mobile-entry-css", file: mobileEntry(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+\.css)"/, "mobile-entry-css"), gzip: MOBILE_ENTRY_CSS_GZIP_BUDGET },
  ];
  console.log(`mobile-entry-preload: ${preloadCount} links budget=${MOBILE_ENTRY_PRELOAD_BUDGET}（目标 ≤12）`);
  if (preloadCount > MOBILE_ENTRY_PRELOAD_BUDGET) {
    failed = true;
    console.error("Budget exceeded: mobile-entry-preload");
  }
  for (const budget of mobileBudgets) {
    const bytes = fs.readFileSync(path.join(mobileDist, budget.file));
    const gzip = zlib.gzipSync(bytes, { level: 9 }).length;
    console.log(`${budget.name}: ${budget.file} raw=${bytes.length} gzip=${gzip} budget=${budget.gzip}`);
    if (gzip > budget.gzip) { failed = true; console.error(`Budget exceeded: ${budget.name}`); }
  }
}

if (failed) process.exitCode = 1;
