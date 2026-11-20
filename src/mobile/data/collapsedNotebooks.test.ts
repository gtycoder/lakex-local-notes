import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

/** 内存 localStorage 桩（node 环境）。 */
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  } as Storage;
}

beforeEach(() => { installStorage(); delete (globalThis as unknown as { localStorage?: Storage }).localStorage; installStorage(); });

describe("移动端「已收起」笔记本 store（设备本地）", () => {
  const load = async () => await import("./collapsedNotebooks");

  it("默认：空表 + 分组收起", async () => {
    const s = await load();
    expect(s.readCollapsedNotebookIds()).toEqual([]);
    expect(s.readCollapsedOpen()).toBe(false);
  });

  it("切换收起并持久化", async () => {
    const s = await load();
    expect(s.toggleCollapsedNotebook("nb1")).toBe(true);
    expect(s.readCollapsedNotebookIds()).toEqual(["nb1"]);
    expect(s.toggleCollapsedNotebook("nb1")).toBe(false);
    expect(s.readCollapsedNotebookIds()).toEqual([]);
  });

  it("坏值静默回落；展开态记忆", async () => {
    const s = await load();
    localStorage.setItem("lakex-local-notes-mobile.collapsed-notebooks", "not-json");
    expect(s.readCollapsedNotebookIds()).toEqual([]);
    s.writeCollapsedOpen(true);
    expect(s.readCollapsedOpen()).toBe(true);
  });

  it("只走 localStorage：不 import bridge / S3（不同步、不进 S3）", async () => {
    const src = readFileSync(new URL("./collapsedNotebooks.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "\.\.\/bridge|electron|s3v3|syncNow/);
    expect(src).toContain("localStorage");
  });
});
