import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcInputError } from "../../src/core/ipcLimits.js";
import { normalizeAiSettings, type AiSettings } from "../../src/core/aiProviders.js";
import type { IpcRegistrar } from "./registrar.js";

/**
 * SEC-01 护栏：ai_test_connection / ai_list_models / ai_save_settings 三条路径都不得让
 * 「草稿只改 baseUrl、不带 apiKey」复用已存 Key —— 否则渲染层被控即等于可读主进程凭据。
 */
const aiClient = vi.hoisted(() => ({
  aiChat: vi.fn(),
  aiListModels: vi.fn(async () => ["m-1"]),
  aiTestProvider: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../ai/aiClient.js", () => aiClient);
vi.mock("../ai/aiContentResolver.js", () => ({ resolveAiMessages: vi.fn() }));

import { registerAiIpc } from "./registerAi.js";

type Handler = (...args: unknown[]) => unknown;

function harness(initial: AiSettings) {
  let settings = initial;
  const saved: AiSettings[] = [];
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map(),
  } as unknown as IpcRegistrar;
  const store = {
    getAiSettings: () => settings,
    saveAiSettings: (next: AiSettings) => { settings = next; saved.push(next); },
  } as unknown as Parameters<typeof registerAiIpc>[1];
  registerAiIpc(ipc, store);
  return {
    saved,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
    current: () => settings,
  };
}

function storedSettings(): AiSettings {
  return normalizeAiSettings({
    activeProviderId: "deepseek",
    providers: { deepseek: { apiKey: "sk-stored", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash" } },
  });
}

const CHANGED_URL = "https://attacker.example/v1";
const MUST_REKEY = "修改服务地址时必须重新填写 API Key";

beforeEach(() => { vi.clearAllMocks(); });

describe("SEC-01：草稿改 baseUrl 必须自带 Key", () => {
  it("ai_test_connection：换地址不带 Key ⇒ 拒绝，且绝不发起请求", async () => {
    const h = harness(storedSettings());
    const r = await h.call("ai_test_connection", { id: "deepseek", baseUrl: CHANGED_URL });
    expect(r).toEqual({ ok: false, error: MUST_REKEY });
    expect(aiClient.aiTestProvider).not.toHaveBeenCalled();
  });

  it("ai_list_models：换地址不带 Key ⇒ 拒绝（同一道门禁）", async () => {
    const h = harness(storedSettings());
    const r = await h.call("ai_list_models", { id: "deepseek", baseUrl: CHANGED_URL });
    expect(r).toEqual({ ok: false, error: MUST_REKEY });
    expect(aiClient.aiListModels).not.toHaveBeenCalled();
  });

  it("ai_test_connection：带 Key + 合法 https ⇒ 通过，且用的是新地址/新 Key", async () => {
    const h = harness(storedSettings());
    const r = await h.call("ai_test_connection", { id: "deepseek", baseUrl: CHANGED_URL, apiKey: "sk-new" });
    expect(r).toEqual({ ok: true });
    expect(aiClient.aiTestProvider).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: CHANGED_URL, apiKey: "sk-new" }));
  });

  it("http 非本地 ⇒ 即使带了 Key 也拒绝", async () => {
    const h = harness(storedSettings());
    const r = (await h.call("ai_test_connection", { id: "deepseek", baseUrl: "http://attacker.example/v1", apiKey: "sk-new" })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTPS/);
    expect(aiClient.aiTestProvider).not.toHaveBeenCalled();
  });
});

describe("SEC-01：ai_save_settings 同一道门禁", () => {
  it("改存 baseUrl 不带 Key ⇒ 抛 IpcInputError，设置不变", () => {
    const h = harness(storedSettings());
    const before = h.current();
    expect(() => h.call("ai_save_settings", { providers: [{ id: "deepseek", baseUrl: CHANGED_URL }] })).toThrowError(IpcInputError);
    expect(h.saved).toHaveLength(0);
    expect(h.current()).toBe(before);
  });

  it("只改 model/temperature（不带 baseUrl）⇒ 不受影响，已存 Key 与地址保留", () => {
    const h = harness(storedSettings());
    h.call("ai_save_settings", { providers: [{ id: "deepseek", model: "deepseek-chat", temperature: 1.1 }] });
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].providers.deepseek).toMatchObject({ model: "deepseek-chat", temperature: 1.1, apiKey: "sk-stored", baseUrl: "https://api.deepseek.com/v1" });
  });

  it("带 Key + 合法 https 改地址 ⇒ 保存通过", () => {
    const h = harness(storedSettings());
    h.call("ai_save_settings", { providers: [{ id: "deepseek", baseUrl: CHANGED_URL, apiKey: "sk-new" }] });
    expect(h.saved[0].providers.deepseek).toMatchObject({ baseUrl: CHANGED_URL, apiKey: "sk-new" });
  });

  it("ai_chat：存量配置的 baseUrl 非法 ⇒ 对话前拒绝且不发起请求（SEC-01 收尾）", async () => {
    // 模拟「A 批之前」已经存进设置的异常地址（当时还没有准入校验）。
    const bad = normalizeAiSettings({
      activeProviderId: "deepseek",
      providers: { deepseek: { apiKey: "sk-stored", baseUrl: "http://attacker.example/v1", model: "deepseek-flash" } },
    });
    const h = harness(bad);
    const event = { sender: { send: vi.fn() } };
    const r = (await h.call("ai_chat", event, "req-1", [])) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toContain("AI 服务地址无效");
    expect(aiClient.aiChat).not.toHaveBeenCalled();
  });
});
