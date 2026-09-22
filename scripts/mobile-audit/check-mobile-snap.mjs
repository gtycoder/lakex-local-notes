// 移动端整页计算值快照门禁：生成当前快照 → 与已提交的紧凑基线比对 → 有差异 exit 1。
//
// 用法：node scripts/mobile-audit/check-mobile-snap.mjs [--port 9335] [--tag mob-after] [--states a,b] [--from <snap.json>] [--write-baseline]
// 前置（见 scripts/mobile-audit/README.md）：模拟器 + emu-cdp 转发到 9335。
//   浏览器预览**跑不起来**（移动端启动依赖 Capacitor 原生 SQLite）⇒ 必须模拟器。
// 基线只存"每态元素数 + 全态合并哈希"（几 KB，可入 git）；详细快照留在 .css-audit/。
// 去抖：首次比对有差异时自动重跑一遍，只有两轮都差异才判失败（对齐桌面版）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASELINE = path.join(HERE, "baseline", "mobile-snap.json");
const DRIVE = path.join(ROOT, "scripts/css-audit/drive.mjs");
const SNAP = path.join(HERE, "mobile-snap.mjs");
const SEP = String.fromCharCode(1);
const NL = String.fromCharCode(10);

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const PORT = Number(argOf("--port", process.env.LAKE_MOBILE_CDP_PORT || "9335"));
const TAG = argOf("--tag", "mob-after");
const STATES = argOf("--states", null);
const FROM = argOf("--from", null);
const WRITE = process.argv.includes("--write-baseline");

const fold = (rows) => {
  let h = 5381;
  for (const row of rows) {
    const s = row[0] + SEP + row[1];
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
};
const compact = (snap) => {
  const states = {};
  for (const name of Object.keys(snap.states)) states[name] = { n: snap.states[name].n, hash: fold(snap.states[name].rows) };
  return { states };
};
const aliveCheck = async () => {
  try {
    const res = await fetch("http://127.0.0.1:" + PORT + "/json/list", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error("http " + res.status);
  } catch (e) {
    console.error("[mgate] 移动端 CDP :" + PORT + " 不健康：" + e.message);
    console.error("       先跑 scripts/mobile-audit/README.md 里的三步（emu-up → android-build --install → emu-cdp）。");
    process.exit(2);
  }
};
const snapshot = (tag) => {
  const driveArgs = [DRIVE, String(PORT), SNAP, tag];
  if (STATES) driveArgs.push(STATES);
  const r = spawnSync(process.execPath, driveArgs, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
  return compact(JSON.parse(fs.readFileSync(path.join(ROOT, ".css-audit", "snap", tag + ".json"), "utf8")));
};
// 已知不稳定态（显式点名、不静默）：目前为空 —— 6 态在两轮独立运行中 0 差异。
const UNSTABLE = new Set([]);
const diffStates = (base, cur) => {
  const names = [...new Set([...Object.keys(base.states), ...Object.keys(cur.states)])].sort();
  const diffs = new Map();
  const skipped = [];
  for (const name of names) {
    if (UNSTABLE.has(name)) { skipped.push(name); continue; }
    const a = base.states[name];
    const b = cur.states[name];
    if (!a) { diffs.set(name, name + ": 基线缺失（新增状态）"); continue; }
    if (!b) { diffs.set(name, name + ": 本次未采集"); continue; }
    if (a.n !== b.n || a.hash !== b.hash) diffs.set(name, name + ": 元素 " + a.n + " → " + b.n + " | 指纹 " + a.hash + " → " + b.hash);
  }
  return { names, diffs, skipped };
};

let current;
if (FROM) {
  current = compact(JSON.parse(fs.readFileSync(path.resolve(ROOT, FROM), "utf8")));
} else {
  await aliveCheck();
  current = snapshot(TAG);
}

if (WRITE) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 1) + NL);
  console.log("[mgate] 基线已写入 " + path.relative(ROOT, BASELINE) + "（" + Object.keys(current.states).length + " 态）");
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) { console.error("[mgate] 基线不存在：" + path.relative(ROOT, BASELINE) + "；先跑 --write-baseline。"); process.exit(2); }
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
let { names, diffs, skipped } = diffStates(base, current);
let flaky = [];
if (diffs.size && !FROM) {
  console.error("[mgate] 首次比对有差异（" + diffs.size + "/" + names.length + " 态），重跑一遍排除装置抖动：");
  for (const line of diffs.values()) console.error("  " + line);
  current = snapshot(TAG + "2");
  const second = diffStates(base, current);
  flaky = [...diffs.keys()].filter((k) => !second.diffs.has(k));
  diffs = second.diffs;
}
if (diffs.size) {
  console.error("[mgate] 快照有差异（" + diffs.size + "/" + names.length + " 态，两轮一致 ⇒ 真差异）：");
  for (const line of diffs.values()) console.error("  " + line);
  process.exit(1);
}
console.log("[mgate] " + (names.length - skipped.length) + " 态整页计算值 0 差异（对比 " + path.relative(ROOT, BASELINE) + "）"
  + (skipped.length ? "；跳过 " + skipped.length + " 态：" + skipped.join(", ") : "")
  + (flaky.length ? "；flaky（仅一轮出现，已重跑排除）：" + flaky.join(", ") : ""));
