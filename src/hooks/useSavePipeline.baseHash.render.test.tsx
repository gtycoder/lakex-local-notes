// @vitest-environment jsdom
/**
 * 261110 回归护栏：保存成功后的 baseHash 刷新**不能受 revision 门控**。
 *
 * 事故链（dev 现场，2026-11-10 10:00）：保存期间用户继续打字 ⇒ revision 前进 ⇒ 旧实现跳过
 * onOpenTabsApplied（连带不刷 baseHash），但主进程那次已经写盘成功 ⇒ 下一笔保存拿旧基线，
 * 把"自己上一笔的写入"判成外部改动（同步记录 +1、顶栏角标常亮、误弹三选项）。
 */
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveNote = vi.fn();
vi.mock("../lib/native", () => ({ native: { saveNote: (...args: unknown[]) => saveNote(...args) } }));

import { useSavePipeline } from "./useSavePipeline";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let port: {
  persistTab: ReturnType<typeof useSavePipeline>["persistTab"];
  bumpRevision: ReturnType<typeof useSavePipeline>["bumpRevision"];
} | null = null;

function Harness({ callbacks, getTab }: { callbacks: Record<string, (...args: never[]) => void>; getTab: () => { title: string; content: string; baseHash?: string } }) {
  const pipe = useSavePipeline({
    onNoteSaved: callbacks.onNoteSaved as never,
    onOpenTabsApplied: callbacks.onOpenTabsApplied as never,
    onBaseHashRefreshed: callbacks.onBaseHashRefreshed as never,
    onDraftCleared: callbacks.onDraftCleared as never,
    onError: callbacks.onError as never,
    getOpenTab: getTab as never,
    getEditorCaches: (() => ({ markdown: null, plain: null })) as never,
    captureContent: (() => "body") as never,
  });
  useEffect(() => {
    port = { persistTab: pipe.persistTab, bumpRevision: pipe.bumpRevision };
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  saveNote.mockReset();
  port = null;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
});

const savedDoc = (contentHash: string) => ({
  id: "n1", title: "T", content: "body", updatedAt: "2026-11-10T02:00:36.992Z",
  contentHash, isDirty: true, kind: "doc",
});

describe("保存管线：baseHash 与 revision 解耦", () => {
  it("保存期间有新编辑（revision 前进）⇒ 仍刷新 baseHash，但不覆盖 content/dirty", async () => {
    const calls: string[] = [];
    let liveBaseHash = "H1";
    saveNote.mockResolvedValue(savedDoc("H2"));
    await act(async () => {
      root.render(createElement(Harness, {
        callbacks: {
          onNoteSaved: () => calls.push("saved"),
          onOpenTabsApplied: () => calls.push("applied"),
          onBaseHashRefreshed: () => { calls.push("hash"); liveBaseHash = "H2"; },
          onDraftCleared: () => undefined,
          onError: (message: never) => { throw new Error(String(message)); },
        } as never,
        getTab: () => ({ title: "T", content: "body", baseHash: liveBaseHash }),
      }));
    });
    expect(port).not.toBeNull();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => { pending = port!.persistTab("n1"); port!.bumpRevision("n1"); });
    await act(async () => { await pending; });
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect((saveNote.mock.calls[0] as unknown[])[4]).toBe("H1");
    expect(calls).toContain("hash");
    expect(calls).not.toContain("applied");
  });

  it("排队中的第二笔保存执行时读最新 baseHash（不用户列前的旧快照）", async () => {
    let liveBaseHash = "H1";
    saveNote.mockImplementationOnce(async () => ({ ...savedDoc("H2") }));
    saveNote.mockImplementationOnce(async () => ({ ...savedDoc("H3") }));
    await act(async () => {
      root.render(createElement(Harness, {
        callbacks: {
          onNoteSaved: () => undefined,
          onOpenTabsApplied: () => undefined,
          onBaseHashRefreshed: (saved: { contentHash?: string }) => { if (saved.contentHash) liveBaseHash = saved.contentHash; },
          onDraftCleared: () => undefined,
          onError: () => undefined,
        } as never,
        getTab: () => ({ title: "T", content: "body", baseHash: liveBaseHash }),
      }));
    });
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = port!.persistTab("n1");
      second = port!.persistTab("n1");
    });
    await act(async () => { await first; await second; });
    expect(saveNote).toHaveBeenCalledTimes(2);
    expect((saveNote.mock.calls[0] as unknown[])[4]).toBe("H1");
    expect((saveNote.mock.calls[1] as unknown[])[4]).toBe("H2");
  });
});
