/**
 * 壳层快捷键注册表（261114）——**单一来源**：keydown 匹配、设置页清单、用户手册都从这里取，
 * 避免"代码常量 / 设置页文案 / guide 表格"三处漂移（261113 调研，见 HANDOFF）。
 *
 * 口径：
 *  · 键位用 **KeyboardEvent.code**（KeyW / BracketRight / F9），不用 event.key ——
 *    ⇧] 在美式键盘上 key 是 "}"，按 key 匹配必失配；code 不受 shift/键盘布局影响。
 *  · `Mod` = macOS 的 ⌘ / 其它平台的 Ctrl；显示文案按平台格式化（formatChord）。
 *  · 暂**不支持自定义**（P2）。地基先留好：RESERVED_CHORDS（系统/内核保留键）+ 纯函数匹配，
 *    将来加"存储 + 录制 UI"即可，无需重构。改动默认键必须同步本文件 + SETTING_ITEMS + guide/13。
 *
 * 平台差异：手机无键盘（不接壳层快捷键）；平板外接键盘另有一套 `mobile/pad/usePadShortcuts`（不并入）。
 */

export type ShortcutPlatform = "mac" | "other";

/** 壳层命令 id（只列真正有处理函数的；展示型条目见 DISPLAY_ONLY_SHORTCUTS）。 */
export type ShellCommandId =
  | "global-search"
  | "new-document"
  | "close-tab"
  | "prev-tab"
  | "next-tab"
  | "sync"
  | "focus-mode"
  | "toggle-sidebar";

export interface ShellCommandDef {
  id: ShellCommandId;
  /** 设置页 / 条目搜索用的稳定 id（settingsSearch.ts 的 SETTING_ITEMS 必须同名登记，否则门禁红）。 */
  settingId: string;
  label: string;
  /** 规范键位；第 1 个 = 主键位（设置页展示），其余为别名（不重复登记设置行）。 */
  chords: readonly string[];
}

/**
 * 顺序 = 设置页展示顺序（261113 调研表）：全局 → 标签 → 文档 → 同步 → 视图。
 * 与思源对齐的键：⌘P 全局搜索、⌘N 新建、⌘W 关标签、⇧⌘[ / ⇧⌘] 切标签、F9 同步；
 * 我们保留自己的：⌘K（搜索别名）、⌘⇧Enter（专注）、⌘]（侧栏，Feishu 口径）、⌘1–5（一级空间，不采用思源的标签数字键）。
 */
export const SHELL_COMMANDS: readonly ShellCommandDef[] = [
  { id: "global-search", settingId: "shortcut-search", label: "打开全局搜索（标题和正文）", chords: ["Mod+KeyP", "Mod+KeyK"] },
  { id: "new-document", settingId: "shortcut-new-document", label: "新建文档（知识库=弹窗新建，日记=今天新建）", chords: ["Mod+KeyN"] },
  { id: "close-tab", settingId: "shortcut-close-tab", label: "关闭当前标签", chords: ["Mod+KeyW"] },
  { id: "prev-tab", settingId: "shortcut-prev-tab", label: "上一个标签", chords: ["Mod+Shift+BracketLeft"] },
  { id: "next-tab", settingId: "shortcut-next-tab", label: "下一个标签", chords: ["Mod+Shift+BracketRight"] },
  { id: "sync", settingId: "shortcut-sync", label: "立即同步（未配置/已关闭会给理由）", chords: ["F9"] },
  { id: "focus-mode", settingId: "shortcut-focus", label: "进入或退出专注模式", chords: ["Mod+Shift+Enter"] },
  { id: "toggle-sidebar", settingId: "shortcut-sidebar", label: "收起或固定目录栏", chords: ["Mod+BracketRight"] },
];

/** 展示型条目（不是壳层命令）：搜索结果导航 / Esc / 设置（设置走 macOS 菜单 accelerator）。 */
export interface ShortcutDisplayDef {
  settingId: string;
  label: string;
  mac: string;
  other: string;
}

export const DISPLAY_ONLY_SHORTCUTS: readonly ShortcutDisplayDef[] = [
  { settingId: "shortcut-move", label: "在搜索结果中移动", mac: "↑ / ↓", other: "↑ / ↓" },
  { settingId: "shortcut-open", label: "打开搜索结果并定位命中", mac: "Enter", other: "Enter" },
  { settingId: "shortcut-open-tab", label: "在新标签打开并定位命中", mac: "⌘Enter", other: "Ctrl+Enter" },
  { settingId: "shortcut-esc", label: "关闭当前菜单或浮层", mac: "Esc", other: "Esc" },
  { settingId: "shortcut-settings", label: "打开偏好设置", mac: "⌘,", other: "Ctrl+," },
];

/**
 * 不可绑定：系统保留（复制/粘贴/全选/撤销/缩放…）+ 内核已占用（⌘F 文档内查找、⌘B/I/U 格式）
 * + 思源明确禁用的 ⌘S/⌘Q（保存/退出走应用自身流程，不让快捷键抢语义）。
 * 单测断言默认键位与本表不相交；将来做自定义时，录制 UI 也要拒收这里面的组合。
 */
