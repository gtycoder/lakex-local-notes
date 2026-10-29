import { native } from "./native";
import { loadAiEnabled } from "./aiEnabled";
import type { AiChatMessage, AiChatResult, AiListModelsResult, AiProviderPatch, AiSettingsPatch, AiSettingsView, AiTestResult } from "../core/aiProviders";

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

export function testAiConnection(draft?: AiProviderPatch): Promise<AiTestResult> {
  return native.aiTestConnection(draft);
}

/** 拉取模型列表（草稿同上）：端点不实现时 ok:false，调用方回落手填。 */
export function listAiModels(draft?: AiProviderPatch): Promise<AiListModelsResult> {
  return native.aiListModels(draft);
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
  // 总开关：关闭时**任何路径都不出网**（与「关闭云同步 = 完全没配置」同语义；配置与 Key 保留）。
  if (!loadAiEnabled()) {
    throw new Error("AI 助手已关闭：到「设置 → AI 助手 → 连通性」重新开启后再试。");
  }
  const off = onDelta ? native.onAiStream((chunk) => { if (chunk.requestId === requestId) onDelta(chunk.delta); }) : null;
  try {
    return await native.aiChat(requestId, messages);
  } finally {
    off?.();
  }
}
