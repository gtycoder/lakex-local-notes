import OpenAI from "openai";
import type { AiChatMessage, AiProviderConfig } from "../../src/core/aiProviders.js";
import { aiErrorMessage } from "../../src/core/aiErrors.js";

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
  // maxRetries 交给 SDK（它懂指数退避与 retry-after）；我们只把它调到 1 次，避免默认 2 次叠上我们的重试。
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl, maxRetries: 1 });
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
  // 重试由 client 一侧负责（默认工厂已给 SDK maxRetries:1）；这里再重试会造成双重重试与重复输出。
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

/** 兼容旧调用点：错误分类已抽到 `src/core/aiErrors.ts`（纯函数 + 单测）。 */
export const normalizeAiError = aiErrorMessage;
