export async function connect(port) {
  const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page on " + port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const rid = ++id; pending.set(rid, res); ws.send(JSON.stringify({ id: rid, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) { const ex = r.result.exceptionDetails.exception; throw new Error(port + ": " + ((ex && (ex.description || ex.value)) || r.result.exceptionDetails.text)); }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { port, ev, ws };
}
