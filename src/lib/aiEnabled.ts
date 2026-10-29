/**
 * 桌面端「AI 助手」总开关（设备本地偏好）。
 *
 * 与云同步的「启用」开关同一语义：**关闭 = 任何路径都不出网**（AI 请求在渲染层就被拦下），
 * 但配置与 API Key 保留，重新打开即可继续用。默认开（保持既有行为不变）。
 * 存 localStorage：只影响 UI/行为开关，不含任何密钥；不进 S3。
 */
const AI_ENABLED_KEY = "lakex-local-notes-v3.ai.enabled";

export function loadAiEnabled(): boolean {
  try {
    return window.localStorage.getItem(AI_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAiEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(AI_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* 存储不可用：本次会话按默认（开）处理 */
  }
}
