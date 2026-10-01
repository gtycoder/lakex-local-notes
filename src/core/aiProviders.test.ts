import { describe, expect, it } from "vitest";
import {
  AI_PROVIDERS, aiSettingsReady, aiSettingsView, defaultAiSettings, mergeAiSettings, normalizeAiSettings,
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
    expect(s.providers.deepseek.model).toBe("deepseek-chat");
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
