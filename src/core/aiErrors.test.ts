import { describe, expect, it } from "vitest";
import { aiErrorInfo, aiErrorMessage } from "./aiErrors.js";

describe("aiErrorInfo", () => {
  it("按状态码归类并给出中文文案", () => {
    expect(aiErrorMessage({ status: 401 })).toBe("API Key 无效或已失效");
    expect(aiErrorMessage({ status: 403 })).toBe("无权访问该模型");
    expect(aiErrorMessage({ status: 404 })).toBe("模型不存在，或 Base URL 配置不对");
    expect(aiErrorMessage({ status: 429 })).toBe("请求过于频繁，请稍后再试");
    expect(aiErrorMessage({ status: 503 })).toBe("供应商服务异常（503）");
  });

  it("区分限流与额度不足", () => {
    expect(aiErrorInfo({ status: 429 }).kind).toBe("rate_limit");
    expect(aiErrorInfo({ status: 429, code: "insufficient_quota" }).kind).toBe("quota");
    expect(aiErrorInfo({ error: { code: "insufficient_quota" } }).message).toContain("额度不足");
  });

  it("取消 / 超时 / 网络 各有独立归类", () => {
    expect(aiErrorInfo({ name: "AbortError" }).kind).toBe("aborted");
    expect(aiErrorInfo({ code: "ETIMEDOUT", message: "timeout" }).kind).toBe("timeout");
    expect(aiErrorInfo({ message: "fetch failed" }).kind).toBe("network");
    expect(aiErrorInfo({ message: "getaddrinfo ENOTFOUND api.example.com" }).kind).toBe("network");
  });

  it("上下文超长 / 内容安全 单独提示", () => {
    expect(aiErrorInfo({ code: "context_length_exceeded" }).kind).toBe("context_length");
    expect(aiErrorInfo({ message: "maximum context length is 8192 tokens" }).kind).toBe("context_length");
    expect(aiErrorInfo({ message: "content_filter triggered" }).kind).toBe("content_filter");
  });

  it("retryable 只对 限流/5xx/网络/超时 为真", () => {
    expect(aiErrorInfo({ status: 429 }).retryable).toBe(true);
    expect(aiErrorInfo({ status: 500 }).retryable).toBe(true);
    expect(aiErrorInfo({ message: "fetch failed" }).retryable).toBe(true);
    expect(aiErrorInfo({ code: "ETIMEDOUT" }).retryable).toBe(true);
    expect(aiErrorInfo({ status: 401 }).retryable).toBe(false);
    expect(aiErrorInfo({ status: 400 }).retryable).toBe(false);
    expect(aiErrorInfo({ name: "AbortError" }).retryable).toBe(false);
    expect(aiErrorInfo({ status: 429, code: "insufficient_quota" }).retryable).toBe(false);
  });

  it("未知错误回落到原始 message（截断 200）", () => {
    expect(aiErrorMessage({ message: "x".repeat(400) }).length).toBe(200);
    expect(aiErrorMessage(null)).toBe("未知错误");
  });
});
