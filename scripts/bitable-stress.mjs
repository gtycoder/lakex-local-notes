/**
 * 多维表真实端压测（AR04）。
 *
 * 在**隔离 userData + 独立 CDP 端口**下启动真实 Electron，逐个造一张 N 行 × M 列的多维表
 * 并打开，测量：打开耗时 / DOM 节点数 / 单元格数 / JS 堆 / 点选耗时。
 * 用于判断「全量 DOM 渲染（无虚拟化）」在目标规模下是否可行。
 *
 * 用法：STRESS_SIZES="5000x20,20000x50,50000x50" node scripts/bitable-stress.mjs
 *
 * 约束：每个规模用全新的临时 userData（跑完删除），绝不触碰正式数据目录；
 * 只按本进程 spawn 的 Electron 主进程 PID 收尾，不做任何全局 kill。
 * 注意正文有 32 MiB 上限，超限规模会在保存阶段被拒。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const ELECTRON = join(REPO, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const MODE = process.argv[2] || "smoke";
const sizes = (process.env.STRESS_SIZES || "500x20").split(",").map((s) => s.split("x").map(Number));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget(port, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(300);
  }
  throw new Error("no CDP page on " + port);
}
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const rid = ++id; pending.set(rid, resolve); ws.send(JSON.stringify({ id: rid, method, params })); });
  return { ws, ready, send };
}
async function launch(port, userData) {
  const env = { ...process.env, LAKE_RENDERER: "scheme", LAKE_USER_DATA: userData, LAKE_ASSET_PORT: String(port + 10000) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(ELECTRON, ["--disable-gpu", "--no-sandbox", "--remote-debugging-port=" + port, "."], { cwd: REPO, env, stdio: "ignore" });
  const page = await waitForTarget(port);
  const { ws, ready, send } = connect(page.webSocketDebuggerUrl);
  await ready;
  await send("Runtime.enable");
  await send("Page.enable");
  return { child, ws, send };
}
async function evaluate(send, expression, timeoutMs = 60000) {
  const run = send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const timeout = sleep(timeoutMs).then(() => ({ __timeout: true }));
  const r = await Promise.race([run, timeout]);
  if (r.__timeout) throw new Error("evaluate timeout after " + timeoutMs + "ms");
  if (!r.result) throw new Error("bad CDP response");
  if (r.result.exceptionDetails) throw new Error("eval exception: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
}
async function waitReady(send) {
  for (let i = 0; i < 200; i += 1) {
    const ok = await evaluate(send, "document.readyState === 'complete' && !!window.lakeNative && !!document.querySelector('.tree, .sidebar, .workspace-shell, [class*=tree]')").catch(() => false);
    if (ok) return true;
    await sleep(150);
  }
  return false;
}
const buildBody = (rows, cols) => `(function(){const rows=${rows},cols=${cols};const fields=[];for(let c=0;c<cols;c++)fields.push({id:"fld"+c,name:c===0?"名称":"字段"+c,type:c%5===4?"number":"text"});const records=[];for(let r=0;r<rows;r++){const v={};for(let c=0;c<cols;c++)v["fld"+c]=c===0?("记录"+r):(c%5===4?(r%100):("值"+r+"-"+c));records.push({id:"rec"+r,values:v,createdAt:"2026-09-01T00:00:00.000Z",updatedAt:"2026-09-01T00:00:00.000Z"});}const table={id:"tbl1",name:"压测表",fields:fields,records:records,views:[{id:"vew1",name:"表格视图",type:"grid"}],activeViewId:"vew1"};return JSON.stringify({kind:"bitable",version:1,tables:[table],activeTableId:"tbl1"});})()`;

let exitCode = 0;
for (let i = 0; i < sizes.length; i += 1) {
  const [rows, cols] = sizes[i];
  const port = 9331 + i;
  const userData = mkdtempSync(join(tmpdir(), "lake-stress-"));
  let child = null, ws = null;
  const t0 = Date.now();
  try {
    const h = await launch(port, userData); child = h.child; ws = h.ws;
    await waitReady(h.send);
    // seed
    const title = "压测 " + rows + "x" + cols;
    await evaluate(h.send, "window.lakeNative.bootstrap().then(()=>true).catch(()=>false)", 60000).catch(() => sleep(500));
    await sleep(300);
    const id = await evaluate(h.send, "(async()=>{const note=await window.lakeNative.createBitableIn(null, " + JSON.stringify(title) + ");const body=" + buildBody(rows, cols) + ";await window.lakeNative.saveNote(note.id, " + JSON.stringify(title) + ", body);return note.id;})()", 180000);
    // ensure tree node visible (reload if needed)
    let hasNode = await evaluate(h.send, "!!document.querySelector('[data-tree-node-id=\"" + id + "\"]')").catch(() => false);
    if (!hasNode) {
      await h.send("Page.reload", { ignoreCache: false });
      await sleep(1500); await waitReady(h.send);
    }
    const measure = "(async()=>{const id=" + JSON.stringify(id) + ",expected=" + rows + ";const node=document.querySelector('[data-tree-node-id=\"" + id + "\"]');if(!node)return{error:'tree-node-missing'};const t0=performance.now();node.click();const deadline=performance.now()+120000;let rows=0;while(performance.now()<deadline){rows=document.querySelectorAll('.bitable-editor:not(.fn__none) .bt-grid tr[data-record-id]').length;if(rows>=expected)break;await new Promise(r=>setTimeout(r,25));}const openMs=performance.now()-t0;const root=document.querySelector('.bitable-editor:not(.fn__none)');const nodes=document.querySelectorAll('*').length;const cells=root?root.querySelectorAll('.bt-grid td[data-field-id]').length:0;const heap=performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):-1;let selectMs=-1;const cell=root&&root.querySelector('td[data-field-id]');if(cell){const s0=performance.now();cell.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));const sd=performance.now()+20000;while(performance.now()<sd){if(root.querySelector('.cell-selected'))break;await new Promise(r=>setTimeout(r,10));}selectMs=performance.now()-s0;}return{openMs:Math.round(openMs),rows:rows,nodes:nodes,cells:cells,heapMB:heap,selectMs:Math.round(selectMs)};})()";
    const res = await evaluate(h.send, measure, 200000);
    console.log(JSON.stringify({ size: rows + "x" + cols, wallMs: Date.now() - t0, ...res }));
  } catch (err) {
    console.log(JSON.stringify({ size: rows + "x" + cols, wallMs: Date.now() - t0, error: String(err && err.message || err).slice(0, 200) }));
  } finally {
    try { if (child) child.kill("SIGKILL"); } catch {}
    await sleep(400);
    try {
      const pid = child && child.pid;
      if (pid) { const { execSync } = await import("node:child_process"); try { execSync("kill -9 " + pid + " 2>/dev/null"); } catch {} }
    } catch {}
    try { if (ws) ws.close(); } catch {}
    await sleep(500);
    try { rmSync(userData, { recursive: true, force: true }); } catch {}
  }
}
process.exit(exitCode);
