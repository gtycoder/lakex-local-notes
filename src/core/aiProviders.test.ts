import { describe, expect, it } from "vitest";
import {
  AI_PROVIDERS, aiBaseUrlChangeError, aiSettingsReady, aiSettingsView, defaultAiSettings, mergeAiSettings,
  normalizeAiSettings, validateAiBaseUrl,
} from "./aiProviders.js";

describe("aiProviders 设置模型", () => {
  it("默认设置 = 目录第一家 + 默认 baseUrl/model/temperature", () => {
    const s = defaultAiSettings();
    expect(s.activeProviderId).toBe(AI_PROVIDERS[0].id);
    expect(s.providers[AI_PROVIDERS[0].id].baseUrl).toBe(AI_PROVIDERS[0].defaultBaseUrl);
    expect(aiSettingsReady(s)).toBe(false); // 没 Key
  });

  it("normalizeAiSettings 对坏输入一律回落、绝不抛", () => {
    expect(normalizeAiSettings(null).activeProviderId).toBe(AI_PROVIDERS[0].id);
    const s = normalizeAiSettings({ activeProviderId: "nope", providers: { openai: { temperature: 99, baseUrl: "  ", model: "" } } });
    expect(s.activeProviderId).toBe("openai");
    expect(s.providers.openai.temperature).toBe(2); // clamp 到上界
    expect(s.providers.openai.baseUrl).toBe(AI_PROVIDERS[0].defaultBaseUrl);
    expect(s.providers.openai.model).toBe(AI_PROVIDERS[0].defaultModel);
  });

  it("mergeAiSettings：apiKey 省略/空串=沿用，clearApiKey 才清除", () => {
    const cur = normalizeAiSettings({ activeProviderId: "openai", providers: { openai: { apiKey: "sk-old", model: "m1" } } });
    const kept1 = mergeAiSettings(cur, { providers: [{ id: "openai", model: "m2" }] });
    expect(kept1.providers.openai.apiKey).toBe("sk-old");
    expect(kept1.providers.openai.model).toBe("m2");
    const kept2 = mergeAiSettings(cur, { providers: [{ id: "openai", apiKey: "   " }] });
    expect(kept2.providers.openai.apiKey).toBe("sk-old");
    const replaced = mergeAiSettings(cur, { providers: [{ id: "openai", apiKey: "sk-new" }] });
    expect(replaced.providers.openai.apiKey).toBe("sk-new");
    const cleared = mergeAiSettings(cur, { providers: [{ id: "openai", clearApiKey: true }] });
    expect(cleared.providers.openai.apiKey).toBeUndefined();
  });

  it("aiSettingsView 绝不暴露 apiKey（只给 hasApiKey）", () => {
    const s = normalizeAiSettings({ providers: { openai: { apiKey: "sk-secret" } } });
    const view = aiSettingsView(s);
    expect(JSON.stringify(view)).not.toContain("sk-secret");
    expect(view.providers[0].hasApiKey).toBe(true);
    expect(aiSettingsReady(s)).toBe(true);
  });

  it("切换供应商不丢配置：各供应商各存一份，切回原样；首次切到未配置的取该家默认且不继承上一家的 Key", () => {
    let s = defaultAiSettings();
    s = mergeAiSettings(s, { providers: [{ id: "openai", apiKey: "sk-openai", baseUrl: "https://x/v1", model: "gpt-4o", temperature: 1.2 }] });
    // 首次切到 deepseek：取该家默认，且**不**带上 openai 的 Key
    s = mergeAiSettings(s, { activeProviderId: "deepseek", providers: [{ id: "deepseek" }] });
    expect(s.activeProviderId).toBe("deepseek");
    expect(s.providers.deepseek.model).toBe("deepseek-flash");
    expect(s.providers.deepseek.apiKey).toBeUndefined();
    s = mergeAiSettings(s, { providers: [{ id: "deepseek", apiKey: "sk-ds" }] });
    // 切回 openai：原配置原样保留
    s = mergeAiSettings(s, { activeProviderId: "openai", providers: [{ id: "openai" }] });
    expect(s.providers.openai.apiKey).toBe("sk-openai");
    expect(s.providers.openai.baseUrl).toBe("https://x/v1");
    expect(s.providers.openai.model).toBe("gpt-4o");
    expect(s.providers.openai.temperature).toBe(1.2);
    expect(s.providers.deepseek.apiKey).toBe("sk-ds");
  });
});

