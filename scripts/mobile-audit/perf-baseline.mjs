#!/usr/bin/env node
/**
 * 移动端「流畅度」性能基线探针（261111，本地门禁用，**不进 CI**）。
 *
 * 为什么需要：261111 这轮靠一次性的设备 longtask 数据（写作态 775→72ms 等）判定"流畅了"，但数字只留在
 * HANDOFF 里 ⇒ 下次改动没有任何装置能复现/防回退。本脚本把「用户能感知的四条路径 + 键盘开合卡顿」做成
 * 可重复采集、可对比、超阈值 exit 1 的本地门禁（npm run check:perfmobile）。
 *
 * 量的东西（全部用页面自己的 Performance API / 真实 CDP 点按 + adb 起动，不写产品埋点）：
 *   · coldStartToHome       force-stop → am start → 真首页就绪（.mb-home-dock__item，不是骨架）
 *   · captureColdToInput    force-stop → 快捷入口深链（QuickNoteAlias + lakexlocalnotes://quick-note）→ 写作卡可输入
 *   · composerHotToInput    首页 FAB 点按 → 新建面板「空白小记」→ 写作卡可输入
 *   · keyboardOpenLongTasks  聚焦正文（真实点按 ⇒ 弹键盘）后 1.5s 内 >50ms 长任务的个数/总时长
 *   · keyboardCloseLongTasks 同窗口，用 adb shell input keyevent 4 收键盘
 *   · docOpenToContent（可选，--with-doc-open）  首页 → 知识库 → 笔记本 → 目录行 → 活动 pane 内核内容出现
 * 每项至少 3 轮，报告 p50 / 最坏值 / 全部样本；--record 写基线，--compare 与上次比、超阈值 exit 1。
 *
 * 前置（口径见 scripts/mobile-audit/README.md 与 docs/MOBILE-OPS.md）：
 *   1) 模拟器已起：bash scripts/emu-up.sh --no-window（**建议专用 AVD**，见下）
 *   2) App 已装且是 debug 构建（才有 WebView 调试）：bash scripts/android-build.sh --sync --install
 *   3) 一台设备或 ANDROID_SERIAL=<serial>（多设备时必填，否则 adb 报 more than one device）
 *   4) 脚本自己会按 App PID 重建 adb forward tcp:<port>（App 重启/重装后 socket 名会变，见 MOBILE-OPS §3）
 *   5) 本机 Node 24（内置 fetch/WebSocket）；ANDROID_SDK_ROOT 默认 /opt/homebrew/share/android-commandlinetools
 *
 * ⚠️ 基线绑定「这台设备 + 这个 App 构建 + 这份数据」：
 *   · 只看**相对回归**（与同实例 --record 的基线比）；换 AVD / 换数据 / 换了系统动画档位都要 **重烤基线**。
 *   · 推荐专用 AVD（如 lake_gate，不配 S3）：冷启动期间的后台同步/预热会污染数字；pm clear 后数据不同，
 *     首页文档卡/小记卡数量随之变化。本脚本会记录 env（serial/model/sdk/viewport/appVersion/cloudState），
 *     对比时环境不一致直接 exit 2（可用 --allow-env-mismatch 临时跳过）。
 *   · 模拟器冷启动噪声大（同一构建实测可差 ±100–300ms）⇒ 阈值 = 相对百分比 + 绝对余量双保险，且用 p50；
 *     **不要用单轮数字做结论**。真机与模拟器基线不可混用。
 *   · 长任务（longtask）本身只统计 >50ms 的条目；写作卡键盘开合在不同轮次天然抖动（HANDOFF 261111 实测收起
 *     0–4 个 / ≤326ms）⇒ 长任务按"p50 个数 + 绝对个数余量"和"p50 总时长 + 绝对毫秒余量"判，不看单轮。
 *
 * 用法（脚本自己会 force-stop/am start，**跑的时候别手动操作设备**）：
 *   node scripts/mobile-audit/perf-baseline.mjs                 # 采一轮，打印摘要（不写基线）
 *   node scripts/mobile-audit/perf-baseline.mjs --record        # 采一轮并写基线 .css-audit/perf/mobile-perf.json
 *   npm run check:perfmobile                                    # = --compare（与基线比，超阈值 exit 1）
 *   node scripts/mobile-audit/perf-baseline.mjs --json          # 只把完整 JSON 打到 stdout（日志走 stderr）
 *   node scripts/mobile-audit/perf-baseline.mjs --rounds 5 --only coldStart,captureCold,keyboard
 *   node scripts/mobile-audit/perf-baseline.mjs --self-check    # 不连设备：自检纯逻辑与配置（CI/无设备可用）
 *
 * 退出码：0 通过 / 1 指标超阈值（或装置异常超硬上限）/ 2 装置不可用（adb、包未装、CDP、环境与基线不一致、
 *         基线缺失）/ 3 设备动作失败（启动不起来、找不到首页/写作卡/文档入口）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connect } from "../css-audit/drive.mjs";
import { data } from "../css-audit/paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PROBE = "mobile-audit/perf-baseline";
const SCHEMA = 1;
const PKG = "com.lakexlocalnotes.android";
const MAIN_ACTIVITY = PKG + "/.MainActivity";
const CAPTURE_ACTIVITY = PKG + "/.QuickNoteAlias";
const CAPTURE_URL = "lakexlocalnotes://quick-note";
const DEFAULT_PORT = 9335;
const DEFAULT_ROUNDS = 3;
/** 长任务判定窗口（聚焦/收键盘各一个）：覆盖键盘动画 + 一次 React/内核重排，又不至于把后续懒活算进来。 */
const LONG_TASK_WINDOW_MS = 1500;
const LONG_TASK_MIN_MS = 50;
/** 冷启动/快捷冷启等页面的上限（装置卡死兜底，不是"回归"阈值）。 */
const COLD_TIMEOUT_MS = 30000;
const HOT_TIMEOUT_MS = 15000;
const DEFAULT_BASELINE = data("perf/mobile-perf.json");

/* ------------------------------------------------------------------ *
 * 阈值（相对回归 + 绝对余量；理由逐条写清楚，改阈值必须同时改这条注释）
 *
 * 判据统一：cur > base + max(base × 相对比例, 绝对余量) 才算回归 —— 取"两者较大"是为了同时压住
 * 小基线的绝对噪声（如 300ms 的写作卡热开，+25% 只有 75ms，不够一次模拟器抖动）和大基线的百分比漂移。
 * ------------------------------------------------------------------ */
const LIMITS = {
  coldStartToHome: {
    kind: "ms", definition: "force-stop → am start → 真首页就绪（.mb-home-dock__item）墙钟毫秒",
    p50Pct: 0.25, p50AbsMs: 200, worstPct: 0.6, worstAbsMs: 600, ceilingMs: 15000,
    why: "最用户可见；模拟器冷启动同构建噪声 ±100–300ms ⇒ p50 允许 +25% 或 +200ms（取大），最坏值 +60% 或 +600ms；硬上限只兜装置卡死。",
  },
  captureColdToInput: {
    kind: "ms", definition: "force-stop → 快捷入口深链（QuickNoteAlias）→ 写作卡可输入（可见 contenteditable）毫秒",
    p50Pct: 0.3, p50AbsMs: 250, worstPct: 0.7, worstAbsMs: 800, ceilingMs: 20000,
    why: "比普通冷启多一层深链路由 + 内核卡片挂载；HANDOFF 261111 记录冷/热写作卡≈同量级（~0.8–1.7s 保存链路），留 30% 余量。",
  },
  composerHotToInput: {
    kind: "ms", definition: "首页 FAB 点按 → 新建面板「空白小记」→ 写作卡可输入毫秒（含点按派发 ~10–30ms）",
    p50Pct: 0.35, p50AbsMs: 150, worstPct: 0.8, worstAbsMs: 500, ceilingMs: 15000,
    why: "热路径，基线通常 300ms 量级 ⇒ 百分比余量太小，用 +150ms 绝对余量兜模拟器抖动。",
  },
  keyboardOpenLongTasks: {
    kind: "longtask", definition: "聚焦正文（真实点按弹键盘）后 1500ms 内 >50ms 长任务的个数/总时长",
    countPct: 0.5, countAbs: 2, totalPct: 0.5, totalAbsMs: 100, ceilingCount: 20, ceilingTotalMs: 3000,
    why: "HANDOFF 261111 实测修复后弹出 1–4 个 / 271–312ms（轮次天然抖动）⇒ p50 个数 +2、总时长 +50% 或 +100ms；硬上限兜键盘动画+整页重排级事故。",
  },
  keyboardCloseLongTasks: {
    kind: "longtask", definition: "adb keyevent 4 收键盘后 1500ms 内 >50ms 长任务的个数/总时长",
    countPct: 0.5, countAbs: 2, totalPct: 0.5, totalAbsMs: 100, ceilingCount: 20, ceilingTotalMs: 3000,
    why: "HANDOFF 261111 实测修复后收起 0–4 个 / ≤326ms；与弹出同阈值。",
  },
  docOpenToContent: {
    kind: "ms", definition: "（可选 --with-doc-open）目录行点按 → 活动 pane 内核内容可用（.ne-viewer / .ne-engine）毫秒",
    p50Pct: 0.3, p50AbsMs: 250, worstPct: 0.7, worstAbsMs: 800, ceilingMs: 20000,
    why: "可选指标，依赖夹具里的文档与内核分包；与 mobile-kernel-perf 的首次挂载口径对齐，只作参考回归。",
  },
};

