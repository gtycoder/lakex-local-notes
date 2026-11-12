import { useCallback, useEffect, useState, type RefObject } from "react";
import { isInsideOverlaySurface } from "../components/ui/Overlay";

export interface TopMenuRefs {
  workspaceTriggerRef?: RefObject<HTMLElement>;
  moreTriggerRef?: RefObject<HTMLElement>;
  workspaceMenuRef?: RefObject<HTMLElement>;
  moreMenuRef?: RefObject<HTMLElement>;
}

function containsTarget(ref: RefObject<HTMLElement> | undefined, target: Node): boolean {
  return Boolean(ref?.current?.contains(target));
}

/** Owns the two shell-level portal menus without coupling them to App's domain state. */
export function useTopMenus(refs: TopMenuRefs = {}) {
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  const closeMenus = useCallback(() => {
    setTopMenuOpen(false);
    setWorkspaceMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!topMenuOpen && !workspaceMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // 悬停子菜单（「导出 ▸」等）是**独立 portal 表面**，不在 trigger/menu 的 DOM 里：
      // 不豁免的话 pointerdown 会先关掉父菜单、子项在 click 之前就被卸载
      // ⇒ 用户看到「点了没反应」（261112 报「文档右上角导出不能用」）。判据与 Overlay 同源。
      if (isInsideOverlaySurface(target)) return;
      if (topMenuOpen && !containsTarget(refs.moreTriggerRef, target) && !containsTarget(refs.moreMenuRef, target)) {
        setTopMenuOpen(false);
      }
      if (workspaceMenuOpen && !containsTarget(refs.workspaceTriggerRef, target) && !containsTarget(refs.workspaceMenuRef, target)) {
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [refs.moreMenuRef, refs.moreTriggerRef, refs.workspaceMenuRef, refs.workspaceTriggerRef, topMenuOpen, workspaceMenuOpen]);

  return { topMenuOpen, setTopMenuOpen, workspaceMenuOpen, setWorkspaceMenuOpen, closeMenus };
}
