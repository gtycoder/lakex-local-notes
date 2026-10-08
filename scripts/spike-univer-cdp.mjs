#!/usr/bin/env node
/**
 * Univer spike CDP 驱动（分支 spike/univer-sheet）——Node 内置 WebSocket 直驱 headless Chrome。
 * 用法: node scripts/spike-univer-cdp.mjs [url] [port] [shotDir]
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pageUrl = process.argv[2] || "http://127.0.0.1:1422/spike-univer.html";
const port = Number(process.argv[3] || 9334);
const shotDir = process.argv[4] || "";
const profile = mkdtempSync(join(tmpdir(), "lake-univer-spike-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL = "for (let i=0;i<30;i++){ const v=String(window.__spike.value('spike-1','C1')); if (v!=='null') return v; await new Promise(r=>setTimeout(r,150)); } return 'null(timeout)';";

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  "--disable-dev-shm-usage", "--window-size=1280,800",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

async function fetchJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url); if (res.ok) return await res.json(); } catch {}
    await sleep(250);
  }
  throw new Error("CDP not reachable: " + url);
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) { for (const h of (this.handlers.get(msg.method) || [])) h(msg.params); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("CDP timeout: " + method)); } }, 30000);
    });
  }
  on(method, h) { const a = this.handlers.get(method) || []; a.push(h); this.handlers.set(method, a); }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
    return r.result?.value;
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(r.data, "base64");
    if (shotDir) writeFileSync(join(shotDir, name), buf);
    return { hash: createHash("sha256").update(buf).digest("hex").slice(0, 16), bytes: buf.length };
  }
}

async function main() {
  const out = { ok: false, pageUrl, results: {}, violations: [], errors: [], httpErrors: [] };
  let ws;
  try {
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = list.find((t) => t.type === "page");
    if (!page) throw new Error("no page target");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");
    cdp.on("Log.entryAdded", (p) => { if (p.entry && p.entry.level === "error") out.errors.push(`[${p.entry.source}] ${p.entry.text}`); });
    cdp.on("Network.responseReceived", (p) => { if (p.response && p.response.status >= 400) out.httpErrors.push(`${p.response.status} ${p.response.url}`); });

    await cdp.send("Page.navigate", { url: pageUrl });
    let ready = false;
    for (let i = 0; i < 160; i++) {
      await sleep(250);
      try { if ((await cdp.eval("window.__spikeReady === true")) === true) { ready = true; break; } } catch {}
      try { if ((await cdp.eval("window.__spikeReady === false")) === true) break; } catch {}
    }
    out.results.ready = ready;
    out.results.cspHasUnsafeEval = await cdp.eval("(document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content||'').includes('unsafe-eval')");
    const step = async (name, expr) => {
      try { out.results[name] = await cdp.eval(expr); }
      catch (e) { out.results[name] = { error: String(e).slice(0, 240) }; }
    };
    if (ready) {
      await sleep(1000);
      out.results.snapshotShape = await cdp.eval("(() => { const s = window.__spike.save('spike-1'); return { id: s.id, sheetIds: Object.keys(s.sheets||{}), c1: s.sheets?.s1?.cellData?.[0]?.[2] }; })()");
      await step("formulaInitial", `(async () => { ${POLL} })()`);
      await step("recalcAfterDeleteRow", `(async () => { const before=String(window.__spike.value('spike-1','C1')); window.__spike.deleteRow('spike-1',1); ${POLL} })()`.replace("return v;", "return { before, after: v, waitedMs: i*150 };"));
      // 上面 replace 让 before 一并返回；若超时返回字符串
      await step("editRecalc", "(async () => { window.__spike.write('spike-1','A1',100); for (let i=0;i<30;i++){ const v=String(window.__spike.value('spike-1','C1')); if (v==='100') return { value: v, waitedMs: i*150 }; await new Promise(r=>setTimeout(r,150)); } return { value: String(window.__spike.value('spike-1','C1')), timedOut: true }; })()");
      const light = await cdp.shot("spike-light.png");
      await cdp.eval("window.__spike.setTheme('dark')");
      await sleep(700);
      const dark = await cdp.shot("spike-dark.png");
      await cdp.eval("window.__spike.setTheme('light')");
      out.results.themeScreenshots = { light, dark, changed: light.hash !== dark.hash };
      await step("snapshotRoundtrip", "(() => { const s = window.__spike.save('spike-1'); const id = window.__spike.loadSnapshot(s); return { loadedId: id, total: window.__spike.listBooks().length }; })()");
      await step("multiBookIsolation", "(() => { const id2 = window.__spike.createBook('spike-2','Spike2'); window.__spike.write(id2,'A1',777); return { book1A1: String(window.__spike.value('spike-1','A1')), book2A1: String(window.__spike.value(id2,'A1')), books: window.__spike.listBooks() }; })()");
      out.violations = await cdp.eval("window.__spike.violations");
      out.results.spikeErrors = await cdp.eval("window.__spike.errors");
    }
    out.ok = ready === true && Array.isArray(out.violations) && out.violations.length === 0;
  } catch (e) {
    out.error = String((e && e.stack) || e);
  } finally {
    try { if (ws) ws.close(); } catch {}
    chrome.kill("SIGKILL");
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
main();
