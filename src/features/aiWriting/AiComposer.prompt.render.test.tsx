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

/** 忙态渲染（生成中）：用于卡「停止」按钮与「↩ 发送」提示的显隐。 */
async function renderBusy() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiComposer
        mode="chat"
        input=""
        busy
        promptText={null}
        docRefs={[]}
        treeNodes={[]}
        onInput={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        onSetPrompt={() => {}}
        onSetDocRefs={() => {}}
      />,
    );
  });
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

describe("AiComposer · 生成中的「停止」（261111 用户报错位/颜色）", () => {
  it("停止 = 危险档红色按钮、正方形居中；「↩ 发送」提示在忙态隐藏", async () => {
    await renderBusy();
    const stop = document.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!;
    expect(stop).toBeTruthy();
    // 颜色语义 = 危险档（红字 + 红框），不再用中性 secondary
    expect(stop.className).toContain("ln-btn--danger");
    expect(stop.className).not.toContain("ln-btn--secondary");
    // 正方形、图标水平垂直居中（此前只有 width，图标被 gap 推偏 ⇒ 视觉错位）
    expect(stop.className).toContain("aiw-send--stop");
    // 忙态没有「↩ 发送」提示
    expect(document.querySelector(".aiw-composer__hint")).toBeNull();
    expect((stop.textContent || "").trim()).toBe("");
  });
});

describe("AiComposer · 生成中的「停止」（261111 用户报错位/颜色）", () => {
  it("停止 = 危险档红色按钮、正方形居中；「↩ 发送」提示在忙态隐藏", async () => {
    await renderBusy();
    const stop = document.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!;
    expect(stop).toBeTruthy();
    // 颜色语义 = 危险档（红字 + 红框），不再用中性 secondary
    expect(stop.className).toContain("ln-btn--danger");
    expect(stop.className).not.toContain("ln-btn--secondary");
    // 正方形 + 图标居中（此前只有 width，图标被 gap 推偏 ⇒ 视觉错位）
    expect(stop.className).toContain("aiw-send--stop");
    // 忙态不显示「↩ 发送」提示
    expect(document.querySelector(".aiw-composer__hint")).toBeNull();
  });
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

  it("输入卡控件走原语：工具钮 = ghost+compact，发送 = primary+compact", async () => {
    await renderComposer("");
    const tool = [...document.querySelectorAll(".aiw-composer__tools button")][0];
    expect(tool.className).toContain("ln-btn");
    expect(tool.className).toContain("ln-btn--ghost");
    expect(tool.className).toContain("ln-btn--compact");
    const send = document.querySelector<HTMLButtonElement>('.aiw-composer__send button[aria-label="发送"]')!;
    expect(send.className).toContain("ln-btn--primary");
    expect(send.className).toContain("ln-btn--compact");
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
