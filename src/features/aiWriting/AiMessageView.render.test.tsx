// @vitest-environment jsdom
/**
 * AI 写作操作条：「复制为 Lake」（261110 需求 #3）。
 *
 * 用户原话：「AI 写作所有的输出提供转为 lake 的功能，类似文档的 AI 弹窗里的输出。」
 * 口径与文档 AI 弹窗一致：**每条**助手回答（有 content 时）都带按钮、lake 文字徽标、
 * 成功勾 1200ms 后复原、流式中不出现（按钮禁用条件 = 该条正在流式 + 操作条只在空闲时渲染）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWritingMessage } from "../../core/aiWriting";
import type { AiWritingStream } from "./useAiWriting";
import { AiMessageView, type AiMessageViewProps } from "./AiMessageView";

/** 答案正文的内核 viewer 是 lazy 边界：本文件只测操作条，拦掉它避免真去加载内核 chunk。 */
vi.mock("./AiAnswerViewer", () => ({ default: () => null }));

const MESSAGE: AiWritingMessage = {
  id: "m1",
  conversationId: "c1",
  role: "assistant",
  content: "## 标题\n\n正文一段。",
  reasoning: null,
  durationMs: 1200,
  stopped: false,
  error: null,
  sortOrder: 1,
  createdAt: "2026-11-10T00:00:00.000Z",
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function props(overrides: Partial<AiMessageViewProps> = {}): AiMessageViewProps {
  return {
    message: { ...MESSAGE },
    stream: null,
    busy: false,
    onRegenerate: vi.fn(),
    onCopy: vi.fn(),
    onCopyAsLake: vi.fn(() => Promise.resolve(true)),
    onPublish: vi.fn(),
    onSaveQuickNote: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<AiMessageViewProps> = {}): AiMessageViewProps {
  const value = props(overrides);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<AiMessageView {...value} />); });
  return value;
}

const lakeButton = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('[aria-label="复制为 Lake"]');
const badgeText = (): string | null =>
  lakeButton()?.querySelector(".aiw-lake-badge")?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AiMessageView · 复制为 Lake", () => {
  it("有 content 的助手消息带「复制为 Lake」按钮：aria-label/title 与 lake 徽标", () => {
    render();
    const button = lakeButton();
    expect(button).toBeTruthy();
    expect(button!.getAttribute("title")).toBe("复制为 Lake");
    expect(button!.className).toContain("ln-iconbtn--compact");
    expect(badgeText()).toBe("lake");
  });

  it("点击调用注入的回调，成功显示勾，1200ms 后复原为 lake 徽标", async () => {
    const onCopyAsLake = vi.fn(() => Promise.resolve(true));
    render({ onCopyAsLake });
    expect(badgeText()).toBe("lake");

    await act(async () => {
      lakeButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(onCopyAsLake).toHaveBeenCalledTimes(1);
    expect(onCopyAsLake).toHaveBeenCalledWith(MESSAGE.content);
    expect(lakeButton()!.classList.contains("is-selected")).toBe(true);
    expect(badgeText()).toBeNull();

    act(() => { vi.advanceTimersByTime(1200); });
    expect(lakeButton()!.classList.contains("is-selected")).toBe(false);
    expect(badgeText()).toBe("lake");
  });

  it("复制失败（回调返回 false）静默：不显示勾、不复原计时", async () => {
    render({ onCopyAsLake: vi.fn(() => Promise.resolve(false)) });
    await act(async () => {
      lakeButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(lakeButton()!.classList.contains("is-selected")).toBe(false);
    expect(badgeText()).toBe("lake");
  });

  it("该条正在流式时不出现「复制为 Lake」（操作条空闲才渲染，按钮本身也带 disabled 判据）", () => {
    const stream: AiWritingStream = { messageId: MESSAGE.id, content: "流式输出中", reasoning: "" };
    render({ stream, busy: true });
    expect(lakeButton()).toBeNull();
  });

  it("没有 content 的助手消息不出现「复制为 Lake」", () => {
    render({ message: { ...MESSAGE, content: "" } });
    expect(lakeButton()).toBeNull();
  });
});
