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
 * 261114 下载提速 / 提成功率（粘贴整页网页的图片批量下载）：
 * - 同一域名解析出的多个地址逐个尝试（首选上次成功的地址）：单条 CDN 边不可用/半挂时不再一路
 *   卡到总超时，而是 6s 内换下一个地址；总预算仍由调用方 timeoutMs 约束（不放大最坏耗时）。
 * - 连接复用：images 批量下载共用 keepAlive Agent（上限 8 条/站点），省掉每张图一次 TLS 握手。
 * - 浏览器风味请求头（Accept/Accept-Language）：部分图床按 UA/头组合拒绝非浏览器请求。
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

/** 单个解析地址的最长尝试窗口：到点就换下一个地址（总预算仍受 options.timeoutMs 约束）。 */
const ADDRESS_ATTEMPT_MS = 6_000;
/** 每个域名最多尝试的地址数（CDN 常返回 8 个同边缘地址，逐个试没有收益）。 */
const MAX_ADDRESS_ATTEMPTS = 3;
/** 「上次成功地址」记忆时长：同站点批量图片优先复用，避免反复踩到坏边。 */
const PREFERRED_ADDRESS_TTL_MS = 5 * 60_000;

/**
 * 图片批量下载连接池（只用于本 fetcher 的图片/资源下载，不放宽 S3 传输并发）。
 * keepAlive 让同一 CDN 的多张图复用 TLS 连接；maxSockets=8 与「粘贴 30+ 张图」的实测吞吐匹配。
 */
const HTTP_AGENT = new http.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4, timeout: 5_000, scheduling: "lifo" });
const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4, timeout: 5_000, scheduling: "lifo" });

const preferredAddresses = new Map<string, { address: dns.LookupAddress; at: number }>();

function preferredAddressOf(hostname: string): string | null {
  const hit = preferredAddresses.get(hostname);
  if (!hit) return null;
  if (Date.now() - hit.at > PREFERRED_ADDRESS_TTL_MS) {
    preferredAddresses.delete(hostname);
    return null;
  }
  return hit.address.address;
}

function rememberAddress(hostname: string, address: dns.LookupAddress): void {
  preferredAddresses.set(hostname, { address, at: Date.now() });
}

function forgetAddress(hostname: string, address: dns.LookupAddress): void {
  const hit = preferredAddresses.get(hostname);
  if (hit && hit.address.address === address.address) preferredAddresses.delete(hostname);
}

/** 把解析结果排成尝试顺序：上次成功地址优先，其余保持解析顺序，最多 MAX_ADDRESS_ATTEMPTS 个。 */
function orderAddresses(hostname: string, records: dns.LookupAddress[]): dns.LookupAddress[] {
  const preferred = preferredAddressOf(hostname);
  const ordered = preferred ? [...records].sort((a, b) => (a.address === preferred ? -1 : 0) - (b.address === preferred ? -1 : 0)) : records;
  return ordered.slice(0, MAX_ADDRESS_ATTEMPTS);
}

export interface HttpFetcherDeps {
  /** DNS 解析（all records）注入；默认 dns.promises.lookup(hostname, { all: true, verbatim: true }) */
  lookup?: (hostname: string) => Promise<dns.LookupAddress[]>;
  /** 传输请求注入；默认按协议选 http/https.request。测试可用伪造响应/重定向证明钉死链路。 */
  request?: (options: http.RequestOptions, protocol: "http:" | "https:") => TransportRequest;
}

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

type HopOutcome =
  | { kind: "redirect"; location: string }
  | { kind: "response"; response: HttpResponse };

