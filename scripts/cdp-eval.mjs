#!/usr/bin/env node
/** 连到已运行的 Electron CDP，执行一个表达式并打印 JSON。用法: node scripts/cdp-eval.mjs <port> "<expr>" [--no-await] */
import { readFileSync, writeFileSync } from "node:fs";
const port = Number(process.argv[2] || 9230);
let expr = process.argv[3] || "1+1";
if (expr.startsWith("@")) expr = readFileSync(expr.slice(1), "utf8");
const noAwait = process.argv.includes("--no-await");

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("no page target"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); return; }
  if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
    logs.push({ t: msg.params.type, args: (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400) });
  } else if (msg.method === "Runtime.exceptionThrown") {
    logs.push({ t: "exception", args: String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "").slice(0, 500) });
  } else if (msg.method === "Log.entryAdded" && msg.params.entry?.level === "error") {
    logs.push({ t: "log", args: String(msg.params.entry.text).slice(0, 400) });
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error("timeout " + method)); } }, 30000); });
await send("Runtime.enable");
await send("Log.enable");
const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: !noAwait, returnByValue: true });
if (r.exceptionDetails) { console.error("EXCEPTION:", JSON.stringify(r.exceptionDetails).slice(0, 500)); process.exit(1); }
console.log(JSON.stringify(r.result?.value, null, 1));
if (process.argv.includes("--logs")) console.error("__LOGS__" + JSON.stringify(logs));
if (process.argv.includes("--shot")) {
  const file = process.argv[process.argv.indexOf("--shot") + 1] || "/tmp/shot.png";
  await send("Page.enable");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log("shot:", file);
}
ws.close();
