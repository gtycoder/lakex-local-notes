import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLongPress } from "../ui/useLongPress";
import { computeDropPosition, createDragGhost, moveDragGhost, removeDragGhost, type DragGhost } from "../../components/model/treeDrag";
import { bridge } from "../bridge";
import { showToast } from "../ui/toastBus";
import { successFeedback, warnFeedback } from "../ui/haptics";
import type { NotebookTreeItem } from "./useNotebookTreeData";

/**
 * 目录树长按拖拽排序（261103 P10-①，原 NotebookWorkspace 内联代码逐字搬移，未改行为）：
 * 长按进入拖拽 / 跟手浮层 / 落点计算（前·后·内）/ 边缘自动滚动 / 松手 FLIP 回弹 / 乐观重排 + 持久化。
 * 输入为显式树数据与回调；输出 drag 状态 + 行事件（longPress / setPressedNode）。
 */
export interface UseTreeDragOptions {
  tree: NotebookTreeItem[];
  setTree: Dispatch<SetStateAction<NotebookTreeItem[]>>;
  expandGroup: (id: string) => void;
  loadTree: () => Promise<NotebookTreeItem[]>;
}

export interface TreeDragState {
  id: string;
  overId: string | null; position: "before" | "after" | "inside" | null;
  /** 边缘自动滚动方向 */
  scrollDir: -1 | 0 | 1;
}

