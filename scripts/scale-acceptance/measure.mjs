#!/usr/bin/env node
/**
 * 大库验收测量（10k 文档 / 100k 附件）：同一 seed 启动隔离应用，测启动/树/搜索/打开/资源统计/设置页。
 *
 * 用法：
 *   node scripts/scale-acceptance/measure.mjs --seed /tmp/lake-scale-seed-full [--runs 1] [--report <file>]
 *
 * 选项：
 *   --seed <dir>        seed-large-library.mjs 产出的目录（必须在 /tmp/lake-scale-*）
 *   --report <file>     报告 JSON（默认 <seed>/measure-report.json）
 *   --runs <n>          重复测量的启动次数（默认 1；2 可看缓存热启动）
 *   --cdp-port <port>   CDP 端口（默认 9411）
 *   --asset-port <port> 资源服务端口（默认 19911）
 *   --run-timeout <ms>  单轮总超时（默认 300000）
 *   --label <text>      报告标签（例如 261114-10k）
 *
 * 判据定义（都写进报告，便于复查）：
 *   - firstScreenMs    = spawn → 外壳（.tab-bar）出现
 *   - treeRowsMs       = spawn → 目录树渲染出全部预期节点（10k+）
 *   - treeFirstRowMs   = spawn → 目录树第一行
 *   - searchHitMs      = 触发 ⌘K → 搜索结果出现（命中种子正文/标题关键词）
 *   - openDocMs        = 点击目录行 → 目标 tab 的 .ne-engine 渲染完成（首篇含内核 chunk 懒加载）
 *   - openDocWarmMs    = 已有 tab 时再打开另一篇
 *   - storageMs        = getSystemInfo（资源统计）往返
 *   - resourcePageMs   = 打开「资源」页并渲染完成
 *   - settingsMs       = 打开偏好设置面板并渲染完成
 *
 * 退出码：0 = 测量完成（即使某些预算超标，报告里 verdict/budgetPass 为 false）；
 *         1 = 测量本身失败（应用起不来 / 桥不可用 / 搜索无命中 / 打开文档失败 / 目录树超时 / 资源统计失败）。
 * 收尾：无论成败都关闭本次启动的 Electron（只按自己的 CDP 端口定位，绝不 pkill Electron）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { wait, waitFor } from "./lib/cdp.mjs";
import {
  TEMP_PREFIX,
  assertIsolatedPath,
  attachAppPage,
  directoryStats,
  fail,
  hostInfo,
  humanBytes,
  isPortInUse,
  readBootReadyMs,
  readJsonFile,
  resolveApp,
  startIsolatedApp,
  stopIsolatedApp,
  tailLog,
  writeJsonFile,
} from "./lib/env.mjs";

/** 预算（ms）：宽松门槛，只用来判「不可用」而不是竞争排名；报告里逐项记录实测。 */
const BUDGETS = {
  firstScreenMs: 3_000,
  treeFirstRowMs: 5_000,
  treeRowsMs: 20_000,
  searchHitMs: 1_500,
  openDocMs: 4_000,
  openDocWarmMs: 4_000,
  storageMs: 2_000,
  resourcePageMs: 3_000,
  settingsMs: 3_000,
};
const TREE_WAIT_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const options = {
    seed: "",
    report: "",
    runs: 1,
    cdpPort: 9_411,
    assetPort: 19_911,
    runTimeout: 300_000,
    label: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`参数 ${arg} 缺少取值`);
      return value;
    };
    switch (arg) {
      case "--seed": options.seed = next(); break;
      case "--report": options.report = next(); break;
      case "--runs": options.runs = Number(next()); break;
      case "--cdp-port": options.cdpPort = Number(next()); break;
      case "--asset-port": options.assetPort = Number(next()); break;
      case "--run-timeout": options.runTimeout = Number(next()); break;
      case "--label": options.label = next(); break;
      case "--help":
      case "-h":
        console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
        process.exit(0);
        break;
      default:
        fail(`未知参数：${arg}`);
    }
  }
  if (!options.seed) fail("缺少 --seed（先跑 seed-large-library.mjs）");
  options.seed = assertIsolatedPath(options.seed, "seed 目录");
  if (!options.report) options.report = path.join(options.seed, "measure-report.json");
  options.report = assertIsolatedPath(options.report, "报告路径");
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 5) fail("--runs 必须是 1..5");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const workspaceRoot = path.join(options.seed, "workspace-default");
if (!fs.existsSync(path.join(workspaceRoot, "metadata.sqlite3"))) {
  fail(`不是有效 seed（缺 ${workspaceRoot}/metadata.sqlite3）：${options.seed}`);
}

