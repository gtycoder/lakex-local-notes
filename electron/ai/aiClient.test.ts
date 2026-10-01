import { describe, expect, it } from "vitest";
import { aiChat, aiTestProvider, type AiClientFactory } from "./aiClient.js";
import { aiErrorMessage as normalizeAiError } from "../../src/core/aiErrors.js";
import { defaultAiProviderConfig } from "../../src/core/aiProviders.js";

function provider(over: Partial<ReturnType<typeof defaultAiProviderConfig>> = {}) {
  return { ...defaultAiProviderConfig("openai"), apiKey: "sk-test", ...over };
}
const fakeFactory = (deltas: string[], pong: () => void = () => {}) : AiClientFactory => () => ({
  async *streamChat() { for (const d of deltas) yield d; },
  async ping() { pong(); },
  async listModels() { return ["fake-model"]; },
});

describe("主进程 aiClient", () => {
  it("流式累计 + 逐块回调，顺序不乱", async () => {
    const seen: string[] = [];
    const text = await aiChat({ provider: provider(), messages: [{ role: "user", content: "hi" }], onDelta: (d) => seen.push(d), factory: fakeFactory(["你", "好", "！"]) });
    expect(text).toBe("你好！");
    expect(seen.join("")).toBe("你好！");
  });

  it("aiTestProvider：无 Key / 无模型 直接失败，不建 client", async () => {
    expect(await aiTestProvider(provider({ apiKey: "" }))).toEqual({ ok: false, error: "未配置 API Key" });
    expect(await aiTestProvider(provider({ model: "" }))).toEqual({ ok: false, error: "未配置模型" });
    let called = false;
    const ok = await aiTestProvider(provider(), fakeFactory([], () => { called = true; }));
    expect(ok).toEqual({ ok: true });
    expect(called).toBe(true);
  });

  it("normalizeAiError 归类常见错误，且不回显 Key", () => {
    expect(normalizeAiError({ status: 401, message: "Incorrect API key provided: sk-secret" })).toBe("API Key 无效或已失效");
    expect(normalizeAiError({ status: 429 })).toBe("请求过于频繁，请稍后再试");
    expect(normalizeAiError({ status: 429, code: "insufficient_quota" })).toContain("额度不足");
    expect(normalizeAiError({ status: 503 })).toContain("503");
    expect(normalizeAiError({ name: "AbortError" })).toBe("已取消");
    expect(normalizeAiError(new Error("fetch failed"))).toContain("网络不可达");
  });
});

describe("重试职责", () => {
  it("网关不再自行重试：工厂抛错直接冒泡且只调用一次（重试交给 client 侧的 SDK）", async () => {
    let calls = 0;
    const factory: AiClientFactory = () => ({
      async *streamChat() { calls += 1; throw Object.assign(new Error("rate limited"), { status: 429 }); },
      async ping() {},
      async listModels() { return []; },
    });
    await expect(aiChat({ provider: provider(), messages: [{ role: "user", content: "hi" }], factory })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
