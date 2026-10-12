/**
 * 共享链接实现的护栏（桌面浮动栏 / 移动端 dock 唯一来源）。
 * 这些判据两端共用 ⇒ 改了这里等于同时改两端，必须有测试卡住。
 */
import { describe, expect, it, vi } from "vitest";
import { applyTextLink, captureLinkTarget, isValidLink, type LinkCommandRunner } from "./linkEditor";

const target = (selected = "", range: Range | null = null) => ({ range, selected });
const editor = { execCommand: () => undefined, queryCommandEnabled: () => true };

/** 记录调用的执行器；`results` 决定每条命令回什么（缺省 true = 内核接受）。 */
function runner(results: Record<string, unknown> = {}) {
  const calls: string[][] = [];
  const run: LinkCommandRunner = (name, ...args) => { calls.push([name, ...args] as string[]); return name in results ? results[name] : true; };
  return { run, calls, names: () => calls.map((c) => c[0]) };
}

describe("isValidLink", () => {
  it("接受常见形态", () => {
    for (const v of ["https://a.com", "http://a.com/x?y=1", "mailto:a@b.com", "tel:123", "/note/1", "#anchor", "yuque.com/doc"]) {
      expect(isValidLink(v), v).toBe(true);
    }
  });
  it("拒绝空串与非链接文本", () => {
    for (const v of ["", "   ", "随便一段话"]) expect(isValidLink(v), v).toBe(false);
  });
});

describe("captureLinkTarget", () => {
  it("没有选区时返回空目标（不抛）", () => {
    expect(captureLinkTarget(null)).toEqual({ range: null, selected: "" });
  });
});

describe("applyTextLink 的命令判定（按返回值决定成败，不看 queryCommandEnabled）", () => {
  it("有选区且文本未改 ⇒ 只发 link（包住选区）", () => {
    const r = runner();
    expect(applyTextLink({ editor, run: r.run, target: target("选中文字"), text: "选中文字", src: "https://a.com" })).toBe(true);
    expect(r.calls).toEqual([["link", "https://a.com", true, true]]);
  });

  it("文本被改过 ⇒ 先发 insertLink（带用户输入的文本）", () => {
    const r = runner();
    expect(applyTextLink({ editor, run: r.run, target: target("旧文字"), text: "新文字", src: "https://a.com" })).toBe(true);
    expect(r.calls[0]).toEqual(["insertLink", "新文字", "https://a.com", true, true]);
  });

  it("光标折叠（没有选中文字）⇒ 先发 insertLink，文本兜底为「链接」", () => {
    const r = runner();
    applyTextLink({ editor, run: r.run, target: target(""), text: "", src: "https://a.com" });
    expect(r.calls[0]).toEqual(["insertLink", "链接", "https://a.com", true, true]);
  });

  it("link 被内核拒绝（false）⇒ 回退 insertLink，总共只发两条", () => {
    const r = runner({ link: false });
    expect(applyTextLink({ editor, run: r.run, target: target("选中文字"), text: "选中文字", src: "https://a.com" })).toBe(true);
    expect(r.names()).toEqual(["link", "insertLink"]);
  });

  it("两条都被拒绝 ⇒ 返回 false（调用方据此保持编辑器打开，不假装成功）", () => {
    const r = runner({ link: false, insertLink: false });
    expect(applyTextLink({ editor, run: r.run, target: target("x"), text: "x", src: "https://a.com" })).toBe(false);
    expect(r.names()).toEqual(["link", "insertLink"]);
  });

  it("链接卡 id（字符串）也算内核接受，不再试第二条", () => {
    const r = runner({ link: "ucb2e0e18" });
    expect(applyTextLink({ editor, run: r.run, target: target("x"), text: "x", src: "https://a.com" })).toBe(true);
    expect(r.names()).toEqual(["link"]);
  });

  it("地址非法 / 为空 ⇒ 一个字都不发给内核", () => {
    for (const src of ["", "   ", "随便一段话"]) {
      const r = runner();
      expect(applyTextLink({ editor, run: r.run, target: target("x"), text: "x", src })).toBe(false);
      expect(r.calls).toEqual([]);
    }
  });

  it("确认前先把选区还给编辑器（内核选区丢了命令会静默失败）", () => {
    const focus = vi.fn();
    const r = runner();
    applyTextLink({ editor: { execCommand: focus, queryCommandEnabled: () => true }, run: r.run, target: target("x"), text: "x", src: "https://a.com" });
    expect(focus).toHaveBeenCalledWith("focus");
  });
});
