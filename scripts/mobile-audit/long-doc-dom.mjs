#!/usr/bin/env node
/**
 * 移动端「长文档全量 DOM」探针（MOB-04 保守版，261028）。
 *
 * 为什么需要：移动端 DocumentEditor 恒传 disableVirtualRendering:true（因为自研 DOM 查找
 * 需要整篇正文在 DOM 里，见 src/mobile/editor/mobileFind.ts），于是长文档打开即全量建 DOM +
 * 全量水合卡片；桌面同一篇在**编辑态**走内核 virtualRendering。要不要为此重做查找，
 * 必须先有可复现的数字（审计 04-mobile.md MOB-04「保守版：先量化」）。
 *
 * 量什么（全部在页内取，避免 CDP 往返把耗时算进产品）：
 *   · document.querySelectorAll('*').length（全页节点数）与正文子树节点数
 *   · CDP Page.metrics（Nodes / JSHeapUsedSize / Documents / Layout·Script·TaskDuration 增量）
 *   · performance.memory（WebView 多数不可用 ⇒ 如实给 null）
 *   · 打开这篇文档产生的本地资产请求数/字节（Resource Timing，清空后重采）
 *   · 只读态、编辑态各一组；进编辑态的耗时/阶段成本单独一组
 *   · DOM 文本扫描耗时（与 MobileFindBar 的 TreeWalker 同构的近似口径，不含 Range/高亮）
 *
 * 数据从哪来：走产品自己的 window.lakeNative（createNote/saveNote/getHomeSnapshot/getCloudState）
 * ⇒ 不猜 DB/正文格式。图片按 docs/LAKE-CONTENT-WRITING.md 第 1 节第③条写成 card 容器
 * （绝不写裸 <img>：那会让内核把图当远程图片抓 → 失败回写 → 标脏 → 随同步上传）；
 * 资源文件走 Capacitor Filesystem 写进 note-assets/<noteId>/（与 assetFs.ts 同一目录布局），
 * 再由 App 的 AssetServer 提供。
 *
 * ⚠️ 只在**专用门禁实例**（AVD lake_gate / CDP 9336）上跑：saveNote 会置 is_dirty=1，
 * 在配了云同步的机器上会造出一条待同步文档。探针会读 getCloudState() 并在非 unconfigured 时告警。
 *
 * 用法（先起 App + 转发 CDP，见 scripts/mobile-audit/README.md）：
 *   bash scripts/emu-cdp.sh 9336
 *   node scripts/mobile-audit/long-doc-dom.mjs 9336                 # 默认 500 块 / 200 图
 *   node scripts/mobile-audit/long-doc-dom.mjs 9336 --no-idle        # 与 boot-timeline 同口径
 *   node scripts/mobile-audit/long-doc-dom.mjs 9336 --out .css-audit/long-doc/baseline.json
 *   node scripts/mobile-audit/long-doc-dom.mjs 9336 --baseline .css-audit/long-doc/baseline.json
 *   node scripts/mobile-audit/long-doc-dom.mjs --self-check          # 不连设备：只自检文档生成与报告形状
 *
 * 退出码：0 正常；1 采数不成立（文档没打开 / 正文被内核重写 / 段落数明显不足 / 基线回归）；
 *         2 连不上 CDP；3 造数据或打开文档失败。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PROBE = "mobile-audit/long-doc-dom";
const SCHEMA = 1;
const DEFAULT_PORT = 9335;
const DEFAULT_BLOCKS = 500;
const DEFAULT_IMAGES = 200;
/** 每个文本段落都含这句 ⇒ 页内文本扫描探针有稳定命中（改这里要同步 buildLongDoc）。 */
const FIND_QUERY = "探针样本";
const SAFE = { blocks: 5000, images: 1000 };
/** 1×1 灰度+alpha PNG（68B，已验证签名/IHDR/IDAT）。1×1 是为了让解码成本不掩盖 DOM 成本。 */
const IMG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const IMG_BYTES = 68;
/** 移动端 ASSET_PORT 固定 19876（仅桌面多端调试会覆盖）⇒ 仅作兜底，实际优先从资源条目嗅探。 */
const ASSET_PORT_FALLBACK = 19876;

/* ------------------------------------------------------------------ *
 * 纯函数区（--self-check 也走这里，保证"没设备也能验"）
 * ------------------------------------------------------------------ */

/** Lake 正文的最小转义。单一来源是 src/core/lakeDocForm.ts 的 escapeLakeHtml。 */
function escapeLakeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 带文本的段落（内核形态）。单一来源是 src/core/lakeDocForm.ts 的 lakeTextParagraph —— 改那边要同步这里。 */
function lakeTextParagraph(paragraphId, textId, text) {
  return '<p data-lake-id="' + paragraphId + '" id="' + paragraphId + '" class="ne-p"><span data-lake-id="' + textId +
    '" id="' + textId + '">' + escapeLakeHtml(text) + "</span></p>";
}

/** 图片卡片的 value 字段集（对齐 docs/LAKE-CONTENT-WRITING.md 第 3 节的内核自产样本）。 */
function buildLakeImageCardValue(input) {
  return {
    src: input.src,
    taskId: input.cardId + "-task",
    clientId: "probe-client",
    originalType: "binary",
    linkTarget: "_blank",
    name: input.name,
    size: input.size,
    width: 362.953125,
    height: 259,
    originWidth: 1,
    originHeight: 1,
    ratio: 1,
    status: "done",
    style: "none",
    showTitle: false,
    title: "",
    rotation: 0,
    crop: [0, 0, 1, 1],
    id: input.cardId,
    margin: { top: true, bottom: true },
  };
}

/**
 * 图片段落：必须是 card 容器（type="inline" name="image"），不能是裸 <img>。
 * 单一来源同样是 src/core/lakeDocForm.ts 的 lakeImageCardParagraph。
 */
function lakeImageCardParagraph(paragraphId, cardValue) {
  return '<p data-lake-id="' + paragraphId + '" id="' + paragraphId + '" class="ne-p"><card type="inline" name="image" value="data:' +
    encodeURIComponent(JSON.stringify(cardValue)) + '"></card></p>';
}

/** 探针图片文件名（安全路径段：字母/数字/点/连字符）。 */
function probeImageName(index, total) {
  return "probe-" + String(index + 1).padStart(String(total).length, "0") + ".png";
}

/**
 * 合成一篇长文档：blocks 个块（段落/图片段落各算 1 块），图片均匀分布。
 * imageMode = "files"（资源文件已写好，src 指向 AssetServer）| "data-url"（降级：不产生资产请求）。
 */
