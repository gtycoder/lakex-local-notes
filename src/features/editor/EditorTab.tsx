import { useEffect, useRef, useState } from "react";
import { shouldAcceptEditorChange } from "../../core/editorChangeGuard";
import { createPortal } from "react-dom";
import { ChevronRight, Package } from "lucide-react";
import {
  createLakeDocument,
  destroyLakeEditor,
  lakeBridge,
  resolveScrollNode,
  type LakeEditorInstance,
  type LakeEditorPrefs,
} from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import { registerOutlineTab, unregisterOutlineTab } from "../outline/registry";
import { useOutline } from "../outline/useOutline";
import { native } from "../../lib/native";
import { attachImagePreviewClick } from "./imagePreview";
import { ImageLightbox } from "./ImageLightbox";
import { attachFileCardClick, buildAttachmentPreviewItem, openAttachmentPreview, createCardHoverResidueCleaner } from "../attachment/attachmentPreviewController";
import { installMediaCardCategoryRouter } from "./mediaCardRouting";
import { isMediaFilename } from "../../core/assetNaming.js";
import { AttachmentPreview } from "../attachment/AttachmentPreview";

export interface EditorTabProps {
  noteId: string;
  content: string;
  visible: boolean;
  tocEnabled: boolean;
  outlineEnhance: boolean;
  onChange: (content: string) => void;
  prefs?: LakeEditorPrefs;
  /** 只读锁：true 时重建为 Lake 原生 Viewer（真只读，含画板/表格/代码块） */
  locked?: boolean;
  /** 编辑器实例就绪回调（导出 md 等需要访问 editor 实例的场景） */
  onEditorReady?: (noteId: string, editor: LakeEditorInstance | null) => void;
  /** 编辑器右键资料操作（M1.3） */
  onEditorCopyMarkdown?: (noteId: string) => void;
  onEditorExport?: (noteId: string, format: "markdown" | "html" | "lake") => void;
  onEditorCopyPaths?: (noteId: string) => void;
}

function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}

/** 跨 remount（外部刷新/冲突重载）保留滚动位置；仅内存态，关闭应用后不保留。 */
const scrollMemory = new Map<string, number>();

/** Info 项：tab 关闭时清理滚动记忆条目，防长会话缓慢累积（remount 不受影响）。 */
export function clearScrollMemory(noteId: string): void {
  scrollMemory.delete(noteId);
}

/** Locate body hits for global search without changing Lake's editor API.
 * 高亮全部命中块（上限 200）、长词优先、滚动到第一个命中。 */
