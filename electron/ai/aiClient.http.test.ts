import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiChat } from "./aiClient.js";
import { aiErrorInfo } from "../../src/core/aiErrors.js";
import { defaultAiProviderConfig } from "../../src/core/aiProviders.js";

// 真实 HTTP 验证：起本地 OpenAI 兼容端点，走默认工厂（真实 openai SDK），
// 覆盖 401 / 429（重试一次）/ 500 / 正常 SSE 流 / 端口不可达。
let server: Server;
let port = 0;
let hits = 0;
let mode: "ok" | "401" | "429" | "500" = "ok";

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits += 1;
    if (mode !== "ok") {
      const status = Number(mode);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: mode === "401" ? "Incorrect API key provided" : "boom", code: mode === "429" ? "rate_limit_exceeded" : "err" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "你" } }] }) + "\n\n");
    res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "好" } }] }) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const provider = () => ({ ...defaultAiProviderConfig("custom"), baseUrl: "http://127.0.0.1:" + port + "/v1", model: "test-model", apiKey: "sk-test" });

describe("真实 SDK × 本地端点", () => {
  it("正常流式：分块回调且累计正确", async () => {
    mode = "ok"; hits = 0;
    const seen: string[] = [];
    const text = await aiChat({ provider: provider(), messages: [{ role: "user", content: "hi" }], onDelta: (d) => seen.push(d) });
    expect(text).toBe("你好");
    expect(seen.join("")).toBe("你好");
    expect(hits).toBe(1);
  });

  it("401：归类为 API Key 无效（不重试）", async () => {
    mode = "401"; hits = 0;
    const err = await aiChat({ provider: provider(), messages: [{ role: "user", content: "hi" }] }).then(() => null, (e: unknown) => e);
    expect(aiErrorInfo(err).message).toBe("API Key 无效或已失效");
    expect(hits).toBe(1);
  });

  it("429：重试一次后仍失败，最终归类为限流", async () => {
    mode = "429"; hits = 0;
    const err = await aiChat({ provider: provider(), messages: [{ role: "user", content: "hi" }] }).then(() => null, (e: unknown) => e);
    expect(aiErrorInfo(err).kind).toBe("rate_limit");
    expect(hits).toBe(2);
  });

  it("500：重试一次后仍失败，文案带状态码", async () => {
    mode = "500"; hits = 0;
    const err = await aiChat({ provider: provider(), messages: [{ role: "user", content: "hi" }] }).then(() => null, (e: unknown) => e);
    expect(aiErrorInfo(err).message).toContain("500");
    expect(hits).toBe(2);
  });

  it("端口不可达：归类为网络不可达", async () => {
    const dead = { ...defaultAiProviderConfig("custom"), baseUrl: "http://127.0.0.1:1/v1", model: "m", apiKey: "sk-test" };
    const err = await aiChat({ provider: dead, messages: [{ role: "user", content: "hi" }] }).then(() => null, (e: unknown) => e);
    expect(aiErrorInfo(err).message).toContain("网络不可达");
  });
});
