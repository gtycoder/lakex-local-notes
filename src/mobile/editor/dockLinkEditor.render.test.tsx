// @vitest-environment jsdom
/**
 * 移动端 dock「＋ → 链接」内联链接编辑行的输入护栏（261119 设备报障复现）：
 * 点输入框能看到聚焦态（蓝框）但打字进不去、软键盘不出。
 *
 * 钉三件事（render + 事件序列）：
 * ① **点按输入框的 mousedown 默认动作不许被 cancel** —— 真机契约（Chromium 触摸合成鼠标事件）：
 *    mousedown 默认动作 = 聚焦 + 落光标 + 唤起软键盘，被 preventDefault ⇒ 三样全无（label 激活兜出的
 *    程序化 focus 只有蓝框、不弹键盘，见 AGENTS §7#17「程序化 focus 不弹软键盘」）。jsdom 不实现该默认，
 *    这里按契约模拟：只有未被 cancel 的 mousedown 才聚焦（= 键盘能出）；
 * ② 聚焦后打字必须进 value（键盘事件只进聚焦元素 —— 没聚焦就是真机的"打字进不去"）；
 * ③ 「确定」仍走共享 linkEditor.ts：先还原内核选区（execCommand("focus")）再落链，
 *    「失败重试一次」口径不变（桌面浮栏同一份实现，零变化）。
 * 反向钉死：面板条目（按钮）的 mousedown 仍要 preventDefault —— 保内核选区的原语义不许破
 *（与桌面 SelectionToolbar 容器 260924 的豁免口径同源：input/textarea/.ne-link-editor 放行，其余照旧）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDock } from "./EditorDock";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";

/**
 * 内核 UI 原语桩：KLinkEditor 用 Doc.FrameworkUiLib.Input/Button（AU/antd 原语）。
 * Input 按内核实测契约（lakex.js 的 AU = 受控原生 input，onChange 传事件对象）用原生 input 代替，
 * 受控 value/onChange 的接线保持真实；Button 同理。
 */
