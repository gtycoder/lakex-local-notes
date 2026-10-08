// @vitest-environment jsdom
/**
 * AI 字段生成控制器行为测试（261003）：单格成功 / 整列批量（一次撤销 + 并发上限）/ 失败态 / 取消。
 * 只 mock 主进程 AI 通道（lib/ai），其余走真实 core（buildAiFieldMessages + setBitableCellValue）。
 */
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiCellKey, runPool, useAiFieldGeneration } from "./useAiFieldGeneration";
import type { BitableDoc, BitableTable } from "../../core/bitableDoc.js";

const mocks = vi.hoisted(() => ({
  runAiChat: vi.fn<(requestId: string, messages: unknown[]) => Promise<{ ok: boolean; text?: string; error?: string }>>(async () => ({ ok: true, text: "生成结果" })),
  cancelAiChat: vi.fn(async () => {}),
}));
vi.mock("../../lib/ai", () => ({
  newAiRequestId: () => "req-" + Math.random().toString(36).slice(2),
  runAiChat: mocks.runAiChat,
  cancelAiChat: mocks.cancelAiChat,
}));

const ts = "2026-10-03T00:00:00.000Z";

function makeDoc(recordCount: number): BitableDoc {
  const table: BitableTable = {
    id: "t1",
    name: "t1",
    fields: [
      { id: "f-note", name: "备注", type: "text" },
      { id: "f-ai", name: "AI 总结", type: "ai", ai: { prompt: "根据 {{备注}} 写一句" } },
    ],
    records: Array.from({ length: recordCount }, (_, index) => ({
      id: "r" + index,
      values: { "f-note": "值 " + index },
      createdAt: ts,
      updatedAt: ts,
    })),
    views: [{ id: "v1", name: "视图", type: "grid", rowHeight: "low" }],
    activeViewId: "v1",
  };
  return { kind: "bitable", version: 1, tables: [table], activeTableId: "t1" };
}

type HookApi = ReturnType<typeof useAiFieldGeneration>;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.runAiChat.mockClear();
  mocks.runAiChat.mockImplementation(async () => ({ ok: true, text: "生成结果" }));
  mocks.cancelAiChat.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** 挂一个使用 hook 的宿主：暴露最新 api、记录写入与手势调用。 */
function renderHarness(doc: BitableDoc) {
  const apiRef = { current: null as HookApi | null };
  let current = doc;
  const writes: BitableDoc[] = [];
  const beginGesture = vi.fn();
  const endGesture = vi.fn();
  function Harness() {
    const docRef = useRef(current);
    const api = useAiFieldGeneration({
      docRef,
      noteId: "note-1",
      updateDoc: (update) => { const next = update(docRef.current); docRef.current = next; current = next; writes.push(next); },
      beginGesture,
      endGesture,
      isReadOnly: () => false,
    });
    apiRef.current = api;
    return null;
  }
  act(() => { root.render(createElement(Harness)); });
  return {
    api: () => apiRef.current!,
    writes,
    beginGesture,
    endGesture,
    valueOf: (recordId: string) => current.tables[0].records.find((r) => r.id === recordId)?.values["f-ai"],
  };
}

