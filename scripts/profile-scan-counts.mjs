#!/usr/bin/env node
/**
 * §6.1-#4/#5 测量：包一层 querySelectorAll 统计「音频全工作区扫描」与「代码块扫描」的调用次数。
 * 不改产品代码。env LAKE_SCAN_TABS=N。隔离 temp userData，owned child。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
const port = Number(process.env.LAKE_CDP_PORT || 9383);
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29913));
const tabs = Number(process.env.LAKE_SCAN_TABS || 1);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-scan-counts-"));
const appPath = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const NL = String.fromCharCode(10);
let child, socket, seq = 0; const pending = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(){ const d=Date.now()+30000; while(Date.now()<d){ try{ const t=(await (await fetch("http://127.0.0.1:"+port+"/json/list")).json()).find(x=>x.type==="page"); if(t){ socket=new WebSocket(t.webSocketDebuggerUrl); await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;}); socket.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}}; return; } }catch(e){} await wait(250);} throw new Error("no cdp"); }
function send(m,p){ return new Promise((res)=>{ const id=++seq; pending.set(id,res); socket.send(JSON.stringify({id,method:m,params:p||{}})); }); }
async function ev(x){ const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true}); if(r.result&&r.result.exceptionDetails){ const ex=r.result.exceptionDetails; throw new Error("evaluate: "+((ex.exception&&ex.exception.description)||ex.text)); } return r.result?r.result.result.value:undefined; }
async function waitFor(x,t){ const d=Date.now()+(t||30000); while(Date.now()<d){ try{ if(await ev(x)) return true; }catch(e){} await wait(200);} return false; }
async function quit(){ try{ child&&child.kill("SIGTERM"); }catch(e){} const ex=await Promise.race([new Promise(r=>child&&child.once("exit",()=>r(true))), wait(8000).then(()=>false)]); if(!ex){ try{child&&child.kill("SIGKILL");}catch(e){} } await wait(400); }
try {
  const env=Object.assign({},process.env,{LAKE_RENDERER:"scheme",LAKE_USER_DATA:dir,LAKE_ASSET_PORT:assetPort}); delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(appPath,[".","--remote-debugging-port="+port,"--disable-gpu","--no-sandbox"],{env,stdio:"ignore"});
  await connect(); await send("Runtime.enable");
  await waitFor("document.readyState==='complete' && Boolean(window.lakeNative)",40000);
  await ev([
    "(function(){",
    "  window.__scan = { audio: 0, codeblock: 0, total: 0 };",
    "  var dp = Document.prototype.querySelectorAll;",
    "  Document.prototype.querySelectorAll = function(sel){ window.__scan.total += 1; if (String(sel).indexOf('ne-card[name=\"audio\"') >= 0) window.__scan.audio += 1; return dp.call(this, sel); };",
    "  var ep = Element.prototype.querySelectorAll;",
    "  Element.prototype.querySelectorAll = function(sel){ window.__scan.total += 1; if (String(sel) === '.ne-codeblock') window.__scan.codeblock += 1; return ep.call(this, sel); };",
    "  return true;",
    "})()",
  ].join(NL));
  const ids = [];
  for (let i = 0; i < tabs; i += 1) {
    const id = await ev("(async function(){ var api=window.lakeNative; var n=await api.createNote('SCAN-" + i + "'); await api.saveNote(n.id, n.title, '<p>scan test " + i + "</p>', null); return n.id; })()");
    ids.push(id);
  }
  await waitFor("Boolean(document.querySelector('[data-tree-node-id]'))", 20000);
  for (const id of ids) {
    await ev("(function(){ var r=Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(id) + "; }); if(r) r.click(); return true; })()");
    await wait(700);
  }
  // 打开后等待音频兜底跑完（无卡 5 次 × 800ms ≈ 4s）
  await wait(6000);
  const afterOpen = await ev("JSON.stringify(window.__scan)");
  // 制造 mutation（在活动编辑器输入），触发代码块扫描
  const rectRaw = await ev("(function(){ var eds=Array.prototype.slice.call(document.querySelectorAll('.ne-editor')).filter(function(e){return e.getBoundingClientRect().height>0;}); var e=eds[0]; if(!e) return null; var p=e.querySelector('ne-p')||e; var r=p.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+12), y: Math.round(r.top+10) }); })()");
  if (rectRaw) { const rect = JSON.parse(rectRaw);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(200);
    for (let i = 0; i < 12; i += 1) { await send("Input.insertText", { text: "x" }); await wait(80); }
  }
  await wait(2500);
  const afterType = await ev("JSON.stringify(window.__scan)");
  console.log("TABS " + tabs + " AFTER_OPEN " + afterOpen + " AFTER_TYPE " + afterType);
} catch (e) { console.error("err", e && e.stack || e); process.exitCode = 2; } finally {
  await quit();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}
