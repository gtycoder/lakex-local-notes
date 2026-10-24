// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../bridge", () => ({ bridge: { readQuickNote: vi.fn() } }));

import type { StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { useQuickNoteDetailCache, type QuickNoteDetailReader, type QuickNoteDetailSource } from "./useQuickNoteDetailCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const image = (filename: string): StoredQuickNoteImage => ({
  id: filename,
  filename,
  mimeType: "image/png",
  width: 1,
  height: 1,
  size: 1,
  hash: "hash",
});

const full = (id: string, tags: string[] = []) => ({
  content: {
    body: `<p>${id}</p>`,
    images: [image(`${id}.png`)],
  },
  tagIds: tags.map((_, index) => `t_${String(index).padStart(16, "0")}`),
  tags,
  updatedAt: "2026-10-22T00:00:00.000Z",
});

type Cache = ReturnType<typeof useQuickNoteDetailCache>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let cache: Cache;

function Harness(props: {
  notes: QuickNoteDetailSource[];
  readDetail: QuickNoteDetailReader;
  limit?: number;
}) {
  cache = useQuickNoteDetailCache(props.notes, props.readDetail, props.limit);
  return null;
}

const render = (props: Parameters<typeof Harness>[0]) => {
  act(() => root.render(createElement(Harness, props)));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useQuickNoteDetailCache", () => {
  it("同一小记并发可见时只读一次，并缓存正文/图片/标签", async () => {
    const pending = deferred<ReturnType<typeof full> | null>();
    const readDetail = vi.fn(() => pending.promise);
    render({ notes: [{ id: "a", updatedAt: "2026-10-22T00:00:00.000Z", tags: [] }], readDetail });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = cache.loadDetail("a"); second = cache.loadDetail("a"); });
    expect(readDetail).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(full("a", ["标签"])); await Promise.all([first, second]); });
    expect(cache.details.get("a")).toEqual({
      body: "<p>a</p>",
      images: [image("a.png")],
      tags: ["标签"],
      tagIds: ["t_0000000000000000"],
      firstImage: "a.png",
      updatedAt: "2026-10-22T00:00:00.000Z",
    });
  });

  it("超过缓存上限时按插入顺序淘汰最旧详情", async () => {
    render({
      notes: ["a", "b", "c"].map((id) => ({ id, updatedAt: "2026-10-22T00:00:00.000Z", tags: [] })),
      readDetail: async (id) => full(id),
      limit: 2,
    });

    await act(async () => {
      await cache.loadDetail("a");
      await cache.loadDetail("b");
      await cache.loadDetail("c");
    });
    expect([...cache.details.keys()]).toEqual(["b", "c"]);
  });

  it("updatedAt 或标签变化时让旧详情失效；未变化详情保留", async () => {
    const notes = [
      { id: "a", updatedAt: "2026-10-22T00:00:00.000Z", tags: ["旧"] },
      { id: "b", updatedAt: "2026-10-22T00:00:00.000Z", tags: [] },
    ];
    render({ notes, readDetail: async (id) => full(id, id === "a" ? ["旧"] : []) });
    await act(async () => { await cache.loadDetail("a"); await cache.loadDetail("b"); });

    render({
      notes: [
        { ...notes[0], updatedAt: "2026-10-22T01:00:00.000Z" },
        notes[1],
      ],
      readDetail: async (id) => full(id),
    });
    expect(cache.details.has("a")).toBe(false);
    expect(cache.details.has("b")).toBe(true);
  });

  it("读取失败不缓存，并允许下一次可见时重试", async () => {
    const readDetail = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(full("a"));
    render({ notes: [{ id: "a", updatedAt: "2026-10-22T00:00:00.000Z", tags: [] }], readDetail });

    await act(async () => { await cache.loadDetail("a"); });
    expect(cache.details.has("a")).toBe(false);
    await act(async () => { await cache.loadDetail("a"); });
    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(cache.details.has("a")).toBe(true);
  });

  it("历史正文缺 tags/images 时规范为空数组，不用 undefined 覆盖列表 metadata", async () => {
    render({
      notes: [{ id: "a", updatedAt: "2026-10-22T00:00:00.000Z", tags: ["列表标签"] }],
      readDetail: async () => ({ content: { body: "<p>a</p>" } as never, tagIds: [] as string[], tags: [] as string[], updatedAt: "2026-10-22T00:00:00.000Z" }),
    });
    await act(async () => { await cache.loadDetail("a"); });
    expect(cache.details.get("a")?.tags).toEqual([]);
    expect(cache.details.get("a")?.images).toEqual([]);
    expect(cache.details.get("a")?.firstImage).toBeNull();
  });
});
