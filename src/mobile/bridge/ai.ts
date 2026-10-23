/**
 * AI 域（bridge，261023 P0）：设置读写 / 连通性 / 流式对话 / 取消。
 *
 * 归属：T1（移动端 AI 页直接调用）+ T3（登记在 lakeNativeContract 的调试契约里）。
 * Key 只在原生；这里所有返回值都不含明文 Key。
 */
import {
  AiChat,
  aiChatSupported,
  type AiChatRequest,
  type AiChatResult,
  type AiChatSettingsPatch,
  type AiChatSettingsView,
  type AiTestResult,
} from "../native/aiChat";
import { ensureDb } from "./context";
import * as noteRepository from "../data/noteRepository.js";
import { readNoteBody } from "../data/noteBodies.js";
import { lakeHtmlToPlain } from "../../core/lakeCaches.js";

/** 浏览器预览/单元测试里的占位设置（不触网）。 */
export const AI_SETTINGS_FALLBACK: AiChatSettingsView = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  temperature: 0.7,
  reasoningEffort: null,
  thinking: null,
  hasKey: false,
  keyTail: "",
};

const UNSUPPORTED_CHAT: AiChatResult = {
  ok: false,
  code: "unavailable",
  detail: "当前平台不支持 AI 通道（需 Android 真机/模拟器）",
};

export const aiDomain = {
  /** 读设置（无明文 Key）。 */
  async aiGetSettings(): Promise<AiChatSettingsView> {
    if (!aiChatSupported()) return AI_SETTINGS_FALLBACK;
    return AiChat.getSettings();
  },

  /** 存设置补丁；传 apiKey 才覆盖（空串 = 清除）。 */
  async aiSaveSettings(patch: AiChatSettingsPatch): Promise<{ ok: boolean }> {
    if (!aiChatSupported()) throw new Error("当前平台不支持 AI 通道（需 Android 真机/模拟器）");
    return AiChat.saveSettings(patch);
  },

  /** 连通性测试（一次极小的真实请求）。 */
  async aiTestConnection(): Promise<AiTestResult> {
    if (!aiChatSupported()) return { ok: false, code: "unavailable", detail: "当前平台不支持 AI 通道" };
    return AiChat.testConnection();
  },

  /** 读一篇文档的纯文本（资料集用；只允许 Lake 文档，其它类型返回 null）。 */
  async aiReadDocText(noteId: string): Promise<{ id: string; title: string; text: string; totalChars: number } | null> {
    const d = await ensureDb();
    const note = await noteRepository.readNote(d, noteId);
    if (!note || note.kind !== "doc") return null;
    const body = note.content || (await readNoteBody(note.kind, note.id)) || "";
    const text = lakeHtmlToPlain(body);
    return { id: note.id, title: note.title, text, totalChars: text.length };
  },

  /** 流式对话：事件走 native 的 ai:delta/ai:error/ai:done（见 native/aiChat.onAiStream）。 */
  async aiChat(request: AiChatRequest): Promise<AiChatResult> {
    if (!aiChatSupported()) return UNSUPPORTED_CHAT;
    return AiChat.chat(request);
  },

  /** 取消（幂等；按 requestId）。 */
  async aiCancel(requestId: string): Promise<{ ok: boolean }> {
    if (!aiChatSupported()) return { ok: false };
    return AiChat.cancel(requestId);
  },
};
