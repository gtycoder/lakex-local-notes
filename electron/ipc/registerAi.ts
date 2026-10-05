import type { IpcMainInvokeEvent } from "electron";
import type { IpcRegistrar } from "./registrar.js";
import { Store } from "../store.js";
import { aiChat, aiListModels, aiTestProvider } from "../ai/aiClient.js";
import { assertMessages } from "../ai/aiChatMessages.js";
import { activeAiProvider, aiSettingsView, mergeAiSettings, type AiProviderPatch, type AiSettings, type AiSettingsPatch } from "../../src/core/aiProviders.js";
import { aiErrorInfo, aiErrorMessage } from "../../src/core/aiErrors.js";

/**
 * AI IPC（P0）：设置读写 / 连通性测试 / 流式对话 / 取消。
 *
 * 红线：
 * - 供应商调用只在主进程（渲染层 CSP 挡死外发）；Key 绝不出主进程，设置视图是脱敏的。
 * - 参数设上限（防超长/超多消息），坏输入抛 AppError(InvalidInput) 由 registrar 统一编码。
 * - 流式经 ai:stream 事件推给发起窗口；HTTP 调用方（webApiServer 的 stub event）自动变 no-op。
 */

/** 草稿（未保存值）叠加到当前配置上做测试/拉列表：未给的字段沿用已存值（包括 Key）。 */
function resolveDraftProvider(settings: AiSettings, draft: unknown) {
  const d = (draft && typeof draft === "object" ? draft : {}) as AiProviderPatch;
  const id = typeof d.id === "string" && d.id ? d.id : settings.activeProviderId;
  const merged = mergeAiSettings(settings, { providers: [{ ...d, id }] });
  return merged.providers[id] ?? null;
}

export function registerAiIpc(ipc: IpcRegistrar, store: Store): void {
  const inflight = new Map<string, AbortController>();

  ipc.handle("ai_get_settings", () => aiSettingsView(store.getAiSettings()));

  ipc.handle("ai_save_settings", (patch: unknown) => {
    const merged = mergeAiSettings(store.getAiSettings(), (patch && typeof patch === "object" ? patch : {}) as AiSettingsPatch);
    store.saveAiSettings(merged);
    return aiSettingsView(merged);
  });

  // 连通测试：可传**未保存的草稿**（baseUrl/model/apiKey/高级项），未给的字段沿用已存值。
  // 返回 retryable 让渲染层实现"分级保存"：鉴权/模型类错误硬拦，网络/限流允许用户仍要保存。
  ipc.handle("ai_test_connection", async (draft: unknown) => {
    const provider = resolveDraftProvider(store.getAiSettings(), draft);
    if (!provider) return { ok: false, error: "未配置供应商" };
    return aiTestProvider(provider);
  });

  // 模型列表：OpenAI 兼容 GET /models；端点不实现时返回 ok:false（渲染层回落手填）。
  ipc.handle("ai_list_models", async (draft: unknown) => {
    const provider = resolveDraftProvider(store.getAiSettings(), draft);
    if (!provider) return { ok: false, error: "未配置供应商" };
    if (!provider.apiKey) return { ok: false, error: "未配置 API Key" };
    if (!provider.baseUrl) return { ok: false, error: "未配置 Base URL" };
    try {
      return { ok: true, models: await aiListModels(provider) };
    } catch (err) {
      const info = aiErrorInfo(err);
      return { ok: false, error: info.message, retryable: info.retryable };
    }
  });

  ipc.handleEvent("ai_chat", async (event: IpcMainInvokeEvent, requestId: unknown, messages: unknown) => {
    const id = typeof requestId === "string" && requestId ? requestId : "ai-" + Date.now();
    const provider = activeAiProvider(store.getAiSettings());
    if (!provider || !provider.apiKey || !provider.model) return { ok: false, error: "尚未配置 AI 供应商（设置 - AI）" };
    const controller = new AbortController();
    inflight.set(id, controller);
    try {
      const text = await aiChat({
        provider,
        messages: assertMessages(messages),
        signal: controller.signal,
        onDelta: (delta) => { try { event.sender.send("ai:stream", { requestId: id, delta }); } catch { /* 窗口已关 */ } },
      });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: aiErrorMessage(err) };
    } finally {
      inflight.delete(id);
    }
  });

  ipc.handle("ai_cancel", (requestId: unknown) => {
    if (typeof requestId === "string") inflight.get(requestId)?.abort();
  });
}