describe("AI 字段生成控制器（261003）", () => {
  it("单格生成：请求走 core 组装（system + user），成功后写入快照并清掉运行态", async () => {
    const harness = renderHarness(makeDoc(1));
    await act(async () => { await harness.api().generateCell("t1", "r0", "f-ai"); });
    expect(mocks.runAiChat).toHaveBeenCalledTimes(1);
    const messages = mocks.runAiChat.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe("根据 值 0 写一句");
    expect(harness.valueOf("r0")).toBe("生成结果");
    expect(harness.api().cellStates[aiCellKey("f-ai", "r0")]).toBeUndefined();
  });

  it("整列批量：并发 ≤3、整批一次撤销（begin/endGesture 各一次）、全部落盘", async () => {
    let active = 0;
    let maxActive = 0;
    mocks.runAiChat.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { ok: true, text: "结果" };
    });
    const harness = renderHarness(makeDoc(6));
    await act(async () => { await harness.api().runBatch("t1", "f-ai", ["r0", "r1", "r2", "r3", "r4", "r5"]); });
    expect(maxActive).toBe(3);
    expect(harness.beginGesture).toHaveBeenCalledTimes(1);
    expect(harness.endGesture).toHaveBeenCalledTimes(1);
    for (const id of ["r0", "r1", "r2", "r3", "r4", "r5"]) expect(harness.valueOf(id)).toBe("结果");
    expect(harness.api().batch).toMatchObject({ total: 6, done: 6, failed: 0, running: false, cancelled: false });
  });

  it("失败态：请求失败标 failed（文案来自错误），不写盘；批量统计失败数", async () => {
    mocks.runAiChat.mockImplementation(async () => ({ ok: false, error: "鉴权失败" }));
    const harness = renderHarness(makeDoc(2));
    await act(async () => { await harness.api().runBatch("t1", "f-ai", ["r0", "r1"]); });
    expect(harness.api().cellStates[aiCellKey("f-ai", "r0")]).toMatchObject({ status: "failed", error: "鉴权失败" });
    expect(harness.writes).toHaveLength(0);
    expect(harness.api().batch).toMatchObject({ failed: 2, done: 2, running: false });
    expect(harness.api().batch?.failedRecordIds).toEqual(["r0", "r1"]);
  });

  it("取消：中止在途请求、丢弃其结果（不写盘），批量标记 cancelled", async () => {
    let resolveChat: (value: { ok: boolean; error?: string }) => void = () => {};
    mocks.runAiChat.mockImplementationOnce(() => new Promise((resolve) => { resolveChat = resolve; }));
    const harness = renderHarness(makeDoc(1));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => { pending = harness.api().generateCell("t1", "r0", "f-ai"); });
    expect(harness.api().cellStates[aiCellKey("f-ai", "r0")]).toMatchObject({ status: "running" });
    act(() => harness.api().cancelBatch());
    expect(mocks.cancelAiChat).toHaveBeenCalledTimes(1);
    await act(async () => { resolveChat({ ok: false, error: "aborted" }); await pending; });
    expect(harness.api().cellStates[aiCellKey("f-ai", "r0")]).toBeUndefined();
    expect(harness.writes).toHaveLength(0);
  });

  it("单格停止：只中止本格那一次请求（其它格照常落盘），状态回空闲、不写盘（261008）", async () => {
    const resolvers = new Map<string, (value: { ok: boolean; text?: string; error?: string }) => void>();
    mocks.runAiChat.mockImplementation((requestId) => new Promise((resolve) => { resolvers.set(requestId, resolve); }));
    const harness = renderHarness(makeDoc(2));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = harness.api().generateCell("t1", "r0", "f-ai");
      second = harness.api().generateCell("t1", "r1", "f-ai");
    });
    const ids = mocks.runAiChat.mock.calls.map((call) => call[0]);
    expect(ids).toHaveLength(2);
    expect(harness.api().cellStates[aiCellKey("f-ai", "r0")]).toMatchObject({ status: "running" });
    expect(harness.api().cellStates[aiCellKey("f-ai", "r1")]).toMatchObject({ status: "running" });

    act(() => harness.api().cancelCell("r0", "f-ai"));
    expect(mocks.cancelAiChat).toHaveBeenCalledTimes(1);
    expect(mocks.cancelAiChat).toHaveBeenCalledWith(ids[0]);

    await act(async () => { resolvers.get(ids[0])!({ ok: false, error: "aborted" }); await first; });
    expect(harness.api().cellStates[aiCellKey("f-ai", "r0")]).toBeUndefined();
    expect(harness.valueOf("r0")).toBeUndefined();
    // 只停了 r0：r1 仍在途，结果照常写入
    expect(harness.api().cellStates[aiCellKey("f-ai", "r1")]).toMatchObject({ status: "running" });
    await act(async () => { resolvers.get(ids[1])!({ ok: true, text: "结果1" }); await second; });
    expect(harness.valueOf("r1")).toBe("结果1");
    expect(harness.writes).toHaveLength(1);
  });

  it("runPool：并发上限生效且不丢任务（纯函数）", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const seen: number[] = [];
    let active = 0;
    let maxActive = 0;
    await runPool(items, 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      seen.push(item);
      active -= 1;
    });
    expect(seen).toEqual(items);
    expect(maxActive).toBe(2);
  });
});