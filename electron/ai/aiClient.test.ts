import { describe, expect, it } from "vitest";
import { aiChat, aiTestProvider, normalizeAiError, type AiClientFactory } from "./aiClient.js";
import { defaultAiProviderConfig } from "../../src/core/aiProviders.js";

function provider(over: Partial<ReturnType<typeof defaultAiProviderConfig>> = {}) {
  return { ...defaultAiProviderConfig("openai"), apiKey: "sk-test", ...over };
}
const fakeFactory = (deltas: string[], pong: () => void = () => {}) : AiClientFactory => () => ({
  async *streamChat() { for (const d of deltas) yield d; },
  async ping() { pong(); },
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
    expect(normalizeAiError({ status: 429 })).toBe("请求过于频繁或额度不足，请稍后再试");
    expect(normalizeAiError({ status: 503 })).toContain("503");
    expect(normalizeAiError({ name: "AbortError" })).toBe("已取消");
    expect(normalizeAiError(new Error("fetch failed"))).toContain("网络不可达");
  });
});
