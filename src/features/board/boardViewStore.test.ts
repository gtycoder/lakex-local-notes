/**
 * 画板视图本机记忆（260926）。
 *
 * 用户口径：「移动到一个位置之后就永久记忆，无论什么时候进来都是这个位置」。位置按
 * `docs/STORAGE-LAYERS.md` 的 **L3 纯本机 UI 状态**放在 localStorage ⇒ **不进正文、不进 S3**
 * （写正文会让 pan/zoom 触发保存与上传，且视口跨端串味）。vitest 是 node 环境，这里用替身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBoardView, resetBoardViews, writeBoardView } from "./boardViewStore";

/** 极简 localStorage 替身。 */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => { map.clear(); },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
  } as Storage;
}

describe("画板视图本机记忆", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", fakeStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("平移只更新滚动量、缩放只更新 viewport，两者互不覆盖", () => {
    expect(readBoardView("n1")).toBeNull();
    writeBoardView("n1", { scroll: { left: 120, top: 80 } });
    writeBoardView("n1", { viewport: { x: -30, y: 40, zoom: 1.2 } });
    expect(readBoardView("n1")).toEqual({
      viewport: { x: -30, y: 40, zoom: 1.2 },
      scroll: { left: 120, top: 80 },
    });
    // 再平移：viewport 保留
    writeBoardView("n1", { scroll: { left: 300, top: 90 } });
    expect(readBoardView("n1")).toEqual({
      viewport: { x: -30, y: 40, zoom: 1.2 },
      scroll: { left: 300, top: 90 },
    });
  });

  it("每篇文档独立；存/取都是快照（外部改动不影响已记下的值）", () => {
    const scroll = { left: 1, top: 2 };
    writeBoardView("n1", { scroll });
    writeBoardView("n2", { scroll: { left: 9, top: 9 } });
    scroll.left = 999;
    expect(readBoardView("n1")?.scroll).toEqual({ left: 1, top: 2 });
    const got = readBoardView("n2");
    if (got?.scroll) got.scroll.left = -1;
    expect(readBoardView("n2")?.scroll).toEqual({ left: 9, top: 9 });
  });

  it("超过上限按最近使用淘汰（长开窗口不无界增长）", () => {
    for (let i = 0; i < 205; i++) writeBoardView(`n${i}`, { scroll: { left: i, top: 0 } });
    expect(readBoardView("n0")).toBeNull();               // 最旧的一条被淘汰
    expect(readBoardView("n204")?.scroll).toEqual({ left: 204, top: 0 });
  });

  it("没有 localStorage（node / 被禁用）时读回 null 且写入不抛（只是记不住位置）", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readBoardView("n1")).toBeNull();
    expect(() => writeBoardView("n1", { scroll: { left: 1, top: 1 } })).not.toThrow();
  });

  it("脏数据 / 被清空后不炸：解析失败按「没记过」处理", () => {
    localStorage.setItem("local-lakex-notes-v3.board-views", "{not json");
    expect(readBoardView("n1")).toBeNull();
    writeBoardView("n1", { scroll: { left: 5, top: 6 } });
    expect(readBoardView("n1")?.scroll).toEqual({ left: 5, top: 6 });
    resetBoardViews();
    expect(readBoardView("n1")).toBeNull();
  });
});
