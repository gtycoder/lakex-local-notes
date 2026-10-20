#!/usr/bin/env node
/**
 * Opt-in packaged benchmark for 8/24 open text tabs. It measures activation
 * latency and rendered node counts without changing editor behavior.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const appPath = process.env.LAKE_PACKAGED_EXECUTABLE || path.resolve("release/mac-arm64/LocalLakeNotes.app/Contents/MacOS/LocalLakeNotes");
const port = Number(process.env.LAKE_CDP_PORT || 9340);
if (!existsSync(appPath)) throw new Error(`找不到 packaged executable: ${appPath}`);
const dataDir = `/tmp/lake-tab-benchmark-${Date.now()}`;
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29882));
let child;
let socket;
let id = 0;
let pending;
async function targets() { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()); }
async function connect() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const target = (await targets()).find((item) => item.type === "page");
      if (target) {
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        pending = new Map();
        socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
        return;
      }
    } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`tab benchmark CDP 在 ${port} 未就绪`);
}
function send(method, params = {}) { return new Promise((resolve) => { const requestId = ++id; pending.set(requestId, resolve); socket.send(JSON.stringify({ id: requestId, method, params })); }); }
async function evaluate(expression) { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text || "evaluate failed"); return result.result?.result?.value; }
async function wait(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(expression, timeout = 20_000) { const started = Date.now(); while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await wait(100); } throw new Error(`等待超时: ${expression}`); }
async function waitForExit(process, timeoutMs = 10_000) {
  if (process.exitCode !== null) return true;
  return await Promise.race([
    new Promise((resolve) => process.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
async function quit() {
  // Kill the owned child directly; awaiting Runtime.evaluate(window.close()) can
  // hang forever while the renderer is tearing down.
  try { child?.kill("SIGTERM"); } catch {}
  const exited = await waitForExit(child);
  if (!exited) { try { child?.kill("SIGKILL"); } catch {} await waitForExit(child, 2_000); }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const counts = [8, 24];
let noteIds = [];
try {
  child = spawn(appPath, [`--remote-debugging-port=${port}`, "--disable-gpu"], { env: { ...process.env, LAKE_USER_DATA: dataDir, LAKE_ASSET_PORT: assetPort }, stdio: "ignore" });
  await connect(); await send("Runtime.enable"); await send("Page.enable");
  await waitFor('document.readyState === "complete" && Boolean(window.lakeNative)');
  noteIds = await evaluate(`(async()=>{ const ids=[]; for(let i=0;i<24;i++){ const note=await window.lakeNative.createNote(${JSON.stringify("__tab-benchmark__")}+i); await window.lakeNative.saveNote(note.id,note.title,"<p>tab benchmark "+i+"</p>"); ids.push(note.id); } return ids; })()`);
  await evaluate(`(()=>{ const current=JSON.parse(localStorage.getItem("lake-notes-v1.settings")||"{}"); localStorage.setItem("lake-notes-v1.settings", JSON.stringify({...current, maxOpenTabs:24})); location.reload(); return true; })()`);
  await waitFor('document.querySelectorAll("[data-tree-node-id]").length > 10');
  await wait(500);
  await evaluate('document.querySelector(".tab-item .tab-close")?.click(); true');
  await wait(200);
  const results = [];
  for (const count of counts) {
    const started = Date.now();
    for (const noteId of noteIds.slice(0, count)) {
      const clicked = await evaluate(`(()=>{ const row=document.querySelector('[data-tree-node-id="${noteId}"]'); row?.click(); return Boolean(row); })()`);
      try { await waitFor(`Boolean(document.querySelector('.tab-item.active[data-note-id="${noteId}"]'))`); }
      catch (error) {
        console.error("tab benchmark click failure", JSON.stringify({ noteId, clicked, tabs: await evaluate('JSON.stringify([...document.querySelectorAll(".tab-item")].map(x=>({id:x.dataset.noteId,active:x.classList.contains("active")})))'), rows: await evaluate('document.querySelectorAll("[data-tree-node-id]").length'), body: await evaluate('document.body.innerText.slice(-300)') }));
        throw error;
      }
    }
    results.push({ count, totalMs: Date.now() - started, averageMs: Math.round((Date.now() - started) / count), tabs: await evaluate('document.querySelectorAll(".tab-item").length'), editors: await evaluate('document.querySelectorAll(".lake-editor-tab").length'), engines: await evaluate('document.querySelectorAll(".ne-engine").length'), domNodes: await evaluate('document.querySelectorAll("*").length') });
  }
  console.log(JSON.stringify({ dataDir, results }, null, 2));
} finally {
  try { if (noteIds.length) await evaluate(`(async()=>{for(const id of ${JSON.stringify(noteIds)}){try{await window.lakeNative.deleteNote(id)}catch{}} return true})()`); } catch {}
  await quit();
}
