#!/usr/bin/env node
/**
 * §6.1-#6 测量：保存后 detectOrphans（note-assets readdir/stat + note_history refs 解析）的成本。
 * 对比「裸文档」与「500 资源 + 100 历史快照」文档的 saveNote 延迟。隔离 temp userData，owned child。
 * 用法：node scripts/profile-save-orphans.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
const port = Number(process.env.LAKE_CDP_PORT || 9381);
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29911));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-save-orphans-"));
const appPath = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const NL = String.fromCharCode(10);
let child, socket, seq = 0; const pending = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(){ const d=Date.now()+30000; while(Date.now()<d){ try{ const t=(await (await fetch("http://127.0.0.1:"+port+"/json/list")).json()).find(x=>x.type==="page"); if(t){ socket=new WebSocket(t.webSocketDebuggerUrl); await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;}); socket.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}}; return; } }catch(e){} await wait(250);} throw new Error("no cdp"); }
function send(m,p){ return new Promise((res)=>{ const id=++seq; pending.set(id,res); socket.send(JSON.stringify({id,method:m,params:p||{}})); }); }
async function ev(x){ const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true}); if(r.result&&r.result.exceptionDetails){ const ex=r.result.exceptionDetails; throw new Error("evaluate: "+((ex.exception&&ex.exception.description)||ex.text)); } return r.result?r.result.result.value:undefined; }
async function waitFor(x,t){ const d=Date.now()+(t||30000); while(Date.now()<d){ try{ if(await ev(x)) return true; }catch(e){} await wait(200);} return false; }
async function quit(){ try{ child&&child.kill("SIGTERM"); }catch(e){} const ex=await Promise.race([new Promise(r=>child&&child.once("exit",()=>r(true))), wait(8000).then(()=>false)]); if(!ex){ try{child&&child.kill("SIGKILL");}catch(e){} } await wait(400); }
function stats(arr){ if(!arr.length) return {n:0}; const s=arr.slice().sort((a,b)=>a-b); const p=(q)=>s[Math.min(s.length-1,Math.floor(s.length*q))]; return { n:s.length, min:+s[0].toFixed(2), median:+p(0.5).toFixed(2), p95:+p(0.95).toFixed(2), max:+s[s.length-1].toFixed(2), mean:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2) }; }

const N_ASSETS = Number(process.env.LAKE_ORPHAN_ASSETS || 500);
const N_HISTORY = Number(process.env.LAKE_ORPHAN_HISTORY || 100);
const SAVES = 7;

try {
  const env=Object.assign({},process.env,{LAKE_RENDERER:"scheme",LAKE_USER_DATA:dir,LAKE_ASSET_PORT:assetPort}); delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(appPath,[".","--remote-debugging-port="+port,"--disable-gpu","--no-sandbox"],{env,stdio:"ignore"});
  await connect(); await send("Runtime.enable");
  await waitFor("document.readyState==='complete' && Boolean(window.lakeNative)",40000);

  // 裸文档
  const bareId = await ev("(async function(){ var n=await window.lakeNative.createNote('BARE'); return n.id; })()");
  // 重载文档：先建，再写资源文件 + 历史快照
  const heavyId = await ev("(async function(){ var n=await window.lakeNative.createNote('HEAVY'); return n.id; })()");
  const assetsDir = path.join(dir, "workspace-default", "note-assets", heavyId);
  fs.mkdirSync(assetsDir, { recursive: true });
  const base13 = Date.now();
  const filenames = [];
  for (let i = 0; i < N_ASSETS; i += 1) { const name = String(base13 + i).padStart(13, "0") + "_" + i.toString(16).padStart(8, "0") + ".png"; filenames.push(name); fs.writeFileSync(path.join(assetsDir, name), Buffer.from([0x89,0x50,0x4e,0x47])); }
  const heavyBody = (v) => "<p>heavy " + v + "</p>" + filenames.map((f) => '<img src="http://127.0.0.1:29911/' + heavyId + "/" + f + '">').join("");
  await ev("(async function(){ var api=window.lakeNative; await api.saveNote(" + JSON.stringify(heavyId) + ", 'HEAVY', " + JSON.stringify(heavyBody(0)) + ", null); return true; })()");
  // 历史快照（每条不同内容，force=true 避免去重）
  for (let i = 0; i < N_HISTORY; i += 1) {
    await ev("(async function(){ await window.lakeNative.createHistorySnapshot(" + JSON.stringify(heavyId) + ", " + JSON.stringify(heavyBody("h" + i)) + ", true); return true; })()");
  }
  console.log("SETUP " + JSON.stringify({ bareId, heavyId, assets: N_ASSETS, history: N_HISTORY, assetsDir }));

  const measure = async (id, label) => {
    const times = [];
    for (let i = 0; i < SAVES; i += 1) {
      const body = "<p>" + label + " v" + i + " " + "x".repeat(200) + "</p>" + (label === "HEAVY" ? filenames.map((f) => '<img src="http://127.0.0.1:29911/' + id + "/" + f + '">').join("") : "");
      const t0 = Date.now();
      await ev("(async function(){ await window.lakeNative.saveNote(" + JSON.stringify(id) + ", " + JSON.stringify(label) + ", " + JSON.stringify(body) + ", null); return true; })()");
      times.push(Date.now() - t0);
    }
    return { label, saves: times.length, ms: stats(times) };
  };
  const bare = await measure(bareId, "BARE");
  const heavy = await measure(heavyId, "HEAVY");
  console.log("BARE  " + JSON.stringify(bare));
  console.log("HEAVY " + JSON.stringify(heavy));
  console.log("DELTA " + JSON.stringify({ medianMs: +(heavy.ms.median - bare.ms.median).toFixed(2), ratio: bare.ms.median ? +(heavy.ms.median / bare.ms.median).toFixed(2) : null }));
} catch (e) { console.error("err", e && e.stack || e); process.exitCode = 2; } finally {
  await quit();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}
