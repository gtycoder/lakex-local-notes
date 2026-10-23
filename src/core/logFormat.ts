/**
 * 日志格式化（**跨进程共享纯函数**，261023）。
 *
 * 目标（正式产品可排查）：
 * - 一条日志 = 人类可读的一句话 + 一组 key=value 字段（便于 grep / 事后聚合）；
 * - 耗时统一 [perf] 前缀 + 毫秒（与既有 [perf] 约定一致，见 docs/LOGGING.md）；
 * - 错误统一 describeError / errorFields（name: message + 前几帧调用栈）。
 *
 * 无 Electron / DOM / node: 依赖，主进程与渲染层共用；单测见 logFormat.test.ts。
 */

export type LogFieldValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogFieldValue>;

const MAX_FIELD_CHARS = 200;

function formatValue(value: LogFieldValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    // 耗时/字节等统计量给整数；小数四舍五入，避免亚毫秒抖动干扰阅读
    return Number.isInteger(value) ? String(value) : String(Math.round(value));
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) + "…" : value;
  return /[\s"=]/.test(text) ? JSON.stringify(text) : text;
}

/** 字段串： " k=v k2=v2"（undefined / null 跳过；含空格或引号的值加 JSON 引号）。 */
export function formatLogFields(fields?: LogFields): string {
  if (!fields) return "";
  let out = "";
  for (const [key, raw] of Object.entries(fields)) {
    const value = formatValue(raw);
    if (value === null) continue;
    out += " " + key + "=" + value;
  }
  return out;
}

/** 标准耗时行： "[perf] <label> <ms>ms k=v"。所有 perf 埋点都走它，保证可 grep/可聚合。 */
export function perfMessage(label: string, ms: number, fields?: LogFields): string {
  const rounded = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  return "[perf] " + label + " " + rounded + "ms" + formatLogFields(fields);
}

/** 错误 → "Name: message"（非 Error 变成字符串；不吞掉原始信息）。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return (error.name || "Error") + ": " + error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** 错误 → 日志字段（error + 前 3 帧调用栈；不记录正文内容）。 */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const frames = (error.stack ?? "").split("\n").slice(1, 4).map((line) => line.trim()).join(" | ");
    return { error: describeError(error), stack: frames || undefined };
  }
  return { error: describeError(error) };
}
