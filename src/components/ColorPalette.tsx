/**
 * 应用内统一颜色选择面板（全量内核实色卡 + 最近使用 + 自定义颜色）+ 它用的锚定浮层原语 Popover。
 *
 * 261008：从 features/bitable/bitableCells.tsx 移到这里 —— 表格工具栏的「文字颜色 /
 * 背景颜色」与工作表标签右键的「更改颜色」也要用同一个选色盘（AGENTS §3#19：应用内选色只有一个实现，
 * 最近使用按入口分桶）。bitableCells 继续 re-export ⇒ 多维表调用点一行都不用改。
 */
import { type ReactNode, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { COLOR_BOARD_GROUPS, contrastTextColor } from "../core/colorPalette.js";
import { optionColorHex } from "../core/bitableDoc.js";
import { writeLocalStorage } from "../lib/localStorageSafe.js";
import { Popover as OverlayPopover } from "./ui/Overlay";
import { usePopoverPosition } from "../hooks/usePopoverPosition";
import "./colorPalette.css";

/** 锚点是否位于某个对话框/抽屉表面内（决定嵌套浮层是否抬到对话框之上）。 */
export function isInsideDialog(el: HTMLElement | null | undefined): boolean {
  return !!el?.closest(".ln-dialog");
}

export interface PopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  /** 无锚点元素的场合（列头右键菜单）：直接给视口坐标，浮层左上角落在这里。 */
  at?: { x: number; y: number } | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "start" | "end";
  /** 默认在锚点下方；right = 作为点击子菜单贴锚点右侧展开。 */
  side?: "below" | "right";
  /** 点击其它嵌套浮层时也关闭；颜色选择器用，普通菜单保持父层保护。 */
  closeOnNestedOverlay?: boolean;
}

/** 锚定浮层：portal 到 body，避免被表格 overflow 裁剪；外点/Esc 关闭。
 *  表面走 Overlay 原语的 .ln-popover（单一来源）；.bt-popover 只留内容尺寸。
 *  锚点在对话框/抽屉内时抬层，避免被对话框表面盖住。
 *  锚点可为 null 而改用 at 坐标（列头右键菜单没有稳定锚点元素）。
 *  **定位走 usePopoverPosition：先量真实尺寸，下方放不下翻上方**（260929 修日期选择器贴底被裁）。 */
export function Popover({ open, anchor, at, onClose, children, width = 240, align = "start", side = "below", closeOnNestedOverlay = false }: PopoverProps) {
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, at, width, align, side });
  if (!open || !style) return null;
  return (
    <OverlayPopover className="bt-popover" raised={isInsideDialog(anchor)} onDismiss={onClose} surfaceRef={surfaceRef} ignoreOutside={(t) => !!anchor?.contains(t)} closeOnNestedOverlay={closeOnNestedOverlay} style={style}>
      {children}
    </OverlayPopover>
  );
}

const recentColorStore = new Map<string, string[]>();
const RECENT_COLOR_PREFIX = "lake.bitable.recent-colors.";

function recentStorageKey(key: string) {
  return RECENT_COLOR_PREFIX + key;
}

function readRecentColors(key: string): string[] {
  const cached = recentColorStore.get(key);
  if (cached) return [...cached];
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(recentStorageKey(key)) ?? "[]");
    const colors = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && /^#[0-9a-fA-F]{6}$/.test(item)).slice(0, 5)
      : [];
    recentColorStore.set(key, colors);
    return [...colors];
  } catch {
    return [];
  }
}

/**
 * 该入口**最近一次用过的颜色**（= 最近使用桶的第一条）；没有则 null。
 * 261008：表格颜色按钮「点图标 = 用上次的颜色」靠它 —— 记忆复用最近使用桶，不另存一份。
 */
export function lastUsedColor(key: string): string | null {
  return readRecentColors(key)[0] ?? null;
}

function rememberColor(key: string, color: string) {
  const normalized = color.toLowerCase();
  const next = [normalized, ...readRecentColors(key).filter((item) => item !== normalized)].slice(0, 5);
  recentColorStore.set(key, next);
  writeLocalStorage(recentStorageKey(key), JSON.stringify(next));
}

