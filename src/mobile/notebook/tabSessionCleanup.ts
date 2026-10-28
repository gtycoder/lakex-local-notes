/**
 * 移动端「退出时关闭全部标签」：冷启动时清掉各笔记本的标签存档。
 *
 * 为什么不挂进程退出回调：Android 杀进程没有可靠回调；在启动时清（读设置后、进入工作区前）
 * 与「退出即清」的可观察结果一致，且不依赖 appStateChange（切后台不应清标签）。
 * 仅本机 localStorage；不进正文、不进 S3。
 */
export const MOBILE_TABS_KEY_PREFIX = "local-lakex-notes-mobile.tabs.";

type RemoveStorage = {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
};

/** 清掉所有 local-lakex-notes-mobile.tabs.*，返回清掉的条数（幂等）。 */
export function clearPersistedNotebookTabs(storage: RemoveStorage = localStorage): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(MOBILE_TABS_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}
