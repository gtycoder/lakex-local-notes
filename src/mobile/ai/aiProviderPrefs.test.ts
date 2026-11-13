// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { aiProviderPreset, inferAiProviderId, readAiProviderId, writeAiProviderId } from "./aiProviderPrefs";

beforeEach(() => localStorage.clear());

describe("移动端 AI 供应商本机偏好（261114）", () => {
  it("按已保存 baseUrl 反推供应商（忽略协议大小写/尾部斜杠）", () => {
    expect(inferAiProviderId("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(inferAiProviderId("https://api.deepseek.com/v1/")).toBe("deepseek");
    expect(inferAiProviderId("  https://API.DeepSeek.com/v1  ")).toBe("deepseek");
    expect(inferAiProviderId("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe("qwen");
    expect(inferAiProviderId("https://my-proxy.example.com/v1")).toBeNull();
    expect(inferAiProviderId("")).toBeNull();
  });

  it("本机选择可读写；未知 id 视为未设置", () => {
    expect(readAiProviderId()).toBeNull();
    writeAiProviderId("qwen");
    expect(readAiProviderId()).toBe("qwen");
    localStorage.setItem("lakex-local-notes-mobile.ai.provider", "not-a-provider");
    expect(readAiProviderId()).toBeNull();
  });

  it("供应商默认值：思考参数只在该家支持时给出", () => {
    const deepseek = aiProviderPreset("deepseek");
    expect(deepseek.baseUrl).toContain("deepseek");
    expect(deepseek.reasoningEffort).toBe("high");
    expect(deepseek.thinking).toBe("enabled");
    const qwen = aiProviderPreset("qwen");
    expect(qwen.baseUrl).toContain("dashscope");
    expect(qwen.reasoningEffort).toBe("");
    expect(qwen.thinking).toBe("");
    const custom = aiProviderPreset("custom");
    expect(custom.model).toBe("");
  });
});
