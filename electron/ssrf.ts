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

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}
