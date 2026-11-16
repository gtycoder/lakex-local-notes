import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aiChat, type AiClientFactory, type AiStreamArgs } from "./aiClient.js";
import { aiProviderSupportsThinking, parseThinkingOverride, resolveThinkingMode } from "./aiThinking.js";
import { defaultAiProviderConfig, type AiProviderConfig } from "../../src/core/aiProviders.js";

/**
 * 「深度思考」请求级开关（261116 用户裁决：从强制开启改成可开关）。
 *
 * 覆盖三类事实（对应任务要求的三种情况）：
 * 1. 支持 thinking 的供应商（deepseek）+ 传 disabled ⇒ **真实请求体** thinking.type = "disabled"；
 * 2. 不支持的供应商（openai/custom…）+ 传 override ⇒ 忽略，**不伪造** thinking 参数；
 * 3. 不传 ⇒ 与改动前逐字节一致（既断言发给 client 的参数，也比对真实 HTTP 请求体的原始字节）。
 *
 * 另加：设置里的 provider.thinking 仍然生效（没有被请求级开关吞掉）。
 * IPC 接线（registerAi 是否把第三参透传下来）见 ./aiThinkingIpc.test.ts。
 */

function providerOf(id: string, over: Partial<AiProviderConfig> = {}): AiProviderConfig {
  // deepseek = 唯一 supportsThinking 的预设；openai = supportsReasoning 但不 supportsThinking。
  return { ...defaultAiProviderConfig(id), model: "test-model", apiKey: "sk-test", ...over };
}

/** 捕获 streamChat 实参的假 client（不碰网络）。 */
function captureFactory(): { factory: AiClientFactory; calls: AiStreamArgs[] } {
  const calls: AiStreamArgs[] = [];
  const factory: AiClientFactory = () => ({
    async *streamChat(args) {
      calls.push(args);
      yield { content: "ok" };
    },
    async ping() {},
    async listModels() {
      return [];
    },
  });
  return { factory, calls };
}

