export type SidebarMode = "docked" | "floating" | "collapsed";

export function shouldCollapseSidebarOnHoverLeave(mode: SidebarMode): boolean {
  return mode === "floating";
}
