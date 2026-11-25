/**
 * dock 命令状态（M-04 从 EditorDock.tsx 拆出；纯判据 + hook，零行为变化）：
 * - 纯判据：行高回显换算、行内标记（DOM 计算样式）与块级/历史命令（内核 queryCommand*）的生效/可用态、
 *   取值型命令（字号/对齐/字色/背景色）读值；
 * - hook：useActiveCommandStates（selectionchange + 命令后 refresh）与 useEditorExec（命令执行 + 卡片保护区）。
 * 红线：查不到一律按「未生效」返回（不误点亮）；「取值型命令不另造一套」契约见下方注释。
 * 护栏：editor/execCommand.test.ts（命令入口唯一性）、dockPanelFocusGuard.test.ts（hook 位置）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { editorCommandFailureMessage, execEditorCommandResult } from "./execCommand";
import { showToast } from "../ui/toastBus";
// 卡片保护区（261123：插表情把整卡顶掉）：插入类命令在「选区触卡」时一律不执行（insertGuard 头注释）。
import { INSERT_BLOCKED_HINT, selectionTouchesCard } from "../../features/editor/insertGuard";
import type { LineHeightValue } from "../ui/LineHeightStepper";
// 「Aa」面板的取值型命令（字号/对齐/字色/背景色）与链接，全部复用既有单一来源（本文不另造一套）
// 注：移动端**色板**不再走内核色卡适配器 LakeColorBoard，而是照语雀排布自己画 2×7 圆点格
//（用户 261012 定稿「色板照抄语雀、不用那么多颜色」）；颜色仍全部取自 core/colorPalette.ts 的内核色阶。
import { toFontSize, unwrapValue } from "../../features/editor/selectionToolbar/selectionToolbarModel";

/** 行高回显值（activeValues.lineHeight 是字符串）→ 步进器取值：空串 = 内核默认（未设置）。 */
export function lineHeightValue(raw: string): LineHeightValue | null {
  if (!raw) return null;
  if (raw === "default") return "default";
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** 需要监测实时状态（生效高亮）的命令 */
const STATE_COMMANDS = ["bold", "italic", "underline", "code", "quote", "unorderedList", "orderedList", "taskList", "undo", "redo"] as const;
/** 需要监测「可用态」（按钮置灰）的命令：历史命令用 queryCommandEnabled，不是 state/active。 */
const ENABLED_COMMANDS = ["undo", "redo"] as const;

/** 行内标记命令：生效检测走 DOM 计算样式（lakex 的 queryCommandState 对 mark 恒返回 -1，不可靠）。 */
const MARK_NAMES = new Set(["bold", "italic", "underline", "code"]);

/** 读取光标/选区处某个标记是否生效（基于 DOM 计算样式，lakex 版本无关）：加粗 font-weight≥600、斜体 font-style、下划线、行内代码。 */
function activeMarkFromDom(name: string): boolean {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  if (!node) return false;
  let el: Element | null = node.nodeType === 1 ? (node as Element) : (node as ChildNode).parentElement;
  const editor = el?.closest?.('[contenteditable="true"]');
  if (!editor || !el) return false;
  for (let cur: Element | null = el; cur && editor.contains(cur); cur = cur.parentElement) {
    const s = getComputedStyle(cur);
    if (name === "bold" && parseInt(s.fontWeight) >= 600) return true;
    if (name === "italic" && s.fontStyle === "italic") return true;
    if (name === "underline" && s.textDecorationLine.includes("underline")) return true;
    if (name === "code" && (cur.tagName === "CODE" || /\bne-code\b|\bne-inline-code\b/.test(cur.className || ""))) return true;
    if (cur === editor) break;
  }
  return false;
}

/**
 * 读取某命令当前是否生效：
 * - 行内标记（bold/italic/underline/code）→ DOM 计算样式（可靠，见 activeMarkFromDom）；
 * - 块级/历史（quote/列表/待办/undo/redo）→ lakex renderer.queryCommandState（返回 1= 生效，-1= 不确定）；
 * 均做了安全访问，查不到即视为未生效（不误点亮）。 */
function isCommandEnabled(editor: LakeEditorInstance | null, name: string): boolean {
  if (!editor) return false;
  const ed = editor as unknown as {
    queryCommandEnabled?: (n: string) => unknown;
    renderer?: { queryCommandEnabled?: (n: string) => unknown };
  };
  try {
    const v = ed.queryCommandEnabled?.(name) ?? ed.renderer?.queryCommandEnabled?.(name);
    return v === true;
  } catch {
    return false;
  }
}

function isCommandActive(editor: LakeEditorInstance | null, name: string): boolean {
  if (MARK_NAMES.has(name)) return activeMarkFromDom(name);
  if (!editor) return false;
  const ed = editor as unknown as {
    queryCommandState?: (n: string) => boolean | number;
    renderer?: { queryCommandState?: (n: string) => boolean | number };
  };
  try {
    const v = ed.queryCommandState?.(name) ?? ed.renderer?.queryCommandState?.(name);
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;   // 1=生效，0=未生效，-1=不确定 → 不当生效处理
  } catch { /* 内核未实现该命令查询 / 实例销毁：按「未生效」返回，避免误点亮工具栏 */ }
  return false;
}

/** 选区处的「取值型」命令状态（字号/对齐/字色/背景色）—— 面板高亮与色板回显的唯一来源。 */
export interface SelectionValues { fontSize: number | null; lineHeight: string; alignment: string; color: string; bgColor: string }
const EMPTY_VALUES: SelectionValues = { fontSize: null, lineHeight: "", alignment: "", color: "", bgColor: "" };
function sameValues(a: SelectionValues, b: SelectionValues): boolean {
  return a.fontSize === b.fontSize && a.lineHeight === b.lineHeight && a.alignment === b.alignment && a.color === b.color && a.bgColor === b.bgColor;
}
/** 读内核查询值（解数组、异常归 undefined；调用方自行把 undefined/null 当"无值"，不误点亮）。 */
export function readCommandValue(editor: LakeEditorInstance, name: string, arg?: unknown): unknown {
  try { return unwrapValue(editor.queryCommandValue?.(name, ...(arg === undefined ? [] : [arg]))); } catch { return undefined; }
}
function valueText(editor: LakeEditorInstance, name: string): string {
  const v = readCommandValue(editor, name);
  return v === null || v === undefined ? "" : String(v);
}

/** 光标/选区变化时刷新各命令生效状态（selectionchange + 命令执行后主动 refresh）。 */
export function useActiveCommandStates(editor: LakeEditorInstance | null) {
  const [states, setStates] = useState<Record<string, boolean>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<SelectionValues>(EMPTY_VALUES);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const refresh = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const next: Record<string, boolean> = {};
    for (const name of STATE_COMMANDS) next[name] = isCommandActive(ed, name);
    setStates((prev) => (STATE_COMMANDS.some((k) => prev[k] !== next[k]) ? next : prev));
    const nextEnabled: Record<string, boolean> = {};
    for (const name of ENABLED_COMMANDS) nextEnabled[name] = isCommandEnabled(ed, name);
    setEnabled((prev) => (ENABLED_COMMANDS.some((k) => prev[k] !== nextEnabled[k]) ? nextEnabled : prev));
    // 字号必须带第二参 false 才是「生效字号」（不带第二参时正文返回 null，与桌面固定栏同源）；
    // ⚠️ 内核把字号序列化成 lake-fontsize-N（N = px × 0.75，不是 px）⇒ **不许解析 class**，只能读 queryCommandValue。
    const nextValues: SelectionValues = {
      fontSize: toFontSize(readCommandValue(ed, "fontsize", false)),
      // 261104：行高也进回显（默认返回 null → valueText = ""），供「− 当前 +」步进器显示。
      lineHeight: valueText(ed, "lineHeight"),
      alignment: valueText(ed, "alignment"),
      color: valueText(ed, "color"),
      bgColor: valueText(ed, "bgColor"),
    };
    setValues((prev) => (sameValues(prev, nextValues) ? prev : nextValues));
  }, []);
  useEffect(() => {
    const onSel = () => refresh();
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [refresh]);
  // editor 就绪/切换时刷新一次（selectionchange 不会为首次光标触发）
  useEffect(() => { if (editor) refresh(); }, [editor, refresh]);
  return { states, enabled, values, refresh };
}