vi.mock("@dlient/lakex-doc-react", async () => {
  const { createElement } = await import("react");
  return {
    Doc: {
      FrameworkUiLib: {
        Input: (props: Record<string, unknown>) =>
          createElement("input", {
            value: props.value as string,
            disabled: props.disabled as boolean | undefined,
            placeholder: props.placeholder as string | undefined,
            onChange: props.onChange as never,
            onKeyDown: props.onKeyDown as never,
          }),
        Button: (props: Record<string, unknown>) =>
          createElement("button", { onClick: props.onClick as never, disabled: props.disabled as boolean | undefined }, props.children as never),
      },
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom 没有 Element.scrollIntoView（EditorDock 展开链接行后会滚进可视区）——测试只补空壳。
if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => {};

let host: HTMLDivElement;
let root: Root;
let calls: { name: string; args: unknown[] }[];

type FakeEditor = LakeEditorInstance & Record<string, unknown>;

/** 挂 dock + 假内核实例（记录 execCommand 调用；link/insertLink 按 attempt 序号给返回值）。 */
function mount(linkResult: (attempt: number) => boolean = () => true): void {
  calls = [];
  let linkAttempts = 0;
  const fake = {
    execCommand: (name: string, ...args: unknown[]) => {
      calls.push({ name, args });
      if (name === "insertLink" || name === "link") {
        linkAttempts += 1;
        return linkResult(linkAttempts);
      }
      return true;
    },
    queryCommandEnabled: () => true,
    queryCommandState: () => 0,
    queryCommandValue: () => null,
  } as unknown as FakeEditor;
  act(() => {
    root.render(<EditorDock editor={fake} editing undoBackend="kernel" />);
  });
}

const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const must = (sel: string) => {
  const el = q(sel);
  if (!el) throw new Error("找不到元素: " + sel);
  return el;
};

/** 点「＋」开插入面板 → 点「链接」展开链接编辑行。 */
function openLinkRow(): void {
  act(() => { must('button.med-toggle[aria-label="插入"]').click(); });
  act(() => { must('button.med-ins-item[aria-label="链接"]').click(); });
}

/**
 * 真机点按契约：触摸点按合成的 mousedown 的**默认动作** = 聚焦 + 落光标 + 唤起软键盘；
 * 被 cancel ⇒ 三样全无（键盘不出 / 打字进不去）。jsdom 不实现该默认动作，这里按契约模拟，
 * 返回「本次点按能否聚焦（= 能否出键盘）」。
 */
function tapFocus(el: HTMLElement): boolean {
  const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  if (ev.defaultPrevented) return false;
  el.focus();
  return true;
}

/** 键盘打字只进**聚焦**元素：没聚焦 = 真机"打字进不去"。 */
function typeIntoFocused(el: HTMLInputElement, text: string): boolean {
  if (document.activeElement !== el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, el.value + text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return el.value === text;
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
});

describe("dock 链接编辑行：输入必须能进（261119 设备报障）", () => {
  it("点文本/链接输入框 → 聚焦出键盘 → 打字进 value → 确定落链接", async () => {
    mount();
    openLinkRow();
    const textInput = must('input[placeholder="添加描述"]') as HTMLInputElement;
    const srcInput = must('input[placeholder="链接地址"]') as HTMLInputElement;

    // ① 点「文本」输入框：点按默认动作（聚焦 + 落光标 + 唤键盘）必须放行
    expect(tapFocus(textInput), "文本输入框的点按聚焦被吃掉（键盘出不来）").toBe(true);
    expect(document.activeElement).toBe(textInput);
    // ② 打字进 value
    expect(typeIntoFocused(textInput, "描述"), "聚焦后打字进不去 value").toBe(true);
    expect(textInput.value).toBe("描述");

    // ③ 「链接」输入框同样
    expect(tapFocus(srcInput), "链接输入框的点按聚焦被吃掉（键盘出不来）").toBe(true);
    expect(document.activeElement).toBe(srcInput);
    expect(typeIntoFocused(srcInput, "https://example.com/a")).toBe(true);
    expect(srcInput.value).toBe("https://example.com/a");

    // ④ 确定：走共享 linkEditor.ts —— 先还原内核选区（focus）再落链（文本改过 ⇒ insertLink 优先）
    act(() => { must(".ne-link-editor button").click(); });
    await settle(20);
    const names = calls.map((c) => c.name);
    expect(names, "确认链接必须先还原内核选区").toContain("focus");
    expect(calls.some((c) => c.name === "insertLink" && c.args.includes("https://example.com/a"))).toBe(true);
    // 落链成功 ⇒ 编辑行收起
    expect(q('input[placeholder="链接地址"]')).toBeNull();
  });

  it("确认链接保留「失败重试一次」共享口径（选区还原语义不破）", async () => {
    // 第一轮（focus 后同一 tick）内核拒绝（false）⇒ 160ms 后整组重试一次；第二轮成功。
    mount((attempt) => attempt > 2);
    openLinkRow();
    const srcInput = must('input[placeholder="链接地址"]') as HTMLInputElement;
    tapFocus(srcInput);
    typeIntoFocused(srcInput, "https://example.com/b");
    act(() => { must(".ne-link-editor button").click(); });

    await settle(30);
    expect(calls.map((c) => c.name).filter((n) => n === "insertLink" || n === "link")).toHaveLength(2);
    expect(q('input[placeholder="链接地址"]'), "第一轮失败不能假装成功收起").not.toBeNull();

    await settle(250);
    // 第二轮 insertLink 被接受即停（共享 applyTextLink「先 insertLink 后 link、被拒才换」的顺序不变）；不再有第三轮。
    expect(calls.map((c) => c.name).filter((n) => n === "insertLink" || n === "link"), "只许失败重试一次").toEqual(["insertLink", "link", "insertLink"]);
    expect(q('input[placeholder="链接地址"]')).toBeNull();
  });

  it("面板条目（按钮）的 mousedown 仍然 preventDefault —— 保内核选区原语义不许破", () => {
    mount();
    openLinkRow();
    const btn = must('button.med-ins-item[aria-label="引用"]');
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented, "面板按钮点按仍须吃掉默认（防选区被按钮抢走）").toBe(true);
  });
});
