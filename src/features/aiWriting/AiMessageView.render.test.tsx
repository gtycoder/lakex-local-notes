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

const previewMock = vi.hoisted(() => ({ openImagePreview: vi.fn() }));

/** 答案正文的内核 viewer 是 lazy 边界：本文件只测操作条，拦掉它避免真去加载内核 chunk。 */
vi.mock("./AiAnswerViewer", () => ({ default: () => null }));
vi.mock("../editor/imagePreview", () => ({ openImagePreview: previewMock.openImagePreview }));

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

describe("AiMessageView · 用户消息的随发图片（261116 Phase 1）", () => {
  const userMessage = (attachRefs?: AiWritingMessage["attachRefs"]): AiWritingMessage => ({
    ...MESSAGE,
    id: "u1",
    role: "user",
    content: "看这两张图",
    attachRefs,
  });

  it("用户气泡下方渲染缩略图（资源服务器直链，data 不转 base64）", () => {
    render({ message: userMessage([{ noteId: "n1", filename: "a.png" }, { noteId: "n2", filename: "b.jpg", name: "封面" }]) });
    const images = [...document.querySelectorAll<HTMLImageElement>(".aiw-bubble-attach__img")];
    expect(images.length).toBe(2);
    expect(images[0].getAttribute("src")).toContain("127.0.0.1");
    expect(images[0].getAttribute("src")).toContain("/n1/a.png");
    expect(images[1].getAttribute("alt")).toBe("封面");
    expect(document.querySelector(".aiw-msg--user .aiw-bubble")?.textContent).toBe("看这两张图");
  });

  it("历史轮缩略图可点开大图：传全尺寸档（不带 w）且定位到该张", () => {
    previewMock.openImagePreview.mockReset();
    render({ message: userMessage([{ noteId: "n1", filename: "a.png" }, { noteId: "n2", filename: "b.jpg" }]) });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".aiw-bubble-attach__preview")];
    expect(buttons.length).toBe(2);
    act(() => { buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(previewMock.openImagePreview).toHaveBeenCalledTimes(1);
    const [images, index] = previewMock.openImagePreview.mock.calls[0];
    expect(index).toBe(1);
    expect(images.length).toBe(2);
    expect(String(images[1].src)).not.toContain("w=");
    expect(String(images[0].src)).toContain("/n1/a.png");
  });

  it("本机图片附件：历史里显示缩略图且可点开大图（261116 用户反馈）", () => {
    previewMock.openImagePreview.mockReset();
    render({ message: userMessage([{ kind: "local", token: "loc-img", name: "cat.png", size: 2048, mimeType: "image/png" }]) });
    const img = document.querySelector<HTMLImageElement>(".aiw-bubble-attach__img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toContain("/ai-local/loc-img");
    const button = document.querySelector<HTMLButtonElement>(".aiw-bubble-attach__preview")!;
    act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(previewMock.openImagePreview).toHaveBeenCalledTimes(1);
    const [images] = previewMock.openImagePreview.mock.calls[0];
    expect(String(images[0].src)).toContain("/ai-local/loc-img");
  });

  it("本机文件附件 = 文件名 chip（渲染层没有字节，不画缩略图）", () => {
    render({ message: userMessage([{ kind: "local", token: "loc-1", name: "main.ts", size: 2048, mimeType: "text/plain" }]) });
    expect(document.querySelector(".aiw-bubble-attach__img")).toBeNull();
    const chip = document.querySelector(".aiw-bubble-file");
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain("main.ts");
    expect(chip!.textContent).toContain("2.0 KB");
  });

  it("没有附件的用户消息不渲染附件区", () => {
    render({ message: userMessage() });
    expect(document.querySelector(".aiw-bubble-attach")).toBeNull();
  });
});