function buildLongDoc({ noteId, blocks, images, assetBase, imageMode }) {
  if (!Number.isInteger(blocks) || blocks < 1) throw new Error("blocks 必须是 ≥1 的整数");
  if (!Number.isInteger(images) || images < 0) throw new Error("images 必须是 ≥0 的整数");
  if (images > blocks) throw new Error("images 不能大于 blocks（每个图片段落占 1 块）");
  if (blocks > SAFE.blocks) throw new Error("blocks 超过安全上限 " + SAFE.blocks);
  if (images > SAFE.images) throw new Error("images 超过安全上限 " + SAFE.images);

  // 均匀分布：第 k 张图落在 floor(((k + 0.5) * blocks) / images)。
  const imageAt = new Map();
  for (let k = 0; k < images; k += 1) imageAt.set(Math.floor(((k + 0.5) * blocks) / images), k);

  const parts = [];
  const names = [];
  const digits = String(blocks).length;
  const imageDigits = String(Math.max(images, 1)).length;
  for (let i = 0; i < blocks; i += 1) {
    const imageIndex = imageAt.get(i);
    if (imageIndex !== undefined) {
      const name = probeImageName(imageIndex, images);
      names.push(name);
      const src = imageMode === "data-url" ? "data:image/png;base64," + IMG_B64 : assetBase + "/" + noteId + "/" + name;
      const cardValue = buildLakeImageCardValue({
        src: src,
        cardId: "probe-card-" + String(imageIndex + 1).padStart(imageDigits, "0"),
        name: name,
        size: IMG_BYTES,
      });
      parts.push(lakeImageCardParagraph("probe-img-p-" + String(imageIndex + 1).padStart(imageDigits, "0"), cardValue));
      continue;
    }
    const text = FIND_QUERY + " #" + (i + 1) + " 移动端长文档 DOM 探针正文，用来量化「全量 DOM 渲染」的节点数与打开耗时；只读与编辑两态各采一组。";
    parts.push(lakeTextParagraph("probe-p-" + String(i + 1).padStart(digits, "0"), "probe-t-" + String(i + 1).padStart(digits, "0"), text));
  }

  return { content: parts.join(""), imageNames: names, blocks: blocks, images: images, imageMode: imageMode, textParagraphs: blocks - images };
}

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

function usage() {
  return [
    "移动端长文档 DOM 探针（MOB-04 保守版）",
    "",
    "  node scripts/mobile-audit/long-doc-dom.mjs [port] [options]",
    "",
    "  port                  CDP 端口（默认 9335；专用门禁实例是 9336），也可用 --port",
    "  --port N              同上",
    "  --blocks N            块数（默认 500；图片段落也算一块）",
    "  --images N            图片数（默认 200，不能大于 blocks）",
    "  --title T             文档标题（默认「[探针] 长文档 <blocks>块/<images>图」；反复跑复用同一篇）",
    "  --no-idle             与 boot-timeline.mjs 同口径：重新加载前把 requestIdleCallback 置空（预热/后台同步都不跑）",
    "  --no-reload           不重新加载页面（快，但堆内存/资源计时会带上上一轮；不允许与 --no-idle 同用）",
    "  --timeout S           单个阶段等渲染静默的上限秒数（默认 120）",
    "  --allow-rewrite       允许正文被内核重写（只告警不判失败；默认严格，重写即 exit 1）",
    "  --out PATH            把 JSON 结果另存一份（父目录自动创建）",
    "  --baseline PATH       与既有 JSON 基线对比（节点数只许降；打开耗时允许 +25% 噪声）",
    "  --self-check          不连设备：只校验文档生成与报告形状（CI 可用）",
    "  --help                显示本帮助",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = {
    port: null, blocks: DEFAULT_BLOCKS, images: DEFAULT_IMAGES, title: null,
    noIdle: false, noReload: false, timeoutSec: 120, out: null, baseline: null, selfCheck: false, allowRewrite: false, help: false,
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
    if (arg === "--no-idle") { opts.noIdle = true; continue; }
    if (arg === "--no-reload") { opts.noReload = true; continue; }
    if (arg === "--allow-rewrite") { opts.allowRewrite = true; continue; }
    if (arg === "--port") { opts.port = Number(takeValue(i, "--port")); i += 1; continue; }
    if (arg === "--blocks") { opts.blocks = Number(takeValue(i, "--blocks")); i += 1; continue; }
    if (arg === "--images") { opts.images = Number(takeValue(i, "--images")); i += 1; continue; }
    if (arg === "--title") { opts.title = takeValue(i, "--title"); i += 1; continue; }
    if (arg === "--timeout") { opts.timeoutSec = Number(takeValue(i, "--timeout")); i += 1; continue; }
    if (arg === "--out") { opts.out = takeValue(i, "--out"); i += 1; continue; }
    if (arg === "--baseline") { opts.baseline = takeValue(i, "--baseline"); i += 1; continue; }
    if (arg.startsWith("--")) throw new Error("未知参数：" + arg + "（--help 看用法）");
    if (opts.port === null && Number.isFinite(Number(arg))) { opts.port = Number(arg); continue; }
    throw new Error("无法识别的参数：" + arg + "（--help 看用法）");
  }
  if (opts.help) return opts;
  if (!Number.isInteger(opts.blocks) || opts.blocks < 1) throw new Error("--blocks 必须是 ≥1 的整数");
  if (!Number.isInteger(opts.images) || opts.images < 0) throw new Error("--images 必须是 ≥0 的整数");
  if (opts.images > opts.blocks) throw new Error("--images 不能大于 --blocks（每个图片段落占 1 块）");
  if (opts.blocks > SAFE.blocks) throw new Error("--blocks 超过安全上限 " + SAFE.blocks);
  if (opts.images > SAFE.images) throw new Error("--images 超过安全上限 " + SAFE.images);
  if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec < 10) throw new Error("--timeout 必须 ≥10 秒");
  if (opts.noReload && opts.noIdle) throw new Error("--no-idle 必须配合重新加载（去掉 --no-reload）");
  if (opts.port !== null && (!Number.isInteger(opts.port) || opts.port <= 0)) throw new Error("端口不合法");
  if (opts.port === null) opts.port = DEFAULT_PORT;
  if (opts.title === null) opts.title = "[探针] 长文档 " + opts.blocks + "块/" + opts.images + "图";
  return opts;
}

/* ------------------------------------------------------------------ *
 * 报告装配（自检与真跑共用，保证形状一致）
 * ------------------------------------------------------------------ */

function assembleReport(input) {
  const opts = input.opts;
  const doc = input.doc || null;
  const viewer = input.viewer || null;
  const contentRewritten = Boolean(input.contentRewritten);
  const baselineDiff = input.baselineDiff || null;
  const warnings = [];
  if (doc && doc.imageMode === "data-url") warnings.push("图片走 data-url 降级（Filesystem 不可用）：assetRequests 恒 0，只可看 DOM/堆内存");
  if (doc && doc.cloudState && doc.cloudState !== "unconfigured") warnings.push("该实例云同步状态 = " + doc.cloudState + "（非 unconfigured）：本探针会造出一条待同步文档，请只在专用 gate 实例上跑");
  if (viewer && !viewer.performanceMemory) warnings.push("performance.memory 不可用（WebView 常态）⇒ 堆内存只看 Page.metrics 的 JSHeapUsedSize");
  if (contentRewritten) warnings.push("打开后正文被内核重写（contentRewritten=true）⇒ 先修正文/资源形态，再采信耗时与节点数");
  if (doc && viewer && typeof viewer.paragraphs === "number" && typeof doc.expectedBlocks === "number" && viewer.paragraphs < doc.expectedBlocks * 0.9) {
    warnings.push("只读态 .ne-p 数 " + viewer.paragraphs + " < 期望块数 " + doc.expectedBlocks + " 的 90%（可能没渲染完，或图片段落的段落标签被内核重构）");
  }
  const failures = [];
  // 默认严格：正文被重写说明数据形态有问题，这一轮数字不可信。--allow-rewrite 只留告警（排查期用）。
  if (contentRewritten && !input.allowRewrite) failures.push("正文被内核重写");
  if (viewer && viewer.paragraphs === 0) failures.push("只读态没有任何 .ne-p（文档没渲染）");
  if (baselineDiff && baselineDiff.regressions.length) failures.push("相对基线回归：" + baselineDiff.regressions.join("；"));
  return {
    probe: PROBE,
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    params: { blocks: opts.blocks, images: opts.images, title: opts.title, noIdle: opts.noIdle, reloaded: !opts.noReload, timeoutSec: opts.timeoutSec, allowRewrite: Boolean(opts.allowRewrite) },
    environment: input.environment || null,
    doc: doc,
    viewer: viewer,
    editor: input.editor || null,
    phaseCost: input.phaseCost || null,
    contentRewritten: contentRewritten,
    baselineDiff: baselineDiff,
    warnings: warnings,
    ok: failures.length === 0,
    failures: failures,
  };
}

