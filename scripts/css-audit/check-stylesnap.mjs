// 整页计算值快照门禁（stylesnap 的"可执行版"）：生成当前快照 → 与已提交的紧凑基线比对 → 有差异 exit 1。
//
// 用法：
//   node scripts/css-audit/check-stylesnap.mjs [--port 9231] [--tag after] [--states a,b,c] [--from <snap.json>] [--write-baseline]
//
// 前置（缺一不可，实测配方见 scripts/css-audit/README.md）：
//   ① 全新同构实例（独立 LAKE_USER_DATA）+ 独立 CDP 端口；② 装置已自证（两个全新实例同条件 0 差异）。
// 基线只存"每态元素数 + 全态合并哈希"（几 KB，可入 git）；详细快照留在 .css-audit/（gitignored）供定位。
//
// 去抖：内核原生大纲（ne-normal-toc vs ne-small-toc）在窄窗下是 hover/resize 时序态，偶发会翻 →
// 首次比对有差异时【自动重跑一遍】，只有【两轮都差异】才判失败；只在一轮出现的记为 flaky（点名、不判失败）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASELINE = path.join(HERE, "baseline", "stylesnap.json");
const SEP = String.fromCharCode(1);
const NL = String.fromCharCode(10);

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const PORT = Number(argOf("--port", process.env.LAKE_CDP_PORT || "9231"));
const TAG = argOf("--tag", "after");
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
    console.error("[gate] CDP :" + PORT + " 不健康：" + e.message);
    console.error("       请先起一个【全新同构实例】（独立 LAKE_USER_DATA + 独立 CDP 端口），不要复用被反复 reload 的实例。");
    process.exit(2);
  }
};
const snapshot = (tag) => {
  const driveArgs = [path.join(HERE, "drive.mjs"), String(PORT), path.join(HERE, "stylesnap.mjs"), tag];
  if (STATES) driveArgs.push(STATES);
  const r = spawnSync(process.execPath, driveArgs, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
  return compact(JSON.parse(fs.readFileSync(path.join(ROOT, ".css-audit", "snap", tag + ".json"), "utf8")));
};
// 窄窗（560/760）装置不稳定：内核原生大纲的展开/收起是 hover/resize 时序态，**跨"实例世代"漂移** ——
// 实测：同一份代码 + 全新同构实例，在不同时间捕获，560/760 的 6 个态系统性不同（且回滚实验已排除"删 reset 层"这个嫌疑），
// 而 1315 宽度的态全部稳定。处理：**严格比对只覆盖 1315 宽的态**；窄窗态照常采集/入库（基线保留），比对时跳过并点名。
// TODO：一旦在 stylesnap 的 pin() 里钉死内核原生 TOC 态，删掉此排除、恢复全量严格比对。
const UNSTABLE = /:(?:560|760):/;
/** 261013 实测：下列 1315 宽态**跨轮/跨实例不确定**（同一实例连采两轮即翻；5 轮并集 = 17/34 态）。
 *  翻转**恒为 314 个「无 id、无 class 的 SVG 图元（rect/g/path）」的指纹**，元素数不变 ——
 *  315 个翻转 key 里 314 个是这类图元，只有 1 个是 div.list-heading（见下 SNAP 里 snapExpr 的同类排除：内核 u<hex> id）。
 *  证据：.css-audit/snap/{s1,s2,after,after2,base}.json 两两对拍 + snapdiff（本机 load 4–7，疑与图标加载时序有关）。
 *  ⚠️ **正确处理不是继续加名单**，而是在 snapExpr 里直接剔除「无 id 无 class 的 SVG 图元」再整份重烤 ——
 *  但那份表达式两端共用 ⇒ 会同时打红移动端基线，需单独立一批（含移动端重烤）。
 *  在那之前：这些态照常采集入库（基线保留），只跳过严格比对，与窄窗态同一处理。
 *  TODO：做完上面那条就删掉这份名单、恢复全量比对。 */
const UNSTABLE_1315 = new Set([
  "plain:1315:dark", "drag:1315:light", "drag:1315:dark", "menus:1315:light", "search:1315:light",
  "settings:1315:light", "resources:1315:light", "hover-card:1315:light", "outline-open:1315:light",
  "quicknotes:1315:light", "hover-row:1315:warm", "menus:1315:warm", "search:1315:warm", "rm:1315:light",
  "rt:1315:light", "board:1315:light", "board:1315:dark",
]);
const unstable = (name) => UNSTABLE.test(name) || UNSTABLE_1315.has(name);
/** 带了 --states 就是"只验这几个态"：没采的态不在作用域内，不能报成差异
 *  （态自包含之后，改一处界面只需验 1~2 态；见 README「快照重烤的快速路径」）。 */
const SCOPED = Boolean(STATES);
const diffStates = (base, cur) => {
  const names = [...new Set([...Object.keys(base.states), ...Object.keys(cur.states)])].sort();
  const diffs = new Map();
  const skipped = [];
  for (const name of names) {
    if (unstable(name)) { skipped.push(name); continue; }
    const a = base.states[name];
    const b = cur.states[name];
    if (!a) { diffs.set(name, name + ": 基线缺失（新增状态）"); continue; }
    if (!b) { if (SCOPED) continue; diffs.set(name, name + ": 本次未采集"); continue; }
    if (a.n !== b.n || a.hash !== b.hash) diffs.set(name, name + ": 元素 " + a.n + " → " + b.n + " | 指纹 " + a.hash + " → " + b.hash);
  }
  return { names, diffs, skipped };
};

let current;
let currentTag = TAG;
if (FROM) {
  current = compact(JSON.parse(fs.readFileSync(path.resolve(ROOT, FROM), "utf8")));
} else {
  await aliveCheck();
  current = snapshot(TAG);
}

if (WRITE) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 1) + NL);
  console.log("[gate] 基线已写入 " + path.relative(ROOT, BASELINE) + "（" + Object.keys(current.states).length + " 态，来源 " + (FROM || currentTag) + "）");
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error("[gate] 基线不存在：" + path.relative(ROOT, BASELINE) + "；先跑一次 --write-baseline。");
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
let { names, diffs, skipped } = diffStates(base, current);
let flaky = [];

if (diffs.size && !FROM) {
  console.error("[gate] 首次比对有差异（" + diffs.size + "/" + names.length + " 态），重跑一遍排除装置抖动：");
  for (const line of diffs.values()) console.error("  " + line);
  current = snapshot(TAG + "2");
  const second = diffStates(base, current);
  flaky = [...diffs.keys()].filter((k) => !second.diffs.has(k));
  diffs = second.diffs;
}

if (diffs.size) {
  console.error("[gate] 快照有差异（" + diffs.size + "/" + names.length + " 态，两轮一致 ⇒ 真差异）：");
  for (const line of diffs.values()) console.error("  " + line);
  console.error("  定位：VERBOSE=1 node scripts/css-audit/snapdiff.mjs <基线快照> .css-audit/snap/" + (FROM ? path.basename(FROM) : TAG) + ".json");
  process.exit(1);
}
console.log("[gate] " + (SCOPED ? Object.keys(current.states).length + " 态（--states 指定）" : (names.length - skipped.length) + " 态") + "整页计算值 0 差异（对比 " + path.relative(ROOT, BASELINE) + "）"
  + (skipped.length ? "；跳过 " + skipped.length + " 态（窄窗 + 261013 实测的抖动 1315 态，见脚本头 UNSTABLE_1315 的 TODO）：" + skipped.join(", ") : "")
  + (flaky.length ? "；flaky（仅一轮出现，已重跑排除）：" + flaky.join(", ") : ""));
