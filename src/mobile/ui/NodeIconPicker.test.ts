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
const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === name)!;
const render = (type: TreeNodeType, value: string | null, onPick = vi.fn()) => {
  act(() => root.render(createElement(MobileNodeIconPicker, { key: type, nodeType: type, value, onPick })));
  return onPick;
};

describe("移动端节点图标（261020 精简）", () => {
  it("容器有两页（默认图标），文档只有表情、没有页签", () => {
    for (const type of ["notebook", "group"] as const) {
      render(type, null);
      const tabs = [...host.querySelectorAll('[role="tablist"][aria-label="图标类型"] [role="tab"]')];
      expect(tabs.map((t) => t.textContent)).toEqual(["表情符号", "图标"]);
      expect(tabs.find((t) => t.getAttribute("aria-selected") === "true")?.textContent).toBe("图标");
      expect(host.querySelectorAll(".mb-node-picker__grid--notebook button")).toHaveLength(17);
      click(tab("表情符号"));
      expect(host.querySelector('[role="tablist"][aria-label="表情分类"]')).not.toBeNull();
      expect(host.querySelector(".mb-node-picker__grid--notebook")).toBeNull();
    }
    render("note", null);
    expect(host.querySelector('[aria-label="图标类型"]')).toBeNull();
    expect(host.querySelector(".mb-node-picker__grid--notebook")).toBeNull();
    expect(host.querySelector(".mb-node-picker__categories")).not.toBeNull();
  });
  it("容器切到表情页后选表情同样是落表情字符", () => {
    const picked = vi.fn();
    render("group", null, picked);
    click(tab("表情符号")); // 容器默认是「图标」页
    click(button("表情")); // 分类
    const first = host.querySelector<HTMLButtonElement>(".mb-node-picker__emoji")!;
    click(first);
    expect(picked).toHaveBeenLastCalledWith(first.textContent);
  });

  it("笔记本与分组都用同一套语雀插画：点一个落 n:<id>，连续选择/移除更新选中格", () => {
    for (const type of ["notebook", "group"] as const) {
      const picked = vi.fn();
      function Harness() {
        const [value, setValue] = useState<string | null>(null);
        return createElement(MobileNodeIconPicker, { nodeType: type, value, onPick: (v) => { setValue(v); picked(v); } });
      }
      act(() => root.render(createElement(Harness)));
      const cells = host.querySelectorAll(".mb-node-picker__grid--notebook button");
      expect(cells).toHaveLength(17);
      // 旧色板/搜索都已删除
      expect(host.querySelectorAll(".mb-node-picker__swatch")).toHaveLength(0);
      expect(host.querySelector("input")).toBeNull();
      click(button("表格")); expect(picked).toHaveBeenLastCalledWith("n:sheet");
      expect(button("表格").getAttribute("aria-pressed")).toBe("true");
      click(button("部门")); expect(picked).toHaveBeenLastCalledWith("n:dept");
      expect(button("表格").getAttribute("aria-pressed")).toBe("false");
      expect(button("部门").getAttribute("aria-pressed")).toBe("true");
      click(button("移除图标")); expect(picked).toHaveBeenLastCalledWith(null);
      expect(button("部门").getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("图标值不会画成原始串：插画/表情/旧 i: 值/未知插画四路分流", () => {
    act(() => root.render(createElement(Fragment, null, ...["n:sheet", "🍏", "i:star:0", "n:nope"].map((value) => createElement(MobileNodeIconGlyph, { key: value, value })))));
    expect(host.textContent).toBe("🍏");
    expect(host.querySelectorAll(".mb-node-glyph--notebook svg")).toHaveLength(1);
    expect(host.querySelectorAll(".mb-node-glyph--unknown svg")).toHaveLength(2);
  });

  it("正文输入的表情面板仍只有表情分类与返回，不出现节点图标/移除", () => {
    const back = vi.fn();
    act(() => root.render(createElement(EmojiPanel, { bucket: "input", fill: true, onPick: vi.fn(), onBack: back })));
    expect(host.querySelector(".mb-node-picker")).toBeNull();
    expect(host.querySelector('[aria-label="移除图标"]')).toBeNull();
    click(button("返回")); expect(back).toHaveBeenCalledOnce();
  });

  it("目录表情独立于输入面板，最近使用只写 icon 桶", () => {
    const pick = render("note", null);
    expect(host.querySelector(".mb-emoji-panel")).toBeNull();
    click(button("表情")); // 「最近」在新会话里是空的，先切到一个分类
    const first = host.querySelector<HTMLButtonElement>(".mb-node-picker__emoji")!;
    const char = first.textContent;
    click(first);
    expect(pick).toHaveBeenLastCalledWith(char);
    expect(JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEYS.icon)!)).toContain(char);
    expect(localStorage.getItem(EMOJI_RECENTS_KEYS.input)).toBeNull();
    click(button("最近"));
    expect(host.querySelector(".mb-node-picker__emoji")?.textContent).toBe(char);
    const component = readFileSync(path.resolve("src/mobile/ui/NodeIconPicker.tsx"), "utf8");
    const css = readFileSync(path.resolve("src/mobile/ui/nodeIcon.css"), "utf8");
    expect(component).not.toContain('from "./EmojiPanel"');
    expect(component + css).not.toContain("mb-emoji-");
  });
});
