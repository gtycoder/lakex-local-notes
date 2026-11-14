#!/usr/bin/env node
/**
 * S3 多端回归入口（可重复 / 可交接）
 * =====================================================================
 * 把 scripts/multi-end-sync/ 里的临时脚本收敛成一条命令：
 *   1. 参数/端口/目录/依赖自检（--dry-run，不访问网络、不启动实例）；
 *   2. 生成唯一前缀（默认 audit-<UTC 时间戳>-<随机>，--prefix 可覆盖）；
 *   3. 启动 N 个隔离桌面实例（LAKE_USER_DATA / LAKE_ASSET_PORT / CDP 端口全部独立）；
 *   4. 统一配置真实 S3（S3_* 或 S3_ENV_FILE）或 --loopback 内存 S3；
 *   5. 按 --scenarios 跑 A–K 中已固化的桌面多端场景（默认 A,B）；
 *   6. 断言失败 ⇒ 退出码 1；参数/前置失败 ⇒ 2；中断 ⇒ 130；
 *   7. 无论成功/失败/中断都：删本前缀 → ListObjectsV2 复核 0 残留 → 关本脚本启动的实例。
 *
 * 数据安全：只写 /tmp（或 --logs-dir/--userdata-root）；绝不触碰正式数据目录
 * ~/Library/Application Support/lakex-local-notes；只 kill 本脚本 spawn 的子进程。
 * 凭据：只从环境变量 / S3_ENV_FILE 读，不打印、不写入仓库/报告。
 *
 * 事实来源：docs/audit-261112/21-s3-multi-end-mobile.md（A–K 场景与方法）；
 * 移动端/真机步骤不在本入口内（见 README「移动端」），--with-mobile 明确报未实现。
 */
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { connect } from "./cdpclient.mjs";
import { startLoopbackS3 } from "./loopback-s3.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const REPORT_SCHEMA = 1;
const DEFAULT_CDP_BASE = Number(process.env.LAKE_REGRESSION_CDP_BASE || 9242);
const DEFAULT_ASSET_BASE = Number(process.env.LAKE_REGRESSION_ASSET_BASE || 19891);
const DEFAULT_DEV_SERVER = process.env.LAKE_DEV_SERVER_URL || "http://127.0.0.1:1421";
const PNG_1X1_A = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_1X1_B = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (value) => JSON.stringify(value);
const shortError = (error) => String((error && (error.stack || error.message)) || error).split("\n").slice(0, 4).join(" / ");
const stampOf = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const USAGE = [
  "用法: node scripts/multi-end-sync/regression.mjs [选项]",
  "",
  "  --list                    列出已固化场景（不启动任何东西）",
  "  --dry-run                 参数/端口/目录/依赖自检；不访问网络、不启动实例，退出 0",
  "  --scenarios A,B           选择场景（默认 A,B；all = 全部 2 端场景 + K 需 --instances 3）",
  "  --instances 2|3           桌面实例数（默认 2；K 需要 3）",
  "  --prefix <p>              覆盖唯一前缀（默认 audit-<UTC时间>-<随机>；非 audit- 前缀需 --allow-unsafe-prefix）",
  "  --loopback                用本机内存 S3（scripts/multi-end-sync/loopback-s3.mjs）跑冒烟，不需要真实凭据",
  "  --env-file <path>         从 env 文件读 S3_*（也可用 S3_ENV_FILE；文件不得入库）",
  "  --cdp-base <n>            桌面 CDP 起始端口（默认 9242，实例依次 +1）",
  "  --asset-base <n>          资源服务起始端口（默认 19891，实例依次 +1）",
  "  --dev-server <url>        vite dev server URL（默认 http://127.0.0.1:1421）",
  "  --no-start-vite           dev server 未运行时直接报错（默认尝试自动启动 npx vite）",
  "  --logs-dir <dir>          日志/报告目录（默认 <tmp>/lakex-s3reg-<时间戳>）",
  "  --userdata-root <dir>     实例隔离数据根（默认 <tmp>/lakex-s3reg-<时间戳>/instances）",
  "  --timeout <ms>            启动/等待单步超时（默认 120000）",
  "  --keep                    结束后保留实例与数据目录（排障用；前缀仍会清理）",
  "  --keep-cloud              结束后不删云端前缀（危险；默认一定删并复核 0 残留）",
  "  --allow-unsafe-prefix     允许非 audit- 前缀（默认拒绝，防误删别的目录）",
  "  --with-mobile             预留：移动端/真机驱动未实现（本入口只固化桌面多实例）",
  "  -h, --help                显示本帮助",
  "",
  "凭据（不落仓库，二选一）：",
  "  export S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... S3_AK=... S3_SK=...",
  "  S3_ENV_FILE=/tmp/xxx/creds.env node scripts/multi-end-sync/regression.mjs ...",
  "",
  "示例：",
  "  node scripts/multi-end-sync/regression.mjs --list",
  "  node scripts/multi-end-sync/regression.mjs --dry-run",
  "  S3_ENV_FILE=/tmp/lake5/creds.env node scripts/multi-end-sync/regression.mjs --scenarios A,B",
  "  node scripts/multi-end-sync/regression.mjs --loopback --scenarios A,B",
  "  node scripts/multi-end-sync/regression.mjs --loopback --scenarios all --instances 3",
].join("\n");

function failUsage(message) {
  const error = new Error(message);
  error.usage = true;
  throw error;
}

function parseArgs(argv) {
  const opts = {
    list: false,
    dryRun: false,
    withMobile: false,
    loopback: false,
    keep: false,
    keepCloud: false,
    allowUnsafePrefix: false,
    startVite: true,
    scenarios: "A,B",
    instances: 2,
    prefix: null,
    envFile: null,
    cdpBase: DEFAULT_CDP_BASE,
    assetBase: DEFAULT_ASSET_BASE,
    devServer: DEFAULT_DEV_SERVER,
    logsDir: null,
    userdataRoot: null,
    timeoutMs: 120_000,
    help: false,
  };
  const takeValue = (i, name) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) failUsage(name + " 缺少取值");
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--list": opts.list = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--with-mobile": opts.withMobile = true; break;
      case "--loopback": opts.loopback = true; break;
      case "--keep": opts.keep = true; break;
      case "--keep-cloud": opts.keepCloud = true; break;
      case "--allow-unsafe-prefix": opts.allowUnsafePrefix = true; break;
      case "--no-start-vite": opts.startVite = false; break;
      case "--scenarios": opts.scenarios = takeValue(i, "--scenarios"); i++; break;
      case "--instances": opts.instances = Number(takeValue(i, "--instances")); i++; break;
      case "--prefix": opts.prefix = takeValue(i, "--prefix"); i++; break;
      case "--env-file": opts.envFile = takeValue(i, "--env-file"); i++; break;
      case "--cdp-base": opts.cdpBase = Number(takeValue(i, "--cdp-base")); i++; break;
      case "--asset-base": opts.assetBase = Number(takeValue(i, "--asset-base")); i++; break;
      case "--dev-server": opts.devServer = takeValue(i, "--dev-server"); i++; break;
      case "--logs-dir": opts.logsDir = takeValue(i, "--logs-dir"); i++; break;
      case "--userdata-root": opts.userdataRoot = takeValue(i, "--userdata-root"); i++; break;
      case "--timeout": opts.timeoutMs = Number(takeValue(i, "--timeout")); i++; break;
      case "-h": case "--help": opts.help = true; break;
      default: failUsage("未知参数: " + arg);
    }
  }
  if (![2, 3].includes(opts.instances)) failUsage("--instances 只支持 2 或 3");
  if (!Number.isFinite(opts.cdpBase) || opts.cdpBase < 1024 || opts.cdpBase > 65000) failUsage("--cdp-base 无效");
  if (!Number.isFinite(opts.assetBase) || opts.assetBase < 1024 || opts.assetBase > 65000) failUsage("--asset-base 无效");
  if (opts.logsDir) opts.logsDir = path.resolve(opts.logsDir);
  if (opts.userdataRoot) opts.userdataRoot = path.resolve(opts.userdataRoot);
  return opts;
}

