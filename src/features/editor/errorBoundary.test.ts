// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorErrorBoundary } from "./EditorErrorBoundary";

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error("boom");
  return createElement("div", { id: "recovered" }, "ok");
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  shouldThrow = true;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { act(() => root.unmount()); host.remove(); errorSpy.mockRestore(); vi.unstubAllGlobals(); });

describe("EditorErrorBoundary（审计 F14）", () => {
  it("出错时给可点的重试，点击后真实重建子树并恢复（不是「切换标签」这种空话）", () => {
    act(() => root.render(createElement(EditorErrorBoundary, { noteId: "n1", children: createElement(Flaky) })));
    expect(host.textContent).toContain("该类型编辑器渲染出错");
    expect(host.querySelector("#recovered")).toBeNull();
    const btn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "重试");
    expect(btn).toBeTruthy();
    shouldThrow = false;
    act(() => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.querySelector("#recovered")?.textContent).toBe("ok");
  });
});
