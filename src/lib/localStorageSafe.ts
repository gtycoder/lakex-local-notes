/**
 * localStorage 写入保护：隐私模式、配额满或存储被禁用时不影响交互。
 * 读取仍可用原生 API；只有写入统一走这里，避免每个偏好点各写一份 try/catch。
 */
export function writeLocalStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[prefs] 写入 localStorage 失败：${key}`, error);
    return false;
  }
}
