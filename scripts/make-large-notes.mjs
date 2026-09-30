#!/usr/bin/env node
/**
 * 一次性：在指定 userData 的工作区里创建若干大文档（2M/5M/10M），供实机打字体感测试。
 * 走 App 自己的 createNote/saveNote 写入路径（保证 .lake + DB + 缓存一致）。
 * 用法：LAKE_TARGET_USER_DATA="<userData>" node scripts/make-large-notes.mjs
 * 安全：只写传入的 userData（默认开发数据目录），绝不碰正式目录；不删任何数据。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const port = Number(process.env.LAKE_CDP_PORT || 9373);
const assetPort = String(Number(process.env.LAKE_ASSET_PORT || 29899));
const home = os.homedir();
const userData = process.env.LAKE_TARGET_USER_DATA || path.join(home, "Library", "Application Support", "lake-notes-dev");
const sizesMB = (process.env.LAKE_LARGE_SIZES || "2,5,10").split(",").map(Number);
const appPath = path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const NL = String.fromCharCode(10);
let child = null;
let socket = null;
let seq = 0;
const pending = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const t = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()).find((x) => x.type === "page");
      if (t) {
        socket = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
        socket.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
        return;
      }
    } catch (e) { /* retry */ }
    await wait(250);
  }
  throw new Error("CDP 未就绪 " + port);
}
function send(method, params) { return new Promise((res) => { const id = ++seq; pending.set(id, res); socket.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) { const ex = r.result.exceptionDetails; throw new Error("evaluate: " + ((ex.exception && ex.exception.description) || ex.text)); }
  return r.result ? r.result.result.value : undefined;
}
async function waitFor(expr, timeout) { const d = Date.now() + (timeout || 30000); while (Date.now() < d) { try { if (await evaluate(expr)) return true; } catch (e) {} await wait(200); } return false; }
async function quit() { try { if (child) child.kill("SIGTERM"); } catch (e) {} const ex = await Promise.race([ new Promise((r) => { if (child) child.once("exit", () => r(true)); }), wait(8000).then(() => false) ]); if (!ex) { try { if (child) child.kill("SIGKILL"); } catch (e) {} } await wait(300); }

if (!fs.existsSync(path.join(userData, "workspace-default"))) throw new Error("目标 userData 不是 Lake 工作区：" + userData);
const notesDir = path.join(userData, "workspace-default", "notes");
console.log("target userData:", userData);

try {
  const env = Object.assign({}, process.env, { LAKE_RENDERER: "scheme", LAKE_USER_DATA: userData, LAKE_ASSET_PORT: assetPort });
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(appPath, [".", "--remote-debugging-port=" + port, "--disable-gpu", "--no-sandbox"], { env, stdio: "ignore" });
  await connect(); await send("Runtime.enable"); await send("Page.enable");
  await waitFor("document.readyState === 'complete' && Boolean(window.lakeNative)", 40000);
  await evaluate([
    "(function(){",
    "  window.__mk = function(targetBytes){",
    "    var enc = new TextEncoder();",
    "    var para = '<p>' + '这是一段用于性能测试的中文正文，重复填充以撑大文档体积。'.repeat(30) + '</p>';",
    "    var paraB = enc.encode(para).length;",
    "    var out = []; var size = 0; var i = 0;",
    "    while (size < targetBytes) {",
    "      var b = (i % 8 === 0 ? '<h2>第 ' + i + ' 节 · 性能测试</h2>' : '') + para;",
    "      size += enc.encode(b).length; out.push(b); i++;",
    "    }",
    "    return out.join('');",
    "  };",
    "  return true;",
    "})()",
  ].join(NL));

  const created = [];
  for (const mb of sizesMB) {
    const target = mb * 1024 * 1024;
    const t0 = Date.now();
    const res = JSON.parse(await evaluate("(async function(){ var api=window.lakeNative; var c=window.__mk(" + target + "); var n=await api.createNote('性能测试 " + mb + "M', null); await api.saveNote(n.id, n.title, c, null); return JSON.stringify({ id: n.id, chars: c.length }); })()"));
    const file = path.join(notesDir, res.id + ".lake");
    const stat = fs.existsSync(file) ? fs.statSync(file) : null;
    const row = { title: "性能测试 " + mb + "M", noteId: res.id, chars: res.chars, fileBytes: stat ? stat.size : null, ms: Date.now() - t0, file };
    created.push(row);
    console.log("CREATED " + JSON.stringify(row));
  }
  console.log(NL + "DONE " + JSON.stringify({ userData, created }, null, 2));
} catch (error) {
  console.error("make-large-notes error:", error && error.stack ? error.stack : error);
  process.exitCode = 2;
} finally {
  await quit();
}
