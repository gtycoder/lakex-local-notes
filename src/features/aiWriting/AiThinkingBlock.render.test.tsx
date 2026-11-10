// @vitest-environment jsdom
/**
 * 思考块默认折叠（261110 用户定稿）：默认只有一行，点行展开思考正文，再点收起；
 * 没有思考输出的消息不显示这一行。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AiThinkingBlock } from "./AiThinkingBlock";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function render(props: Parameters<typeof AiThinkingBlock>[0]) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<AiThinkingBlock {...props} />); });
}

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); root = null; });

describe("AiThinkingBlock（默认折叠）", () => {
  it("默认折叠：只有一行文案，不渲染思考正文", () => {
    render({ reasoning: "先确认目标读者，再列三条亮点。", label: "已深度思考（用时 3.2 秒）" });
    const toggle = document.querySelector(".aiw-think__toggle")!;
    expect(toggle.textContent).toContain("已深度思考");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".aiw-think")).toBeNull();
  });

  it("点行展开正文，再点收起", () => {
    render({ reasoning: "先确认目标读者，再列三条亮点。", label: "已深度思考（用时 3.2 秒）" });
    const toggle = document.querySelector(".aiw-think__toggle")!;
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".aiw-think")?.textContent).toContain("先确认目标读者");
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".aiw-think")).toBeNull();
  });

  it("流式思考：行前有主色小点，默认仍折叠", () => {
    render({ reasoning: "正在推理…", label: "正在深度思考…", live: true });
    expect(document.querySelector(".aiw-think__dot")).toBeTruthy();
    expect(document.querySelector(".aiw-think")).toBeNull();
  });

  it("没有思考输出（label=null）⇒ 整块不渲染", () => {
    render({ reasoning: "", label: null });
    expect(host.innerHTML).toBe("");
  });
});
