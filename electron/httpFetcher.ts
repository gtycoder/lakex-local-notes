/**
 * 桌面默认 HttpFetcher：node:http/https + 连接层钉死已校验 DNS 地址（V5 Phase 2）。
 *
 * SSRF 防护（保留 ssrf.ts 全部逻辑）：字面 IP 直接拦截；域名解析 A/AAAA 后逐地址校验，
 * 任一命中本机/私网/链路本地/保留/组播即拒绝；解析失败同样拒绝。
 *
 * TOCTOU 修复（连接层 lookup 固定地址）：Chromium 网络栈（electron net）无法在连接层钉死
 * 已校验地址（见 ssrf.ts 注释）；本实现用 node:http/https 的 `lookup` 选项把连接固定到
 * 校验过的地址，并保持 TLS SNI（servername）与 Host 头为原域名 —— DNS rebinding 无法再把
 * 连接引向私网。代价：不走系统代理（个人笔记图片下载场景可接受；如需代理可换 electron net 实现）。
 *
 * 测试注入点：deps.lookup（DNS 解析）与 deps.request（传输）均可替换，用于单测证明
 * 「解析一次 + 校验 + 连接钉死」的完整链路。
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import type { HttpFetcher, HttpFetchOptions, HttpResponse } from "../src/core/httpFetcher.js";
import { isBlockedIPv4, isBlockedIPv6, SsrfError } from "./ssrf.js";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** 传输层响应（node IncomingMessage 满足此形状）。 */
type TransportResponse = {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
} & AsyncIterable<Uint8Array>;

interface TransportRequest {
  on(event: "response", listener: (response: TransportResponse) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  end(): void;
  destroy(error?: Error): void;
}

export interface HttpFetcherDeps {
  /** DNS 解析（all records）注入；默认 dns.promises.lookup(hostname, { all: true, verbatim: true }) */
  lookup?: (hostname: string) => Promise<dns.LookupAddress[]>;
  /** 传输请求注入；默认按协议选 http/https.request。测试可用伪造响应/重定向证明钉死链路。 */
  request?: (options: http.RequestOptions, protocol: "http:" | "https:") => TransportRequest;
}

/** 解析并逐地址校验域名（任一私网/本机即拒绝），返回待钉死的首选地址。 */
export function createPinnedHttpFetcher(deps: HttpFetcherDeps = {}): HttpFetcher {
  const lookupAll = deps.lookup ?? ((hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
  const doRequest = deps.request ?? ((options: http.RequestOptions, protocol: "http:" | "https:") => {
    const transport = protocol === "https:" ? https : http;
    return transport.request(options) as unknown as TransportRequest;
  });

  /** 解析目标 host：字面 IP 直接校验；域名解析一次并校验全部地址（解析失败拒绝）。 */
  async function resolvePinned(hostname: string): Promise<dns.LookupAddress> {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) {
      throw new SsrfError("不允许下载本机或私网地址");
    }
    const ipVersion = net.isIP(host);
    if (ipVersion !== 0) {
      const blocked = ipVersion === 4 ? isBlockedIPv4(host) : isBlockedIPv6(host);
      if (blocked) throw new SsrfError("不允许下载本机或私网地址");
      return { address: host, family: ipVersion };
    }
    let records: dns.LookupAddress[];
    try {
      records = await lookupAll(host);
    } catch {
      throw new SsrfError(`域名解析失败，拒绝下载: ${host}`);
    }
    if (records.length === 0) throw new SsrfError(`域名解析为空，拒绝下载: ${host}`);
    for (const record of records) {
      const blocked = record.family === 4 ? isBlockedIPv4(record.address) : isBlockedIPv6(record.address);
      if (blocked) throw new SsrfError(`域名解析到本机或私网地址，拒绝下载: ${host} -> ${record.address}`);
    }
    return records[0];
  }

  return {
    async fetch(url: string, options: HttpFetchOptions): Promise<HttpResponse> {
      let current = url;
      for (let hop = 0; ; hop += 1) {
        const parsed = new URL(current);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new SsrfError("重定向目标仅支持 HTTP 或 HTTPS");
        }
        const pinned = await resolvePinned(parsed.hostname);
        const isHttps = parsed.protocol === "https:";
        const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

        const requestOptions: https.RequestOptions = {
          hostname: pinned.address,
          port,
          path: parsed.pathname === "" ? "/" : parsed.pathname + parsed.search,
          method: "GET",
          // 连接层钉死已校验地址：TOCTOU 修复（DNS rebinding 无法再把连接引向私网）
          lookup: (_hostname: string, _opts: unknown, callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => {
            callback(null, pinned.address, pinned.family);
          },
          // TLS SNI 保持原域名（即使连接目标是校验后的 IP）
          servername: isHttps ? parsed.hostname : undefined,
          headers: {
            "User-Agent": options.userAgent,
            ...(options.referer ? { Referer: options.referer } : {}),
            Host: parsed.host,
            Accept: "*/*",
          },
        };

        const outcome = await new Promise<{ redirect?: string; response?: HttpResponse }>((resolve, reject) => {
          const request = doRequest(requestOptions, parsed.protocol as "http:" | "https:");
          // 超时错误需 name === "AbortError"（resourceRepository 依赖该 name 映射为超时提示）
          const abortError = () => Object.assign(new Error("AbortError"), { name: "AbortError" });
          const timer = setTimeout(() => {
            request.destroy(abortError());
            reject(abortError());
          }, options.timeoutMs);
          let settled = false;
          request.on("response", (response) => {
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (REDIRECT_STATUS.has(status) && location) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              request.destroy();
              resolve({ redirect: new URL(String(Array.isArray(location) ? location[0] : location), current).toString() });
              return;
            }
            if (settled) return;
            settled = true;
            // 审计 F11：收到响应头时**不**清 deadline —— body 停滞（头快 body 慢/挂起）也必须被整体超时截止。
            // 用包装 body 在消费完成/出错时清定时器；超时仍走上面的 request.destroy + reject。
            const stream = response as AsyncIterable<Uint8Array>;
            const body = (async function* () {
              try { for await (const chunk of stream) yield chunk; }
              finally { clearTimeout(timer); }
            })();
            resolve({
              response: {
                status,
                headers: response.headers,
                body,
                abort: () => request.destroy(),
              },
            });
          });
          request.on("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          });
          request.end();
        });

        if (outcome.redirect) {
          if (hop >= options.maxRedirects) {
            throw new SsrfError(`重定向次数过多: ${current}`);
          }
          current = outcome.redirect;
          continue;
        }
        return outcome.response!;
      }
    },
  };
}
