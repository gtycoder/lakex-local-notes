#!/usr/bin/env node
/**
 * 移动端 UI 独立性门禁（P7，261012）—— 一条命令跑完移动端样式/独立性的全部判据。
 *
 * 判据（都是「基线只许降」型，规格见 docs/MOBILE-DESIGN.md §8 与 docs/MOBILE-TECH-STACK.md §九）：
 *   ① src/mobile/mobileIndependence.test.ts —— 桌面样式 import 白名单 / 桌面类名 token=0 /
 *      反向耦合=0 / 不得 import 桌面 UI 组件件 / 不得 import 桌面 themes
 *   ② src/mobile/mobileLayers.test.ts —— 移动端每个样式文件的声明数与重复组基线 + 无野样式文件
 *   ③ src/mobile/kernelStyleBootstrap.test.ts —— 挂内核的懒入口必须自带内核样式
 *   ④ scripts/ui-metrics.mjs —— 颜色/字号字面量与 !important 硬指标（两端共用，含移动端 CSS）
 *
 * 用法：npm run check:mobileui   （CI 与本地合并前都跑；设备级验收另跑 check:mobilesnap）
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, label) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error("\n[check:mobileui] ✗ " + label + " 未通过（exit " + r.status + "）");
    process.exit(r.status || 1);
  }
  console.log("[check:mobileui] ✓ " + label);
};

run("npx", ["vitest", "run", "src/mobile/mobileIndependence.test.ts", "src/mobile/mobileLayers.test.ts", "src/mobile/kernelStyleBootstrap.test.ts"], "移动端独立性/层护栏");
run("node", ["scripts/ui-metrics.mjs"], "UI 硬指标（ui-metrics）");
console.log("\n[check:mobileui] 全部通过。设备级验收：npm run check:mobilesnap + scripts/css-audit/mobile-walkthrough.mjs");
