/**
 * 手写板保存/捕获纯逻辑测试（261112 R2-S10 阶段①）。
 *
 * 覆盖任务点名的两条链：
 *  · 落笔 → 标脏（只通知一次）→ 500ms 防抖（连续落笔只保存最后一次）→ 现算序列化 → 等价丢/不等价交保存；
 *  · capture 现算：只读交父层最新正文 / 序列化失败交 null / 等价交磁盘原文 / 有改动交当前正文。
 * 替换 inkPadWiring / inkOpenReadOnly 里「grep InkPad.tsx 源码」的文本断言（实现搬走后按行为测）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INK_SAVE_DEBOUNCE_MS,
  captureInkBody,
  createInkDiskBaseline,
  createInkSavePipeline,
} from "./inkPadModel";

const io = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

function harness(overrides: {
  serialize?: () => string | null;
  isSameAsDisk?: (body: string) => boolean;
} = {}) {
  const state = { dirty: false, marks: 0, serialized: 0, emitted: [] as string[] };
  const pipeline = createInkSavePipeline({
    io,
    isDirty: () => state.dirty,
    markDirty: () => { state.dirty = true; state.marks += 1; },
    clearDirty: () => { state.dirty = false; },
    serialize: overrides.serialize ?? (() => { state.serialized += 1; return "body"; }),
    isSameAsDisk: overrides.isSameAsDisk ?? (() => false),
    emit: (body) => { state.emitted.push(body); },
  });
  return { state, pipeline };
}

afterEach(() => { vi.useRealTimers(); });

describe("保存防抖（落笔 → 500ms → 序列化/保存）", () => {
  it("窗口常量 = 500ms，且连续落笔只保存最后一次（防抖聚合）", () => {
    vi.useFakeTimers();
    expect(INK_SAVE_DEBOUNCE_MS).toBe(500);
    const { state, pipeline } = harness();
    pipeline.scheduleSave();
    vi.advanceTimersByTime(300);
    pipeline.scheduleSave();
    pipeline.scheduleSave();
    vi.advanceTimersByTime(INK_SAVE_DEBOUNCE_MS - 1);
    expect(state.serialized).toBe(0); // 计时未到不序列化（热路径不序列化）
    vi.advanceTimersByTime(1);
    expect(state.serialized).toBe(1);
    expect(state.emitted).toEqual(["body"]);
    expect(state.dirty).toBe(false);
  });

  it("标脏只在 false→true 时通知一次（父层脏标记不重复刷）", () => {
    vi.useFakeTimers();
    const { state, pipeline } = harness();
    pipeline.scheduleSave();
    pipeline.scheduleSave();
    pipeline.scheduleSave();
    expect(state.marks).toBe(1);
    vi.advanceTimersByTime(INK_SAVE_DEBOUNCE_MS);
    pipeline.scheduleSave(); // 保存后又落笔 ⇒ 再次标脏
    expect(state.marks).toBe(2);
  });

  it("序列化失败保留 dirty（正文不丢，下次编辑/退出再试）", () => {
    vi.useFakeTimers();
    let fail = true;
    const { state, pipeline } = harness({
      serialize: () => { state.serialized += 1; return fail ? null : "body"; },
    });
    pipeline.scheduleSave();
    vi.advanceTimersByTime(INK_SAVE_DEBOUNCE_MS);
    expect(state.dirty).toBe(true);
    expect(state.emitted).toEqual([]);
    fail = false;
    pipeline.flushSave();
    expect(state.dirty).toBe(false);
    expect(state.emitted).toEqual(["body"]);
  });

  it("与磁盘等价 ⇒ 不交保存（CORE-03 打开只读）", () => {
    vi.useFakeTimers();
    const { state, pipeline } = harness({ isSameAsDisk: () => true });
    pipeline.scheduleSave();
    vi.advanceTimersByTime(INK_SAVE_DEBOUNCE_MS);
    expect(state.serialized).toBe(1);
    expect(state.emitted).toEqual([]);
    expect(state.dirty).toBe(false);
  });

  it("flush 取消在途计时并立即保存；不 dirty 时什么都不做", () => {
    vi.useFakeTimers();
    const { state, pipeline } = harness();
    pipeline.flushSave();
    expect(state.serialized).toBe(0);
    pipeline.scheduleSave();
    pipeline.flushSave();
    expect(state.serialized).toBe(1);
    expect(state.emitted).toEqual(["body"]);
    vi.advanceTimersByTime(INK_SAVE_DEBOUNCE_MS * 3);
    expect(state.serialized).toBe(1); // 计时已取消，不会再跑一次
  });
});

describe("磁盘基线（CORE-03，规范形态惰性缓存）", () => {
  it("磁盘原文的规范形态只算一次（10 MiB 正文不能每次保存都解析）", () => {
    let calls = 0;
    const baseline = createInkDiskBaseline('{"raw":1}', (body) => { calls += 1; return "canonical:" + body; });
    expect(baseline.isSameAsDisk("canonical:{\"raw\":1}")).toBe(true);
    expect(baseline.isSameAsDisk("other")).toBe(false);
    expect(baseline.isSameAsDisk("canonical:{\"raw\":1}")).toBe(true);
    expect(calls).toBe(1);
  });

  it("磁盘原文无法解析（canonical=null）⇒ 一律不等价（宁可多写一次也不吞改动）", () => {
    const baseline = createInkDiskBaseline("bad", () => null);
    expect(baseline.isSameAsDisk("anything")).toBe(false);
    expect(baseline.isSameAsDisk("")).toBe(false);
  });
});

describe("capture 现算（只读 / 序列化失败 / 等价 / 有改动）", () => {
  const base = { latestContent: "latest", diskBody: "disk", serialize: () => "body", isSameAsDisk: () => false };

  it("只读 ⇒ 交父层最新正文（不序列化、不交可写正文）", () => {
    let serialized = 0;
    const out = captureInkBody({
      ...base, readOnly: true,
      serialize: () => { serialized += 1; return "body"; },
    });
    expect(out).toBe("latest");
    expect(serialized).toBe(0);
  });

  it("序列化失败 ⇒ null（父层不写）", () => {
    expect(captureInkBody({ ...base, readOnly: false, serialize: () => null })).toBeNull();
  });

  it("与磁盘等价 ⇒ 交磁盘原文（改回原样不产生写盘）", () => {
    expect(captureInkBody({ ...base, readOnly: false, isSameAsDisk: () => true })).toBe("disk");
  });

  it("真实改动 ⇒ 交当前正文（笔迹不丢）", () => {
    expect(captureInkBody({ ...base, readOnly: false })).toBe("body");
  });
});
