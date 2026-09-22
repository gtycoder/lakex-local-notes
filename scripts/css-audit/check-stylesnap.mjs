// 整页计算值快照门禁（stylesnap 的"可执行版"）：生成当前快照 → 与已提交的紧凑基线比对 → 有差异 exit 1。
//
// 用法：
//   node scripts/css-audit/check-stylesnap.mjs [--port 9231] [--tag after] [--states a,b,c] [--from <snap.json>] [--write-baseline]
//
// 前置（缺一不可，实测配方见 docs/UI-REDESIGN-OPTIMIZATION-PLAN-260923.md §3 第 7 条）：
//   ① 全新同构实例（独立 LAKE_USER_DATA）+ 独立 CDP 端口；② 装置已自证（两个全新实例同条件 0 差异）。
// 基线只存"每态元素数 + 全态合并哈希"（几 KB，可入 git）；详细快照留在 .css-audit/（gitignored）供定位。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASELINE = path.join(HERE, "baseline", "stylesnap.json");
const SEP = String.fromCharCode(1);

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const PORT = Number(argOf("--port", process.env.LAKE_CDP_PORT || "9231"));
const TAG = argOf("--tag", "after");
const STATES = argOf("--states", null);
const FROM = argOf("--from", null);
const WRITE = process.argv.includes("--write-baseline");

const compact = (snap) => {
  const fold = (rows) => {
    let h = 5381;
    for (const row of rows) {
      const s = row[0] + SEP + row[1];
      for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  };
  const states = {};
  for (const name of Object.keys(snap.states)) states[name] = { n: snap.states[name].n, hash: fold(snap.states[name].rows) };
  return { states };
};

let snapPath;
if (FROM) {
  snapPath = path.resolve(ROOT, FROM);
} else {
  // ① 存活检查：门禁必须跑在健康实例上（死实例会 ECONNREFUSED，极容易被误读成脚本失败）
  try {
    const res = await fetch("http://127.0.0.1:" + PORT + "/json/list", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error("http " + res.status);
  } catch (e) {
    console.error("[gate] CDP :" + PORT + " 不健康：" + e.message);
    console.error("       请先起一个【全新同构实例】（独立 LAKE_USER_DATA + 独立 CDP 端口），不要复用被反复 reload 的实例。");
    process.exit(2);
  }
  // ② 生成快照
  const driveArgs = [path.join(HERE, "drive.mjs"), String(PORT), path.join(HERE, "stylesnap.mjs"), TAG];
  if (STATES) driveArgs.push(STATES);
  const r = spawnSync(process.execPath, driveArgs, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
  snapPath = path.join(ROOT, ".css-audit", "snap", TAG + ".json");
}

const current = compact(JSON.parse(fs.readFileSync(snapPath, "utf8")));

if (WRITE) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 1) + String.fromCharCode(10));
  console.log("[gate] 基线已写入 " + path.relative(ROOT, BASELINE) + "（" + Object.keys(current.states).length + " 态，来源 " + path.relative(ROOT, snapPath) + "）");
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error("[gate] 基线不存在：" + path.relative(ROOT, BASELINE) + "；先跑一次 --write-baseline。");
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
// 已知装置噪声（**非产品差异**；显式点名、不静默）：内核原生大纲的"展开/收起"是 hover/resize 时序驱动的运行时态，
// 不在 localStorage、pin() 管不到 ⇒ 跨实例不保证一致（实测 rm:760:light：ne-normal-toc-sidebar vs ne-small-toc-sidebar，
// 连带 26 条衍生差异）。TODO：在 stylesnap 的 pin() 里钉死内核原生 TOC 态后删掉本条。
const KNOWN_FLAKY = new Set(["rm:760:light"]);
const names = [...new Set([...Object.keys(base.states), ...Object.keys(current.states)])].sort();
const bad = [];
const skipped = [];
for (const name of names) {
  if (KNOWN_FLAKY.has(name)) { skipped.push(name); continue; }
  const a = base.states[name];
  const b = current.states[name];
  if (!a) { bad.push(name + ": 基线缺失（新增状态）"); continue; }
  if (!b) { bad.push(name + ": 本次未采集"); continue; }
  if (a.n !== b.n || a.hash !== b.hash) bad.push(name + ": 元素 " + a.n + " → " + b.n + " | 指纹 " + a.hash + " → " + b.hash);
}
if (bad.length) {
  console.error("[gate] 快照有差异（" + bad.length + "/" + names.length + " 态）：");
  for (const line of bad) console.error("  " + line);
  console.error("  定位：VERBOSE=1 node scripts/css-audit/snapdiff.mjs <基线快照> " + path.relative(ROOT, snapPath));
  process.exit(1);
}
console.log("[gate] " + (names.length - skipped.length) + " 态整页计算值 0 差异（对比 " + path.relative(ROOT, BASELINE) + "）" + (skipped.length ? "；跳过 " + skipped.length + " 态已知装置噪声：" + skipped.join(", ") : ""));