const METRIC_IDS = ["coldStartToHome", "captureColdToInput", "composerHotToInput", "keyboardOpenLongTasks", "keyboardCloseLongTasks", "docOpenToContent"];
/** --only 的简写别名（方便手敲；keyboard 同时代表弹出/收起两项）。 */
const METRIC_ALIASES = {
  coldStart: "coldStartToHome", coldStartToHome: "coldStartToHome",
  captureCold: "captureColdToInput", captureColdToInput: "captureColdToInput",
  hotOpen: "composerHotToInput", composerHot: "composerHotToInput", composerHotToInput: "composerHotToInput",
  keyboard: ["keyboardOpenLongTasks", "keyboardCloseLongTasks"],
  keyboardOpen: "keyboardOpenLongTasks", keyboardClose: "keyboardCloseLongTasks",
  keyboardOpenLongTasks: "keyboardOpenLongTasks", keyboardCloseLongTasks: "keyboardCloseLongTasks",
  docOpen: "docOpenToContent", docOpenToContent: "docOpenToContent",
};

/* ------------------------------------------------------------------ *
 * 页内选择器/表达式（移动端 DOM 速查见 scripts/mobile-audit/README.md「实测设备事实」）
 * ------------------------------------------------------------------ */

/** 真首页判据：.mb-home-dock__item（冷启动骨架里只有空 Dock + .mb-skel，裸 .mb-home-dock 会假就绪——261110 实测）。 */
const HOME_READY_JS = "(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};return [].slice.call(document.querySelectorAll('.mb-home-dock__item')).filter(vis).length>0;})()";
/** 写作卡可输入：挂载的写作卡容器 + 可见 contenteditable（内核已挂）。 */
const COMPOSER_READY_JS = "(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var root=[].slice.call(document.querySelectorAll('.mobile-qn-composer')).filter(vis)[0];if(!root)return false;return [].slice.call(root.querySelectorAll('[contenteditable=true]')).filter(vis).length>0;})()";
/** 可见写作卡正文的点击中心（真实点按弹键盘；程序化 focus 不弹软键盘——AGENTS §7.17）。 */
const COMPOSER_CENTER_JS = "(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var root=[].slice.call(document.querySelectorAll('.mobile-qn-composer')).filter(vis)[0];if(!root)return null;var ce=[].slice.call(root.querySelectorAll('[contenteditable=true]')).filter(vis)[0];if(!ce)return null;var r=ce.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;var x=Math.round(r.x+r.width/2),y=Math.min(Math.round(r.y+Math.min(48,r.height/2)),Math.round(r.y+r.height)-8);var h=document.elementFromPoint(x,y);if(!h||!(ce===h||ce.contains(h)))return null;return [x,y];})()";
/** 键盘判据：相对"键盘收起时的 innerHeight"收缩 >200px（AGENTS §7.17 的判据）。 */
function keyboardStateJs(ihClosed) {
  return "(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var root=[].slice.call(document.querySelectorAll('.mobile-qn-composer')).filter(vis)[0];var ce=root?[].slice.call(root.querySelectorAll('[contenteditable=true]')).filter(vis)[0]:null;return {ih:innerHeight,kb:innerHeight<(" + JSON.stringify(ihClosed) + "-200),composer:!!root,inputmode:ce?ce.getAttribute('inputmode'):null};})()";
}

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

function usage() {
  return [
    "移动端性能基线探针（本地门禁，不进 CI）",
    "",
    "  node scripts/mobile-audit/perf-baseline.mjs [options]",
    "",
    "  --record               采完写基线（默认 .css-audit/perf/mobile-perf.json；可用 --baseline 改路径）",
    "  --compare              与基线比对，超阈值 exit 1（= npm run check:perfmobile）",
    "  --baseline PATH        基线 JSON 路径（默认 .css-audit/perf/mobile-perf.json）",
    "  --json                 只把完整 JSON 打到 stdout（人读摘要与进度走 stderr）",
    "  --rounds N             每个指标采集轮数（默认 " + DEFAULT_ROUNDS + "，至少 3；p50 需要样本）",
    "  --only A,B             只跑指定指标（简写 coldStart/captureCold/hotOpen/keyboard/docOpen 或全名：" + METRIC_IDS.join(",") + "）",
    "  --with-doc-open        附带采集可选指标 docOpenToContent（依赖设备里有笔记本+文档）",
    "  --port N               CDP 端口（默认 " + DEFAULT_PORT + "，也可用 LAKE_MOBILE_CDP_PORT）",
    "  --serial S             adb 设备 serial（默认 ANDROID_SERIAL；多设备时必须指定）",
    "  --allow-env-mismatch   对比时忽略设备/视口不一致（仅排障用，正常必须重烤基线）",
    "  --no-restore           结束不把 App 恢复到首页（默认会 force-stop + 正常启动，方便交还设备）",
    "  --no-wake              不自动唤醒/解锁屏幕（默认 best-effort 唤醒，锁屏时冷启动数字不可信）",
    "  --self-check           不连设备：只自检纯逻辑/阈值配置（无设备可跑）",
    "  --help                 显示本帮助",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = {
    mode: "measure", baseline: DEFAULT_BASELINE, json: false, rounds: DEFAULT_ROUNDS,
    only: null, withDocOpen: false, port: null, serial: null, allowEnvMismatch: false,
    noRestore: false, noWake: false, selfCheck: false, help: false,
  };
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || String(value).startsWith("--")) throw new Error(name + " 缺少取值");
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    if (arg === "--self-check") { opts.selfCheck = true; continue; }
    if (arg === "--json") { opts.json = true; continue; }
    if (arg === "--record") { opts.mode = "record"; continue; }
    if (arg === "--compare") { opts.mode = "compare"; continue; }
    if (arg === "--with-doc-open") { opts.withDocOpen = true; continue; }
    if (arg === "--allow-env-mismatch") { opts.allowEnvMismatch = true; continue; }
    if (arg === "--no-restore") { opts.noRestore = true; continue; }
    if (arg === "--no-wake") { opts.noWake = true; continue; }
    if (arg === "--baseline") { opts.baseline = path.resolve(process.cwd(), takeValue(i, "--baseline")); i += 1; continue; }
    if (arg === "--rounds") { opts.rounds = Number(takeValue(i, "--rounds")); i += 1; continue; }
    if (arg === "--only") { opts.only = takeValue(i, "--only").split(",").map((s) => s.trim()).filter(Boolean); i += 1; continue; }
    if (arg === "--port") { opts.port = Number(takeValue(i, "--port")); i += 1; continue; }
    if (arg === "--serial") { opts.serial = takeValue(i, "--serial"); i += 1; continue; }
    if (arg.startsWith("--")) throw new Error("未知参数：" + arg + "（--help 看用法）");
    throw new Error("无法识别的参数：" + arg + "（--help 看用法）");
  }
  if (opts.help) return opts;
  if (!Number.isInteger(opts.rounds) || opts.rounds < 3) throw new Error("--rounds 必须是 ≥3 的整数（p50 需要样本）");
  if (opts.rounds > 10) throw new Error("--rounds 上限 10（设备时间成本）");
  if (opts.port !== null && (!Number.isInteger(opts.port) || opts.port <= 0)) throw new Error("--port 不合法");
  if (opts.only) {
    const expanded = [];
    for (const raw of opts.only) {
      const mapped = METRIC_ALIASES[raw];
      if (!mapped) throw new Error("--only 里有未知指标：" + raw + "（可选 " + Object.keys(METRIC_ALIASES).join(",") + "）");
      for (const id of Array.isArray(mapped) ? mapped : [mapped]) if (!expanded.includes(id)) expanded.push(id);
    }
    opts.only = expanded;
  }
  if (opts.withDocOpen) {
    if (opts.only && !opts.only.includes("docOpenToContent")) opts.only.push("docOpenToContent");
  } else if (opts.only && opts.only.includes("docOpenToContent")) {
    throw new Error("docOpenToContent 需要 --with-doc-open");
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * 纯函数区（--self-check 与真跑共用；无设备也能验）
 * ------------------------------------------------------------------ */

/** 中位数（偶数个取下中位数：与仓库既有探针的 p50 口径一致，避免两套取法）。 */
export function median(values) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  return xs[Math.floor((xs.length - 1) / 2)];
}