/** 解析并逐地址校验域名（任一私网/本机即拒绝），返回全部待尝试地址。 */
export function createPinnedHttpFetcher(deps: HttpFetcherDeps = {}): HttpFetcher {
  const lookupAll = deps.lookup ?? ((hostname: string) => dns.promises.lookup(hostname, { all: true, verbatim: true }));
  const doRequest = deps.request ?? ((options: http.RequestOptions, protocol: "http:" | "https:") => {
    const transport = protocol === "https:" ? https : http;
    return transport.request(options) as unknown as TransportRequest;
  });

  /** 解析目标 host：字面 IP 直接校验；域名解析一次并校验全部地址（解析失败拒绝）。 */
  async function resolveAll(hostname: string): Promise<dns.LookupAddress[]> {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) {
      throw new SsrfError("不允许下载本机或私网地址");
    }
    const ipVersion = net.isIP(host);
    if (ipVersion !== 0) {
      const blocked = ipVersion === 4 ? isBlockedIPv4(host) : isBlockedIPv6(host);
      if (blocked) throw new SsrfError("不允许下载本机或私网地址");
      return [{ address: host, family: ipVersion }];
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
    return records;
  }

  /** 单个地址的一次尝试：attemptMs 内没拿到响应头就放弃（换下一个地址）；拿到响应头后 body 仍受 bodyBudgetMs 截止。 */
  function requestHop(
    current: string,
    parsed: URL,
    pinned: dns.LookupAddress,
    attemptMs: number,
    bodyBudgetMs: number,
    userAgent: string,
    referer?: string,
  ): Promise<HopOutcome> {
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
      // 连接复用：批量图片省掉每张一次 TLS 握手
      agent: isHttps ? HTTPS_AGENT : HTTP_AGENT,
      headers: {
        "User-Agent": userAgent,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Host: parsed.host,
        ...(referer ? { Referer: referer } : {}),
      },
    };
    return new Promise<HopOutcome>((resolve, reject) => {
      const abortError = () => Object.assign(new Error("AbortError"), { name: "AbortError" });
      const request = doRequest(requestOptions, parsed.protocol as "http:" | "https:");
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      const attemptTimer = setTimeout(() => {
        request.destroy(abortError());
        settle(() => reject(abortError()));
      }, attemptMs);
      request.on("response", (response) => {
        clearTimeout(attemptTimer);
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (REDIRECT_STATUS.has(status) && location) {
          settle(() => {
            request.destroy();
            resolve({ kind: "redirect", location: new URL(String(Array.isArray(location) ? location[0] : location), current).toString() });
          });
          return;
        }
        const stream = response as AsyncIterable<Uint8Array>;
        // 审计 F11：收到响应头**不**清 deadline —— body 停滞（头快 body 慢/挂起）也必须被整体超时截止。
        const bodyTimer = setTimeout(() => request.destroy(abortError()), Math.max(1, bodyBudgetMs));
        const body = (async function* () {
          try { for await (const chunk of stream) yield chunk; }
          finally { clearTimeout(bodyTimer); }
        })();
        settle(() => resolve({
          kind: "response",
          response: {
            status,
            headers: response.headers,
            body,
            abort: () => request.destroy(),
          },
        }));
      });
      request.on("error", (error) => {
        clearTimeout(attemptTimer);
        settle(() => reject(error));
      });
      request.end();
    });
  }

  return {
    async fetch(url: string, options: HttpFetchOptions): Promise<HttpResponse> {
      let current = url;
      for (let hop = 0; ; hop += 1) {
        const parsed = new URL(current);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new SsrfError("重定向目标仅支持 HTTP 或 HTTPS");
        }
        const records = await resolveAll(parsed.hostname);
        const addresses = orderAddresses(parsed.hostname, records);
        const hopDeadline = Date.now() + options.timeoutMs;
        let lastError: unknown = null;
        let redirectTo: string | null = null;

        for (const address of addresses) {
          const remaining = hopDeadline - Date.now();
          if (remaining <= 0) break;
          const attemptMs = Math.min(remaining, ADDRESS_ATTEMPT_MS);
          try {
            const outcome = await requestHop(current, parsed, address, attemptMs, hopDeadline - Date.now(), options.userAgent || FETCH_USER_AGENT, options.referer);
            if (outcome.kind === "redirect") {
              // 重定向跳不做地址失败转移：交给外层 hop 重新解析 + 校验目标域名
              redirectTo = outcome.location;
              break;
            }
            rememberAddress(parsed.hostname, address);
            return outcome.response;
          } catch (error) {
            if (error instanceof SsrfError) throw error;
            lastError = error;
            forgetAddress(parsed.hostname, address);
            // 总预算耗尽就不再换地址（调用方按失败处理，不放大最坏耗时）
            if (hopDeadline - Date.now() <= 500) break;
          }
        }

        if (redirectTo) {
          if (hop >= options.maxRedirects) {
            throw new SsrfError(`重定向次数过多: ${current}`);
          }
          current = redirectTo;
          continue;
        }
        const failure = lastError instanceof Error
          ? lastError
          : Object.assign(new Error("下载失败"), { name: "AbortError" });
        throw failure;
      }
    },
  };
}

/** 与 electron/resourceRepository 的浏览器 UA 对齐（图床常按 UA 判定是否为浏览器）。 */
const FETCH_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
