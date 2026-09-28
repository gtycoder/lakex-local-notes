#!/usr/bin/env node
/**
 * Lake 正文「打开对拍」检查（260917）——判定一篇文档**一打开会不会被内核改写**。
 *
 * 为什么需要它：内核打开文档时可能重写正文（例如把裸 `<img>` 当远程图片去抓、被本机/私网护栏拒后
 * 回写失败态卡片 → 正文变化被当成用户编辑 → 自动保存 → syncState 变待同步 → 上传）。
 * 单测跑不了内核（vitest 是 node 环境），所以用真实 Electron + CDP 做可重复对拍。
 *
 * 用法（应用需在跑：npm run dev，CDP 默认 9222）：
 *   node scripts/lake-roundtrip-check.mjs                       # 用当前活动文档
 *   node scripts/lake-roundtrip-check.mjs --note <noteId>
 *   node scripts/lake-roundtrip-check.mjs --title "压测3-图片-可莉.png"
 *   node scripts/lake-roundtrip-check.mjs --note <id> --keep    # 保留临时文档（默认用完丢回收站）
 *
 * 判定：把原文通过**应用写入路径**另建一条临时文档（直接写相同正文，不复制资源；图片继续引用原件资源），
 * 打开临时文档、等保存稳定，比较「创建前正文」与「打开后的正文」：
 *   PASS = 逐字节一致（内核没有重写）→ 这篇安全；
 *   FAIL = 被改写（打印首个差异位置与上下文）→ 该文档形态不合格，见 docs/LAKE-CONTENT-WRITING.md。
 *
 * **原件全程不打开**，所以对不合格文档也安全（破坏发生在临时文档上，最后进回收站）。
 * Node 24 必须（用内置 WebSocket / fetch）。
 */
import { argv, exit } from "node:process";