/** 毫秒类指标摘要：p50 / 最坏 / 全部样本（样本里带 round 等诊断字段）。 */
export function summarizeMs(samples) {
  const xs = samples.map((s) => s.ms).filter((v) => typeof v === "number" && Number.isFinite(v));
  return { n: xs.length, p50: median(xs), worst: xs.length ? Math.max(...xs) : null, min: xs.length ? Math.min(...xs) : null, samples };
}

/** 长任务类指标摘要：p50 个数/总时长 + 最坏个数/总时长。 */
export function summarizeLongTasks(samples) {
  const valid = samples.filter((s) => s.valid !== false);
  const counts = valid.map((s) => s.count).filter((v) => Number.isFinite(v));
  const totals = valid.map((s) => s.totalMs).filter((v) => Number.isFinite(v));
  return {
    n: valid.length,
    p50Count: median(counts),
    worstCount: counts.length ? Math.max(...counts) : null,
    p50TotalMs: median(totals),
    worstTotalMs: totals.length ? Math.max(...totals) : null,
    samples,
  };
}

/** 单个毫秒指标的允许上限：base + max(base×pct, absMs) —— 相对/绝对双保险。 */
export function msBudget(base, pct, absMs) {
  if (typeof base !== "number" || !Number.isFinite(base)) return null;
  return base + Math.max(base * pct, absMs);
}

/** 单个长任务"个数"上限：p50 个数 + 固定绝对余量（个数是整数，百分比余量在小基线上没意义）。 */
export function countBudget(baseCount, countAbs) {
  if (typeof baseCount !== "number" || !Number.isFinite(baseCount)) return null;
  return baseCount + countAbs;
}

/**
 * 指标对比：base / cur 都是 report.metrics 里的一项。
 * 返回 { id, pass, kind, checks: [{label, actual, budget, pass}], reason? }。
 * 只比双方都采集到的指标；任一侧缺失走 skipped（由调用方决定 warn 还是 fail）。
 */
export function compareMetric(id, base, cur, limits) {
  const limit = limits[id];
  if (!limit || !base || !cur) return { id, pass: true, skipped: true, reason: "基线与本次未成对出现" };
  const checks = [];
  if (limit.kind === "ms") {
    if (cur.n === 0 || cur.p50 === null) return { id, pass: true, skipped: true, reason: "本次无有效样本" };
    if (base.p50 === null || base.p50 === undefined) return { id, pass: true, skipped: true, reason: "基线无有效样本" };
    const p50Budget = msBudget(base.p50, limit.p50Pct, limit.p50AbsMs);
    const worstBudget = msBudget(base.worst, limit.worstPct, limit.worstAbsMs);
    checks.push({ label: "p50(ms)", actual: cur.p50, budget: p50Budget, pass: cur.p50 <= p50Budget });
    checks.push({ label: "worst(ms)", actual: cur.worst, budget: worstBudget, pass: cur.worst <= worstBudget });
    if (typeof limit.ceilingMs === "number") checks.push({ label: "硬上限(ms)", actual: cur.worst, budget: limit.ceilingMs, pass: cur.worst <= limit.ceilingMs });
  } else {
    if (cur.n === 0 || cur.p50Count === null) return { id, pass: true, skipped: true, reason: "本次无有效样本" };
    if (base.p50Count === null || base.p50Count === undefined) return { id, pass: true, skipped: true, reason: "基线无有效样本" };
    const cb = countBudget(base.p50Count, limit.countAbs);
    const tb = msBudget(base.p50TotalMs, limit.totalPct, limit.totalAbsMs);
    checks.push({ label: "p50长任务个数", actual: cur.p50Count, budget: cb, pass: cur.p50Count <= cb });
    checks.push({ label: "p50长任务总时长(ms)", actual: cur.p50TotalMs, budget: tb, pass: cur.p50TotalMs <= tb });
    if (typeof limit.ceilingCount === "number") checks.push({ label: "硬上限(个数)", actual: cur.worstCount, budget: limit.ceilingCount, pass: cur.worstCount <= limit.ceilingCount });
    if (typeof limit.ceilingTotalMs === "number") checks.push({ label: "硬上限(总时长ms)", actual: cur.worstTotalMs, budget: limit.ceilingTotalMs, pass: cur.worstTotalMs <= limit.ceilingTotalMs });
  }
  return { id, pass: checks.every((c) => c.pass), kind: limit.kind, checks };
}

/** 环境一致性：换了设备/视口/构建，基线就不可比（返回差异列表；--allow-env-mismatch 由调用方处理）。 */
export function envMismatches(baseEnv, curEnv) {
  if (!baseEnv || !curEnv) return [];
  const out = [];
  const cmp = (label, a, b) => { if (a !== b) out.push({ label, base: a, current: b }); };
  cmp("设备 serial", baseEnv.serial, curEnv.serial);
  cmp("设备型号", baseEnv.device && baseEnv.device.model, curEnv.device && curEnv.device.model);
  cmp("Android SDK", baseEnv.device && baseEnv.device.sdk, curEnv.device && curEnv.device.sdk);
  cmp("App 版本", baseEnv.appVersion, curEnv.appVersion);
  const v = (e) => (e && e.viewport ? e.viewport.w + "x" + e.viewport.h + "@" + e.viewport.dpr : null);
  cmp("视口", v(baseEnv), v(curEnv));
  return out;
}

/* ------------------------------------------------------------------ *
 * adb / CDP 基础设施
 * ------------------------------------------------------------------ */

const log = (m) => console.error("[perf] " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function resolveAdb() {
  if (process.env.ADB) return process.env.ADB;
  const roots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, "platform-tools", "adb");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "adb";
}

class Adb {
  constructor(serial) {
    this.bin = resolveAdb();
    this.serial = serial;
  }
  run(args, { timeout = 20000, allowFail = false } = {}) {
    const full = this.serial ? ["-s", this.serial, ...args] : args;
    const r = spawnSync(this.bin, full, { encoding: "utf8", timeout });
    if (r.error) {
      throw Object.assign(new Error("adb 执行失败（" + this.bin + "）：" + r.error.message), { exitCode: 2 });
    }
    const ok = r.status === 0;
    if (!ok && !allowFail) {
      throw Object.assign(new Error("adb 命令失败：" + ["adb", ...full].join(" ") + "\n" + (r.stderr || r.stdout || "").trim()), { exitCode: 2 });
    }
    return { ok, status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  }
  shell(args, opts) { return this.run(["shell", ...args], opts); }
  devices() {
    const r = this.run(["devices"], { allowFail: true });
    return r.stdout.split("\n").slice(1).map((line) => line.trim()).filter(Boolean)
      .map((line) => { const parts = line.split(/\s+/); return { serial: parts[0], state: parts[1] }; })
      .filter((d) => d.state === "device");
  }
}

function pickSerial(adb, requested) {
  if (requested) return requested;
  if (process.env.ANDROID_SERIAL) return process.env.ANDROID_SERIAL;
  const devices = adb.devices();
  if (devices.length === 0) throw Object.assign(new Error("没有已连接的 adb 设备（先 bash scripts/emu-up.sh；或换 USB/AVD）"), { exitCode: 2 });
  if (devices.length > 1) {
    throw Object.assign(new Error("多台设备在线（" + devices.map((d) => d.serial).join(", ") + "）⇒ 必须 --serial 或 export ANDROID_SERIAL"), { exitCode: 2 });
  }
  return devices[0].serial;
}

/** 按当前 App PID 重建 adb forward（socket 名带宿主 PID；App 重启后旧 socket 仍挂在 /proc/net/unix —— MOBILE-OPS §3）。 */
async function ensureForward(adb, port) {
  adb.run(["forward", "--remove", "tcp:" + port], { allowFail: true });
  const pidRes = adb.shell(["pidof", PKG], { allowFail: true });
  const pid = (pidRes.stdout || "").trim().split(/\s+/).filter(Boolean)[0] || "";
  const unix = adb.shell(["cat", "/proc/net/unix"], { allowFail: true }).stdout || "";
  const matches = [...unix.matchAll(/webview_devtools_remote_[0-9a-zA-Z]+/g)].map((m) => m[0]);
  let sock = "";
  if (pid) sock = matches.find((m) => m === "webview_devtools_remote_" + pid) || "";
  if (!sock) sock = matches[matches.length - 1] || "";
  if (!sock) return null;
  adb.run(["forward", "tcp:" + port, "localabstract:" + sock], { allowFail: true });
  return { sock, pid };
}

async function fetchPageTarget(port) {
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const list = await res.json();
    return list.find((t) => t.type === "page" && !String(t.url || "").startsWith("devtools://")) || null;
  } catch {
    return null;
  }
}

