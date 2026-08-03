import net from "node:net";

/**
 * SSRF 防护：判断 host 是否为本机/私网地址（移植 Rust 版 validate_remote_image_url）。
 * 纯 Node 模块（无 Electron 依赖），便于单元测试。
 */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const ipVersion = net.isIP(h);
  if (ipVersion === 4) return isBlockedIPv4(h);
  if (ipVersion === 6) return isBlockedIPv6(h);
  return false; // 域名不做解析（避免异步 DNS 与误伤），仅拦截直接 IP
}

export function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;                       // 0/8 未指定、10/8、127/8 回环
  if (a === 169 && b === 254) return true;                                 // 169.254/16 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true;                        // 172.16/12 私网
  if (a === 192 && b === 168) return true;                                 // 192.168/16 私网
  if (a >= 224) return true;                                               // 组播/保留
  return false;
}

export function isBlockedIPv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return true;                              // 未指定/回环
  if (h.startsWith("fc") || h.startsWith("fd")) return true;               // fc00::/7 唯一本地
  if (/^fe[89ab]/.test(h)) return true;                                    // fe80::/10 链路本地
  // IPv4-mapped IPv6（::ffff:127.0.0.1 或 ::ffff:7f00:1）：解析出内嵌 IPv4 后复用 IPv4 拦截，
  // 否则 Chromium 会把 [::ffff:7f00:1] 连到 127.0.0.1，绕过 SSRF 防护
  if (h.startsWith("::ffff:")) {
    const embedded = h.slice("::ffff:".length);
    if (embedded.includes(".")) return isBlockedIPv4(embedded);
    const groups = embedded.split(":").filter(Boolean).map((g) => parseInt(g, 16));
    if (groups.length === 2 && groups.every((g) => !Number.isNaN(g))) {
      return isBlockedIPv4(`${(groups[0] >> 8) & 0xff}.${groups[0] & 0xff}.${(groups[1] >> 8) & 0xff}.${groups[1] & 0xff}`);
    }
  }
  return false;
}

// ===== DNS 感知校验（修复：域名解析到私网 / DNS rebinding 绕过） =====
// isBlockedHost 只拦截 URL 中直接出现的 IP/字面 host；域名必须解析后逐地址校验。
// 解析与请求之间仍存在理论 TOCTOU（DNS rebinding），本项目用 electronNet.fetch
// （Chromium 网络栈）无法在连接层钉死已校验地址；作为缓解，连接前解析并拒绝任一
// 解析结果为私网/本机的域名，同时下载侧改为逐跳校验重定向目标（见 store.ts）。

import dns from "node:dns";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * 校验远程 host 安全：字面 IP 直接拦截；域名解析 A/AAAA 后任一地址命中
 * 本机/私网/链路本地/保留/组播即拒绝。解析失败同样拒绝（宁可误伤不可放行）。
 */
export async function assertSafeRemoteHost(hostname: string): Promise<void> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) {
    throw new SsrfError("不允许下载本机或私网地址");
  }
  const ipVersion = net.isIP(h);
  if (ipVersion !== 0) {
    if (isBlockedHost(h)) throw new SsrfError("不允许下载本机或私网地址");
    return;
  }
  let records: { address: string; family: number }[];
  try {
    records = await dns.promises.lookup(h, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`域名解析失败，拒绝下载: ${h}`);
  }
  if (records.length === 0) throw new SsrfError(`域名解析为空，拒绝下载: ${h}`);
  for (const record of records) {
    const blocked = record.family === 4
      ? isBlockedIPv4(record.address)
      : isBlockedIPv6(record.address);
    if (blocked) throw new SsrfError(`域名解析到本机或私网地址，拒绝下载: ${h} -> ${record.address}`);
  }
}
