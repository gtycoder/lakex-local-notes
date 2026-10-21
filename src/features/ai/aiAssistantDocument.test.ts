// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiChatResult } from "../../core/aiProviders";

const nativeMock = vi.hoisted(() => ({ readNoteCaches: vi.fn() }));
const chat = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn() }));
vi.mock("../../lib/ai", () => ({ newAiRequestId: () => "doc-test", runAiChat: chat.run, cancelAiChat: chat.cancel }));
vi.mock("../../lib/native", () => ({ native: nativeMock }));
// 只隔离浮层定位与 IPC；面板状态、开关、输入与发送全部跑真实组件。
vi.mock("../../components/ui/Overlay", () => ({ Popover: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null }));
vi.mock("../../hooks/usePopoverPosition", () => ({ usePopoverPosition: () => ({ surfaceRef: () => {}, style: {}, placed: true }) }));
import { AiAssistantDialog } from "./AiAssistantDialog";

const DOC = "# 标题\n\n正文内容";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let settle: (result: AiChatResult) => void;
let delta: (text: string) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nativeMock.readNoteCaches.mockReset();
  nativeMock.readNoteCaches.mockResolvedValue({ markdown: DOC, plain: "标题 正文内容" });
  chat.run.mockReset(); chat.cancel.mockReset();
  chat.run.mockImplementation((_id, _messages, onDelta) => {
    delta = onDelta;
    return new Promise<AiChatResult>((resolve) => { settle = resolve; });
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render() {
  act(() => root.render(createElement(AiAssistantDialog, {
    open: true, selectionText: "", noteId: "note-1", onClose: () => {},
    onInsertAfter: () => {}, onReplace: () => {},
  })));
}
const switchEl = () => host.querySelector<HTMLButtonElement>('[aria-label="附加当前文档全文"]')!;
const byText = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

async function toggleDocument() {
  await act(async () => { switchEl().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

function typeInstruction(text: string) {
  const field = host.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AI 当前文档全文（261021 P1）", () => {
  it("默认关：不读缓存、不带全文；打开开关才按需读一次", async () => {
    render();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(nativeMock.readNoteCaches).not.toHaveBeenCalled();
    expect(host.textContent).toContain("开启后，发送时会把已保存的整篇正文发给 AI 供应商");

    await toggleDocument();
    expect(nativeMock.readNoteCaches).toHaveBeenCalledWith("note-1");
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toMatch(/已附加 \d+ 字符（约 \d+ 字，已保存版本）/);
  });

  it("发送时用全文定界符（替代选区）；system 提示词解释全文块", async () => {
    render();
    await toggleDocument();
    typeInstruction("请总结这篇文档");
    act(() => byText("生成")!.click());

    expect(chat.run).toHaveBeenCalledOnce();
    const messages = chat.run.mock.calls[0][1] as { role: string; content: string }[];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("【全文开始】");
    expect(messages[0].content).toContain("有全文块时");
    expect(messages[1].content).toBe("请总结这篇文档\n\n【全文开始】\n" + DOC + "\n【全文结束】");
  });

  it("开聊后锁定开关；全文结果不出现「插入到选区后 / 替换选区」", async () => {
    render();
    await toggleDocument();
    typeInstruction("请总结这篇文档");
    act(() => byText("生成")!.click());
    expect(switchEl().disabled).toBe(true);

    act(() => delta("结果"));
    await act(async () => settle({ ok: true, text: "结果" }));
    expect(byText("插入到选区后")).toBeUndefined();
    expect(byText("替换选区")).toBeUndefined();
    expect(host.textContent).toContain("全文模式的结果不自动回写，请复制使用");
  });

  it("超上限显式截断（不静默省略）", async () => {
    nativeMock.readNoteCaches.mockResolvedValue({ markdown: "字".repeat(60_001), plain: null });
    render();
    await toggleDocument();
    expect(host.textContent).toContain("超上限已截断");
  });

  it("没有文本缓存时给明确原因、开关保持关闭、不发请求", async () => {
    nativeMock.readNoteCaches.mockResolvedValue({ markdown: null, plain: "   " });
    render();
    await toggleDocument();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain("该文档还没有文本缓存，请先打开并保存一次");
    expect(chat.run).not.toHaveBeenCalled();
  });
});