/** 起动 App 并尽快连上 CDP（先建 forward → 轮询 /json/list → connect）。 */
async function launchAndAttach({ adb, port, kind }) {
  adb.shell(["am", "force-stop", PKG]);
  adb.run(["forward", "--remove", "tcp:" + port], { allowFail: true });
  const t0 = Date.now();
  const args = kind === "capture"
    ? ["am", "start", "-n", CAPTURE_ACTIVITY, "-a", "android.intent.action.VIEW", "-d", CAPTURE_URL]
    : ["am", "start", "-n", MAIN_ACTIVITY];
  const started = adb.shell(args, { allowFail: true });
  if (/Error|Exception/.test(started.stdout + started.stderr)) {
    throw Object.assign(new Error("am start 失败（包名/activity 不对？先 android-build.sh --sync --install）：" + (started.stdout + started.stderr).trim()), { exitCode: 3 });
  }
  const deadline = Date.now() + COLD_TIMEOUT_MS;
  let lastForwardAt = 0;
  while (Date.now() < deadline) {
    if (Date.now() - lastForwardAt > 700) { await ensureForward(adb, port).catch(() => null); lastForwardAt = Date.now(); }
    if (!(await fetchPageTarget(port))) { await sleep(100); continue; }
    try {
      const page = await connect(port);
      // 261111 修：force-stop 后旧 WebView target 可能仍短暂挂在 /json/list 里（socket 复用/导航中），
      // 连上去会 evaluate 失败 → 标记注入返回 null。连上后先确认真的是 App 页面（非 about:blank/devtools）。
      const href = await evalOrNull(page, "location.href");
      if (!href || href === "about:blank" || href === "devtools://") {
        try { page.ws.close(); } catch { /* ignore */ }
        await sleep(150);
        continue;
      }
      return { page, t0, attachMs: Date.now() - t0 };
    } catch {
      await sleep(120);
    }
  }
  throw Object.assign(new Error("连不上 CDP :" + port + "（App 起来了吗？debug 构建 + emu-cdp 转发；最多等 " + COLD_TIMEOUT_MS + "ms）"), { exitCode: 2 });
}

/* ------------------------------------------------------------------ *
 * 页内布防 / 采样
 * ------------------------------------------------------------------ */

/** 在页内装一个 16ms 轮询的"就绪标记"，记录首次命中时的 performance.now()/Date.now()，避免 CDP 往返误差。 */
function armMarkerJs(kind) {
  const pred = kind === "home" ? HOME_READY_JS : COMPOSER_READY_JS;
  return "(function(){try{if(window.__perfGen)clearInterval(window.__perfGen);}catch(e){}" +
    "var pred=" + pred + ";" +
    "window.__perfMarker={kind:" + JSON.stringify(kind) + ",armedAt:performance.now(),done:null,doneAt:null};" +
    "var tick=function(){if(window.__perfMarker.done===null&&pred()){window.__perfMarker.done=performance.now();window.__perfMarker.doneAt=Date.now();}};" +
    "tick();window.__perfGen=setInterval(tick,16);" +
    "return {armedAt:window.__perfMarker.armedAt,done:window.__perfMarker.done};})()";
}

async function waitMarker(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = await page.evaluate("window.__perfMarker?{armedAt:window.__perfMarker.armedAt,done:window.__perfMarker.done,doneAt:window.__perfMarker.doneAt}:null").catch(() => null);
    if (m && typeof m.doneAt === "number") return m;
    await sleep(50);
  }
  return null;
}

/** 装 longtask 观察器（只统计 >50ms；每页一次；重复调用复用）。 */
const LT_INSTALL_JS = "(function(){try{" +
  "if(window.__ltObs) return {ok:true,reused:true};" +
  "window.__lt={entries:[],err:null};" +
  "window.__ltObs=new PerformanceObserver(function(list){list.getEntries().forEach(function(e){if(e.duration>" + LONG_TASK_MIN_MS + ")window.__lt.entries.push({start:Math.round(e.startTime),dur:Math.round(e.duration)});});});" +
  "window.__ltObs.observe({entryTypes:['longtask']});" +
  "return {ok:true,reused:false};}catch(e){return {ok:false,err:String(e)};}})()";
const LT_START_JS = "(function(){if(!window.__lt)return false;window.__lt.entries.length=0;window.__lt.windowStart=performance.now();return true;})()";
function ltCollectJs(windowMs) {
  return "(async function(){await new Promise(function(r){setTimeout(r," + (windowMs + 150) + ");});" +
    "var es=window.__lt?window.__lt.entries.slice():[];" +
    "var durs=es.map(function(e){return e.dur;});" +
    "return {count:es.length,totalMs:durs.reduce(function(a,b){return a+b;},0),worstMs:durs.length?Math.max.apply(null,durs):0,entries:es};})()";
}

async function evalOrNull(page, expr) { try { return await page.evaluate(expr); } catch { return null; } }

async function waitPage(page, expr, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evalOrNull(page, expr)) return true;
    await sleep(60);
  }
  return false;
}

async function clickAt(page, pt) {
  if (!pt) return false;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt[0], y: pt[1], button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt[0], y: pt[1], button: "left", clickCount: 1 });
  return true;
}

async function clickJs(page, expr) {
  return clickAt(page, await evalOrNull(page, expr));
}

/** 可见元素中心点。 */
function centerExpr(selector) {
  return "(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var e=[].slice.call(document.querySelectorAll(" + JSON.stringify(selector) + ")).filter(vis)[0];if(!e)return null;var r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()";
}

/** 按可见文案/aria-label 找元素中心点。 */
function centerByTextExpr(selector, text) {
  return "(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var els=[].slice.call(document.querySelectorAll(" + JSON.stringify(selector) + ")).filter(vis);for(var i=0;i<els.length;i++){var t=(els[i].getAttribute('aria-label')||'')+els[i].title+(els[i].textContent||'');if(t.indexOf(" + JSON.stringify(text) + ")>=0){var r=els[i].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];}}return null;})()";
}

/* ------------------------------------------------------------------ *
 * 设备/环境信息
 * ------------------------------------------------------------------ */

function collectDeviceInfo(adb) {
  const prop = (name) => (adb.shell(["getprop", name], { allowFail: true }).stdout || "").trim() || null;
  const pkgDump = adb.shell(["dumpsys", "package", PKG], { allowFail: true }).stdout;
  const versionName = (pkgDump.match(/versionName=([^\s]+)/) || [])[1] || null;
  return {
    serial: adb.serial,
    device: { model: prop("ro.product.model"), sdk: prop("ro.build.version.sdk"), release: prop("ro.build.version.release"), abi: prop("ro.product.cpu.abi") },
    appVersion: versionName,
  };
}

