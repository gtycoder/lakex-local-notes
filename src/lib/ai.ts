import { native } from "./native";
import type { AiChatMessage, AiChatResult, AiSettingsPatch, AiSettingsView, AiTestResult } from "../core/aiProviders";

/**
 * 渲染层 AI 服务：唯一入口是主进程（Key 不出主进程、CSP 也挡死渲染层外发）。
 * 调用方拿到 requestId 后可 aiCancel；流式 delta 经 onAiStream 按 requestId 过滤。
 */
export function newAiRequestId(): string {
  return "ai-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function loadAiSettings(): Promise<AiSettingsView> {
  return native.aiGetSettings();
}

export function saveAiSettings(patch: AiSettingsPatch): Promise<AiSettingsView> {
  return native.aiSaveSettings(patch);
}

export function testAiConnection(): Promise<AiTestResult> {
  return native.aiTestConnection();
}

export function cancelAiChat(requestId: string): Promise<void> {
  return native.aiCancel(requestId);
}

/** 流式对话：onDelta 只收本次 requestId 的增量；返回最终结果与累计文本。 */
export async function runAiChat(
  requestId: string,
  messages: AiChatMessage[],
  onDelta?: (delta: string) => void,
): Promise<AiChatResult> {
  const off = onDelta ? native.onAiStream((chunk) => { if (chunk.requestId === requestId) onDelta(chunk.delta); }) : null;
  try {
    return await native.aiChat(requestId, messages);
  } finally {
    off?.();
  }
}
