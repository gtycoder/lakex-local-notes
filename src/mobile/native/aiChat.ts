/**
 * 原生 AI 通道（Kotlin `AiChatPlugin`，261023 P0）。
 *
 * 为什么走原生：移动端没有主进程，而 API Key 不能进 WebView 存储/内存；
 * 由原生持有 Key（Android Keystore）并发起 SSE 流式请求，WebView 只收发对话内容。
 * 对应桌面 `electron/ai/aiClient.ts` 的角色（但只做 chat，不做多模态）。
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export type AiReasoningEffort = "low" | "high" | "max";
export type AiThinkingMode = "enabled" | "disabled";

/** 设置视图：**永不包含明文 Key**（只给尾号）。 */
export interface AiChatSettingsView {
  baseUrl: string;
  model: string;
  temperature: number;
  reasoningEffort: AiReasoningEffort | null;
  thinking: AiThinkingMode | null;
  hasKey: boolean;
  /** 形如 `sk-****1234`；未配置时为空串。 */
  keyTail: string;
}

/** 保存补丁：传 `apiKey` 才会覆盖（空串 = 清除）。 */
export interface AiChatSettingsPatch {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
  reasoningEffort?: AiReasoningEffort | null;
  thinking?: AiThinkingMode | null;
}

export type AiRequestPart =
  | { type: "text"; text: string }
  /** 资料/笔记里的图片引用（原生读文件，字节不过 WebView）。 */
  | { type: "image"; asset: { noteId: string; filename: string } }
  /** 拍照/相册的临时图片（已压缩为 data URL；本轮临时，不落笔记资源）。 */
  | { type: "image"; dataUrl: string };

export interface AiChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string | AiRequestPart[];
}

export interface AiChatRequest {
  requestId: string;
  messages: AiChatMessageInput[];
  /** 覆盖设置里的模型/温度（本会话内应保持不变，否则缓存失效）。 */
  model?: string;
  temperature?: number;
}

export interface AiChatResult {
  ok: boolean;
  text?: string;
  /** 稳定错误码（见 `src/core/aiErrors.ts` 的 KIND_BY_CODE）。 */
  code?: string;
  status?: number;
  detail?: string;
  cancelled?: boolean;
}

export interface AiStreamEvent { requestId: string; delta: string }
export interface AiErrorEvent { requestId: string; code: string; status?: number; detail?: string }
export interface AiDoneEvent { requestId: string; finishReason?: string }

export interface AiTestResult { ok: boolean; code?: string; status?: number; detail?: string }

interface AiChatPluginApi {
  getSettings(): Promise<AiChatSettingsView>;
  saveSettings(patch: AiChatSettingsPatch): Promise<{ ok: boolean }>;
  testConnection(): Promise<AiTestResult>;
  chat(request: AiChatRequest): Promise<AiChatResult>;
  cancel(requestId: string): Promise<{ ok: boolean }>;
  addListener(eventName: "ai:delta", listener: (event: AiStreamEvent) => void): Promise<{ remove(): Promise<void> }>;
  addListener(eventName: "ai:error", listener: (event: AiErrorEvent) => void): Promise<{ remove(): Promise<void> }>;
  addListener(eventName: "ai:done", listener: (event: AiDoneEvent) => void): Promise<{ remove(): Promise<void> }>;
}

export const AiChat = registerPlugin<AiChatPluginApi>("AiChat");

/** 原生通道是否可用（仅 Android 真机/模拟器；浏览器预览不可用）。 */
export function aiChatSupported(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("AiChat");
  } catch {
    return false;
  }
}

export interface AiStreamHandlers {
  onDelta?: (event: AiStreamEvent) => void;
  onError?: (event: AiErrorEvent) => void;
  onDone?: (event: AiDoneEvent) => void;
}

/** 订阅流式事件；返回同步的退订函数（卸载时立即生效，内部 await 后移除）。 */
export function onAiStream(handlers: AiStreamHandlers): () => void {
  let disposed = false;
  const handles: Array<{ remove(): Promise<void> }> = [];
  const attach = async (): Promise<void> => {
    try {
      handles.push(await AiChat.addListener("ai:delta", (event) => { if (!disposed) handlers.onDelta?.(event); }));
      handles.push(await AiChat.addListener("ai:error", (event) => { if (!disposed) handlers.onError?.(event); }));
      handles.push(await AiChat.addListener("ai:done", (event) => { if (!disposed) handlers.onDone?.(event); }));
    } catch {
      // 插件不可用（浏览器预览）：静默，调用方会拿到 aiChat 的 unavailable
    }
  };
  void attach();
  return () => {
    disposed = true;
    for (const handle of handles) void handle.remove().catch(() => undefined);
  };
}