export function useTreeDrag(options: UseTreeDragOptions) {
  const { tree, setTree, expandGroup, loadTree } = options;

  /** 长按拖拽排序（思源口径）：长按进入拖拽，跟手位移 + 落点（前/后/内），松手重排或移入分组。 */
  const [drag, setDrag] = useState<TreeDragState | null>(null);
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;
  const ghostRef = useRef<DragGhost | null>(null);
  /** 长按目标（hook 只能挂一次 ⇒ 用 ref 传"当前按下的那一行"）。 */
  const pressedNode = useRef<NotebookTreeItem | null>(null);
  const setPressedNode = useCallback((item: NotebookTreeItem) => { pressedNode.current = item; }, []);

  // ---- 目录树长按管理（计时/阈值/反馈 = 共用 hook，见 ui/useLongPress.ts）----
  /** 长按 = 进入拖拽排序（菜单走行内 ⋯）。移动取消阈值取 0：目录行上一动就是要滚动，不能误判成长按。 */
  const longPress = useLongPress((touch) => {
    const node = pressedNode.current;
    if (!node) return;
    {
      const startX = touch.clientX;
      const startY = touch.clientY;
      // 关键：标记拖拽中 → CSS 给面板 touch-action:none，避免 WebView 把纵向手势判给滚动并 touchcancel 掉拖拽
      document.body.classList.add("nb-drag-active");
      // 长按 = 进入拖拽排序（菜单改由行内 ⋯ 触发）：克隆源行做跟手浮层，源行留在原位只降透明度（对齐思源）
      const sourceEl = document.querySelector<HTMLElement>('.side-panel-body [data-node-id="' + node.id + '"]');
      ghostRef.current = sourceEl ? createDragGhost(sourceEl, startX, startY) : null;
      setDrag({ id: node.id, overId: null, position: null, scrollDir: 0 });
    }
  }, { moveCancelPx: 0 });
  /** 提交拖拽：同父 → reorderSiblings；跨父/拖入分组 → moveTreeNodeOrdered。 */
  const commitDrag = useCallback(async () => {
    const d = dragRef.current;
    setDrag(null);
    removeDragGhost(ghostRef.current);
    ghostRef.current = null;
    document.body.classList.remove("nb-drag-active");
    if (!d || !d.overId || d.overId === d.id) return;
    const dragged = tree.find((x) => x.id === d.id);
    const over = tree.find((x) => x.id === d.overId);
    if (!dragged || !over) return;
    // inside → 成为该节点的子文档（移动端 notes 也能作父，不止分组）；before/after → 与目标同级
    const targetParent = d.position === "inside" ? over.id : over.parentId;
    const siblings = tree.filter((x) => (x.parentId ?? null) === (targetParent ?? null) && x.id !== d.id);
    let insertAt = siblings.length;
    if (d.position !== "inside") {
      const idx = siblings.findIndex((x) => x.id === over.id);
      insertAt = idx < 0 ? siblings.length : (d.position === "after" ? idx + 1 : idx);
    }
    const orderedIds = [...siblings.slice(0, insertAt).map((x) => x.id), d.id, ...siblings.slice(insertAt).map((x) => x.id)];
    const orderIndex = new Map(orderedIds.map((id, i) => [id, i] as const));
    const before = document.querySelector('.side-panel-body [data-node-id="' + d.id + '"]')?.getBoundingClientRect();
    // 乐观更新：本地立即重排，松手即生效（不等 loadTree 读库 → 修掉 ~2s 延迟）
    setTree(tree.map((x) => {
      const moved = x.id === d.id ? { ...x, parentId: targetParent } : x;
      const i = orderIndex.get(moved.id);
      return i === undefined ? moved : { ...moved, sortOrder: i };
    }));
    if (d.position === "inside") expandGroup(over.id);
    // FLIP：重排后从旧位置平移到新位置（松手回弹）
    window.requestAnimationFrame(() => {
      const el = document.querySelector('.side-panel-body [data-node-id="' + d.id + '"]') as HTMLElement | null;
      const after = el?.getBoundingClientRect();
      if (!el || !before || !after) return;
      const fromDy = before.top - after.top;
      if (Math.abs(fromDy) <= 1) return;
      el.style.transition = "none";
      el.style.transform = "translateY(" + fromDy + "px)";
      window.requestAnimationFrame(() => {
        el.style.transition = "transform 180ms cubic-bezier(.2,.8,.2,1)";
        el.style.transform = "";
        window.setTimeout(() => { el.style.transition = ""; el.style.transform = ""; }, 220);
      });
    });
    // 持久化（仅在失败时重读纠正）
    try {
      if (d.position === "inside") await bridge.moveTreeNodeOrdered(d.id, targetParent!, orderedIds);
      else if ((dragged.parentId ?? null) === (targetParent ?? null)) await bridge.reorderSiblings(targetParent, orderedIds);
      else await bridge.moveTreeNodeOrdered(d.id, targetParent, orderedIds);
      successFeedback(); // 拖拽落点提交成功
    } catch { showToast("移动失败", { type: "error" }); warnFeedback(); void loadTree(); }
  }, [tree, loadTree]);

  useEffect(() => {
    if (!drag) return;
    const panel = document.querySelector(".side-panel-body") as HTMLElement | null;
    let raf = 0;
    /** 由手指位置算出落点（overId/position）与边缘滚动方向；源行留在原位不参与让位（对齐思源）。 */
    const compute = (clientX: number, clientY: number, d: NonNullable<typeof dragRef.current>) => {
      const hit = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest("[data-node-id]") as HTMLElement | null;
      const hitId = hit?.getAttribute("data-node-id") ?? null;
      let overId: string | null = null;
      let position: "before" | "after" | "inside" | null = null;
      if (hit && hitId && hitId !== d.id) {
        overId = hitId;
        position = computeDropPosition(hit.getBoundingClientRect(), clientY) ?? "inside";
      }
      // 边缘自动滚动：靠近面板上/下沿 64px 内 → 持续滚动
      let scrollDir: -1 | 0 | 1 = 0;
      if (panel) {
        const pr = panel.getBoundingClientRect();
        if (clientY < pr.top + 64) scrollDir = -1;
        else if (clientY > pr.bottom - 64) scrollDir = 1;
      }
      return { overId, position, scrollDir };
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      moveDragGhost(ghostRef.current, t.clientX, t.clientY);
      const next = compute(t.clientX, t.clientY, d);
      if (d.overId === next.overId && d.position === next.position && d.scrollDir === next.scrollDir) return;
      setDrag({ ...d, ...next });
    };
    const tick = () => {
      const d = dragRef.current;
      if (!d || !panel) { raf = 0; return; }
      if (d.scrollDir && panel.scrollHeight > panel.clientHeight) panel.scrollTop += d.scrollDir * 8;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    const onEnd = () => { removeDragGhost(ghostRef.current); ghostRef.current = null; void commitDrag(); };
    const onCancel = () => { removeDragGhost(ghostRef.current); ghostRef.current = null; document.body.classList.remove("nb-drag-active"); void commitDrag(); };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      document.body.classList.remove("nb-drag-active");
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [drag !== null, commitDrag]);

  // 组件卸载时清掉可能残留的拖拽浮层
  useEffect(() => () => { removeDragGhost(ghostRef.current); ghostRef.current = null; }, []);

  return { drag, longPress, setPressedNode };
}
