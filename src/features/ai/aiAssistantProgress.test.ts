// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiChatResult } from "../../core/aiProviders";

const chat = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn() }));
vi.mock("../../lib/ai", () => ({ newAiRequestId: () => "progress-test", runAiChat: chat.run, cancelAiChat: chat.cancel }));
// 只隔离浮层定位与 IPC；面板状态、输入、增量渲染和停止逻辑均运行真实组件。
vi.mock("../../components/ui/Overlay", () => ({ Popover: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null }));
vi.mock("../../hooks/usePopoverPosition", () => ({ usePopoverPosition: () => ({ surfaceRef: () => {}, style: {}, placed: true }) }));
import { AiAssistantDialog } from "./AiAssistantDialog";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let delta: (text: string) => void;
let settle: (result: AiChatResult) => void;
let reject: (error: Error) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  chat.run.mockReset(); chat.cancel.mockReset();
  chat.cancel.mockResolvedValue(undefined);
  chat.run.mockImplementation((_id, _messages, onDelta) => {
    delta = onDelta;
    return new Promise<AiChatResult>((resolve, fail) => { settle = resolve; reject = fail; });
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(AiAssistantDialog, { open: true, selectionText: "", onClose: () => {} })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label);
  expect(button).toBeTruthy();
  act(() => button!.click());
}
function start() {
  const field = host.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "请解释这个问题");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  click("生成");
  expect(chat.run).toHaveBeenCalledOnce();
}
const progress = () => host.querySelector('[role="status"]');

describe("AI 请求状态反馈", () => {
  it("发送前没有状态，等待首段回复时立即出现图标与文字", () => {
    expect(progress()).toBeNull();
    start();
    expect(progress()?.textContent).toBe("正在等待回复…");
    expect(progress()?.querySelector("svg.spin")?.getAttribute("aria-hidden")).toBe("true");
    expect(progress()?.getAttribute("aria-live")).toBe("polite");
  });
  it("输出中显示生成状态，成功后移除且保留回答", async () => {
    start(); act(() => delta("这是回答"));
    expect(progress()?.textContent).toBe("正在生成…");
    await act(async () => settle({ ok: true, text: "这是回答" }));
    expect(progress()).toBeNull();
    expect(host.textContent).toContain("这是回答");
    expect(host.querySelector('[aria-label="复制文字"]')).not.toBeNull();
  });
  it("只有空白增量仍视为等待，不误报正文已开始", () => {
    start(); act(() => delta(" \n"));
    expect(progress()?.textContent).toBe("正在等待回复…");
  });
  it("点击停止后立即停止动效，不必等待请求返回", async () => {
    start(); click("停止");
    expect(progress()).toBeNull();
    expect(chat.cancel).toHaveBeenCalledWith("progress-test");
    await act(async () => settle({ ok: false, error: "cancelled" }));
    expect(host.textContent).toContain("已停止生成，已生成的内容保留");
    expect(host.querySelector(".ai-dialog__msg--assistant")).toBeNull();
  });
  it("供应商失败时移除状态并显示原因", async () => {
    start(); await act(async () => settle({ ok: false, error: "模型暂不可用" }));
    expect(progress()).toBeNull(); expect(host.textContent).toContain("模型暂不可用");
  });
  it("请求抛错时同样不遗留转圈状态", async () => {
    start(); await act(async () => reject(new Error("连接断开")));
    expect(progress()).toBeNull(); expect(host.textContent).toContain("连接断开");
  });
});
