/**
 * AI 开关（设备本地；与云同步完全无关，D1）。
 * 存 localStorage：它只影响「AI 是否允许出网」这一 UI/行为开关，不含任何密钥。
 */
const AI_ENABLED_KEY = "local-lakex-notes-mobile.ai.enabled";

export function loadAiEnabled(): boolean {
  try { return window.localStorage.getItem(AI_ENABLED_KEY) === "1"; } catch { return false; }
}

export function saveAiEnabled(enabled: boolean): void {
  try { window.localStorage.setItem(AI_ENABLED_KEY, enabled ? "1" : "0"); } catch { /* 存储不可用：本次会话按默认关 */ }
}
