#!/usr/bin/env node
/**
 * 未分层「全局 reset」护栏（261021 事故）。
 *
 * 背景：桌面样式全部在 @layer 里；**未分层普通声明压过所有分层声明**。
 * 只要某个 chunk 把第三方/全局 CSS 以 JS import 的身份带进文档（Vite 会把它产出为独立、
 * 不带 @layer 的 chunk CSS），antd/kernel 的 base 就会改写我们的按钮/输入框/字体 ——
 * 261021 的现场是设置面板关闭钮 × 从右上角跑到标题后面、全站字体从 MiSans 变系统栈。
 *
 * 判据（只认构建产物，不认源码怎么写；源码侧另有 src/styles/cssLayers.test.ts）：
 *   ① dist/assets/*.css 里出现「未分层 + 裸标签选择器 + reset 类属性」的规则；
 *   ② 内核 antd banner 出现在一个完全没有 @layer 的 CSS 文件里。
 * 扫描实现与 dev 运行时探针共用 src/lib/cssLayerScan.ts（Node 24 直接 import .ts）——
 * 判据只写一份，避免"产物守得住、dev 探针却是另一套口径"。
 * 用法：node scripts/css-audit/audit-vendor-css.mjs（npm run check:bundle 已串联）
 */
import fs from "node:fs";
import path from "node:path";
import { scanUnlayeredGlobalRules as scanUnlayeredGlobal } from "../../src/lib/cssLayerScan.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ASSETS = path.join(ROOT, "dist", "assets");


if (!fs.existsSync(ASSETS)) {
  console.error("[audit-vendor-css] dist/assets 不存在 —— 先跑一次 npx vite build（本检查只认构建产物）");
  process.exit(1);
}

const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith(".css"));
const problems = [];
for (const file of files) {
  const css = fs.readFileSync(path.join(ASSETS, file), "utf8");
  const hits = scanUnlayeredGlobal(css);
  if (hits.length) {
    problems.push({ file, kind: "未分层全局 reset", detail: [...new Set(hits)].slice(0, 6) });
  }
  if (css.includes("antd v4.24.13") && !css.includes("@layer")) {
    problems.push({ file, kind: "内核 antd 样式整份未分层", detail: ["该文件没有任何 @layer ⇒ 会压过整个设计系统"] });
  }
}

if (problems.length) {
  console.error("[audit-vendor-css] 失败：发现未分层全局 CSS（会压过全部 @layer 规则）：");
  for (const p of problems) console.error(`  - ${p.file} · ${p.kind}: ${p.detail.join(" | ")}`);
  console.error("\n修法：第三方/全局 CSS 只能由 src/styles/index.css 以 @import ... layer(legacy) 引入；组件/懒 chunk 禁止 JS import 它。");
  process.exit(1);
}
console.log(`[audit-vendor-css] OK：${files.length} 个产物 CSS 文件均无未分层全局 reset`);
