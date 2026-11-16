// @vitest-environment jsdom
/**
 * AI 写作输入卡（261116 chat-demo 定稿）交互：
 * ① 提示词库点卡片直接写入输入框（261110 定稿的既有能力，不许被造型改写弄丢）；
 * ② 底部一行：深度思考药丸（默认开、可关）+ 提示词 / 请选择文档药丸；
 * ③ 添加附件是**占位 disabled**（不伪造可用）；
 * ④ 生成中同格变停止（红底圆形），且忙态禁用深度思考。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiComposer } from "./AiComposer";
import { AI_WRITING_PROMPT_CARDS } from "./aiWritingPrompts";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

// jsdom 没有 ResizeObserver（浮层定位 hook 会用到）：与其它 render 用例同一份最小桩。
class ResizeObserverStub {
  observe() { /* noop */ }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

interface RenderOptions {
  input?: string;
  promptText?: string | null;
  busy?: boolean;
  thinking?: boolean;
  mode?: "chat" | "docs";
}

async function renderComposer(options: RenderOptions = {}) {
  const { input = "", promptText = null, busy = false, thinking = true, mode = "chat" } = options;
  const onInput = vi.fn();
  const onSetPrompt = vi.fn();
  const onThinkingChange = vi.fn();
  const onSend = vi.fn();
  const onStop = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiComposer
        mode={mode}
        input={input}
        busy={busy}
        promptText={promptText}
        docRefs={[]}
        treeNodes={[]}
        thinking={thinking}
        onInput={onInput}
        onSend={onSend}
        onStop={onStop}
        onThinkingChange={onThinkingChange}
        onSetPrompt={onSetPrompt}
        onSetDocRefs={() => {}}
      />,
    );
  });
  return { onInput, onSetPrompt, onThinkingChange, onSend, onStop };
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
}

function clickPromptTool(): void {
  const tool = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("提示词"));
  expect(tool).toBeTruthy();
  tool!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function clickCard(title: string): void {
  const card = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent || "").includes(title));
  expect(card, "提示词卡片：" + title).toBeTruthy();
  card!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
});

describe("AiComposer · 底部一行（261116 chat-demo）", () => {
  it("深度思考药丸：默认开（is-on + aria-pressed），点击可关", async () => {
    const { onThinkingChange } = await renderComposer({ thinking: true });
    const pill = buttonByLabel("深度思考")!;
    expect(pill).toBeTruthy();
    expect(pill.className).toContain("aiw-pill");
    expect(pill.className).toContain("is-on");
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(pill.textContent).toContain("深度思考");
    pill.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onThinkingChange).toHaveBeenCalledWith(false);
  });

  it("深度思考关闭态：没有 is-on，aria-pressed=false", async () => {
    await renderComposer({ thinking: false });
    const pill = buttonByLabel("深度思考")!;
    expect(pill.className).not.toContain("is-on");
    expect(pill.getAttribute("aria-pressed")).toBe("false");
  });

  it("提示词药丸：仍是右下角弹层的锚（点击后出现提示词卡片）", async () => {
    await renderComposer();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0);
    await act(async () => { clickPromptTool(); });
    await flush();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
  });

  it("docs 模式才有「请选择文档」药丸；chat 模式没有", async () => {
    await renderComposer({ mode: "docs" });
    expect([...document.querySelectorAll(".aiw-pill")].some((b) => (b.textContent || "").includes("请选择文档"))).toBe(true);
    act(() => { root!.unmount(); });
    host.remove();
    await renderComposer({ mode: "chat" });
    expect([...document.querySelectorAll(".aiw-pill")].some((b) => (b.textContent || "").includes("请选择文档"))).toBe(false);
  });

  it("添加附件 = 占位 disabled（aria-label + title 说明下一批接入，不伪造可用）", async () => {
    await renderComposer();
    const attach = buttonByLabel("添加附件")!;
    expect(attach).toBeTruthy();
    expect(attach.disabled).toBe(true);
    expect(attach.className).toContain("aiw-attach");
    expect(attach.getAttribute("title")).toContain("下一批接入");
    expect(attach.textContent?.trim()).toBe("");
  });

  it("发送 = 圆形主色按钮；忙态同格变停止（红底圆形），且深度思考被禁用", async () => {
    await renderComposer({ busy: false, input: "", thinking: true });
    const send = buttonByLabel("发送")!;
    expect(send).toBeTruthy();
    expect(send.className).toContain("aiw-send-circle");
    expect(send.className).not.toContain("aiw-send-circle--stop");
    // 空输入不可发送（disabled 45% 由 CSS 的 --lake-disabled-opacity 给）
    expect(send.disabled).toBe(true);
    expect(buttonByLabel("停止生成")).toBeNull();

    act(() => { root!.unmount(); });
    host.remove();
    await renderComposer({ busy: true, input: "写点什么", thinking: true });
    const stop = buttonByLabel("停止生成")!;
    expect(stop).toBeTruthy();
    expect(stop.className).toContain("aiw-send-circle");
    expect(stop.className).toContain("aiw-send-circle--stop");
    expect(buttonByLabel("发送")).toBeNull();
    // 忙态不让改档（避免半途换 thinking 造成同一会话两种请求）
    expect(buttonByLabel("深度思考")!.disabled).toBe(true);
    // 旧的「↩ 发送」提示已随 chat-demo 造型移除
    expect(document.querySelector(".aiw-composer__hint")).toBeNull();
  });
});

describe("AiComposer · 生成中的「停止」（261111 用户报错位/颜色）", () => {
  it("停止按钮是圆形、居中、图标不被 gap 推偏（文案为空）", async () => {
    await renderComposer({ busy: true });
    const stop = buttonByLabel("停止生成")!;
    expect(stop.className).toContain("aiw-send-circle--stop");
    expect((stop.textContent || "").trim()).toBe("");
  });
});

describe("AiComposer · 提示词库点卡片直接写入输入框", () => {
  it("空输入：点卡片 ⇒ 完整提示词进入输入框，并清掉旧 chip", async () => {
    const { onInput, onSetPrompt } = await renderComposer({ input: "" });
    await act(async () => { clickPromptTool(); });
    await flush();
    await act(async () => { clickCard(AI_WRITING_PROMPT_CARDS[0].title); });
    await flush();
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith(AI_WRITING_PROMPT_CARDS[0].prompt);
    expect(onSetPrompt).toHaveBeenCalledWith(null);
  });

  it("已有文字：换行追加，不覆盖用户已输入的内容", async () => {
    const { onInput } = await renderComposer({ input: "这是我已经写的内容" });
    await act(async () => { clickPromptTool(); });
    await flush();
    await act(async () => { clickCard(AI_WRITING_PROMPT_CARDS[1].title); });
    await flush();
    expect(onInput).toHaveBeenCalledWith("这是我已经写的内容\n" + AI_WRITING_PROMPT_CARDS[1].prompt);
  });

  it("输入卡控件仍是 kit 原语（药丸/圆钮之外不新造按钮视觉）", async () => {
    await renderComposer({ promptText: AI_WRITING_PROMPT_CARDS[0].prompt });
    // 提示词 chip 的关闭钮 = .ln-iconbtn 原语
    const close = buttonByLabel("移除提示词");
    expect(close?.className).toContain("ln-iconbtn");
  });

  it("点击后面板关闭（不再停留在打开态）", async () => {
    await renderComposer();
    await act(async () => { clickPromptTool(); });
    await flush();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    await act(async () => { clickCard(AI_WRITING_PROMPT_CARDS[0].title); });
    await flush();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0);
  });
});
