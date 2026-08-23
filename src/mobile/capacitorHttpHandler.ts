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

    // 传输超时（M4，对齐桌面 sync.ts S3_REQUEST_TIMEOUT_MS=30s / S3_TRANSFER_TIMEOUT_MS=120s）：
    // Get/Put（大对象）走长超时，其余命令走短超时。
    const isTransfer = request.method === "GET" || request.method === "PUT";
    const options: HttpOptions = {
      url: buildUrl(request),
      method: request.method,
      headers,
      responseType: "arraybuffer",
      connectTimeout: isTransfer ? 120_000 : 30_000,
      readTimeout: isTransfer ? 120_000 : 30_000,
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

    // 鲁棒读取 res.data（CapacitorHttp + responseType=arraybuffer → base64 string；也可能是 Uint8Array/Blob）。
    // AWS SDK S3 GetObject 期望 Blob/ReadableStream；统一收敛为 Blob，避免 out.Body undefined。
    let bytes: Uint8Array | null = null;
    const respData = (res as { data?: unknown }).data;
    if (typeof respData === "string" && respData.length > 0) {
      // binary（responseType=arraybuffer → base64）或文本：优先 base64 解码，失败按 utf8
      try { bytes = base64ToUint8Array(respData); } catch { bytes = new TextEncoder().encode(respData); }
    } else if (respData instanceof Uint8Array) {
      bytes = respData;
    } else if (respData instanceof ArrayBuffer) {
      bytes = new Uint8Array(respData);
    } else if (respData !== null && typeof respData === "object") {
      // CapacitorHttp 对 application/json 自动解析成对象 → 重新序列化回字节（manifest/元数据）
      bytes = new TextEncoder().encode(JSON.stringify(respData));
    }
    const body: ReadableStream<Uint8Array> | undefined = bytes ? new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }) : undefined;

    return { response: { statusCode: res.status, headers: responseHeaders, body } };
  }

  destroy(): void {}

  updateHttpClientConfig(): void {}

  httpHandlerConfigs(): object {
    return {};
  }
}
