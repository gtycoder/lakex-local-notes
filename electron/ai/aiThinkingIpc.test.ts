import { describe, expect, it, vi } from "vitest";

// registerAi 的 ai_chat 处理器调的就是这个函数：mock 掉它才能断言「第三参有没有透传到网关」。
vi.mock("./aiClient.js", () => ({
  aiChat: vi.fn(async () => "回复"),
  aiTestProvider: vi.fn(async () => ({ ok: true })),
  aiListModels: vi.fn(async () => []),
  defaultAiClientFactory: vi.fn(),
}));
// registerAi -> Store 的类型导入会带出 store.ts（secretCipher 的 safeStorage 分支），给最小 mock。
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: Buffer) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

import type { IpcMainInvokeEvent } from "electron";
import { aiChat } from "./aiClient.js";
import { registerAiIpc } from "../ipc/registerAi.js";
import type { IpcRegistrar } from "../ipc/registrar.js";
import type { Store } from "../store.js";
import { defaultAiProviderConfig, type AiSettings } from "../../src/core/aiProviders.js";

/**
 * IPC 接线：`ai_chat` 的第三参（AiChatRequestOptions）必须被 registerAi 解析并透传给网关。
 *
 * 为什么单独一个文件：AGENTS §7.6「IPC 三处同步」是仓库硬规则 —— preload 加了第三个参数、
 * 主进程 handler 忘了接，是最典型的「只在运行时才炸/静默不生效」缺陷（这里不会炸，只会静默无效果，
 * 更隐蔽）。本文件把「渲染层传 thinking → 网关收到 thinkingOverride」这条链钉死。
 */

interface Captured {
  channel: string;
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
}

function captureIpc(): { ipc: IpcRegistrar; events: Captured[] } {
  const events: Captured[] = [];
  const ipc = {
    handle: () => {},
    handleEvent: (channel: string, handler: Captured["handler"]) => { events.push({ channel, handler }); },
    registry: new Map(),
  } as unknown as IpcRegistrar;
  return { ipc, events };
}

function settingsFor(id: string, over: Record<string, unknown> = {}): AiSettings {
  const provider = { ...defaultAiProviderConfig(id), baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "test-model", ...over };
  return { version: 1, activeProviderId: id, providers: { [id]: provider } };
}

function fakeEvent(): IpcMainInvokeEvent {
  return { sender: { send: () => {} } } as unknown as IpcMainInvokeEvent;
}

async function invokeChat(settings: AiSettings, requestId: string, messages: unknown, options?: unknown) {
  const { ipc, events } = captureIpc();
  registerAiIpc(ipc, { getAiSettings: () => settings } as unknown as Store);
  const entry = events.find((e) => e.channel === "ai_chat");
  expect(entry, "必须注册 ai_chat 通道").toBeTruthy();
  const args = options === undefined ? [requestId, messages] : [requestId, messages, options];
  return { result: await entry?.handler(fakeEvent(), ...args), events };
}

describe("ai_chat IPC：请求级 thinking 覆盖的接线", () => {
  it("第三参 { thinking: 'disabled' } ⇒ 网关收到 thinkingOverride='disabled'", async () => {
    vi.mocked(aiChat).mockClear();
    const { result } = await invokeChat(settingsFor("deepseek"), "ai-1", [{ role: "user", content: "hi" }], { thinking: "disabled" });
    expect(result).toEqual({ ok: true, text: "回复" });
    expect(vi.mocked(aiChat).mock.calls[0][0]).toMatchObject({ thinkingOverride: "disabled" });
  });

  it("不传第三参 ⇒ thinkingOverride 为 undefined（不改变既有行为）", async () => {
    vi.mocked(aiChat).mockClear();
    await invokeChat(settingsFor("deepseek"), "ai-2", [{ role: "user", content: "hi" }]);
    expect(vi.mocked(aiChat).mock.calls[0][0].thinkingOverride).toBeUndefined();
  });

  it("第三参是坏值 ⇒ 视为不覆盖（不抛错，旧渲染层/脏输入照常工作）", async () => {
    for (const bad of ["disabled", 42, { thinking: "on" }, { thinking: 1 }, null, []]) {
      vi.mocked(aiChat).mockClear();
      const { result } = await invokeChat(settingsFor("deepseek"), "ai-3", [{ role: "user", content: "hi" }], bad);
      expect(result).toEqual({ ok: true, text: "回复" });
      expect(vi.mocked(aiChat).mock.calls[0][0].thinkingOverride, "坏值必须收敛成 undefined：" + JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("四层链路各自都透传（AGENTS §7.6：漏一层 = 开关静默无效）", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const root = path.resolve(__dirname, "..", "..");
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

    // ① 渲染层 API：runAiChat 第五参 → native.aiChat 第三参
    expect(read("src/lib/ai.ts")).toContain("native.aiChat(requestId, messages, options)");
    // ② native 封装 → preload 暴露面
    expect(read("src/lib/native.ts")).toContain("api().aiChat(requestId, messages, options)");
    // ③ preload → ipcRenderer.invoke（不传时只带两个参数，payload 与改动前一致）
    const preload = read("electron/preload.cjs");
    expect(preload).toContain("aiChat: (requestId, messages, options) => invoke(\"ai_chat\", requestId, messages");
    expect(preload).toContain("...(options === undefined ? [] : [options])");
    // ④ 主进程 handler：解析第三参并交给网关
    const registerAi = read("electron/ipc/registerAi.ts");
    expect(registerAi).toContain("parseThinkingOverride(requestOptions");
    expect(registerAi).toContain("thinkingOverride,");
  });

  it("处理器仍把激活供应商原样交给网关（没有为了开关改动 provider 解析）", async () => {
    vi.mocked(aiChat).mockClear();
    await invokeChat(settingsFor("openai"), "ai-4", [{ role: "user", content: "hi" }], { thinking: "enabled" });
    const call = vi.mocked(aiChat).mock.calls[0][0];
    expect(call.provider.id).toBe("openai");
    // 覆盖值照传（是否生效由 aiClient 的 resolveThinkingMode 决定，见 aiThinking.test.ts）
    expect(call.thinkingOverride).toBe("enabled");
  });
});
