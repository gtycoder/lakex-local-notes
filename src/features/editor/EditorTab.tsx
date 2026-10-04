import { useEffect, useRef, useState } from "react";
import { reportNativeActionError } from "../../lib/nativeErrors";
import {
  createLakeDocument,
  destroyLakeEditor,
  lakeBridge,
  refreshTocSidebar,
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
import { attachFileCardClick, createCardHoverResidueCleaner, resolveCardAsset, findCardData, type AttachmentPreviewItem } from "../attachment/attachmentPreviewController";
import { openAssetEntry } from "../attachment/openAssetEntry";
import { CardContextMenu, TextContextMenu, cutCardElement } from "./CardContextMenu";
import { AssetRenameDialog } from "./AssetRenameDialog";
import { installMediaCardCategoryRouter } from "./mediaCardRouting";

export interface EditorTabProps {
  noteId: string;
  content: string;
  visible: boolean;
  tocEnabled: boolean;
  outlineEnhance: boolean;
  /** 只通知「有变更」（捕获契约）：正文不再随每次按键回传，由保存/草稿/关闭按需 capture。 */
  onChange: () => void;
  prefs?: LakeEditorPrefs;
  /** 只读锁：true 时重建为 Lake 原生 Viewer（真只读，含画板/表格/代码块） */
  locked?: boolean;
  /** 编辑器实例就绪回调（导出 md 等需要访问 editor 实例的场景） */
  onEditorReady?: (noteId: string, editor: LakeEditorInstance | null) => void;
  /** 外部改动正文后重载该 tab（附件重命名后主进程改写了正文） */
  onReloadNote?: (noteId: string) => void;
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

/**
 * 锁/解锁「延迟销毁」参数（见 pendingDisposeRef）：
 * 旧实例留在 is-outgoing 层继续显示，等新实例首屏渲染出正文且位置就位即整层移除；
 * READY_TIMEOUT 是等待上限（超时也切换，不能因为一条渲染异常把旧层永久压在上面），
 * DISPOSE_FALLBACK 是兜底回收（无人接手/关标签、新实例创建失败、窗口不可见导致帧循环被
 * 暂停时，定时器仍会到点回收）。
 *
 * 窗口不可见时的实测口径（260916，用于判定「后台跑探针看到旧层滞留」是不是 bug）：
 * 后台窗口 rAF 完全停摆（实测 10.8s 内 0 帧、10ms 定时器被压到 ~1s），所以后台触发的切换会
 * 把旧层留到 DISPOSE_FALLBACK 到点——那是节流，不是逻辑错；回到前台由 settle 帧循环回收
 * （禁掉 1400ms 兜底定时器后仍实测：可见性变化 → 约 7 帧 / 47ms 内旧层被移除）。
 * 前台窗口 rAF ≈ 59Hz（10ms 定时器 1s 跑满 100 次），位置门按帧推进，无需额外兜底。
 */
const OUTGOING_READY_TIMEOUT_MS = 1200;
const OUTGOING_DISPOSE_FALLBACK_MS = 1400;
/** 切换后「钉住锚点」的窗口：内核虚拟渲染/图片水合在这段时间里还会改版式，偏离就立刻纠回 */
const ANCHOR_PIN_WINDOW_MS = 1200;

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

export function EditorTab({ noteId, content, visible, tocEnabled, outlineEnhance, onChange, prefs, locked, onEditorReady, onReloadNote }: EditorTabProps) {
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
  // 大纲状态快照（编辑态 ↔ 锁定态重建实例时延续）：visible=是否显示，normal=展开/收纳。
  // 内核两态 ready 默认都是 open+展开（bundle 179812 / 179757），锁/解锁后必须按快照覆盖，
  // 否则「编辑态收着的迷你条」会变成阅读态展开面板。默认值 = 内核默认（显示且展开）。
  const tocStateRef = useRef({ visible: true, normal: true });
  // 滚动锚点快照（锁/解锁跨态恢复的**主依据**）：编辑态虚拟渲染把内容总高压成 viewer 的
  // 1/3（同标题实测 3016 vs 9209），任何基于 scrollHeight 的比例换算都有数百 px 误差。
  // 改用内核算出的「当前所在节」——TOC 条目 ne-toc-selected[data-id] 是标题节点 id，
  // 跨态稳定；恢复时按 id 精确定位。（scrollSnapshotRef 只作锚点失效时的回退。）
  const scrollAnchorRef = useRef<string | null>(null);
  // 锚点在「外壳（.lake-editor-tab）」里的屏幕偏移：锁/解锁两态的内容盒不同（编辑态顶上有 38px
  // 工具栏带、正文盒高 694；阅读态滚动盒从外壳顶开始、高 744），只按「在新滚动盒里居中」恢复会
  // 平白挪 46px。按屏幕偏移恢复 = 同一段文字停在屏幕同一处（实测锁定方向 453→407 的跳动即此）。
  const scrollAnchorOffsetRef = useRef<number | null>(null);
  const scrollSnapshotRef = useRef<{ top: number; max: number } | null>(null);
  const visibleRef = useRef(visible);
  // 本组件「当前渲染目标」的 noteId：cleanup 据此判断重建是同一文档换模式（锁/解锁、自愈，
  // 旧内容即当前文档，可以留作过渡）还是换文档（旧内容已不是当前文档，必须立刻销毁）。
  const renderedNoteRef = useRef(noteId);
  // 锁/编辑切换的"延迟销毁"句柄：cleanup 不立刻 destroy（那会让旧 DOM 瞬间消失 → 白屏闪烁），
  // 而是把旧 mount 标记为 is-outgoing 留在底层、实例交给这里；新实例首屏就绪后再调用它回收。
  const pendingDisposeRef = useRef<(() => void) | null>(null);
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
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; item: AttachmentPreviewItem; el: HTMLElement } | null>(null);
  const [textMenu, setTextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameItem, setRenameItem] = useState<{ item: AttachmentPreviewItem; el: HTMLElement } | null>(null);
  const onChangeRef = useRef(onChange);
  const onEditorReadyRef = useRef(onEditorReady);
  onChangeRef.current = onChange;
  onEditorReadyRef.current = onEditorReady;
  visibleRef.current = visible;
  renderedNoteRef.current = noteId;

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
      // 换文档：上一文档留下的滚动锚点/快照作废（锁切换同 noteId，会保留）
      scrollAnchorRef.current = null;
      scrollSnapshotRef.current = null;
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
    // 剪切：与 copy 同源序列化写入剪贴板，再删除选区。
    // ⚠️ 删除必须走**内核命令**（`kernel.execCommand("delete")`）让模型同步：早前用
    // `document.execCommand("delete")` 只删 DOM、内核模型不变，点击块时被模型重绘回来
    // （260917 实测：选区文字消失 → 点块恢复），转换后的内容同样受影响。
    // 本 handler 在 capture 阶段 stopImmediatePropagation，会抢在内核 cut 事件处理之前，
    // 所以要自己调用内核命令，不能依赖内核默认 cut 路径（那会把剪贴板改写成内核序列化）。
    const cutHandler = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!event.clipboardData || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!host.contains(range.commonAncestorContainer)) return;
      event.clipboardData.setData("text/html", normalizeClipboardHtml(range.cloneContents(), document));
      event.clipboardData.setData("text/plain", selection.toString());
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        // 删除必须走内核命令（与 style/insertCard 同一入口），内核模型才会同步
        const ed = editorRef.current;
        if (ed?.kernel?.execCommand) ed.kernel.execCommand("delete");
        else if (ed?.execCommand) ed.execCommand("delete");
        else document.execCommand("delete");
      } catch {
        try { document.execCommand("delete"); } catch { /* 忽略 */ }
      }
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
      // 锁/解锁过渡期旧实例层（.is-outgoing）同样会多出一个 wrapper：跳过它。
      for (const el of host.querySelectorAll<HTMLElement>(".ne-editor-wrap, .ne-viewer")) {
        if (!el.closest(".is-outgoing")) return el;
      }
      return resolveScrollNode(host);
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
    // 本标签是否在显示只看 visibleRef（= 宿主上的 data-active）；不要再判 host.style.display——
    // 261005 起隐藏标签不再用 display:none（会把尺寸压成 0，切回来触发内核表格重排）。
    const documentBoardPointerGuard = (event: PointerEvent): void => {
      if (!visibleRef.current || !host.isConnected) return;
      if (!(event.target instanceof Element) || host.contains(event.target)) return;
      if (!host.querySelector(".plait-board-container")) return;
      if (!event.target.closest(".island, .tool-icon")) return;
      const scroller = resolveScrollNode(host);
      armBoardScrollRestore(Math.max(scroller?.scrollTop ?? 0, stableScrollTopRef.current, lastScrollTopRef.current));
    };
    const documentBoardKeyGuard = (event: KeyboardEvent): void => {
      if (!visibleRef.current || !host.isConnected) return;
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
    host.addEventListener("cut", cutHandler, true);
    host.addEventListener("paste", pasteHandler, true);

    // 锁切换会重建实例：如果真实滚动节点仍在，当前节点的值优先；只有节点已被
    // 清理/尚未创建时才使用持续记录值，避免用户主动回到顶部后又恢复到旧位置。
    const currentScroller = resolveScrollNode(host);
    const hasRealScroller = currentScroller !== host && currentScroller.isConnected;
    const prevScroll = hasRealScroller ? currentScroller.scrollTop : lastScrollTopRef.current;
    const mode: "editor" | "viewer" = locked ? "viewer" : "editor";
    let editor: LakeEditorInstance | null = null;
    let detachMediaCardRouter: (() => void) | undefined;
    let tocRefreshTimer = 0;
    let disposeTocRefresh: (() => void) | undefined;
    // 延迟销毁（见 cleanup 与 pendingDisposeRef）：settleFrame = 首屏就绪轮询帧，
    // ownedDisposed = 本轮实例回收的幂等位（兜底定时器与新实例可能都来调一次）。
    let settleFrame = 0;
    let ownedDisposed = false;
    // 切换后「钉住锚点」的状态（见 pinAnchor）：在 try 外声明，cleanup 才能撤掉
    const pin = { frame: 0, written: -1, stopped: false, until: 0 };
    const stopPin = (): void => { pin.stopped = true; };
    // 旧实例在 is-outgoing 过渡期仍是活的、还会触发 contentchange：那是上一轮 effect 的回调，
    // 必须忽略，否则旧实例序列化出的内容会回流成新实例的文档。
    let retired = false;
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
          if (retired) return;
          // 审计 §6.1 捕获契约：初始化阶段忽略；此后每次 contentchange 只通知「有变更」，
          // 不再每次按键整篇 getDocument 序列化（数 MB 文档实测每键数十 ms）。
          // 正文在保存/草稿/关闭时按需 capture；重建（锁/自愈/换文档）前的最后捕获见下方 cleanup。
          if (setting) return;
          onChangeRef.current();
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
        },
        tocEnabled,
        noteId,
        host,
        // 原生 TOC 始终创建（哪怕「大纲增强」开启）：运行中切换开关时靠 host 的
        // native-toc-hidden 类隐藏/显示原生侧栏。但**仅靠 CSS 隐藏不够**——内核在「大纲展开」
        // 布局态（编辑根 .ne-normal-toc）会给正文留 280px 占位 → 增强大纲下出现大段空白。
        // 故把 outlineEnhance 传给内核走官方 toc.normalView=false 进入收纳布局态（见
        // LakeEditorPrefs.collapseNativeToc）。outlineEnhance 变化会走同文档重建（同锁定切换，
        // 有锚点/延迟销毁兜底，不丢阅读位置）。
        // 阅读态大纲就用内核自己的挂载与样式（挂在 viewer 根节点里），我们只在外壳层调位置，
        // 不再把它挪到自建宿主（挪出去会丢内核主题变量 → 底色/边框全没）。
        { ...(prefs ?? {}), collapseNativeToc: outlineEnhance }
      );
      // 自愈重建时优先使用当前实例最后一次回调拿到的文档，避免 React prop
      // 尚未回流时把刚输入的内容覆盖掉；切换 noteId 时该 ref 已在上面重置。
      editor.setDocument("text/lake", addAssetAccessToken(latestDocumentRef.current));
      // 原生大纲：Lake 侧栏以空 toc 创建，若 ready 先于内核 tocChange，侧栏会一直为空
      // （关闭重开尤其明显）。setDocument 后补一次数据（refreshTocSidebar，带收敛重试），
      // 销毁时清理定时器。原生侧栏始终创建（「大纲增强」开启时仅被隐藏），故这里照常填充，
      // 保证切回原生时立即可见。
      // 锁定 Viewer 同样需要：阅读态侧栏（.ne-viewer-toc-sidebar）只在收到 length>0 的
      // tocChange 时才创建，错过内核首批事件就永远空壳（260916 用户实测「锁定文档大纲不渲染」）。
      if (tocEnabled) {
        tocRefreshTimer = window.setTimeout(() => {
          disposeTocRefresh = refreshTocSidebar(editor, host, (sidebar) => {
            // 锁/解锁重建实例后延续切换前的大纲状态：之前收着（收纳迷你条）就继续收着，之前关掉
            // 就继续关掉。快照口径见 cleanup（按侧栏实际是否显示 + 宽度，不按类名——内核两态的可见
            // 类不同源，按类名读会恒 false，那正是「一锁大纲就没了」的老 bug）。
            if (!tocStateRef.current.visible) {
              try { sidebar.close?.(); } catch { /* ignore */ }
            } else if (!tocStateRef.current.normal) {
              try { sidebar.setNormalView?.(false); } catch { /* ignore */ }
            }
          });
        }, 0);
      }
      // Viewer 的卡片水合订阅在 setDocument 前就已建立；这里再主动请求一次，
      // 确保锁定态首次加载的画板不会只在空文档布局阶段执行水合。
      editor.requestCardHydration?.();
      setting = false;
      // 虚拟渲染/卡片水合会异步改变布局，同步设置 scrollTop 会被后续渲染冲掉。
      // 在多个稳定窗口恢复，锁定 Viewer 与编辑态之间都保持阅读位置。
      // ① 主路径：按锚点节点 id 定位（两态同用视口中心块，见 scrollAnchorRef 注释）。锚点是在
      //    旧态的视口中心取的，所以恢复也把该块对齐到视口中心，尽量贴合原来的阅读位置。
      // ② 回退：锚点缺失时按滚动比例映射（比等值恢复好，但两态高度非线性，仍有误差）。
      const restoreByAnchor = (): boolean => {
        const anchorId = scrollAnchorRef.current;
        if (!anchorId) return false;
        const scroller = resolveScrollNode(host);
        if (!scroller) return false;
        // 锚点只在**当前实例**的挂载点里找：锁/解锁过渡期旧实例层（.is-outgoing）仍在 DOM 且排在
        // 前面，host 级查询会先命中它的同 id 节点——那是上一态的几何（另一套滚动位置/内容高度），
        // 据此算出的 delta 会把新实例滚到错误位置（实测编辑态→阅读态：锚点被算到 6~7k px 之外、
        // 位置门永不打开，旧层一路拖到 1200ms 超时才换，换上去时位置还是错的）。
        const anchorEl = (): HTMLElement | null => {
          const current = mount.querySelector<HTMLElement>(":scope > .lake-editor-mount:not(.is-outgoing)");
          try { return current?.querySelector<HTMLElement>(`[id="${CSS.escape(anchorId)}"]`) ?? null; } catch { return null; }
        };
        // 对齐目标：优先「切换前那个块在外壳里的屏幕偏移」（两态文字停在屏幕同一处）；没有偏移
        // 记录（老路径/取不到）才退回「在新滚动盒里居中」。
        const paneTop = host.getBoundingClientRect().top;
        const offsetTarget = scrollAnchorOffsetRef.current;
        const alignDelta = (el: HTMLElement): number => {
          const er = el.getBoundingClientRect();
          if (offsetTarget != null) return er.top - paneTop - offsetTarget;
          const sr = scroller.getBoundingClientRect();
          return (er.top - sr.top) - (sr.height - er.height) / 2;
        };
        if (mode === "editor") {
          // 锚点已经渲染进 DOM 时优先按**真实几何**对齐：编辑态虚拟渲染的内容高度与内核按整篇
          // 文档算出的位置不是一套坐标（实测同一标题：内核落位 18792 / 编辑态实际 13062），
          // 先走内核落位会先跳到一个偏下 5k px 的位置，等下一次恢复才被拉回——用户看到一次跳动。
          const el = anchorEl();
          if (el) {
            const delta = alignDelta(el);
            if (Math.abs(delta) > 1) scroller.scrollTop += delta;
            return true;
          }
          // 锚点还没渲染出来（虚拟渲染异步）才退回内核落位，之后由后续恢复微调收敛
          const renderer = (editor as { renderer?: { scrollByNodeId?: (id: string) => void } })?.renderer;
          if (typeof renderer?.scrollByNodeId !== "function") return false;
          renderer.scrollByNodeId(anchorId);
          return true;
        }
        const el = anchorEl();
        if (!el) return false;
        const delta = alignDelta(el);
        if (Math.abs(delta) > 1) scroller.scrollTop += delta;
        return true;
      };
      const restoreScroll = (timer: number): void => {
        scrollRestoreTimers.delete(timer);
        const scroller = resolveScrollNode(host);
        if (!scroller) return;
        if (restoreByAnchor()) {
          lastScrollTopRef.current = scroller.scrollTop;
          stableScrollTopRef.current = scroller.scrollTop;
          pin.written = scroller.scrollTop;   // 让「钉锚点」知道这次位移是我们自己写的
          return;
        }
        const snap = scrollSnapshotRef.current;
        const target = snap && snap.max > 0
          ? Math.round((snap.top / snap.max) * Math.max(0, scroller.scrollHeight - scroller.clientHeight))
          : prevScroll;
        if (target <= 0) return;
        if (Math.abs(scroller.scrollTop - target) <= 1) return;
        scroller.scrollTop = target;
        lastScrollTopRef.current = target;
        stableScrollTopRef.current = target;
        pin.written = target;
      };
      for (const delay of [0, 80, 300, 800]) {
        let timer = 0;
        timer = window.setTimeout(() => restoreScroll(timer), delay);
        scrollRestoreTimers.add(timer);
      }
      // 切换完成后内核虚拟渲染/图片水合还会继续改版式：实测解锁方向旧层撤掉后 ~440ms 处正文
      // 整体上移 ~800px、锚点被推出视口，而固定时刻的恢复要等到 800ms 那次（~1.35s）才纠回——
      // 用户看到一次跳动。这里在切换后的短窗口里盯住锚点的屏幕偏移，一偏离目标就立刻纠回；
      // 用户一有滚动/输入、或滚动位置被大幅挪走（>40px，说明有别处主动导航）就停手
      // ——只服务这次切换，不做常驻行为。
      pin.stopped = false;
      pin.written = -1;
      pin.until = Date.now() + ANCHOR_PIN_WINDOW_MS;
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
        host.addEventListener(type, stopPin, { passive: true, capture: true });
      }
      const pinAnchor = (): void => {
        // 没有锚点（换文档/首次加载）说明这次重建不是「同文档换模式」，不钉
        if (pin.stopped || !scrollAnchorRef.current || Date.now() > pin.until) return;
        const scroller = resolveScrollNode(host);
        if (!scroller || !scroller.isConnected) return;
        // 滚动位置被大幅挪动（>40px）视为有人主动导航（大纲/搜索结果/恢复链），立刻放手；
        // 几像素级的漂移是渲染过程本身造成的，继续钉住。
        if (pin.written >= 0 && Math.abs(scroller.scrollTop - pin.written) > 40) return;
        if (restoreByAnchor()) pin.written = scroller.scrollTop;
        pin.frame = window.requestAnimationFrame(pinAnchor);
      };
      pin.frame = window.requestAnimationFrame(pinAnchor);
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

    // 上一轮 cleanup 把旧实例留在了 is-outgoing 层（覆盖在新实例之上）。等新实例首屏渲染出正文，
    // 就在**同一帧**整层移除——旧层是盖在上面的，移除即完成切换，中间不存在可见的空白帧。
    // 就绪判定：正文容器已渲染出块级内容（用元素而非文本长度，空文档/纯图片文档同样能判定，
    // 不必白等超时）＋ 位置已恢复（见下方 anchorInView），并要求连续两帧稳定。
    const outgoingDispose = pendingDisposeRef.current;
    if (outgoingDispose) {
      const newMount = mount.querySelector<HTMLElement>(":scope > .lake-editor-mount:not(.is-outgoing)");
      const deadline = Date.now() + OUTGOING_READY_TIMEOUT_MS;
      // 位置门：新实例必须已经把「切换前视口中心那个块」渲染进视口。否则撤掉旧层时用户先看到
      // 文档开头、再被 0/80/300ms 恢复链拉走 —— 那正是"闪一下"的来源。
      // 只在 newMount 内查询：同一文档两态节点 id 相同，host 级查询会先命中旧层那份。
      const anchorInView = (): boolean => {
        const anchorId = scrollAnchorRef.current;
        if (!anchorId) return true;   // 无锚点（空文档等）：没有位置需要恢复
        let el: HTMLElement | null = null;
        try { el = newMount?.querySelector<HTMLElement>(`[id="${CSS.escape(anchorId)}"]`) ?? null; } catch { el = null; }
        const scroller = resolveScrollNode(host);
        if (!el || !scroller) return false;
        const er = el.getBoundingClientRect();
        const sr = scroller.getBoundingClientRect();
        return er.bottom > sr.top + 4 && er.top < sr.bottom - 4;
      };
      let readyFrames = 0;
      const settleOutgoing = (): void => {
        settleFrame = 0;
        const body = newMount?.querySelector<HTMLElement>(".ne-engine, .ne-viewer-body");
        const rendered = !!body && (body.childElementCount > 0 || (body.textContent ?? "").trim().length > 0);
        readyFrames = rendered && anchorInView() ? readyFrames + 1 : 0;
        if (readyFrames < 2 && Date.now() < deadline) {
          settleFrame = window.requestAnimationFrame(settleOutgoing);
          return;
        }
        if (pendingDisposeRef.current === outgoingDispose) pendingDisposeRef.current = null;
        outgoingDispose();
      };
      settleFrame = window.requestAnimationFrame(settleOutgoing);
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
    // 附件：file 卡片点击 → 公共入口 openAssetEntry（与多维表/小记同一套分流）
    const detachFileCard = attachFileCardClick(host, (src, name, size) => {
      openAssetEntry(src, name, size);
    });

    return () => {
      // 捕获契约：重建（锁/解锁、自愈、换文档）前抓一次当前正文，供新实例 setDocument 续用；
      // 取代旧的「每次按键更新 latestDocumentRef」，保证不丢在途输入。
      if (editor) {
        try { latestDocumentRef.current = stripAssetAccessToken(editor.getDocument("text/lake")); } catch { /* 实例可能已不可读 */ }
      }
      window.clearTimeout(tocRefreshTimer);
      disposeTocRefresh?.();
      disposeTocRefresh = undefined;
      // 实例销毁前抓大纲状态，供重建后的另一态延续（锁/解锁不做状态漂移）。
      // 可见性按**侧栏自身是否在显示**判定（display ≠ none），不猜类名：可见类两态不同源
      // （编辑态在 .ne-editor.ne-toc-visible；阅读态在 .ne-viewer 上），按类名读会恒 false
      // → 每次锁/解锁都 close()，一锁大纲就没了（260916 复发的根因）。
      // 展开/收纳量宽度：编辑态迷你条 ~39px、阅读态展开面板 305px，故 ≥200px 视为展开。
      // 「大纲增强」开启时原生侧栏被我们自己的 CSS 隐藏（display:none），那不是用户收起来，
      // 不能记进快照——否则切回原生大纲时大纲不复现。
      const tocSidebar = host.querySelector<HTMLElement>(".ne-toc-sidebar, .ne-viewer-toc-sidebar");
      const tocTracked = !host.classList.contains("native-toc-hidden");
      if (tocSidebar && tocTracked) {
        const shown = getComputedStyle(tocSidebar).display !== "none";
        tocStateRef.current = {
          visible: shown,
          normal: shown ? tocSidebar.offsetWidth >= 200 : tocStateRef.current.normal,
        };
      }
      // 滚动锚点：用 elementFromPoint 取「视口中心的那个块」的节点 id。
      // 两态都适用且精确：编辑态虽为虚拟渲染（DOM 只保留视口附近 + 缓存区），但视口中心
      // 命中真实渲染节点（实测 50% 处拿到 NE-P id=ueb955b32）；阅读态更是完整渲染。
      // 不能用 TOC 高亮 ne-toc-selected：虚拟渲染下内核 watcher 二分探测失效，恒选中第 0 节
      // （260916 实测：滚到 50% 仍高亮「01--大盘」）→ 会把位置拉回文档开头。
      const prevScroller = host.querySelector<HTMLElement>(".ne-editor-wrap, .ne-viewer");
      let anchorId: string | null = null;
      let anchorOffset: number | null = null;
      if (prevScroller) {
        const box = prevScroller.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) as HTMLElement | null;
          let node: HTMLElement | null = hit;
          while (node && node !== host) {
            // 只要内核块级节点（NE-*）的 id；排除 SVG 图标自带的 id（icon/矩形/路径…）
            if (node.id && /^NE-/i.test(node.tagName)) {
              anchorId = node.id;
              // 同时记下它的屏幕偏移（相对外壳顶）：恢复时按偏移对齐，而不是按新滚动盒居中
              anchorOffset = node.getBoundingClientRect().top - host.getBoundingClientRect().top;
              break;
            }
            node = node.parentElement;
          }
        }
      }
      scrollAnchorRef.current = anchorId;
      scrollAnchorOffsetRef.current = anchorOffset;
      // 回退快照：比例映射（锚点缺失时用；编辑态虚拟高度偏小，误差大，仅兜底）
      if (prevScroller) {
        scrollSnapshotRef.current = {
          top: prevScroller.scrollTop,
          max: Math.max(1, prevScroller.scrollHeight - prevScroller.clientHeight),
        };
      }
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
      host.removeEventListener("cut", cutHandler, true);
      host.removeEventListener("paste", pasteHandler, true);
      onEditorReadyRef.current?.(noteId, null);
      detachMediaCardRouter?.();
      // 上一轮遗留的 outgoing 先回收：锁→编辑→锁 快速连点时不能把多层实例叠起来。
      pendingDisposeRef.current?.();
      pendingDisposeRef.current = null;
      if (settleFrame) window.cancelAnimationFrame(settleFrame);
      settleFrame = 0;
      // 锚点钉查（见 pinAnchor）：先停手再撤，避免切换瞬间它把旧实例的位置写回来
      pin.stopped = true;
      if (pin.frame) window.cancelAnimationFrame(pin.frame);
      pin.frame = 0;
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
        host.removeEventListener(type, stopPin, { capture: true });
      }
      const ownedMount = mount.querySelector<HTMLElement>(":scope > .lake-editor-mount:not(.is-outgoing)");
      retired = true;
      const disposeOwned = (): void => {
        if (ownedDisposed) return;
        ownedDisposed = true;
        destroyLakeEditor(editor);
        ownedMount?.remove();
      };
      editorRef.current = null;
      setEditorState(null);
      // 清理调试挂载句柄，避免残留指向已销毁实例
      if ((window as unknown as Record<string, unknown>).__desktopEditor === editor) {
        (window as unknown as Record<string, unknown>).__desktopEditor = null;
      }
      // 同一文档的重建（锁/解锁、代码块自愈）**不立刻销毁**旧实例：正文区会一直空白到新实例
      // 渲染出内容为止（大文档可达数百毫秒）＝白屏闪烁。改把旧层标 is-outgoing（CSS 抬到新挂载点
      // 之上、绝对铺满、不吃事件）继续显示旧内容，由上方 settleOutgoing 在新实例首屏就绪后整层移除。
      // 换文档/关标签时旧内容已不是当前文档（renderedNoteRef 指向别处），照旧直接销毁。
      if (editor && ownedMount && renderedNoteRef.current === noteId) {
        ownedMount.classList.add("is-outgoing");
        pendingDisposeRef.current = disposeOwned;
        // 兜底：没有新实例接手（关标签/组件卸载）、新实例创建失败、或窗口不可见导致帧循环
        // 被暂停时，仍能到点回收，避免旧层/旧实例滞留（disposeOwned 幂等）。
        window.setTimeout(() => {
          if (pendingDisposeRef.current === disposeOwned) pendingDisposeRef.current = null;
          disposeOwned();
        }, OUTGOING_DISPOSE_FALLBACK_MS);
        // 只清掉本轮的其它残留子节点；不要 host.replaceChildren()——
        // React.StrictMode 在 dev 会双次挂载 effect，第二次复用同一 mount 节点，
        // 若把 .lake-editor-main 移出 DOM，会在脱离文档的节点上重建 Lake 编辑器
        // （to-dom-range 断言：节点未连接）。
        for (const child of Array.from(mount.children)) {
          if (child !== ownedMount) child.remove();
        }
      } else {
        disposeOwned();
        mount.replaceChildren();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, tocEnabled, prefs?.fontSize, prefs?.showToolbar, locked, outlineEnhance, rebuildTick]);

  // 切换到可见标签不应重建整个编辑器，但必须重新触发布局相关水合；
  // 隐藏标签初始化时高度为 0，代码块等卡片会因此错过 $appear。
  useEffect(() => {
    if (!visible) return;
    editorRef.current?.requestCardHydration?.();
    requestCodeblockHealRef.current();
  }, [visible]);

  // 外部刷新/冲突重载会 remount EditorTab，恢复上次滚动位置，避免跳到顶部。
  // 锁/解锁例外：那是同一文档换渲染模式，scrollMemory 存的是上一态的像素值、跨态没有可比性——
  // 实测锁定方向这个 250ms 恢复会把阅读态打到编辑态的像素值（t≈860ms 锚点被顶出视口 ~1.2k px、
  // 约 50ms 后才被 800ms 那次锚点恢复拉回）。跨态位置交给 base effect 的锚点恢复。
  useEffect(() => {
    if (!editorState) return;
    // 有锚点 = 这次是「同文档换渲染模式/自愈重建」，位置已由 base effect 的锚点恢复负责。
    // 这里再按 scrollMemory 的像素值恢复会先把新实例打到上一态的位置（实测锁定方向 t≈750ms
    // 锚点被顶出视口 ~1.2k px、约 50ms 后才被下一次锚点恢复拉回）。真 remount（冲突重载/
    // 外部刷新）锚点 ref 是空的，仍走这条像素恢复。
    if (scrollAnchorRef.current) return;
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
      className={`lake-editor lake-editor-tab${locked ? " lake-locked" : ""}${outlineEnhance ? " native-toc-hidden" : ""}`}
      // 隐藏交给 CSS（.lake-editor-tab:not([data-active]) → opacity:0 + visibility:hidden，见 tabs.css）：
      // 这里再写 display:none 会把尺寸压成 0，切回来触发内核表格重排（261005）。
      style={{ width: "100%" }}
      data-note-id={noteId}
      data-active={visible ? "true" : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        const target = event.target as HTMLElement;
        const item = resolveCardAsset(target);
        const card = target.closest("ne-card") as HTMLElement | null;
        if (item && card) { setTextMenu(null); setCardMenu({ x: event.clientX, y: event.clientY, item, el: card }); return; }
        setCardMenu(null);
        setTextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div ref={editorMountRef} className="lake-editor-main" />
      {cardMenu && (
        <CardContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          item={cardMenu.item}
          actions={{
            openOriginal: (it) => { if (it.ref) void native.openAttachment(it.ref.noteId, it.ref.filename).catch((error) => reportNativeActionError("打开附件", error)); },
            showInFolder: (it) => { if (it.ref) void native.showAttachmentInFolder(it.ref.noteId, it.ref.filename).catch((error) => reportNativeActionError("在文件夹中显示附件", error)); },
            cut: () => { cutCardElement(cardMenu.el); },
            rename: (it) => { setRenameItem({ item: it, el: cardMenu.el }); },
            copyImage: (it) => { if (it.ref) void native.copyAssetImage(it.ref.noteId, it.ref.filename).catch((error) => reportNativeActionError("复制图片", error)); },
            copyPath: (it) => { if (it.ref) void native.copyAssetPath(it.ref.noteId, it.ref.filename).catch((error) => reportNativeActionError("复制资源路径", error)); },
            saveAs: (it) => { if (it.ref) void native.saveAssetAs(it.ref.noteId, it.ref.filename, it.name).catch((error) => reportNativeActionError("另存资源", error)); },
            copyName: (it) => { void navigator.clipboard.writeText(it.name).catch(() => undefined); },
          }}
          onClose={() => setCardMenu(null)}
        />
      )}
      {textMenu && <TextContextMenu x={textMenu.x} y={textMenu.y} onClose={() => setTextMenu(null)} />}
      {renameItem && (
        <AssetRenameDialog
          initial={renameItem.item.name}
          onCancel={() => setRenameItem(null)}
          onConfirm={(newName) => {
            const picked = renameItem;
            setRenameItem(null);
            // 首选 lakex cardData.setName + sync(true)：原地改卡片名并写回编辑器文档（getDocument 可见），
            // 不调 setDocument → 不重渲染整篇 → 没有白屏。
            const cardData = findCardData(picked.el);
            if (cardData?.setName) { cardData.setName(newName); cardData.sync?.(true); return; }
            // 极小兜底：拿不到 cardData（lakex 内部结构变动）时走主进程改文档，再重载该 tab。
            const item = picked.item;
            if (!item.ref) return;
            void native.renameAssetDisplay(item.ref.noteId, item.ref.filename, newName)
              .then((res) => { if (res.ok) onReloadNote?.(noteId); })
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