/** 基线对比：节点数只许降；打开/查找耗时允许 +25%；堆内存允许 +15%。 */
function compareBaseline(report, baseline) {
  const rows = [];
  const add = (key, current, base, mode, tolerance) => {
    if (typeof current !== "number" || typeof base !== "number") return;
    let regression = false;
    if (mode === "no-grow") regression = current > base + tolerance;
    if (mode === "ratio") regression = current > base * (1 + tolerance);
    rows.push({ key: key, current: current, baseline: base, delta: current - base, regression: regression });
  };
  const cur = { viewer: report.viewer || {}, editor: report.editor || {} };
  const old = { viewer: baseline.viewer || {}, editor: baseline.editor || {} };
  add("viewer.nodes", cur.viewer.nodes, old.viewer.nodes, "no-grow", 0);
  add("editor.nodes", cur.editor.nodes, old.editor.nodes, "no-grow", 0);
  add("viewer.openedMs", cur.viewer.openedMs, old.viewer.openedMs, "ratio", 0.25);
  add("editor.openedMs", cur.editor.openedMs, old.editor.openedMs, "ratio", 0.25);
  add("viewer.heapUsedMB", cur.viewer.heapUsedMB, old.viewer.heapUsedMB, "ratio", 0.15);
  add("editor.heapUsedMB", cur.editor.heapUsedMB, old.editor.heapUsedMB, "ratio", 0.15);
  add("editor.findScanMs", cur.editor.findScanMs, old.editor.findScanMs, "ratio", 0.25);
  return {
    baselineGeneratedAt: baseline.generatedAt || null,
    rows: rows,
    regressions: rows.filter((row) => row.regression).map((row) => row.key + " " + row.baseline + " → " + row.current),
  };
}

/* ------------------------------------------------------------------ *
 * 自检（无设备）
 * ------------------------------------------------------------------ */

