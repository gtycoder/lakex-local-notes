export interface CreateMenuRect {
  bottom: number;
  right: number;
}

export interface SidebarRect {
  left: number;
  right: number;
  width: number;
}

export interface CreateMenuViewport {
  width: number;
  height: number;
}

export interface CreateMenuPosition {
  top: number;
  left: number;
  width: number;
}

export function getCreateMenuPosition(
  button: CreateMenuRect,
  sidebar: SidebarRect,
  viewport: CreateMenuViewport,
  preferredWidth = 150,
  minWidth = 150,
  gap = 8,
): CreateMenuPosition {
  const width = Math.min(preferredWidth, Math.max(minWidth, sidebar.width - gap * 2));
  const left = Math.max(gap, Math.min(sidebar.right - width - gap, viewport.width - width - gap));
  return { top: Math.round(button.bottom + gap), left: Math.round(left), width: Math.round(width) };
}
