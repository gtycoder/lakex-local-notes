import { describe, expect, it } from "vitest";
import { TAB_SESSION_KEY, clearTabSession, readTabSession, restoreTabSessionForLimit, sanitizeTabSession, writeTabSession, type TabSessionStorage } from "./tabSession";

function memoryStorage(seed: Record<string, string> = {}): TabSessionStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe("desktop tab session（device-local 标签会话）", () => {
  it("写读往返，去重；空会话读回 null", () => {
    const s = memoryStorage();
    writeTabSession({ ids: ["a", "b", "a"], activeId: "b" }, s);
    expect(readTabSession(s)).toEqual({ ids: ["a", "b"], activeId: "b" });
    writeTabSession({ ids: [], activeId: null }, s);
    expect(readTabSession(s)).toBeNull();
  });

  it("损坏 JSON / 无 key 返回 null，clear 后读不到", () => {
    const s = memoryStorage({ [TAB_SESSION_KEY]: "not-json" });
    expect(readTabSession(s)).toBeNull();
    writeTabSession({ ids: ["a"], activeId: null }, s);
    clearTabSession(s);
    expect(readTabSession(s)).toBeNull();
  });

  it("恢复时过滤已删除文档；活动 id 失效回退到最后一个；全失效返回 null", () => {
    const live = new Set(["b", "c"]);
    expect(sanitizeTabSession({ ids: ["a", "b", "c"], activeId: "a" }, live)).toEqual({ ids: ["b", "c"], activeId: "c" });
    expect(sanitizeTabSession({ ids: ["a"], activeId: "a" }, live)).toBeNull();
  });

  it("DT-15：按 maxOpenTabs 只恢复最近 N 个（会话末尾），顺序不变、活动 id 失效回退", () => {
    const session = { ids: ["a", "b", "c", "d", "e"], activeId: "b" };
    // 保留最近 3 个；活动 b 已被截掉 ⇒ 回退到最后一个（最近的 e）。
    expect(restoreTabSessionForLimit(session, 3)).toEqual({ ids: ["c", "d", "e"], activeId: "e" });
    // 刚满/未超上限：原样返回（顺序不变）。
    expect(restoreTabSessionForLimit(session, 5)).toEqual({ ids: ["a", "b", "c", "d", "e"], activeId: "b" });
    // 0/负数/非法 = 不限制（MAX_OPEN_TAB_OPTIONS 的 0 语义）。
    expect(restoreTabSessionForLimit(session, 0)).toEqual({ ids: ["a", "b", "c", "d", "e"], activeId: "b" });
    expect(restoreTabSessionForLimit(session, Number.NaN)).toEqual({ ids: ["a", "b", "c", "d", "e"], activeId: "b" });
    // 少于一页时不改动引用内容。
    expect(restoreTabSessionForLimit({ ids: ["x"], activeId: "x" }, 8)).toEqual({ ids: ["x"], activeId: "x" });
  });
});
