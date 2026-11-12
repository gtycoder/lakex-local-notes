import type http from "node:http";

/**
 * Web 客户端（最小验证 MVP）· SSE 推送通道（`GET /__events`）。
 *
 * 浏览器端用 fetch 流订阅（EventSource 不能自定义凭据 ⇒ 走同源 cookie）；
 * 事件白名单由 shim 侧声明（sync-progress / pending-summary-changed / library-changed /
 * note-body-changed / ai:stream）。服务端只维护「已连接客户端集合」与帧格式，不解释事件名。
 */

export interface EventHub {
  /** 接管一个已通过鉴权的 SSE 响应：写头 + 首帧注释并保持连接（不 end）。 */
  attach(res: http.ServerResponse): void;
  /** 向所有已连接客户端推一条事件（无客户端时 no-op）。 */
  broadcast(event: string, data: unknown): void;
  /** 服务关闭：结束并清空所有连接。 */
  closeAll(): void;
}

export function createEventHub(): EventHub {
  const clients = new Set<http.ServerResponse>();
  return {
    attach(res: http.ServerResponse): void {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(": connected\n\n");
      clients.add(res);
      const drop = (): void => { clients.delete(res); };
      res.on("close", drop);
      res.on("error", drop);
    },
    broadcast(event: string, data: unknown): void {
      if (clients.size === 0) return;
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) {
        try { res.write(frame); } catch { clients.delete(res); }
      }
    },
    closeAll(): void {
      for (const res of clients) { try { res.end(); } catch { /* 忽略 */ } }
      clients.clear();
    },
  };
}
