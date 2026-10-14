/**
 * 移动端 dock 的「焦点 / 输入法 / 光标」护栏（261014 两轮修复后定稿）。
 *
 * 依据（都是设备实测出来的真缺陷）：
 * ① **表情栏闪烁**：面板命令后内核把焦点抢回正文 ⇒ Android 弹输入法（842→530）⇒ 面板高度（--kb-offset）塌成 0；
 * ② **点 ＋ 后光标消失**：当时用 `blur()` 收输入法 —— 焦点与光标一起没了；
 * ③ **面板开了 ~0.6s 自己关掉**：判断"用户点了正文"用了一个布尔量，它被上一次点击留下 true，
 *    又被**我们自己**抑制输入法时的 blur/focus 触发 ⇒ 误判成用户点击。
 *
 * 定稿口径：
 * · 收输入法 = `setbackIme(true)`：给正文宿主加 `inputmode="none"` 再 blur+focus（**焦点与光标都留着**）；
 * · 放回输入法 = `setbackIme(false)`（清属性 + 重新聚焦）；
 * · `setbackIme` 必须有**重入保护**（内部的 blur/focus 会同步触发 focusin，否则会递归）；
 * · focusin 分支**只写属性、绝不 blur、也不再调 setbackIme**（后者会递归）；
 * · "用户点正文"的判据放在 **pointerdown**（面板期正文一直有焦点，点它不会再触发 focusin）；
 * · 收面板只有 `closePanel` 一个出口；面板态只有 `setPanel` 一个写入口。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(path.join(process.cwd(), "src/mobile/editor/EditorDock.tsx"), "utf8");
const COMPOSER = readFileSync(path.join(process.cwd(), "src/mobile/home/QuickNoteComposer.tsx"), "utf8");

const HOOK_CALL = /\buse(?:State|Ref|Effect|LayoutEffect|Callback|Memo|Context)\s*\(/g;
const earlyReturnAt = (src: string): number => {
  const m = /\n\s*if \(!editing\) return null;/.exec(src);
  if (!m) throw new Error("找不到 if (!editing) return null;");
  return m.index;
};
/** 截取 `const <name> = (… ) => { … };` 的块体。 */
function handlerBody(src: string, name: string): string {
  const at = src.indexOf("const " + name + " = (");
  if (at < 0) throw new Error("找不到函数：" + name);
  const open = src.indexOf("{", src.indexOf("=>", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error("花括号不配对：" + name);
}

describe("dock：输入法抑制 / 光标保留 / 面板收口", () => {
  const focusIn = handlerBody(SRC, "onFocusIn");
  const pointerDown = handlerBody(SRC, "onPointerDown");
  const setback = SRC.slice(SRC.indexOf("function setbackIme"), SRC.indexOf("function setbackIme") + 700);
  const closePanel = handlerBody(SRC, "closePanel");

  it("focusin 分支只写 inputmode、不 blur、不再调 setbackIme（否则递归）", () => {
    expect(focusIn).toContain('setAttribute("inputmode", "none")');
    expect(focusIn).not.toContain("blur");
    expect(focusIn).not.toContain("setbackIme");
    expect(SRC).not.toContain("blurActiveEditable");
  });

  it("setbackIme = inputmode 抑制 + blur/focus，且有重入保护", () => {
    expect(setback).toContain('setAttribute("inputmode", "none")');
    expect(setback).toContain("removeAttribute");
    expect(setback).toContain("blur()");
    expect(setback).toContain("focus()");
    expect(setback).toContain("inSetback");
  });

  it("「用户点正文」判据在 pointerdown（面板开着且点在正文）⇒ 走唯一收口 closePanelRef", () => {
    expect(pointerDown).toContain("panelModeRef.current");
    expect(pointerDown).toContain("isEditor(");
    expect(pointerDown).toContain("closePanelRef.current()");
    expect(pointerDown).not.toMatch(/userTapped/i);
  });

  it("收面板只有 closePanel 一个出口：先 setPanel(null) 再 focusEditor（顺序不能反）", () => {
    const iSet = closePanel.indexOf("setPanel(null)");
    const iFocus = closePanel.indexOf("focusEditor()");
    expect(iSet).toBeGreaterThanOrEqual(0);
    expect(iFocus).toBeGreaterThan(iSet);
    // togglePanel 的关闭分支只调 closePanel，不再自己拼一套
    const toggle = handlerBody(SRC, "togglePanel");
    expect(toggle).toContain("closePanel()");
    expect(toggle).not.toContain("setClosing(true)");
  });

  it("面板态只有 setPanel 一个写入口", () => {
    expect([...SRC.matchAll(/setPanelMode\(/g)].length).toBe(1);
    expect(SRC).toMatch(/const setPanel = useCallback/);
  });

  it("hook 必须在早退之前（文档从阅读态切编辑态会崩）", () => {
    const after = SRC.slice(earlyReturnAt(SRC));
    expect([...after.matchAll(HOOK_CALL)]).toEqual([]);
    expect(/\buse[A-Z][A-Za-z]*\s*\(/.test(after)).toBe(false);
  });

  it("QuickNoteComposer 同规则：`if (!draftReady) return …;` 之后不得再有 hook", () => {
    const at = COMPOSER.indexOf("if (!draftReady) return");
    expect(at).toBeGreaterThan(0);
    const after = COMPOSER.slice(at);
    expect([...after.matchAll(HOOK_CALL)]).toEqual([]);
  });
});
