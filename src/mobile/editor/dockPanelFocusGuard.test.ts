/**
 * 移动端 dock / 编辑面的护栏（261014；P2 收口后指向新的单一来源）。
 *
 * 依据（都是设备实测出来的真缺陷）：
 * ① **表情栏闪烁**：面板命令后内核把焦点抢回正文 ⇒ Android 弹输入法（842→530）⇒ 面板高度（--kb-offset）塌成 0；
 * ② **点 ＋ 后光标消失**：当时用 blur() 收输入法 —— 焦点与光标一起没了；
 * ③ **面板开了 ~0.6s 自己关掉**：判断「用户点了正文」用了布尔量，被上一次点击留下 true，
 *    又被我们自己抑制输入法时的 blur/focus 触发 ⇒ 误判；
 * ④ 我曾把这三个 hook 写在 `if (!editing) return null;` 之后 ⇒ 文档切编辑态直接崩（hook 数量变化）。
 *
 * 定稿口径（P2 之后）：
 * · **输入法抑制 / 焦点守卫 / 外壳高度** 只有 `useEditSurface.ts` 一个实现；
 * · **几何算术**只有 `editSurfaceModel.ts`（纯函数 + 单测，见 editSurfaceModel.test.ts）；
 * · dock 只管面板状态与渲染：收面板只有 `closePanel` 一个出口、面板态只有 `setPanel` 一个写入口。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const DOCK = read("src/mobile/editor/EditorDock.tsx");
const SURFACE = read("src/mobile/editor/useEditSurface.ts");
const MODEL = read("src/mobile/editor/editSurfaceModel.ts");
const COMPOSER = read("src/mobile/home/QuickNoteComposer.tsx");

const HOOK_CALL = /\buse(?:State|Ref|Effect|LayoutEffect|Callback|Memo|Context)\s*\(/g;
function handlerBody(src: string, name: string): string {
  // 兼容两种写法：`const f = (… ) => {…}` 与 `const f = useCallback((… ) => {…}, []) `
  const at = src.indexOf("const " + name + " = ");
  if (at < 0) throw new Error("找不到函数：" + name);
  const open = src.indexOf("{", src.indexOf("=>", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error("花括号不配对：" + name);
}

describe("编辑面：单一来源与不变量", () => {
  const focusIn = handlerBody(SURFACE, "onFocusIn");
  const pointerDown = handlerBody(SURFACE, "onPointerDown");
  const suppress = SURFACE.slice(SURFACE.indexOf("export function suppressImeNow"), SURFACE.indexOf("export function suppressImeNow") + 700);
  const closePanel = handlerBody(SURFACE, "closePanel");   // P3 后收面板的唯一出口在编辑面 hook 里

  it("输入法抑制 = inputmode 抑制 + blur/focus + 重入保护（唯一的收键盘口径）", () => {
    expect(suppress).toContain('setAttribute("inputmode", "none")');
    expect(suppress).toContain("removeAttribute");
    expect(suppress).toContain("blur()");
    expect(suppress).toContain("focus()");
    expect(suppress).toContain("inSetback");
    expect(SURFACE).not.toContain("blurActiveEditable");
  });

  it("focusin 分支只写 inputmode、不 blur、不再调抑制（否则递归）", () => {
    expect(focusIn).toContain('setAttribute("inputmode", "none")');
    expect(focusIn).not.toContain("blur");
    expect(focusIn).not.toContain("suppressImeNow");
  });

  it("「用户点正文」判据在 pointerdown（面板开着 + 点在正文）⇒ 通知调用方收面板", () => {
    expect(pointerDown).toContain("panelModeRef.current");
    expect(pointerDown).toContain("isEditor(");
    expect(pointerDown).toContain("closePanelRef.current()");   // 面板开着时点正文 = 收面板（唯一出口）
    expect(pointerDown).not.toMatch(/userTapped/i);
  });

  it("焦点守卫只有一处实现：dock 自己不再挂 focusin/pointerdown 监听", () => {
    expect(DOCK).not.toContain('addEventListener("focusin"');
    expect(DOCK).not.toContain('addEventListener("pointerdown"');
    expect(SURFACE).toContain('document.addEventListener("pointerdown"');
    expect(SURFACE).toContain('document.addEventListener("focusin"');
  });

  it("外壳高度只有一处实现：--mb-app-h 只由 useEditSurface 写（useLayoutEffect + 可见性守卫）", () => {
    expect(DOCK).not.toContain('setProperty("--mb-app-h"');   // 注释里提到它可以，写它不行
    expect(SURFACE).toContain('setProperty("--mb-app-h"');
    expect(SURFACE).toContain("useLayoutEffect");
    expect(SURFACE).toContain("getBoundingClientRect().width");   // 隐藏 keep-alive 视图不写
  });

  it("几何算术走纯函数：dock 里不再内联算式", () => {
    expect(DOCK).not.toMatch(/innerHeight - base \+ panelHeight/);
    expect(SURFACE).toContain("dockKbOffset(");
    expect(SURFACE).toContain("bottomOccupation(");
    expect(SURFACE).toContain("shellSurfaceHeight(");
    expect(MODEL).toContain("export function dockKbOffset");
  });

  it("收面板只有 closePanel 一个出口：先 setPanel(null) 再放回输入法/收键盘；dock 的 togglePanel 只调它", () => {
    const iSet = closePanel.indexOf("setPanel(null)");
    const iRestore = closePanel.indexOf("restoreIme()");
    expect(iSet).toBeGreaterThanOrEqual(0);
    expect(iRestore).toBeGreaterThan(iSet);
    expect(SURFACE).toContain('"restore" | "hide"');            // 两档：restore = 放回输入法（默认）/ hide = 只收键盘、光标留住（⌨）
    expect(closePanel).toContain("suppressIme()");
    const toggle = handlerBody(DOCK, "togglePanel");
    expect(toggle).toContain("closePanel()");
    expect(toggle).toContain("openPanel(mode)");
    expect(toggle).not.toContain("setClosing(true)");
  });

  it("面板态只有 setPanel 一个写入口，且 dock 不再自己管面板状态（P3：状态机在 hook 里）", () => {
    expect([...SURFACE.matchAll(/setPanelMode\(/g)].length).toBe(1);
    expect(SURFACE).toMatch(/const setPanel = useCallback/);
    expect(DOCK).not.toContain("setPanelMode");
    expect(DOCK).not.toContain("useState<PanelMode>");
    expect(DOCK).not.toContain("setPanelHeight");
  });

  it("hook 必须在早退之前（文档从阅读态切编辑态会崩）", () => {
    // ⚠️ 早退位置必须用"独占一行"的正则来找：源码注释里也提到过这行字，indexOf 会命中注释 ⇒ 假红。
    const dockAt = /\n\s*if \(!editing\) return null;/.exec(DOCK)?.index ?? -1;
    for (const [name, src, at] of [
      ["EditorDock", DOCK, dockAt],
      ["QuickNoteComposer", COMPOSER, COMPOSER.indexOf("if (!draftReady) return")],
    ] as const) {
      expect(at, name + " 找不到早退语句").toBeGreaterThan(0);
      expect([...src.slice(at).matchAll(HOOK_CALL)], name + " 早退之后仍有 hook").toEqual([]);
    }
  });
});
