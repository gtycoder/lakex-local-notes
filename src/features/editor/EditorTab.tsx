import { useEffect, useRef, useState } from "react";
import {
  createLakeDocument,
  destroyLakeEditor,
  resolveScrollNode,
  type LakeEditorInstance,
  type LakeEditorPrefs,
} from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";
import { OutlineMode } from "../outline/OutlineController";
import { OutlinePanel } from "../outline/OutlinePanel";
import { OutlineRail } from "../outline/OutlineRail";
import { useOutline } from "../outline/useOutline";

export interface EditorTabProps {
  noteId: string;
  content: string;
  visible: boolean;
  tocEnabled: boolean;
  onChange: (content: string) => void;
  prefs?: LakeEditorPrefs;
  /** 编辑器实例就绪回调（导出 md 等需要访问 editor 实例的场景） */
  onEditorReady?: (noteId: string, editor: LakeEditorInstance | null) => void;
}

function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}

export function EditorTab({ noteId, content, visible, tocEnabled, onChange, prefs, onEditorReady }: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorMountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const [editorState, setEditorState] = useState<LakeEditorInstance | null>(null);
  // 大纲形态：rail（默认图标栏）/ docked（固定展开）/ hidden（设置关闭）
  const [outlineMode, setOutlineMode] = useState<OutlineMode>(tocEnabled ? "rail" : "hidden");
  // rail 模式下 hover 图标弹出的悬浮面板（瞬态）
  const [outlineFloatOpen, setOutlineFloatOpen] = useState(false);
  const hoverTimersRef = useRef<{ enter?: number; leave?: number }>({});
  // 收起/取消固定后短暂抑制 hover 自动弹出（鼠标正停在图标位置，避免刚收起又弹开）
  const hoverCooldownRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const onEditorReadyRef = useRef(onEditorReady);
  onChangeRef.current = onChange;
  onEditorReadyRef.current = onEditorReady;

  const belowToolbar = prefs?.showToolbar !== false;
  const outlineShown = outlineMode === "docked" || (outlineMode === "rail" && outlineFloatOpen);
  const controller = useOutline(editorState, hostRef.current, noteId, tocEnabled, visible && outlineShown);

  // 设置里关闭「显示文档大纲」时完全隐藏；重新打开回到 rail
  useEffect(() => {
    if (!tocEnabled) {
      setOutlineMode("hidden");
      setOutlineFloatOpen(false);
    } else {
      setOutlineMode((m) => (m === "hidden" ? "rail" : m));
    }
  }, [tocEnabled]);

  const clearHoverTimers = (): void => {
    const t = hoverTimersRef.current;
    if (t.enter !== undefined) window.clearTimeout(t.enter);
    if (t.leave !== undefined) window.clearTimeout(t.leave);
    t.enter = undefined;
    t.leave = undefined;
  };
  useEffect(() => clearHoverTimers, []);

  const armHoverCooldown = (): void => {
    hoverCooldownRef.current = Date.now() + 800;
  };
  // rail：hover 图标 → 250ms 后弹出悬浮面板；移出 → 300ms 后收起
  const onRailEnter = (): void => {
    clearHoverTimers();
    if (Date.now() < hoverCooldownRef.current) return;
    hoverTimersRef.current.enter = window.setTimeout(() => setOutlineFloatOpen(true), 250);
  };
  const onRailLeave = (): void => {
    clearHoverTimers();
    hoverTimersRef.current.leave = window.setTimeout(() => setOutlineFloatOpen(false), 300);
  };
  // 点击图标：固定/取消固定
  const onRailClick = (): void => {
    clearHoverTimers();
    setOutlineFloatOpen(false);
    setOutlineMode((m) => (m === "docked" ? "rail" : "docked"));
  };
  // 悬浮面板：移入保持，移出后收起
  const onPanelEnter = (): void => clearHoverTimers();
  const onPanelLeave = (): void => {
    clearHoverTimers();
    hoverTimersRef.current.leave = window.setTimeout(() => setOutlineFloatOpen(false), 300);
  };
  const onPinToggle = (): void => {
    clearHoverTimers();
    setOutlineFloatOpen(false);
    setOutlineMode((m) => {
      if (m === "docked") {
        armHoverCooldown();
        return "rail";
      }
      return "docked";
    });
  };
  const onPanelHide = (): void => {
    clearHoverTimers();
    setOutlineFloatOpen(false);
    armHoverCooldown();
    setOutlineMode("rail");
  };
  useEffect(() => {
    const host = hostRef.current;
    let mount = editorMountRef.current;
    if (!host || !mount) return;
    // StrictMode 双次挂载/快速 HMR 时 mount 可能已被移出文档，重新挂回
    if (!mount.isConnected) {
      host.appendChild(mount);
    }

    const copyHandler = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!event.clipboardData || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!host.contains(range.commonAncestorContainer)) return;
      const plainText = selection.toString();
      const html = normalizeClipboardHtml(range.cloneContents(), document);
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", plainText);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const pasteHandler = (event: ClipboardEvent) => {
      const dt = event.clipboardData;
      if (!dt) return;
      const html = dt.getData("text/html");
      if (!html) return;
      const upgraded = upgradePastedHtml(html);
      if (upgraded !== html) dt.setData("text/html", upgraded);
    };
    host.addEventListener("copy", copyHandler, true);
    host.addEventListener("paste", pasteHandler, true);

    let editor: LakeEditorInstance | null = null;
    // 与 LakeEditor 保持一致：setDocument 初始化期间也会触发 contentchange，
    // 若此时回调里同步 getDocument() 会把整篇大文档（含图片/OCR JSON）序列化一遍，
    // 在主线程上额外叠加耗时；用 setting 标志屏蔽初始化阶段的重复序列化。
    let setting = true;
    if (typeof performance !== "undefined") performance.mark("lake:tab-init:start");
    try {
      editor = createLakeDocument(
        mount,
        "editor",
        () => {
          if (editor && !setting) onChangeRef.current(editor.getDocument("text/lake"));
        },
        tocEnabled,
        noteId,
        host,
        { ...prefs, disableNativeToc: true }
      );
      editor.setDocument("text/lake", content);
      setting = false;
      editorRef.current = editor;
      setEditorState(editor);
      onEditorReadyRef.current?.(noteId, editor);
    } catch (reason) {
      console.error("Failed to create editor for tab", noteId, reason);
    } finally {
      if (typeof performance !== "undefined" && performance.getEntriesByName("lake:tab-init:start").length) {
        performance.mark("lake:tab-init:end");
        try { performance.measure("lake:tab-init:create+setDocument", "lake:tab-init:start", "lake:tab-init:end"); } catch { /* 忽略 */ }
      }
    }

    return () => {
      host.removeEventListener("copy", copyHandler, true);
      host.removeEventListener("paste", pasteHandler, true);
      onEditorReadyRef.current?.(noteId, null);
      destroyLakeEditor(editor);
      editorRef.current = null;
      setEditorState(null);
      // 只清空编辑器挂载点内部；不要 host.replaceChildren()——
      // React.StrictMode 在 dev 会双次挂载 effect，第二次复用同一 mount 节点，
      // 若把 .lake-editor-main 移出 DOM，会在脱离文档的节点上重建 Lake 编辑器
      // （to-dom-range 断言：节点未连接）。
      mount.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, tocEnabled, prefs?.fontSize, prefs?.showToolbar]);

  const handleOutlineNavigate = (id: string): void => {
    const editor = editorRef.current;
    const host = hostRef.current;
    if (!editor || !host) return;
    // 折叠标题先展开（接管原生 tocPositionChange → headingUnfold 链路）
    try {
      (editor as any)?.renderer?.execCommand?.("headingUnfold", id);
    } catch { /* 忽略 */ }
    try {
      (editor as any)?.renderer?.scrollByNodeId?.(id);
    } catch { /* 忽略 */ }
    // 懒卡片占位高度导致的偏差在渲染/水合稳定后校正两次
    const scroller = resolveScrollNode(host);
    const correct = (): void => {
      const el = host.querySelector(`[id="${escapeId(id)}"]`) as HTMLElement | null;
      if (!el || !scroller) return;
      const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      if (Math.abs(delta) > 2) scroller.scrollTop += delta;
    };
    window.setTimeout(correct, 50);
    window.setTimeout(correct, 200);
  };

  return (
    <div
      ref={hostRef}
      className="lake-editor lake-editor-tab"
      style={{ display: visible ? "flex" : "none", width: "100%" }}
      data-note-id={noteId}
    >
      <div ref={editorMountRef} className="lake-editor-main" />
      {outlineMode === "docked" && (
        <OutlinePanel
          controller={controller}
          pinned
          belowToolbar={belowToolbar}
          onNavigate={handleOutlineNavigate}
          onPin={onPinToggle}
          onHide={onPanelHide}
        />
      )}
      {outlineMode === "rail" && outlineFloatOpen && (
        <OutlinePanel
          controller={controller}
          pinned={false}
          belowToolbar={belowToolbar}
          onNavigate={handleOutlineNavigate}
          onPin={onPinToggle}
          onHide={onPanelHide}
          onMouseEnter={onPanelEnter}
          onMouseLeave={onPanelLeave}
        />
      )}
      {outlineMode === "rail" && !outlineFloatOpen && (
        <OutlineRail
          active={false}
          belowToolbar={belowToolbar}
          onMouseEnter={onRailEnter}
          onMouseLeave={onRailLeave}
          onClick={onRailClick}
        />
      )}
    </div>
  );
}