function gitInfo() {
  const run = (args) => {
    try { return execFileSync(fs.existsSync("/usr/bin/git") ? "/usr/bin/git" : "git", args, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; }
  };
  return { head: run(["rev-parse", "HEAD"]), dirty: (run(["status", "--porcelain"]) || "") !== "" };
}

/* ------------------------------------------------------------------ *
 * 指标采集
 * ------------------------------------------------------------------ */

/** 冷启动类：force-stop → 起动 → 连 CDP → 页内标记（首页/写作卡）→ 记录墙钟与页内时间。 */
async function sampleCold({ adb, port, kind }) {
  const attached = await launchAndAttach({ adb, port, kind });
  const page = attached.page;
  try {
    // 261111 修：冷启动时页面可能正在导航，evaluate 会短暂失败（Execution context destroyed）。
    // 重试到页面可求值；若已经就绪，armMarker 会立刻把 done 填上（后面按 wall-upper-bound 记）。
    let marker = null;
    for (let i = 0; i < 30 && !marker; i++) {
      marker = await evalOrNull(page, armMarkerJs(kind === "capture" ? "composer" : "home"));
      if (!marker) await sleep(120);
    }
    if (!marker) throw Object.assign(new Error("页内标记注入失败（页面在导航中？）"), { exitCode: 3 });
    const readyBeforeArm = typeof marker.done === "number";
    const hit = readyBeforeArm
      ? { armedAt: marker.armedAt, done: marker.done, doneAt: Date.now() }
      : await waitMarker(page, COLD_TIMEOUT_MS);
    if (!hit) throw Object.assign(new Error((kind === "capture" ? "写作卡" : "首页") + "在 " + COLD_TIMEOUT_MS + "ms 内没就绪（装置/页面异常）"), { exitCode: 3 });
    const wallMs = Math.round(hit.doneAt - attached.t0);
    const pageMs = Math.round(hit.done);
    const env = await evalOrNull(page, "(function(){return {w:innerWidth,h:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent};})()");
    const cloudState = await evalOrNull(page, "(function(){try{var n=window.lakeNative;if(!n||!n.getCloudState)return null;var v=n.getCloudState();return (v&&typeof v.then==='function')?null:v;}catch(e){return null;}})()");
    return {
      sample: {
        ms: readyBeforeArm ? wallMs : pageMs,
        method: readyBeforeArm ? "wall-upper-bound（连上 CDP 时已就绪）" : "page-side（页内首次命中 performance.now）",
        wallMs, pageSinceNavMs: pageMs, readyBeforeArm, attachMs: attached.attachMs,
      },
      env, cloudState,
    };
  } finally {
    try { page.ws.close(); } catch { /* ignore */ }
  }
}

/** 热开写作卡：假设当前在首页（page 已连）；FAB → 空白小记 → 可输入。 */
async function sampleComposerHot(page) {
  const tWall = Date.now();
  await evalOrNull(page, "(function(){try{if(window.__perfGen)clearInterval(window.__perfGen);}catch(e){}return true;})()");
  const marker = await evalOrNull(page, armMarkerJs("composer"));
  if (!marker) throw Object.assign(new Error("页内标记注入失败"), { exitCode: 3 });
  const pressed = await clickJs(page, centerExpr(".mb-home-fab"));
  if (!pressed) throw Object.assign(new Error("首页找不到 .mb-home-fab（不在首页？）"), { exitCode: 3 });
  const tileReady = await waitPage(page, "(function(){var vis=function(e){return !!e&&e.getBoundingClientRect().width>0;};var els=[].slice.call(document.querySelectorAll('.mb-create__tile')).filter(vis);return els.some(function(e){return ((e.textContent||'').indexOf('空白小记')>=0);});})()", 4000);
  if (!tileReady) throw Object.assign(new Error("点 FAB 后没有「空白小记」入口（新建面板没打开？）"), { exitCode: 3 });
  if (!(await clickJs(page, centerByTextExpr(".mb-create__tile", "空白小记")))) throw Object.assign(new Error("点不到「空白小记」磁贴"), { exitCode: 3 });
  const hit = await waitMarker(page, HOT_TIMEOUT_MS);
  if (!hit) throw Object.assign(new Error("写作卡在 " + HOT_TIMEOUT_MS + "ms 内没到可输入（内核分包/挂载异常）"), { exitCode: 3 });
  return { ms: Math.round(hit.done - hit.armedAt), method: "page-side（FAB 点按前的 armedAt → 可输入）", wallMs: Date.now() - tWall, armedAt: hit.armedAt, done: hit.done };
}

/** 关闭写作卡回首页（点「取消」再等首页；失败则 keyevent 4 / reload 兜底）。 */
async function closeComposer(page, adb) {
  if (await clickJs(page, centerByTextExpr(".mobile-qn-btn", "取消"))) {
    if (await waitPage(page, HOME_READY_JS, 4000)) return true;
  }
  adb.shell(["input", "keyevent", "4"], { allowFail: true });
  await sleep(700);
  if (await waitPage(page, HOME_READY_JS, 3000)) return true;
  await page.send("Page.reload", { ignoreCache: false }).catch(() => {});
  return waitPage(page, HOME_READY_JS, HOT_TIMEOUT_MS);
}

/** 确保写作卡打开（键盘指标前置；不算进 hot-open 指标）。 */
async function ensureComposerOpen(page, adb) {
  if (await evalOrNull(page, COMPOSER_READY_JS)) return true;
  if (!(await waitPage(page, HOME_READY_JS, 4000))) throw Object.assign(new Error("既不在首页也不在写作卡（装置状态未知）"), { exitCode: 3 });
  await evalOrNull(page, armMarkerJs("composer"));
  if (!(await clickJs(page, centerExpr(".mb-home-fab")))) throw Object.assign(new Error("点不到首页 FAB"), { exitCode: 3 });
  if (!(await waitPage(page, "Boolean(document.querySelector('.mb-create__tile'))", 4000))) throw Object.assign(new Error("新建面板没打开"), { exitCode: 3 });
  if (!(await clickJs(page, centerByTextExpr(".mb-create__tile", "空白小记")))) throw Object.assign(new Error("点不到「空白小记」"), { exitCode: 3 });
  if (!(await waitMarker(page, HOT_TIMEOUT_MS))) throw Object.assign(new Error("写作卡没就绪"), { exitCode: 3 });
  return true;
}

/**
 * 采一次"聚焦/收键盘"的长任务窗口。
 * 归一化：先量出**键盘收起时**的 innerHeight（作为判据基准），再按动作开/收键盘；
 * 点按一律 CDP 真实鼠标事件（程序化 focus 不弹软键盘，AGENTS §7.17）。
 */
async function sampleKeyboardWindow(page, adb, { action }) {
  let st = await evalOrNull(page, "(function(){return {ih:innerHeight};})()");
  if (!st) throw Object.assign(new Error("读不到 innerHeight"), { exitCode: 3 });
  const installed = await evalOrNull(page, LT_INSTALL_JS);
  if (!installed || !installed.ok) return { valid: false, detail: "longtask 不可用：" + (installed && installed.err ? installed.err : "unknown"), entries: [] };
  if (st.ih < 700) { // 键盘弹着 ⇒ 先收起，量出"收起时"的 innerHeight
    adb.shell(["input", "keyevent", "4"], { allowFail: true });
    await sleep(900);
    // back 键在少数 ROM 上会被写作卡返回键先吃掉（连写作卡一起关掉）⇒ 重新打开再量
    if (!(await evalOrNull(page, COMPOSER_READY_JS))) await ensureComposerOpen(page, adb);
    st = await evalOrNull(page, "(function(){return {ih:innerHeight};})()");
    if (!st) throw Object.assign(new Error("读不到 innerHeight"), { exitCode: 3 });
  }
  const ihClosed = st.ih;
  const closedState = await evalOrNull(page, keyboardStateJs(ihClosed));
  if (!closedState || closedState.kb !== false) return { valid: false, detail: "键盘归一到收起态失败（ih=" + (closedState ? closedState.ih : "?") + "）", entries: [] };
  if (action === "open") {
    await page.evaluate(LT_START_JS);
    if (!(await clickJs(page, COMPOSER_CENTER_JS))) return { valid: false, detail: "点不到可见正文", entries: [] };
  } else {
    if (!(await clickJs(page, COMPOSER_CENTER_JS))) return { valid: false, detail: "点不到可见正文", entries: [] };
    await sleep(700);
    await page.evaluate(LT_START_JS);
    adb.shell(["input", "keyevent", "4"], { allowFail: true });
  }
  const lt = await evalOrNull(page, ltCollectJs(LONG_TASK_WINDOW_MS));
  if (!lt) return { valid: false, detail: "longtask 采集失败", entries: [] };
  const st1 = (await evalOrNull(page, keyboardStateJs(ihClosed))) || { ih: null, kb: null, inputmode: null };
  const valid = action === "open" ? st1.kb === true : st1.kb === false;
  return {
    valid, count: lt.count, totalMs: Math.round(lt.totalMs), worstMs: lt.worstMs, entries: lt.entries,
    ihClosed, ihAfter: st1.ih, inputmodeAfter: st1.inputmode,
    detail: valid ? null : (action === "open" ? "点按后键盘未弹起（ih " + ihClosed + " → " + st1.ih + "）" : "back 后键盘未收起（ih " + ihClosed + " → " + st1.ih + "；可能被写作卡返回键先吃掉）"),
  };
}

/** 可选：首页 → 知识库 → 笔记本 → 目录行 → 活动 pane 内核内容出现。 */
async function sampleDocOpen(page) {
  if (!(await clickJs(page, centerByTextExpr(".mb-home-dock__item", "知识库")))) throw Object.assign(new Error("找不到 Dock「知识库」"), { exitCode: 3 });
  await sleep(900);
  if (!(await clickJs(page, centerExpr(".nb-shelf-card, .nb-row")))) throw Object.assign(new Error("首页没有笔记本入口（.nb-shelf-card / .nb-row）"), { exitCode: 3 });
  if (!(await waitPage(page, "Boolean(document.querySelector('.mobile-workspace'))", 8000))) throw Object.assign(new Error("点笔记本没进工作区"), { exitCode: 3 });
  await sleep(600);
  let rowTapped = await clickJs(page, centerExpr(".side-panel--left.on .mb-row, .side-panel--left.on .ln-row"));
  if (!rowTapped) {
    await clickJs(page, centerByTextExpr(".mobile-bottom-bar__item", "文档树"));
    await sleep(1100);
    rowTapped = await clickJs(page, centerExpr(".side-panel--left.on .mb-row, .side-panel--left.on .ln-row"));
  }
  if (!rowTapped) throw Object.assign(new Error("目录抽屉里没有可点文档行（设备数据为空？）"), { exitCode: 3 });
  const tWall = Date.now();
  const ready = await waitPage(page, "(function(){var p=document.querySelector('.doc-pane.active');if(!p)return false;return !!(p.querySelector('.ne-viewer')||p.querySelector('.ne-engine'));})()", HOT_TIMEOUT_MS);
  if (!ready) throw Object.assign(new Error("文档打开后 " + HOT_TIMEOUT_MS + "ms 内没出现内核内容"), { exitCode: 3 });
  return { ms: Date.now() - tWall, method: "wall（CDP 轮询活动 pane 内核内容；含 CDP 往返 ~50ms）", wallMs: Date.now() - tWall };
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

function prepareEnabledMetrics(opts) {
  const ids = METRIC_IDS.filter((id) => id !== "docOpenToContent" || opts.withDocOpen);
  return opts.only ? ids.filter((id) => opts.only.includes(id)) : ids;
}

async function runMetrics(opts) {
  const serial = pickSerial(new Adb(null), opts.serial);
  const adb = new Adb(serial);
  const port = opts.port || Number(process.env.LAKE_MOBILE_CDP_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0) throw Object.assign(new Error("CDP 端口不合法"), { exitCode: 2 });
  const pkgPath = adb.shell(["pm", "path", PKG], { allowFail: true }).stdout.trim();
  if (!pkgPath) throw Object.assign(new Error("设备上没有装 " + PKG + "（先 bash scripts/android-build.sh --sync --install）"), { exitCode: 2 });
  if (!opts.noWake) {
    adb.shell(["input", "keyevent", "KEYCODE_WAKEUP"], { allowFail: true });
    adb.shell(["wm", "dismiss-keyguard"], { allowFail: true });
    await sleep(400);
  }
  const device = collectDeviceInfo(adb);
  const enabled = prepareEnabledMetrics(opts);
  log("设备 " + serial + " / " + (device.device.model || "?") + " / SDK " + (device.device.sdk || "?") + " / app " + (device.appVersion || "?") + " / CDP :" + port + " / 轮次 " + opts.rounds);
  log("指标：" + enabled.join(", "));

  const metrics = {};
  const warnings = [];
  const env = { ...device, viewport: null, cloudState: null, ua: null };
  const absorbEnv = (pageEnv, cloudState) => {
    if (pageEnv && !env.viewport) { env.viewport = { w: pageEnv.w, h: pageEnv.h, dpr: pageEnv.dpr }; env.ua = pageEnv.ua; }
    if (cloudState && !env.cloudState) env.cloudState = cloudState;
  };

  // 1) 普通冷启动
  if (enabled.includes("coldStartToHome")) {
    const samples = [];
    for (let round = 1; round <= opts.rounds; round += 1) {
      try {
        const result = await sampleCold({ adb, port, kind: "home" });
        result.sample.round = round;
        samples.push(result.sample);
        absorbEnv(result.env, result.cloudState);
        log("冷启动 第" + round + "轮：" + result.sample.ms + "ms（" + result.sample.method + "）");
      } catch (error) { warnings.push("冷启动 第" + round + "轮失败：" + error.message); }
      await sleep(800);
    }
    metrics.coldStartToHome = { ...summarizeMs(samples), definition: LIMITS.coldStartToHome.definition, unit: "ms" };
  }

  // 2) 快捷入口冷启动（深链写作卡）
  if (enabled.includes("captureColdToInput")) {
    const samples = [];
    for (let round = 1; round <= opts.rounds; round += 1) {
      try {
        const result = await sampleCold({ adb, port, kind: "capture" });
        result.sample.round = round;
        samples.push(result.sample);
        absorbEnv(result.env, result.cloudState);
        log("快捷冷启 第" + round + "轮：" + result.sample.ms + "ms（" + result.sample.method + "）");
      } catch (error) { warnings.push("快捷冷启 第" + round + "轮失败：" + error.message); }
      await sleep(800);
    }
    metrics.captureColdToInput = { ...summarizeMs(samples), definition: LIMITS.captureColdToInput.definition, unit: "ms" };
  }

  // 3) 热开写作卡 + 4) 键盘长任务（共用一个页面会话；先把 App 起回首页）
  const needsWarm = enabled.includes("composerHotToInput") || enabled.includes("keyboardOpenLongTasks") || enabled.includes("keyboardCloseLongTasks") || enabled.includes("docOpenToContent");
  if (needsWarm) {
    const attached = await launchAndAttach({ adb, port, kind: "home" });
    const page = attached.page;
    try {
      if (!(await waitPage(page, HOME_READY_JS, COLD_TIMEOUT_MS))) throw Object.assign(new Error("起回首页失败（冷启动未就绪）"), { exitCode: 3 });
      const warmEnv = await evalOrNull(page, "(function(){return {w:innerWidth,h:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent};})()");
      absorbEnv(warmEnv, null);
      if (enabled.includes("composerHotToInput")) {
        const samples = [];
        for (let round = 1; round <= opts.rounds; round += 1) {
          try {
            const sample = await sampleComposerHot(page);
            sample.round = round;
            samples.push(sample);
            log("写作卡热开 第" + round + "轮：" + sample.ms + "ms");
          } catch (error) { warnings.push("写作卡热开 第" + round + "轮失败：" + error.message); }
          const closed = await closeComposer(page, adb);
          if (!closed) { warnings.push("写作卡热开 第" + round + "轮后回不到首页，后续轮次可能失真"); }
          await sleep(600);
        }
        metrics.composerHotToInput = { ...summarizeMs(samples), definition: LIMITS.composerHotToInput.definition, unit: "ms" };
      }
      if (enabled.includes("keyboardOpenLongTasks") || enabled.includes("keyboardCloseLongTasks")) {
        await ensureComposerOpen(page, adb);
        await sleep(800);
        const openSamples = [];
        const closeSamples = [];
        for (let round = 1; round <= opts.rounds; round += 1) {
          if (!(await evalOrNull(page, COMPOSER_READY_JS))) await ensureComposerOpen(page, adb);
          const open = await sampleKeyboardWindow(page, adb, { action: "open" });
          open.round = round;
          openSamples.push(open);
          log("键盘弹出 第" + round + "轮：" + open.count + " 个 / " + open.totalMs + "ms" + (open.valid ? "" : "（无效：" + open.detail + "）"));
          await sleep(500);
          if (!(await evalOrNull(page, COMPOSER_READY_JS))) await ensureComposerOpen(page, adb);
          const close = await sampleKeyboardWindow(page, adb, { action: "close" });
          close.round = round;
          closeSamples.push(close);
          log("键盘收起 第" + round + "轮：" + close.count + " 个 / " + close.totalMs + "ms" + (close.valid ? "" : "（无效：" + close.detail + "）"));
          await sleep(700);
        }
        metrics.keyboardOpenLongTasks = { ...summarizeLongTasks(openSamples), definition: LIMITS.keyboardOpenLongTasks.definition, unit: "longtask>50ms" };
        metrics.keyboardCloseLongTasks = { ...summarizeLongTasks(closeSamples), definition: LIMITS.keyboardCloseLongTasks.definition, unit: "longtask>50ms" };
        await closeComposer(page, adb);
      }
      if (enabled.includes("docOpenToContent")) {
        await sleep(500);
        const samples = [];
        for (let round = 1; round <= opts.rounds; round += 1) {
          try {
            const sample = await sampleDocOpen(page);
            sample.round = round;
            samples.push(sample);
            log("文档打开 第" + round + "轮：" + sample.ms + "ms");
          } catch (error) { warnings.push("文档打开 第" + round + "轮失败：" + error.message); }
          await page.send("Page.reload", { ignoreCache: false }).catch(() => {});
          await sleep(1200);
          await waitPage(page, HOME_READY_JS, HOT_TIMEOUT_MS);
        }
        metrics.docOpenToContent = { ...summarizeMs(samples), definition: LIMITS.docOpenToContent.definition, unit: "ms" };
      }
    } finally {
      try { page.ws.close(); } catch { /* ignore */ }
    }
  }

  // 收尾：把 App 恢复到首页（方便交还设备；默认开）
  if (!opts.noRestore) {
    try {
      adb.shell(["am", "force-stop", PKG], { allowFail: true });
      adb.shell(["am", "start", "-n", MAIN_ACTIVITY], { allowFail: true });
      log("已把 App 恢复到首页启动");
    } catch { /* ignore */ }
  }

  const missing = enabled.filter((id) => !metrics[id] || metrics[id].n === 0);
  if (missing.length) warnings.push("未采到有效样本的指标：" + missing.join(", "));
  return { serial, port, device, env, metrics, warnings, enabled };
}

/* ------------------------------------------------------------------ *
 * 报告装配 / 基线
 * ------------------------------------------------------------------ */

export function assembleReport({ mode, opts, run, baselineCompare }) {
  const failures = [];
  const warnings = [...(run.warnings || [])];
  if (run.env && run.env.cloudState && run.env.cloudState !== "unconfigured") {
    warnings.push("该实例云同步 = " + run.env.cloudState + "（非 unconfigured）⇒ 后台同步会污染冷启动数字，基线只对本实例有效");
  }
  const git = gitInfo();
  if (git.dirty) warnings.push("工作树有未提交改动（git HEAD=" + (git.head || "?") + "）⇒ 基线绑定的是当前源码状态");
  let compare = null;
  if (mode === "compare" && baselineCompare) {
    compare = baselineCompare;
    for (const result of baselineCompare.results) {
      if (result.fail) failures.push("指标回归：" + result.id + "（" + result.failures.join("；") + "）");
    }
  }
  return {
    schema: SCHEMA,
    probe: PROBE,
    mode,
    recordedAt: nowIso(),
    git,
    env: run.env,
    options: { baseline: opts.baseline, port: run.port, rounds: opts.rounds, metrics: run.enabled, longTaskWindowMs: LONG_TASK_WINDOW_MS, longTaskMinMs: LONG_TASK_MIN_MS },
    metrics: run.metrics,
    limits: LIMITS,
    compare,
    warnings,
    failures,
    ok: failures.length === 0,
  };
}

function loadBaseline(file) {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed.schema !== SCHEMA) throw Object.assign(new Error("基线 schema=" + parsed.schema + "，脚本是 " + SCHEMA + " ⇒ 重新 --record"), { exitCode: 2 });
  return parsed;
}

function compareWithBaseline(baseline, run, opts) {
  const baseMetrics = baseline.metrics || {};
  const curMetrics = run.metrics || {};
  const mismatches = envMismatches(baseline.env, run.env);
  if (mismatches.length && !opts.allowEnvMismatch) {
    const detail = mismatches.map((m) => m.label + "：" + m.base + " → " + m.current).join("；");
    throw Object.assign(new Error("环境与基线不一致（" + detail + "）⇒ 换设备/视口/构建后必须重烤基线（--record）；排障可加 --allow-env-mismatch"), { exitCode: 2 });
  }
  const results = [];
  for (const id of Object.keys(curMetrics)) {
    const base = baseMetrics[id];
    const cur = curMetrics[id];
    if (!base) { results.push({ id, skipped: true, reason: "基线里没有该指标" }); continue; }
    const r = compareMetric(id, base, cur, LIMITS);
    if (r.skipped) { results.push({ id, skipped: true, reason: r.reason }); continue; }
    const fails = r.checks.filter((c) => !c.pass).map((c) => c.label + " " + c.actual + " > 预算 " + (c.budget === null ? "?" : Math.round(c.budget)));
    results.push({ id, kind: r.kind, checks: r.checks, fail: fails.length > 0, failures: fails });
  }
  const skipped = results.filter((r) => r.skipped).map((r) => r.id);
  return {
    baselinePath: opts.baseline,
    baselineRecordedAt: baseline.recordedAt || null,
    baselineGit: baseline.git || null,
    envMismatch: mismatches,
    results,
    skipped,
    pass: results.every((r) => !r.fail),
  };
}

/* ------------------------------------------------------------------ *
 * 人类摘要
 * ------------------------------------------------------------------ */

function fmtMs(v) { return typeof v === "number" ? v + "ms" : "—"; }
function msLine(label, m) {
  if (!m || m.n === 0) return "  " + label + "：无有效样本";
  return "  " + label + "：p50 " + fmtMs(m.p50) + "  最坏 " + fmtMs(m.worst) + "  (n=" + m.n + ")";
}
function ltLine(label, m) {
  if (!m || m.n === 0) return "  " + label + "：无有效样本";
  return "  " + label + "：p50 " + m.p50Count + " 个 / " + fmtMs(m.p50TotalMs) + "  最坏 " + m.worstCount + " 个 / " + fmtMs(m.worstTotalMs) + "  (n=" + m.n + ")";
}

function printHuman(report) {
  const out = [];
  const env = report.env || {};
  out.push("[perf] 设备 " + (env.serial || "?") + " / " + ((env.device && env.device.model) || "?") + " / SDK " + ((env.device && env.device.sdk) || "?") +
    " / 视口 " + (env.viewport ? env.viewport.w + "x" + env.viewport.h + "@" + env.viewport.dpr : "?") +
    " / app " + (env.appVersion || "?") + " / 云同步 " + (env.cloudState || "?"));
  out.push("[perf] 轮次 " + report.options.rounds + "；长任务窗口 " + report.options.longTaskWindowMs + "ms（>" + report.options.longTaskMinMs + "ms）；CDP :" + report.options.port);
  const m = report.metrics || {};
  if (m.coldStartToHome) out.push(msLine("冷启动→首页就绪", m.coldStartToHome));
  if (m.captureColdToInput) out.push(msLine("快捷冷启→写作卡可输入", m.captureColdToInput));
  if (m.composerHotToInput) out.push(msLine("写作卡热开→可输入", m.composerHotToInput));
  if (m.keyboardOpenLongTasks) out.push(ltLine("键盘弹出长任务", m.keyboardOpenLongTasks));
  if (m.keyboardCloseLongTasks) out.push(ltLine("键盘收起长任务", m.keyboardCloseLongTasks));
  if (m.docOpenToContent) out.push(msLine("文档打开→内核内容", m.docOpenToContent));
  for (const w of report.warnings || []) out.push("[perf] ⚠ " + w);
  if (report.mode === "compare" && report.compare) {
    out.push("[perf] 对比基线 " + path.relative(ROOT, report.compare.baselinePath) + "（recordedAt " + (report.compare.baselineRecordedAt || "?") + "）");
    for (const r of report.compare.results) {
      if (r.skipped) continue;
      if (r.fail) out.push("[perf] ✗ " + r.id + "：" + r.failures.join("；"));
      else out.push("[perf] ✓ " + r.id + "：" + r.checks.map((c) => c.label + " " + c.actual + " / 预算 " + (c.budget === null ? "?" : Math.round(c.budget))).join("；"));
    }
    if (report.compare.skipped.length) out.push("[perf] 跳过：" + report.compare.skipped.join(", "));
  }
  if (report.mode === "record") out.push("[perf] 基线已写入 " + path.relative(ROOT, report.options.baseline));
  out.push(report.ok ? "[perf] 通过" : "[perf] 不通过：" + (report.failures || []).join("；"));
  for (const line of out) console.log(line);
}

/* ------------------------------------------------------------------ *
 * 自检（无设备）
 * ------------------------------------------------------------------ */

function selfCheck() {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail: detail || null });
    if (!ok) throw Object.assign(new Error("自检失败：" + name + (detail ? "（" + detail + "）" : "")), { exitCode: 1 });
  };
  check("median 奇数取中位", median([5, 1, 3]) === 3);
  check("median 偶数取下中位", median([4, 1, 3, 2]) === 2);
  check("median 空 → null", median([]) === null);
  check("median 过滤非有限数", median([2, NaN, Infinity, 4]) === 2);
  check("summarizeMs p50/worst/min/n", (() => { const s = summarizeMs([{ ms: 300 }, { ms: 100 }, { ms: 500 }]); return s.n === 3 && s.p50 === 300 && s.worst === 500 && s.min === 100; })());
  check("summarizeLongTasks 过滤 invalid", (() => { const s = summarizeLongTasks([{ count: 2, totalMs: 300, valid: true }, { count: 9, totalMs: 900, valid: false }, { count: 0, totalMs: 0, valid: true }]); return s.n === 2 && s.p50Count === 0 && s.worstCount === 2; })());
  check("msBudget = base + max(pct, abs)", msBudget(300, 0.35, 150) === 450 && msBudget(2000, 0.25, 200) === 2500);
  check("countBudget = base + abs", countBudget(2, 2) === 4);
  const limits = { x: { kind: "ms", p50Pct: 0.25, p50AbsMs: 100, worstPct: 0.5, worstAbsMs: 200 } };
  const withinMs = compareMetric("x", { n: 3, p50: 1000, worst: 1500 }, { n: 3, p50: 1100, worst: 1600 }, limits);
  const regressedMs = compareMetric("x", { n: 3, p50: 1000, worst: 1500 }, { n: 3, p50: 1400, worst: 1600 }, limits);
  check("compareMetric ms 通过/回归", withinMs.pass === true && regressedMs.pass === false, regressedMs.checks.map((c) => c.label + ":" + c.pass).join(","));
  const limitsLt = { y: { kind: "longtask", countPct: 0.5, countAbs: 2, totalPct: 0.5, totalAbsMs: 100 } };
  const withinLt = compareMetric("y", { n: 3, p50Count: 2, p50TotalMs: 300, worstCount: 4, worstTotalMs: 700 }, { n: 3, p50Count: 3, p50TotalMs: 350, worstCount: 4, worstTotalMs: 700 }, limitsLt);
  const regressedLt = compareMetric("y", { n: 3, p50Count: 2, p50TotalMs: 300, worstCount: 4, worstTotalMs: 700 }, { n: 3, p50Count: 6, p50TotalMs: 900, worstCount: 8, worstTotalMs: 1800 }, limitsLt);
  check("compareMetric longtask 通过/回归", withinLt.pass === true && regressedLt.pass === false);
  check("compareMetric 无样本 → skipped", compareMetric("x", { n: 3, p50: 1000, worst: 1500 }, { n: 0, p50: null, worst: null }, limits).skipped === true);
  check("envMismatches 抓到构建变化", envMismatches({ serial: "a", device: { model: "m", sdk: "36" }, appVersion: "1.0", viewport: { w: 412, h: 842, dpr: 2.6 } }, { serial: "a", device: { model: "m", sdk: "36" }, appVersion: "1.1", viewport: { w: 412, h: 842, dpr: 2.6 } }).length === 1);
  check("envMismatches 同环境 = 0", envMismatches({ serial: "a", device: { model: "m", sdk: "36" }, appVersion: "1.0", viewport: { w: 412, h: 842, dpr: 2.6 } }, { serial: "a", device: { model: "m", sdk: "36" }, appVersion: "1.0", viewport: { w: 412, h: 842, dpr: 2.6 } }).length === 0);
  for (const id of Object.keys(LIMITS)) {
    const l = LIMITS[id];
    check("阈值 " + id + " 有定义/理由/参数", typeof l.why === "string" && l.why.length > 20 && (l.kind === "ms" ? typeof l.p50Pct === "number" && typeof l.p50AbsMs === "number" : typeof l.countAbs === "number" && typeof l.countPct === "number"));
  }
  check("指标清单与阈值一一对应", METRIC_IDS.every((id) => LIMITS[id]) && Object.keys(LIMITS).length === METRIC_IDS.length);
  check("HOME_READY_JS 判 .mb-home-dock__item", /mb-home-dock__item/.test(HOME_READY_JS) && !/querySelectorAll\('\.mb-home-dock'\)/.test(HOME_READY_JS));
  check("COMPOSER_READY_JS 判可见 contenteditable", /contenteditable=true/.test(COMPOSER_READY_JS) && /mobile-qn-composer/.test(COMPOSER_READY_JS));
  check("键盘判据是 innerHeight 收缩", /innerHeight/.test(keyboardStateJs(842)) && /-200/.test(keyboardStateJs(842)));
  check("usage 含关键开关", ["--record", "--compare", "--rounds", "--json", "--self-check"].every((f) => usage().includes(f)));
  const parsed = parseArgs(["--rounds", "4", "--only", "coldStartToHome"]);
  check("parseArgs 正常", parsed.rounds === 4 && parsed.only.join(",") === "coldStartToHome");
  let rejected = false;
  try { parseArgs(["--rounds", "2"]); } catch { rejected = true; }
  check("parseArgs 拒绝 rounds<3", rejected);
  let rejectedDoc = false;
  try { parseArgs(["--only", "docOpenToContent"]); } catch { rejectedDoc = true; }
  check("parseArgs 拒绝未开 --with-doc-open 的 doc 指标", rejectedDoc);
  const aliased = parseArgs(["--only", "keyboard,hotOpen", "--with-doc-open"]);
  check("--only 简写展开（keyboard→两项，with-doc-open 补 doc）", aliased.only.join(",") === "keyboardOpenLongTasks,keyboardCloseLongTasks,composerHotToInput,docOpenToContent");
  return { ok: true, probe: PROBE, checks: checks.length, limits: Object.keys(LIMITS), metrics: METRIC_IDS };
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

