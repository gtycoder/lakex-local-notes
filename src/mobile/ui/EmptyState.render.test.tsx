// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("EmptyState", () => {
  it("默认 = .mb-empty；inset 追加 --inset；role 透传", async () => {
    await act(async () => root.render(createElement(EmptyState, { role: "alert", children: "暂无内容" })));
    const el = host.querySelector(".mb-empty")!;
    expect(el.textContent).toBe("暂无内容");
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.className).not.toContain("--inset");
    await act(async () => root.render(createElement(EmptyState, { inset: true, className: "x", children: "没有更多" })));
    expect(host.querySelector(".mb-empty")!.className).toContain("mb-empty--inset");
    expect(host.querySelector(".mb-empty")!.className).toContain("x");
  });
});
