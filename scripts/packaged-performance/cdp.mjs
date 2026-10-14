/** Small dependency-free CDP client used only by the opt-in packaged performance audit. */
export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    socket.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        m.error
          ? p.reject(new Error(JSON.stringify(m.error)))
          : p.resolve(m.result);
      }
    });
  }
  static async connect(port, predicate = () => true, timeout = 30000) {
    const until = performance.now() + timeout;
    while (performance.now() < until) {
      try {
        const targets = await (
          await fetch(`http://127.0.0.1:${port}/json/list`, {
            signal: AbortSignal.timeout(800),
          })
        ).json();
        const target = targets.find(predicate);
        if (target) {
          const ws = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((r, j) => {
            ws.addEventListener("open", r, { once: true });
            ws.addEventListener("error", j, { once: true });
          });
          return new Cdp(ws);
        }
      } catch {
        /* process not ready */
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`CDP ${port} not ready in ${timeout}ms`);
  }
  send(method, params = {}, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, timeout = 60000) {
    const r = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      timeout,
    );
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result?.value;
  }
  close() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("CDP closed"));
    }
    this.pending.clear();
    this.socket.close();
  }
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(cdp, expr, timeout = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    if (await cdp.evaluate(expr)) return performance.now() - start;
    await wait(25);
  }
  throw new Error(`waitFor timeout: ${expr}`);
}
export function stats(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  return {
    n: a.length,
    min: +a[0].toFixed(2),
    median: +a[Math.floor((a.length - 1) / 2)].toFixed(2),
    p95: +a[Math.ceil(a.length * 0.95) - 1].toFixed(2),
    max: +a.at(-1).toFixed(2),
  };
}