const args = argv.slice(2);
function argOf(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = Number(argOf("--port", "9222"));
const NOTE = argOf("--note");
const TITLE = argOf("--title");
const KEEP = args.includes("--keep");
// 等待窗口：改写发生在**图片水合时**，延迟不定（实测 473ms / 3.3s / 7.8s 都出现过），
// 所以"正文含裸 <img>"这类高风险形态要等满整个窗口，不能只看"连续两次读一致"就收工。
const SETTLE_MIN_MS = Number(argOf("--wait", "5000"));    // 低风险形态：至少等这么久
const SETTLE_MAX_MS = Math.max(SETTLE_MIN_MS, 20000);      // 高风险形态：等满这个上限

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  let list;
  try {
    list = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json();
  } catch (e) {
    throw new Error("连不上 CDP(:" + PORT + ")：应用没在跑？先 npm run dev（见 docs/CODEX-GUIDE.md）");
  }
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有 page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error("页面求值失败: " + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
    }
    return r.result ? r.result.result.value : undefined;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront");
  // 注入小工具（避免在表达式里嵌套引号）
  await evalJs([
    "(() => {",
    "  window.__rtHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };",
    "  window.__rtTab = (id) => [...document.querySelectorAll('.tab-item')].find(t => t.getAttribute('data-note-id') === id);",
    "  window.__rtRow = (id) => [...document.querySelectorAll('.tree-row')].find(r => r.getAttribute('data-tree-node-id') === id);",
    "  window.__rtRead = async (id) => { const d = await window.lakeNative.readNote(id); return (d && d.content) || ''; };",
    "  return true;",
    "})()",
  ].join("\n"));
  return { evalJs, close: () => ws.close() };
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

const MARKERS = {
  rawImg: (c) => (c.match(/<img/g) || []).length,
  errCard: (c) => (c.match(/status%22%3A%22error%22/g) || []).length,
};

async function main() {
  const { evalJs, close } = await connect();
  try {
    // 1) 解析目标文档
    let target = NOTE;
    if (!target && TITLE) {
      target = await evalJs("(async () => { const n = (await window.lakeNative.listTreeNodes()).find(x => x.title === " + JSON.stringify(TITLE) + "); return n ? n.id : null; })()");
      if (!target) throw new Error("按标题找不到文档：" + TITLE);
    }
    if (!target) {
      target = await evalJs("(() => { const t = document.querySelector('.tab-item.active'); return t ? t.getAttribute('data-note-id') : null; })()");
      if (!target) throw new Error("当前没有活动文档；请用 --note 或 --title 指定");
    }
    const meta = await evalJs("(async () => { const n = (await window.lakeNative.listTreeNodes()).find(x => x.id === " + JSON.stringify(target) + "); return n ? { title: n.title, syncState: n.syncState } : null; })()");
    if (!meta) throw new Error("找不到文档：" + target);
    const original = await evalJs("(async () => { const c = await window.__rtRead(" + JSON.stringify(target) + "); return { content: c, len: c.length, hash: window.__rtHash(c) }; })()");
    console.log("目标原件 : " + meta.title + "  [" + target + "]  syncState=" + meta.syncState);
    console.log("原件正文 : " + original.len + "B  hash=" + original.hash + "  裸<img>=" + MARKERS.rawImg(original.content) + "  失败卡片=" + MARKERS.errCard(original.content));
    console.log("（原件全程不打开；下面操作的是临时文档）");

    // 2) 用应用写入路径另建临时文档（不复制资源，引用仍指原件），再通过目录行打开它。
    const tempTitle = meta.title + " [roundtrip " + Date.now() + "]";
    const created = await evalJs("(async () => { const n = await window.lakeNative.createNoteIn(null, " + JSON.stringify(tempTitle) + "); await window.lakeNative.saveNote(n.id, " + JSON.stringify(tempTitle) + ", " + JSON.stringify(original.content) + "); return { id: n.id }; })()");
    if (!created || !created.id) throw new Error("创建临时对拍文档失败");
    const tempId = created.id;
    const expected = original.content;
    console.log("临时文档 : " + tempId + "  期望正文 " + expected.length + "B（资源仍指向原件）");

    // 等目录刷新后点开临时文档（避免依赖当前活动 tab 的恢复状态）。
    let opened = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      opened = await evalJs("(() => { const r = window.__rtRow(" + JSON.stringify(tempId) + "); if (!r) return false; r.click(); return true; })()");
      if (opened) break;
    }
    if (!opened) throw new Error("临时文档没有出现在目录中");
    let activeCopy = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      activeCopy = await evalJs("(() => { const t = document.querySelector('.tab-item.active'); return !!t && t.getAttribute('data-note-id') === " + JSON.stringify(tempId) + "; })()");
      if (activeCopy) break;
    }
    if (!activeCopy) throw new Error("临时文档没有打开（没等到新的活动标签）");

    // 3) 等稳定：连续 3 次读一致；含裸 <img> 的高风险形态等满 SETTLE_MAX_MS（取水合改写的最坏情况）
    const t0 = Date.now();
    let last = null, stable = 0, actual = "", hinted = false;
    while (Date.now() - t0 < SETTLE_MAX_MS) {
      await sleep(300);
      actual = await evalJs("window.__rtRead(" + JSON.stringify(tempId) + ")");
      if (actual === last) stable++; else stable = 0;
      last = actual;
      const elapsed = Date.now() - t0;
      const risky = MARKERS.rawImg(actual) > 0;
      const need = risky ? SETTLE_MAX_MS : SETTLE_MIN_MS;
      if (!hinted && risky && elapsed > SETTLE_MIN_MS) {
        hinted = true;
        console.log("  …正文含裸 <img>：改写会在图片水合后发生（实测最晚 ~7.8s），等满 " + SETTLE_MAX_MS + "ms");
      }
      if (stable >= 3 && elapsed >= need) break;
    }
    console.log("  观察了 " + (Date.now() - t0) + "ms");
    const dirty = await evalJs("(() => { const t = window.__rtTab(" + JSON.stringify(tempId) + "); return !!(t && t.querySelector('.tab-dirty-dot')); })()");
    const tempState = await evalJs("(async () => { const n = (await window.lakeNative.listTreeNodes()).find(x => x.id === " + JSON.stringify(tempId) + "); return n ? n.syncState : null; })()");
    const d = firstDiff(expected, actual);
    const pass = d === -1;
    console.log("");
    console.log("结果     : " + (pass ? "PASS —— 打开后正文逐字节一致（内核没有重写）" : "FAIL —— 打开被改写"));
    console.log("  期望 " + expected.length + "B hash=" + (await evalJs("window.__rtHash(" + JSON.stringify(expected) + ")")) + "  实际 " + actual.length + "B hash=" + (await evalJs("window.__rtHash(" + JSON.stringify(actual) + ")")));
    console.log("  裸<img> " + MARKERS.rawImg(actual) + "  失败卡片 " + MARKERS.errCard(actual) + "  脏点=" + dirty + "  syncState=" + tempState);
    if (!pass) {
      const from = Math.max(0, d - 100);
      console.log("  首个差异 @ " + d);
      console.log("   期望 …" + expected.slice(from, d + 140));
      console.log("   实际 …" + actual.slice(from, d + 140));
      console.log("  处置：按 docs/LAKE-CONTENT-WRITING.md 改正该文档的写入者；旧测试数据建议删掉重播（AGENTS §3 原则 7）。");
    }

    // 4) 清理：关临时文档标签 + 丢进回收站（--keep 则保留）
    if (!KEEP) {
      await evalJs("(() => { const t = window.__rtTab(" + JSON.stringify(tempId) + "); const c = t && t.querySelector('.tab-close'); if (c) c.click(); return true; })()");
      await sleep(400);
      const trashed = await evalJs("(async () => { try { await window.lakeNative.deleteTreeNode(" + JSON.stringify(tempId) + "); return true; } catch (e) { return false; } })()");
      console.log("清理     : 临时文档已" + (trashed ? "丢进回收站" : "清理失败，请手动删 " + tempId));
    } else {
      console.log("清理     : --keep，临时文档保留（" + tempId + "）");
    }
    close();
    exit(pass ? 0 : 1);
  } catch (e) {
    close();
    console.error("检查失败：" + (e && e.message ? e.message : e));
    exit(2);
  }
}

main();
