/**
 * 桌面端「上次打开的标签」会话（device-local，仅 localStorage；不进正文、不进 S3）。
 *
 * 与移动端一致：默认下次启动恢复上次标签；设置项 clearTabsOnExit=true 时不恢复并清掉存档。
 * 只存 id 与活动 id，标题/正文以启动时的库为准（已删除/已 purge 的文档在恢复时过滤掉）。
 */
export const TAB_SESSION_KEY = "lakex-local-notes-v3.tab-session";

export interface TabSession {
  ids: string[];
  activeId: string | null;
}

/** 只依赖 getItem/setItem/removeItem，便于测试注入。 */
export type TabSessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readTabSession(storage: TabSessionStorage = localStorage): TabSession | null {
  try {
    const raw = storage.getItem(TAB_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ids?: unknown; activeId?: unknown };
    const ids = Array.isArray(parsed.ids)
      ? Array.from(new Set(parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0)))
      : [];
    const activeId = typeof parsed.activeId === "string" ? parsed.activeId : null;
    return ids.length > 0 ? { ids, activeId } : null;
  } catch {
    return null;
  }
}

export function writeTabSession(session: TabSession, storage: TabSessionStorage = localStorage): void {
  try {
    const ids = Array.from(new Set(session.ids.filter((id) => typeof id === "string" && id.length > 0)));
    storage.setItem(TAB_SESSION_KEY, JSON.stringify({ ids, activeId: session.activeId }));
  } catch { /* 隐私模式/配额满：忽略 */ }
}

export function clearTabSession(storage: TabSessionStorage = localStorage): void {
  try { storage.removeItem(TAB_SESSION_KEY); } catch { /* 忽略 */ }
}

/**
 * 按 maxOpenTabs 截断恢复计划（DT-15）：会话按**打开顺序**存（越靠后越新），
 * 超过上限时只恢复最近 N 个——与"超限自动淘汰最旧标签"的语义一致，
 * 避免启动时先把旧标签打开再立刻被 evict（静默丢标签 + 逐次 persist）。
 * maxOpenTabs <= 0 = 不限制（与设置项语义一致）。
 */
export function restoreTabSessionForLimit(session: TabSession, maxOpenTabs: number): TabSession {
  if (!Number.isFinite(maxOpenTabs) || maxOpenTabs <= 0) return session;
  const limit = Math.max(1, Math.floor(maxOpenTabs));
  const ids = session.ids.length > limit ? session.ids.slice(session.ids.length - limit) : [...session.ids];
  const activeId = session.activeId && ids.includes(session.activeId) ? session.activeId : ids[ids.length - 1];
  return { ids, activeId };
}

/** 过滤掉已不存在（已删除/已 purge）的文档，并保持顺序；活动 id 不在结果里时回退到最后一个。 */
export function sanitizeTabSession(session: TabSession, liveIds: ReadonlySet<string>): TabSession | null {
  const ids = session.ids.filter((id) => liveIds.has(id));
  if (ids.length === 0) return null;
  const activeId = session.activeId && ids.includes(session.activeId) ? session.activeId : ids[ids.length - 1];
  return { ids, activeId };
}
