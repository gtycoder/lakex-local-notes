// @vitest-environment jsdom
import { act, createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNodeType } from "../../lib/types";
import { MobileNodeIconPicker } from "./NodeIconPicker";
import { MobileNodeIconGlyph } from "./NodeIconGlyph";
import { EmojiPanel } from "./EmojiPanel";
import { EMOJI_RECENTS_KEYS } from "../../lib/emojiRecents";
import { readFileSync } from "node:fs";
import path from "node:path";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  localStorage.clear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const click = (e: HTMLElement) => act(() => e.click());
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const render = (type: TreeNodeType, value: string | null, onPick = vi.fn()) => {
  act(() => root.render(createElement(MobileNodeIconPicker, { key: type, nodeType: type, value, onPick })));
  return onPick;
};

describe("移动端节点图标", () => {
  it("两端同默认：容器即使保存表情也打开图标，文档即使保存图标也打开表情", () => {
    for (const type of ["notebook", "group", "note"] as const) {
      render(type, type === "note" ? "i:code:7" : "🍏");
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(type === "note" ? "表情符号" : "图标");
    }
  });
  it("选色仅预览，选图标传共享编码；持续选择/移除更新选中格", () => {
    const picked = vi.fn();
    function Harness() {
      const [value, setValue] = useState<string | null>("i:notebook:3");
      return createElement(MobileNodeIconPicker, { nodeType: "notebook", value, onPick: (v) => { setValue(v); picked(v); } });
    }
    act(() => root.render(createElement(Harness)));
    expect(host.querySelectorAll('.mb-node-picker__grid[aria-label="选择图标"] button')).toHaveLength(40);
    expect(button("浅绿").getAttribute("aria-pressed")).toBe("true");
    click(button("浅紫")); expect(picked).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.mb-node-glyph[data-tint="violet"]')).toHaveLength(40);
    click(button("星标")); expect(picked).toHaveBeenLastCalledWith("i:star:7");
    expect(button("星标").getAttribute("aria-pressed")).toBe("true");
    click(button("心形")); expect(picked).toHaveBeenLastCalledWith("i:heart:7");
    expect(button("星标").getAttribute("aria-pressed")).toBe("false");
    click(button("移除图标")); expect(picked).toHaveBeenLastCalledWith(null);
    expect(button("心形").getAttribute("aria-pressed")).toBe("false");
  });
  it("图标值不会画成原始串，emoji与未知图标也正确分流", () => {
    act(() => root.render(createElement(Fragment, null, ...["i:star:7", "🍏", "i:unknown:0"].map((value) => createElement(MobileNodeIconGlyph, { key: value, value })))));
    expect(host.textContent).toBe("🍏");
    expect(host.querySelector('.mb-node-glyph[data-tint="violet"] svg.lucide-star')).not.toBeNull();
    expect(host.querySelector('.mb-node-glyph--unknown svg')).not.toBeNull();
  });
  it("正文输入的表情面板仍只有表情分类与返回，不出现节点图标/移除", () => {
    const back = vi.fn();
    act(() => root.render(createElement(EmojiPanel, { bucket: "input", fill: true, onPick: vi.fn(), onBack: back })));
    expect(host.querySelector('.mb-node-picker')).toBeNull();
    expect(host.querySelector('[aria-label="移除图标"]')).toBeNull();
    click(button("返回")); expect(back).toHaveBeenCalledOnce();
  });
  it("目录表情独立于输入面板，最近使用只写icon桶", () => {
    const pick = render("note", null);
    expect(host.querySelector('.mb-emoji-panel')).toBeNull();
    click(button("表情"));
    const first = host.querySelector<HTMLButtonElement>('.mb-node-picker__emoji')!;
    const char = first.textContent;
    click(first);
    expect(pick).toHaveBeenLastCalledWith(char);
    expect(JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEYS.icon)!)).toContain(char);
    expect(localStorage.getItem(EMOJI_RECENTS_KEYS.input)).toBeNull();
    click(button("最近"));
    expect(host.querySelector('.mb-node-picker__emoji')?.textContent).toBe(char);
    const component = readFileSync(path.resolve('src/mobile/ui/NodeIconPicker.tsx'), 'utf8');
    const css = readFileSync(path.resolve('src/mobile/ui/nodeIcon.css'), 'utf8');
    expect(component).not.toContain('from "./EmojiPanel"');
    expect(component + css).not.toContain('mb-emoji-');
  });
});
