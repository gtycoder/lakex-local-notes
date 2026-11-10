// @vitest-environment jsdom
/**
 * 提示词库交互（261110 用户定稿）：点卡片 = 把完整提示词**直接写进输入框**，
 * 不再挂 chip；已有文字时换行追加、不覆盖；顺带清掉旧 chip 的 promptText。
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

async function renderComposer(input: string, promptText: string | null = null) {
  const onInput = vi.fn();
  const onSetPrompt = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiComposer
        mode="chat"
        input={input}
        busy={false}
        promptText={promptText}
        docRefs={[]}
        treeNodes={[]}
        onInput={onInput}
        onSend={() => {}}
        onStop={() => {}}
        onSetPrompt={onSetPrompt}
        onSetDocRefs={() => {}}
      />,
    );
  });
  return { onInput, onSetPrompt };
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

describe("AiComposer · 提示词库点卡片直接写入输入框", () => {
  it("空输入：点卡片 ⇒ 完整提示词进入输入框，并清掉旧 chip", async () => {
    const { onInput, onSetPrompt } = await renderComposer("");
    await act(async () => { clickPromptTool(); });
    await flush();
    await act(async () => { clickCard(AI_WRITING_PROMPT_CARDS[0].title); });
    await flush();
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith(AI_WRITING_PROMPT_CARDS[0].prompt);
    expect(onSetPrompt).toHaveBeenCalledWith(null);
  });

  it("已有文字：换行追加，不覆盖用户已输入的内容", async () => {
    const { onInput } = await renderComposer("这是我已经写的内容");
    await act(async () => { clickPromptTool(); });
    await flush();
    await act(async () => { clickCard(AI_WRITING_PROMPT_CARDS[1].title); });
    await flush();
    expect(onInput).toHaveBeenCalledWith("这是我已经写的内容\n" + AI_WRITING_PROMPT_CARDS[1].prompt);
  });

  it("点击后面板关闭（不再停留在打开态）", async () => {
    await renderComposer("");
    await act(async () => { clickPromptTool(); });
    await flush();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    await act(async () => { clickCard(AI_WRITING_PROMPT_CARDS[0].title); });
    await flush();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0);
  });
});
