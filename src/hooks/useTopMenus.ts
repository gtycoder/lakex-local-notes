import { useCallback, useEffect, useState } from "react";

/** Owns the two shell-level portal menus without coupling them to App's domain state. */
export function useTopMenus() {
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  const closeMenus = useCallback(() => {
    setTopMenuOpen(false);
    setWorkspaceMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!topMenuOpen && !workspaceMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const moreMenu = document.querySelector(".top-menu--more");
      const moreBtn = document.querySelector('.toolbar__item[aria-label="更多"]');
      const workspaceMenu = document.querySelector(".top-menu--workspace");
      const workspaceBtn = document.querySelector('.toolbar__item[aria-label="工作空间"]');
      if (moreMenu && !moreMenu.contains(target) && moreBtn && !moreBtn.contains(target)) setTopMenuOpen(false);
      if (workspaceMenu && !workspaceMenu.contains(target) && workspaceBtn && !workspaceBtn.contains(target)) setWorkspaceMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [topMenuOpen, workspaceMenuOpen]);

  return { topMenuOpen, setTopMenuOpen, workspaceMenuOpen, setWorkspaceMenuOpen, closeMenus };
}
