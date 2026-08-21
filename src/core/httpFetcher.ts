/**
 * HTTP 拉取注入点（lake-core，V5 Phase 2）。
 * ResourceRepository 不再直接依赖 electron net；桌面默认实现 =
 * electron/httpFetcher.ts（node:http/https + 连接层钉死已校验 DNS 地址，修复 SSRF TOCTOU）。
 * 移动端可实现为 RN fetch / WebView 拉取，接口与平台无关。
 */

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** 响应体流（分块 Uint8Array）。 */
  body: AsyncIterable<Uint8Array>;
  /** 主动终止连接（超时 / 超过体积上限时调用）。 */
  abort(): void;
}

export interface HttpFetchOptions {
  timeoutMs: number;
  maxRedirects: number;
  userAgent: string;
  referer?: string;
}

export interface HttpFetcher {
  /** 逐跳 SSRF 校验 + 手动重定向循环（连接层钉死已校验地址），返回最终响应。 */
  fetch(url: string, options: HttpFetchOptions): Promise<HttpResponse>;
}
