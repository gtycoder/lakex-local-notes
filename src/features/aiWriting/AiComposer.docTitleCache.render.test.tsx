// @vitest-environment jsdom
/**
 * P1-3 护栏：AiComposer 的 treeNodes → 文档标题 Map 只在 treeNodes 变化时重建。
 *
 * 打字（input 受控）会让整个 workspace/composer 重渲染；旧实现在**每次渲染**里重新 filter+map
 * 整棵树（20k 文档目标下实测 ~1.5ms/键）。这里用 spy 卡住「重建次数」。
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

const h = vi.hoisted(() => ({ buildCalls: 0 }));

vi.mock("./aiWritingDocs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./aiWritingDocs")>();
  return {
    ...actual,
    buildDocTitleMap: (nodes: readonly TreeNode[]) => {
      h.buildCalls += 1;
      return actual.buildDocTitleMap(nodes);
    },
  };
});
vi.mock("../../lib/native", () => ({ native: { listNoteImageAssets: vi.fn(), listAllNoteImages: vi.fn() } }));
vi.mock("../editor/imagePreview", () => ({ openImagePreview: vi.fn() }));

import { AiComposer } from "./AiComposer";

class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

function node(index: number): TreeNode {
  return { id: "n" + index, noteFileId: "f" + index, nodeType: "note", title: "文档" + index } as unknown as TreeNode;
}
const TREE_A: TreeNode[] = Array.from({ length: 20 }, (_, index) => node(index));
const TREE_B: TreeNode[] = [...TREE_A];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function Harness() {
  const [input, setInput] = useState("");
  const [tree, setTree] = useState<TreeNode[]>(TREE_A);
  return (
    <div>
      <button type="button" onClick={() => setInput((prev) => prev + "a")}>type</button>
      <button type="button" onClick={() => setTree(TREE_B)}>new-tree</button>
      <AiComposer
        mode="chat"
        input={input}
        busy={false}
        promptText={null}
        docRefs={[]}
        attachRefs={[]}
        treeNodes={tree}
        thinking
        onInput={setInput}
        onSend={() => undefined}
        onStop={() => undefined}
        onThinkingChange={() => undefined}
        onSetPrompt={() => undefined}
        onSetDocRefs={() => undefined}
        onAddAttachments={() => undefined}
        onRemoveAttachment={() => undefined}
        onPickLocalFiles={() => undefined}
        onPasteImages={() => undefined}
      />
    </div>
  );
}

const click = (label: string) => act(() => {
  [...document.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.buildCalls = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<Harness />); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("AiComposer · 文档标题 Map 缓存（P1-3）", () => {
  it("打字/重渲染不重建 Map；只有 treeNodes 换引用才重建", () => {
    expect(h.buildCalls).toBe(1);
    click("type");
    click("type");
    click("type");
    expect(h.buildCalls).toBe(1);

    click("new-tree");
    expect(h.buildCalls).toBe(2);
  });
});
