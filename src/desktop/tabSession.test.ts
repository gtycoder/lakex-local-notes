import { describe, expect, it } from "vitest";
import { TAB_SESSION_KEY, clearTabSession, readTabSession, sanitizeTabSession, writeTabSession, type TabSessionStorage } from "./tabSession";

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
});
