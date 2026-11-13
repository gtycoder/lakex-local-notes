/**
 * 移动端 AI「供应商」本机偏好（261114 用户点单：与桌面一样先选服务供应商）。
 *
 * 桌面把每个供应商的完整配置存进 settings（activeProviderId + providers[]）；移动端的 Key 由原生
 * （Android Keystore）持有、只保存**一份**连接配置，因此这里只持久化「当前选的是哪家 + 该家的默认值」：
 *  · 选择结果存 localStorage（仅本机、不含密钥、不参与同步）；
 *  · 打开页面时优先按**已保存的 baseUrl** 反推供应商（保存过的配置即真相），其次读本机选择，最后默认第一家；
 *  · 切换供应商 = 用该家默认端点/模型/思考参数填充表单（保存后才写进原生通道）。
 */
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER_ID, aiProviderDef, defaultAiProviderConfig } from "../../core/aiProviders";

const STORAGE_KEY = "lakex-local-notes-mobile.ai.provider";

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, "").toLowerCase();

export function readAiProviderId(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && aiProviderDef(raw) ? raw : null;
  } catch { return null; }
}

export function writeAiProviderId(id: string): void {
  try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* 存储不可用：仅本次会话生效 */ }
}

/** 按已保存的 baseUrl 反推供应商（命中某家默认端点即认；否则返回 null 交给本机选择）。 */
export function inferAiProviderId(baseUrl: string): string | null {
  const target = normalizeUrl(baseUrl);
  if (!target) return null;
  return AI_PROVIDERS.find((provider) => normalizeUrl(provider.defaultBaseUrl) === target)?.id ?? null;
}

export interface AiProviderPreset {
  baseUrl: string;
  model: string;
  temperature: string;
  reasoningEffort: string;
  thinking: string;
}

/** 某家供应商的默认表单值（空串 = 该家不支持该参数 / 未设置）。 */
export function aiProviderPreset(id: string): AiProviderPreset {
  const config = defaultAiProviderConfig(id || DEFAULT_AI_PROVIDER_ID);
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: String(config.temperature),
    reasoningEffort: config.reasoningEffort ?? "",
    thinking: config.thinking ?? "",
  };
}
