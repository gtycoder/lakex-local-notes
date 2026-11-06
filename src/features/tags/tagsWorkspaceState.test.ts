
/** 标签空间上次状态（纯逻辑）：坏值兜底 / 标签已删清选中 / 预览不在聚合里清预览。 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAG_SPACE_STATE,
  TAG_STATE_STORAGE_KEY,
  parseTagSpaceState,
  readTagSpaceState,
  resolveTagSpaceState,
  samePreviewRef,
  writeTagSpaceState,
  type TagSpaceState,
  type TagStateStorage,
} from "./tagsWorkspaceState";

function memoryStorage(initial: Record<string, string> = {}): TagStateStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

describe("标签空间状态：解析与坏值兜底", () => {
  it("非对象/缺字段 ⇒ 全默认（无选中、筛选 all、无预览、滚动 0）", () => {
    for (const raw of [null, undefined, 42, "x", []]) {
      expect(parseTagSpaceState(raw)).toEqual(DEFAULT_TAG_SPACE_STATE);
    }
  });

  it("逐项校验：坏 filter ⇒ all；坏 preview ⇒ 清；负/非数滚动 ⇒ 0", () => {
    expect(parseTagSpaceState({ tagId: "t1", filter: "bogus" })).toMatchObject({ tagId: "t1", filter: "all" });
    expect(parseTagSpaceState({ tagId: "t1", preview: { kind: "bogus", id: "n1" } }).preview).toBeNull();
    expect(parseTagSpaceState({ tagId: "t1", preview: { kind: "doc" } }).preview).toBeNull();
    expect(parseTagSpaceState({ tagId: 7, preview: { kind: "doc", id: "n1" } })).toEqual(DEFAULT_TAG_SPACE_STATE);
    expect(parseTagSpaceState({ tagId: "t1", scrollTop: -5 }).scrollTop).toBe(0);
    expect(parseTagSpaceState({ tagId: "t1", scrollTop: Number.NaN }).scrollTop).toBe(0);
    expect(parseTagSpaceState({ tagId: "t1", scrollTop: 128.9 }).scrollTop).toBe(128);
  });

  it("没有选中标签时预览必然清掉（避免返回时右栏凭空出现一条）", () => {
    expect(parseTagSpaceState({ tagId: null, preview: { kind: "doc", id: "n1" } }).preview).toBeNull();
  });
});

describe("标签空间状态：与真实数据对齐", () => {
  it("选中的标签已删除 ⇒ 回落默认（预览/滚动一起清）", () => {
    const resolved = resolveTagSpaceState(
      { tagId: "gone", filter: "doc", preview: { kind: "doc", id: "n1" }, scrollTop: 200 },
      { tagIds: ["t1", "t2"], items: [{ kind: "doc", id: "n1" }] },
    );
    expect(resolved).toEqual({ ...DEFAULT_TAG_SPACE_STATE });
  });

  it("预览条目不在该标签的聚合里 ⇒ 只清预览，保留标签/筛选/滚动", () => {
    const state: TagSpaceState = { tagId: "t1", filter: "quickNote", preview: { kind: "doc", id: "n9" }, scrollTop: 64 };
    const resolved = resolveTagSpaceState(state, { tagIds: ["t1"], items: [{ kind: "quickNote", id: "q1" }] });
    expect(resolved).toEqual({ ...state, preview: null });
  });

  it("数据都还在 ⇒ 原样返回（含预览）", () => {
    const state: TagSpaceState = { tagId: "t1", filter: "all", preview: { kind: "quickNote", id: "q1" }, scrollTop: 32 };
    expect(resolveTagSpaceState(state, {
      tagIds: ["t1"], items: [{ kind: "doc", id: "n1" }, { kind: "quickNote", id: "q1" }],
    })).toEqual(state);
  });
});

describe("标签空间状态：存取", () => {
  it("写入后能读回同一份状态；坏 JSON 读成默认", () => {
    const storage = memoryStorage();
    const state = { tagId: "t1", filter: "quickNote" as const, preview: { kind: "quickNote" as const, id: "q1" }, scrollTop: 40 };
    expect(writeTagSpaceState(state, storage)).toBe(true);
    expect(readTagSpaceState(storage)).toEqual(state);
    storage.data.set(TAG_STATE_STORAGE_KEY, "{坏了");
    expect(readTagSpaceState(storage)).toEqual(DEFAULT_TAG_SPACE_STATE);
  });

  it("存储不可用（隐私模式）时读默认、写失败，不抛错", () => {
    expect(readTagSpaceState(null)).toEqual(DEFAULT_TAG_SPACE_STATE);
    expect(writeTagSpaceState(DEFAULT_TAG_SPACE_STATE, null)).toBe(false);
  });
});

describe("预览引用比较", () => {
  it("kind + id 都相同才算同一条", () => {
    expect(samePreviewRef({ kind: "doc", id: "n1" }, { kind: "doc", id: "n1" })).toBe(true);
    expect(samePreviewRef({ kind: "doc", id: "n1" }, { kind: "quickNote", id: "n1" })).toBe(false);
    expect(samePreviewRef(null, null)).toBe(true);
    expect(samePreviewRef({ kind: "doc", id: "n1" }, null)).toBe(false);
  });
});
