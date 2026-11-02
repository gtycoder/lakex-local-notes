import { describe, expect, it } from "vitest";
import { clearPersistedNotebookTabs } from "./tabSessionCleanup";

function memoryStorage(seed: Record<string, string>) {
  const data = new Map(Object.entries(seed));
  return {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    data,
  };
}

describe("移动端退出清标签（启动时清）", () => {
  it("只清 tabs 前缀，其它 key 保留，幂等（ids 与 companion active 一起清）", () => {
    const s = memoryStorage({
      "lakex-local-notes-mobile.tabs.nb-1": "[\"a\"]",
      // 261102：活动页 companion key 必须与 ids 同前缀 ⇒ 同一个前缀循环就整棵清掉（不需要第二份清单）
      "lakex-local-notes-mobile.tabs.nb-1.active": "a",
      "lakex-local-notes-mobile.tabs.nb-2": "[\"b\"]",
      "lakex-local-notes-mobile.tabs.nb-2.active": "b",
      "lakex-local-notes-mobile.tabs.other": "[]",
      "lakex-local-notes-v1.settings": "{}",
      "lakex-local-notes-mobile.secret.k": "enc",
    });
    expect(clearPersistedNotebookTabs(s)).toBe(5);
    // 两个 key 都没了：active 残留会让下次启动读到「指向空列表」的死 active
    expect(s.data.has("lakex-local-notes-mobile.tabs.nb-1.active")).toBe(false);
    expect(s.data.has("lakex-local-notes-mobile.tabs.nb-2.active")).toBe(false);
    expect([...s.data.keys()].sort()).toEqual(["lakex-local-notes-mobile.secret.k", "lakex-local-notes-v1.settings"]);
    expect(clearPersistedNotebookTabs(s)).toBe(0);
  });

  it("tabs.* 前缀不会误伤相似前缀（tabsX / tabs）", () => {
    const s = memoryStorage({
      "lakex-local-notes-mobile.tabs.nb-1": "[\"a\"]",
      "lakex-local-notes-mobile.tabs": "not-a-tab-key",
      "lakex-local-notes-mobile.tabsX": "other",
    });
    expect(clearPersistedNotebookTabs(s)).toBe(1);
    expect([...s.data.keys()].sort()).toEqual(["lakex-local-notes-mobile.tabs", "lakex-local-notes-mobile.tabsX"]);
  });
});
