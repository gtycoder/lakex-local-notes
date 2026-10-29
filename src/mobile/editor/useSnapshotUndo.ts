/**
 * 前端撤销栈的宿主接线（261017，对标思源 `LocalUndo` + `restoreUndoFocus`）。
 *
 * 用途：lakex 的 note-mini 编辑器里键入不进 kernel history ⇒ 工具栏撤销对输入无效；
 * 文档里内核会把连续输入合并成一帧 ⇒ "一次撤一段"。这里按"输入停顿"记录 text/lake 快照 +
 * **光标位置**，撤销/重做 = 恢复快照并把光标放回当时的位置（不是文档开头）。
 *
 * 四条实现约束：
 * 1) **防自反馈**：恢复快照会触发 contentchange，必须用 applying 标记忽略；
 * 2) **防重复步**：内容相同不压栈（组合输入期间 contentchange 会重复触发）；
 * 3) **容量双上限**：条数 + 总字符（见 snapshotUndoModel）；
 * 4) **恢复后还原光标/滚动**：内核块有稳定 id，按 id + 块内文本偏移找回光标（思源 restoreUndoFocus 的等价物）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { execEditorCommand } from "./execCommand";
import { reportMobileActionError } from "../lib/reportMobileActionError";
import { applyKernelSelection, readKernelSelection } from "./kernelSelection";
import {
  canRedo,
  canUndo,
  createStack,
  DEFAULT_LIMITS,
  pushSnapshot,
  redoStep,
  undoStep,
  type CaretPos,
  type Snapshot,
  type SnapshotStack,
  type StackLimits,
} from "./snapshotUndoModel";

/** 输入停顿多久算"一步"（对齐桌面 Cmd+Z 的体感；太短会一步一字）。 */
const DEBOUNCE_MS = 450;
/** 恢复快照后忽略 contentchange 的窗口（内核重渲染是异步的）。 */
const APPLY_GUARD_MS = 200;
/** 光标还原的重试次数/间隔（setDocument 后 DOM 异步重建）。 */
const CARET_RETRIES = 4;
const CARET_RETRY_MS = 60;

export interface SnapshotUndoApi {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

const BLOCK_SELECTOR = "ne-p, ne-h1, ne-h2, ne-h3, ne-h4, ne-h5, ne-h6, ne-card, ne-quote, ne-tli, ne-uli, ne-oli, .ne-table";

/** 读当前光标：块 id + 块内纯文本偏移（只认折叠选区；跨块/无焦点返回 null，不阻断撤销）。 */
function readCaret(): CaretPos | null {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!el) return null;
    const block = el.closest(BLOCK_SELECTOR) as HTMLElement | null;
    if (!block || !block.id) return null;
    const probe = document.createRange();
    probe.selectNodeContents(block);
    probe.setEnd(r.startContainer, r.startOffset);
    return { blockId: block.id, offset: probe.toString().length };
  } catch {
    return null;
  }
}

/** 按块 id + 偏移还原光标；块还没渲染出来时重试几次（setDocument 异步）。 */
function restoreCaret(pos: CaretPos | null, attempt = 0): void {
  if (!pos) return;
  const block = document.getElementById(pos.blockId);
  if (!block) {
    if (attempt < CARET_RETRIES) window.setTimeout(() => restoreCaret(pos, attempt + 1), CARET_RETRY_MS);
    return;
  }
  try {
    block.focus?.();
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let remaining = pos.offset;
    let node: Node | null = walker.nextNode();
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    // 偏移超出块尾（撤销后文字变短）：夹到块尾
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch { /* 光标还原失败不阻断内容恢复 */ }
}

/** 记录编辑区滚动位置（文档编辑器可能很高）。 */
function scrollContainerOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".doc-pane.active .ne-editor-wrap, .ne-editor-wrap");
}

export function useSnapshotUndo(
  editor: LakeEditorInstance | null,
  enabled: boolean,
  limits: StackLimits = DEFAULT_LIMITS,
): SnapshotUndoApi {
  const stackRef = useRef<SnapshotStack | null>(null);
  const timerRef = useRef<number | null>(null);
  const applyingRef = useRef(false);
  const [flags, setFlags] = useState<{ undo: boolean; redo: boolean }>({ undo: false, redo: false });

  const sync = useCallback(() => {
    const s = stackRef.current;
    setFlags({ undo: !!s && canUndo(s), redo: !!s && canRedo(s) });
  }, []);

  const readDoc = useCallback((): string => {
    try {
      return editor?.getDocument("text/lake") ?? "";
    } catch {
      return "";
    }
  }, [editor]);

  const capture = useCallback(
    (): Snapshot => ({ doc: readDoc(), pos: readCaret(), sel: readKernelSelection(editor) }),
    [editor, readDoc],
  );

  const commit = useCallback(() => {
    if (!editor || !stackRef.current) return;
    stackRef.current = pushSnapshot(stackRef.current, capture(), limits);
    sync();
  }, [editor, capture, limits, sync]);

  const apply = useCallback(
    (snap: Snapshot) => {
      if (!editor) return;
      const scroller = scrollContainerOf();
      const scrollTop = scroller?.scrollTop ?? 0;
      applyingRef.current = true;
      try {
        editor.setDocument("text/lake", snap.doc);
      } catch (error) { reportMobileActionError("恢复撤销快照", error); }
      // **先恢复内核模型选区**（决定下一个输入落在哪里），再还原可见光标
      applyKernelSelection(editor, snap.sel);
      restoreCaret(snap.pos);
      window.setTimeout(() => {
        try {
          execEditorCommand(editor, "focus");
        } catch (error) { reportMobileActionError("恢复撤销焦点", error); }
        applyKernelSelection(editor, snap.sel);
        restoreCaret(snap.pos);
        if (scroller) scroller.scrollTop = scrollTop;
      }, CARET_RETRY_MS);
      window.setTimeout(() => {
        applyingRef.current = false;
      }, APPLY_GUARD_MS);
    },
    [editor],
  );

  useEffect(() => {
    stackRef.current = null;
    setFlags({ undo: false, redo: false });
    if (!editor || !enabled) return;
    stackRef.current = createStack(readDoc(), readCaret(), readKernelSelection(editor));
    sync();
    const onChange = () => {
      if (applyingRef.current) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        commit();
      }, DEBOUNCE_MS);
    };
    try {
      editor.on("contentchange", onChange);
    } catch (error) { reportMobileActionError("订阅撤销快照", error); }
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      try {
        editor.off?.("contentchange", onChange);
      } catch { /* 卸载路径：内核已销毁/无 off 方法，取消订阅失败无需处理 */ }
    };
  }, [editor, enabled, readDoc, sync, commit]);

  const flushPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      commit();
    }
  }, [commit]);

  const undo = useCallback(() => {
    if (!enabled || !stackRef.current) return;
    flushPending();
    const r = undoStep(stackRef.current);
    if (!r.snap) {
      sync();
      return;
    }
    stackRef.current = r.stack;
    apply(r.snap);
    sync();
  }, [enabled, flushPending, apply, sync]);

  const redo = useCallback(() => {
    if (!enabled || !stackRef.current) return;
    flushPending();
    const r = redoStep(stackRef.current);
    if (!r.snap) {
      sync();
      return;
    }
    stackRef.current = r.stack;
    apply(r.snap);
    sync();
  }, [enabled, flushPending, apply, sync]);

  return { canUndo: flags.undo, canRedo: flags.redo, undo, redo };
}
