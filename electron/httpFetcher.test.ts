import { describe, expect, it, vi } from "vitest";
import { createPinnedHttpFetcher, type HttpFetcherDeps } from "./httpFetcher.js";
import { SsrfError } from "./ssrf.js";

/**
 * SSRF + TOCTOU 修复测试（V5 Phase 2）：
 * - 字面私网 IP / localhost 拒绝；
 * - 域名解析后逐地址校验（DNS rebinding 到私网拒绝），且解析恰好一次；
 * - 连接层钉死已校验地址（request 收到的 hostname == 校验后的 IP，lookup 返回该地址，
 *   Host/SNI 保持原域名）——证明连接不再二次解析，TOCTOU 窗口关闭；
 * - 重定向逐跳重新解析校验；重定向次数超限；非 http(s) 协议拒绝；超时 AbortError。
 */

type FakeRequest = {
  on(event: string, cb: (arg?: unknown) => void): FakeRequest;
  end(): void;
  destroy(error?: Error): void;
  emitResponse(res: unknown): void;
  emitError(err: Error): void;
};

function makeFakeRequest(): FakeRequest {
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  const request = {
    on(event: string, cb: (arg?: unknown) => void) {
      (handlers[event] ??= []).push(cb);
      return request;
    },
    end() { /* no-op */ },
    destroy() { /* no-op */ },
    emitResponse(res: unknown) {
      for (const cb of handlers["response"] ?? []) cb(res);
    },
    emitError(err: Error) {
      for (const cb of handlers["error"] ?? []) cb(err);
    },
  };
  return request;
}

