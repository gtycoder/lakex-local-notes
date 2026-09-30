/**
 * 生命周期动作（关闭 / 淘汰 / 锁定）前的持久化闸门（审计 F01）单一来源。
 *
 * 规则：脏文档必须先确认其 revision 持久化成功才允许继续；失败则停在原文档；
 * blocked（文档已在回收站，只读，没有可保存内容）视为可继续，但不产生持久化。
 * 三个调用点（closeTab / evictTabsForLimit / toggleNoteLock）此前各写一份同样的判定，
 * 收敛到这里避免规则漂移（新增第四个生命周期入口时不会再漏）。
 */
export type PersistOutcomeLike = { ok: boolean; blocked?: boolean };

export async function flushDirtyBeforeLifecycle(
  tab: { dirty: boolean } | undefined,
  persist: () => Promise<PersistOutcomeLike>,
): Promise<{ proceed: boolean; persisted: boolean }> {
  if (!tab?.dirty) return { proceed: true, persisted: false };
  const outcome = await persist();
  return { proceed: outcome.ok || outcome.blocked === true, persisted: outcome.ok };
}
