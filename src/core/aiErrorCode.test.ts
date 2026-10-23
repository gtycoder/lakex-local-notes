import { describe, expect, it } from "vitest";
import { aiErrorInfoFromCode } from "./aiErrors";

describe("原生 AI 错误码 → 中文归类", () => {
  it("按码表归类并保留 retryable 语义", () => {
    expect(aiErrorInfoFromCode({ code: "auth" }).kind).toBe("auth");
    expect(aiErrorInfoFromCode({ code: "rate_limit" }).retryable).toBe(true);
    expect(aiErrorInfoFromCode({ code: "auth" }).retryable).toBe(false);
    expect(aiErrorInfoFromCode({ code: "network" }).message).toContain("网络");
    expect(aiErrorInfoFromCode({ code: "aborted" }).kind).toBe("aborted");
  });
  it("未知码用 HTTP 状态兜底", () => {
    expect(aiErrorInfoFromCode({ status: 401 }).kind).toBe("auth");
    expect(aiErrorInfoFromCode({ status: 429 }).kind).toBe("rate_limit");
    expect(aiErrorInfoFromCode({ status: 503 }).kind).toBe("server");
    expect(aiErrorInfoFromCode({ status: 400 }).kind).toBe("bad_request");
  });
  it("detail 拼在中文后面且截断", () => {
    const info = aiErrorInfoFromCode({ code: "server", detail: "x".repeat(500) });
    expect(info.message).toContain("供应商服务异常");
    expect(info.message.length).toBeLessThan(260);
  });
  it("平台码有友好文案（未配置 Key / 通道不可用）", () => {
    expect(aiErrorInfoFromCode({ code: "not_configured" }).message).toContain("未配置 API Key");
    expect(aiErrorInfoFromCode({ code: "unavailable" }).message).toContain("不支持 AI 通道");
  });
  it("完全未知 ⇒ unknown（不抛）", () => {
    expect(aiErrorInfoFromCode({}).kind).toBe("unknown");
  });
});