// ---------------------------------------------------------------------------
// 凭据 / 前缀
// ---------------------------------------------------------------------------
function loadEnvFile(file) {
  const out = {};
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function resolveCreds(opts) {
  const envFile = opts.envFile || process.env.S3_ENV_FILE || null;
  let source = "env";
  if (envFile) {
    const abs = path.resolve(envFile);
    if (!fs.existsSync(abs)) return { error: "S3 env 文件不存在: " + abs };
    const loaded = loadEnvFile(abs);
    for (const [key, value] of Object.entries(loaded)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    source = "env-file:" + abs;
  }
  const missing = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_AK", "S3_SK"].filter((key) => !process.env[key]);
  if (missing.length) return { missing, source };
  const endpoint = process.env.S3_ENDPOINT.trim();
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "1" || /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(endpoint);
  return {
    source,
    cfg: {
      endpoint,
      region: process.env.S3_REGION.trim(),
      bucket: process.env.S3_BUCKET.trim(),
      accessKeyId: process.env.S3_AK.trim(),
      secretAccessKey: process.env.S3_SK.trim(),
      forcePathStyle,
    },
  };
}

function validatePrefix(opts) {
  const prefix = opts.prefix || "audit-" + stampOf() + "-" + Math.random().toString(36).slice(2, 6);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(prefix)) throw new Error("前缀非法（只允许字母/数字/._-，≤101 字符）: " + prefix);
  if (!prefix.startsWith("audit-") && !opts.allowUnsafePrefix) {
    throw new Error("拒绝清理非 audit- 前缀: " + prefix + "（确实要删这个前缀请加 --allow-unsafe-prefix）");
  }
  return prefix;
}

// ---------------------------------------------------------------------------
// 场景清单（A–K 的桌面多实例口径；移动端见 README）
// ---------------------------------------------------------------------------
const SCENARIOS = {
  A: {
    title: "文档创建 + 正文 + 资产传播（D1→D2，云对象/声明齐全）",
    ends: 2,
    run: runScenarioA,
  },
  B: {
    title: "编辑 + 移动：位置不被远端编辑回滚",
    ends: 2,
    run: runScenarioB,
  },
  C: {
    title: "本地移入回收站（未同步）× 他端编辑：不整轮失败/不隐式恢复",
    ends: 2,
    run: runScenarioC,
  },
  D: {
    title: "本机 purge → 云端缺席 → 对端保留「云端已删除·仅本地」回收站副本",
    ends: 2,
    run: runScenarioD,
  },
  E: {
    title: "恢复历史版本只改正文、不把文档移出回收站",
    ends: 2,
    run: runScenarioE,
  },
  F: {
    title: "编辑锁跨端传播 + 云端锁字段一致（UI 保存拦截见既有护栏，不在本入口驱动 UI）",
    ends: 2,
    run: runScenarioF,
  },
  I: {
    title: "资产双向追加：两端 note-assets 文件与云端对象齐全",
    ends: 2,
    run: runScenarioI,
  },
  J: {
    title: "断网/错误 endpoint 中途失败 → 恢复后两端正文逐字节一致",
    ends: 2,
    run: runScenarioJ,
  },
  K: {
    title: "三端 建→改→删：三端都进回收站、云端 trashedAt 非空、编辑侧留档",
    ends: 3,
    run: runScenarioK,
  },
};
const DEFAULT_SCENARIO_ORDER = ["A", "B", "C", "D", "E", "F", "I", "J"];

function resolveScenarioIds(opts) {
  let ids;
  let skipNote = null;
  if (opts.scenarios.trim().toLowerCase() === "all") {
    ids = [...DEFAULT_SCENARIO_ORDER];
    if (opts.instances >= 3) ids.push("K");
    else skipNote = "K 需要 --instances 3，已跳过";
  } else {
    ids = opts.scenarios.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  }
  if (ids.length === 0) failUsage("--scenarios 不能为空");
  for (const id of ids) {
    if (!SCENARIOS[id]) failUsage("未知场景: " + id + "（可用: " + Object.keys(SCENARIOS).join(",") + "）");
    if (SCENARIOS[id].ends > opts.instances) failUsage("场景 " + id + " 需要 " + SCENARIOS[id].ends + " 个桌面实例（当前 --instances " + opts.instances + "）");
  }
  return { ids, skipNote };
}

// ---------------------------------------------------------------------------
// 基础设施检查
// ---------------------------------------------------------------------------
function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function pickInstancePorts(opts) {
  const cdp = [];
  const asset = [];
  const busy = [];
  for (let i = 0; i < opts.instances; i++) {
    const c = opts.cdpBase + i;
    const a = opts.assetBase + i;
    if (await portFree(c)) cdp.push(c); else busy.push("CDP " + c);
    if (await portFree(a)) asset.push(a); else busy.push("asset " + a);
  }
  return { cdp, asset, busy };
}

function loadAwsSdk() {
  try {
    const requireFromRepo = createRequire(path.join(REPO_ROOT, "package.json"));
    return { sdk: requireFromRepo("@aws-sdk/client-s3"), error: null };
  } catch (error) {
    return { sdk: null, error };
  }
}

async function httpStatus(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

function checkDirs() {
  const tmp = os.tmpdir();
  const issues = [];
  let probe = null;
  try {
    probe = fs.mkdtempSync(path.join(tmp, "lakex-s3reg-check-"));
    fs.writeFileSync(path.join(probe, "probe"), "ok");
  } catch (error) {
    issues.push("临时目录不可写: " + shortError(error));
  } finally {
    if (probe) {
      try { fs.rmSync(probe, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return issues;
}

function electronBin() {
  return path.join(REPO_ROOT, "node_modules", ".bin", "electron");
}

function nodeBinDir() {
  return path.dirname(process.execPath);
}

function childEnv(extra) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = nodeBinDir() + path.delimiter + (env.PATH || "");
  return Object.assign(env, extra || {});
}

function tailFile(file, lines = 20) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------
function createLogger(logFile) {
  if (logFile) fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const write = (line) => {
    const text = "[" + new Date().toISOString().slice(11, 19) + "] " + line;
    process.stdout.write(text + "\n");
    if (logFile) {
      try { fs.appendFileSync(logFile, text + "\n"); } catch { /* 日志写失败不改变测试结果 */ }
    }
  };
  return {
    info: (message) => write(message),
    stage: (stage, message) => write("[" + stage + "] " + message),
    error: (message) => write("[ERROR] " + message),
  };
}

// ---------------------------------------------------------------------------
// 运行上下文
// ---------------------------------------------------------------------------
function createContext(opts, prefix, cfg) {
  const stamp = prefix.replace(/^audit-/, "").replace(/[^A-Za-z0-9._-]/g, "_");
  const logsDir = opts.logsDir || path.join(os.tmpdir(), "lakex-s3reg-" + stamp);
  const userdataRoot = opts.userdataRoot || path.join(logsDir, "instances");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(userdataRoot, { recursive: true });
  const logFile = path.join(logsDir, "regression.log");
  return {
    opts,
    prefix,
    cfg,
    logsDir,
    userdataRoot,
    logFile,
    log: createLogger(logFile),
    checks: [],
    scenarioTimings: [],
    instances: [],
    s3: null,
    loopback: null,
    devServer: null,
    startedAt: new Date().toISOString(),
    interrupted: false,
    cleaned: false,
    cleanupResult: null,
    fatal: null,
    check(scenario, name, ok, detail) {
      const row = { scenario, name, ok: !!ok, detail: detail === undefined ? "" : String(detail) };
      this.checks.push(row);
      this.log.info("[" + scenario + "] " + (row.ok ? "PASS" : "FAIL") + " " + name + (row.detail ? " | " + row.detail : ""));
      return row.ok;
    },
    scenarioCount(id) {
      return this.checks.filter((row) => row.scenario === id).length;
    },
    scenarioFailures(id) {
      return this.checks.filter((row) => row.scenario === id && !row.ok).length;
    },
  };
}

function createS3Client(sdk, cfg) {
  return new sdk.S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: cfg.forcePathStyle,
    maxAttempts: 3,
  });
}

async function listPrefixKeys(ctx, prefix) {
  const out = [];
  let token;
  do {
    const result = await ctx.s3.send(new ctx.sdk.ListObjectsV2Command({
      Bucket: ctx.cfg.bucket,
      Prefix: prefix,
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const item of result.Contents || []) if (item.Key) out.push(item.Key);
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function getCloudJson(ctx, rel) {
  const result = await ctx.s3.send(new ctx.sdk.GetObjectCommand({ Bucket: ctx.cfg.bucket, Key: ctx.prefix + "/" + rel }));
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  const raw = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes;
  return JSON.parse(raw.toString("utf8"));
}

async function cloudOf(ctx) {
  const pointer = await getCloudJson(ctx, "meta/pointer.json");
  const lake = await getCloudJson(ctx, "meta/index/" + pointer.lake.commit + ".json");
  let quick = null;
  if (pointer.quickNotes && pointer.quickNotes.commit) {
    try { quick = await getCloudJson(ctx, "quick-notes/meta/index/" + pointer.quickNotes.commit + ".json"); } catch { /* 小记索引可空 */ }
  }
  return { pointer, lake, quick };
}

// ---------------------------------------------------------------------------
// 页面（CDP）helpers
// ---------------------------------------------------------------------------
const ev = (session, expression) => session.ev(expression);

function settingsExpr(ctx, patch) {
  const cfg = Object.assign({
    endpoint: ctx.cfg.endpoint,
    region: ctx.cfg.region,
    bucket: ctx.cfg.bucket,
    prefix: ctx.prefix,
    accessKeyId: ctx.cfg.accessKeyId,
    secretAccessKey: ctx.cfg.secretAccessKey,
    forcePathStyle: ctx.cfg.forcePathStyle,
  }, patch || {});
  return "window.lakeNative.saveS3Settings(" + js(cfg) + ")";
}

function uploadResourceExpr(noteId, filename, base64) {
  return "(function(){var b=atob(" + js(base64) + ");var a=new Uint8Array(b.length);" +
    "for(var i=0;i<b.length;i++){a[i]=b.charCodeAt(i);}" +
    "return window.lakeNative.uploadResource({bytes:a,filename:" + js(filename) + "}," + js(noteId) + ");})()";
}

async function listTree(end) {
  return (await ev(end.session, "window.lakeNative.listTreeNodes()")) || [];
}

async function readNoteDoc(end, noteId) {
  try {
    return await ev(end.session, "window.lakeNative.readNote(" + js(noteId) + ")");
  } catch {
    return null;
  }
}

async function readBody(end, noteId) {
  const doc = await readNoteDoc(end, noteId);
  return doc ? doc.content : null;
}

async function saveBody(end, noteId, title, body) {
  return ev(end.session, "window.lakeNative.saveNote(" + js(noteId) + "," + js(title) + "," + js(body) + ")");
}

async function listTrash(end) {
  return (await ev(end.session, "window.lakeNative.listTrash()")) || [];
}

function trashItemOf(items, noteId) {
  return (items || []).find((item) => item.id === noteId) || null;
}

async function parentOf(end, noteId) {
  const tree = await listTree(end);
  return tree.find((node) => node.id === noteId)?.parentId ?? null;
}

async function ensureNotebook(ctx, end) {
  const tree = await listTree(end);
  const existing = tree.find((node) => node.nodeType === "notebook");
  if (existing) return existing.id;
  const created = await ev(end.session, "window.lakeNative.createNotebook(" + js("回归笔记本") + ")");
  if (!created || !created.id) throw new Error("创建回归笔记本失败");
  return created.id;
}

async function createNoteIn(ctx, end, parentId, title) {
  const created = await ev(end.session, "window.lakeNative.createNoteIn(" + js(parentId) + "," + js(title) + ")");
  if (!created || !created.id) throw new Error("创建文档失败: " + title);
  return created.id;
}

async function syncEnd(end) {
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await ev(end.session, "window.lakeNative.syncNow()");
      return { ok: true, result, attempts: attempt, ms: Date.now() - startedAt };
    } catch (error) {
      const message = String((error && error.message) || error);
      const busy = /lock-busy|正在发布同步|正在发布|lock busy/i.test(message);
      if (!busy || attempt === 3) return { ok: false, err: message, attempts: attempt, ms: Date.now() - startedAt };
      await sleep(600 * attempt);
    }
  }
  return { ok: false, err: "unreachable", attempts: 3, ms: Date.now() - startedAt };
}

function syncBrief(result) {
  if (!result) return "";
  if (!result.ok) return "ERR " + String(result.err).slice(0, 220) + (result.attempts > 1 ? " (attempts=" + result.attempts + ")" : "");
  const value = result.result || {};
  return "up=" + value.uploaded + " down=" + value.downloaded + " conflicts=" + value.conflicts;
}

function warningsOf(result) {
  return result && result.ok && Array.isArray(result.result.warnings) ? result.result.warnings : [];
}

async function syncCheck(ctx, scenario, label, end) {
  const result = await syncEnd(end);
  ctx.check(scenario, label, result.ok, syncBrief(result));
  return result;
}

async function syncMany(ctx, scenario, ends, order) {
  const out = {};
  for (const end of order || ends) out[end.id] = await syncEnd(end);
  for (const end of order || ends) {
    ctx.check(scenario, end.id + " 同步成功", out[end.id].ok, syncBrief(out[end.id]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 场景实现（全部只动 /tmp 隔离数据 + 本前缀云对象）
// ---------------------------------------------------------------------------
async function runScenarioA(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "A-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  const uploaded = await ev(d1.session, uploadResourceExpr(noteId, "a.png", PNG_1X1_A));
  ctx.check("A", "上传图片资产成功", !!(uploaded && uploaded.url && uploaded.filename), uploaded ? uploaded.filename : "null");
  const body = "<p>A-body-v1</p><p><img src=\"" + (uploaded ? uploaded.url : "") + "\"></p>";
  await saveBody(d1, noteId, tag, body);
  await syncCheck(ctx, "A", "D1 同步成功", d1);
  await syncCheck(ctx, "A", "D2 同步成功", d2);
  const d1Body = await readBody(d1, noteId);
  const d2Body = await readBody(d2, noteId);
  ctx.check("A", "D1 正文含 A-body-v1", typeof d1Body === "string" && d1Body.includes("A-body-v1"), String(d1Body).slice(0, 80));
  ctx.check("A", "D2 正文与 D1 逐字节一致", d1Body === d2Body, "d2len=" + String(d2Body).length + " d1len=" + String(d1Body).length);
  const d2paths = await ev(d2.session, "window.lakeNative.getNotePaths(" + js(noteId) + ")");
  const d2Asset = !!(d2paths && uploaded && fs.existsSync(path.join(d2paths.assetsDir, uploaded.filename)));
  ctx.check("A", "D2 落盘附件文件", d2Asset, d2paths ? d2paths.assetsDir : "no paths");
  const lake = (await cloudOf(ctx)).lake;
  ctx.check("A", "云端索引含该文档", (lake.notes || []).some((item) => item.id === noteId));
  const assetKeys = await listPrefixKeys(ctx, ctx.prefix + "/assets/" + noteId + "/");
  ctx.check("A", "云端存在该文档资产对象", assetKeys.length >= 1, JSON.stringify(assetKeys));
  const declKeys = await listPrefixKeys(ctx, ctx.prefix + "/meta/assets/" + noteId + "/");
  ctx.check("A", "云端存在资产声明", declKeys.length >= 1, JSON.stringify(declKeys));
}

async function runScenarioB(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "B-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const destination = (await ev(d1.session, "window.lakeNative.createNotebook(" + js("B-dst-" + tag) + ")")).id;
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  await saveBody(d1, noteId, tag, "<p>B-v1</p>");
  await syncMany(ctx, "B", ctx.instances.slice(0, 2));
  await ev(d1.session, "window.lakeNative.moveTreeNodeOrdered(" + js(noteId) + "," + js(destination) + "," + js([noteId]) + ")");
  await saveBody(d1, noteId, tag, "<p>B-v2-edited</p>");
  await syncCheck(ctx, "B", "D1 移动+编辑后同步成功", d1);
  await syncCheck(ctx, "B", "D2 拉取成功", d2);
  ctx.check("B", "D2 正文=他端编辑", (await readBody(d2, noteId)) === "<p>B-v2-edited</p>", String(await readBody(d2, noteId)).slice(0, 60));
  ctx.check("B", "D2 位置=移动后的笔记本（不被编辑回滚）", (await parentOf(d2, noteId)) === destination);
  let lake = (await cloudOf(ctx)).lake;
  ctx.check("B", "云端 parentId=移动后笔记本", ((lake.notes || []).find((item) => item.id === noteId) || {}).parentId === destination);
  await saveBody(d2, noteId, tag, "<p>B-v3-by-D2</p>");
  await syncCheck(ctx, "B", "D2 编辑后同步成功", d2);
  await syncCheck(ctx, "B", "D1 拉取 D2 编辑成功", d1);
  ctx.check("B", "D1 正文=D2 编辑", (await readBody(d1, noteId)) === "<p>B-v3-by-D2</p>", String(await readBody(d1, noteId)).slice(0, 60));
  ctx.check("B", "D1 位置仍=移动后的笔记本", (await parentOf(d1, noteId)) === destination);
  lake = (await cloudOf(ctx)).lake;
  ctx.check("B", "云端 parentId 仍是移动后笔记本", ((lake.notes || []).find((item) => item.id === noteId) || {}).parentId === destination);
}

async function runScenarioC(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "C-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  await saveBody(d1, noteId, tag, "<p>C-v1</p>");
  await syncMany(ctx, "C", ctx.instances.slice(0, 2));
  await ev(d2.session, "window.lakeNative.deleteNote(" + js(noteId) + ")"); // D2 本地删除（未同步）
  await saveBody(d1, noteId, tag, "<p>C-v2-by-D1</p>");
  await syncCheck(ctx, "C", "D1 发布编辑成功", d1);
  const d2Round = await syncEnd(d2);
  ctx.check("C", "D2 同步不整轮失败", d2Round.ok, syncBrief(d2Round));
  ctx.check("C", "D2 正文应用他端编辑", (await readBody(d2, noteId)) === "<p>C-v2-by-D1</p>", String(await readBody(d2, noteId)).slice(0, 60));
  ctx.check("C", "D2 仍在回收站（不隐式恢复）", !!trashItemOf(await listTrash(d2), noteId));
  await syncCheck(ctx, "C", "D1 拉取回收站状态成功", d1);
  ctx.check("C", "D1 跟随进回收站", !!trashItemOf(await listTrash(d1), noteId));
  const lake = (await cloudOf(ctx)).lake;
  const entry = (lake.notes || []).find((item) => item.id === noteId) || null;
  ctx.check("C", "云端 trashedAt 非空", !!entry && !!entry.trashedAt, entry ? String(entry.trashedAt) : "missing");
}

async function runScenarioD(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "D-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  await saveBody(d1, noteId, tag, "<p>D-body</p>");
  await syncMany(ctx, "D", ctx.instances.slice(0, 2));
  await ev(d1.session, "window.lakeNative.deleteNote(" + js(noteId) + ")");
  await syncCheck(ctx, "D", "D1 删除后同步成功", d1);
  await syncCheck(ctx, "D", "D2 拉取删除成功", d2);
  await ev(d1.session, "window.lakeNative.purgeTrash(" + js(noteId) + ")");
  await syncCheck(ctx, "D", "D1 purge 后同步成功", d1);
  await syncCheck(ctx, "D", "D2 感知云端删除（第 1 轮）", d2);
  await syncCheck(ctx, "D", "D2 感知云端删除（第 2 轮）", d2);
  let lake = (await cloudOf(ctx)).lake;
  ctx.check("D", "云端索引不含该 id", !(lake.notes || []).some((item) => item.id === noteId) && !(lake.folders || []).some((item) => item.id === noteId));
  const d2Trash = trashItemOf(await listTrash(d2), noteId);
  ctx.check("D", "D2 回收站保留副本", !!d2Trash, d2Trash ? "cloudDeleted=" + String(d2Trash.cloudDeleted) : "missing");
  ctx.check("D", "D2 副本标 cloudDeleted", !!d2Trash && d2Trash.cloudDeleted === true);
  const d2Body = await readBody(d2, noteId);
  ctx.check("D", "D2 副本正文可读", typeof d2Body === "string" && d2Body.length > 0, String(d2Body).slice(0, 40));
  await syncCheck(ctx, "D", "D2 再同步不回传成功", d2);
  lake = (await cloudOf(ctx)).lake;
  ctx.check("D", "再同步后云端仍无该 id", !(lake.notes || []).some((item) => item.id === noteId));
  ctx.check("D", "D1 回收站已无该 id", !trashItemOf(await listTrash(d1), noteId));
}

async function runScenarioE(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "E-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  await saveBody(d1, noteId, tag, "<p>E-v1</p>");
  const d1Snapshot = await ev(d1.session, "window.lakeNative.createHistorySnapshot(" + js(noteId) + "," + js("<p>E-v1</p>") + ",true)");
  ctx.check("E", "D1 建立 E-v1 历史快照", typeof d1Snapshot === "number", String(d1Snapshot));
  await syncMany(ctx, "E", ctx.instances.slice(0, 2));
  const d2Snapshot = await ev(d2.session, "window.lakeNative.createHistorySnapshot(" + js(noteId) + "," + js("<p>E-v1</p>") + ",true)");
  ctx.check("E", "D2 建立本机 E-v1 历史快照", typeof d2Snapshot === "number", String(d2Snapshot));
  await saveBody(d1, noteId, tag, "<p>E-v2</p>");
  await syncMany(ctx, "E", ctx.instances.slice(0, 2));
  await ev(d1.session, "window.lakeNative.deleteNote(" + js(noteId) + ")");
  await syncCheck(ctx, "E", "D1 删除后同步成功", d1);
  await syncCheck(ctx, "E", "D2 拉取回收站成功", d2);
  ctx.check("E", "D2 同步后已在回收站", !!trashItemOf(await listTrash(d2), noteId));
  if (typeof d2Snapshot === "number") {
    await ev(d2.session, "window.lakeNative.restoreHistory(" + js(d2Snapshot) + ")");
    await syncCheck(ctx, "E", "D2 恢复历史后同步成功", d2);
    await syncCheck(ctx, "E", "D1 拉取恢复结果成功", d1);
    ctx.check("E", "D2 正文回到 E-v1", (await readBody(d2, noteId)) === "<p>E-v1</p>", String(await readBody(d2, noteId)).slice(0, 60));
    ctx.check("E", "D1 正文回到 E-v1", (await readBody(d1, noteId)) === "<p>E-v1</p>", String(await readBody(d1, noteId)).slice(0, 60));
  }
  ctx.check("E", "D1 仍在回收站（恢复历史不改生命周期）", !!trashItemOf(await listTrash(d1), noteId));
  ctx.check("E", "D2 仍在回收站", !!trashItemOf(await listTrash(d2), noteId));
  const lake = (await cloudOf(ctx)).lake;
  const entry = (lake.notes || []).find((item) => item.id === noteId) || null;
  ctx.check("E", "云端 trashedAt 非空", !!entry && !!entry.trashedAt, entry ? String(entry.trashedAt) : "missing");
}

async function runScenarioF(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "F-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  await saveBody(d1, noteId, tag, "<p>F-v1</p>");
  await syncMany(ctx, "F", ctx.instances.slice(0, 2));
  await ev(d1.session, "window.lakeNative.setNoteLocked(" + js(noteId) + ",true)");
  await syncCheck(ctx, "F", "D1 加锁后同步成功", d1);
  await syncCheck(ctx, "F", "D2 拉取锁成功", d2);
  const d2Doc = await readNoteDoc(d2, noteId);
  ctx.check("F", "D2 readNote.isEditLocked=true", !!d2Doc && d2Doc.isEditLocked === true, d2Doc ? String(d2Doc.isEditLocked) : "null");
  const d2Info = await ev(d2.session, "window.lakeNative.getNoteInfo(" + js(noteId) + ")");
  ctx.check("F", "D2 getNoteInfo.isEditLocked=true", !!d2Info && d2Info.isEditLocked === true, d2Info ? String(d2Info.isEditLocked) : "null");
  const d1Doc = await readNoteDoc(d1, noteId);
  ctx.check("F", "两端 editLockedAt 一致", !!d2Doc && !!d1Doc && d1Doc.editLockedAt === d2Doc.editLockedAt,
    "d1=" + String(d1Doc?.editLockedAt) + " d2=" + String(d2Doc?.editLockedAt));
  await syncCheck(ctx, "F", "D2 再同步成功", d2);
  await syncCheck(ctx, "F", "D1 再同步成功", d1);
  const d2After = await readNoteDoc(d2, noteId);
  const lake = (await cloudOf(ctx)).lake;
  const entry = (lake.notes || []).find((item) => item.id === noteId) || null;
  ctx.check("F", "两轮后 D2 仍只读", !!d2After && d2After.isEditLocked === true);
  ctx.check("F", "云端索引 isLocked=true", !!entry && entry.isLocked === true, entry ? String(entry.isLocked) : "missing");
  ctx.check("F", "云端 lockedAt 与两端一致", !!entry && !!d2After && entry.lockedAt === d2After.editLockedAt,
    entry ? "cloud=" + String(entry.lockedAt) + " d2=" + String(d2After?.editLockedAt) : "missing");
}

async function runScenarioI(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "I-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  await saveBody(d1, noteId, tag, "<p>I-v1</p>");
  await syncMany(ctx, "I", ctx.instances.slice(0, 2));
  const first = await ev(d1.session, uploadResourceExpr(noteId, "i1.png", PNG_1X1_A));
  await saveBody(d1, noteId, tag, "<p>I-v1</p><p><img src=\"" + first.url + "\"></p>");
  await syncCheck(ctx, "I", "D1 追加资产后同步成功", d1);
  await syncCheck(ctx, "I", "D2 拉取资产成功", d2);
  const firstOnD2 = await ev(d2.session, "window.lakeNative.getNotePaths(" + js(noteId) + ")");
  ctx.check("I", "D2 落盘第 1 个资产", !!(firstOnD2 && fs.existsSync(path.join(firstOnD2.assetsDir, first.filename))), firstOnD2 ? firstOnD2.assetsDir : "no paths");
  const second = await ev(d2.session, uploadResourceExpr(noteId, "i2.png", PNG_1X1_B));
  const d2BodyBefore = await readBody(d2, noteId);
  await saveBody(d2, noteId, tag, d2BodyBefore + "<p><img src=\"" + second.url + "\"></p>");
  await syncCheck(ctx, "I", "D2 追加资产后同步成功", d2);
  await syncCheck(ctx, "I", "D1 拉取第 2 个资产成功", d1);
  for (const [end, label] of [[d1, "D1"], [d2, "D2"]]) {
    const paths = await ev(end.session, "window.lakeNative.getNotePaths(" + js(noteId) + ")");
    const has1 = !!paths && fs.existsSync(path.join(paths.assetsDir, first.filename));
    const has2 = !!paths && fs.existsSync(path.join(paths.assetsDir, second.filename));
    ctx.check("I", label + " 本地两个资产齐全", has1 && has2, "i1=" + has1 + " i2=" + has2);
  }
  const objectKeys = await listPrefixKeys(ctx, ctx.prefix + "/assets/" + noteId + "/");
  ctx.check("I", "云端两个资产对象齐全", objectKeys.length >= 2, JSON.stringify(objectKeys));
  const lake = (await cloudOf(ctx)).lake;
  ctx.check("I", "云端索引含该文档", (lake.notes || []).some((item) => item.id === noteId));
}

async function runScenarioJ(ctx) {
  const [d1, d2] = ctx.instances;
  const tag = "J-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteA = await createNoteIn(ctx, d1, notebook, tag + "-1");
  const noteB = await createNoteIn(ctx, d1, notebook, tag + "-2");
  await saveBody(d1, noteA, tag, "<p>J-a-v1</p>");
  await saveBody(d1, noteB, tag, "<p>J-b-v1</p>");
  await syncMany(ctx, "J", ctx.instances.slice(0, 2));
  await ev(d2.session, settingsExpr(ctx, { endpoint: "http://127.0.0.1:1" }));
  await saveBody(d2, noteA, tag, "<p>J-a-v2</p>");
  await saveBody(d2, noteB, tag, "<p>J-b-v2</p>");
  const offline = await syncEnd(d2);
  ctx.check("J", "错误 endpoint 轮失败且可分类（不静默成功）", !offline.ok, String(offline.err).slice(0, 160));
  await ev(d2.session, settingsExpr(ctx, {}));
  const online = await syncEnd(d2);
  ctx.check("J", "恢复 endpoint 后同步成功", online.ok, syncBrief(online));
  ctx.check("J", "恢复轮 warnings=0", online.ok && warningsOf(online).length === 0,
    JSON.stringify(warningsOf(online).map((warning) => warning.kind)));
  await syncCheck(ctx, "J", "D1 拉取成功", d1);
  for (const [noteId, expected] of [[noteA, "<p>J-a-v2</p>"], [noteB, "<p>J-b-v2</p>"]]) {
    ctx.check("J", "D1 正文一致 " + noteId.slice(0, 8), (await readBody(d1, noteId)) === expected, String(await readBody(d1, noteId)).slice(0, 40));
    ctx.check("J", "D2 正文一致 " + noteId.slice(0, 8), (await readBody(d2, noteId)) === expected, String(await readBody(d2, noteId)).slice(0, 40));
  }
  const lake = (await cloudOf(ctx)).lake;
  ctx.check("J", "云端含两篇文档", [noteA, noteB].every((id) => (lake.notes || []).some((item) => item.id === id)));
}

async function runScenarioK(ctx) {
  const [d1, d2, d3] = ctx.instances;
  const tag = "K-" + Date.now().toString(36).slice(-5);
  const notebook = await ensureNotebook(ctx, d1);
  const noteId = await createNoteIn(ctx, d1, notebook, tag);
  await saveBody(d1, noteId, tag, "<p>K-v1</p>");
  await syncMany(ctx, "K", ctx.instances);
  await saveBody(d2, noteId, tag, "<p>K-v2-by-D2</p>");
  await ev(d3.session, "window.lakeNative.deleteNote(" + js(noteId) + ")");
  await syncCheck(ctx, "K", "D3 先发布删除成功", d3);
  const d2Round = await syncEnd(d2);
  ctx.check("K", "D2（编辑 vs 远端缺席）同步不整轮失败", d2Round.ok, syncBrief(d2Round));
  await syncCheck(ctx, "K", "D1 同步成功", d1);
  await syncMany(ctx, "K", ctx.instances);
  const trashed = {
    D1: !!trashItemOf(await listTrash(d1), noteId),
    D2: !!trashItemOf(await listTrash(d2), noteId),
    D3: !!trashItemOf(await listTrash(d3), noteId),
  };
  ctx.check("K", "三端都在回收站（删除压编辑）", trashed.D1 && trashed.D2 && trashed.D3, JSON.stringify(trashed));
  const active = {
    D1: (await listTree(d1)).some((node) => node.id === noteId),
    D2: (await listTree(d2)).some((node) => node.id === noteId),
    D3: (await listTree(d3)).some((node) => node.id === noteId),
  };
  ctx.check("K", "三端都无活跃副本", !active.D1 && !active.D2 && !active.D3, JSON.stringify(active));
  const lake = (await cloudOf(ctx)).lake;
  const entry = (lake.notes || []).find((item) => item.id === noteId) || null;
  ctx.check("K", "云端 trashedAt 非空", !!entry && !!entry.trashedAt, entry ? String(entry.trashedAt) : "absent");
  const d2Body = await readBody(d2, noteId);
  ctx.check("K", "D2 回收站副本保留最后一次本地编辑正文", d2Body === "<p>K-v2-by-D2</p>", String(d2Body).slice(0, 60));
  const history = (await ev(d2.session, "window.lakeNative.listNoteHistory(" + js(noteId) + ")")) || [];
  ctx.check("K", "被删侧编辑强制留历史快照", history.length >= 1, "history=" + history.length);
}

// ---------------------------------------------------------------------------
// 实例生命周期
// ---------------------------------------------------------------------------
async function ensureDevServer(ctx) {
  const url = new URL(ctx.opts.devServer);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  let status = await httpStatus(ctx.opts.devServer).catch(() => 0);
  if (status === 200) {
    ctx.log.stage("start", "复用已运行的 dev server " + ctx.opts.devServer);
    return { started: false, url: ctx.opts.devServer };
  }
  if (!ctx.opts.startVite) throw new Error("dev server 不可达且指定了 --no-start-vite: " + ctx.opts.devServer);
  const logFile = path.join(ctx.logsDir, "vite.log");
  ctx.log.stage("start", "启动 vite " + ctx.opts.devServer + "（日志 " + logFile + "）");
  const out = fs.openSync(logFile, "a");
  const child = spawn(path.join(nodeBinDir(), "npx"), ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: REPO_ROOT,
    env: childEnv({}),
    stdio: ["ignore", out, out],
  });
  const deadline = Date.now() + ctx.opts.timeoutMs;
  while (Date.now() < deadline) {
    if (ctx.interrupted) throw new Error("收到中断信号（等待 vite 时）");
    if (child.exitCode !== null) throw new Error("vite 启动失败（exit=" + child.exitCode + "）\n" + tailFile(logFile));
    status = await httpStatus(ctx.opts.devServer).catch(() => 0);
    if (status === 200) {
      ctx.log.stage("start", "vite 就绪");
      return { started: true, child, url: ctx.opts.devServer, logFile };
    }
    await sleep(1000);
  }
  throw new Error("vite 启动超时（" + ctx.opts.timeoutMs + "ms）\n" + tailFile(logFile));
}

async function startInstance(ctx, id, cdpPort, assetPort) {
  const dir = path.join(ctx.userdataRoot, id.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(ctx.logsDir, id + "-electron.log");
  const out = fs.openSync(logFile, "a");
  const args = [];
  if (process.platform === "darwin") args.push("--use-angle=metal");
  args.push("--remote-debugging-port=" + cdpPort, ".");
  ctx.log.stage("start", "启动 " + id + " cdp=" + cdpPort + " asset=" + assetPort + " userData=" + dir);
  const child = spawn(electronBin(), args, {
    cwd: REPO_ROOT,
    env: childEnv({ LAKE_USER_DATA: dir, LAKE_ASSET_PORT: String(assetPort), LAKE_DEV_SERVER_URL: ctx.opts.devServer }),
    stdio: ["ignore", out, out],
  });
  const instance = { id, cdpPort, assetPort, dir, child, logFile, session: null, exit: null };
  child.on("exit", (code, signal) => {
    instance.exit = { code, signal };
    ctx.log.stage("instance", id + " 退出 code=" + code + " signal=" + signal);
  });
  ctx.instances.push(instance);
  return instance;
}

async function waitInstanceReady(ctx, instance) {
  const deadline = Date.now() + ctx.opts.timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (ctx.interrupted) throw new Error("收到中断信号（等待 " + instance.id + " CDP 时）");
    if (instance.exit) throw new Error(instance.id + " 提前退出 code=" + instance.exit.code + " signal=" + instance.exit.signal + "\n" + tailFile(instance.logFile));
    try {
      instance.session = await connect(instance.cdpPort, { waitMs: 5000, requestTimeoutMs: 60_000 });
      ctx.log.stage("start", instance.id + " CDP 就绪");
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error("等待 " + instance.id + " CDP 超时: " + shortError(lastError) + "\n" + tailFile(instance.logFile));
}

async function configureInstance(ctx, instance) {
  await ev(instance.session, settingsExpr(ctx, {}));
  const test = await ev(instance.session, "window.lakeNative.testS3Connection()");
  ctx.log.stage("start", instance.id + " S3 连接测试: " + String(test));
  const syncSettings = await ev(instance.session, "window.lakeNative.saveSyncSettings(" + js({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15 }) + ")");
  ctx.log.stage("start", instance.id + " 同步设置: enabled=" + String(syncSettings && syncSettings.enabled) + " mode=" + String(syncSettings && syncSettings.autoMode));
  const round = await syncEnd(instance);
  if (!round.ok) throw new Error(instance.id + " 首次同步失败: " + syncBrief(round));
  if (warningsOf(round).length) ctx.log.stage("start", instance.id + " 首次同步 warnings=" + JSON.stringify(warningsOf(round).map((warning) => warning.kind)));
}

async function startAll(ctx) {
  const ports = await pickInstancePorts(ctx.opts);
  if (ports.busy.length) throw new Error("端口被占用: " + ports.busy.join(", ") + "（用 --cdp-base/--asset-base 换端口）");
  ctx.opts.cdpPorts = ports.cdp;
  ctx.opts.assetPorts = ports.asset;
  for (let i = 0; i < ctx.opts.instances; i++) {
    await startInstance(ctx, "D" + (i + 1), ports.cdp[i], ports.asset[i]);
  }
  for (const instance of ctx.instances) await waitInstanceReady(ctx, instance);
  if (ctx.interrupted) throw new Error("收到中断信号（启动实例后）");
  for (const instance of ctx.instances) await configureInstance(ctx, instance);
}

async function stopChild(child, timeoutMs) {
  if (!child || child.exitCode !== null) return;
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && Date.now() < deadline) await sleep(200);
  if (child.exitCode === null) {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    await sleep(500);
  }
}

async function deletePrefix(ctx) {
  let deleted = 0;
  for (let round = 0; round < 5; round++) {
    let keys;
    try { keys = await listPrefixKeys(ctx, ctx.prefix + "/"); }
    catch (error) { return { deleted, residual: null, error: shortError(error) }; }
    if (keys.length === 0) break;
    for (let i = 0; i < keys.length; i += 1000) {
      await ctx.s3.send(new ctx.sdk.DeleteObjectsCommand({
        Bucket: ctx.cfg.bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((key) => ({ Key: key })), Quiet: true },
      }));
    }
    deleted += keys.length;
    await sleep(200);
  }
  try {
    const leftover = await listPrefixKeys(ctx, ctx.prefix + "/");
    return { deleted, residual: leftover.length, keys: leftover.slice(0, 5) };
  } catch (error) {
    return { deleted, residual: null, error: shortError(error) };
  }
}

async function cleanup(ctx) {
  if (ctx.cleaned) return ctx.cleanupResult;
  ctx.cleaned = true;
  const result = { instances: [], devServer: null, prefix: null, loopback: null, userDataCleaned: false, errors: [] };
  ctx.log.stage("cleanup", "开始清理（保留实例=" + ctx.opts.keep + " 保留云端前缀=" + ctx.opts.keepCloud + "）");
  for (const instance of ctx.instances) {
    try { instance.session?.close(); } catch { /* ignore */ }
    if (ctx.opts.keep) {
      result.instances.push({ id: instance.id, kept: true, pid: instance.child.pid, cdp: instance.cdpPort });
      continue;
    }
    await stopChild(instance.child, 8000);
    result.instances.push({ id: instance.id, pid: instance.child.pid, exitCode: instance.child.exitCode, signal: instance.child.signalCode });
    ctx.log.stage("cleanup", instance.id + " 已停止 pid=" + instance.child.pid + " exit=" + instance.child.exitCode);
  }
  if (ctx.devServer && ctx.devServer.started && ctx.devServer.child) {
    await stopChild(ctx.devServer.child, 8000);
    result.devServer = { stopped: true, pid: ctx.devServer.child.pid };
    ctx.log.stage("cleanup", "已停止本脚本启动的 vite");
  }
  if (!ctx.opts.keepCloud && ctx.s3) {
    const prefixResult = await deletePrefix(ctx);
    result.prefix = prefixResult;
    if (prefixResult.residual === 0) {
      ctx.log.stage("cleanup", "前缀 " + ctx.prefix + " 已删除 " + prefixResult.deleted + " 个对象，ListObjectsV2 残留=0");
    } else if (prefixResult.residual === null) {
      ctx.log.error("前缀清理/复核失败: " + prefixResult.error);
    } else {
      ctx.log.error("前缀残留 " + prefixResult.residual + " 个对象（示例 " + JSON.stringify(prefixResult.keys) + "）");
    }
  } else if (ctx.opts.keepCloud) {
    ctx.log.stage("cleanup", "按 --keep-cloud 跳过前缀删除（PREFIX=" + ctx.prefix + "，请手动清理）");
  }
  if (ctx.loopback) {
    try { await ctx.loopback.close(); } catch { /* ignore */ }
    result.loopback = { stopped: true };
  }
  if (!ctx.opts.keep) {
    try { fs.rmSync(ctx.userdataRoot, { recursive: true, force: true }); result.userDataCleaned = true; }
    catch (error) { result.errors.push("清理实例目录失败: " + shortError(error)); }
  }
  ctx.cleanupResult = result;
  return result;
}

// ---------------------------------------------------------------------------
// dry-run / list / help
// ---------------------------------------------------------------------------
function scenarioTable() {
  return Object.entries(SCENARIOS).map(([id, meta]) => ({
    id,
    title: meta.title,
    ends: meta.ends,
    default: DEFAULT_SCENARIO_ORDER.includes(id),
  }));
}

function printList() {
  console.log("场景清单（桌面多实例；移动端/真机不在本入口）：");
  for (const row of scenarioTable()) {
    console.log("  " + row.id.padEnd(2) + "  实例=" + row.ends + (row.default ? "  默认参与" : "        ") + "  " + row.title);
  }
  console.log("\n默认场景 = A,B；--scenarios all = A,B,C,D,E,F,I,J（K 需 --instances 3）。");
  console.log("移动端 A–K 手工方法见 docs/audit-261112/21-s3-multi-end-mobile.md；--with-mobile 明确报未实现。");
}

async function dryRun(opts) {
  const results = [];
  const record = (ok, level, name, detail) => {
    results.push({ ok, level, name, detail });
    console.log("[" + (ok ? "ok" : level) + "] " + name + (detail ? " | " + detail : ""));
  };
  console.log("== S3 多端回归自检（--dry-run）：不访问网络、不启动实例 ==");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  record(nodeMajor >= 24, "warn", "Node 版本", "v" + process.versions.node + (nodeMajor >= 24 ? "" : "（产品要求 Node 24）"));
  record(fs.existsSync(path.join(REPO_ROOT, "package.json")), "error", "仓库根", REPO_ROOT);
  record(fs.existsSync(electronBin()) && fs.statSync(electronBin()).isFile(), "error", "electron 可执行文件", electronBin());
  record(fs.existsSync(path.join(HERE, "cdpclient.mjs")), "error", "cdpclient.mjs", path.join(HERE, "cdpclient.mjs"));
  record(fs.existsSync(path.join(HERE, "loopback-s3.mjs")), "warn", "loopback-s3.mjs（--loopback 用）", path.join(HERE, "loopback-s3.mjs"));
  const sdk = loadAwsSdk();
  record(!!sdk.sdk, "error", "@aws-sdk/client-s3", sdk.sdk ? "可解析" : shortError(sdk.error));
  record(fs.existsSync(path.join(REPO_ROOT, "node_modules")), "error", "node_modules", path.join(REPO_ROOT, "node_modules"));
  const dirIssues = checkDirs();
  if (dirIssues.length) for (const issue of dirIssues) record(false, "error", "临时目录", issue);
  else record(true, "ok", "临时目录可写", os.tmpdir());
  const ports = await pickInstancePorts(opts);
  record(ports.busy.length === 0, "error", "实例端口", ports.busy.length ? ports.busy.join(", ") + " 被占用" : "CDP=" + ports.cdp.join("/") + " asset=" + ports.asset.join("/"));
  let devStatus = 0;
  try { devStatus = await httpStatus(opts.devServer); } catch { devStatus = 0; }
  record(devStatus === 200, "warn", "dev server", devStatus === 200 ? opts.devServer + " 可达（复用）" : opts.devServer + " 不可达，" + (opts.startVite ? "实跑会尝试自动启动 vite" : "且指定了 --no-start-vite"));
  let scenarioInfo;
  try { scenarioInfo = resolveScenarioIds(opts); }
  catch (error) { record(false, "error", "场景参数", shortError(error)); scenarioInfo = null; }
  if (scenarioInfo) {
    record(true, "ok", "场景选择", scenarioInfo.ids.join(",") + (scenarioInfo.skipNote ? "（" + scenarioInfo.skipNote + "）" : ""));
  }
  let prefix = null;
  try { prefix = validatePrefix(opts); record(true, "ok", "唯一前缀", prefix + "（实跑开始前会复核该前缀为空）"); }
  catch (error) { record(false, "error", "唯一前缀", shortError(error)); }
  if (opts.withMobile) record(false, "error", "--with-mobile", "未实现：本入口只固化桌面多实例；移动端步骤见 docs/audit-261112/21-s3-multi-end-mobile.md");
  if (opts.loopback) {
    record(true, "ok", "S3 来源", "内存 loopback（127.0.0.1 随机端口，无外部网络）");
  } else {
    const creds = resolveCreds(opts);
    if (creds.cfg) record(true, "ok", "S3 凭据", "来源=" + creds.source + " endpoint=" + creds.cfg.endpoint + " bucket=" + creds.cfg.bucket + " forcePathStyle=" + creds.cfg.forcePathStyle);
    else record(false, "warn", "S3 凭据", "缺少 " + creds.missing.join(",") + "（来源=" + creds.source + "）；dry-run 通过，实跑需要 S3_* 或 --loopback");
  }
  const errors = results.filter((row) => !row.ok && row.level === "error");
  const warnings = results.filter((row) => !row.ok && row.level === "warn");
  console.log("\nDRY-RUN " + (errors.length ? "有 ERROR（实跑会被拦下）" : warnings.length ? "OK（有 WARN）" : "OK") +
    ": error=" + errors.length + " warn=" + warnings.length + "，未访问网络、未启动实例、未写任何云端对象");
  if (scenarioInfo) console.log("将运行: " + scenarioInfo.ids.join(",") + "（实跑会自动启动实例，结束后删除前缀并复核 0 残留）");
  return 0;
}

function printHelp() {
  console.log(USAGE);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function execute(ctx, scenarioIds, skipNote) {
  ctx.log.stage("start", "S3 多端回归开始 prefix=" + ctx.prefix + " instances=" + ctx.opts.instances + " scenarios=" + scenarioIds.join(","));
  if (ctx.cfg) {
    ctx.log.stage("start", "S3 endpoint=" + ctx.cfg.endpoint + " bucket=" + ctx.cfg.bucket + " region=" + ctx.cfg.region + " forcePathStyle=" + ctx.cfg.forcePathStyle);
  }
  const sdk = loadAwsSdk();
  if (!sdk.sdk) throw new Error("@aws-sdk/client-s3 不可用: " + shortError(sdk.error));
  ctx.sdk = sdk.sdk;
  if (ctx.opts.loopback) {
    ctx.loopback = await startLoopbackS3({ bucket: "regression" });
    ctx.cfg = {
      endpoint: ctx.loopback.endpoint,
      region: ctx.loopback.region,
      bucket: ctx.loopback.bucket,
      accessKeyId: "loopback",
      secretAccessKey: "loopback",
      forcePathStyle: true,
    };
    ctx.log.stage("start", "loopback S3 已启动 " + ctx.cfg.endpoint);
  }
  ctx.s3 = createS3Client(sdk.sdk, ctx.cfg);
  const existing = await listPrefixKeys(ctx, ctx.prefix + "/");
  if (existing.length > 0) throw new Error("前缀 " + ctx.prefix + " 已有 " + existing.length + " 个对象，拒绝复用（换 --prefix 或先清理）");
  ctx.log.stage("start", "前缀复核为空");
  ctx.devServer = await ensureDevServer(ctx);
  await startAll(ctx);
  ctx.log.stage("start", "全部实例就绪，开始场景");
  for (const id of scenarioIds) {
    if (ctx.interrupted) break;
    const meta = SCENARIOS[id];
    const startedAt = Date.now();
    ctx.log.stage("scene", id + " 开始: " + meta.title);
    try {
      await meta.run(ctx);
    } catch (error) {
      ctx.check(id, "场景执行异常（基础设施/脚本错误）", false, shortError(error));
    }
    const ms = Date.now() - startedAt;
    ctx.scenarioTimings.push({ id, ms, checks: ctx.scenarioCount(id), failed: ctx.scenarioFailures(id) });
    ctx.log.stage("scene", id + " 结束 用时 " + ms + "ms checks=" + ctx.scenarioCount(id) + " failed=" + ctx.scenarioFailures(id));
  }
  if (skipNote) ctx.log.stage("scene", "跳过: " + skipNote);
}

function buildReport(ctx, fatal) {
  const checks = ctx.checks;
  const failed = checks.filter((row) => !row.ok);
  const scenarioTimings = ctx.scenarioTimings;
  const cleanupResult = ctx.cleanupResult || null;
  const cleanupOk = !!cleanupResult && (!cleanupResult.prefix || cleanupResult.prefix.residual === 0);
  let result = "PASS";
  if (ctx.interrupted) result = "INTERRUPTED";
  else if (fatal) result = "ERROR";
  else if (failed.length > 0 || !cleanupOk) result = "FAIL";
  return {
    schema: REPORT_SCHEMA,
    result,
    startedAt: ctx.startedAt,
    finishedAt: new Date().toISOString(),
    prefix: ctx.prefix,
    endpoint: ctx.cfg ? ctx.cfg.endpoint : null,
    bucket: ctx.cfg ? ctx.cfg.bucket : null,
    region: ctx.cfg ? ctx.cfg.region : null,
    loopback: !!ctx.opts.loopback,
    instances: ctx.instances.map((instance) => ({ id: instance.id, cdpPort: instance.cdpPort, assetPort: instance.assetPort })),
    scenarios: scenarioTimings,
    checks,
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
    cleanup: cleanupResult,
    cleanupOk,
    fatal: fatal ? shortError(fatal) : null,
    logFile: ctx.logFile,
    versions: { node: process.versions.node, electron: (() => { try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "node_modules/electron/package.json"), "utf8")).version; } catch { return null; } })() },
  };
}

function printSummary(ctx, report) {
  const failed = report.checks.filter((row) => !row.ok);
  console.log("\n================ S3 多端回归结果 ================");
  console.log("RESULT: " + report.result + (ctx.interrupted ? "（收到中断信号）" : ""));
  console.log("前缀: " + ctx.prefix + " | 实例: " + ctx.instances.length + " | 场景: " + report.scenarios.map((item) => item.id + "(" + item.ms + "ms)").join(" "));
  console.log("断言: " + report.summary.passed + "/" + report.summary.total + " PASS" + (failed.length ? "，" + failed.length + " FAIL" : ""));
  for (const row of failed) console.log("  FAIL [" + row.scenario + "] " + row.name + (row.detail ? " | " + row.detail : ""));
  if (report.cleanup && report.cleanup.prefix) {
    console.log("前缀清理: deleted=" + report.cleanup.prefix.deleted + " residual=" + String(report.cleanup.prefix.residual) + (report.cleanup.prefix.error ? " error=" + report.cleanup.prefix.error : ""));
  } else if (report.cleanup) {
    console.log("前缀清理: 已跳过（--keep-cloud）");
  }
  if (report.fatal) console.log("FATAL: " + report.fatal);
  console.log("日志: " + ctx.logFile);
  console.log("报告: " + path.join(ctx.logsDir, "report.json"));
  if (report.result !== "PASS") {
    console.log("排查建议: 先看日志末尾与 " + ctx.logsDir + "/D1-electron.log、D2-electron.log；端口/依赖问题用 --dry-run 复核。");
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error("参数错误: " + error.message);
    console.error(USAGE);
    return 2;
  }
  if (opts.help) { printHelp(); return 0; }
  if (opts.withMobile) {
    console.error("--with-mobile 未实现：本入口只固化桌面多实例回归。移动端/真机 A–K 步骤见 docs/audit-261112/21-s3-multi-end-mobile.md。");
    console.error("默认桌面 A/B 已通过 --scenarios A,B 覆盖同类同步断言；去掉该参数重跑。");
    return 2;
  }
  if (opts.list) { printList(); return 0; }
  let scenarioInfo;
  try { scenarioInfo = resolveScenarioIds(opts); }
  catch (error) { console.error("参数错误: " + error.message); return 2; }
  if (opts.dryRun) return dryRun(opts);

  // 实跑：先解析凭据/前缀，再建上下文（日志目录）——确保早期错误也有可读输出。
  let prefix;
  try { prefix = validatePrefix(opts); }
  catch (error) { console.error("参数错误: " + error.message); return 2; }
  let cfg = null;
  if (!opts.loopback) {
    const creds = resolveCreds(opts);
    if (!creds.cfg) {
      console.error("缺少 S3 凭据: " + (creds.missing || []).join(",") + "（来源=" + creds.source + "）。");
      console.error("真实桶用法: export S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_AK/S3_SK，或 S3_ENV_FILE=/path/creds.env ...；无凭据可先 --loopback 冒烟。");
      return 2;
    }
    cfg = creds.cfg;
  }
  const ctx = createContext(opts, prefix, cfg);
  const onSignal = () => {
    if (ctx.interrupted) { console.error("\n再次收到中断信号，立即退出（未清理）"); process.exit(130); }
    ctx.interrupted = true;
    ctx.log.stage("signal", "收到中断信号，将在当前步骤结束后清理前缀/实例并退出（再按一次强制退出且不清理）");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    await execute(ctx, scenarioInfo.ids, scenarioInfo.skipNote);
  } catch (error) {
    ctx.fatal = error;
    ctx.log.error("FATAL: " + shortError(error));
  }
  await cleanup(ctx);
  const report = buildReport(ctx, ctx.fatal);
  try { fs.writeFileSync(path.join(ctx.logsDir, "report.json"), JSON.stringify(report, null, 2)); }
  catch (error) { ctx.log.error("写报告失败: " + shortError(error)); }
  printSummary(ctx, report);
  if (ctx.interrupted) return 130;
  if (ctx.fatal) return 2;
  if (report.result !== "PASS") return 1;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("未捕获异常: " + shortError(error));
    process.exit(2);
  });
