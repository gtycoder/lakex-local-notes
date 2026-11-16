// @vitest-environment jsdom
/**
 * 模式切换强判据（261116 第四稿）：切模式 = 新会话视图 + 清空 docRefs/attachRefs/输入 + 取消在途请求。
 * 这里用最小 harness 直接跑 hook（native 全部 mock），把状态暴露到 DOM 上断言。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  aiWritingList: vi.fn(async () => [] as unknown[]),
  aiWritingGet: vi.fn(async (_id: string) => null as unknown),
  aiWritingComposer: vi.fn(async () => null),
  aiSaveSettings: vi.fn(),
  aiGetSettings: vi.fn(async () => ({ activeProviderId: "deepseek", providers: [{ id: "deepseek", label: "DeepSeek", hasApiKey: true, model: "deepseek-chat" }] })),
  aiCancel: vi.fn(async () => undefined),
  aiSavePastedImage: vi.fn(async () => ({ kind: "local", token: "paste-t", name: "p.png", size: 3, mimeType: "image/png" })),
}));
vi.mock("../../lib/native", () => ({
  native: {
    aiWritingList: h.aiWritingList,
    aiWritingGet: h.aiWritingGet,
    aiWritingComposer: h.aiWritingComposer,
    aiGetSettings: h.aiGetSettings,
    aiCancel: h.aiCancel,
    aiSavePastedImage: h.aiSavePastedImage,
    aiWritingAppendMessage: vi.fn(),
    aiWritingUpdateMessage: vi.fn(),
    aiWritingDeleteLastAssistant: vi.fn(),
    aiWritingCreate: vi.fn(),
    aiWritingRename: vi.fn(),
    aiWritingDelete: vi.fn(),
    pickAiLocalFiles: vi.fn(async () => []),
    onAiStream: vi.fn(() => () => {}),
    readNoteCaches: vi.fn(), readNote: vi.fn(), readQuickNote: vi.fn(),
  },
}));

import { useAiWriting } from "./useAiWriting";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
const flush = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function Harness() {
  const controller = useAiWriting({ active: true });
  return (
    <div>
      <output data-testid="state">{JSON.stringify({
        mode: controller.mode,
        docRefs: controller.docRefs.length,
        attachRefs: controller.attachRefs.length,
        attachKeys: controller.attachRefs.map((ref) => ("noteId" in ref ? ref.noteId + "/" + ref.filename : "local")),
        input: controller.input,
        promptText: controller.promptText,
        loadError: controller.loadError,
        messages: controller.messages.length,
        activeId: controller.activeConversation?.id ?? null,
      })}</output>
      <button type="button" onClick={() => controller.selectConversation("c1")}>select</button>
      <button type="button" onClick={() => controller.setMode("chat")}>switch-chat</button>
      <button type="button" onClick={() => controller.setMode("docs")}>switch-docs</button>
      <button type="button" onClick={() => controller.setInput("草稿")}>type</button>
      <button type="button" onClick={() => controller.addAttachments([{ noteId: "n0", filename: "a.png" }, { noteId: "n1", filename: "b.png" }])}>add-attach</button>
      <button type="button" onClick={() => controller.setDocRefs([{ kind: "note", id: "n1", title: "文档1" }])}>prune-docs</button>
      <button type="button" onClick={() => { void controller.pasteImages([{ type: "image/png", size: 3, name: "p.png", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as File]); }}>paste-image</button>
    </div>
  );
}

const state = (): Record<string, unknown> => JSON.parse(document.querySelector('[data-testid="state"]')!.textContent!);
const click = (label: string) => act(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
});

beforeEach(() => {
  h.aiWritingComposer.mockClear();
  h.aiWritingGet.mockResolvedValue({
    conversation: {
      id: "c1", mode: "docs", title: "知识库问答", promptText: "分三点",
      docRefs: Array.from({ length: 23 }, (_, i) => ({ kind: "note", id: "n" + i, title: "文档" + i })),
      createdAt: "", updatedAt: "",
    },
    messages: [{ role: "user", content: "问题", attachRefs: [] }],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<Harness />); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  document.body.innerHTML = "";
});

describe("useAiWriting · 模式切换", () => {
  it("docs 会话带 23 篇文档；切到对话写作 = 新视图 + 清空 docRefs/附件/输入 + 不动旧会话", async () => {
    await flush();
    click("select");
    await flush();
    expect(state().mode).toBe("docs");
    expect(state().docRefs).toBe(23);
    click("type");
    click("switch-chat");
    await flush();
    const next = state();
    expect(next.mode).toBe("chat");
    expect(next.docRefs).toBe(0);
    expect(next.attachRefs).toBe(0);
    expect(next.input).toBe("");
    expect(next.promptText).toBeNull();
    expect(next.messages).toBe(0);
    expect(next.activeId).toBeNull();
    // 旧会话不被写改（没有 composer patch、没有自动切换会话）
    expect(h.aiWritingComposer).not.toHaveBeenCalled();
    expect(h.aiWritingGet).toHaveBeenCalledTimes(1);
  });

  it("docs 模式换选文档 ⇒ 引用被移除文档的附件一并清掉（不留悬空附件）", async () => {
    await flush();
    click("select");
    await flush();
    click("add-attach");
    expect((state().attachKeys as string[]).sort()).toEqual(["n0/a.png", "n1/b.png"]);
    click("prune-docs");
    expect(state().docRefs).toBe(1);
    expect(state().attachKeys).toEqual(["n1/b.png"]);
  });

  it("粘贴图片：chat 模式落盘并加引用；docs 模式拒绝且不保存", async () => {
    h.aiSavePastedImage.mockClear();
    await flush();
    click("paste-image");
    await flush();
    expect(h.aiSavePastedImage).toHaveBeenCalledTimes(1);
    expect(state().attachKeys).toEqual(["local"]);

    click("switch-docs"); // 切模式清空附件视图
    await flush();
    h.aiSavePastedImage.mockClear();
    click("paste-image");
    await flush();
    expect(h.aiSavePastedImage).not.toHaveBeenCalled();
    expect(state().attachKeys).toEqual([]);
    expect(String(state().loadError)).toContain("多文档推理");
  });

  it("打开 chat 会话时忽略历史里残留的 docRefs（纯对话判据）", async () => {
    h.aiWritingGet.mockResolvedValueOnce({
      conversation: { id: "c2", mode: "chat", title: "对话", promptText: null, docRefs: [{ kind: "note", id: "n1", title: "旧文档" }], createdAt: "", updatedAt: "" },
      messages: [],
    });
    h.aiWritingList.mockResolvedValueOnce([]);
    await flush();
    click("select");
    await flush();
    expect(state().mode).toBe("chat");
    expect(state().docRefs).toBe(0);
  });
});
