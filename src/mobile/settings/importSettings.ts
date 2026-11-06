/**
 * 设备级「导入」设置（261106 task-86）：默认笔记本。
 *
 * 仅本机（localStorage），**不参与同步**、不进 S3 —— 与其它设备偏好（排序/视图）同口径。
 * 分享进来的 Markdown 直接落到这里指定的笔记本；未设置时首次分享会弹一次选择器并记住。
 */
const KEY = "lakex-local-notes-mobile.import.default-notebook";

export function readImportDefaultNotebook(): string | null {
  try {
    const value = localStorage.getItem(KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function writeImportDefaultNotebook(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // 存储不可用：本次会话仍可导入（调用方持有返回值），只是记不住；不抛错。
  }
}

/** 仅供测试：清掉设备级默认笔记本。 */
export function clearImportDefaultNotebookForTest(): void {
  // 测试清理：存储不可用时无副作用（断言只看读回的 null）。
  try { localStorage.removeItem(KEY); } catch { /* 存储不可用：测试清理无需处理 */ }
}