function selfCheck(opts) {
  const checks = [];
  const assert = (name, ok, detail) => {
    checks.push({ name: name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
    if (!ok) throw new Error("自检失败：" + name + (detail ? "（" + detail + "）" : ""));
  };
  const noteId = "probe-note-selfcheck";
  const assetBase = "http://127.0.0.1:" + ASSET_PORT_FALLBACK;
  const doc = buildLongDoc({ noteId: noteId, blocks: opts.blocks, images: opts.images, assetBase: assetBase, imageMode: "files" });
  const paragraphs = doc.content.match(/<p /g) || [];
  const cards = doc.content.match(/<card type="inline" name="image"/g) || [];
  // 只取真正的 id 属性（" id=" 前面必须有空格；"data-lake-id=" 不算）。
  const ids = doc.content.match(/ id="[^"]+"/g) || [];
  assert("块数 = --blocks", paragraphs.length === opts.blocks, "实际 " + paragraphs.length);
  assert("图片卡片数 = --images", cards.length === opts.images, "实际 " + cards.length);
  assert("不出现裸 <img>（docs/LAKE-CONTENT-WRITING.md 反例①）", doc.content.indexOf("<img") < 0);
  // value 是 encodeURIComponent(JSON) ⇒ 必须解码后再判 src，别在原始串里找（那里全是 %3A%2F%2F）。
  const cardValues = [];
  const cardRe = /name="image" value="data:([^"]+)"/g;
  let match = cardRe.exec(doc.content);
  while (match) {
    cardValues.push(JSON.parse(decodeURIComponent(match[1])));
    match = cardRe.exec(doc.content);
  }
  assert("图片 src 指向 AssetServer 且不带 token", cardValues.length === opts.images && cardValues.every((value) => value.src === assetBase + "/" + noteId + "/" + value.name && value.src.indexOf("token=") < 0));
  assert("资源文件名唯一", new Set(doc.imageNames).size === doc.imageNames.length);
  assert("段落 id 唯一", new Set(ids).size === ids.length, ids.length + " 个 id");
  const decoded = cardValues[0] || null;
  assert("卡片 value 是可解码 JSON", Boolean(decoded) && typeof decoded.src === "string");
  assert("卡片必备字段齐全", Boolean(decoded) && decoded.status === "done" && Boolean(decoded.name) && decoded.size === IMG_BYTES && decoded.src.indexOf(assetBase) === 0, decoded ? Object.keys(decoded).length + " 个字段" : "无");
  const png = Buffer.from(IMG_B64, "base64");
  assert("PNG base64 能解码出 PNG 签名", png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
  assert("PNG 字节数与卡片 size 一致", png.length === IMG_BYTES, png.length + "B");
  const dataUrlDoc = buildLongDoc({ noteId: noteId, blocks: opts.blocks, images: opts.images, assetBase: assetBase, imageMode: "data-url" });
  const dataUrlCard = JSON.parse(decodeURIComponent((dataUrlDoc.content.match(/name="image" value="data:([^"]+)"/) || [])[1] || "%7B%7D"));
  assert("降级模式不写本地路径", dataUrlCard.src.indexOf("data:image/png;base64,") === 0 && dataUrlCard.src.indexOf(assetBase) < 0);

  const textParagraphs = opts.blocks - opts.images;
  const sampleViewer = { nodes: 1000, bodyNodes: 900, paragraphs: opts.blocks, cards: opts.images, images: opts.images, imagesLoaded: opts.images, openedMs: 1200, heapUsedMB: 40, findScanMs: 8, assetRequests: opts.images };
  const sampleEditor = { nodes: 1100, bodyNodes: 1000, paragraphs: opts.blocks, cards: opts.images, images: opts.images, imagesLoaded: opts.images, openedMs: 900, heapUsedMB: 42, findScanMs: 8, assetRequests: 0 };
  const report = assembleReport({
    opts: opts,
    environment: { selfCheck: true },
    doc: { noteId: noteId, title: opts.title, imageMode: "files", expectedBlocks: opts.blocks, expectedTextParagraphs: textParagraphs, cloudState: "unconfigured" },
    viewer: Object.assign({ phase: "viewer" }, sampleViewer),
    editor: Object.assign({ phase: "editor" }, sampleEditor),
    phaseCost: { enterEditor: { ScriptDuration: 10 } },
    contentRewritten: false,
    baselineDiff: null,
  });
  const roundTrip = JSON.parse(JSON.stringify(report));
  assert("报告可 JSON 序列化且字段齐全", roundTrip.probe === PROBE && roundTrip.viewer.nodes === 1000 && roundTrip.ok === true && Array.isArray(roundTrip.warnings));
  const diff = compareBaseline(roundTrip, { generatedAt: "x", viewer: sampleViewer, editor: sampleEditor });
  assert("基线与自身对比无回归", diff.regressions.length === 0);
  const worse = compareBaseline(roundTrip, { viewer: Object.assign({}, sampleViewer, { nodes: 900 }), editor: sampleEditor });
  assert("基线能抓到节点增长", worse.regressions.length === 1, JSON.stringify(worse.regressions));
  assert("参数互斥校验生效", (() => { try { parseArgs(["--no-idle", "--no-reload"]); return false; } catch (error) { return true; } })());
  const rewrittenStrict = assembleReport({ opts: opts, environment: null, doc: null, viewer: Object.assign({ phase: "viewer" }, sampleViewer), editor: null, phaseCost: null, contentRewritten: true, baselineDiff: null });
  const rewrittenLoose = assembleReport({ opts: opts, environment: null, doc: null, viewer: Object.assign({ phase: "viewer" }, sampleViewer), editor: null, phaseCost: null, contentRewritten: true, baselineDiff: null, allowRewrite: true });
  assert("正文被重写默认判失败，--allow-rewrite 只告警", rewrittenStrict.ok === false && rewrittenLoose.ok === true);
  assert("默认值解析正确", (() => { const parsed = parseArgs(["9336"]); return parsed.port === 9336 && parsed.blocks === DEFAULT_BLOCKS && parsed.images === DEFAULT_IMAGES; })());
  const pageCheck = validatePageExpressions();
  assert("页内表达式全部可解析", pageCheck.ok, pageCheck.detail);
  return { probe: PROBE, selfCheck: true, params: { blocks: opts.blocks, images: opts.images }, contentBytes: doc.content.length, checks: checks };
}

/* ------------------------------------------------------------------ *
 * 设备路径：CDP 客户端
 * ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function makeClient(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  return function send(method, params, timeoutMs) {
    const limit = timeoutMs || 30000;
    return new Promise((resolvePromise, rejectPromise) => {
      const id = ++seq;
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        rejectPromise(new Error("CDP 超时 " + method));
      }, limit);
    });
  };
}

/* -------------------------- 页内表达式（拼行，便于审阅） -------------------------- */

const PAGE_ENVIRONMENT = [
  "(function () {",
  "  var plugins = (window.Capacitor && window.Capacitor.Plugins) || {};",
  "  var fs = plugins.Filesystem;",
  "  return JSON.stringify({",
  "    url: String(location.href),",
  "    viewport: [innerWidth, innerHeight],",
  "    dpr: window.devicePixelRatio || 1,",
  "    ua: navigator.userAgent,",
  "    hasFilesystem: Boolean(fs && typeof fs.writeFile === 'function' && typeof fs.mkdir === 'function'),",
  "    hasLakeNative: Boolean(window.lakeNative),",
  "    assetPortFromBridge: (window.lakeNative && window.lakeNative.assetPort) || null",
  "  });",
  "})()",
].join("\n");

const PAGE_READY = [
  "(function () {",
  "  return JSON.stringify({",
  "    ready: document.readyState === 'complete' && Boolean(window.lakeNative) && Boolean(document.querySelector('.mobile-htab') || document.querySelector('.mobile-workspace'))",
  "  });",
  "})()",
].join("\n");

const pagePrepare = (title) => [
  "(async function () {",
  "  var L = window.lakeNative;",
  "  var title = " + JSON.stringify(title) + ";",
  "  var snap = await L.getHomeSnapshot();",
  "  var notes = snap.notes || [];",
  "  var nodes = snap.treeNodes || [];",
  "  var existing = null;",
  "  for (var i = 0; i < notes.length; i += 1) if (notes[i].title === title) { existing = notes[i]; break; }",
  "  var parentTitle = null;",
  "  if (existing) {",
  "    for (var j = 0; j < nodes.length; j += 1) if (nodes[j].id === existing.parentId) { parentTitle = nodes[j].title; break; }",
  "    return JSON.stringify({ id: existing.id, title: existing.title, parentId: existing.parentId, parentTitle: parentTitle, reused: true });",
  "  }",
  "  var nb = null;",
  "  for (var k = 0; k < nodes.length; k += 1) if (nodes[k].id === 'notebook-personal') { nb = nodes[k]; break; }",
  "  if (!nb) for (var m = 0; m < nodes.length; m += 1) if (nodes[m].type === 'notebook') { nb = nodes[m]; break; }",
  "  var created = await L.createNote(title, nb ? nb.id : null);",
  "  return JSON.stringify({ id: created.id, title: created.title, parentId: created.parentId, parentTitle: nb ? nb.title : null, reused: false });",
  "})()",
].join("\n");

const pageWriteAndSave = (input) => [
  "(async function () {",
  "  var L = window.lakeNative;",
  "  var plugins = (window.Capacitor && window.Capacitor.Plugins) || {};",
  "  var FS = plugins.Filesystem;",
  "  var noteId = " + JSON.stringify(input.noteId) + ";",
  "  var title = " + JSON.stringify(input.title) + ";",
  "  var parentId = " + JSON.stringify(input.parentId) + ";",
  "  var content = " + JSON.stringify(input.content) + ";",
  "  var mode = " + JSON.stringify(input.imageMode) + ";",
  "  var names = " + JSON.stringify(input.imageNames) + ";",
  "  var assetBase = " + JSON.stringify(input.assetBase) + ";",
  "  var png = " + JSON.stringify(IMG_B64) + ";",
  "  var dir = 'note-assets/' + noteId;",
  "  var written = 0;",
  "  var failures = [];",
  "  if (mode === 'files') {",
  "    if (!FS || typeof FS.writeFile !== 'function') return JSON.stringify({ error: 'Filesystem 插件不可用（应已降级 data-url；这是探针自身判断有误）' });",
  "    await FS.mkdir({ path: dir, directory: 'DATA', recursive: true }).catch(function () {});",
  "    for (var i = 0; i < names.length; i += 16) {",
  "      var batch = names.slice(i, i + 16);",
  "      await Promise.all(batch.map(function (name) {",
  "        var path = dir + '/' + name;",
  "        var write = function () { return FS.writeFile({ path: path, data: png, directory: 'DATA', recursive: true }); };",
  "        return write().catch(function () { return write(); }).then(function () { written += 1; }).catch(function (e) { failures.push(name + ': ' + ((e && e.message) || e)); });",
  "      }));",
  "    }",
  "    if (failures.length) return JSON.stringify({ error: '探针图片写入失败 ' + failures.length + ' 个', failures: failures.slice(0, 5) });",
  "    if (names.length) {",
  "      var assetUrl = assetBase + '/' + noteId + '/' + encodeURIComponent(names[0]);",
  "      var probe = await new Promise(function (finish) {",
  "        var img = new Image();",
  "        var done = false;",
  "        var settle = function (value) { if (!done) { done = true; finish(value); } };",
  "        img.onload = function () { settle({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); };",
  "        img.onerror = function () { settle({ ok: false }); };",
  "        setTimeout(function () { settle({ ok: false, timeout: true }); }, 8000);",
  "        img.src = assetUrl;",
  "      });",
  "      if (!probe.ok) return JSON.stringify({ error: '图片自证失败：AssetServer 取不到刚写入的文件', probe: probe, assetUrl: assetUrl });",
  "    }",
  "  }",
  "  var cloudState = null;",
  "  try { cloudState = await L.getCloudState(); } catch (e) { cloudState = 'unknown'; }",
  "  await L.saveNote(noteId, title, content, parentId, undefined);",
  "  return JSON.stringify({ written: written, cloudState: cloudState, imageMode: mode });",
  "})()",
].join("\n");

const PAGE_SETTLE_SAMPLE = [
  "(function () {",
  "  var body = document.querySelector('.mobile-doc-body');",
  "  if (!body) return 'null';",
  "  var imgs = body.querySelectorAll('img');",
  "  var loaded = 0;",
  "  for (var i = 0; i < imgs.length; i += 1) if (imgs[i].naturalWidth > 0) loaded += 1;",
  "  return JSON.stringify({",
  "    nodes: document.querySelectorAll('*').length,",
  "    res: performance.getEntriesByType('resource').length,",
  "    imgs: imgs.length,",
  "    loaded: loaded,",
  "    hosts: document.querySelectorAll('.ne-viewer-body, .ne-editor-wrap').length",
  "  });",
  "})()",
].join("\n");

const pageMeasure = (findQuery) => [
  "(function () {",
  "  var root = document.querySelector('.mobile-doc-body');",
  "  if (!root) return 'null';",
  "  var host = document.querySelector('.ne-editor-wrap') || document.querySelector('.ne-viewer-body');",
  "  var imgs = root.querySelectorAll('img');",
  "  var loaded = 0;",
  "  for (var i = 0; i < imgs.length; i += 1) if (imgs[i].naturalWidth > 0) loaded += 1;",
  "  var plainLength = null;",
  "  try {",
  "    var ed = window.__mobileEditor;",
  "    if (ed && typeof ed.getDocument === 'function') {",
  "      var plain = ed.getDocument('text/plain');",
  "      plainLength = typeof plain === 'string' ? plain.length : null;",
  "    }",
  "  } catch (error) { plainLength = null; }",
  "  var entries = performance.getEntriesByType('resource');",
  "  var prefix = 'http://127.0.0.1:';",
  "  var assetOrigin = null;",
  "  for (var e = 0; e < entries.length; e += 1) {",
  "    var name = entries[e].name;",
  "    if (name.indexOf(prefix) !== 0) continue;",
  "    var slash = name.indexOf('/', prefix.length);",
  "    if (slash > 0) { assetOrigin = name.slice(0, slash); break; }",
  "  }",
  "  if (!assetOrigin && window.lakeNative && window.lakeNative.assetPort) assetOrigin = prefix + window.lakeNative.assetPort;",
  "  var assetRequests = 0;",
  "  var assetBytes = 0;",
  "  var firstStart = null;",
  "  var lastStart = null;",
  "  var unique = {};",
  "  var uniqueCount = 0;",
  "  for (var r = 0; r < entries.length; r += 1) {",
  "    var entry = entries[r];",
  "    if (!assetOrigin || entry.name.indexOf(assetOrigin + '/') !== 0) continue;",
  "    if (!unique[entry.name]) { unique[entry.name] = true; uniqueCount += 1; }",
  "    assetRequests += 1;",
  "    assetBytes += Number(entry.transferSize || 0);",
  "    if (firstStart === null || entry.startTime < firstStart) firstStart = entry.startTime;",
  "    if (lastStart === null || entry.startTime > lastStart) lastStart = entry.startTime;",
  "  }",
  "  var needle = " + JSON.stringify(findQuery) + ".toLowerCase();",
  "  var scanStart = performance.now();",
  "  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);",
  "  var matches = 0;",
  "  var node = null;",
  "  while ((node = walker.nextNode())) {",
  "    if (!node.data || !node.data.trim()) continue;",
  "    var parent = node.parentElement;",
  "    if (!parent) continue;",
  "    var tag = parent.tagName;",
  "    if (tag === 'SCRIPT' || tag === 'STYLE') continue;",
  "    var haystack = node.data.toLowerCase();",
  "    var from = 0;",
  "    for (;;) {",
  "      var hit = haystack.indexOf(needle, from);",
  "      if (hit < 0) break;",
  "      matches += 1;",
  "      from = hit + needle.length;",
  "      if (matches >= 600) break;",
  "    }",
  "    if (matches >= 600) break;",
  "  }",
  "  var findScanMs = Math.round((performance.now() - scanStart) * 10) / 10;",
  "  var memory = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null;",
  "  var elapsed = (window.__probe && typeof window.__probe.t0 === 'number') ? Math.round(performance.now() - window.__probe.t0) : null;",
  "  return JSON.stringify({",
  "    sinceProbeStartMs: elapsed,",
  "    nodes: document.querySelectorAll('*').length,",
  "    bodyNodes: root.querySelectorAll('*').length,",
  // 261029 实测：移动端内核把段落渲染成自定义元素 <ne-p>（无 class），桌面才是 <p class="ne-p">。
  // 只量 .ne-p 会在移动端恒为 0（探针曾误报「文档没渲染」）。两个口径都算。
  "    paragraphs: root.querySelectorAll('.ne-p, ne-p').length,",
  "    cards: root.querySelectorAll('ne-card').length,",
  "    images: imgs.length,",
  "    imagesLoaded: loaded,",
  "    plainTextLength: plainLength,",
  "    scrollHeight: root.scrollHeight,",
  "    clientHeight: root.clientHeight,",
  "    hostScrollHeight: host ? host.scrollHeight : null,",
  "    assetOrigin: assetOrigin,",
  "    assetRequests: assetRequests,",
  "    assetUniqueUrls: uniqueCount,",
  "    assetBytes: assetBytes,",
  "    assetFirstStartMs: firstStart === null ? null : Math.round(firstStart),",
  "    assetLastStartMs: lastStart === null ? null : Math.round(lastStart),",
  "    findScanMs: findScanMs,",
  "    findMatches: matches,",
  "    performanceMemory: memory,",
  "    editorHost: Boolean(document.querySelector('.ne-editor-wrap')),",
  "    viewerHost: Boolean(document.querySelector('.ne-viewer-body'))",
  "  });",
  "})()",
].join("\n");

const pageHomeCardPoint = (title) => [
  "(function () {",
  "  var title = " + JSON.stringify(title) + ";",
  "  var cards = [].slice.call(document.querySelectorAll('.doc-card, .home-recent .doc-card'));",
  "  for (var i = 0; i < cards.length; i += 1) {",
  "    var card = cards[i];",
  "    if ((card.textContent || '').indexOf(title) < 0) continue;",
  "    var r = card.getBoundingClientRect();",
  "    if (r.width <= 0 || r.height <= 0) continue;",
  "    // 视口外点不到（CDP 按坐标点，滚出屏的卡片会点空）⇒ 退回目录树路径",
  "    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;",
  "    return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);",
  "  }",
  "  return 'null';",
  "})()",
].join("\n");

const pageNotebookPoint = (title) => [
  "(function () {",
  "  var title = " + JSON.stringify(title) + ";",
  "  var rows = [].slice.call(document.querySelectorAll('.nb-row, .nb-shelf-card'));",
  "  for (var i = 0; i < rows.length; i += 1) {",
  "    if ((rows[i].textContent || '').indexOf(title) < 0) continue;",
  "    var r = rows[i].getBoundingClientRect();",
  "    if (r.width <= 0 || r.height <= 0) continue;",
  "    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;",
  "    return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);",
  "  }",
  "  return 'null';",
  "})()",
].join("\n");

/** 底栏「文档树」按 aria-label/title 找（textContent 不可靠，见 HANDOFF 记录）。 */
const PAGE_TREE_BUTTON = [
  "(function () {",
  "  var TREE = String.fromCharCode(0x6587, 0x6863, 0x6811);",
  "  var items = [].slice.call(document.querySelectorAll('.mobile-bottom-bar__item'));",
  "  for (var i = 0; i < items.length; i += 1) {",
  "    var label = (items[i].getAttribute('aria-label') || '') + items[i].title;",
  "    if (label.indexOf(TREE) < 0) continue;",
  "    var r = items[i].getBoundingClientRect();",
  "    if (r.width <= 0) continue;",
  "    return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);",
  "  }",
  "  return 'null';",
  "})()",
].join("\n");

/** ⚠️ 未打开的抽屉里也有 .ln-row（keep-alive）⇒ 必须限定 .on / 工作区可见行。 */
const pageTreeRowPoint = (title) => [
  "(function () {",
  "  var title = " + JSON.stringify(title) + ";",
  "  var rows = [].slice.call(document.querySelectorAll('.side-panel--left.on .ln-row, .mobile-workspace .ln-row, .side-panel--left.on .mb-row, .mobile-workspace .mb-row'));",
  "  for (var i = 0; i < rows.length; i += 1) {",
  "    var row = rows[i];",
  "    if (row.getBoundingClientRect().width <= 0) continue;",
  "    if ((row.textContent || '').indexOf(title) < 0) continue;",
  "    var r = row.getBoundingClientRect();",
  "    // 只认真正可见的行：滚到屏外的行点不到（下面会滚一屏再找）",
  "    if (r.bottom <= 0 || r.top >= innerHeight) continue;",
  "    return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);",
  "  }",
  "  return 'null';",
  "})()",
].join("\n");

/** 顶栏「编辑」按钮：要连 disabled 一起看（文档未 loaded 时它是禁用的，点了不会进编辑态）。 */
const PAGE_EDIT_STATE = [
  "(function () {",
  "  var EDIT = String.fromCharCode(0x7f16, 0x8f91);",
  "  var buttons = [].slice.call(document.querySelectorAll('.mobile-topbar .toolbar__button'));",
  "  for (var i = 0; i < buttons.length; i += 1) {",
  "    if (buttons[i].getAttribute('aria-label') !== EDIT) continue;",
  "    var r = buttons[i].getBoundingClientRect();",
  "    return JSON.stringify({ found: true, disabled: Boolean(buttons[i].disabled), point: r.width > 0 && r.height > 0 ? [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] : null });",
  "  }",
  "  return JSON.stringify({ found: false, disabled: false, point: null });",
  "})()",
].join("\n");

const pageRewriteCheck = (noteId) => [
  "(async function () {",
  "  var note = await window.lakeNative.readNote(" + JSON.stringify(noteId) + ");",
  "  return JSON.stringify({ content: note ? String(note.content || '') : null });",
  "})()",
].join("\n");

const pagePointOf = (selector) => [
  "(function () {",
  "  var el = document.querySelector(" + JSON.stringify(selector) + ");",
  "  if (!el) return 'null';",
  "  var r = el.getBoundingClientRect();",
  "  if (r.width <= 0 || r.height <= 0) return 'null';",
  "  if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return 'null';",
  "  return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);",
  "})()",
].join("\n");

/** 每阶段开始前清资源计时 + 重置 t0（阶段耗时用页内 performance.now）。 */
const pageStartPhase = (phase) => [
  "(function () {",
  "  performance.clearResourceTimings();",
  "  window.__probe = { t0: performance.now(), phase: " + JSON.stringify(phase) + " };",
  "  return true;",
  "})()",
].join("\n");

const PAGE_SCROLL_TREE = [
  "(function () {",
  "  var panel = document.querySelector('.side-panel--left.on') || document.querySelector('.mobile-workspace');",
  "  if (panel) panel.scrollTop += Math.max(200, panel.clientHeight * 0.8);",
  "  return true;",
  "})()",
].join("\n");

/**
 * 语法自检：所有页内表达式必须能被 JS 解析（不执行）。
 * 为什么单独抽出来：这些表达式是**拼字符串**生成的，一处引号写错只会在真机上炸；
 * 没设备时也要能在这里抓到（--self-check）。
 */
function validatePageExpressions() {
  const list = {
    PAGE_ENVIRONMENT: PAGE_ENVIRONMENT,
    PAGE_READY: PAGE_READY,
    pagePrepare: pagePrepare("[自检] 标题"),
    pageWriteAndSave: pageWriteAndSave({
      noteId: "self-check-note",
      title: "[自检] 标题",
      parentId: null,
      content: "<p id=\"x\" class=\"ne-p\"><br></p>",
      imageMode: "files",
      imageNames: ["probe-01.png"],
      assetBase: "http://127.0.0.1:19876",
    }),
    PAGE_SETTLE_SAMPLE: PAGE_SETTLE_SAMPLE,
    pageMeasure: pageMeasure("探针样本"),
    pageHomeCardPoint: pageHomeCardPoint("[自检] 标题"),
    pageNotebookPoint: pageNotebookPoint("[自检] 笔记本"),
    PAGE_TREE_BUTTON: PAGE_TREE_BUTTON,
    pageTreeRowPoint: pageTreeRowPoint("[自检] 标题"),
    PAGE_EDIT_STATE: PAGE_EDIT_STATE,
    pageRewriteCheck: pageRewriteCheck("self-check-note"),
    pagePointOf: pagePointOf(".mobile-doc-body"),
    pageStartPhase: pageStartPhase("open"),
    PAGE_SCROLL_TREE: PAGE_SCROLL_TREE,
  };
  for (const name of Object.keys(list)) {
    try {
      // 只解析、不执行（new Function 的构造阶段就会抛 SyntaxError）
      new Function("return (" + list[name] + ")");
    } catch (error) {
      return { ok: false, detail: name + "：" + (error && error.message ? error.message : String(error)) };
    }
  }
  if (pageStartPhase("open").indexOf("window.__probe") < 0) return { ok: false, detail: "pageStartPhase 未设置 window.__probe" };
  if (PAGE_EDIT_STATE.indexOf("String.fromCharCode(0x7f16, 0x8f91)") < 0) return { ok: false, detail: "PAGE_EDIT_STATE 没有按「编辑」文案判据" };
  if (PAGE_EDIT_STATE.indexOf("disabled") < 0) return { ok: false, detail: "PAGE_EDIT_STATE 没有 disabled 判据（未 loaded 时点不动）" };
  return { ok: true, detail: Object.keys(list).length + " 个表达式" };
}

/* ------------------------------------------------------------------ *
 * 设备路径：主流程
 * ------------------------------------------------------------------ */

async function main(opts) {
  const log = (message) => console.error("[probe] " + message);
  const listUrl = "http://127.0.0.1:" + opts.port + "/json/list";
  let targets;
  try {
    targets = await (await fetch(listUrl)).json();
  } catch (error) {
    throw Object.assign(new Error("取不到 " + listUrl + "（App 起了吗？先 bash scripts/emu-cdp.sh " + opts.port + "）"), { exitCode: 2 });
  }
  const page = targets.find((target) => target.type === "page");
  if (!page) throw Object.assign(new Error("CDP 上没有 page target（WebView 调试 socket 转发到 " + opts.port + " 了吗？）"), { exitCode: 2 });

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    ws.addEventListener("open", resolvePromise);
    ws.addEventListener("error", () => rejectPromise(Object.assign(new Error("CDP WebSocket 连接失败"), { exitCode: 2 })));
  });
  const send = makeClient(ws);

  const evaluate = async (expression, timeoutMs) => {
    const result = await send("Runtime.evaluate", { expression: expression, awaitPromise: true, returnByValue: true }, timeoutMs || 60000);
    if (result.exceptionDetails) {
      const text = (result.exceptionDetails.exception && result.exceptionDetails.exception.description) || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails);
      throw new Error("页内执行失败：" + String(text).slice(0, 400));
    }
    return result.result ? result.result.value : undefined;
  };
  const evalJson = async (expression, timeoutMs) => {
    const value = await evaluate(expression, timeoutMs);
    if (typeof value !== "string") throw new Error("期望页内返回 JSON 字符串，实际是 " + typeof value);
    return JSON.parse(value);
  };
  const clickPoint = async (point, waitMs) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point[0], y: point[1], button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point[0], y: point[1], button: "left", clickCount: 1 });
    await sleep(waitMs || 600);
  };
  const pointOf = async (selector) => {
    const value = await evaluate(pagePointOf(selector), 15000);
    return value && value !== "null" ? JSON.parse(value) : null;
  };
  const clickSelector = async (selector, waitMs) => {
    const point = await pointOf(selector);
    if (!point) return false;
    await clickPoint(point, waitMs);
    return true;
  };
  const exists = async (selector) => Boolean(await evaluate("Boolean(document.querySelector(" + JSON.stringify(selector) + "))", 15000));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Performance.enable");
  await send("Log.enable").catch(() => undefined);

  // --no-idle：与 boot-timeline.mjs 同一段桩，必须在 reload 之前注入。
  if (opts.noIdle) {
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.requestIdleCallback = function () { return 0; }; window.cancelIdleCallback = function () {};",
    });
    log("已注入 --no-idle：requestIdleCallback 置空（内核预热/后台同步不跑）");
  }

  const waitReady = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = JSON.parse(await evaluate(PAGE_READY, 15000));
        if (state.ready) return true;
      } catch (error) { /* 重新加载期间 evaluate 可能失败，重试 */ }
      await sleep(300);
    }
    return false;
  };

  if (!opts.noReload) {
    log("重新加载页面（干净堆 + 干净资源计时）…");
    await send("Page.reload", { ignoreCache: false });
    if (!(await waitReady(60000))) throw new Error("重新加载后 60s 内没就绪（window.lakeNative / 首页未出现）");
  } else {
    log("跳过重新加载（--no-reload）：堆与资源计时会带上上一轮");
    if (!(await waitReady(15000))) throw new Error("页面未就绪（window.lakeNative 不在？先等 App 起来再跑）");
  }

  const environment = await evalJson(PAGE_ENVIRONMENT);
  log("设备 " + environment.viewport.join("×") + " @" + environment.dpr + "，Filesystem=" + environment.hasFilesystem);

  // 回首页（reload 后本来就在首页；--no-reload 时兜底点返回）
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const inWorkspace = await exists(".mobile-workspace");
    if (!inWorkspace && (await exists(".mobile-htab"))) break;
    if (!(await clickSelector('.toolbar__button[aria-label="返回"]', 900))) {
      throw new Error("回不到首页：没有返回按钮也没有 .mobile-htab（--no-reload 时请先手动回首页）");
    }
  }
  if (!(await exists(".mobile-htab"))) throw new Error("仍在工作区（回不到首页）");

  log("准备文档：" + opts.title);
  const prepared = await evalJson(pagePrepare(opts.title));
  log((prepared.reused ? "复用已有文档 " : "新建文档 ") + prepared.id + (prepared.parentTitle ? "（笔记本：" + prepared.parentTitle + "）" : ""));

  const assetBase = "http://127.0.0.1:" + (environment.assetPortFromBridge || ASSET_PORT_FALLBACK);
  const imageMode = environment.hasFilesystem ? "files" : "data-url";
  const built = buildLongDoc({ noteId: prepared.id, blocks: opts.blocks, images: opts.images, assetBase: assetBase, imageMode: imageMode });
  log("合成正文：" + built.blocks + " 块（文本 " + built.textParagraphs + " / 图片 " + built.images + "），" + Math.round(built.content.length / 1024) + "KB");

  log(imageMode === "files" ? "写图片资源 + saveNote …" : "Filesystem 不可用 ⇒ 图片降级 data-url（assetRequests 恒 0）");
  const prep = await evalJson(pageWriteAndSave({
    noteId: prepared.id,
    title: opts.title,
    parentId: prepared.parentId,
    content: built.content,
    imageMode: imageMode,
    imageNames: built.imageNames,
    assetBase: assetBase,
  }), 240000);
  if (prep.error) {
    throw Object.assign(new Error("造数据失败：" + prep.error + (prep.failures ? "｜" + prep.failures.join("；") : "") + (prep.assetUrl ? "｜" + prep.assetUrl : "")), { exitCode: 3 });
  }
  log("资源写入 " + prep.written + " 个；云同步状态 " + prep.cloudState);

  const metricKeys = ["Nodes", "JSEventListeners", "Documents", "Frames", "LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration", "JSHeapUsedSize", "JSHeapTotalSize"];
  const pickMetrics = (metrics) => {
    const out = {};
    for (const key of metricKeys) if (typeof metrics[key] === "number") out[key] = Math.round(metrics[key] * 1000) / 1000;
    return out;
  };
  const metricsSnapshot = async () => {
    const result = await send("Performance.getMetrics");
    const map = {};
    for (const item of result.metrics || []) map[item.name] = item.value;
    return map;
  };
  const phaseDelta = (before, after) => {
    const fields = ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration", "LayoutCount", "RecalcStyleCount", "JSEventListeners", "Documents"];
    const out = {};
    for (const field of fields) {
      if (typeof before[field] !== "number" || typeof after[field] !== "number") continue;
      const raw = after[field] - before[field];
      out[field] = /Duration$/.test(field) ? Math.round(raw * 1000 * 10) / 10 : Math.round(raw);
    }
    return out;
  };

  const waitSettled = async (phase, minElapsedMs) => {
    const startedAt = Date.now();
    const deadline = startedAt + opts.timeoutSec * 1000;
    let lastSignature = null;
    let stable = 0;
    while (Date.now() < deadline) {
      let sample = null;
      try {
        const raw = await evaluate(PAGE_SETTLE_SAMPLE, 20000);
        sample = raw && raw !== "null" ? JSON.parse(raw) : null;
      } catch (error) { sample = null; }
      if (sample && sample.hosts > 0) {
        const signature = sample.nodes + ":" + sample.res + ":" + sample.imgs + ":" + sample.loaded;
        if (signature === lastSignature) stable += 1;
        else { stable = 0; lastSignature = signature; }
        // 图片要基本到位才算静默（200 张图在模拟器上可能中途停 >900ms）；
        // 但不能为了等图把超时吃满 ⇒ 20s（且不超过 timeout 的一半）之后只认节点/请求稳定。
        const waited = Date.now() - startedAt;
        const imagesReady = sample.imgs === 0 || sample.loaded >= sample.imgs * 0.95;
        const strictWindow = waited < Math.min(20000, (opts.timeoutSec * 1000) / 2);
        if (stable >= 3 && waited >= (minElapsedMs || 1500) && (imagesReady || !strictWindow)) return;
      }
      await sleep(300);
    }
    throw new Error("阶段 " + phase + " 等渲染静默超时（" + opts.timeoutSec + "s；--timeout 可调大）");
  };

  const measure = async (phase) => {
    const raw = await evaluate(pageMeasure(FIND_QUERY), 30000);
    if (!raw || raw === "null") throw new Error("找不到 .mobile-doc-body（" + phase + " 阶段文档没打开）");
    const measured = JSON.parse(raw);
    const metrics = await metricsSnapshot();
    const heapBytes = typeof metrics.JSHeapUsedSize === "number" ? metrics.JSHeapUsedSize : null;
    return Object.assign({ phase: phase }, measured, {
      heapUsedMB: heapBytes === null ? null : Math.round((heapBytes / (1024 * 1024)) * 10) / 10,
      pageMetrics: pickMetrics(metrics),
    });
  };

  /**
   * 找到"点开这篇文档"的那个可点元素 —— 只导航、不点。
   * 为什么分开：目录树路径要先点知识库→笔记本→文档树，这些点击若算进 t0，openedMs 会被导航时间污染。
   */
  const findOpenPoint = async () => {
    const homeValue = await evaluate(pageHomeCardPoint(opts.title), 15000);
    if (homeValue && homeValue !== "null") return { via: "home-doc-card", point: JSON.parse(homeValue) };
    // keep-alive 下小记/知识库两页都在 DOM：只判「存在」会误判成已在知识库（点不到 offscreen 的 .nb-row）。
    // 261029 实测修复：改为等「可见入口」，必要时点顶部页签再等可见。
    if (!(await pointOf(".nb-row, .nb-shelf-card"))) {
      await clickSelector(".mobile-htab:nth-of-type(2)", 1300);
      for (let i = 0; i < 10 && !(await pointOf(".nb-row, .nb-shelf-card")); i += 1) await sleep(200);
    }
    let entered = false;
    if (prepared.parentTitle) {
      const value = await evaluate(pageNotebookPoint(prepared.parentTitle), 15000);
      if (value && value !== "null") { await clickPoint(JSON.parse(value), 1800); entered = true; }
    }
    if (!entered && !(await clickSelector(".nb-row, .nb-shelf-card", 1800))) throw new Error("找不到笔记本入口（.nb-row / .nb-shelf-card）");
    if (!(await exists(".side-panel--left.on .ln-row, .mobile-workspace .ln-row"))) {
      const value = await evaluate(PAGE_TREE_BUTTON, 15000);
      if (value && value !== "null") await clickPoint(JSON.parse(value), 1200);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = await evaluate(pageTreeRowPoint(opts.title), 15000);
      if (value && value !== "null") return { via: "tree", point: JSON.parse(value) };
      await evaluate(PAGE_SCROLL_TREE, 15000);
      await sleep(500);
    }
    return null;
  };

  const waitForExpr = async (expression, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await evaluate(expression, 15000)) return true; } catch (error) { /* 重试 */ }
      await sleep(200);
    }
    return false;
  };

  log("导航到文档入口（先不点，避免把导航耗时算进打开耗时）…");
  const target = await findOpenPoint();
  if (!target) throw Object.assign(new Error("打开文档失败：首页卡片与目录树都没找到《" + opts.title + "》"), { exitCode: 3 });

  // 计时从"点开文档"这一刻开始（导航/滚动/找行都在 t0 之前）
  await evaluate(pageStartPhase("open"), 15000);
  const metricsBeforeOpen = await metricsSnapshot();
  log("入口：" + target.via + "；开始计时打开 …");
  await clickPoint(target.point, 300);
  if (!(await exists(".mobile-doc-body"))) throw Object.assign(new Error("点了文档入口但没出现 .mobile-doc-body（点击没生效？）"), { exitCode: 3 });
  // 顶栏标题必须是这一篇（首页卡片/目录树都可能点到别的行；点到别的行 = 采到别人的数字）
  const onTargetDoc = await waitForExpr(
    "(function () { var el = document.querySelector('.mobile-topbar .toolbar__title'); return Boolean(el) && String(el.value || '') === " + JSON.stringify(opts.title) + "; })()",
    10000,
  );
  if (!onTargetDoc) throw Object.assign(new Error("打开的不是目标文档：顶栏标题与《" + opts.title + "》不一致（可能点到了别的行）"), { exitCode: 3 });
  const docOpenVia = target.via;
  log("打开方式：" + docOpenVia + "；等只读态渲染静默 …");
  await waitSettled("只读态");
  const viewer = await measure("viewer");
  const metricsAfterViewer = await metricsSnapshot();
  log("只读态节点 " + viewer.nodes + "（正文 " + viewer.bodyNodes + "）/ 段落 " + viewer.paragraphs + " / 卡片 " + viewer.cards + " / 资产请求 " + viewer.assetRequests);

  const editState = await evalJson(PAGE_EDIT_STATE, 15000);
  if (!editState.found || !editState.point) throw new Error("找不到顶栏「编辑」按钮（.mobile-topbar .toolbar__button[aria-label=编辑]）");
  if (editState.disabled) throw new Error("顶栏「编辑」按钮仍是禁用态（文档未 loaded？等它可用后重跑）");
  await evaluate(pageStartPhase("edit"), 15000);
  await clickPoint(editState.point, 300);
  log("等编辑态渲染静默 …");
  await waitSettled("编辑态");
  const editorState = await measure("editor");
  const metricsAfterEditor = await metricsSnapshot();

  // 数据完整性：打开/进编辑后正文是否被内核改写（改写 = 正文或资源形态有问题，指标不可信）
  await sleep(1500);
  const rewriteCheck = await evalJson(pageRewriteCheck(prepared.id), 60000);
  const contentRewritten = rewriteCheck.content !== null && rewriteCheck.content !== built.content;

  const phaseCost = {
    openViewer: phaseDelta(metricsBeforeOpen, metricsAfterViewer),
    enterEditor: phaseDelta(metricsAfterViewer, metricsAfterEditor),
  };

  const docInfo = {
    noteId: prepared.id,
    title: opts.title,
    reused: prepared.reused,
    parentTitle: prepared.parentTitle || null,
    imageMode: imageMode,
    imageFiles: built.imageNames.length,
    assetsWritten: prep.written,
    cloudState: prep.cloudState,
    contentBytes: Buffer.byteLength(built.content, "utf8"),
    expectedBlocks: built.blocks,
    expectedTextParagraphs: built.textParagraphs,
    expectedImageCards: built.images,
  };
  if (contentRewritten) {
    docInfo.contentBytesAfterOpen = Buffer.byteLength(rewriteCheck.content || "", "utf8");
    docInfo.contentHeadAfterOpen = (rewriteCheck.content || "").slice(0, 240);
  }

  const viewerReport = Object.assign({}, viewer, { openedMs: viewer.sinceProbeStartMs, via: docOpenVia });
  const editorReport = Object.assign({}, editorState, { openedMs: editorState.sinceProbeStartMs });

  // 基线对比必须在 openedMs 补齐之后做（compareBaseline 读的就是这两个字段）。
  let baselineDiff = null;
  if (opts.baseline) {
    const baselinePath = resolve(process.cwd(), opts.baseline);
    if (!existsSync(baselinePath)) throw new Error("基线文件不存在：" + baselinePath);
    baselineDiff = compareBaseline({ viewer: viewerReport, editor: editorReport }, JSON.parse(readFileSync(baselinePath, "utf8")));
  }

  const report = assembleReport({
    opts: opts,
    environment: environment,
    doc: docInfo,
    viewer: viewerReport,
    editor: editorReport,
    phaseCost: phaseCost,
    contentRewritten: contentRewritten,
    baselineDiff: baselineDiff,
    allowRewrite: Boolean(opts.allowRewrite),
  });

  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (opts.out) {
    const outPath = resolve(process.cwd(), opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text + "\n");
    log("已写入 " + outPath);
  }
  for (const warning of report.warnings) log("⚠ " + warning);
  if (!report.ok) {
    log("不通过：" + report.failures.join("；"));
    return 1;
  }
  log("完成：只读 " + report.viewer.nodes + " 节点 / 编辑 " + report.editor.nodes + " 节点，打开 " + report.viewer.openedMs + "ms / 进编辑 " + report.editor.openedMs + "ms");
  return 0;
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
    const result = selfCheck(opts);
    console.log(JSON.stringify(result, null, 2));
    console.error("[probe] 自检通过：" + result.checks.length + " 项，正文 " + Math.round(result.contentBytes / 1024) + "KB");
  } else {
    exitCode = await main(opts);
  }
} catch (error) {
  console.error("[probe] 失败：" + (error && error.message ? error.message : String(error)));
  if (process.env.PROBE_DEBUG === "1" && error && error.stack) console.error(error.stack);
  exitCode = error && error.exitCode ? error.exitCode : 1;
}
process.exit(exitCode);
