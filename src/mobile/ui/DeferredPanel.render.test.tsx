// @vitest-environment jsdom
import { act, createElement, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeferredPanel } from "./DeferredPanel";
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("首次打开才加载、等待时可关闭，加载完后重新打开保留同一份草稿", async () => {
  const mount = vi.fn();
  function Content({ open }: { open: boolean }) { const [draft, setDraft] = useState("草稿"); useEffect(() => { mount(); }, []); return open ? createElement("input", { value: draft, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value) }) : null; }
  let resolve!: (module: { default: typeof Content }) => void;
  const promise = new Promise<{ default: typeof Content }>(done => { resolve = done; });
  const load = vi.fn(() => promise), Panel = lazy(load);
  const render = (open: boolean) => act(() => root.render(createElement(DeferredPanel, { open, fallback: createElement("span", { role: "status" }, "正在加载"), children: createElement(Panel, { open }) })));
  render(false); expect(load).not.toHaveBeenCalled(); render(true); expect(load).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="status"]')).not.toBeNull();
  render(false); expect(host.textContent).toBe(""); await act(async () => resolve({ default: Content })); expect(host.textContent).toBe(""); expect(mount).toHaveBeenCalledTimes(1);
  render(true); const input = host.querySelector("input")!; act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "未保存的内容"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  render(false); render(true); expect(host.querySelector("input")!.value).toBe("未保存的内容"); expect(mount).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
});
