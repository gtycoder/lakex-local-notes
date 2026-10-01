/**
 * AI 供应商目录与设置模型（纯函数，无 node/electron 依赖）。
 *
 * 定位：桌面（Electron 主进程）与将来的移动端共用同一份事实来源——"有哪些供应商、默认值是什么、
 * 配置怎么规整/脱敏"。P0 只内置 OpenAI，但数据结构按**多供应商可切换**设计：新增一家 = 在
 * AI_PROVIDERS 加一条（+ 设置页下拉自动出现），不动 IPC / 渲染层 / 存储。
 *
 * 红线：本模块只描述配置形状，**不接触密钥与网络**；apiKey 的加密与服务调用只在主进程。
 * 密钥**绝不**进入同步/S3/备份（单独 settings key，且不从任何导出路径读取）。
 */

/** 协议：P0 只实现 openai-compatible（DeepSeek / Ollama / OneAPI / vLLM 都属这一类）。 */
export type AiProtocol = "openai-compatible";

/** 思考强度（DeepSeek 官方参数 `reasoning_effort`；OpenAI o 系列同义）。 */
export type AiReasoningEffort = "low" | "high" | "max";
/** 思考模式开关（DeepSeek 的 `thinking: {type}`）。 */
export type AiThinkingMode = "enabled" | "disabled";
export const AI_REASONING_EFFORTS: readonly AiReasoningEffort[] = ["low", "high", "max"];
export const AI_THINKING_MODES: readonly AiThinkingMode[] = ["enabled", "disabled"];

export interface AiProviderDef {
  id: string;
  label: string;
  protocol: AiProtocol;
  defaultBaseUrl: string;
  defaultModel: string;
  /** 允许用户改 Base URL（现在一律可改，预填默认值 + 可一键恢复）。 */
  editableBaseUrl?: boolean;
  /** 模型候选（空 = 纯手填）。 */
  models?: string[];
  defaultTemperature?: number;
  /** 该家是否支持「思考强度」（reasoning_effort）。 */
  supportsReasoning?: boolean;
  /** 该家是否支持「思考模式」开关（DeepSeek 的 thinking）。 */
  supportsThinking?: boolean;
  defaultReasoningEffort?: AiReasoningEffort;
  /** 模型列表接口路径（OpenAI 兼容默认 `/models`；不支持的端点拉取会失败并回落手填）。 */
  modelsPath?: string;
}

export const AI_PROVIDERS: readonly AiProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    editableBaseUrl: true,
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
    defaultTemperature: 0.7,
    supportsReasoning: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    editableBaseUrl: true,
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultTemperature: 0.7,
    // DeepSeek：思考模式默认开启、effort 默认 high；思考模式下 temperature 会被忽略（官方文档）。
    supportsReasoning: true,
    supportsThinking: true,
    defaultReasoningEffort: "high",
  },
  {
    id: "custom",
    label: "自定义（OpenAI 兼容）",
    protocol: "openai-compatible",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "",
    editableBaseUrl: true,
    models: [],
    defaultTemperature: 0.7,
  },
];

export const DEFAULT_AI_PROVIDER_ID = AI_PROVIDERS[0].id;
const DEFAULT_TEMPERATURE = 0.7;

export function aiProviderDef(id: string): AiProviderDef | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

/** 单个供应商的**完整**配置。apiKey 在主进程内存里是明文，落盘走 SecretCipher，渲染层只拿 hasApiKey。 */
export interface AiProviderConfig {
  id: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  /** 仅在 supportsReasoning 的供应商上发送。 */
  reasoningEffort?: AiReasoningEffort;
  /** 仅在 supportsThinking 的供应商上发送。 */
  thinking?: AiThinkingMode;
}

export interface AiSettings {
  version: 1;
  activeProviderId: string;
  providers: Record<string, AiProviderConfig>;
}

/** 渲染层可见的脱敏视图（**绝不含 apiKey**）。 */
export interface AiProviderView {
  id: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  temperature: number;
  reasoningEffort?: AiReasoningEffort;
  thinking?: AiThinkingMode;
  hasApiKey: boolean;
}
export interface AiSettingsView {
  version: 1;
  activeProviderId: string;
  providers: AiProviderView[];
}

/** 渲染层提交的设置补丁：apiKey 省略/空串 = 沿用已存的；clearApiKey 才清除。 */
export interface AiProviderPatch {
  id: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  reasoningEffort?: AiReasoningEffort;
  thinking?: AiThinkingMode;
  apiKey?: string;
  clearApiKey?: boolean;
}
export interface AiSettingsPatch {
  activeProviderId?: string;
  providers?: AiProviderPatch[];
}

export function defaultAiProviderConfig(id: string = DEFAULT_AI_PROVIDER_ID): AiProviderConfig {
  const def = aiProviderDef(id) ?? AI_PROVIDERS[0];
  return {
    id: def.id,
    protocol: def.protocol,
    baseUrl: def.defaultBaseUrl,
    model: def.defaultModel,
    temperature: def.defaultTemperature ?? DEFAULT_TEMPERATURE,
    reasoningEffort: def.supportsReasoning ? def.defaultReasoningEffort : undefined,
    thinking: def.supportsThinking ? "enabled" : undefined,
  };
}