/** 只读预检：直接用 better-sqlite3 看结构化数据（不启动应用也能拿到期望值）。 */
function inspectSeed() {
  const db = new Database(path.join(workspaceRoot, "metadata.sqlite3"), { readonly: true });
  try {
    const treeNodes = db.prepare("SELECT COUNT(*) AS n FROM tree_nodes WHERE deleted_at IS NULL").get().n;
    const notes = db.prepare("SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL").get().n;
    const notebooks = db.prepare("SELECT COUNT(*) AS n FROM tree_nodes WHERE node_type='notebook' AND deleted_at IS NULL").get().n;
    const sample = db.prepare(
      "SELECT id,title FROM notes WHERE deleted_at IS NULL AND title LIKE '%规模验收文档%' ORDER BY title LIMIT 1 OFFSET "
      + "MAX(0,(SELECT COUNT(*) FROM notes WHERE title LIKE '%规模验收文档%')/2)",
    ).get();
    return { treeNodes, notes, notebooks, sample };
  } finally {
    db.close();
  }
}

const seedInspect = inspectSeed();
const seedReportPath = path.join(options.seed, "seed-report.json");
const seedReport = fs.existsSync(seedReportPath) ? readJsonFile(seedReportPath) : null;
const expectedTreeRows = seedReport?.actual?.treeNodes ?? seedInspect.treeNodes;
const sampleNoteId = seedReport?.actual?.workspace?.sampleNoteId ?? seedInspect.sample?.id ?? "";
const sampleNoteTitle = seedReport?.actual?.workspace?.sampleNoteTitle ?? seedInspect.sample?.title ?? "";
const searchToken = (seedInspect.sample?.title ?? sampleNoteTitle).match(/(\d{5})\s*$/)?.[1] ?? "";
if (!sampleNoteId) fail("seed 里找不到样例文档（先跑 seed-large-library.mjs）");
if (!searchToken) fail("无法从样例文档标题推导搜索关键词（形如「规模验收文档 00050」）");

const expectedAssetFiles = seedReport?.actual?.assetFiles ?? directoryStats(path.join(workspaceRoot, "note-assets")).files;
const expectedAssetBytes = seedReport?.actual?.assetBytes ?? 0;

const app = resolveApp();
console.log(`[measure] seed=${options.seed}`);
console.log(`[measure] 应用=${app.kind} exe=${app.exe} ${app.distHint}`);
console.log(`[measure] 预期：树节点 ${expectedTreeRows} / 附件 ${expectedAssetFiles}（${humanBytes(expectedAssetBytes)}）/ 样例 ${sampleNoteId} 关键词 ${searchToken}`);

const runs = [];
const failedRuns = [];
const errors = [];

