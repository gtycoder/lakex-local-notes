#!/usr/bin/env node
/**
 * 选区高亮 端到端回归（261004）：AI 助手原选区自绘 + 块手柄高亮。
 *
 * 覆盖：
 *   AI 选区 ① 打开前无自绘/原生未被隐藏；② 点 AI 后有自绘且原生隐藏；
 *           ③ 打开不滚动编辑区；④ 自绘随正文同步滚；⑤ 另选别的文字让回原生；⑥ 关闭后清理干净。
 *   块手柄 ⑦ hover 正文出句柄；⑧ 触达句柄块高亮 1 个；⑨ **别处按下（鼠标不移动）高亮必须清除**；
 *           ⑩ 再次触达恢复；⑪ 移到另一行不叠加、句柄跟随；⑫ 移出编辑区清空；⑬ 跨块拖选后句柄仍可用。
 *
 * 用法（应用需在跑，CDP 默认 9222）：
 *   node scripts/e2e-selection-highlight.mjs
 *   node scripts/e2e-selection-highlight.mjs --port 9223
 *   node scripts/e2e-selection-highlight.mjs --keep     # 保留临时测试文档
 * 退出码 0=PASS，1=FAIL，2=出错。
 */
import { argv, exit } from "node:process";

const args = argv.slice(2);
const argOf = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(argOf("--port", "9222"));
const KEEP = args.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有 page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error("页面求值失败: " + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
    return r.result ? r.result.result.value : undefined;
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  return { evalJs, send, close: () => ws.close() };
}

const AI = "(function(){ var M=document.querySelector('[data-active=true] .lake-editor-mount'); var ov=M?M.querySelector('.selection-toolbar__aisel'):null; return JSON.stringify({spans: ov?ov.querySelectorAll('span').length:0, hidden: M?M.classList.contains('lake-ai-sel-hidden'):null}); })()";
const BRICK = "document.querySelectorAll('.ne-brick-highlight').length";
const HANDLE = "(function(){ var hs=Array.prototype.filter.call(document.querySelectorAll('.ne-block-hover-handle'), function(x){ var q=x.getBoundingClientRect(); return q.width>0 && getComputedStyle(x).opacity!=='0'; }); if(!hs.length) return 'null'; var q=hs[0].getBoundingClientRect(); return JSON.stringify({x:Math.round(q.left+q.width/2), y:Math.round(q.top+q.height/2), t:Math.round(q.top)}); })()";

