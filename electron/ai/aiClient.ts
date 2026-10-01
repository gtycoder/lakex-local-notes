import OpenAI from "openai";
import type { AiChatMessage, AiProviderConfig } from "../../src/core/aiProviders.js";

/**
 * 主进程 AI 网关（P0：OpenAI / OpenAI 兼容）。
 *
 * 红线：
 * - **唯一外部网络出口**：渲染层 CSP connect-src 只放行 self/本机，Key 只在本进程内存。
 * - 供应商可切换：调用方只给 AiProviderConfig（id/protocol/baseUrl/model/apiKey）；将来加一家只需在
 *   core 的 AI_PROVIDERS 里加一条 + 这里按 protocol 分支，IPC/渲染层不动。
 * - 可注入 factory：单测不碰网络（默认工厂才建官方 client）。
 */

/** 对话消息：单一来源在 core（主进程/渲染层共用）。 */
export type AiMessage = AiChatMessage;

export interface AiStreamArgs {
  model: string;
  messages: AiMessage[];
  temperature: number;
  signal?: AbortSignal;
}

/** 供应商适配的最小接口（P0 只有一种实现）。 */
export interface AiChatClient {
  streamChat(args: AiStreamArgs): AsyncIterable<string>;
  /** 连通性探测：一次极小的真实请求。 */
  ping(model: string): Promise<void>;
}
export type AiClientFactory = (provider: AiProviderConfig) => AiChatClient;

export function defaultAiClientFactory(provider: AiProviderConfig): AiChatClient {
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl });
  return {
    async *streamChat({ model, messages, temperature, signal }) {
      const stream = await client.chat.completions.create(
        { model, messages: messages as never, temperature, stream: true },
        { signal },
      );
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
    async ping(model) {
      // 最小真实请求：max_tokens=1，验证 key/baseUrl/model 三者都可用
      await client.chat.completions.create({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, temperature: 0 });
    },
  };
}

export interface AiChatOptions {
  provider: AiProviderConfig;
  messages: AiMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  factory?: AiClientFactory;
}

/** 流式对话：逐块回调，返回累计文本。 */
export async function aiChat({ provider, messages, signal, onDelta, factory = defaultAiClientFactory }: AiChatOptions): Promise<string> {
  const client = factory(provider);
  let text = "";
  for await (const delta of client.streamChat({ model: provider.model, messages, temperature: provider.temperature, signal })) {
    text += delta;
    onDelta?.(delta);
  }
  return text;
}

/** 连通性测试：成功返回 { ok:true }，失败返回归类后的中文原因。 */
export async function aiTestProvider(provider: AiProviderConfig, factory: AiClientFactory = defaultAiClientFactory): Promise<{ ok: boolean; error?: string }> {
  if (!provider.apiKey) return { ok: false, error: "未配置 API Key" };
  if (!provider.model) return { ok: false, error: "未配置模型" };
  try {
    await factory(provider).ping(provider.model);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: normalizeAiError(err) };
  }
}

/** 把供应商/网络错误归类成用户可读的中文（绝不泄露 Key）。 */
export function normalizeAiError(err: unknown): string {
  const e = (err ?? {}) as { status?: number; statusCode?: number; code?: string; name?: string; message?: string; error?: { message?: string } };
  const status = e.status ?? e.statusCode;
  const raw = e.message || e.error?.message || "";
  if (e.name === "AbortError" || e.code === "ABORT_ERR") return "已取消";
  if (status === 401) return "API Key 无效或已失效";
  if (status === 403) return "无权访问该模型";
  if (status === 404) return "模型不存在，或 Base URL 配置不对";
  if (status === 429) return "请求过于频繁或额度不足，请稍后再试";
  if (typeof status === "number" && status >= 500) return "供应商服务异常（" + status + "）";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|network/i.test(raw)) return "网络不可达：检查网络或 Base URL";
  if (raw) return raw.slice(0, 200);
  return "未知错误";
}