let exitCode = 0;
try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
  } else if (opts.selfCheck) {
    const result = selfCheck();
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else console.log("[perf] 自检通过：" + result.checks + " 项（无设备）");
  } else {
    const run = await runMetrics(opts);
    let baselineCompare = null;
    if (opts.mode === "compare") {
      const baseline = loadBaseline(opts.baseline);
      if (!baseline) throw Object.assign(new Error("基线不存在：" + opts.baseline + " ⇒ 先跑 --record（在目标 AVD 上）"), { exitCode: 2 });
      baselineCompare = compareWithBaseline(baseline, run, opts);
    }
    const report = assembleReport({ mode: opts.mode, opts, run, baselineCompare });
    if (opts.mode === "record") {
      fs.mkdirSync(path.dirname(opts.baseline), { recursive: true });
      fs.writeFileSync(opts.baseline, JSON.stringify(report, null, 2) + "\n");
    }
    if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else printHuman(report);
    if (!report.ok) exitCode = 1;
  }
} catch (error) {
  const code = error && error.exitCode ? error.exitCode : 1;
  console.error("[perf] 失败：" + (error && error.message ? error.message : String(error)));
  if (process.env.PERF_DEBUG === "1" && error && error.stack) console.error(error.stack);
  exitCode = code;
}
process.exit(exitCode);