async function main() {
  const { evalJs, send, close } = await connect();
  const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y }, extra || {}));
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log((ok ? "PASS" : "FAIL") + " | " + name + " | " + detail); };
  let noteId = null;
  let quoteId = null;
  try {
    const paragraphs = Array.from({ length: 24 }, (_, i) => "<p>选区回归 " + (i + 1) + "：综合场景。</p>").join("");
    noteId = await evalJs("(async function(){ var n = await window.lakeNative.createNote('SEL-REG-" + Date.now() + "'); await window.lakeNative.saveNote(n.id, n.title, " + JSON.stringify(paragraphs) + "); return n.id; })()");
    await sleep(600);
    await evalJs("(function(){ var r=Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(noteId) + "; }); if(r) r.click(); return true; })()");
    await sleep(700);
    await evalJs("(function(){ var t=document.querySelector('.tab-item[data-note-id=\"" + noteId + "\"]'); if(t) t.click(); return true; })()");
    await sleep(1800);

    const geo = JSON.parse(await evalJs("(function(){ var M=document.querySelector('[data-active=true] .lake-editor-mount'); var ps=Array.prototype.slice.call(M.querySelectorAll('ne-p')); window.__m=M; window.__p=ps; var r=document.createRange(); r.setStartBefore(ps[2].firstChild); r.setEndAfter(ps[4].firstChild); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); var w=M.querySelector('.ne-editor-wrap'); return JSON.stringify({scrollTop:Math.round(w.scrollTop)}); })()"));
    await sleep(600);
    await evalJs("(function(){ var b=document.querySelector('.selection-toolbar button[aria-label=\"AI 助手\"]'); if(b) b.click(); return true; })()");
    await sleep(700);

    check("AI-1 打开后有自绘且原生已隐藏", JSON.parse(await evalJs(AI)).spans > 0 && JSON.parse(await evalJs(AI)).hidden === true, await evalJs(AI));
    const s0 = JSON.parse(await evalJs("(function(){ var w=window.__m.querySelector('.ne-editor-wrap'); var st=window.__m.querySelector('.selection-toolbar__aisel span'); return JSON.stringify({scrollTop:Math.round(w.scrollTop), top:st?Math.round(st.getBoundingClientRect().top):null}); })()"));
    check("AI-2 打开不滚动编辑区", Math.abs(s0.scrollTop - geo.scrollTop) <= 1, "scrollTop " + geo.scrollTop + " -> " + s0.scrollTop);
    await evalJs("(function(){ window.__m.querySelector('.ne-editor-wrap').scrollTop += 200; return true; })()");
    await sleep(300);
    const s1 = JSON.parse(await evalJs("(function(){ var w=window.__m.querySelector('.ne-editor-wrap'); var st=window.__m.querySelector('.selection-toolbar__aisel span'); return JSON.stringify({scrollTop:Math.round(w.scrollTop), top:st?Math.round(st.getBoundingClientRect().top):null}); })()"));
    check("AI-3 自绘随正文同步滚", s0.top !== null && s1.top !== null && Math.abs((s0.top - s1.top) - (s1.scrollTop - s0.scrollTop)) <= 2, "dTop=" + (s0.top - s1.top) + " dScroll=" + (s1.scrollTop - s0.scrollTop));
    await evalJs("(function(){ window.__m.querySelector('.ne-editor-wrap').scrollTop -= 200; return true; })()");
    await sleep(200);
    await evalJs("(function(){ var ps=window.__p; var r=document.createRange(); r.setStartBefore(ps[9].firstChild); r.setEndAfter(ps[10].firstChild); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); return true; })()");
    await sleep(300);
    check("AI-4 另选别的文字 → 自绘收起让回原生", JSON.parse(await evalJs(AI)).spans === 0, await evalJs(AI));
    await evalJs("(function(){ var b=document.querySelector('.selection-toolbar button[aria-label=\"AI 助手\"]'); if(b) b.click(); return true; })()");
    await sleep(500);
    const closed = JSON.parse(await evalJs(AI));
    check("AI-5 关闭后清理干净", closed.spans === 0 && closed.hidden === false, JSON.stringify(closed));

    // 清掉上个场景的 DOM 选区（否则块手柄会聚合跨块选区）
    await evalJs("(function(){ window.getSelection().removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); return true; })()");
    await sleep(250);
    const B = JSON.parse(await evalJs("(function(){ var ps=window.__p; var a=ps[2].getBoundingClientRect(), b=ps[8].getBoundingClientRect(); return JSON.stringify({ax:Math.round(a.left+60), ay:Math.round(a.top+8), by:Math.round(b.top+8), bx:Math.round(b.left+60)}); })()"));
    await mouse("mouseMoved", B.ax, B.ay); await sleep(450);
    const h1 = await evalJs(HANDLE);
    check("BH-1 hover 正文 → 句柄出现", h1 !== "null", h1);
    if (h1 !== "null") { const H = JSON.parse(h1); await mouse("mouseMoved", H.x, H.y); await sleep(450); }
    check("BH-2 触达句柄 → 块高亮 1 个", (await evalJs(BRICK)) === 1, "brick=" + (await evalJs(BRICK)));
    await mouse("mousePressed", B.bx, B.by, { button: "left", clickCount: 1 }); await sleep(250);
    const b3 = await evalJs(BRICK);
    check("BH-3 别处按下（不移动）→ 高亮清除", b3 === 0, "brick=" + b3);
    await mouse("mouseReleased", B.bx, B.by, { button: "left", clickCount: 1 }); await sleep(400);
    await mouse("mouseMoved", B.ax, B.ay); await sleep(450);
    const h2 = await evalJs(HANDLE);
    if (h2 !== "null") { const H2 = JSON.parse(h2); await mouse("mouseMoved", H2.x, H2.y); await sleep(450); }
    check("BH-4 再次触达句柄 → 高亮恢复", (await evalJs(BRICK)) === 1, "brick=" + (await evalJs(BRICK)));
    await mouse("mouseMoved", B.bx, B.by); await sleep(500);
    check("BH-5 移到另一行 → 不叠加、句柄跟随", (await evalJs(BRICK)) <= 1 && (await evalJs(HANDLE)) !== "null", "brick=" + (await evalJs(BRICK)));
    await mouse("mouseMoved", 400, 40); await sleep(600);
    check("BH-6 移出编辑区 → 高亮 0、句柄隐藏", (await evalJs(BRICK)) === 0 && (await evalJs(HANDLE)) === "null", "brick=" + (await evalJs(BRICK)));
    await mouse("mousePressed", B.ax, B.ay, { button: "left", clickCount: 1 });
    for (let i = 1; i <= 6; i++) await mouse("mouseMoved", B.ax, B.ay + Math.round((B.by - B.ay) * i / 6), { button: "left" });
    await mouse("mouseReleased", B.ax, B.by, { button: "left", clickCount: 1 }); await sleep(500);
    await mouse("mouseMoved", B.ax + 4, B.ay + 2); await sleep(600);
    check("BH-7 跨块拖选后句柄仍可用", (await evalJs(HANDLE)) !== "null", "handle=" + (await evalJs(HANDLE)));

    // BH-8（261005）：引用内**非首块标题**的手柄 —— 从标题正文向左走向句柄时不能跳回首行合并柄。
    quoteId = await evalJs("(async function(){ var n = await window.lakeNative.createNote('SEL-QT-" + Date.now() + "'); await window.lakeNative.saveNote(n.id, n.title, " + JSON.stringify("<blockquote><h2>标题一</h2><p>段落</p><h3>标题二</h3><p>段落二</p></blockquote>") + "); return n.id; })()");
    await sleep(600);
    await evalJs("(function(){ var r=Array.prototype.find.call(document.querySelectorAll('[data-tree-node-id]'), function(x){ return x.getAttribute('data-tree-node-id')===" + JSON.stringify(quoteId) + "; }); if(r) r.click(); return true; })()");
    await sleep(700);
    await evalJs("(function(){ var t=document.querySelector('.tab-item[data-note-id=" + JSON.stringify(quoteId) + "]'); if(t) t.click(); return true; })()");
    await sleep(1800);
    const H3 = JSON.parse(await evalJs("(function(){ var M=document.querySelector('[data-active=true] .lake-editor-mount'); var h=M.querySelector('ne-quote ne-h3'); var r=h.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+60), y:Math.round(r.top+r.height/2), top:Math.round(r.top)}); })()"));
    await mouse("mouseMoved", 400, 40); await sleep(350);
    await evalJs("(function(){ window.getSelection().removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); return true; })()");
    await sleep(200);
    await mouse("mouseMoved", H3.x, H3.y); await sleep(500);
    // 决定性信号：鼠标移到**该标题自己的句柄**上，被高亮的必须是这个标题（而不是 ne-quote 首行）。
    // 261005 的 bug：标题手柄比正文更靠左，鼠标过去时先经过引用背景、被解析成 ne-quote ⇒ 跳回首行。
    let brick = "[]", why = "no visible handle";
    for (let i = 0; i < 12; i += 1) {
      const hp = await evalJs(HANDLE);
      if (hp !== "null") {
        const H = JSON.parse(hp);
        await mouse("mouseMoved", H.x, H.y); await sleep(250);
        brick = await evalJs("(function(){ var b=Array.prototype.map.call(document.querySelectorAll('.ne-brick-highlight'), function(x){ return x.tagName; }); return JSON.stringify(b); })()");
        why = "handle=" + hp + " brick=" + brick;
        if (brick.indexOf("NE-H3") >= 0) break;
      }
      await mouse("mouseMoved", H3.x, H3.y); await sleep(200);
    }
    check("BH-8 引用内标题的手柄：拿到的是该标题（不是引用首行合并柄）", brick.indexOf("NE-H3") >= 0, why);
  } finally {
    if (!KEEP) {
      for (const id of [noteId, quoteId]) {
        if (id) await evalJs("(function(){ return window.lakeNative.deleteNote ? window.lakeNative.deleteNote(" + JSON.stringify(id) + ") : true; })()").catch(() => {});
      }
    }
    close();
  }
  console.log("SUMMARY pass=" + pass + " fail=" + fail);
  exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", (e && e.message) || e); exit(2); });
