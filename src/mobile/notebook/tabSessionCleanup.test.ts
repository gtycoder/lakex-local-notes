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
  it("只清 tabs 前缀，其它 key 保留，幂等", () => {
    const s = memoryStorage({
      "local-lakex-notes-mobile.tabs.nb-1": "[\"a\"]",
      "local-lakex-notes-mobile.tabs.nb-2": "[\"b\"]",
      "local-lakex-notes-mobile.tabs.other": "[]",
      "local-lakex-notes-v1.settings": "{}",
      "local-lakex-notes-mobile.secret.k": "enc",
    });
    expect(clearPersistedNotebookTabs(s)).toBe(3);
    expect([...s.data.keys()].sort()).toEqual(["local-lakex-notes-mobile.secret.k", "local-lakex-notes-v1.settings"]);
    expect(clearPersistedNotebookTabs(s)).toBe(0);
  });
});
