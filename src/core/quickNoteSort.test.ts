/**
 * 小记排序口径的护栏（261015）：
 *   ① 四档的顺序语义（最近/最早 × 更新/创建）；
 *   ② 不改入参（排序是**展示**行为，别顺手改了调用方的数组）；
 *   ③ 旧两值（updated / created）迁移到新四值 —— 用户既有偏好不丢；非法值回默认；
 *   ④ 本机写读往返（走 localStorageSafe）；
 *   ⑤ **两端必须用同一份**（源码级）：桌面与移动都从 `core/quickNoteSort` 引入，且**都不再自己写那个存储键**
 *      —— 用户 261015 明确要求"桌面与移动统一"，这条断言就是防再次各写一套。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUICK_NOTE_SORT_DEFAULT,
  QUICK_NOTE_SORT_KEY,
  QUICK_NOTE_SORT_OPTIONS,
  normalizeQuickNoteSort,
  sortQuickNotes,
  type QuickNoteSort,
} from "./quickNoteSort";
// 本机读写单独一层（core 禁 DOM）：读写走 lib/quickNoteSortPref
import { readQuickNoteSort, writeQuickNoteSort } from "../lib/quickNoteSortPref";

const items = [
  { id: "a", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
  { id: "b", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" },
  { id: "c", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" },
];
const ids = (arr: ReadonlyArray<{ id: string }>) => arr.map((x) => x.id);

describe("小记排序：四档语义", () => {
  it("最近更新 = updatedAt 降序；最早更新 = 升序", () => {
    expect(ids(sortQuickNotes(items, "recent"))).toEqual(["b", "c", "a"]);
    expect(ids(sortQuickNotes(items, "oldest"))).toEqual(["a", "c", "b"]);
  });

  it("最新创建 = createdAt 降序；最早创建 = 升序", () => {
    expect(ids(sortQuickNotes(items, "createdNew"))).toEqual(["c", "a", "b"]);
    expect(ids(sortQuickNotes(items, "createdOld"))).toEqual(["b", "a", "c"]);
  });

  it("不改入参（返回新数组）", () => {
    const before = ids(items);
    const out = sortQuickNotes(items, "oldest");
    expect(ids(items)).toEqual(before);
    expect(out).not.toBe(items);
  });

  it("缺字段/非法时间按 0 处理，不抛错", () => {
    const messy = [
      { id: "x", createdAt: "", updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: "y", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "" },
    ];
    expect(ids(sortQuickNotes(messy, "createdNew"))).toEqual(["y", "x"]);
  });

  it("菜单文案与顺序是单一来源（四档，含创建时间两档）", () => {
    expect(QUICK_NOTE_SORT_OPTIONS.map((o) => o.id)).toEqual(["recent", "oldest", "createdNew", "createdOld"]);
    expect(QUICK_NOTE_SORT_OPTIONS.map((o) => o.label)).toEqual(["最近更新", "最早更新", "最新创建", "最早创建"]);
  });
});

describe("小记排序：本机持久化与旧值迁移", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (initial: string | null) => {
    const store = new Map<string, string>();
    if (initial !== null) store.set(QUICK_NOTE_SORT_KEY, initial);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    });
    return store;
  };

  it("写读往返（键 = 桌面 260915 起沿用的那个）", () => {
    const store = stub(null);
    expect(QUICK_NOTE_SORT_KEY).toBe("lake-notes-v3.quick-notes-sort");
    expect(readQuickNoteSort()).toBe(QUICK_NOTE_SORT_DEFAULT);
    writeQuickNoteSort("oldest");
    expect(store.get(QUICK_NOTE_SORT_KEY)).toBe("oldest");
    expect(readQuickNoteSort()).toBe("oldest");
  });

  it("旧两值迁移：updated ⇒ recent、created ⇒ createdNew（都曾按降序）", () => {
    expect(normalizeQuickNoteSort("updated")).toBe("recent");
    expect(normalizeQuickNoteSort("created")).toBe("createdNew");
    stub("updated");
    expect(readQuickNoteSort()).toBe("recent");
    stub("created");
    expect(readQuickNoteSort()).toBe("createdNew");
  });

  it("非法值/无存储 ⇒ 回默认", () => {
    expect(normalizeQuickNoteSort("bogus")).toBe(QUICK_NOTE_SORT_DEFAULT);
    expect(normalizeQuickNoteSort(null)).toBe(QUICK_NOTE_SORT_DEFAULT);
    stub("bogus");
    expect(readQuickNoteSort()).toBe("recent");
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined });
    expect(readQuickNoteSort()).toBe(QUICK_NOTE_SORT_DEFAULT);
  });
});

describe("小记排序：两端同一份（源码级护栏）", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  it("桌面与移动都从 core/quickNoteSort 引入，且没有第二份存储键", () => {
    const mobile = read("src/mobile/home/HomePage.tsx");
    const desktop = read("src/components/app/QuickNotesWorkspace.tsx");
    expect(mobile, "移动端用共享档位（语义）").toContain('from "../../core/quickNoteSort"');
    expect(desktop, "桌面端用共享档位（语义）").toContain('from "../../core/quickNoteSort"');
    expect(mobile, "移动端用共享本机读写").toContain('from "../../lib/quickNoteSortPref"');
    expect(desktop, "桌面端用共享本机读写").toContain('from "../../lib/quickNoteSortPref"');
    expect(mobile + desktop, "存储键只能出现在共享模块里").not.toContain('"' + QUICK_NOTE_SORT_KEY + '"');
    expect(mobile + desktop, "排序比较器不能各写一套").not.toContain("localeCompare(key(a))");
  });

  it("档位类型就是共享类型（移动端不再自定义 QuickSort）", () => {
    const mobile = read("src/mobile/home/HomePage.tsx");
    const sorts: QuickNoteSort[] = ["recent", "oldest", "createdNew", "createdOld"];
    expect(sorts).toHaveLength(4);
    expect(mobile).not.toContain("type QuickSort =");
  });
});
