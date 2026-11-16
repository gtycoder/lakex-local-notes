// @vitest-environment jsdom
/**
 * AI 写作输入卡（261116 chat-demo 定稿）交互：
 * ① 提示词库点卡片直接写入输入框（261110 定稿的既有能力，不许被造型改写弄丢）；
 * ② 底部一行：深度思考药丸（默认开、可关）+ 提示词 / 请选择文档药丸；
 * ③ 添加附件：对话写作 = 菜单（文档资产图片 / 本机文件）；多文档 = 只开所选文档选图器；
 * ④ 生成中同格变停止（红底圆形），且忙态禁用深度思考。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ listNoteImageAssets: vi.fn(), listAllNoteImages: vi.fn(), openImagePreview: vi.fn() }));
vi.mock("../../lib/native", () => ({ native: { listNoteImageAssets: h.listNoteImageAssets, listAllNoteImages: h.listAllNoteImages } }));
vi.mock("../editor/imagePreview", () => ({ openImagePreview: h.openImagePreview }));

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
  docRefs?: never[];
  attachRefs?: Array<{ noteId: string; filename: string; name?: string } | { kind: "local"; token: string; name: string; size: number; mimeType: string; pages?: number }>;
  onAddAttachments?: (refs: readonly unknown[]) => void;
  onRemoveAttachment?: (asset: unknown) => void;
  onPickLocalFiles?: () => void;
  onPasteImages?: (files: File[]) => void;
}

async function renderComposer(options: RenderOptions = {}) {
  const { input = "", promptText = null, busy = false, thinking = true, mode = "chat", attachRefs = [], onAddAttachments = vi.fn(), onRemoveAttachment = vi.fn(), onPickLocalFiles = vi.fn(), onPasteImages = vi.fn() } = options;
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
        attachRefs={attachRefs}
        treeNodes={[]}
        thinking={thinking}
        onInput={onInput}
        onSend={onSend}
        onStop={onStop}
        onThinkingChange={onThinkingChange}
        onSetPrompt={onSetPrompt}
        onSetDocRefs={() => {}}
        onAddAttachments={onAddAttachments}
        onRemoveAttachment={onRemoveAttachment}
        onPickLocalFiles={onPickLocalFiles}
        onPasteImages={onPasteImages}
      />,
    );
  });
  return { onInput, onSetPrompt, onThinkingChange, onSend, onStop, onAddAttachments, onRemoveAttachment, onPickLocalFiles, onPasteImages };
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
    expect(pill.className).toContain("ln-pill");
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
    expect([...document.querySelectorAll(".ln-pill")].some((b) => (b.textContent || "").includes("请选择文档"))).toBe(true);
    act(() => { root!.unmount(); });
    host.remove();
    await renderComposer({ mode: "chat" });
    expect([...document.querySelectorAll(".ln-pill")].some((b) => (b.textContent || "").includes("请选择文档"))).toBe(false);
  });

  it("对话写作的附件入口 = 菜单二选一（文档资产图片 / 本机文件），不是 disabled 占位", async () => {
    h.listAllNoteImages.mockResolvedValue({ items: [], hasMore: false, scannedNotes: 0, totalNotes: 0 });
    const { onPickLocalFiles } = await renderComposer();
    const attach = buttonByLabel("添加附件")!;
    expect(attach.disabled).toBe(false);
    expect(attach.getAttribute("aria-expanded")).toBe("false");
    act(() => { attach.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    await flush();
    expect(attach.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("从文档里选附件");
    expect(document.body.textContent).toContain("从电脑选择文件");
    const local = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("从电脑选择文件"))!;
    act(() => { local.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onPickLocalFiles).toHaveBeenCalledTimes(1);
  });

  it("PDF 本机附件 chip：文件类型图标 + 「大小 / N 页」（复用现有 chip，不新增节点）", async () => {
    const ref = { kind: "local" as const, token: "loc-pdf", name: "report.pdf", size: 1024, mimeType: "application/pdf", pages: 3 };
    await renderComposer({ attachRefs: [ref] });
    const chip = document.querySelector(".aiw-attach-chip")!;
    expect(chip.textContent).toContain("report.pdf");
    expect(chip.textContent).toContain("1.0 KB / 3 页");
    // 复用 FileKindIcon（PDF 类型图标为文件页图标），不新增图标组件
    expect(chip.querySelector(".bt-file-icon--pdf")).toBeTruthy();
  });

  it("已挂附件 = 缩略图 chip + 单删（删除回调带原引用）", async () => {
    const ref = { noteId: "note-1", filename: "a.png", name: "a.png" };
    const { onRemoveAttachment } = await renderComposer({ attachRefs: [ref] });
    const chip = document.querySelector(".aiw-attach-chip");
    expect(chip).toBeTruthy();
    expect(chip!.querySelector("img")?.getAttribute("src")).toContain("note-1/a.png");
    const remove = buttonByLabel("移除附件：a.png")!;
    act(() => { remove.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onRemoveAttachment).toHaveBeenCalledWith(ref);
  });

  it("已选图片 chip 可点开大图：传全尺寸档（不带 w）且定位到该张", async () => {
    h.openImagePreview.mockReset();
    const a = { noteId: "n1", filename: "a.png" };
    const b = { noteId: "n1", filename: "b.png" };
    await renderComposer({ attachRefs: [a, b] });
    const previews = [...document.querySelectorAll<HTMLButtonElement>(".aiw-attach-chip__preview")];
    expect(previews.length).toBe(2);
    act(() => { previews[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(h.openImagePreview).toHaveBeenCalledTimes(1);
    const [images, index] = h.openImagePreview.mock.calls[0];
    expect(index).toBe(1);
    expect(images.length).toBe(2);
    expect(String(images[1].src)).not.toContain("w=");
    expect(String(images[0].src)).toContain("/n1/a.png");
  });

  it("本机图片附件：chips 显示缩略图（/ai-local/token?w=128）且可点开大图（全尺寸档）", async () => {
    h.openImagePreview.mockReset();
    const local = { kind: "local" as const, token: "loc-1", name: "cat.png", size: 2048, mimeType: "image/png" };
    await renderComposer({ attachRefs: [local] });
    const thumb = document.querySelector<HTMLImageElement>(".aiw-attach-chip__preview img");
    expect(thumb).toBeTruthy();
    expect(thumb!.getAttribute("src")).toContain("/ai-local/loc-1");
    expect(thumb!.getAttribute("src")).toContain("w=128");
    const preview = document.querySelector<HTMLButtonElement>(".aiw-attach-chip__preview")!;
    act(() => { preview.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(h.openImagePreview).toHaveBeenCalledTimes(1);
    const [images, index] = h.openImagePreview.mock.calls[0];
    expect(index).toBe(0);
    expect(String(images[0].src)).toContain("/ai-local/loc-1");
    expect(String(images[0].src)).not.toContain("w=");
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

describe("AiComposer · 粘贴图片（第三方剪贴板）", () => {
  it("粘贴 image/* → 拦截默认并回传 File[]（纯文本粘贴不受影响）", async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "粘贴截图.png", { type: "image/png" });
    const { onPasteImages } = await renderComposer();
    const area = document.querySelector("textarea")!;
    const imageEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(imageEvent, "clipboardData", {
      value: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    act(() => { area.dispatchEvent(imageEvent); });
    expect(onPasteImages).toHaveBeenCalledWith([file]);
    expect(imageEvent.defaultPrevented).toBe(true);

    const textEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textEvent, "clipboardData", {
      value: { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] },
    });
    act(() => { area.dispatchEvent(textEvent); });
    expect(onPasteImages).toHaveBeenCalledTimes(1);
    expect(textEvent.defaultPrevented).toBe(false);
  });
});
