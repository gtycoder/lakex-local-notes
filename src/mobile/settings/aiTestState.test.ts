import { describe, expect, it } from "vitest";
import {
  aiConnectionFingerprint,
  getVerifiedAiFingerprint,
  invalidateAiConnectionVerified,
  markAiConnectionVerified,
} from "./aiTestState";

const base = { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", hasKey: true, keyTail: "…abcd" };

describe("aiConnectionFingerprint", () => {
  it("只由连接相关字段决定，与温度等无关（同一份配置 = 同一枚指纹）", () => {
    expect(aiConnectionFingerprint(base)).toBe(aiConnectionFingerprint({ ...base }));
  });

  it("改 Base URL / 模型 / Key 存在性 / Key 尾号都会换指纹", () => {
    const fp = aiConnectionFingerprint(base);
    expect(aiConnectionFingerprint({ ...base, baseUrl: "https://api.openai.com/v1" })).not.toBe(fp);
    expect(aiConnectionFingerprint({ ...base, model: "deepseek-reasoner" })).not.toBe(fp);
    expect(aiConnectionFingerprint({ ...base, hasKey: false })).not.toBe(fp);
    expect(aiConnectionFingerprint({ ...base, keyTail: "…efgh" })).not.toBe(fp);
  });

  it("首尾空白被归一（表单多打空格不至于让测试结果失效）", () => {
    expect(aiConnectionFingerprint({ ...base, baseUrl: "  https://api.deepseek.com/v1  " }))
      .toBe(aiConnectionFingerprint(base));
  });

  it("指纹不含 Key 明文（只拼已有信息）", () => {
    const fp = aiConnectionFingerprint(base);
    expect(fp).not.toContain("sk-");
    expect(fp).toContain("…abcd");
  });
});

describe("已验证状态缓存", () => {
  it("记住 / 读取 / 失效", () => {
    invalidateAiConnectionVerified();
    expect(getVerifiedAiFingerprint()).toBeNull();
    markAiConnectionVerified("fp-1");
    expect(getVerifiedAiFingerprint()).toBe("fp-1");
    invalidateAiConnectionVerified();
    expect(getVerifiedAiFingerprint()).toBeNull();
  });
});