/** 应用内统一颜色选择面板：全量内核实色卡 + 最近使用 + 自定义颜色。 */
export function ColorPalette({ anchor, at, value, recentKey, onPick, onClose, defaultLabel, defaultKind = "background", onDefault, side = "below", closeOnPick = true, closeOnNestedOverlay = false }: {
  anchor: HTMLElement;
  /**
   * 坐标锚点（优先于 anchor，见 usePopoverPosition）。
   * 261008：右键菜单项点完就卸载（内核 close()）⇒ 锚点元素会变成游离节点、rect 全 0，
   * 必须在点击那一刻量好坐标传进来，否则浮层跑到左上角。
   */
  at?: { x: number; y: number } | null;
  value?: string;
  /** 最近使用独立分桶：不同业务入口互不混合。 */
  recentKey: string;
  onPick: (color: string) => void;
  onClose: () => void;
  /** 顶部默认项：文字色 = 默认色；背景/填色 = 无背景色。 */
  defaultLabel?: string;
  defaultKind?: "text" | "background";
  onDefault?: () => void;
  /** 列文字颜色以点击子菜单打开；选择后继续保持，便于实时预览，直到点击空白。 */
  side?: "below" | "right";
  closeOnPick?: boolean;
  /** 普通浮层语义：点击其它嵌套浮层也关闭；列文字子菜单不传，保留子菜单行为。 */
  closeOnNestedOverlay?: boolean;
}) {
  const active = optionColorHex(value)?.toLowerCase();
  const defaultActive = !value || value === "transparent";
  const [recent, setRecent] = useState(() => readRecentColors(recentKey));
  useEffect(() => setRecent(readRecentColors(recentKey)), [recentKey]);
  const pick = (color: string) => {
    rememberColor(recentKey, color);
    setRecent(readRecentColors(recentKey));
    onPick(color);
    if (closeOnPick) onClose();
  };
  return (
    <Popover open anchor={anchor} at={at} onClose={onClose} width={296} align="start" side={side} closeOnNestedOverlay={closeOnNestedOverlay}>
      <div className="bt-color-palette">
        <div className="bt-color-title">选择颜色</div>
        {onDefault && defaultLabel && (
          <button type="button" className="bt-color-clear" onClick={() => { onDefault(); if (closeOnPick) onClose(); }}>
            <span className={"bt-color-swatch bt-color-swatch--clear" + (defaultActive ? " is-selected" : "")}
              style={defaultKind === "text" ? { backgroundColor: "var(--lake-text-1)" } : undefined}>
              {defaultKind === "background" ? <X size={12} /> : null}
            </span>
            {defaultLabel}
          </button>
        )}
        <div className="bt-color-rows">
          {COLOR_BOARD_GROUPS.map((row, rowIndex) => (
            <div className="bt-color-row" key={rowIndex}>
              {row.map((color) => (
                <button key={color} type="button" className={"bt-color-swatch" + (active === color.toLowerCase() ? " is-selected" : "")}
                  style={{ backgroundColor: color }} aria-label={"颜色 " + color}
                  onClick={() => pick(color)}>{active === color.toLowerCase() ? <Check size={12} color={contrastTextColor(color)} /> : null}</button>
              ))}
            </div>
          ))}
        </div>
        <div className="bt-color-recent-title">最近使用自定义颜色</div>
        <div className="bt-color-recent">
          {recent.length > 0 ? recent.map((color) => (
            <button key={color} type="button" className="bt-color-swatch" style={{ backgroundColor: color }} aria-label={"最近使用 " + color} onClick={() => pick(color)} />
          )) : <span>暂无</span>}
        </div>
        <label className="bt-color-custom">
          <span className="bt-color-custom-rainbow" aria-hidden="true" />
          <span>更多颜色</span>
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value : "#262626"} onChange={(event) => pick(event.target.value)} aria-label="更多颜色" />
        </label>
      </div>
    </Popover>
  );
}