function makeFakeResponse(statusCode: number, headers: Record<string, string>, chunks: Uint8Array[] = []) {
  return {
    statusCode,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

const PUBLIC_IP = "93.184.216.34"; // 公网示例地址（不发起真实连接，仅用于断言钉死）

describe("createPinnedHttpFetcher SSRF 防护", () => {
  it("拒绝字面私网 IP（request 不被调用）", async () => {
    const request = vi.fn();
    const fetcher = createPinnedHttpFetcher({ request: request as unknown as HttpFetcherDeps["request"] });
    await expect(fetcher.fetch("http://127.0.0.1:8080/x", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
    await expect(fetcher.fetch("http://10.0.0.5/x", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
    await expect(fetcher.fetch("http://192.168.1.1/x", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
    expect(request).not.toHaveBeenCalled();
  });

  it("拒绝 localhost / 非 http(s) 协议", async () => {
    const fetcher = createPinnedHttpFetcher({ request: vi.fn() as unknown as HttpFetcherDeps["request"] });
    await expect(fetcher.fetch("http://localhost:8080/x", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
    await expect(fetcher.fetch("file:///etc/passwd", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
    await expect(fetcher.fetch("ftp://example.com/x", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
  });

  it("域名解析到私网 → 拒绝，且解析恰好一次（DNS rebinding 在解析层被拦）", async () => {
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const fetcher = createPinnedHttpFetcher({ lookup: lookup as unknown as HttpFetcherDeps["lookup"] });
    await expect(fetcher.fetch("http://evil.test/steal", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("evil.test");
  });

  it("域名解析失败 → 拒绝（宁可误伤不可放行）", async () => {
    const lookup = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    const fetcher = createPinnedHttpFetcher({ lookup: lookup as unknown as HttpFetcherDeps["lookup"] });
    await expect(fetcher.fetch("http://no-such-host.test/x", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
  });
});

describe("createPinnedHttpFetcher TOCTOU 修复（连接层钉死已校验地址）", () => {
  it("连接目标 == 校验后的 IP，Host/SNI 保持原域名，lookup 返回钉死地址", async () => {
    const lookup = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }]);
    let captured: Record<string, unknown> | null = null;
    let fakeReq: FakeRequest | null = null;
    const request = vi.fn((options: Record<string, unknown>) => {
      captured = options;
      fakeReq = makeFakeRequest();
      return fakeReq;
    });
    const fetcher = createPinnedHttpFetcher({ lookup: lookup as unknown as HttpFetcherDeps["lookup"], request: request as unknown as HttpFetcherDeps["request"] });

    const promise = fetcher.fetch("https://example.test/pic.png", { timeoutMs: 1000, maxRedirects: 5, userAgent: "UA-1" });
    // 等 fetch 完成 resolvePinned 并创建请求（微任务），再伪造 200 响应
    await new Promise((r) => setTimeout(r, 0));
    fakeReq!.emitResponse(makeFakeResponse(200, { "content-length": "3" }, [new Uint8Array([1, 2, 3])]));

    const response = await promise;
    expect(response.status).toBe(200);
    // 连接层钉死：hostname == 校验后 IP（而非原域名），避免连接时二次解析
    expect(captured).toMatchObject({
      hostname: PUBLIC_IP,
      method: "GET",
      headers: expect.objectContaining({ Host: "example.test", "User-Agent": "UA-1" }),
    });
    // TLS SNI 保持原域名
    expect(captured!["servername"]).toBe("example.test");
    // lookup 回调返回钉死地址（连接不会重新走系统 DNS）
    const lookupFn = captured!.lookup as (h: string, o: unknown, cb: (e: Error | null, a?: string, f?: number) => void) => void;
    const pinnedResult: Array<[string | null, string | undefined, number | undefined]> = [];
    lookupFn!("whatever.test", {}, (err, addr, fam) => { pinnedResult.push([err?.message ?? null, addr, fam]); });
    expect(pinnedResult[0]).toEqual([null, PUBLIC_IP, 4]);
  });

  it("重定向逐跳重新解析校验：第二跳解析到私网 → 拒绝", async () => {
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === "safe.test") return [{ address: PUBLIC_IP, family: 4 }];
      return [{ address: "127.0.0.1", family: 4 }]; // evil.test 解析到私网
    });
    let hop = 0;
    const request = vi.fn(() => {
      const fake = makeFakeRequest();
      const isFirst = hop === 0;
      hop += 1;
      setTimeout(() => {
        if (isFirst) {
          fake.emitResponse({ statusCode: 302, headers: { location: "http://evil.test/steal" } });
        } else {
          fake.emitResponse({ statusCode: 200, headers: {} });
        }
      }, 0);
      return fake;
    });
    const fetcher = createPinnedHttpFetcher({ lookup: lookup as unknown as HttpFetcherDeps["lookup"], request: request as unknown as HttpFetcherDeps["request"] });
    await expect(fetcher.fetch("http://safe.test/start", { timeoutMs: 1000, maxRedirects: 5, userAgent: "test" }))
      .rejects.toBeInstanceOf(SsrfError);
    // 两跳各解析一次（每跳都做 SSRF 校验）
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenNthCalledWith(1, "safe.test");
    expect(lookup).toHaveBeenNthCalledWith(2, "evil.test");
  });

  it("重定向次数超限 → 拒绝", async () => {
    const lookup = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }]);
    const request = vi.fn(() => {
      const fake = makeFakeRequest();
      setTimeout(() => fake.emitResponse({ statusCode: 302, headers: { location: "http://safe.test/again" } }), 0);
      return fake;
    });
    const fetcher = createPinnedHttpFetcher({ lookup: lookup as unknown as HttpFetcherDeps["lookup"], request: request as unknown as HttpFetcherDeps["request"] });
    await expect(fetcher.fetch("http://safe.test/start", { timeoutMs: 1000, maxRedirects: 2, userAgent: "test" }))
      .rejects.toMatchObject({ name: "SsrfError" });
  });

  it("超时 → AbortError", async () => {
    const request = vi.fn(() => makeFakeRequest()); // 永不响应/报错
    const fetcher = createPinnedHttpFetcher({ lookup: vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }]) as unknown as HttpFetcherDeps["lookup"], request: request as unknown as HttpFetcherDeps["request"] });
    await expect(fetcher.fetch("http://safe.test/slow", { timeoutMs: 60, maxRedirects: 5, userAgent: "test" }))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
