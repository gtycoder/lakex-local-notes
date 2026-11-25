/**
 * 手写板撤销 / 重做域（261125 D-06 拆分：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 职责：撤销/重做栈（**只存页级补丁**，不把整篇正文压栈）+ 唯一正文提交入口 commit。
 * 三条不变量（改这里先读 inkPadModel.ts 头注释、docs/INK-PAD.md）：
 *  1. **热路径不序列化**：commit / undo / redo 只改内存 + 标脏（scheduleSave），落盘时才现算整篇（P5）。
 *  2. patch=null 表示这次改动不进入撤销栈（没有历史语义）。
 *  3. 页级补丁的构建/应用单一来源 = history.ts（inkPagePatch / applyInkPatch，行为测试 history.test.ts）。
 */
import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { InkDoc } from "../../core/inkDoc.js";
import { applyInkPatch, pushBoundedHistory, type InkHistoryEntry, type InkPatch } from "./history.js";

export interface InkHistoryDeps {
  /** 正文状态（useInkDocState 的 docRef）：所有提交都直接落它。 */
  docRef: MutableRefObject<InkDoc | null>;
  setDoc: Dispatch<SetStateAction<InkDoc | null>>;
  /** 保存管线的标脏 + 防抖入口（useInkDocState）；提交不序列化整篇正文。 */
  scheduleSave: () => void;
  readOnly: boolean;
}

export interface InkHistoryState {
  /** patch=null 表示这次改动不进入撤销栈（没有历史语义）。 */
  commit: (next: InkDoc, patch: InkPatch | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useInkHistory({ docRef, setDoc, scheduleSave, readOnly }: InkHistoryDeps): InkHistoryState {
  // 撤销/重做只存页级补丁；整篇正文序列化只用于保存。
  const undoRef = useRef<InkHistoryEntry[]>([]);
  const redoRef = useRef<InkHistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  /** patch=null 表示这次改动不进入撤销栈（没有历史语义）。 */
  const commit = useCallback((next: InkDoc, patch: InkPatch | null) => {
    if (readOnly || !docRef.current) return;
    if (patch) {
      pushBoundedHistory(undoRef.current, patch);
      redoRef.current = [];
    }
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [readOnly, scheduleSave]);

  const undo = useCallback(() => {
    const entry = undoRef.current[undoRef.current.length - 1];
    if (!entry || !docRef.current) return;
    const next = applyInkPatch(docRef.current, entry.patch, "undo");
    undoRef.current.pop();
    pushBoundedHistory(redoRef.current, entry.patch);
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const entry = redoRef.current[redoRef.current.length - 1];
    if (!entry || !docRef.current) return;
    const next = applyInkPatch(docRef.current, entry.patch, "redo");
    redoRef.current.pop();
    pushBoundedHistory(undoRef.current, entry.patch);
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [scheduleSave]);

  const canUndo = historyVersion >= 0 && undoRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoRef.current.length > 0;
  return { commit, undo, redo, canUndo, canRedo };
}
