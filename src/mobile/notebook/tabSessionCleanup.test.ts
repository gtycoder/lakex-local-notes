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
      "lakex-local-notes-mobile.tabs.nb-1": "[\"a\"]",
      "lakex-local-notes-mobile.tabs.nb-2": "[\"b\"]",
      "lakex-local-notes-mobile.tabs.other": "[]",
      "lakex-local-notes-v1.settings": "{}",
      "lakex-local-notes-mobile.secret.k": "enc",
    });
    expect(clearPersistedNotebookTabs(s)).toBe(3);
    expect([...s.data.keys()].sort()).toEqual(["lakex-local-notes-mobile.secret.k", "lakex-local-notes-v1.settings"]);
    expect(clearPersistedNotebookTabs(s)).toBe(0);
  });
});
