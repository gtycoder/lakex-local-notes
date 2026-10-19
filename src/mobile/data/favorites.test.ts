import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** 内存 localStorage 桩（node 环境）；window 用 EventTarget 承接订阅事件。 */
function installEnv(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
  (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
}

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOME = strip(read("../home/HomePage.tsx"));
const WS = strip(read("../notebook/NotebookWorkspace.tsx"));

describe("移动端「常用」文档（261019，仅设备本地）", () => {
  beforeEach(() => installEnv());
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    delete (globalThis as unknown as { window?: EventTarget }).window;
  });

  it("读写/切换：追加顺序、去重、取消、坏值回落", async () => {
    const m = await import("./favorites");
    expect(m.readFavoriteIds()).toEqual([]);
    expect(m.toggleFavorite("a")).toBe(true);
    expect(m.toggleFavorite("b")).toBe(true);
    expect(m.readFavoriteIds()).toEqual(["a", "b"]);
    expect(m.isFavorite("a")).toBe(true);
    expect(m.toggleFavorite("a")).toBe(false);
    expect(m.readFavoriteIds()).toEqual(["b"]);
    localStorage.setItem("lake-notes-mobile.favorites", "{bad json");
    expect(m.readFavoriteIds()).toEqual([]);
    localStorage.setItem("lake-notes-mobile.favorites", JSON.stringify(["x", "x", 5, ""]));
    expect(m.readFavoriteIds()).toEqual(["x"]);
  });

  it("展开偏好与订阅：同端事件驱动（不触网）", async () => {
    const m = await import("./favorites");
    expect(m.readFavoritesOpen()).toBe(true);
    m.writeFavoritesOpen(false);
    expect(m.readFavoritesOpen()).toBe(false);
    let hits = 0;
    const off = m.subscribeFavorites(() => { hits += 1; });
    m.toggleFavorite("z");
    expect(hits).toBe(1);
    off();
    m.toggleFavorite("z");
    expect(hits).toBe(1);
  });

  it("首页：只有「常用」分组，不再有最近文档 / recentNotes；可收起、横向卡", () => {
    expect(HOME).toContain("\u5e38\u7528");
    expect(HOME).not.toContain("\u6700\u8fd1\u6587\u6863");
    expect(HOME).not.toContain("recentNotes");
    expect(HOME).toContain("readFavoriteIds");
    expect(HOME).toContain("toggleFavoriteOpen");
    expect(HOME).toMatch(/home-section__toggle/);
    expect(HOME).toMatch(/favoriteOpen \? <ChevronDown/);
  });

  it("目录菜单：文档行有「设为常用 / 取消常用」，走本地 toggle + toast", () => {
    expect(WS).toMatch(/label: isFavorite\(node\.id\) \? "\u53d6\u6d88\u5e38\u7528" : "\u8bbe\u4e3a\u5e38\u7528"/);
    expect(WS).toMatch(/root === "favorite".*toggleFavorite\(node\.id\)/);
    expect(WS).toContain("\u5df2\u8bbe\u4e3a\u5e38\u7528");
  });

  it("只走 localStorage：不 import bridge / S3 / 同步模块（桌面零改动、不触发同步）", () => {
    const STORE = strip(read("./favorites.ts"));
    expect(STORE).toContain("localStorage");
    expect(STORE).not.toContain("bridge");
    expect(STORE).not.toContain("s3");
    expect(STORE).not.toContain("sync");
  });
});
