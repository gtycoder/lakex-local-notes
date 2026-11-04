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
      try { active?.blur(); } catch { /* 合成期间切焦点：元素可能已卸载；命令仍会执行 */ }
      composingRef.current = false;
      // 等一拍让内核收到 compositionend 并记账，再执行命令并交还焦点。
      window.setTimeout(() => {
        try { active?.focus(); } catch { /* 同上：交还焦点尽力而为，失败不阻断命令 */ }
        exec(command, ...args);
        snapshotSelection();
        refreshActive();
      }, 60);
      return;
    }
    // 261104：点 dock 按钮时浏览器会把 DOM 选区打散（按钮不是 contenteditable；命令重渲染 inline mark 时更明显），
    // 表现 = 命令生效了但光标消失/漂移。这里用**按下时快照的 range**（见 EditorDock 的 toolbar onMouseDown），
    // 在命令后（同步 + 下一帧各纠一次）只在选区失效时还回去；块级命令若自己移动了光标（有效 rect）不动。
    exec(command, ...args);
    const repairSelection = () => {
      const range = savedRangeRef.current;
      if (!range || !range.startContainer.isConnected) return;
      const selection = document.getSelection();
      const current = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      const rect = current ? current.getBoundingClientRect() : null;
      const lost = !current || (rect !== null && rect.width === 0 && rect.height === 0);
      if (!lost || !selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
    };
    repairSelection();
    window.requestAnimationFrame(repairSelection);
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
