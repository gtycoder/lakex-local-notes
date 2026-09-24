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
  hostParent.appendChild(host);
  const root = createRoot(host);
  root.render(createElement(SelectionToolbar, { editor, container }));
  return () => {
    try { root.unmount(); } catch { /* 编辑器销毁路径不应抛错 */ }
    host.remove();
  };
}
