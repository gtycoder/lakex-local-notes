// @vitest-environment jsdom
/**
 * 桌面 AI 助手「消息版本 / 分支」组件护栏（261116）。
 *
 * 语义对齐 chat-demo：
 * - 重新生成 ⇒ 同一提问下新增助手兄弟版本（◀ 2 / 2 ▶），生成中禁用切换；
 * - 切版本 ⇒ 面板内容跟随该分支（旧回答仍在树上、可切回）；
 * - 编辑提问 ⇒ 输入框回填原文，提交后新建提问兄弟版本并走新分支，旧分支可切回。
 *
 * 只隔离浮层定位与 IPC（与 aiAssistantProgress.test.ts 同口径）；消息树、切换器、
 * 输入/提交全部跑真实组件。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiChatResult } from "../../core/aiProviders";

const chat = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn() }));
vi.mock("../../lib/ai", () => ({ newAiRequestId: () => "versions-test", runAiChat: chat.run, cancelAiChat: chat.cancel }));
vi.mock("../../components/ui/Overlay", () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) => open === false ? null : children,
  NativeDialog: ({ open, children }: { open?: boolean; children: ReactNode }) => open === false ? null : children,
}));
vi.mock("../../hooks/usePopoverPosition", () => ({ usePopoverPosition: () => ({ surfaceRef: () => {}, style: {}, placed: true }) }));
import { AiAssistantDialog } from "./AiAssistantDialog";

/** 固定对象：面板的 [open, context] effect 依赖它，不能每次渲染新建。 */
const REQUEST = {
  context: { kind: "none" as const },
  placement: { kind: "floating" as const },
  outputs: [],
  applyOutput: () => false,
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let delta: (text: string) => void;
let settle: (result: AiChatResult) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  chat.run.mockReset(); chat.cancel.mockReset();
  chat.cancel.mockResolvedValue(undefined);
  chat.run.mockImplementation((_id, _messages, onDelta) => {
    delta = onDelta;
    return new Promise<AiChatResult>((resolve) => { settle = resolve; });
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(AiAssistantDialog, { open: true, scope: "library::", onClose: () => {}, request: REQUEST })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const field = () => host.querySelector("textarea")!;
function type(text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const buttonByText = (text: string) => [...host.querySelectorAll("button")].find((button) => button.textContent === text);
const buttonByLabel = (label: string) => host.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  act(() => (element as HTMLElement).click());
}
const versionGroup = (label: string) => host.querySelector('[role="group"][aria-label="' + label + '"]');
const versionText = (label: string) => versionGroup(label)?.querySelector(".ai-dialog__branches-count")?.textContent;
const versionButton = (label: string, direction: "上一个版本" | "下一个版本") =>
  versionGroup(label)?.querySelector<HTMLButtonElement>('button[aria-label="' + direction + '"]') ?? null;

async function answer(text: string) {
  act(() => delta(text));
  await act(async () => settle({ ok: true, text }));
}
function ask(question: string) {
  type(question);
  click(buttonByText("生成"));
  expect(chat.run).toHaveBeenCalledOnce();
}

describe("重新生成 = 助手兄弟版本", () => {
  it("新增版本后出现 ◀ n/m ▶、生成中禁用，切版本后消息内容变化且可切回", async () => {
    ask("第一问");
    await answer("回答一");
    expect(host.textContent).toContain("回答一");
    expect(versionGroup("回答版本")).toBeNull();   // 单版本不占位

    click(buttonByLabel("重新生成"));
    expect(chat.run).toHaveBeenCalledTimes(2);
    // 新版本生成中：2 / 2 已可见，但两个方向都禁用（用户裁决）
    expect(versionText("回答版本")).toBe("2 / 2");
    expect(versionButton("回答版本", "上一个版本")!.disabled).toBe(true);
    expect(versionButton("回答版本", "下一个版本")!.disabled).toBe(true);

    await answer("回答二");
    expect(versionText("回答版本")).toBe("2 / 2");
    expect(host.textContent).toContain("回答二");
    expect(host.textContent).not.toContain("回答一");   // 当前路径只渲染选中版本

    click(versionButton("回答版本", "上一个版本"));
    expect(versionText("回答版本")).toBe("1 / 2");
    expect(host.textContent).toContain("回答一");
    expect(host.textContent).not.toContain("回答二");
    expect(versionButton("回答版本", "上一个版本")!.disabled).toBe(true);

    click(versionButton("回答版本", "下一个版本"));
    expect(versionText("回答版本")).toBe("2 / 2");
    expect(host.textContent).toContain("回答二");
  });

  it("切版本不强制贴底：滚动位置保持（不跳到最新回答）", async () => {
    ask("第一问");
    await answer("回答一");
    click(buttonByLabel("重新生成"));
    await answer("回答二号");

    // jsdom 没有布局：用自定义属性模拟滚动几何（与 useStickToBottom.render.test.tsx 同法）。
    const body = host.querySelector<HTMLElement>(".ai-dialog__body")!;
    let scrollTop = 300;
    Object.defineProperty(body, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(body, "clientHeight", { configurable: true, get: () => 100 });
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = Math.max(0, Math.min(value, 900)); },
    });
    scrollTop = 300;

    click(versionButton("回答版本", "上一个版本"));
    // 若仍处于贴底跟随，useStickToBottom 会把它设成 scrollHeight（夹到 900）⇒ 这里必须是原位。
    expect(scrollTop).toBe(300);
    expect(host.textContent).toContain("回答一");
  });
});

describe("编辑提问 = 从该点分叉", () => {
  it("回填原文；提交后新建提问兄弟版本（2 / 2），旧分支完整保留可切回", async () => {
    ask("原始提问");
    await answer("原始回答");

    click(buttonByLabel("编辑提问"));
    expect(field().value).toBe("原始提问");
    expect(host.textContent).toContain("正在编辑提问：提交后从这条提问分叉，原分支保留");

    type("改写提问");
    click(buttonByText("更新"));
    expect(chat.run).toHaveBeenCalledTimes(2);
    // 新提问生成中：提问已有两个版本，切换器可见但禁用
    expect(versionText("提问版本")).toBe("2 / 2");
    expect(versionButton("提问版本", "上一个版本")!.disabled).toBe(true);

    await answer("新回答");
    expect(host.textContent).toContain("改写提问");
    expect(host.textContent).toContain("新回答");
    expect(versionText("提问版本")).toBe("2 / 2");

    // 切回旧提问版本：旧提问 + 旧回答整条分支原样回来
    click(versionButton("提问版本", "上一个版本"));
    expect(versionText("提问版本")).toBe("1 / 2");
    expect(host.textContent).toContain("原始提问");
    expect(host.textContent).toContain("原始回答");
    expect(host.textContent).not.toContain("改写提问");
  });
});
