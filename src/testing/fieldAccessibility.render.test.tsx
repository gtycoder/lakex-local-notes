// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as desktop from "../components/ui/settingsPrimitives";
import * as mobile from "../mobile/ui/settingsPrimitives";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
for (const [name, primitives] of [["desktop", desktop], ["mobile", mobile]] as const) describe(name + " 设置字段关联", () => {
  const render = (error?: string) => act(() => root.render(createElement("div", null,
    createElement(primitives.Field, { name: "接口地址", desc: "输入兼容端点", error, children: createElement(primitives.TextField, { label: "地址", value: "", onSave: vi.fn() }) }),
    createElement(primitives.Item, { name: "温度", desc: "0至2", children: createElement(primitives.NumField, { label: "温度", value: .7, min: 0, max: 2, floor: 0, fallback: .7, onSave: vi.fn() }) }),
  )));
  it("字段能定位可见名称、说明与错误，各行ID独立", () => {
    render("地址不可用"); const fields = [...host.querySelectorAll("input")];
    expect(document.getElementById(fields[0].getAttribute("aria-labelledby")!)?.textContent).toBe("接口地址");
    const descriptions = fields[0].getAttribute("aria-describedby")!.split(" ").map(id => document.getElementById(id)?.textContent);
    expect(descriptions).toEqual(["输入兼容端点", "地址不可用"]); expect(fields[0].getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(fields[1].getAttribute("aria-labelledby")!)?.textContent).toBe("温度");
    expect(fields[0].getAttribute("aria-labelledby")).not.toBe(fields[1].getAttribute("aria-labelledby"));
    render(); expect(fields[0].getAttribute("aria-invalid")).toBe("false"); expect(fields[0].getAttribute("aria-describedby")!.split(" ")).toHaveLength(1);
  });
});
