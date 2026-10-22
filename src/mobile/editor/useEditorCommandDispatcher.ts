import { useCallback, useEffect, useRef } from "react";

type ExecCommand = (command: string, ...args: unknown[]) => unknown;

function isEditorNode(node: Node | null): boolean {
  let element: Element | null = node
    ? node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : (node as ChildNode).parentElement
    : null;
  while (element) {
    if (element.nodeType === Node.ELEMENT_NODE && (element as HTMLElement).isContentEditable) return true;
    element = element.parentElement;
  }
  return false;
}

/**
 * 编辑工具条命令分发：组合输入提交、选区快照/还原，以及 inline/panel 两种执行口径。
 * 阅读器的 UI 与面板状态不在这里；这里只保证“命令作用在正确选区、撤销前组合已入 history”。
 */
export function useEditorCommandDispatcher(opts: {
  exec: ExecCommand;
  refreshActive: () => void;
  dismissIme: () => void;
  closePanel: () => void;
}) {
  const { exec, refreshActive, dismissIme, closePanel } = opts;
  const composingRef = useRef(false);
  const savedRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    const onStart = () => { composingRef.current = true; };
    const onEnd = () => { composingRef.current = false; };
    document.addEventListener("compositionstart", onStart, true);
    document.addEventListener("compositionend", onEnd, true);
    return () => {
      document.removeEventListener("compositionstart", onStart, true);
      document.removeEventListener("compositionend", onEnd, true);
    };
  }, []);

  const snapshotSelection = useCallback(() => {
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0 && isEditorNode(selection.anchorNode)) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const range = savedRangeRef.current;
    const selection = document.getSelection();
    if (!range || !selection || !range.startContainer.isConnected) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const runInline = useCallback((command: string, ...args: unknown[]) => {
    if (composingRef.current) {
      const active = document.activeElement as HTMLElement | null;
      try { active?.blur(); } catch { /* 忽略 */ }
      composingRef.current = false;
      // 等一拍让内核收到 compositionend 并记账，再执行命令并交还焦点。
      window.setTimeout(() => {
        try { active?.focus(); } catch { /* 忽略 */ }
        exec(command, ...args);
        snapshotSelection();
        refreshActive();
      }, 60);
      return;
    }
    exec(command, ...args);
    snapshotSelection();
    refreshActive();
  }, [exec, refreshActive, snapshotSelection]);

  const runPanel = useCallback((command: string, ...args: unknown[]) => {
    restoreSelection();
    exec(command, ...args);
    snapshotSelection();
    dismissIme();
    refreshActive();
  }, [dismissIme, exec, refreshActive, restoreSelection, snapshotSelection]);

  const runPanelAndClose = useCallback((command: string, ...args: unknown[]) => {
    restoreSelection();
    exec(command, ...args);
    snapshotSelection();
    refreshActive();
    closePanel();
  }, [closePanel, exec, refreshActive, restoreSelection, snapshotSelection]);

  return { savedRangeRef, snapshotSelection, restoreSelection, runInline, runPanel, runPanelAndClose };
}
