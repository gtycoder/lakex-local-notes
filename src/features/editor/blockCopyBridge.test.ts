// @vitest-environment jsdom
/**
 * 块菜单「复制」桥（261106，261107 修复单块文字复制）：≥2 高亮块 / 跨块选区才接管，
 * 单块文字交还 vendor；单图片块走 native.copyAssetImage 位图。
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBlockCopyBridge, blocksRange, highlightedBlocks, selectionSpansBlocks, singleImageAsset } from "./blockCopyBridge";

vi.mock("../../lib/native", () => ({
  native: { copyAssetImage: vi.fn(async () => ({ ok: true })) },
}));
import { native } from "../../lib/native";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function setupDom(options: { highlighted: number; label?: string; menuRoot?: boolean }): { container: HTMLElement; item: HTMLElement } {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.className = "lake-editor-mount";
  for (let i = 0; i < Math.max(options.highlighted, 1); i += 1) {
    const p = document.createElement("ne-p");
    p.textContent = "第" + (i + 1) + "段";
    if (i < options.highlighted) p.classList.add("ne-brick-highlight");
    container.appendChild(p);
  }
  document.body.appendChild(container);
  const menu = document.createElement("div");
  menu.className = options.menuRoot === false ? "other-menu" : "ne-block-context-menu";
  const item = document.createElement("div");
  item.className = "ne-block-menu-item";
  const label = document.createElement("span");
  label.className = "ne-block-menu-label";
  label.textContent = options.label ?? "复制";
  item.appendChild(label);
  menu.appendChild(item);
  document.body.appendChild(menu);
  return { container, item };
}

const originalExecCommand = document.execCommand;
const clipboard = { writeText: vi.fn(async () => undefined), write: vi.fn(async () => undefined) };
beforeEach(() => {
  Object.defineProperty(document, "execCommand", { value: vi.fn(() => true), configurable: true, writable: true });
  clipboard.writeText.mockClear();
  clipboard.write.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});
afterEach(() => {
  Object.defineProperty(document, "execCommand", { value: originalExecCommand, configurable: true, writable: true });
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("块菜单复制桥：多块接管 / 单块交还", () => {
  it("≥2 高亮块 + 点「复制」⇒ 拦下 vendor，改走 execCommand(copy)", () => {
    const { container, item } = setupDom({ highlighted: 3 });
    const detach = attachBlockCopyBridge(container);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    detach();
  });

  it("多块复制后清掉高亮并 Esc 关菜单", () => {
    const { container, item } = setupDom({ highlighted: 2 });
    const detach = attachBlockCopyBridge(container);
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(container.querySelectorAll(".ne-brick-highlight").length).toBe(0);
    detach();
  });

  it("单块（无选区）菜单复制：拦截 vendor，直写整块文字到剪贴板", async () => {
    const { container, item } = setupDom({ highlighted: 1 });
    const detach = attachBlockCopyBridge(container);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clipboard.writeText).toHaveBeenCalledWith("第1段");
    detach();
  });

  it("单块内选中文字 + 点「复制」⇒ 只复制选中文字（直写剪贴板，不依赖 copy 事件）", async () => {
    const { container, item } = setupDom({ highlighted: 0 });
    const block = container.querySelector("ne-p")!;
    const text = block.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(2, (text.textContent ?? "").length));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const detach = attachBlockCopyBridge(container);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clipboard.writeText).toHaveBeenCalledWith("第1");
    detach();
  });

  it("跨块选区（高亮已丢）仍接管", () => {
    const { container, item } = setupDom({ highlighted: 0 });
    const extra = document.createElement("ne-p");
    extra.textContent = "第2段";
    const extra2 = document.createElement("ne-p");
    extra2.textContent = "第3段";
    container.append(extra, extra2);
    const blocks = Array.from(container.querySelectorAll("ne-p"));
    const range = document.createRange();
    range.setStartBefore(blocks[0]);
    range.setEndAfter(blocks[blocks.length - 1]);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const detach = attachBlockCopyBridge(container);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    detach();
  });

  it("mousedown 选区还在、click 前被折叠 ⇒ 用按下瞬间快照", () => {
    const { container, item } = setupDom({ highlighted: 0 });
    const extra = document.createElement("ne-p");
    extra.textContent = "第2段";
    const extra2 = document.createElement("ne-p");
    extra2.textContent = "第3段";
    container.append(extra, extra2);
    const blocks = Array.from(container.querySelectorAll("ne-p"));
    const range = document.createRange();
    range.setStartBefore(blocks[0]);
    range.setEndAfter(blocks[blocks.length - 1]);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const detach = attachBlockCopyBridge(container);
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    selection.removeAllRanges();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    detach();
  });

  it("其他菜单项 / 其他菜单 / 卸载后不接管", () => {
    let { container, item } = setupDom({ highlighted: 3, label: "复制代码" });
    let detach = attachBlockCopyBridge(container);
    let click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    detach();

    ({ container, item } = setupDom({ highlighted: 3, menuRoot: false }));
    detach = attachBlockCopyBridge(container);
    click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    detach();
  });

  it("execCommand(copy) 失败不抛错，高亮仍清理", () => {
    const { container, item } = setupDom({ highlighted: 2 });
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => false), configurable: true, writable: true });
    const detach = attachBlockCopyBridge(container);
    expect(() => item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).not.toThrow();
    expect(container.querySelectorAll(".ne-brick-highlight").length).toBe(0);
    detach();
  });
});

describe("selectionSpansBlocks：不依赖高亮", () => {
  it("同块 false、跨块 true", () => {
    const { container } = setupDom({ highlighted: 0 });
    const extra = document.createElement("ne-p");
    extra.textContent = "第2段";
    container.append(extra);
    const first = container.querySelectorAll("ne-p")[0];
    const second = container.querySelectorAll("ne-p")[1];
    const same = document.createRange();
    same.selectNodeContents(first);
    expect(selectionSpansBlocks(container, same)).toBe(false);
    const cross = document.createRange();
    cross.setStart(first.firstChild!, 0);
    cross.setEnd(second.firstChild!, (second.textContent ?? "").length);
    expect(selectionSpansBlocks(container, cross)).toBe(true);
  });
});

describe("blocksRange / highlightedBlocks", () => {
  it("range = 首块之前 → 末块之后", () => {
    const { container } = setupDom({ highlighted: 3 });
    const blocks = highlightedBlocks(container);
    expect(blocks.length).toBe(3);
    expect(blocksRange(blocks).toString()).toBe("第1段第2段第3段");
  });
});

describe("单张图片块：菜单复制 → 位图入口", () => {
  const NOTE_ID = "123e4567-e89b-12d3-a456-426614174000";
  const ASSET_SRC = "http://127.0.0.1:19876/" + NOTE_ID + "/1700_ab.png";

  function setupImageMenu(options: { label: string; blocks?: number }): { container: HTMLElement; item: HTMLElement } {
    document.body.innerHTML = "";
    const container = document.createElement("div");
    container.className = "lake-editor-mount";
    const total = options.blocks ?? 1;
    for (let i = 0; i < total; i += 1) {
      const block = document.createElement("ne-card");
      block.setAttribute("data-card-name", "image");
      if (i === 0) {
        const img = document.createElement("img");
        img.setAttribute("src", ASSET_SRC);
        block.appendChild(img);
      } else {
        block.textContent = "文字块";
      }
      block.classList.add("ne-brick-highlight");
      container.appendChild(block);
    }
    document.body.appendChild(container);
    const menu = document.createElement("div");
    menu.className = "ne-block-context-menu";
    const item = document.createElement("div");
    item.className = "ne-block-menu-item";
    const label = document.createElement("span");
    label.className = "ne-block-menu-label";
    label.textContent = options.label;
    item.appendChild(label);
    menu.appendChild(item);
    document.body.appendChild(menu);
    return { container, item };
  }

  beforeEach(() => { (native.copyAssetImage as ReturnType<typeof vi.fn>).mockClear(); });

  it("单图片块「复制图片」⇒ native.copyAssetImage(本地资产) + 拦下 vendor", () => {
    const { container, item } = setupImageMenu({ label: "复制图片" });
    const detach = attachBlockCopyBridge(container);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(native.copyAssetImage).toHaveBeenCalledWith(NOTE_ID, "1700_ab.png");
    detach();
  });

  it("单图片块「复制」也走位图（多块语义不成立）", () => {
    const { container, item } = setupImageMenu({ label: "复制" });
    const detach = attachBlockCopyBridge(container);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(native.copyAssetImage).toHaveBeenCalledTimes(1);
    detach();
  });

  it("singleImageAsset：非本地资产返回 null", () => {
    const { container } = setupDom({ highlighted: 0 });
    const card = document.createElement("ne-card");
    const img = document.createElement("img");
    img.setAttribute("src", "https://example.com/a.png");
    card.appendChild(img);
    card.classList.add("ne-brick-highlight");
    container.appendChild(card);
    expect(singleImageAsset(container)).toBeNull();
  });
});

describe("接线护栏：块手柄挂载点必须挂上复制桥", () => {
  const MOUNT_SRC = read("./blockHandleMount.ts");
  it("mountBlockHoverHandle 挂载/清理复制桥", () => {
    expect(MOUNT_SRC).toMatch(/attachBlockCopyBridge\(container\)/);
    expect(MOUNT_SRC).toMatch(/detachCopyBridge\(\)/);
  });
  it("复制桥复用 buildClipboardPayload（单一来源）", () => {
    const BRIDGE_SRC = read("./blockCopyBridge.ts");
    expect(BRIDGE_SRC).toMatch(/buildClipboardPayload\(/);
    expect(BRIDGE_SRC).not.toMatch(/normalizeClipboardHtml\(/);
    // 单块文字直写剪贴板：允许 Clipboard API/writeText 兜底，但内容必须来自 buildClipboardPayload。
    expect(BRIDGE_SRC).toMatch(/writePayloadDirect\(/);
  });
});