/** 执行 Lake 命令（**统一走 execEditorCommandResult**：renderer 缺失时回退实例 execCommand，
 *  文档编辑器就是这种形态；editor 未就绪静默）。
 *  ⚠️ **必须回传内核返回值**：链接的「这条不行就换另一条」判定靠它（linkEditor.ts），
 *  吞掉返回值会退化成"两条都算成功" = 静默 no-op。 */
export function useEditorExec(editor: LakeEditorInstance | null) {
  return (cmd: string, ...args: unknown[]) => {
    // 卡片保护区（261123）：插入类命令在「选区触卡」时一律不执行——内核语义是「非折叠选区被替换」，
    // 整卡选中/卡聚焦态下执行 = 整卡被顶掉或插入静默丢失（insertGuard 头注释）。表情/「＋」面板全部插入项共用这条。
    if ((cmd === "insertAtSelection" || cmd === "insertCard") && selectionTouchesCard()) {
      showToast(INSERT_BLOCKED_HINT, { type: "error" });
      return undefined;
    }
    const result = execEditorCommandResult(editor, cmd, ...args);
    if (!result.ok && result.reason !== "editor-unavailable") showToast(editorCommandFailureMessage(cmd, result), { type: "error" });
    return result.ok ? result.value : undefined;
  };
}
