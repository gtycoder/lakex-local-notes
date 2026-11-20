// @vitest-environment jsdom
/**
 * 移动端「插入链接」浮窗（261120 用户点单：从 dock 面板内联行改成**底部可拖动浮窗** LinkEditorSheet）。
 *
 * 钉四件事（render + 事件序列）：
 * ① 点「插入 → 链接」打开的是**浮窗**（.mb-sheet + 标题「插入链接」），面板里不再有内联输入行；
 * ② 「文本」初值 = 打开时捕获的选中文字（与桌面浮栏同口径）；
 * ③ 链接地址为空 / 非法时「确定」禁用；合法才可提交；
 * ④ 确认仍走共享 linkEditor.ts：先还原内核选区再落链；**失败重试一次**，两次都失败浮窗保持打开（不假装成功）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDock } from "./EditorDock";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";

vi.mock("@dlient/lakex-doc-react", async () => {
  const { createElement } = await import("react");
  return {
    Doc: {
      FrameworkUiLib: {
        Input: (props: Record<string, unknown>) =>
          createElement("input", {
            value: props.value as string,
            onChange: props.onChange as never,
          }),
        Button: (props: Record<string, unknown>) =>
          createElement("button", { onClick: props.onClick as never, disabled: props.disabled as boolean | undefined }, props.children as never),
      },
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let calls: { name: string; args: unknown[] }[];

type FakeEditor = LakeEditorInstance & Record<string, unknown>;

/** 挂 dock + 假内核实例（记录 execCommand；insertLink/link 按 attempt 序号给返回值）。 */
function mount(linkResult: (attempt: number) => boolean = () => true): void {
  calls = [];
  let attempts = 0;
  const fake = {
    execCommand: (name: string, ...args: unknown[]) => {
      calls.push({ name, args });
      if (name === "insertLink" || name === "link") { attempts += 1; return linkResult(attempts); }
      return true;
    },
    queryCommandEnabled: () => true,
    queryCommandState: () => 0,
    queryCommandValue: () => null,
  } as unknown as FakeEditor;
  act(() => { root.render(<EditorDock editor={fake} editing undoBackend="kernel" />); });
}

const q = <T extends HTMLElement>(sel: string): T | null => document.body.querySelector<T>(sel);
const must = <T extends HTMLElement>(sel: string): T => {
  const el = q<T>(sel);
  if (!el) throw new Error("找不到元素: " + sel);
  return el;
};

/** 打开「＋ → 链接」。 */
function openLinkSheet(): void {
  act(() => { must<HTMLButtonElement>('button.med-toggle[aria-label="插入"]').click(); });
  act(() => { must<HTMLButtonElement>('button.med-ins-item[aria-label="链接"]').click(); });
}

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".mb-set-item")];
const confirmBtn = (): HTMLButtonElement => {
  const btns = [...document.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")];
  const btn = btns.find((b) => (b.textContent ?? "").trim() === "确定");
  if (!btn) throw new Error("找不到「确定」");
  return btn;
};

/** 受控输入写入（走 contenteditable 同款机制：覆盖 value + 派发 input）。 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 等真实定时器（confirmLink 的 attempt(0) / attempt(160) 重试）。 */
const settle = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("移动端插入链接 = 底部浮窗", () => {
  it("点「＋ → 链接」打开浮窗（不再是面板内联行），文本预填选中文字，地址为空时确定禁用", () => {
    mount();
    openLinkSheet();
    // 浮窗是 mb-sheet 原语，标题「插入链接」；面板里没有内联链接行
    expect(q(".mb-sheet")).toBeTruthy();
    expect(q(".mb-sheet__title")?.textContent).toBe("插入链接");
    expect(q(".med-f-link, .ne-link-editor")).toBeNull();
    // 两个字段：文本 / 链接
    expect(rows().length).toBe(2);
    const text = must<HTMLInputElement>('input[aria-label="文本"]');
    const src = must<HTMLInputElement>('input[aria-label="链接地址"]');
    expect(text.value).toBe(""); // jsdom 无真实选区 ⇒ 初值为空
    expect(src.value).toBe("");
    expect(confirmBtn().disabled).toBe(true);
    // 非法链接也要禁用
    typeInto(src, "not a link");
    expect(q(".mb-set-item__error")?.textContent).toContain("请输入正确的链接");
    expect(confirmBtn().disabled).toBe(true);
    // 合法后可用
    typeInto(src, "https://example.com");
    expect(q(".mb-set-item__error")).toBeNull();
    expect(confirmBtn().disabled).toBe(false);
  });

  it("确定 = 还原选区后走内核命令；成功后关闭浮窗", async () => {
    mount();
    openLinkSheet();
    typeInto(must<HTMLInputElement>('input[aria-label="文本"]'), "示例");
    typeInto(must<HTMLInputElement>('input[aria-label="链接地址"]'), "https://example.com");
    act(() => { confirmBtn().click(); });
    await settle(300);
    // 至少命中一次 link / insertLink，且命中的参数里带链接地址
    const hit = calls.find((c) => c.name === "link" || c.name === "insertLink");
    expect(hit, "没调用内核链接命令").toBeTruthy();
    expect(String(hit!.args.join(" "))).toContain("https://example.com");
    expect(q(".mb-sheet"), "成功后浮窗应关闭").toBeNull();
  });

  it("第一次被内核拒绝 ⇒ 160ms 后重试一次并成功（移动端实测口径）", async () => {
    // 共享实现里一次「尝试」内部会先 link 再 insertLink（两条都被拒才算失败）⇒ 前两次都返回 false。
    mount((attempt) => attempt > 2);
    openLinkSheet();
    typeInto(must<HTMLInputElement>('input[aria-label="链接地址"]'), "https://example.com");
    act(() => { confirmBtn().click(); });
    await settle(60);
    expect(q(".mb-sheet"), "第一次失败时先别关").toBeTruthy();
    await settle(400);
    expect(calls.filter((c) => c.name === "link" || c.name === "insertLink").length).toBeGreaterThanOrEqual(2);
    expect(q(".mb-sheet"), "重试成功后关闭").toBeNull();
  });

  it("链接地址里按回车 = 确定（键盘盖住底栏时的最短出口）", async () => {
    mount();
    openLinkSheet();
    const src = must<HTMLInputElement>('input[aria-label="链接地址"]');
    typeInto(src, "https://example.com");
    act(() => { src.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle(300);
    expect(calls.some((c) => c.name === "link" || c.name === "insertLink")).toBe(true);
    expect(q(".mb-sheet")).toBeNull();
  });

  it("两次都被拒 ⇒ 浮窗保持打开，绝不假装成功", async () => {
    mount(() => false);
    openLinkSheet();
    typeInto(must<HTMLInputElement>('input[aria-label="链接地址"]'), "https://example.com");
    act(() => { confirmBtn().click(); });
    await settle(400);
    expect(q(".mb-sheet"), "失败不关窗").toBeTruthy();
  });
});