/** 单轮测量（index 从 0 开始；log 文件按轮分开，便于复盘）。 */
async function measureRun(index) {
  const logPath = path.join(options.seed, "measure", `run-${index + 1}-app.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const launched = startIsolatedApp({ userData: options.seed, cdpPort: options.cdpPort, assetPort: options.assetPort, logPath });
  const t0 = launched.startedAt;
  const run = {
    index,
    app: {
      kind: launched.kind,
      exe: launched.exe,
      args: launched.args,
      cdpPort: launched.cdpPort,
      assetPort: launched.assetPort,
      logPath,
      distHint: launched.distHint,
    },
    startup: {},
    tree: {},
    search: {},
    openDoc: {},
    openDocWarm: {},
    storage: {},
    resourcePage: {},
    settings: {},
    memory: {},
    cleanup: {},
    errors: [],
  };
  let cdp = null;
  try {
    // ===== 启动链路 =====
    cdp = await attachAppPage(launched, TREE_WAIT_TIMEOUT_MS).catch(async (error) => {
      throw new Error(`应用/桥未就绪：${error.message}`);
    });
    run.startup.pageAvailableMs = Date.now() - t0;
    run.startup.shellReadyMs = await waitFor(cdp, "!!document.querySelector('.tab-bar')", 60_000);
    run.startup.bridgeReadyMs = await waitFor(cdp, "!!(window.lakeNative && window.lakeNative.listTreeNodes)", 60_000);
    run.startup.treeFirstRowMs = await waitFor(cdp, "document.querySelectorAll('[role=treeitem][data-tree-node-id]').length > 0", 60_000);
    run.startup.bootReadyLogMs = readBootReadyMs(logPath);
    // 桌面会恢复上次标签（这是产品行为）：记录条数，后面「打开文档」会挑一篇没打开的，避免测成 0ms。
    run.startup.restoredTabs = await cdp.evaluate("document.querySelectorAll('.lake-editor-tab').length");
    run.startup.inPage = JSON.parse(await cdp.evaluate(`JSON.stringify({
      now: Math.round(performance.now()),
      domInteractive: Math.round(performance.timing?.domInteractive ? performance.timing.domInteractive - performance.timing.navigationStart : -1),
      navDomContentLoaded: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? -1),
      navLoad: Math.round(performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? -1),
      url: location.href
    })`));

    // ===== 目录树（10k 节点全量渲染）=====
    const treeWaitStart = Date.now();
    let treeRows = 0;
    let treeAllRowsOk = false;
    try {
      await waitFor(
        cdp,
        `document.querySelectorAll('[role=treeitem][data-tree-node-id]').length >= ${expectedTreeRows}`,
        TREE_WAIT_TIMEOUT_MS,
        200,
      );
      treeAllRowsOk = true;
    } catch {
      treeAllRowsOk = false;
    }
    run.tree.allRowsMs = Date.now() - treeWaitStart + run.startup.treeFirstRowMs;
    treeRows = await cdp.evaluate("document.querySelectorAll('[role=treeitem][data-tree-node-id]').length");
    run.tree.expectedRows = expectedTreeRows;
    run.tree.renderedRows = treeRows;
    run.tree.allRowsOk = treeAllRowsOk;
    run.tree.truncated = treeRows < expectedTreeRows;
    run.tree.domNodes = await cdp.evaluate("document.querySelectorAll('*').length");
    // 产品 IPC 侧耗时（数据层是否跟得上 UI）
    const ipcTree = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      ipcTree.push(JSON.parse(await cdp.evaluate(`(async()=>{const t=performance.now();const rows=await window.lakeNative.listTreeNodes();return JSON.stringify({ms:Math.round((performance.now()-t)*10)/10,n:rows.length})})()`)));
    }
    run.tree.listTreeNodesMs = ipcTree.map((entry) => entry.ms);
    run.tree.listTreeNodesCount = ipcTree.at(-1)?.n ?? null;

    // ===== 搜索（真实 ⌘K 面板 + 输入 → 结果）=====
    const searchStart = Date.now();
    await cdp.evaluate(`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true}));return true})()`);
    await waitFor(cdp, "!!document.querySelector('.search-command-panel input')", 10_000);
    run.search.panelOpenedMs = Date.now() - searchStart;
    const searchT0 = Date.now();
    await cdp.evaluate(`(()=>{
      const input=document.querySelector('.search-command-panel input');
      const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      setter.call(input, ${JSON.stringify(searchToken)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
    await waitFor(cdp, "document.querySelectorAll('.search-panel-results [role=option]').length > 0", 15_000, 50);
    run.search.resultsMs = Date.now() - searchT0;
    run.search.hitMs = Date.now() - searchStart;
    run.search.resultCount = await cdp.evaluate("document.querySelectorAll('.search-panel-results [role=option]').length");
    run.search.firstResultText = await cdp.evaluate("(document.querySelector('.search-panel-results [role=option]')||{}).innerText?.slice(0,120) || ''");
    run.search.matchedSample = await cdp.evaluate(`(()=>{
      const rows=[...document.querySelectorAll('.search-panel-results [role=option]')];
      return rows.some(row=>(row.innerText||'').includes(${JSON.stringify(sampleNoteTitle)}));
    })()`);
    // 关闭搜索面板
    await cdp.evaluate("(()=>{document.querySelector('.search-panel-close')?.click();return true})()");
    await wait(150);

    // ===== 打开文档（真实点击目录行；挑一篇「当前没有打开的」，避免命中的是恢复的旧 tab）=====
    const docT0 = Date.now();
    const targetPick = JSON.parse(await cdp.evaluate(`(()=>{
      const open=new Set([...document.querySelectorAll('.lake-editor-tab')].map(tab=>tab.getAttribute('data-note-id')));
      const rows=[...document.querySelectorAll('[role=treeitem][data-tree-node-id]')].filter(row=>row.classList.contains('type-note'));
      const candidates=rows.filter(row=>!open.has(row.getAttribute('data-tree-node-id')));
      // 优先种子正文（欢迎文档没有「规模验收文档编号」标记，用它测会得到假的正文校验失败）
      const target=candidates.find(row=>row.getAttribute('data-tree-node-id')!=='welcome-note') || candidates[0];
      if(!target) return JSON.stringify({ok:false});
      target.scrollIntoView({block:'center'});
      target.click();
      return JSON.stringify({ok:true,id:target.getAttribute('data-tree-node-id'),title:(target.innerText||'').trim().slice(0,80)});
    })()`));
    if (!targetPick.ok) throw new Error("目录树里找不到可打开的文档行");
    const targetNoteId = targetPick.id;
    const tabSelector = `.lake-editor-tab[data-note-id="${targetNoteId}"]`;
    await waitFor(cdp, `!!document.querySelector('${tabSelector}')`, 30_000);
    await waitFor(cdp, `!!document.querySelector('${tabSelector} .ne-engine')`, 60_000);
    run.openDoc.ms = Date.now() - docT0;
    run.openDoc.noteId = targetNoteId;
    run.openDoc.noteTitle = targetPick.title;
    run.openDoc.bodyTextOk = await cdp.evaluate(`(()=>{const el=document.querySelector('${tabSelector} .ne-engine');return !!el && /规模验收文档编号/.test(el.innerText)})()`);
    run.openDoc.fileCards = await cdp.evaluate(`document.querySelectorAll('${tabSelector} [data-card-name=file], ${tabSelector} .ne-card').length`);

    // ===== 再打开一篇（已有 tab 的热路径）=====
    const warmStart = Date.now();
    const second = JSON.parse(await cdp.evaluate(`(()=>{
      const rows=[...document.querySelectorAll('[role=treeitem][data-tree-node-id]')].filter(node=>node.classList.contains('type-note'));
      const taken=new Set([...document.querySelectorAll('.lake-editor-tab')].map(tab=>tab.getAttribute('data-note-id')));
      const row=rows.find(node=>!taken.has(node.getAttribute('data-tree-node-id')) && node.getAttribute('data-tree-node-id')!==${JSON.stringify(sampleNoteId)});
      if(!row) return JSON.stringify({ok:false,id:null});
      row.scrollIntoView({block:'center'}); row.click();
      return JSON.stringify({ok:true,id:row.getAttribute('data-tree-node-id')});
    })()`));
    if (second.ok) {
      await waitFor(cdp, `!!document.querySelector('.lake-editor-tab[data-note-id="${second.id}"] .ne-engine')`, 60_000);
      run.openDocWarm.ms = Date.now() - warmStart;
      run.openDocWarm.noteId = second.id;
      run.openDocWarm.ok = true;
    } else {
      run.openDocWarm.ok = false;
    }

    // ===== 资源统计（主进程 getSystemInfo）+ 「资源」页 =====
    const storageStart = Date.now();
    run.storage = JSON.parse(await cdp.evaluate(`(async()=>{
      const t=performance.now();
      const info=await window.lakeNative.getSystemInfo();
      return JSON.stringify({ms:Math.round((performance.now()-t)*10)/10, storage:info.storage, packaged:info.packaged, version:info.app?.version, runtime:info.runtime});
    })()`));
    run.storage.ms = Date.now() - storageStart;
    run.storage.assetFilesOk = run.storage.storage?.assetFiles === expectedAssetFiles
      || (expectedAssetFiles === 0 && run.storage.storage?.assetFiles > 0);
    const resourceStart = Date.now();
    await cdp.evaluate(`(()=>{document.querySelector('[aria-label="切换空间"]')?.click();return true})()`);
    await waitFor(cdp, "!!document.querySelector('.top-menu--workspace')", 5_000);
    const resourceClicked = await cdp.evaluate(`(()=>{const item=[...document.querySelectorAll('.top-menu--workspace button')].find(button=>button.innerText.trim()==='资源');item?.click();return !!item})()`);
    if (!resourceClicked) throw new Error("顶栏空间菜单里找不到「资源」入口");
    await waitFor(
      cdp,
      "!!(document.body.innerText.includes('可删') && document.body.innerText.includes('清理选中'))",
      30_000,
    );
    run.resourcePage.ms = Date.now() - resourceStart;
    run.resourcePage.text = await cdp.evaluate("document.body.innerText.slice(0,700)");

    // ===== 设置页（偏好设置 + 资源相关分组可见）=====
    const settingsStart = Date.now();
    await cdp.evaluate(`(()=>{document.querySelector('[aria-label="切换空间"]')?.click();return true})()`);
    await waitFor(cdp, "!!document.querySelector('.top-menu--workspace')", 5_000);
    await cdp.evaluate(`(()=>{const item=[...document.querySelectorAll('.top-menu--workspace button')].find(button=>button.innerText.includes('偏好设置'));item?.click();return !!item})()`);
    await waitFor(cdp, "!!document.querySelector('.settings-panel')", 30_000);
    run.settings.ms = Date.now() - settingsStart;
    run.settings.navItems = await cdp.evaluate("[...document.querySelectorAll('.settings-nav-item')].map(item=>item.innerText.trim())");
    run.settings.dialogOk = await cdp.evaluate("document.querySelector('.settings-panel')?.getAttribute('role') === 'dialog'");
    // 数据维护分组：含「全文搜索 / 数据体检 / 数据恢复 / 应用日志」（产品设置页可用性的一部分）
    await cdp.evaluate(`(()=>{const item=[...document.querySelectorAll('.settings-nav-item')].find(node=>node.innerText.trim()==='数据维护');item?.click();return !!item})()`);
    await wait(500);
    run.settings.maintenanceTextOk = await cdp.evaluate("document.body.innerText.includes('全文搜索') && document.body.innerText.includes('数据体检')");
    await cdp.evaluate("(()=>{document.querySelector('.settings-close, .settings-panel [aria-label=\"关闭\"]')?.click();return true})()");
    await wait(200);

    // ===== 内存/DOM 规模 =====
    run.memory = JSON.parse(await cdp.evaluate(`JSON.stringify({
      domNodes: document.querySelectorAll('*').length,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
      treeRows: document.querySelectorAll('[role=treeitem][data-tree-node-id]').length
    })`));
    try {
      const rss = execFileSync("ps", ["-o", "rss=", "-p", String(launched.child.pid)], { encoding: "utf8" }).trim();
      run.memory.mainProcessRssBytes = Number(rss) * 1024;
    } catch {
      run.memory.mainProcessRssBytes = null;
    }

    run.startup.processToShellTotalMs = run.startup.shellReadyMs;
    run.checks = {
      appReady: true,
      treeRowsOk: run.tree.allRowsOk,
      searchHitOk: run.search.resultCount > 0 && (run.search.matchedSample !== false),
      openDocOk: run.openDoc.bodyTextOk === true,
      storageOk: run.storage.assetFilesOk === true,
      resourcePageOk: true,
      settingsOk: run.settings.dialogOk === true,
    };
  } catch (error) {
    run.errors.push(error instanceof Error ? error.message : String(error));
    run.checks = run.checks || {};
    run.checks.appReady = false;
    run.failed = true;
    failedRuns.push(run);
    throw error;
  } finally {
    run.cleanup = await stopIsolatedApp(launched);
    run.cleanup.cdpPortFree = !isPortInUse(options.cdpPort);
    run.cleanup.assetPortFree = !isPortInUse(options.assetPort);
    run.cleanup.logTail = tailLog(logPath, 4000);
    run.logPath = logPath;
  }
  return run;
}

const startedAt = Date.now();
let fatal = null;
try {
  for (let index = 0; index < options.runs; index += 1) {
    console.log(`[measure] 第 ${index + 1}/${options.runs} 轮启动与交互测量...`);
    let run;
    try {
      run = await measureRun(index);
    } catch (error) {
      errors.push(`run ${index + 1} 失败：${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    runs.push(run);
    console.log(`[measure] 第 ${index + 1} 轮完成：firstScreen=${run.startup.shellReadyMs}ms tree=${run.tree.allRowsMs}ms rows=${run.tree.renderedRows}/${run.tree.expectedRows} search=${run.search.hitMs}ms open=${run.openDoc.ms}ms storage=${run.storage.ms}ms`);
    await wait(1_000);
  }
} catch (error) {
  fatal = error instanceof Error ? error.stack ?? error.message : String(error);
  errors.push(fatal);
}

// ===== 汇总（每项指标：原始序列 + min/median/max；预算按 median 判）=====
const METRIC_ACCESSORS = {
  firstScreenMs: (run) => run.startup.shellReadyMs,
  treeFirstRowMs: (run) => run.startup.treeFirstRowMs,
  treeRowsMs: (run) => run.tree.allRowsMs,
  searchHitMs: (run) => run.search.hitMs,
  openDocMs: (run) => run.openDoc.ms,
  openDocWarmMs: (run) => run.openDocWarm?.ms,
  storageMs: (run) => run.storage?.ms,
  resourcePageMs: (run) => run.resourcePage?.ms,
  settingsMs: (run) => run.settings?.ms,
};
const statsSummary = {};
for (const [key, accessor] of Object.entries(METRIC_ACCESSORS)) {
  const values = runs.map(accessor).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (values.length === 0) {
    statsSummary[key] = null;
    continue;
  }
  statsSummary[key] = {
    raw: values,
    n: values.length,
    min: values[0],
    median: values[Math.floor((values.length - 1) / 2)],
    max: values.at(-1),
  };
}
const budgetChecks = {};
for (const [key, budget] of Object.entries(BUDGETS)) {
  const measured = statsSummary[key];
  budgetChecks[key] = measured
    ? { budgetMs: budget, measuredMs: measured.median, raw: measured.raw, pass: measured.median <= budget }
    : { budgetMs: budget, measuredMs: null, pass: null };
}
const allRuns = [...runs, ...failedRuns];
const hardChecks = {
  appReady: runs.length === options.runs && failedRuns.length === 0 && runs.every((run) => run.checks?.appReady === true),
  treeRowsOk: runs.length > 0 && runs.every((run) => run.checks?.treeRowsOk === true),
  searchHitOk: runs.length > 0 && runs.every((run) => run.checks?.searchHitOk === true),
  openDocOk: runs.length > 0 && runs.every((run) => run.checks?.openDocOk === true),
  storageOk: runs.length > 0 && runs.every((run) => run.checks?.storageOk === true),
  resourcePageOk: runs.length > 0 && runs.every((run) => run.checks?.resourcePageOk === true),
  settingsOk: runs.length > 0 && runs.every((run) => run.checks?.settingsOk === true),
};
const budgetPass = Object.values(budgetChecks).every((entry) => entry.pass !== false);
const allHardPass = Object.values(hardChecks).every(Boolean);

const report = {
  schemaVersion: 1,
  mode: "measure",
  label: options.label || null,
  generatedAt: new Date().toISOString(),
  seedRoot: options.seed,
  workspaceRoot,
  seedReport: seedReportPath,
  expected: {
    treeRows: expectedTreeRows,
    assetFiles: expectedAssetFiles,
    assetBytes: expectedAssetBytes,
    sampleNoteId,
    sampleNoteTitle,
    searchToken,
  },
  app: { kind: app.kind, exe: app.exe, distHint: app.distHint },
  host: hostInfo(),
  runs,
  failedRuns,
  summary: statsSummary,
  budgets: BUDGETS,
  budgetChecks,
  hardChecks,
  verdict: {
    measurementCompleted: runs.length > 0 && errors.length === 0,
    hardChecksPass: allHardPass,
    budgetPass,
    pass: allHardPass && budgetPass && errors.length === 0,
    notes: [
      "本机 dev Electron + LAKE_RENDERER=scheme（服务已构建 dist/，app.isPackaged=false）；真 .app 用 LAKE_SCALE_APP 覆盖。",
      "启动包含浏览器缓存首次冷启动；--runs 2 可看热启动。",
      "搜索结果来自真实 ⌘K 面板 + 输入事件；打开文档是真实点击目录行。",
      "资源统计 = getSystemInfo().storage（磁盘上资产文件数/字节）；「资源」页只列可删/历史保护资源，全部被引用时显示 0 属正常。",
    ],
  },
  elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  errors,
};
writeJsonFile(options.report, report);

console.log("\n[measure] 报告：", options.report);
console.log(JSON.stringify({
  ok: report.verdict.pass,
  measurementCompleted: report.verdict.measurementCompleted,
  hardChecks,
  budgetChecks,
  summary: statsSummary,
  tree: runs.map((run) => ({ rows: run.tree.renderedRows, expected: run.tree.expectedRows, domNodes: run.tree.domNodes })),
  memory: runs.map((run) => run.memory),
  elapsedSec: report.elapsedSec,
  errors,
}, null, 2));

if (!report.verdict.measurementCompleted || !allHardPass) process.exit(1);