/**
 * SEC-01：baseUrl 是"已存 API Key 发往哪里"的唯一决定因素 ⇒ 准入必须是纯函数、可单测。
 * 背景：草稿只给 baseUrl 时 mergeAiSettings 会沿用已存 Key，等于渲染层能把主进程凭据送去任意地址。
 */
describe("AI 服务地址准入（SEC-01）", () => {
  const stored = { id: "deepseek", protocol: "openai-compatible" as const, baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", apiKey: "sk-stored", temperature: 0.7 };

  it("validateAiBaseUrl：只允许 http(s)；http 仅本机；拒绝空/超长/userinfo/非法 URL", () => {
    expect(validateAiBaseUrl("https://api.deepseek.com/v1")).toBeNull();
    expect(validateAiBaseUrl("http://127.0.0.1:11434/v1")).toBeNull();
    expect(validateAiBaseUrl("http://localhost:11434/v1")).toBeNull();
    expect(validateAiBaseUrl("http://api.deepseek.com/v1")).toMatch(/HTTPS/); // http 非本地 ⇒ 拒
    expect(validateAiBaseUrl("ftp://api.deepseek.com/v1")).toMatch(/http/);
    expect(validateAiBaseUrl("https://user:pass@api.deepseek.com/v1")).toMatch(/用户名/);
    expect(validateAiBaseUrl("")).toMatch(/不能为空/);
    expect(validateAiBaseUrl("   ")).toMatch(/不能为空/);
    expect(validateAiBaseUrl(undefined)).toMatch(/不能为空/);
    expect(validateAiBaseUrl("not a url")).toMatch(/不是合法 URL/);
    expect(validateAiBaseUrl("https://a.example/" + "x".repeat(3000))).toMatch(/不能超过/);
  });

  it("换 baseUrl 但本次不带 Key ⇒ 拒绝（不能复用已存 Key 发往新地址）", () => {
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "https://attacker.example/v1" }))
      .toBe("修改服务地址时必须重新填写 API Key");
  });

  it("换 baseUrl 且显式带 Key + 合法 https ⇒ 通过", () => {
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "https://new.example/v1", apiKey: "sk-new" })).toBeNull();
    // 显式 clearApiKey 也不会复用已存 Key ⇒ 允许（地址仍需过校验）
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "https://new.example/v1", clearApiKey: true })).toBeNull();
  });

  it("http 非本地 ⇒ 无论带不带 Key 都拒绝；本地 http 允许", () => {
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "http://attacker.example/v1", apiKey: "sk-new" })).toMatch(/HTTPS/);
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "sk-new" })).toBeNull();
  });

  it("只有 model/temperature 变化 ⇒ 不受影响；同一地址重提交（含尾斜杠）也不算变更", () => {
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", model: "deepseek-chat" })).toBeNull();
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", temperature: 1.2 })).toBeNull();
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" })).toBeNull();
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "https://api.deepseek.com/v1/" })).toBeNull();
    expect(aiBaseUrlChangeError(stored, { id: "deepseek", baseUrl: "https://API.DeepSeek.com/v1" })).toBeNull(); // 主机大小写/默认端口不算变更
    // 还没有已存 Key（如首次配置）⇒ 不拦，避免误伤"先填地址再填 Key"的正常流程
    expect(aiBaseUrlChangeError({ ...stored, apiKey: undefined }, { id: "deepseek", baseUrl: "https://new.example/v1" })).toBeNull();
  });
});
