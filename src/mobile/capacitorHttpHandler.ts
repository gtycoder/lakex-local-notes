/**
 * S3 请求分层（M0 POC）：AWS SDK requestHandler → Capacitor 原生 HTTP（Android OkHttp）。
 *
 * 背景：WebView 内直接 fetch 会撞 CORS（七牛桶默认无 CORS 规则，且用户不改云端配置）。
 * 参考思源：网络请求在原生层（Go kernel）做，WebView 只做 UI——我们等价地把
 * HTTP 传输层下沉原生，AWS SDK 的签名/协议逻辑保留在 JS（复用成熟实现）。
 * 这同时对齐 V5 Phase 2 的 HttpFetcher 注入点（桌面=electron net，移动端=CapacitorHttp）。
 *
 * 二进制 body 约定（Capacitor Android 原生实现，HttpRequestHandler.setRequestBody）：
 * - 发送：Uint8Array → base64 + dataType='file'（原生 Base64.decode 后写原始字节）
 * - 接收：responseType='arraybuffer' → data 为 base64 字符串 → 解码为 Uint8Array
 */
import { CapacitorHttp, type HttpOptions } from "@capacitor/core";
import type { HttpHandlerOptions, HttpRequest, HttpResponse, RequestHandler } from "@smithy/types";

function buildUrl(request: HttpRequest): string {
  let url = `${request.protocol}//${request.hostname}`;
  if (request.port) url += `:${request.port}`;
  url += request.path;
  if (request.query && Object.keys(request.query).length > 0) {
    const qs = Object.entries(request.query)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }
  return url;
}

function bodyToCapacitor(
  body: unknown
): { data?: unknown; dataType?: "file" | "formData" } {
  if (body == null) return {};
  if (typeof body === "string") return { data: body };
  if (body instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < body.length; i++) bin += String.fromCharCode(body[i]);
    return { data: btoa(bin), dataType: "file" };
  }
  if (body instanceof ArrayBuffer) return bodyToCapacitor(new Uint8Array(body));
  return { data: body };
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class CapacitorHttpHandler implements RequestHandler<HttpRequest, HttpResponse, HttpHandlerOptions> {
  /** AWS SDK requestHandler 协议元数据（"h1" 表示 HTTP/1.x 语义） */
  metadata = { handlerProtocol: "capacitor-http" as const };

  async handle(request: HttpRequest, _options?: HttpHandlerOptions): Promise<{ response: HttpResponse }> {
    const { data, dataType } = bodyToCapacitor(request.body);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers)) {
      if (v != null) headers[k] = String(v);
    }
    // 原生层自动处理 Host/Content-Length；显式删除避免冲突
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    delete headers["host"];

    const options: HttpOptions = {
      url: buildUrl(request),
      method: request.method,
      headers,
      responseType: "arraybuffer",
    };
    if (data !== undefined) {
      options.data = data;
      if (dataType) options.dataType = dataType;
    }

    const res = await CapacitorHttp.request(options);

    const responseHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers ?? {})) {
      responseHeaders[k.toLowerCase()] = String(v);
    }

    let body: ReadableStream<Uint8Array> | undefined;
    if (typeof res.data === "string" && res.data.length > 0) {
      let bytes: Uint8Array;
      try {
        bytes = base64ToUint8Array(res.data);
      } catch {
        bytes = new TextEncoder().encode(res.data);
      }
      // AWS SDK 期望 Blob / ReadableStream（浏览器运行时）；Uint8Array 会被拒（Deserialization error）
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    }

    return { response: { statusCode: res.status, headers: responseHeaders, body } };
  }

  destroy(): void {}

  updateHttpClientConfig(): void {}

  httpHandlerConfigs(): object {
    return {};
  }
}