export function locateEditorSearchHit(noteId: string, query: string): boolean {
  const host = document.querySelector<HTMLElement>(`.lake-editor-tab[data-note-id="${escapeId(noteId)}"]`);
  if (!host || !query.trim()) return false;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  if (terms.length === 0) return false;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const blocks: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const MAX_BLOCKS = 200;
  let node: Text | null = null;
  while ((node = walker.nextNode() as Text | null)) {
    const value = node.nodeValue ?? "";
    if (!value) continue;
    const lower = value.toLocaleLowerCase();
    if (!terms.some((term) => lower.includes(term))) continue;
    const block = node.parentElement?.closest<HTMLElement>("[data-node-id], .ne-p, .ne-h, .ne-block, p, h1, h2, h3, h4, h5, h6") ?? node.parentElement;
    if (!block || seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
    block.classList.add("lake-search-hit-target");
    if (blocks.length >= MAX_BLOCKS) break;
  }
  if (blocks.length === 0) return false;
  blocks[0].scrollIntoView({ block: "center", behavior: "smooth" });
  window.setTimeout(() => { for (const block of blocks) block.classList.remove("lake-search-hit-target"); }, 1800);
  return true;
}

export function EditorTab({ noteId, content, visible, tocEnabled, outlineEnhance, onChange, prefs, locked, onEditorReady, onEditorCopyMarkdown, onEditorExport, onEditorCopyPaths }: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorMountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  // Lake 重建/画板交互可能异步把真实滚动容器拉回顶部；持续记录最后稳定位置。
  const lastScrollTopRef = useRef(0);
  // 真实滚动容器在画板更新时可能瞬间跳到 0；低位滚动不会立即覆盖稳定锚点，
  // 给 contentchange / 键盘删除留出恢复异常跳顶的窗口。
  const stableScrollTopRef = useRef(0);
  const boardInteractionScrollRef = useRef(0);
  const boardInteractionUntilRef = useRef(0);
  const latestDocumentRef = useRef(content);
  const documentOwnerRef = useRef(noteId);
  const visibleRef = useRef(visible);
  const requestCodeblockHealRef = useRef<() => void>(() => undefined);
  const healModeRef = useRef(`${noteId}:${locked ? "locked" : "editor"}`);
  const healStateRef = useRef({
    timer: undefined as number | undefined,
    lastBroken: -1,
    stuck: 0,
    pending: false,
    stopped: false,
  });
  const [editorState, setEditorState] = useState<LakeEditorInstance | null>(null);
  const [rebuildTick, setRebuildTick] = useState(0);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  const onEditorReadyRef = useRef(onEditorReady);
  onChangeRef.current = onChange;
  onEditorReadyRef.current = onEditorReady;
  visibleRef.current = visible;

  const { controller, refresh } = useOutline(editorState, hostRef.current, noteId, tocEnabled, visible);

  const handleOutlineNavigate = (id: string): void => {
    const editor = editorRef.current;
    const host = hostRef.current;
    if (!editor || !host) return;
    // 折叠标题先展开（接管原生 tocPositionChange → headingUnfold 链路）
    try {
      lakeBridge(editor).renderer?.execCommand?.("headingUnfold", id);
    } catch { /* 忽略 */ }
    try {
      lakeBridge(editor).renderer?.scrollByNodeId?.(id);
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

  // 向全局注册表暴露本标签的大纲句柄（右侧栏读取 active tab 的句柄）
  useEffect(() => {
    registerOutlineTab(noteId, { controller, navigate: handleOutlineNavigate, refresh });
    return () => unregisterOutlineTab(noteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, controller, refresh]);

  useEffect(() => {
    const host = hostRef.current;
    let mount = editorMountRef.current;
    if (!host || !mount) return;

    if (documentOwnerRef.current !== noteId) {
      documentOwnerRef.current = noteId;
      latestDocumentRef.current = content;
    }
    const healMode = `${noteId}:${locked ? "locked" : "editor"}`;
    if (healModeRef.current !== healMode) {
      healModeRef.current = healMode;
      healStateRef.current = {
        timer: undefined,
        lastBroken: -1,
        stuck: 0,
        pending: false,
        stopped: false,
      };
    }
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
    // 画板卡片交互（选择、删除、工具栏）偶发把 Lake 滚动容器重置到顶部。
    // 先记录交互前位置，若后续渲染发生大幅回跳则恢复；仅作用于画板卡片。
    let boardRestoreTimer: number | undefined;
    let boardRestoreFollowupTimer: number | undefined;
    const scrollRestoreTimers = new Set<number>();
    let stableScrollCommitTimer: number | undefined;
    let boardScroller: HTMLElement | null = null;
    let removeBoardScroller: (() => void) | undefined;
    let boardScrollerBindFrame: number | undefined;
    let queueBoardScrollerBind: () => void = () => undefined;
    const boardSelector =
      'ne-card[data-card-name="board"], ne-card[data-card-name="custom-board-card"], ne-card[data-card-name="customBlock"], .plait-board-container';
    const isBoardInteractionTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest(boardSelector)) return true;
      // Drawnix 的工具栏在部分版本会被 portal 到卡片外层，不能只依赖
      // closest(.plait-board-container)，但只有当前文档里确实存在画板时才接管。
      return !!host.querySelector(".plait-board-container") && !!target.closest(".island, .tool-icon");
    };
    const armBoardScrollRestore = (before: number): void => {
      if (before < 100) return;
      boardInteractionScrollRef.current = before;
      boardInteractionUntilRef.current = Date.now() + 1500;
    };
    // 只在一次真实 contentchange 后安排恢复，而不是 pointerdown 时就连续写入
    // scrollTop。画板自己的新增/删除操作会触发多轮 viewport/layout 重绘，过早或
    // 重复写滚动位置会让 Drawnix 画面短暂清空再重绘，表现为闪烁。
    const getBoardDocumentScroller = (): HTMLElement | null => {
      // Resolve directly from the tab host. During a card update Lake can
      // briefly expose more than one editor wrapper, and the generic resolver
      // may otherwise fall back to the host while the replacement is mounting.
      return host.querySelector<HTMLElement>(".ne-editor-wrap, .ne-viewer")
        ?? resolveScrollNode(host);
    };
    const restoreBoardScrollImmediately = (before: number): void => {
      if (before < 100) return;
      const restore = (): void => {
        const scroller = getBoardDocumentScroller();
        if (!scroller?.isConnected || Math.abs(scroller.scrollTop - before) <= 1) return;
        scroller.scrollTop = before;
        lastScrollTopRef.current = before;
        stableScrollTopRef.current = before;
      };
      // Lake may reset the scroll node during the same event turn or while
      // React commits the card update. Restore before the next paint and once
      // more on the following frame so selection/delete never visibly flashes
      // the document back to its top.
      restore();
      let frames = 0;
      const restoreAcrossFrames = (): void => {
        restore();
        frames += 1;
        if (frames < 8) window.requestAnimationFrame(restoreAcrossFrames);
      };
      window.requestAnimationFrame(restoreAcrossFrames);
    };

    const scheduleBoardScrollRestore = (before: number): void => {
      if (before < 100) return;
      window.clearTimeout(boardRestoreTimer);
      window.clearTimeout(boardRestoreFollowupTimer);
      const restore = (): void => {
        const target = boardInteractionScrollRef.current || before;
        // Lake 在卡片变更后可能重建 .ne-editor-wrap；不能闭包捕获旧节点，
        // 每次恢复都重新解析真实滚动容器。
        const scroller = getBoardDocumentScroller();
        if (!scroller?.isConnected || target < 100 || Date.now() > boardInteractionUntilRef.current) return;
        // 仅恢复明确的跳顶；如果画板/用户已经处于其它位置，不抢回滚动。
        if (scroller.scrollTop < 50 && Math.abs(scroller.scrollTop - target) > 1) {
          scroller.scrollTop = target;
          lastScrollTopRef.current = target;
          stableScrollTopRef.current = target;
        }
      };
      boardRestoreTimer = window.setTimeout(() => {
        boardRestoreTimer = undefined;
        restore();
      }, 120);
      boardRestoreFollowupTimer = window.setTimeout(() => {
        boardRestoreFollowupTimer = undefined;
        restore();
      }, 500);
    };
    const boardScrollGuard = (event: PointerEvent): void => {
      const scroller = resolveScrollNode(host);
      const current = scroller?.scrollTop ?? 0;
      const before = current >= 100 ? current : stableScrollTopRef.current || lastScrollTopRef.current;
      if (!isBoardInteractionTarget(event.target)) return;
      armBoardScrollRestore(before);
    };
    const boardKeyboardGuard = (event: KeyboardEvent): void => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!isBoardInteractionTarget(event.target)) return;
      const scroller = resolveScrollNode(host);
      const current = scroller?.scrollTop ?? 0;
      const before = current >= 100 ? current : stableScrollTopRef.current || lastScrollTopRef.current;
      armBoardScrollRestore(before);
    };
    const boardFocusGuard = (event: FocusEvent): void => {
      if (!isBoardInteractionTarget(event.target)) return;
      const scroller = resolveScrollNode(host);
      const current = scroller?.scrollTop ?? 0;
      const before = current >= 100 ? current : stableScrollTopRef.current || lastScrollTopRef.current;
      if (before >= 100) {
        boardInteractionScrollRef.current = before;
        boardInteractionUntilRef.current = Date.now() + 1500;
      }
    };
    // 工具栏可能通过 portal 离开 host；补一层 document 捕获监听，只认 Drawnix
    // 工具节点且要求当前标签内存在画板，避免影响其它标签/普通编辑操作。
    const documentBoardPointerGuard = (event: PointerEvent): void => {
      if (!visibleRef.current || !host.isConnected || host.style.display === "none") return;
      if (!(event.target instanceof Element) || host.contains(event.target)) return;
      if (!host.querySelector(".plait-board-container")) return;
      if (!event.target.closest(".island, .tool-icon")) return;
      const scroller = resolveScrollNode(host);
      armBoardScrollRestore(Math.max(scroller?.scrollTop ?? 0, stableScrollTopRef.current, lastScrollTopRef.current));
    };
    const documentBoardKeyGuard = (event: KeyboardEvent): void => {
      if (!visibleRef.current || !host.isConnected || host.style.display === "none") return;
      if (event.target instanceof Node && host.contains(event.target)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!host.querySelector(".plait-board-container")) return;
      const scroller = resolveScrollNode(host);
      armBoardScrollRestore(Math.max(scroller?.scrollTop ?? 0, stableScrollTopRef.current, lastScrollTopRef.current));
    };
    const boardContentChangeGuard = (event: Event): void => {
      const reported = Number((event as CustomEvent<{ scrollTop?: number }>).detail?.scrollTop);
      const before = Math.max(
        Number.isFinite(reported) ? reported : 0,
        stableScrollTopRef.current,
        lastScrollTopRef.current,
      );
      // onChange 可能在 Lake 已经把滚动容器拉到 0 后才回调；此时使用尚未提交
      // 的稳定锚点，仍能覆盖异步新增元素路径。用户本来就在顶部时 before=0，
      // 不会强行滚回旧位置。
      if (before < 100) return;
      armBoardScrollRestore(before);
      restoreBoardScrollImmediately(before);
      scheduleBoardScrollRestore(before);
    };
    host.addEventListener("pointerdown", boardScrollGuard, true);
    host.addEventListener("keydown", boardKeyboardGuard, true);
    host.addEventListener("focusin", boardFocusGuard, true);
    host.addEventListener("lake-board-contentchange", boardContentChangeGuard);
    document.addEventListener("pointerdown", documentBoardPointerGuard, true);
    document.addEventListener("keydown", documentBoardKeyGuard, true);
    host.addEventListener("copy", copyHandler, true);
    host.addEventListener("paste", pasteHandler, true);

    // 锁切换会重建实例：如果真实滚动节点仍在，当前节点的值优先；只有节点已被
    // 清理/尚未创建时才使用持续记录值，避免用户主动回到顶部后又恢复到旧位置。
    const currentScroller = resolveScrollNode(host);
    const hasRealScroller = currentScroller !== host && currentScroller.isConnected;
    const prevScroll = hasRealScroller ? currentScroller.scrollTop : lastScrollTopRef.current;
    const mode: "editor" | "viewer" = locked ? "viewer" : "editor";
    let editor: LakeEditorInstance | null = null;
    let detachMediaCardRouter: (() => void) | undefined;
    // 与 LakeEditor 保持一致：setDocument 初始化期间也会触发 contentchange，
    // 若此时回调里同步 getDocument() 会把整篇大文档（含图片/OCR JSON）序列化一遍，
    // 在主线程上额外叠加耗时；用 setting 标志屏蔽初始化阶段的重复序列化。
    let setting = true;
    if (typeof performance !== "undefined") performance.mark("lake:tab-init:start");
    try {
      editor = createLakeDocument(
        mount,
        mode,
        () => {
          if (editor) {
            const next = stripAssetAccessToken(editor.getDocument("text/lake"));
            if (!shouldAcceptEditorChange({ initializing: setting, previous: latestDocumentRef.current, next })) return;
            latestDocumentRef.current = next;
            onChangeRef.current(next);
            // 画板元素通过键盘 Delete/Backspace 删除，可能没有新的 pointerdown；
            // 用最近一次画板交互锚点兜底恢复异常跳顶。普通文本输入不会进入该分支。
            if (Date.now() < boardInteractionUntilRef.current) {
              const anchor = boardInteractionScrollRef.current || stableScrollTopRef.current;
              const scroller = resolveScrollNode(host);
              if (anchor >= 100 && scroller) {
                restoreBoardScrollImmediately(anchor);
                scheduleBoardScrollRestore(anchor);
              }
            }
          }
        },
        tocEnabled,
        noteId,
        host,
        { ...prefs, disableNativeToc: outlineEnhance }
      );
      // 自愈重建时优先使用当前实例最后一次回调拿到的文档，避免 React prop
      // 尚未回流时把刚输入的内容覆盖掉；切换 noteId 时该 ref 已在上面重置。
      editor.setDocument("text/lake", addAssetAccessToken(latestDocumentRef.current));
      // Viewer 的卡片水合订阅在 setDocument 前就已建立；这里再主动请求一次，
      // 确保锁定态首次加载的画板不会只在空文档布局阶段执行水合。
      editor.requestCardHydration?.();
      setting = false;
      // 虚拟渲染/卡片水合会异步改变布局，同步设置 scrollTop 会被后续渲染冲掉。
      // 在多个稳定窗口恢复，锁定 Viewer 与编辑态之间都保持阅读位置。
      const restoreScroll = (timer: number): void => {
        scrollRestoreTimers.delete(timer);
        const scroller = resolveScrollNode(host);
        if (!scroller || prevScroll <= 0) return;
        if (Math.abs(scroller.scrollTop - prevScroll) <= 1) return;
        scroller.scrollTop = prevScroll;
        lastScrollTopRef.current = prevScroll;
        stableScrollTopRef.current = prevScroll;
      };
      for (const delay of [0, 80, 300, 800]) {
        let timer = 0;
        timer = window.setTimeout(() => restoreScroll(timer), delay);
        scrollRestoreTimers.add(timer);
      }
      const bindBoardScroller = (): void => {
        const nextScroller = resolveScrollNode(host);
        if (!nextScroller || nextScroller === boardScroller) return;
        removeBoardScroller?.();
        boardScroller = nextScroller;
        let previous = nextScroller.scrollTop;
        const trackScroll = (): void => {
          const current = nextScroller.scrollTop;
          const jumpedToTop = previous >= 100 && current < 50;
          previous = current;
          lastScrollTopRef.current = current;
          scrollMemory.set(noteId, current);
          if (current >= 50) {
            stableScrollTopRef.current = current;
            window.clearTimeout(stableScrollCommitTimer);
            stableScrollCommitTimer = undefined;
          } else if (jumpedToTop && Date.now() < boardInteractionUntilRef.current) {
            const anchor = boardInteractionScrollRef.current || stableScrollTopRef.current;
            if (anchor >= 100) {
              // The scroll event is emitted in the same turn as Lake's jump to
              // the top. Restore synchronously here, before the browser paints
              // the transient top position; delayed timers remain as a fallback
              // for a later replacement of the scroll node.
              nextScroller.scrollTop = anchor;
              lastScrollTopRef.current = anchor;
              stableScrollTopRef.current = anchor;
              scheduleBoardScrollRestore(anchor);
            }
          } else {
            // 不要在瞬时跳顶的同一帧把稳定锚点改成 0；如果用户确实停在顶部，
            // 延迟提交即可让后续锁切换仍尊重用户的真实位置。
            window.clearTimeout(stableScrollCommitTimer);
            stableScrollCommitTimer = window.setTimeout(() => {
              stableScrollCommitTimer = undefined;
              if (nextScroller.isConnected && nextScroller.scrollTop < 50) {
                stableScrollTopRef.current = nextScroller.scrollTop;
              }
            }, 250);
          }
        };
        nextScroller.addEventListener("scroll", trackScroll, { passive: true });
        removeBoardScroller = () => {
          nextScroller.removeEventListener("scroll", trackScroll);
          removeBoardScroller = undefined;
        };
        // Lake 更新卡片时可能替换整个滚动容器；新节点初始 scrollTop=0 时，
        // 不能等 contentchange（Drawnix 新增元素未必触发它），直接按交互锚点恢复。
        const anchor = boardInteractionScrollRef.current || stableScrollTopRef.current;
        if (nextScroller.scrollTop < 50 && anchor >= 100 && Date.now() < boardInteractionUntilRef.current) {
          scheduleBoardScrollRestore(anchor);
        }
      };
      queueBoardScrollerBind = (): void => {
        if (boardScrollerBindFrame !== undefined) return;
        const bind = () => {
          boardScrollerBindFrame = undefined;
          bindBoardScroller();
        };
        if (typeof window.requestAnimationFrame === "function") {
          boardScrollerBindFrame = window.requestAnimationFrame(bind);
        } else {
          bind();
        }
      };
      bindBoardScroller();
      editorRef.current = editor;
      setEditorState(editor);
      (window as unknown as Record<string, unknown>).__desktopEditor = editor;
      // 附件路径自动分发：附件插入的音频/视频文件 → 原生音视频卡（编辑器内嵌播放）
      detachMediaCardRouter = installMediaCardCategoryRouter(editor);
      onEditorReadyRef.current?.(noteId, editor);
    } catch (reason) {
      console.error("Failed to create editor for tab", noteId, reason);
    } finally {
      if (typeof performance !== "undefined" && performance.getEntriesByName("lake:tab-init:start").length) {
        performance.mark("lake:tab-init:end");
        try {
          performance.measure("lake:tab-init:create+setDocument", "lake:tab-init:start", "lake:tab-init:end");
          const entries = performance.getEntriesByName("lake:tab-init:create+setDocument");
          const dur = entries.length ? Math.round(entries[entries.length - 1].duration) : 0;
          // 渲染进程日志经主进程 console-message 转发落盘；tab 重建（同步刷新/冲突重载/恢复历史）的耗时参考指标。
          console.log(`[editor-perf] init ${noteId} ${dur}ms mode=${mode}${locked ? " (locked)" : ""}`);
        } catch { /* 忽略 */ }
      }
    }

    // 代码块收敛式兜底：优先依赖轻量 $appear 水合；只有在可见编辑态仍
    // 存在没有 CodeMirror 的代码块时，才走一次“重开文档”的最终水合路径。
    // 这是对新建 Slash 代码块异常的兜底，不再像旧方案那样发现任意代码块就重建。
    const heal = healStateRef.current;
    heal.pending = false;
    let healDeferredUntilBlur = false;
    const hasEditorInteraction = (): boolean => {
      const active = document.activeElement;
      if (active && host.contains(active)) return true;
      const selection = document.getSelection();
      return !!selection && selection.rangeCount > 0 && (host.contains(selection.anchorNode) || host.contains(selection.focusNode));
    };
    const countBrokenCodeblocks = (): number => {
      if (locked || !visibleRef.current) return 0;
      return [...host.querySelectorAll(".ne-codeblock")].filter((el) => {
        if (!el.isConnected || el.querySelector(".CodeMirror, .cm-editor")) return false;
        const rect = el.getBoundingClientRect();
        // 忽略虚拟渲染中尚未进入视口、尚未布局的占位节点；真正的新建空代码块
        // 通常已有可见几何，即使高度塌缩也会留下非零的细条。
        return rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0;
      }).length;
    };
    const runHealCheck = (): void => {
      heal.timer = undefined;
      if (locked || !visibleRef.current || !editorRef.current || heal.stopped || heal.pending) return;
      if (hasEditorInteraction()) {
        // 重建会销毁当前 Lake 实例并丢失刚建立的焦点/选区。
        // 新建代码块时先让用户完成标题/正文输入，失焦后再做一次水合兜底。
        healDeferredUntilBlur = true;
        return;
      }
      const broken = countBrokenCodeblocks();
      if (broken === 0) {
        heal.lastBroken = -1;
        heal.stuck = 0;
        heal.stopped = false;
        return;
      }
      if (heal.lastBroken < 0 || broken < heal.lastBroken) {
        heal.lastBroken = broken;
        heal.stuck = 0;
      } else {
        heal.stuck += 1;
        if (heal.stuck >= 2) {
          // 连续两轮重建没有减少 broken 数量，说明不是初始化时机问题，
          // 停止兜底，避免编辑器进入重建死循环。
          heal.stopped = true;
          return;
        }
      }
      heal.pending = true;
      setRebuildTick((tick) => tick + 1);
    };
    const scheduleHealCheck = (delay = 600): void => {
      if (locked) return;
      window.clearTimeout(heal.timer);
      heal.timer = window.setTimeout(runHealCheck, delay);
    };
    requestCodeblockHealRef.current = scheduleHealCheck;
    const onEditorFocusOut = (): void => {
      if (!healDeferredUntilBlur || hasEditorInteraction()) return;
      healDeferredUntilBlur = false;
      scheduleHealCheck(80);
    };
    const healObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      queueBoardScrollerBind();
      if (visibleRef.current && !locked) scheduleHealCheck();
    });
    host.addEventListener("focusout", onEditorFocusOut, true);
    healObserver?.observe(host, { childList: true, subtree: true });
    scheduleHealCheck(900);
    // 点击任意位置清理 Lake 卡片 hover 残留（mouseleave 被系统应用/遮罩吞掉 → 背景一直着色）
    const detachHoverCleaner = createCardHoverResidueCleaner(host);

    // 图片点击放大预览（桌面编辑/锁定态共用）：宿主级点击监听 + 共享 Lightbox
    const detachImagePreview = attachImagePreviewClick(host);
    // 附件：file 卡片点击 → 媒体内嵌播放 overlay；非媒体直接系统应用打开（少预览弹窗，对齐移动端）
    const detachFileCard = attachFileCardClick(host, (src, name, size) => {
      const item = buildAttachmentPreviewItem(src, name, size);
      const openSystem = (it: typeof item): void => {
        if (it.ref) void native.openAttachment(it.ref.noteId, it.ref.filename).then((r) => { if (!r.ok) console.warn("[attach] 打开失败:", r.error); });
      };
      // 媒体判定用 item.kind（buildAttachmentPreviewItem 已按 name||src 判定，canonical src 带扩展名），
      // 避免卡片名缺扩展名/异常时误判为非媒体而落到系统打开（webview 弹窗）。
      if (item.kind === "audio" || item.kind === "video" || isMediaFilename(name)) {
        // 媒体附件：应用内嵌播放（audio/video 元素，不跳系统浏览器）
        openAttachmentPreview(item, openSystem, (it) => { if (it.ref) void native.showAttachmentInFolder(it.ref.noteId, it.ref.filename); });
        return;
      }
      // 非媒体附件：直接系统应用打开
      openSystem(item);
    });

    return () => {
      detachHoverCleaner();
      detachImagePreview();
      detachFileCard();
      window.clearTimeout(boardRestoreTimer);
      window.clearTimeout(boardRestoreFollowupTimer);
      boardRestoreTimer = undefined;
      boardRestoreFollowupTimer = undefined;
      for (const timer of scrollRestoreTimers) window.clearTimeout(timer);
      scrollRestoreTimers.clear();
      if (boardScrollerBindFrame !== undefined) window.cancelAnimationFrame(boardScrollerBindFrame);
      boardScrollerBindFrame = undefined;
      removeBoardScroller?.();
      boardScroller = null;
      host.removeEventListener("pointerdown", boardScrollGuard, true);
      host.removeEventListener("keydown", boardKeyboardGuard, true);
      host.removeEventListener("focusin", boardFocusGuard, true);
      host.removeEventListener("lake-board-contentchange", boardContentChangeGuard);
      document.removeEventListener("pointerdown", documentBoardPointerGuard, true);
      document.removeEventListener("keydown", documentBoardKeyGuard, true);
      window.clearTimeout(stableScrollCommitTimer);
      stableScrollCommitTimer = undefined;
      if (requestCodeblockHealRef.current === scheduleHealCheck) {
        requestCodeblockHealRef.current = () => undefined;
      }
      healObserver?.disconnect();
      host.removeEventListener("focusout", onEditorFocusOut, true);
      healDeferredUntilBlur = false;
      window.clearTimeout(heal.timer);
      heal.timer = undefined;
      host.removeEventListener("copy", copyHandler, true);
      host.removeEventListener("paste", pasteHandler, true);
      onEditorReadyRef.current?.(noteId, null);
      detachMediaCardRouter?.();
      destroyLakeEditor(editor);
      editorRef.current = null;
      setEditorState(null);
      // 清理调试挂载句柄，避免残留指向已销毁实例
      if ((window as unknown as Record<string, unknown>).__desktopEditor === editor) {
        (window as unknown as Record<string, unknown>).__desktopEditor = null;
      }
      // 只清空编辑器挂载点内部；不要 host.replaceChildren()——
      // React.StrictMode 在 dev 会双次挂载 effect，第二次复用同一 mount 节点，
      // 若把 .lake-editor-main 移出 DOM，会在脱离文档的节点上重建 Lake 编辑器
      // （to-dom-range 断言：节点未连接）。
      mount.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, tocEnabled, prefs?.fontSize, prefs?.showToolbar, locked, rebuildTick]);

  // 切换到可见标签不应重建整个编辑器，但必须重新触发布局相关水合；
  // 隐藏标签初始化时高度为 0，代码块等卡片会因此错过 $appear。
  useEffect(() => {
    if (!visible) return;
    editorRef.current?.requestCardHydration?.();
    requestCodeblockHealRef.current();
  }, [visible]);

  // 外部刷新/冲突重载会 remount EditorTab，恢复上次滚动位置，避免跳到顶部。
  useEffect(() => {
    if (!editorState) return;
    const saved = scrollMemory.get(noteId);
    if (!saved || saved <= 0) return;
    const timer = window.setTimeout(() => {
      const scroller = resolveScrollNode(hostRef.current);
      if (scroller && scroller.isConnected) {
        scroller.scrollTop = saved;
        lastScrollTopRef.current = saved;
        stableScrollTopRef.current = saved;
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [editorState, noteId]);

  return (
    <div
      ref={hostRef}
      className={`lake-editor lake-editor-tab${locked ? " lake-locked" : ""}`}
      style={{ display: visible ? "flex" : "none", width: "100%" }}
      data-note-id={noteId}
      onContextMenu={(event) => {
        // M1.3：编辑器右键 → 自定义资料操作菜单（覆盖 Lake 默认右键，复制/粘贴用快捷键）
        event.preventDefault();
        setExportOpen(false);
        setCtxMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div ref={editorMountRef} className="lake-editor-main" />
      <ImageLightbox />
      <AttachmentPreview />
      {ctxMenu && (
        <EditorContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          exportOpen={exportOpen}
          onExportOpen={setExportOpen}
          onCopyMarkdown={() => onEditorCopyMarkdown?.(noteId)}
          onExport={(format) => onEditorExport?.(noteId, format)}
          onCopyPaths={() => onEditorCopyPaths?.(noteId)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

interface EditorContextMenuProps {
  x: number;
  y: number;
  exportOpen: boolean;
  onExportOpen: (open: boolean) => void;
  onCopyMarkdown: () => void;
  onExport: (format: "markdown" | "html" | "lake") => void;
  onCopyPaths: () => void;
  onClose: () => void;
}

const EditorContextMenu = ({ x, y, exportOpen, onExportOpen, onCopyMarkdown, onExport, onCopyPaths, onClose }: EditorContextMenuProps) => {
  const left = Math.min(x, window.innerWidth - 232);
  const top = Math.min(y, window.innerHeight - 240);
  const submenuLeft = left + 232 + 230 <= window.innerWidth;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  return createPortal(
    <div ref={menuRef} className="context-menu" style={{ left, top }} role="menu" data-context-menu>
      <div className="context-menu-item has-submenu" onMouseEnter={() => onExportOpen(true)} onMouseLeave={() => onExportOpen(false)}>
        <span className="context-menu-item-label"><Package size={15} /><span>导出</span></span><ChevronRight size={14} />
        {exportOpen && (
          <div className={`context-menu-submenu${submenuLeft ? "" : " open-left"}`} role="menu">
            <button role="menuitem" onClick={() => { onExport("markdown"); onClose(); }}>导出为 Markdown 资料包</button>
            <button role="menuitem" onClick={() => { onCopyMarkdown(); onClose(); }}>导出为 Markdown 文本（复制）</button>
            <button role="menuitem" onClick={() => { onExport("html"); onClose(); }}>导出为 HTML</button>
            <button role="menuitem" disabled title="开发中">导出为 Word（开发中）</button>
            <button role="menuitem" disabled title="开发中">导出为 PDF（开发中）</button>
            <div className="context-menu-sep" />
            <button role="menuitem" onClick={() => { onExport("lake"); onClose(); }}>导出为原生 Lake（图片内嵌）</button>
            <button role="menuitem" onClick={() => { onCopyPaths(); onClose(); }}>导出资料路径（本机 AI）</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
