// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Pending = { args: unknown[]; resolve: (value: unknown) => void; reject: (reason: unknown) => void };
  const pending: Pending[] = [];
  const saveNote = vi.fn((...args: unknown[]) => new Promise((resolve, reject) => {
    pending.push({ args, resolve, reject });
  }));
  return { pending, saveNote, saveDraftJournal: vi.fn(async () => {}) };
});

vi.mock("../lib/native", () => ({
  native: { saveNote: h.saveNote, saveDraftJournal: h.saveDraftJournal },
}));

import { useSavePipeline, type PersistOutcome } from "./useSavePipeline";
import type { NoteDocument } from "../lib/types";

const savedNote = (id: string, content: string): NoteDocument => ({
  id, title: "T", parentId: null, sortOrder: 0, updatedAt: "2026-09-30T00:00:00.000Z",
  syncState: "local", isConflict: false, content, kind: "doc",
});

const events: string[] = [];
let cacheIdx = 0;
type Api = ReturnType<typeof useSavePipeline>;
let api: Api | null = null;
function Harness({ caches }: { caches: Array<{ markdown: string | null; plain: string | null }> }) {
  api = useSavePipeline({
    onNoteSaved: (saved) => { events.push(`saved:${saved.id}`); },
    onOpenTabsApplied: (saved) => { events.push(`tabs:${saved.id}:${saved.content}`); },
    onDraftCleared: (id) => { events.push(`draft:${id}`); },
    onError: (message) => { events.push(`error:${message}`); },
    getOpenTab: () => ({ title: "T", content: "live" }),
    getEditorCaches: () => caches[Math.min(cacheIdx++, caches.length - 1)],
    captureContent: () => undefined,
  });
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  events.length = 0; h.pending.length = 0; cacheIdx = 0; h.saveNote.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); api = null; });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function render(caches: Array<{ markdown: string | null; plain: string | null }>) {
  act(() => root.render(createElement(Harness, { caches })));
}

describe("useSavePipeline 保存契约（审计 F01/F02）", () => {
  it("F01：saveNote 拒绝 → persistTab 返回 ok:false、报真实错误，且不 apply 成功态", async () => {
    render([{ markdown: "m", plain: "p" }]);
    let outcome: PersistOutcome | undefined;
    let p!: Promise<PersistOutcome>;
    act(() => { p = api!.persistTab("n1", "T", "v1"); });
    await act(async () => { await tick(); });
    h.pending[0]!.reject(new Error("ENOSPC 磁盘满"));
    await act(async () => { outcome = await p; });
    expect(outcome).toEqual({ ok: false });
    expect(events).toContain("error:ENOSPC 磁盘满");
    expect(events.some((e) => e.startsWith("tabs:"))).toBe(false);
    expect(events.some((e) => e.startsWith("draft:"))).toBe(false);
  });

  it("F02：入队前绑定 revision 快照——排队旧正文不会被新 revision ack 成最新", async () => {
    render([{ markdown: "m1", plain: "p1" }, { markdown: "m2", plain: "p2" }]);
    let p1!: Promise<PersistOutcome>;
    let p2!: Promise<PersistOutcome>;
    act(() => { p1 = api!.persistTab("n1", "T", "v1"); });
    act(() => { p2 = api!.persistTab("n1", "T", "v1b"); });
    act(() => { api!.bumpRevision("n1"); });
    await act(async () => { await tick(); });
    expect(h.saveNote).toHaveBeenCalledTimes(1);
    expect(h.saveNote.mock.calls[0]![2]).toBe("v1");
    expect(h.saveNote.mock.calls[0]![3]).toEqual({ markdown: "m1", plain: "p1" });
    await act(async () => { h.pending[0]!.resolve(savedNote("n1", "v1")); await p1; await tick(); });
    expect(h.saveNote).toHaveBeenCalledTimes(2);
    expect(h.saveNote.mock.calls[1]![2]).toBe("v1b");
    expect(h.saveNote.mock.calls[1]![3]).toEqual({ markdown: "m2", plain: "p2" });
    await act(async () => { h.pending[1]!.resolve(savedNote("n1", "v1b")); await p2; });
    expect(events.some((e) => e.startsWith("tabs:"))).toBe(false);
    expect(events.some((e) => e.startsWith("draft:"))).toBe(false);
  });

  it("无新编辑时 ack 正常 apply（回写标签 + 清草稿）", async () => {
    render([{ markdown: "m", plain: "p" }]);
    let outcome: PersistOutcome | undefined;
    let p!: Promise<PersistOutcome>;
    act(() => { p = api!.persistTab("n2", "T", "v"); });
    await act(async () => { await tick(); });
    h.pending[0]!.resolve(savedNote("n2", "v"));
    await act(async () => { outcome = await p; });
    expect(outcome).toEqual({ ok: true });
    expect(events).toContain("tabs:n2:v");
    expect(events).toContain("draft:n2");
  });
});
