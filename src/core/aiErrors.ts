/**
 * AI 错误的统一归类（纯函数：无 node 依赖，主进程/渲染层可共用）。
 *
 * 两条判定维度缺一不可（260930 真实 SDK 实测教训）：
 *  1. **错误类名**：openai SDK 抛的是 AuthenticationError / RateLimitError / APIConnectionError 这类子类，
 *     连接失败时 message 只有 "Connection error."，靠关键词匹配**永远匹配不到**中文归类；
 *  2. **状态码 / code**：自建兼容端点（本地 llama.cpp / vLLM 等）常只给 status/code。
 */
export type AiErrorKind =
  | "auth" | "forbidden" | "not_found" | "rate_limit" | "quota" | "server"
  | "network" | "timeout" | "aborted" | "context_length" | "content_filter"
  | "bad_request" | "not_configured" | "unavailable" | "unknown";

export interface AiErrorInfo {
  kind: AiErrorKind;
  /** 给用户看的中文（绝不包含 Key）。 */
  message: string;
  /** 重试有意义吗（限流/5xx/网络/超时）。 */
  retryable: boolean;
}

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set<AiErrorKind>(["rate_limit", "server", "network", "timeout"]);
const MESSAGE: Record<AiErrorKind, string> = {
  auth: "API Key 无效或已失效",
  forbidden: "无权访问该模型",
  not_found: "模型不存在，或 Base URL 配置不对",
  rate_limit: "请求过于频繁，请稍后再试",
  quota: "额度不足或计费异常，请检查供应商账户",
  server: "供应商服务异常",
  network: "网络不可达：检查网络或 Base URL",
  timeout: "请求超时：检查网络或 Base URL",
  aborted: "已取消",
  context_length: "内容超过模型上下文上限，请减少选中文字或缩短提问",
  content_filter: "内容被供应商的安全策略拦截",
  bad_request: "请求参数有误（检查模型名与温度）",
  not_configured: "未配置 API Key：到「设置 → AI 助手」填写",
  unavailable: "当前平台不支持 AI 通道（需 Android 真机/模拟器）",
  unknown: "未知错误",
};

/** openai SDK 的错误子类名 → 归类。 */
const BY_NAME: Record<string, AiErrorKind> = {
  AuthenticationError: "auth",
  PermissionDeniedError: "forbidden",
  NotFoundError: "not_found",
  RateLimitError: "rate_limit",
  InternalServerError: "server",
  APIConnectionError: "network",
  APIConnectionTimeoutError: "timeout",
  APIUserAbortError: "aborted",
  BadRequestError: "bad_request",
  UnprocessableEntityError: "bad_request",
};

/** 原生通道（Kotlin）回传的稳定错误码 → 归类。码表与 android/.../AiChatPlugin.kt 一致。 */
const KIND_BY_CODE: Record<string, AiErrorKind> = {
  auth: "auth",
  forbidden: "forbidden",
  not_found: "not_found",
  rate_limit: "rate_limit",
  quota: "quota",
  server: "server",
  network: "network",
  timeout: "timeout",
  aborted: "aborted",
  context_length: "context_length",
  content_filter: "content_filter",
  bad_request: "bad_request",
  not_configured: "not_configured",
  unavailable: "unavailable",
  unknown: "unknown",
};

export interface AiErrorCodeInput {
  /** 原生侧归类后的稳定码（见 KIND_BY_CODE）。 */
  code?: string;
  /** HTTP 状态码（原生侧能拿到时一起给，用于兜底归类）。 */
  status?: number;
  /** 供应商原文/附加说明（会拼在中文后面；调用方保证不含 Key）。 */
  detail?: string;
}

function kindFromStatus(status?: number): AiErrorKind | null {
  if (status === undefined) return null;
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return null;
}

