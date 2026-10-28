/**
 * 光标/选区自动跟随滚动（移动端）。
 * 场景：手机屏宽有限，Lake 表格必然横向溢出；点了可视区外的单元格后，光标在看不见的地方继续打字/换行，
 *      用户以为"点没点上"。这里在选区变化时把选区所在单元格滚进可视区（横向滚动容器与正文纵向容器都跟）。
 * 做法：只调"目标所在的那条滚动链"的 scrollLeft/scrollTop（不用 scrollIntoView——它会连窗口一起滚，
 *      在 WebView 里表现为整页乱跳）。
 *
 * ⚠️「什么是光标」的判据是纯函数 resolveCaretRect（./caretIntoViewTarget）：只有文本/叶级节点上的选区
 * 才算光标。mode 切换（viewer ⇄ editor）会销毁重建 LakeEditor，此时 DOM 选区会塌到编辑器宿主 div，
 * range 没有 client rect —— 旧实现拿宿主整块 rect 当光标，直接滚到文档末尾（261027 修）。
 */
import { useEffect, type RefObject } from "react";
import { resolveCaretRect } from "./caretIntoViewTarget";

const MARGIN = 20;         // 距容器边缘的安全边距
const BOTTOM_EXTRA = 72;   // 底部再让出编辑工具栏的空间

function scrollableEl(el: HTMLElement): { x: boolean; y: boolean } | null {
  const cs = getComputedStyle(el);
  const ox = cs.overflowX, oy = cs.overflowY;
  const canX = (ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 2;
  const canY = (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 2;
  return canX || canY ? { x: canX, y: canY } : null;
}

/** anchor 元素是否叶级（没有元素子节点）——带子节点的是整块/宿主容器，不是光标位置。 */
function isLeafElement(el: Element): boolean {
  return el.childElementCount === 0;
}

export function useCaretIntoView(rootRef: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let lastKey = "";

    const run = () => {
      raf = 0;
      const root = rootRef.current;
      if (!root) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (!anchor) return;
      const anchorEl = anchor.nodeType === 1 ? (anchor as HTMLElement) : anchor.parentElement;
      if (!anchorEl) return;
      const range = sel.getRangeAt(0);
      // 目标块：单元格 > 最近的可编辑块 > 当前元素
      const target = anchorEl.closest<HTMLElement>("td, th, ne-td, ne-th, .ne-table-cell") ?? anchorEl;
      const rangeRects = range.getClientRects();
      const rect = resolveCaretRect({
        anchorNodeType: anchor.nodeType,
        inRoot: root.contains(anchorEl),
        anchorIsRoot: anchorEl === root,
        commonAncestorCoversRoot: range.commonAncestorContainer !== root && range.commonAncestorContainer.contains(root),
        anchorIsLeaf: anchor.nodeType === 1 && isLeafElement(anchor as Element),
        rangeRectCount: rangeRects.length,
        rangeRect: rangeRects.length ? range.getBoundingClientRect() : null,
        targetRect: target.getBoundingClientRect(),
        rootClientHeight: root.clientHeight,
      });
      if (!rect) return;
      if (rect.width === 0 && rect.height === 0 && rect.x === 0 && rect.y === 0) return;

      let a: HTMLElement | null = target.parentElement;
      while (a && root.contains(a)) {
        const can = scrollableEl(a);
        if (can) {
          const box = a.getBoundingClientRect();
          let left = a.scrollLeft;
          let top = a.scrollTop;
          if (can.x) {
            if (rect.right > box.right - MARGIN) left += rect.right - (box.right - MARGIN);
            else if (rect.left < box.left + MARGIN) left -= (box.left + MARGIN) - rect.left;
          }
          if (can.y) {
            // 正文容器底部还要让出编辑工具栏的高度（否则光标停在工具栏底下）
            const bottomPad = a === root ? MARGIN + BOTTOM_EXTRA : MARGIN;
            if (rect.bottom > box.bottom - bottomPad) top += rect.bottom - (box.bottom - bottomPad);
            else if (rect.top < box.top + MARGIN) top -= (box.top + MARGIN) - rect.top;
          }
          if (Math.abs(left - a.scrollLeft) > 1 || Math.abs(top - a.scrollTop) > 1) {
            try { a.scrollTo({ left, top, behavior: "smooth" }); } catch { a.scrollLeft = left; a.scrollTop = top; }
          }
        }
        a = a.parentElement;
      }
      lastKey = "";
    };

    const schedule = () => {
      const sel = document.getSelection();
      const key = sel && sel.rangeCount ? (() => { const r = sel.getRangeAt(0); return (r.startContainer.textContent ?? "").slice(0, 8) + ":" + r.startOffset; })() : "";
      if (key && key === lastKey) return;
      lastKey = key;
      if (!raf) raf = requestAnimationFrame(run);
    };

    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerup", schedule);
    // 261014：**视口变化也要复核**（不是只有选区变才需要）。移动端"键盘 ⇄ 面板"切换会让视口 530 ⇄ 842：
    // 浏览器自己的"把光标滚进视口"是按**视口**算的，会把它停在面板/键盘后面（实测：面板一开光标落到 y=585，
    // 而面板从 530 起盖住）。这里按**我们自己的容器盒**再纠一次 —— 小记与文档两条路都吃这条。
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerup", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rootRef, enabled]);
}
