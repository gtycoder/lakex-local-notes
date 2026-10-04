/**
 * 浮动工具栏挂载器（桌面编辑态 opt-in，与 blockHandleMount 同型）。
 * 宿主挂点：编辑器挂载容器（随下次创建被清空的 element）；container = 编辑器实例挂载点（.lake-editor-mount）。
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { LakeEditorInstance } from "../lakeRuntime";
import { SelectionToolbar } from "./SelectionToolbar";

export function mountSelectionToolbar(
  hostParent: HTMLElement,
  container: HTMLElement,
  editor: LakeEditorInstance,
): () => void {
  const host = document.createElement("div");
  host.className = "lake-selection-toolbar-host";
  // 浮栏必须挂在**滚动内容**里（.ne-editor-wrap：position:relative + overflow:auto）：
  // 这样它随正文一起滚动（合成器线程同步，零相对位移 ⇒ 不跳），并被滚动容器裁掉
  // （滚到顶界以上从固定工具栏下沿滑出，而不是盖在顶区）。内核尚未建 wrap 时先落 container，
  // placeToolbarNow 会在首次定位时把它移进 wrap。
  const scroller = container.querySelector<HTMLElement>(".ne-editor-wrap");
  (scroller ?? hostParent).appendChild(host);
  const root = createRoot(host);
  root.render(createElement(SelectionToolbar, { editor, container }));
  return () => {
    try { root.unmount(); } catch { /* 编辑器销毁路径不应抛错 */ }
    host.remove();
  };
}
