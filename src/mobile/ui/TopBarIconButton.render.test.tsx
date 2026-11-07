// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBarIconButton } from "./TopBarIconButton";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("TopBarIconButton", () => {
  it("渲染真 button（type=button + aria-label/title），点击回调", async () => {
    const onClick = vi.fn();
    await act(async () => root.render(createElement(TopBarIconButton, { label: "新建", icon: createElement("span", null, "+"), onClick })));
    const b = host.querySelector("button.toolbar__icon")!;
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("aria-label")).toBe("新建");
    expect(b.getAttribute("title")).toBe("新建");
    await act(async () => { (b as HTMLButtonElement).click(); });
    expect(onClick).toHaveBeenCalled();
  });
});
