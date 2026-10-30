// 快照门禁的共享执行器（261030 抽出）：生成快照 → 与已提交基线比对 → 有差异 exit 1。
//
// 6 态整页快照（mobile-snap）与多维表专项快照（mobile-bitable-snap）共用这一份「取快照 / 折叠 / 去抖重跑 / 比对」
// 逻辑，避免两套装置漂移（口径与阈值原样来自原 check-mobile-snap.mjs）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const DRIVE = path.join(ROOT, "scripts/css-audit/drive.mjs");
const SEP = String.fromCharCode(1);

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

const aliveCheck = async (port, label) => {
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error("http " + res.status);
  } catch (e) {
    console.error("[" + label + "] 移动端 CDP :" + port + " 不健康：" + e.message);
    console.error("       先跑 scripts/mobile-audit/README.md 里的三步（emu-up → android-build --install → emu-cdp）。");
    process.exit(2);
  }
};

const diffStates = (base, cur, unstable) => {
  const names = [...new Set([...Object.keys(base.states), ...Object.keys(cur.states)])].sort();
  const diffs = new Map();
  const skipped = [];
  for (const name of names) {
    if (unstable.has(name)) { skipped.push(name); continue; }
    const a = base.states[name];
    const b = cur.states[name];
    if (!a) { diffs.set(name, name + ": 基线缺失（新增状态）"); continue; }
    if (!b) { diffs.set(name, name + ": 本次未采集"); continue; }
    if (a.n !== b.n || a.hash !== b.hash) diffs.set(name, name + ": 元素 " + a.n + " → " + b.n + " | 指纹 " + a.hash + " → " + b.hash);
  }
  return { names, diffs, skipped };
};

/**
 * 跑一套快照门禁。
 * @param {object} opts
 * @param {string} opts.snapScript 快照脚本文件名（scripts/mobile-audit/ 下）
 * @param {string} opts.baselineName 基线文件名（scripts/mobile-audit/baseline/ 下）
 * @param {number} opts.portDefault 默认 CDP 端口
 * @param {string} opts.tagDefault 默认快照 tag
 * @param {string} opts.label 日志前缀
 * @param {boolean} [opts.passStates] 是否把 --states 透传给快照脚本
 * @param {string[]} [opts.unstable] 已知不稳定态（显式点名）
 */
export async function runSnapGate({ snapScript, baselineName, portDefault, tagDefault, label, passStates = false, unstable = [] }) {
  const BASELINE = path.join(HERE, "baseline", baselineName);
  const SNAP = path.join(HERE, snapScript);
  const argOf = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
  };
  const PORT = Number(argOf("--port", process.env.LAKE_MOBILE_CDP_PORT || String(portDefault)));
  const TAG = argOf("--tag", tagDefault);
  const STATES = passStates ? argOf("--states", null) : null;
  const FROM = argOf("--from", null);
  const WRITE = process.argv.includes("--write-baseline");

  const snapshot = (tag) => {
    const driveArgs = [DRIVE, String(PORT), SNAP, tag];
    if (STATES) driveArgs.push(STATES);
    const r = spawnSync(process.execPath, driveArgs, { stdio: "inherit", cwd: ROOT });
    if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
    return compact(JSON.parse(fs.readFileSync(path.join(ROOT, ".css-audit", "snap", tag + ".json"), "utf8")));
  };

  let current;
  if (FROM) current = compact(JSON.parse(fs.readFileSync(path.resolve(ROOT, FROM), "utf8")));
  else { await aliveCheck(PORT, label); current = snapshot(TAG); }

  if (WRITE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(current, null, 1) + String.fromCharCode(10));
    console.log("[" + label + "] 基线已写入 " + path.relative(ROOT, BASELINE) + "（" + Object.keys(current.states).length + " 态）");
    process.exit(0);
  }
  if (!fs.existsSync(BASELINE)) { console.error("[" + label + "] 基线不存在：" + path.relative(ROOT, BASELINE) + "；先跑 --write-baseline。"); process.exit(2); }
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const unstableSet = new Set(unstable);
  let { names, diffs, skipped } = diffStates(base, current, unstableSet);
  let flaky = [];
  if (diffs.size && !FROM) {
    console.error("[" + label + "] 首次比对有差异（" + diffs.size + "/" + names.length + " 态），重跑一遍排除装置抖动：");
    for (const line of diffs.values()) console.error("  " + line);
    current = snapshot(TAG + "2");
    const second = diffStates(base, current, unstableSet);
    flaky = [...diffs.keys()].filter((k) => !second.diffs.has(k));
    diffs = second.diffs;
  }
  if (diffs.size) {
    console.error("[" + label + "] 快照有差异（" + diffs.size + "/" + names.length + " 态，两轮一致 ⇒ 真差异）：");
    for (const line of diffs.values()) console.error("  " + line);
    process.exit(1);
  }
  console.log("[" + label + "] " + (names.length - skipped.length) + " 态整页计算值 0 差异（对比 " + path.relative(ROOT, BASELINE) + "）"
    + (skipped.length ? "；跳过 " + skipped.length + " 态：" + skipped.join(", ") : "")
    + (flaky.length ? "；flaky（仅一轮出现，已重跑排除）：" + flaky.join(", ") : ""));
}
