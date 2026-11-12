/**
 * 极简 CDP 客户端（261112 两处加固，均为脚本层 problem）：
 *  ① 冷启动存在 boot 遮罩页（boot.html，无 lakeNative）⇒ 只认应用页，并等到桥就绪；
 *  ② 原来的 send 没有超时、ws 关闭也不拒绝 pending ⇒ 目标页一旦导航/重载，脚本**永久挂起**（无输出）。
 *     现在：ws close 拒绝所有 pending；每条请求有超时；连接后先等 window.lakeNative 就绪（可重连）。
 */
const isAppPage = (t) => t && t.type === "page" && !/boot\.html/.test(t.url || "");

async function pickAppPage(port, deadline) {
  let lastErr = null;
  for (;;) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const page = list.find(isAppPage) || null;
      if (page) return page;
    } catch (err) { lastErr = err; }
    if (Date.now() > deadline) throw new Error("no app page on " + port + (lastErr ? " (" + lastErr.message + ")" : ""));
    await new Promise((r) => setTimeout(r, 500));
  }
}

function openSession(page, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    const failAll = (why) => { for (const [, h] of pending) { clearTimeout(h.timer); h.reject(new Error(port + ": " + why)); } pending.clear(); };
    ws.onerror = (e) => reject(new Error(port + ": ws error " + (e && e.message || "")));
    ws.onclose = () => failAll("cdp ws closed");
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const h = m.id && pending.get(m.id);
      if (!h) return;
      clearTimeout(h.timer); pending.delete(m.id);
      if (m.error) h.reject(new Error(port + ": " + (m.error.message || JSON.stringify(m.error))));
      else h.resolve(m);
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const rid = ++id;
      const timer = setTimeout(() => { pending.delete(rid); rej(new Error(port + ": CDP timeout " + timeoutMs + "ms on " + method)); }, timeoutMs);
      pending.set(rid, { resolve: res, reject: rej, timer });
      ws.send(JSON.stringify({ id: rid, method, params }));
    });
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) { const ex = r.result.exceptionDetails.exception; throw new Error(port + ": " + ((ex && (ex.description || ex.value)) || r.result.exceptionDetails.text)); }
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    ws.onopen = () => resolve({ port, ev, ws, send, close: () => ws.close() });
  });
}

export async function connect(port, opts = {}) {
  const timeoutMs = opts.requestTimeoutMs ?? 180_000;
  const deadline = Date.now() + (opts.waitMs ?? 90_000);
  for (;;) {
    const page = await pickAppPage(port, deadline);
    let session;
    try { session = await openSession(page, port, timeoutMs); }
    catch (err) { if (Date.now() > deadline) throw err; await new Promise((r) => setTimeout(r, 1000)); continue; }
    // 桥就绪（app 页可能仍在首帧加载；此时 eval 会失败或值不全）
    try {
      for (let i = 0; i < 90; i++) {
        const ok = await session.ev("!!(window.lakeNative && window.lakeNative.syncNow)");
        if (ok === true) return session;
        await new Promise((r) => setTimeout(r, 1000));
        if (Date.now() > deadline) break;
      }
      throw new Error("bridge not ready on " + port);
    } catch (err) {
      try { session.close(); } catch { /* ignore */ }
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
