import { useLayoutEffect, type RefObject } from "react";

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

    const compute = () => {
      const paneTop = pane.getBoundingClientRect().top;
      const candidates: Array<{ top: number; bottom: number }> = [];
      for (const sel of [".protyle-breadcrumb", ".ne-ui"]) {
        for (const el of pane.querySelectorAll<HTMLElement>(sel)) {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0) candidates.push({ top: rect.top, bottom: rect.bottom });
        }
      }
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
      for (const el of pane.querySelectorAll(".protyle-breadcrumb, .ne-ui")) {
        if (!observed.has(el)) { ro.observe(el); observed.add(el); }
      }
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
