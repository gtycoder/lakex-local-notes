import { useLayoutEffect, type RefObject } from "react";
import { activeEditorHost } from "../features/editor/activeEditor";

/**
 * 把「编辑内容可视区顶边」实时写进 CSS 变量 `--lake-editor-top`（单位 px，**相对 .document-pane 顶边**）。
 *
 * 为什么需要它（用户 260922 立规）：目录/大纲浮层不得盖住编辑器工具栏，而工具栏是内核的
 * （`.ne-ui`，sticky 在编辑器顶部），高度/是否存在会变（锁定态、空态、将来"浮动工具栏"）。
 * 所以顶边**不能写死常量**，必须运行时量。
 *
 * 量的口径 = pane 内**从顶部连续停靠**的 chrome 栈的底边：
 *  - 候选 = pane 内所有 `.protyle-breadcrumb`（面包屑）与 `.ne-ui`（内核工具条）；
 *  - 按 top 升序，只收「与当前栈底相接（top ≤ 栈底 + TOLERANCE）」的；一旦出现明显间隙说明它
 *    是浮动元素（例如将来的浮动工具栏），**不计入**（面板顶不跟随它下移）；
 *  - 工具条不存在（锁定/空态）→ 自然回退到面包屑底边；都没有 → 0。
 *
 * 观察：ResizeObserver（pane + 已发现的 chrome 元素，覆盖工具条换高/隐藏/切主题）+
 * MutationObserver（tab 切换/编辑器挂载）+ window resize。
 */
const TOLERANCE = 8;

export function useEditorTopVar(paneRef: RefObject<HTMLElement | null>, activeNoteId: string | null): void {
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;

    /**
     * 候选 = pane 级常驻面包屑 + **当前显示中**编辑器的内核工具条。
     * 261005：原来把 pane 下**所有** `.ne-ui` 都当候选 —— 那是几何猜可见（靠隐藏实例 rect 为 0
     * 才被 height>0 挡住）；隐藏方式一改成保留布局，隐藏标签的工具条就会被算进来。
     * 现在只量 `data-active` 那个宿主里的（唯一来源见 activeEditor.ts）。
     */
    const collectInto = (out: Array<{ top: number; bottom: number }>, scope: ParentNode | null, selector: string) => {
      if (!scope) return;
      for (const el of scope.querySelectorAll<HTMLElement>(selector)) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0) out.push({ top: rect.top, bottom: rect.bottom });
      }
    };
    const compute = () => {
      const paneTop = pane.getBoundingClientRect().top;
      const candidates: Array<{ top: number; bottom: number }> = [];
      collectInto(candidates, pane, ".protyle-breadcrumb");
      collectInto(candidates, activeEditorHost(), ".ne-ui");
      candidates.sort((a, b) => a.top - b.top);
      let cursor = paneTop;
      for (const c of candidates) {
        if (c.top <= cursor + TOLERANCE) cursor = Math.max(cursor, c.bottom);
      }
      const value = Math.max(0, Math.min(Math.round(cursor - paneTop), pane.clientHeight));
      pane.style.setProperty("--lake-editor-top", value + "px");
    };

    const observed = new Set<Element>();
    const ro = new ResizeObserver(() => compute());
    const rescan = () => {
      const observeAll = (scope: ParentNode | null, selector: string) => {
        if (!scope) return;
        for (const el of scope.querySelectorAll(selector)) {
          if (!observed.has(el)) { ro.observe(el); observed.add(el); }
        }
      };
      observeAll(pane, ".protyle-breadcrumb");
      observeAll(activeEditorHost(), ".ne-ui");
    };

    compute();
    rescan();
    ro.observe(pane);
    const mo = new MutationObserver(() => { rescan(); compute(); });
    mo.observe(pane, { childList: true, subtree: true });
    window.addEventListener("resize", compute);
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [paneRef, activeNoteId]);
}
