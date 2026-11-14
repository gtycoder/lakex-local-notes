/**
 * 规模验收专用极简 CDP 客户端（零依赖，仅脚本使用）。
 *
 * 与 scripts/packaged-performance/cdp.mjs 的差异（都是脚本层加固，不动产品）：
 *  ① ws 关闭/错误时拒绝所有 pending，避免目标页重载后脚本永久挂起；
 *  ② 每条请求都有超时（默认 120s，大库批量 IPC 需要更长的可单独传）；
 *  ③ Runtime.evaluate 的 exceptionDetails 在 m.result 内（CDP 规范），这里正确解包并抛出可读错误；
 *  ④ connect 只挑「应用页」（排除 boot.html 冷启动遮罩），并可选等 window.lakeNative 就绪。
 */

const APP_PAGE_PREDICATE = (target) =>
  target && target.type === "page" && !/boot\.html/.test(String(target.url || ""));

export class Cdp {
  constructor(socket, port) {
    this.socket = socket;
    this.port = port;
    this.seq = 0;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const handler = message.id && this.pending.get(message.id);
      if (!handler) return;
      this.pending.delete(message.id);
      clearTimeout(handler.timer);
      if (message.error) handler.reject(new Error(`CDP:${port} ${handler.method} ${message.error.message || JSON.stringify(message.error)}`));
      else handler.resolve(message.result);
    });
    const failAll = (why) => {
      this.closed = true;
      for (const handler of this.pending.values()) {
        clearTimeout(handler.timer);
        handler.reject(new Error(`CDP:${port} 连接中断（${why}）`));
      }
      this.pending.clear();
    };
    socket.addEventListener("close", () => failAll("ws closed"));
    socket.addEventListener("error", () => failAll("ws error"));
  }

  /** 连接一个应用页；predicate 可覆盖（默认排除 boot.html）。 */
  static async connect(port, predicate = APP_PAGE_PREDICATE, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
        const targets = await response.json();
        const target = targets.find(predicate);
        if (target) {
          const socket = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, { once: true });
            socket.addEventListener("error", () => reject(new Error(`CDP:${port} ws 打不开`)), { once: true });
          });
          return new Cdp(socket, port);
        }
      } catch (error) {
        lastError = error;
      }
      await wait(100);
    }
    throw new Error(`CDP:${port} 在 ${timeoutMs}ms 内没有可用的应用页${lastError ? "（" + lastError.message + "）" : ""}`);
  }

  send(method, params = {}, timeoutMs = 120_000) {
    if (this.closed) return Promise.reject(new Error(`CDP:${this.port} 已关闭`));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP:${this.port} ${method} 超时 ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 求值并返回 by-value 结果；页面内异常转成可读 Error。 */
  async evaluate(expression, timeoutMs = 120_000) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result && result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(details.exception?.description || details.text || "页面内求值失败");
    }
    return result ? result.result?.value : undefined;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const handler of this.pending.values()) {
      clearTimeout(handler.timer);
      handler.reject(new Error(`CDP:${this.port} 已主动关闭`));
    }
    this.pending.clear();
    try { this.socket.close(); } catch { /* 忽略 */ }
  }
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询页面表达式直到真值；返回耗时 ms；超时抛错（带表达式）。 */
export async function waitFor(cdp, expression, timeoutMs = 60_000, intervalMs = 50) {
  const startedAt = performance.now();
  let lastError = null;
  while (performance.now() - startedAt < timeoutMs) {
    try {
      if (await cdp.evaluate(expression, Math.max(2_000, timeoutMs))) return Math.round(performance.now() - startedAt);
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  throw new Error(`等待超时：${expression}${lastError ? "（最后一次错误：" + lastError.message + "）" : ""}`);
}

/** 数值统计（ms 序列）；空数组返回 null。 */
export function stats(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    n: sorted.length,
    min: +sorted[0].toFixed(1),
    median: +sorted[Math.floor((sorted.length - 1) / 2)].toFixed(1),
    p95: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(1),
    max: +sorted.at(-1).toFixed(1),
  };
}
