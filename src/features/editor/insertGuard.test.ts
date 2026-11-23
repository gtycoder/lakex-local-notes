// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { INSERT_BLOCKED_HINT, notifyInsertBlocked, selectionTouchesCard, setInsertBlockedNotifier } from "./insertGuard";

/** 造一棵与内核同形的宿主：正文段落 +（可选）ne-hole>ne-card 卡片。 */
function makeHost(withCard: boolean): { host: HTMLDivElement; para: HTMLElement; cardInner: HTMLElement | null } {
  const host = document.createElement("div");
  host.setAttribute("contenteditable", "true");
  const para = document.createElement("p");
  para.textContent = "正文段落一";
  host.append(para);
  let cardInner: HTMLElement | null = null;
  if (withCard) {
    const hole = document.createElement("ne-hole");
    const card = document.createElement("ne-card");
    cardInner = document.createElement("div");
    cardInner.className = "lake-locked-text";
    cardInner.textContent = "卡片内容";
    card.append(cardInner);
    hole.append(card);
    host.append(hole);
  }
  const para2 = document.createElement("p");
  para2.textContent = "正文段落二";
  host.append(para2);
  document.body.append(host);
  return { host, para, cardInner };
}

function select(range: Range): void {
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

afterEach(() => {
  document.body.innerHTML = "";
  document.getSelection()?.removeAllRanges();
  setInsertBlockedNotifier(null);
});

describe("selectionTouchesCard：插入命令的卡片保护区（261123 插表情吞卡修复）", () => {
  it("折叠光标落在卡片内部 ⇒ 触卡（内核会静默丢失插入物）", () => {
    const { cardInner } = makeHost(true);
    const range = document.createRange();
    range.selectNodeContents(cardInner!);
    range.collapse(true);
    select(range);
    expect(selectionTouchesCard()).toBe(true);
  });

  it("折叠光标落在 ne-hole 包装里 ⇒ 触卡", () => {
    const { host } = makeHost(true);
    const hole = host.querySelector("ne-hole")!;
    const range = document.createRange();
    range.selectNodeContents(hole);
    range.collapse(true);
    select(range);
    expect(selectionTouchesCard()).toBe(true);
  });

  it("普通正文里的折叠光标 ⇒ 不触卡", () => {
    const { para } = makeHost(true);
    const range = document.createRange();
    range.selectNodeContents(para);
    range.collapse(true);
    select(range);
    expect(selectionTouchesCard()).toBe(false);
  });

  it("非折叠选区跨过卡片（整卡/多块选中）⇒ 触卡（内核会整卡替换）", () => {
    const { host, para } = makeHost(true);
    const para2 = host.querySelectorAll("p")[1];
    const range = document.createRange();
    range.setStart(para.firstChild!, 0);
    range.setEnd(para2.firstChild!, para2.firstChild!.textContent!.length);
    select(range);
    expect(selectionTouchesCard()).toBe(true);
  });

  it("非折叠选区只覆盖正文两段（宿主里有卡但不相交）⇒ 不触卡（防误伤正常插入）", () => {
    const { host } = makeHost(false);
    // 另插一张卡在两段之外，保证「宿主里有卡」不等于「选区触卡」
    const hole = document.createElement("ne-hole");
    const card = document.createElement("ne-card");
    card.textContent = "卡";
    hole.append(card);
    host.append(hole);
    const ps = host.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(ps[0].firstChild!, 0);
    range.setEnd(ps[1].firstChild!, ps[1].firstChild!.textContent!.length);
    select(range);
    expect(selectionTouchesCard()).toBe(false);
  });

  it("无选区 ⇒ 不触卡", () => {
    makeHost(true);
    document.getSelection()?.removeAllRanges();
    expect(selectionTouchesCard()).toBe(false);
  });

  it("提示通道可注入（移动端装 showToast；未装时静默拦下也不炸）", () => {
    const seen: string[] = [];
    setInsertBlockedNotifier((hint) => seen.push(hint));
    notifyInsertBlocked();
    expect(seen).toEqual([INSERT_BLOCKED_HINT]);
    expect(INSERT_BLOCKED_HINT).toContain("未插入");
    expect(INSERT_BLOCKED_HINT).toContain("卡片");
    // 拆掉通道后不炸（宿主没装 ⇒ 静默拦下）
    setInsertBlockedNotifier(null);
    expect(() => notifyInsertBlocked()).not.toThrow();
  });
});
