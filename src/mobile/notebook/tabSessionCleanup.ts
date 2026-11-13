/**
 * 移动端标签存档（localStorage）的生命周期：键单一来源 + 冷启动整棵清理 + 删除笔记本时定点清理。
 *
 * 为什么不挂进程退出回调：Android 杀进程没有可靠回调；在启动时清（读设置后、进入工作区前）
 * 与「退出即清」的可观察结果一致，且不依赖 appStateChange（切后台不应清标签）。
 * 仅本机 localStorage；不进正文、不进 S3。
 */
export const MOBILE_TABS_KEY_PREFIX = "lakex-local-notes-mobile.tabs.";

/** 某笔记本的标签存档键（ids 数组）。 */
export function notebookTabsStorageKey(notebookId: string): string {
  return MOBILE_TABS_KEY_PREFIX + notebookId;
}

/**
 * 活动页 companion key（261102）：除 ids 数组外**单独**记「退出时停在哪个标签」。
 * 旧版本只写 ids ⇒ 读不到 active 时回落「列表最后一个」（与旧行为逐字一致，向后兼容）。
 * ⚠️ 必须挂在 tabs 前缀下：冷启动清理 clearPersistedNotebookTabs() 按前缀整棵删，两个 key 一起清。
 */
export function notebookTabsActiveStorageKey(notebookId: string): string {
  return notebookTabsStorageKey(notebookId) + ".active";
}

type RemoveStorage = {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
};

/**
 * 清掉所有 lakex-local-notes-mobile.tabs.*，返回清掉的条数（幂等）。
 * 261102：活动页 companion key（`tabs.<notebookId>.active`）也在这个前缀下 ⇒ 同一个循环整棵清掉。
 */
export function clearPersistedNotebookTabs(storage: RemoveStorage = localStorage): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(MOBILE_TABS_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

/**
 * 删除笔记本后清掉**这一个**笔记本的标签存档（261114 task-8，与桌面删除语义一致）：
 * 不清理的话，之后从回收站恢复该笔记本并重新进入时，useNotebookTabs 会按旧存档把删除前的标签重新打开
 * ⇒ 「删除后标签已关闭」不再成立。只清 ids + active 两键，不动其它笔记本。
 */
export function clearPersistedNotebookTabsFor(
  notebookId: string,
  storage: { removeItem(key: string): void } = localStorage,
): void {
  try {
    storage.removeItem(notebookTabsStorageKey(notebookId));
    storage.removeItem(notebookTabsActiveStorageKey(notebookId));
  } catch (error) {
    console.warn("[tabs] 清理笔记本标签存档失败（存储被禁用/隐私模式）：", notebookId, error);
  }
}
