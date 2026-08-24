export type SidebarMode = "docked" | "floating" | "collapsed";

export function shouldCollapseSidebarOnHoverLeave(mode: SidebarMode): boolean {
  return mode === "floating";
}

/** Resizing temporarily owns pointer leave; do not collapse the floating preview mid-drag. */
export function shouldKeepSidebarPreviewOpen(mode: SidebarMode, resizing: boolean): boolean {
  return mode === "floating" && resizing;
}