export function defaultAiSettings(): AiSettings {
  return {
    version: 1,
    activeProviderId: DEFAULT_AI_PROVIDER_ID,
    providers: { [DEFAULT_AI_PROVIDER_ID]: defaultAiProviderConfig(DEFAULT_AI_PROVIDER_ID) },
  };
}

function asTrimmed(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function asEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
function clampTemperature(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(2, Math.max(0, n));
}

/** 把落盘/渲染层回传的原始对象规整成合法 AiSettings（坏字段回落默认，绝不抛）。 */
export function normalizeAiSettings(raw: unknown): AiSettings {
  const def = defaultAiSettings();
  if (!raw || typeof raw !== "object") return def;
  const obj = raw as Record<string, unknown>;
  const providersRaw = (obj.providers && typeof obj.providers === "object" ? obj.providers : {}) as Record<string, unknown>;
  const providers: Record<string, AiProviderConfig> = {};
  for (const [id, value] of Object.entries(providersRaw)) {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const fallback = aiProviderDef(id) ? defaultAiProviderConfig(id) : defaultAiProviderConfig(DEFAULT_AI_PROVIDER_ID);
    providers[id] = {
      id,
      protocol: "openai-compatible",
      baseUrl: asTrimmed(v.baseUrl, fallback.baseUrl),
      model: asTrimmed(v.model, fallback.model),
      apiKey: typeof v.apiKey === "string" && v.apiKey ? v.apiKey : undefined,
      temperature: clampTemperature(v.temperature, fallback.temperature),
      reasoningEffort: asEnum(v.reasoningEffort, AI_REASONING_EFFORTS),
      thinking: asEnum(v.thinking, AI_THINKING_MODES),
    };
  }
  if (Object.keys(providers).length === 0) providers[DEFAULT_AI_PROVIDER_ID] = defaultAiProviderConfig();
  const activeRaw = typeof obj.activeProviderId === "string" ? obj.activeProviderId : "";
  const activeProviderId = providers[activeRaw] ? activeRaw : Object.keys(providers)[0];
  return { version: 1, activeProviderId, providers };
}

/** 应用渲染层补丁：省略/空串 apiKey = 沿用；clearApiKey = 清除；其余字段按目录默认兜底。 */
export function mergeAiSettings(current: AiSettings, patch: AiSettingsPatch): AiSettings {
  const providers: Record<string, AiProviderConfig> = { ...current.providers };
  for (const p of patch.providers ?? []) {
    if (!p || typeof p.id !== "string" || !p.id) continue;
    const base = providers[p.id] ?? defaultAiProviderConfig(aiProviderDef(p.id) ? p.id : DEFAULT_AI_PROVIDER_ID);
    let apiKey = base.apiKey;
    if (p.clearApiKey) apiKey = undefined;
    else if (typeof p.apiKey === "string" && p.apiKey.trim()) apiKey = p.apiKey.trim();
    providers[p.id] = {
      id: p.id,
      protocol: "openai-compatible",
      baseUrl: asTrimmed(p.baseUrl, base.baseUrl),
      model: asTrimmed(p.model, base.model),
      apiKey,
      temperature: clampTemperature(p.temperature, base.temperature),
      reasoningEffort: asEnum(p.reasoningEffort, AI_REASONING_EFFORTS) ?? base.reasoningEffort,
      thinking: asEnum(p.thinking, AI_THINKING_MODES) ?? base.thinking,
    };
  }
  if (Object.keys(providers).length === 0) providers[DEFAULT_AI_PROVIDER_ID] = defaultAiProviderConfig();
  const wantActive = typeof patch.activeProviderId === "string" ? patch.activeProviderId : "";
  const activeProviderId = providers[wantActive] ? wantActive : (providers[current.activeProviderId] ? current.activeProviderId : Object.keys(providers)[0]);
  return { version: 1, activeProviderId, providers };
}

/** 脱敏成渲染层视图：绝不含 apiKey。 */
export function aiSettingsView(settings: AiSettings): AiSettingsView {
  return {
    version: 1,
    activeProviderId: settings.activeProviderId,
    providers: Object.values(settings.providers).map((c) => ({
      id: c.id,
      protocol: c.protocol,
      baseUrl: c.baseUrl,
      model: c.model,
      temperature: c.temperature,
      reasoningEffort: c.reasoningEffort,
      thinking: c.thinking,
      hasApiKey: Boolean(c.apiKey),
    })),
  };
}

/** 选中供应商是否已配置到"可发起请求"（有 Key、有模型）。 */
export function aiSettingsReady(settings: AiSettings): boolean {
  const active = settings.providers[settings.activeProviderId];
  return Boolean(active && active.apiKey && active.model && active.baseUrl);
}

/** 对话消息（主进程/渲染层共用）。 */
export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface AiTestResult { ok: boolean; error?: string; /** 网络/限流类失败可"仍要保存"。 */ retryable?: boolean }
export interface AiListModelsResult { ok: boolean; models?: string[]; error?: string; retryable?: boolean }
export interface AiChatResult { ok: boolean; text?: string; error?: string }
export interface AiStreamEvent { requestId: string; delta: string }

export function activeAiProvider(settings: AiSettings): AiProviderConfig | null {
  return settings.providers[settings.activeProviderId] ?? null;
}
