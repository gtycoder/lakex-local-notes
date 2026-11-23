// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { activeTextEntryField, insertTextIntoField, isTextEntryField } from "./fieldInsert";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("fieldInsert：非正文文本输入面判定（261123 插表情吞卡修复）", () => {
  it("textarea / 文本类 input 算输入面；number 类 input、普通元素、contenteditable 不算", () => {
    const ta = document.createElement("textarea");
    const text = document.createElement("input");
    const password = document.createElement("input");
    password.type = "password";
    const number = document.createElement("input");
    number.type = "number";
    const div = document.createElement("div");
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    expect(isTextEntryField(ta)).toBe(true);
    expect(isTextEntryField(text)).toBe(true);
    expect(isTextEntryField(password)).toBe(true);
    expect(isTextEntryField(number)).toBe(false);
    expect(isTextEntryField(div)).toBe(false);
    expect(isTextEntryField(host)).toBe(false);
    expect(isTextEntryField(null)).toBe(false);
  });

  it("activeTextEntryField 只认当前聚焦的输入面", () => {
    const ta = document.createElement("textarea");
    document.body.append(ta);
    expect(activeTextEntryField()).toBe(null);
    ta.focus();
    expect(activeTextEntryField()).toBe(ta);
  });
});

describe("fieldInsert：光标处插入（setRangeText + input 事件）", () => {
  it("插在光标处、光标落在插入物之后、派发冒泡 input 事件", () => {
    const ta = document.createElement("textarea");
    document.body.append(ta);
    ta.value = "AB";
    ta.setSelectionRange(1, 1);
    const events: Event[] = [];
    ta.addEventListener("input", (e) => events.push(e));
    const caret = insertTextIntoField(ta, "😀");
    expect(ta.value).toBe("A😀B");
    // 😀 是代理对 = 2 个 UTF-16 单位 ⇒ 光标 1+2=3（setRangeText "end" 语义）
    expect(caret).toBe(3);
    expect(ta.selectionStart).toBe(3);
    expect(events).toHaveLength(1);
    expect(events[0].bubbles).toBe(true);
  });

  it("有选区时替换选区（与打字同一语义）", () => {
    const ta = document.createElement("textarea");
    document.body.append(ta);
    ta.value = "hello world";
    ta.setSelectionRange(0, 5);
    insertTextIntoField(ta, "X");
    expect(ta.value).toBe("X world");
  });

  it("React 受控输入：input 事件后 target.value 是新值（onChange 依据）", () => {
    const ta = document.createElement("textarea");
    document.body.append(ta);
    ta.value = "";
    ta.setSelectionRange(0, 0);
    let seen = "";
    ta.addEventListener("input", (e) => { seen = (e.target as HTMLTextAreaElement).value; });
    insertTextIntoField(ta, "密");
    expect(seen).toBe("密");
  });
});