/** 原生通道的错误 → 统一 { kind, message, retryable }（中文文案单一来源）。 */
export function aiErrorInfoFromCode(input: AiErrorCodeInput): AiErrorInfo {
  const kind: AiErrorKind =
    (input.code ? KIND_BY_CODE[input.code] : undefined)
    ?? kindFromStatus(input.status)
    ?? "unknown";
  const detail = typeof input.detail === "string" ? input.detail.trim() : "";
  // 平台码本身已是完整中文（未配置 / 通道不可用），不再拼供应商原文，避免「…：未配置 API Key」重复。
  const withDetail = detail && kind !== "not_configured" && kind !== "unavailable";
  const message = withDetail ? MESSAGE[kind] + "：" + detail.slice(0, 200) : MESSAGE[kind];
  return { kind, message, retryable: RETRYABLE.has(kind) };
}

function rec(v: unknown): Record<string, unknown> { return (v && typeof v === "object" ? v : {}) as Record<string, unknown>; }
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function num(v: unknown): number | undefined { return typeof v === "number" ? v : undefined; }

/** 把任意抛出的错误归类成 { kind, message, retryable }。 */
export function aiErrorInfo(err: unknown): AiErrorInfo {
  const e = rec(err);
  const nested = rec(e.error);
  const status = num(e.status) ?? num(e.statusCode);
  const code = str(e.code) || str(nested.code);
  const type = str(e.type) || str(nested.type);
  const name = str(e.name);
  const raw = str(e.message) || str(nested.message);
  const hay = (code + " " + type + " " + name + " " + raw).toLowerCase();
  const mk = (kind: AiErrorKind, message?: string): AiErrorInfo => ({ kind, message: message ?? MESSAGE[kind], retryable: RETRYABLE.has(kind) });

  // 1) 错误类名最可靠（SDK 子类）：连接失败时 message 只有 "Connection error."
  const byName = BY_NAME[name];
  if (byName) return mk(byName, byName === "server" && status !== undefined ? MESSAGE.server + "（" + status + "）" : undefined);
  // 2) 取消最早判（abort 往往同时带 status/code）
  if (code === "ABORT_ERR" || /aborted|aborterror/.test(hay)) return mk("aborted");
  // 3) 额度不足优先于限流（两者常同为 429）
  if (code === "insufficient_quota" || /insufficient_quota|quota|billing|balance|欠费|额度/.test(hay)) return mk("quota");
  if (status === 401) return mk("auth");
  if (status === 403) return mk("forbidden");
  if (status === 404) return mk("not_found");
  if (status === 429 || /rate.?limit|too many requests/.test(hay)) return mk("rate_limit");
  if (status !== undefined && status >= 500) return mk("server", MESSAGE.server + "（" + status + "）");
  if (/context_length_exceeded|maximum context|context length|too long/.test(hay)) return mk("context_length");
  if (/content_filter|content policy|safety/.test(hay)) return mk("content_filter");
  if (/timeout|etimedout|timed out/.test(hay)) return mk("timeout");
  if (/connection error|fetch failed|enotfound|econnrefused|econnreset|eai_again|socket hang up|network/.test(hay)) return mk("network");
  // 真实 DeepSeek 实测：模型名写错返回的是 **400 + 英文原文**
  // "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed no-such-model."
  // 这句里的支持列表很有用，所以保留原文尾巴，但加中文前缀并归到 not_found（贴到「模型」字段）。
  if (/supported api model names|unknown model|model not found|invalid model|does not exist|no such model/.test(hay)) {
    return mk("not_found", raw ? "模型名不被支持：" + raw.slice(0, 180) : MESSAGE.not_found);
  }
  if (status === 400) return mk("bad_request", raw ? raw.slice(0, 200) : undefined);
  if (raw) return mk("unknown", raw.slice(0, 200));
  return mk("unknown");
}

/** 只要中文文案时的便捷入口。 */
export function aiErrorMessage(err: unknown): string { return aiErrorInfo(err).message; }