describe("判据：provider 能力 + 覆盖解析（纯函数）", () => {
  it("只有 deepseek 声明 supportsThinking", () => {
    expect(aiProviderSupportsThinking(providerOf("deepseek"))).toBe(true);
    for (const id of ["openai", "qwen", "zhipu", "mimo", "custom"]) {
      expect(aiProviderSupportsThinking(providerOf(id)), id + " 不应支持 thinking").toBe(false);
    }
  });

  it("parseThinkingOverride：合法枚举放行，其余一律 undefined（不抛错）", () => {
    expect(parseThinkingOverride({ thinking: "disabled" })).toBe("disabled");
    expect(parseThinkingOverride({ thinking: "enabled" })).toBe("enabled");
    for (const bad of [undefined, null, "disabled", 42, {}, { thinking: 1 }, { thinking: "on" }, { thinking: "" }, []]) {
      expect(parseThinkingOverride(bad), "坏输入应视为「不覆盖」：" + JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("resolveThinkingMode：不传 = provider 现值；支持才生效；不支持则忽略", () => {
    const deepseek = providerOf("deepseek");
    expect(deepseek.thinking, "预设默认开启，这是改动前的基线").toBe("enabled");
    expect(resolveThinkingMode(deepseek)).toBe("enabled");
    expect(resolveThinkingMode(deepseek, undefined)).toBe("enabled");
    expect(resolveThinkingMode(deepseek, "disabled")).toBe("disabled");
    expect(resolveThinkingMode(deepseek, "enabled")).toBe("enabled");

    const openai = providerOf("openai");
    expect(openai.thinking).toBeUndefined();
    expect(resolveThinkingMode(openai, "disabled"), "不支持 ⇒ 忽略，仍发 undefined（不伪造参数）").toBeUndefined();
    // 历史脏设置：不支持的供应商被写入了 thinking。覆盖仍应被忽略（保持现值），且不新增参数。
    const dirty = { ...openai, thinking: "enabled" as const };
    expect(resolveThinkingMode(dirty, "disabled")).toBe("enabled");
  });
});

describe("网关：aiChat 把生效值传给 client（不碰网络）", () => {
  it("deepseek + disabled ⇒ client 收到 thinking=disabled，reasoningEffort 语义不变", async () => {
    const deepseek = providerOf("deepseek");
    const { factory, calls } = captureFactory();
    await aiChat({ provider: deepseek, messages: [{ role: "user", content: "hi" }], thinkingOverride: "disabled", factory });
    expect(calls).toHaveLength(1);
    expect(calls[0].thinking).toBe("disabled");
    expect(calls[0].reasoningEffort).toBe(deepseek.reasoningEffort);
    expect(calls[0].reasoningEffort).toBe("high");
  });

  it("openai + override ⇒ client 收到 thinking=undefined（忽略而非伪造）", async () => {
    const { factory, calls } = captureFactory();
    await aiChat({ provider: providerOf("openai"), messages: [{ role: "user", content: "hi" }], thinkingOverride: "disabled", factory });
    expect(calls[0].thinking).toBeUndefined();
    expect("thinking" in calls[0]).toBe(true); // 键存在但值是 undefined ⇒ 默认工厂不会加进 body
  });

  it("不传 override ⇒ client 实参与本改动前完全一致（thinking = provider.thinking）", async () => {
    for (const id of ["deepseek", "openai"]) {
      const provider = providerOf(id);
      const { factory, calls } = captureFactory();
      await aiChat({ provider, messages: [{ role: "user", content: "hi" }], factory });
      const { factory: factory2, calls: calls2 } = captureFactory();
      await aiChat({ provider, messages: [{ role: "user", content: "hi" }], thinkingOverride: undefined, factory: factory2 });
      expect(calls[0]).toEqual(calls2[0]);
      expect(calls[0].thinking).toBe(provider.thinking);
    }
  });
});

describe("真实请求体：本地 OpenAI 兼容端点抓原始 body", () => {
  let server: Server;
  let port = 0;
  const bodies: { raw: string; json: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        bodies.push({ raw, json: JSON.parse(raw || "{}") as Record<string, unknown> });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }) + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const local = (id: string, over: Partial<AiProviderConfig> = {}): AiProviderConfig =>
    providerOf(id, { baseUrl: "http://127.0.0.1:" + port + "/v1", ...over });
  const lastBody = () => bodies[bodies.length - 1];

  it("支持 thinking 的供应商 + disabled ⇒ 请求体里是 thinking: { type: 'disabled' }", async () => {
    await aiChat({ provider: local("deepseek"), messages: [{ role: "user", content: "hi" }], thinkingOverride: "disabled" });
    const body = lastBody().json as { thinking?: { type: string }; reasoning_effort?: string };
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort, "reasoningEffort 语义不变").toBe("high");
  });

  it("支持 thinking 的供应商 + enabled ⇒ thinking: { type: 'enabled' }（开关两向都生效）", async () => {
    await aiChat({ provider: local("deepseek"), messages: [{ role: "user", content: "hi" }], thinkingOverride: "enabled" });
    expect((lastBody().json as { thinking?: { type: string } }).thinking).toEqual({ type: "enabled" });
  });

  it("不支持的供应商 + override ⇒ 请求体**没有** thinking 键（不伪造参数）；reasoning 语义不变", async () => {
    await aiChat({ provider: local("openai"), messages: [{ role: "user", content: "hi" }], thinkingOverride: "disabled" });
    const body = lastBody().json;
    expect("thinking" in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream", "temperature"]);
  });

  it("不传 ⇒ 请求体与改动前逐字节一致（与显式 undefined 的原始字节相等，且等于既有基线对象）", async () => {
    // ① 不传
    await aiChat({ provider: local("deepseek"), messages: [{ role: "user", content: "hi" }] });
    const omitted = lastBody();
    // ② 显式 undefined（UI 可能原样透传）
    await aiChat({ provider: local("deepseek"), messages: [{ role: "user", content: "hi" }], thinkingOverride: undefined });
    const explicit = lastBody();
    expect(omitted.raw, "不传与显式 undefined 必须产生同一个请求体").toBe(explicit.raw);
    // ③ 与「改动前的 body 形状」逐字段相同（改动前就是把 provider.thinking 原样发出去）
    expect(omitted.json).toEqual({
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      stream: true,
      reasoning_effort: "high",
      thinking: { type: "enabled" },
    });
  });

  it("设置里的 provider.thinking 仍然生效（请求级开关没有吞掉设置值）", async () => {
    await aiChat({ provider: local("deepseek", { thinking: "disabled" }), messages: [{ role: "user", content: "hi" }] });
    expect((lastBody().json as { thinking?: { type: string } }).thinking).toEqual({ type: "disabled" });
  });
});
