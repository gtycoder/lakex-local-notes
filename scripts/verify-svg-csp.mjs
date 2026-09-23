/**
 * P0 验证：SVG 安全响应头在真实 Chromium 下的行为矩阵（CDP 驱动）。
 * 纯 Node（不依赖仓库 TS）：起一个小 http 服务，按变体下发 CSP；Chrome headless 经 CDP 导航/取值。
 * 回答问题：
 *  1) 加 CSP(sandbox) 后 <img src=svg> 是否还显示（clean / 含 data: 图）；
 *  2) evil.svg 的 <script> 在顶层导航下是否被拦住；
 *  3) PNG 在仅 nosniff 下正常（对照）。
 * 用法：node scripts/verify-svg-csp.mjs
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME)) { console.error("SKIP: Chrome not found at " + CHROME); process.exit(2); }
const CDP_PORT = Number(process.env.LAKE_CSP_CDP_PORT || 9341);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const VARIANTS = {
  A_full: "sandbox; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'",
  B_nosandbox: "default-src 'none'; script-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'",
  NONE: null
};
const PNG1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SAMPLES = {
  "clean.svg": "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20' fill='#3b5bdb'/></svg>",
  "embed-data.svg": "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='30'><image x='0' y='0' width='40' height='30' href='data:image/png;base64," + PNG1x1 + "'/></svg>",
  "evil.svg": "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><script>document.documentElement.setAttribute('data-evil','RUN');</script><rect width='40' height='20' fill='#c92a2a'/></svg>"
};

function pageHtml(variant) {
  return "<!doctype html><meta charset='utf-8'><title>svg-csp</title><body><pre id='out'>pending</pre><script>" +
    "var names=['clean.svg','embed-data.svg','evil.svg','img.png'];var out=[];var left=names.length;" +
    "function alphaOf(img){try{var c=document.createElement('canvas');c.width=img.naturalWidth||1;c.height=img.naturalHeight||1;var x=c.getContext('2d');x.drawImage(img,0,0);var d=x.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;return d[3];}catch(e){return -1;}}" +
    "function done(){if(--left===0){var s=out.join('|');document.body.setAttribute('data-result',s);document.getElementById('out').textContent=s;}}" +
    "names.forEach(function(n){var i=new Image();" +
    "i.onload=function(){out.push(n+':ok:'+i.naturalWidth+'x'+i.naturalHeight+':a'+alphaOf(i));done();};" +
    "i.onerror=function(){out.push(n+':err');done();};" +
    "i.src=(n==='img.png'?'/file/':'/svg/" + variant + "/')+n;});" +
    "</scr" + "ipt></body>";
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "page" && parts[1]) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(pageHtml(parts[1])); return; }
  if (parts[0] === "svg" && parts.length === 3) {
    const csp = VARIANTS[parts[1]];
    const h = { "Content-Type": "image/svg+xml", "X-Content-Type-Options": "nosniff" };
    if (csp) h["Content-Security-Policy"] = csp;
    res.writeHead(200, h); res.end(SAMPLES[parts[2]] || "<svg/>"); return;
  }
  if (parts[0] === "file" && parts[1]) {
    const ext = path.extname(parts[1]).slice(1).toLowerCase();
    const body = ext === "png" ? Buffer.from(PNG1x1, "base64") : Buffer.from("x");
    res.writeHead(200, { "Content-Type": ext === "png" ? "image/png" : "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    res.end(body); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;

const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-chrome-"));
const chrome = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--no-first-run","--no-default-browser-check","--remote-debugging-port=" + CDP_PORT,"--user-data-dir=" + chromeDir,"about:blank"], { stdio: ["ignore","ignore","ignore"] });
let target = null;
for (let i = 0; i < 100 && !target; i++) {
  try { const list = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/list")).json(); target = list.find((t) => t.type === "page"); } catch { /* not up yet */ }
  if (!target) await wait(100);
}
if (!target) { try { chrome.kill("SIGTERM"); } catch {} throw new Error("Chrome CDP 未就绪"); }

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
let id = 0; const pending = new Map();
socket.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); socket.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; }
async function navigate(url) { await send("Page.navigate", { url }); const t0 = Date.now(); while (Date.now() - t0 < 15000) { try { if (await evaluate("document.readyState") === "complete") return; } catch {} await wait(80); } }
await send("Runtime.enable"); await send("Page.enable");

const imgMatrix = {};
const topLevelEvil = {};
for (const v of Object.keys(VARIANTS)) {
  await navigate(base + "/page/" + v);
  let result = null;
  for (let i = 0; i < 60 && result == null; i++) { result = await evaluate("document.body && document.body.getAttribute('data-result')"); if (result == null) await wait(100); }
  imgMatrix[v] = result || "NO-RESULT";
  await navigate(base + "/svg/" + v + "/evil.svg");
  await wait(200);
  topLevelEvil[v] = { executed: (await evaluate("document.documentElement && document.documentElement.getAttribute('data-evil')")) === "RUN" };
}

const headerProbe = {};
for (const v of Object.keys(VARIANTS)) { const resp = await fetch(base + "/svg/" + v + "/clean.svg"); headerProbe[v] = { csp: resp.headers.get("content-security-policy"), nosniff: resp.headers.get("x-content-type-options") }; }
socket.close(); server.close(); try { chrome.kill("SIGTERM"); } catch {} await wait(300); fs.rmSync(chromeDir, { recursive: true, force: true });
console.log(JSON.stringify({ imgMatrix, topLevelEvil, headerProbe }, null, 2));