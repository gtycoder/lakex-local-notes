import React from "react";
import { createPortal } from "react-dom";
import {
  duplicateElements,
  getSelectedElements,
  type PlaitBoard,
} from "@plait/core";

type Locale = "zh-CN" | "en-US";

interface Props {
  board: PlaitBoard | null;
  locale: Locale;
  dark: boolean;
  hasContextSelection: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onAddText: () => void;
  onAddShape: () => void;
  onAddLine: () => void;
  onFitToCanvas: () => void;
  onActualSize: () => void;
  onAddToMaterialLibrary: () => boolean;
}

export default function LakexBoardContextMenu({
  board,
  locale,
  dark,
  hasContextSelection,
  position,
  onClose,
  onAddText,
  onAddShape,
  onAddLine,
  onFitToCanvas,
  onActualSize,
  onAddToMaterialLibrary,
}: Props) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const isZh = locale === "zh-CN";
  const selected = board ? getSelectedElements(board) : [];
  const hasSelection = selected.length > 0 || hasContextSelection;
  const labels = isZh
    ? {
        addText: "添加文字",
        addShape: "添加图形",
        addLine: "添加连线",
        duplicate: "创建副本",
        addMaterial: "添加到素材库",
        actualSize: "实际尺寸",
        fitToCanvas: "自适应",
      }
    : {
        addText: "Add text",
        addShape: "Add shape",
        addLine: "Add connector",
        duplicate: "Duplicate",
        addMaterial: "Add to material library",
        actualSize: "Actual size",
        fitToCanvas: "Fit to canvas",
      };

  React.useEffect(() => {
    if (!position) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, position]);

  if (!board || !position || typeof document === "undefined") return null;

  const left = Math.max(8, Math.min(position.x, window.innerWidth - 208));
  const top = Math.max(8, Math.min(position.y, window.innerHeight - 300));
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="lakex-board-context-menu"
      role="menu"
      aria-label={isZh ? "画板菜单" : "Board menu"}
      data-theme={dark ? "dark" : "light"}
      style={{ left, top }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button type="button" role="menuitem" onClick={() => run(onAddText)}>
        <span>{labels.addText}</span><kbd>T</kbd>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onAddShape)}>
        <span>{labels.addShape}</span><kbd>S</kbd>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onAddLine)}>
        <span>{labels.addLine}</span><kbd>⌘+L</kbd>
      </button>
      <div className="lakex-board-context-menu__divider" />
      <button
        type="button"
        role="menuitem"
        disabled={!hasSelection}
        onClick={() => run(() => duplicateElements(board, selected))}
      ><span>{labels.duplicate}</span><kbd>⌘+D</kbd></button>
      <button
        type="button"
        role="menuitem"
        disabled={!hasSelection}
        onClick={() => run(() => onAddToMaterialLibrary())}
      ><span>{labels.addMaterial}</span></button>
      <div className="lakex-board-context-menu__divider" />
      <button
        type="button"
        role="menuitem"
        onClick={() => run(onActualSize)}
      ><span>{labels.actualSize}</span><kbd>⌘+0</kbd></button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run(onFitToCanvas)}
      ><span>{labels.fitToCanvas}</span><kbd>⌘+Shift+=</kbd></button>
    </div>,
    document.body,
  );
}
