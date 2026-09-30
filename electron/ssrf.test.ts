import { describe, expect, it } from "vitest";
import { isBlockedHost, isBlockedIPv4, isBlockedIPv6 } from "./ssrf.js";

/** 从真实 URL 提取 hostname（含 WHATWG URL 规范化）后判定 */
function blockedFromUrl(url: string): boolean {
  return isBlockedHost(new URL(url).hostname);
}

describe("isBlockedIPv4", () => {
  it.each([
    ["127.0.0.1", true],
    ["0.0.0.0", true],
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false], // 172.32/12 之外是公网
    ["192.168.1.1", true],
    ["169.254.1.1", true],
    ["169.253.1.1", false],
    ["224.0.0.1", true],  // 组播
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["100.64.0.1", false], // CGNAT（现有实现未拦截，属已知边界）
  ])("%s → %s", (ip, expected) => {
    expect(isBlockedIPv4(ip)).toBe(expected);
  });
});

describe("isBlockedIPv6", () => {
  it.each([
    ["::", true],
    ["::1", true],
    ["fc00::1", true],
    ["fd12:3456:789a::1", true],
    ["fe80::1", true],
    ["fe90::1", true],
    ["fea0::1", true],
    ["feb0::1", true],
    ["::ffff:127.0.0.1", true],   // IPv4-mapped 回环
    ["::ffff:7f00:1", true],      // 双组十六进制（URL 规范化后形态）
    ["::ffff:192.168.1.1", true], // IPv4-mapped 私网
    ["::ffff:8.8.8.8", false],    // IPv4-mapped 公网放行
    ["2001:db8::1", false],
    ["2606:4700::1111", false],
  ])("%s → %s", (ip, expected) => {
    expect(isBlockedIPv6(ip)).toBe(expected);
  });
});

describe("isBlockedHost + URL 规范化（SSRF 主入口）", () => {
  it("拦截 localhost 及子域", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("foo.localhost")).toBe(true);
  });

  it("直接 IP 明文与 IPv6 括号形式", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("[::1]")).toBe(true);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
  });

  it("域名不做 DNS 解析，直接放行（已知设计取舍）", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("internal.corp")).toBe(false);
  });

  it("WHATWG URL 把简写/整数 IP 规范化为点分十进制后拦截", () => {
    expect(blockedFromUrl("http://127.1/")).toBe(true);          // 127.0.0.1
    expect(blockedFromUrl("http://2130706433/")).toBe(true);     // 127.0.0.1
    expect(blockedFromUrl("http://0x7f000001/")).toBe(true);     // 127.0.0.1
    expect(blockedFromUrl("http://0177.0.0.1/")).toBe(true);     // 127.0.0.1
    expect(blockedFromUrl("http://[::ffff:127.0.0.1]/")).toBe(true); // → [::ffff:7f00:1]
    expect(blockedFromUrl("http://[::ffff:7f00:1]/")).toBe(true);
  });

  it("IPv4-mapped 公网地址放行", () => {
    expect(blockedFromUrl("http://[::ffff:8.8.8.8]/")).toBe(false);
  });

  it("端口号不影响 host 判定", () => {
    expect(blockedFromUrl("http://192.168.1.1:8080/")).toBe(true);
    expect(blockedFromUrl("http://10.0.0.2:3000/x.png")).toBe(true);
  });
});