export const RESERVED_CHORDS: readonly string[] = [
  "Mod+KeyS", "Mod+KeyQ",
  "Mod+KeyA", "Mod+KeyX", "Mod+KeyC", "Mod+KeyV", "Mod+KeyZ", "Mod+Shift+KeyZ",
  "Mod+Digit0", "Mod+Minus", "Mod+Equal", "Mod+Slash",
  "Mod+KeyF", "Mod+KeyB", "Mod+KeyI", "Mod+KeyU",
  "Shift+ArrowUp", "Shift+ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight", "Shift+Tab",
  "Ctrl+KeyD", "Mod+Home", "Mod+End", "Shift+Enter",
  "PageUp", "PageDown", "Backspace", "Delete", "Escape", "Tab",
];

export interface ShortcutEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

interface ParsedChord {
  code: string;
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** 把 "Mod+Shift+BracketRight" 拆成结构化键位（纯函数，可单测）。 */
export function parseChord(chord: string): ParsedChord {
  const parts = chord.split("+").filter(Boolean);
  const parsed: ParsedChord = { code: "", mod: false, ctrl: false, shift: false, alt: false };
  for (const part of parts) {
    if (part === "Mod") parsed.mod = true;
    else if (part === "Ctrl") parsed.ctrl = true;
    else if (part === "Shift") parsed.shift = true;
    else if (part === "Alt") parsed.alt = true;
    else parsed.code = part;
  }
  if (!parsed.code) throw new Error("快捷键缺少主键: " + chord);
  return parsed;
}

const KEY_TO_CODE: Record<string, string> = {
  "]": "BracketRight",
  "[": "BracketLeft",
  ",": "Comma",
  "-": "Minus",
  "=": "Equal",
  "/": "Slash",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/** 事件 code 兜底（jsdom/合成事件可能没有 code）：按 key 反推 code。 */
export function codeOf(event: ShortcutEventLike): string {
  if (event.code) return event.code;
  if (KEY_TO_CODE[event.key]) return KEY_TO_CODE[event.key];
  if (/^[a-zA-Z]$/.test(event.key)) return "Key" + event.key.toUpperCase();
  if (/^[0-9]$/.test(event.key)) return "Digit" + event.key;
  if (/^F\d{1,2}$/.test(event.key)) return event.key;
  return event.key;
}

/** 单条键位是否命中该事件（严格匹配修饰键：多按/少按都不算命中）。 */
export function chordMatches(event: ShortcutEventLike, chord: string, platform: ShortcutPlatform): boolean {
  const p = parseChord(chord);
  if (codeOf(event) !== p.code) return false;
  const wantMeta = platform === "mac" && p.mod;
  const wantCtrl = platform === "mac" ? p.ctrl : p.mod || p.ctrl;
  return (event.metaKey === true) === wantMeta
    && (event.ctrlKey === true) === wantCtrl
    && (event.shiftKey === true) === p.shift
    && (event.altKey === true) === p.alt;
}

/** 命中哪个壳层命令（未命中 = null）。同一事件只可能命中一个命令（单测断言键位无重叠）。 */
export function matchShellCommand(event: ShortcutEventLike, platform: ShortcutPlatform): ShellCommandId | null {
  for (const command of SHELL_COMMANDS) {
    if (command.chords.some((chord) => chordMatches(event, chord, platform))) return command.id;
  }
  return null;
}

const KEY_LABELS: Record<string, string> = {
  BracketRight: "]",
  BracketLeft: "[",
  Comma: ",",
  Minus: "-",
  Equal: "=",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "⌫",
  Delete: "⌦",
};

function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** 显示文案：mac = ⇧⌘] / ⌘P；其它平台 = Ctrl+Shift+] / Ctrl+P。 */
export function formatChord(chord: string, platform: ShortcutPlatform): string {
  const p = parseChord(chord);
  const key = keyLabel(p.code);
  if (platform === "mac") {
    const prefix = (p.ctrl ? "⌃" : "") + (p.alt ? "⌥" : "") + (p.shift ? "⇧" : "") + (p.mod ? "⌘" : "");
    return prefix + key;
  }
  const parts: string[] = [];
  if (p.mod || p.ctrl) parts.push("Ctrl");
  if (p.alt) parts.push("Alt");
  if (p.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** 设置页展示用：主键位 + 别名（例如「⌘P / ⌘K」）。 */
export function formatCommandKeys(command: ShellCommandDef, platform: ShortcutPlatform): string {
  return command.chords.map((chord) => formatChord(chord, platform)).join(" / ");
}

export function detectPlatform(source?: string): ShortcutPlatform {
  const probe = source ?? (typeof navigator === "undefined" ? "" : (navigator.platform || navigator.userAgent || ""));
  return /mac|iphone|ipad|ipod|darwin/i.test(probe) ? "mac" : "other";
}
