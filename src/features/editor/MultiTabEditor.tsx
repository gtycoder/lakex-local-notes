/**
 * MultiTabEditor —— 桌面多标签**宿主**（D-10/D-13 头注释，261125）：宿主分派（5 种 kind 各挂各的内核）+ 分屏布局。
 *
 * 职责边界：标签条 + 切换器浮层 + 标签右键菜单在 ./TabStrip，拖拽排序 + FLIP 在 hooks/useTabStripDrag
 * （261125 D-10 纯搬家）；「正文缺失」面板 = 本文件 MissingBodyPanel；本文件只留宿主分派、只读横幅与分屏几何。
 * 单一来源指针：只读原因/横幅 = core/capabilities/readonlyReason（261112 UI 审计 17 收口，locked 不弹横幅）；
 * 分屏几何 = splitGeometry.ts（分屏 = 左右两栏、最多两个、临时不持久化，splitView.test 钉死）；
 * 标签槽位/顺序 = tabOrder.ts；分隔条 = components/ui/SplitHandle（唯一实现，禁第二套）。
 * 内核边界（P12）：EditorTab/Univer/Bitable/Board/Ink 全部 lazy，禁止静态 import（desktopKernelLazy.test 钉死）。
 * 已知坑：内核 floating 层被补丁 portal 到 body ⇒ 按当前可见标签收起其它实例浮层（MutationObserver 兜底）；
 * 分屏组 = Edge 式合并标签（点它回分屏、右键 = 分屏专属两项，不混入单页语义）。
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { EditorErrorBoundary } from "./EditorErrorBoundary";
import { File, TriangleAlert } from "lucide-react";
// D-10（261125）：标签条 + 切换器浮层 + 标签右键菜单在 ./TabStrip，拖拽排序 + FLIP 在 hooks/useTabStripDrag。
import { TabStrip } from "./TabStrip";
import { SplitHandle } from "../../components/ui/SplitHandle";
import { SPLIT_WIDTH_LIMITS, clampSplitLeft } from "./splitGeometry";
// 261111：懒加载兜底 = 编辑器同构骨架（纯静态、无内核依赖，不改变 lazy 边界）。
import { EditorLoadingSkeleton } from "./EditorLoadingSkeleton";
/** Lake 文档编辑器（闭源内核，入口里占 ≈1.78MB gz）：**按需加载**。
 *  P12（261103）：与 Univer/Bitable/Board/Ink 同一模式；已有的 Suspense（下方「正在加载编辑器…」）
 *  顺带承担首 tab / 自动恢复会话的占位；不要改回静态 import（会让 6.1MB 内核回到入口）。 */
const EditorTab = lazy(() => import("./EditorTab").then((m) => ({ default: m.EditorTab })));
import "./splitView.css";

/** 表格编辑器（Univer，按需加载）：只在真的打开表格文档时才进首屏之外的分包。 */
const UniverSheetEditor = lazy(() => import("../usheet/UniverSheetEditor").then((m) => ({ default: m.UniverSheetEditor })));
/** 多维表编辑器（自研，懒加载）：同样只在真的打开多维表文档时才进分包。 */
const BitableEditor = lazy(() => import("../bitable/BitableEditor").then((m) => ({ default: m.BitableEditor })));
/** 画板编辑器（Drawnix/Plait 引擎，懒加载）：只在真的打开画板文档时才进分包（≈511KB gzip）。 */
const BoardEditor = lazy(() => import("../board/BoardEditor").then((m) => ({ default: m.BoardEditor })));
/** 手写板编辑器（共享 InkPad + perfect-freehand，懒加载）。 */
const DesktopInkPad = lazy(() => import("../ink/DesktopInkPad").then((m) => ({ default: m.DesktopInkPad })));
import type { LakeEditorPrefs } from "./lakeRuntime";
import type { EditorCaptureRegistrar } from "../../core/editorCapture";
import type { NoteKind } from "../../core/noteKind";
import { readonlyBannerReason, readonlyReasonCopy, readonlyReasonOf } from "../../core/capabilities/readonlyReason";

const EMPTY_PINNED: ReadonlySet<string> = new Set();

export interface TabInfo {
  noteId: string;
  title: string;
  content: string;
  dirty?: boolean;
  /** 文档自定义图标（emoji） */
  icon?: string | null;
  /** P1：恢复历史后 bump，强制 EditorTab 重建（key 的一部分） */
  reloadKey?: number;
  /** 远端已删除（软删/墓碑/purge）：tab 显示"已删除"标记，正文保留供复制/恢复。 */
  deleted?: boolean;
  /** 文档类型（doc | usheet | bitable | board | ink；缺省 doc）。 */
  kind?: NoteKind;
  /** 正文文件缺失（被手动删除等）：渲染专用面板（只读、不挂编辑器、不弹 ENOENT）。 */
  bodyMissing?: boolean;
  /** 标签归属空间（261109）：`"diary"` 只出现在日记空间 tab 条；缺省 = 文档空间。 */
  space?: "library" | "diary";
}

interface MultiTabEditorProps {
  tabs: TabInfo[];
  activeNoteId: string | null;
  tocEnabled: boolean;
  outlineEnhance: boolean;
  onTabChange: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
  /** 拖拽排序：给出新的 noteId 顺序 */
  onTabsReorder?: (noteIds: string[]) => void;
  /** 「云端已删除（仅本地）」副本的 noteId 集合：只读原因横幅据此区分 S3 与普通回收站。 */
  cloudDeletedNoteIds?: ReadonlySet<string>;
  /** 只读锁的 noteId 集合（驱动 EditorTab viewer 重建） */
  lockedNoteIds?: ReadonlySet<string>;
  /** 锁定/解锁当前活动文档（多维表右上角菜单用；由上层处理持久化与状态）。 */
  onToggleNoteLock?: () => void;
  /** 多维表「导出 CSV」（来自多维表右上角菜单，走上层导出管线）。 */
  onExportBitableCsv?: (noteId: string) => void;
  /** 当前活动标签在回收站/已被他端 purge：顶部横幅 + 只读（见 tab.deleted）。 */
  onOpenTrash?: () => void;
  /** 钉住的标签（由上层持有，保证关闭/自动淘汰时能感知钉住状态）。 */
  pinnedNoteIds?: ReadonlySet<string>;
  /** 切换标签钉住状态（由上层更新状态）。 */
  onTogglePin?: (noteId: string) => void;
  onContentChange: (noteId: string, content?: string) => void;
  onPreserveBitableDraft?: (noteId: string, content: string) => void;
  /** 工作区级可见性（keep-alive：外部隐藏整个工作区时把所有 tab 视为不可见，切回时触发重新水合） */
  visible?: boolean;
  prefs?: LakeEditorPrefs;
  onEditorReady?: (noteId: string, editor: import("./lakeRuntime").LakeEditorInstance | null) => void;
  /** 审计 F15：usheet/Board 注册按需同步序列化（关闭/保存/退出时现取），null 表示卸载。 */
  onEditorCapture?: EditorCaptureRegistrar;
  /** 外部改动正文后重载该文档 tab（附件重命名用） */
  onReloadNote?: (noteId: string) => void;
  /** 「正文缺失」面板：打开该文档的历史版本（由上层接 HistoryPanel）。 */
  onOpenHistory?: (noteId: string) => void;
  /** 「正文缺失」面板：重新读取（同步把正文拉回来之后用）。 */
  onRetryBody?: (noteId: string) => void;
  /** 顶栏左侧元素（工作空间/云同步），渲染在标签左侧，与多 tab 融合成一条顶栏 */
  topbarLeading?: ReactNode;
  /** 顶栏右侧元素（外观/更多），渲染在标签最右侧 */
  topbarTrailing?: ReactNode;
  emptyAction?: ReactNode;
  /** 面包屑（261008）：按 noteId 取该文档的笔记本名；由 EditorTab **自渲染**（每栏一条、随栏宽收缩）。 */
  notePathTitle?: (noteId: string) => string | null;
  /** 面包屑右端「更多」的锚点 + 回调（只在单栏时由焦点栏渲染）。 */
  moreMenuWrapRef?: RefObject<HTMLDivElement>;
  onToggleMoreMenu?: () => void;
  /** 分屏（261008）：左右两栏的文档；null = 未分屏。最多两栏、不同文档、临时不持久化。
   *  标签栏里这两页渲染成**一个合并标签**；点它才显示分屏区域。 */
  splitPair?: { left: string; right: string } | null;
  /** 点合并标签 = 回到分屏区域。 */
  onActivateSplit?: () => void;
  /** 合并标签上的 × = 取消分屏（两个标签都保留）。 */
  onCloseSplit?: () => void;
  /** 取消分屏（右栏标签仍保留在标签栏，只是回到单栏）。 */
  onExitSplit?: () => void;
  /** 左右位置互换（焦点跟随文档 ⇒ 视觉上焦点移到另一侧）。 */
  onSwapSplit?: () => void;
}

/**
 * 「正文文件缺失」面板（261023）：不挂编辑器、不写盘、不弹 ENOENT。
 * 处置出口：历史版本恢复 / 同步拉回后重新读取 / 关闭标签。
 * 删除仍走目录右键（保持删除流程单一来源：确认框 + 回收站 + 墓碑 + 同步）。
 */
function MissingBodyPanel({ tab, onOpenHistory, onRetryBody, onTabClose }: {
  tab: TabInfo;
  onOpenHistory?: (noteId: string) => void;
  onRetryBody?: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
}) {
  return (
    <section className="empty-workspace" role="alert" aria-label="正文文件缺失">
      <span className="empty-workspace-icon" aria-hidden="true"><File size={24} /></span>
      <h2>《{tab.title || "无标题"}》的正文文件已丢失</h2>
      <p className="empty-workspace-hint">{readonlyReasonCopy("body-missing").releaseHint}</p>
      <p className="empty-workspace-hint">云端有副本时，下次同步会自动把正文拉回来（拉回后点「重新读取」）；也可以从历史版本恢复，或在左侧目录右键删除这篇文档。设置 →「文档与历史」→「数据体检（只读诊断）」可列出所有缺失项。</p>
      <button type="button" className="ln-btn ln-btn--secondary" onClick={() => onOpenHistory?.(tab.noteId)} disabled={!onOpenHistory}>打开历史版本</button>
      <button type="button" className="ln-btn ln-btn--secondary" onClick={() => onRetryBody?.(tab.noteId)} disabled={!onRetryBody}>重新读取</button>
      <button type="button" className="ln-btn ln-btn--ghost" onClick={() => onTabClose(tab.noteId)}>关闭标签</button>
    </section>
  );
}

export function MultiTabEditor({
  tabs,
  activeNoteId,
  tocEnabled,
  outlineEnhance,
  onTabChange,
  onTabClose,
  onTabsReorder,
  lockedNoteIds,
  cloudDeletedNoteIds,
  onToggleNoteLock,
  onExportBitableCsv,
  pinnedNoteIds,
  onTogglePin,
  onContentChange,
  onPreserveBitableDraft,
  visible = true,
  prefs,
  onEditorReady,
  onEditorCapture,
  onReloadNote,
  onOpenHistory,
  onRetryBody,
  onOpenTrash,
  topbarLeading,
  topbarTrailing,
  emptyAction,
  notePathTitle,
  moreMenuWrapRef,
  onToggleMoreMenu,
  splitPair = null,
  onActivateSplit,
  onCloseSplit,
  onExitSplit,
  onSwapSplit,
}: MultiTabEditorProps) {
  // 审计 §7.3：不再持有第二份可写正文（旧 contentCache/reloadKeysRef 已删）——
  // tab.content 只表示「最后已提交版本」；实时正文由 EditorTab 捕获、保存/草稿/关闭时按需 capture；
  // 外部刷新仍靠 key=noteId-reloadKey 重挂载 + tab.content 提供新正文。
  const pinned = pinnedNoteIds ?? EMPTY_PINNED;

  // ---- 分屏（261008）：左右两栏、最多两个、不同文档、临时不持久化 ----
  const panelsRef = useRef<HTMLDivElement>(null);
  /** 左栏宽度（px）；null = 没拖过，两栏平分（CSS 的 1fr）。拖过只活在本次会话。 */
  const [splitLeft, setSplitLeft] = useState<number | null>(null);
  useEffect(() => { if (!splitPair) setSplitLeft(null); }, [splitPair]);
  /** 容器实测宽度：缩窗 / 开关目录栏 / 开关大纲栏都会改变它（261012 修「变窄后右栏塌成 0」）。 */
  const [panelsWidth, setPanelsWidth] = useState(0);
  useEffect(() => {
    const el = panelsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => el.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const width = read();
      setPanelsWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
    });
    ro.observe(el);
    setPanelsWidth(read());
    return () => ro.disconnect();
  }, []);
  /** 实际生效的左栏宽度（px）；null = 没拖过，两栏平分（CSS 的 1fr）。几何口径见 splitGeometry.ts。 */
  const effectiveSplitLeft = useMemo(
    () => (splitLeft == null ? null : clampSplitLeft(panelsWidth, splitLeft)),
    [splitLeft, panelsWidth],
  );
  /** 分屏组是否**当前激活**（焦点在组内两页之一）：只有激活时才显示两栏；
   *  点别的标签 = 普通单栏（合并标签仍在，点它再回分屏）。 */
  const splitActive = useMemo(
    () => splitPair != null && activeNoteId != null && (activeNoteId === splitPair.left || activeNoteId === splitPair.right),
    [splitPair, activeNoteId],
  );
  /** 合并标签挂在组内更靠前那页的位置；任一侧不在已开标签里 → null（自愈）。 */
  const splitFirstNote = useMemo(() => {
    if (!splitPair) return null;
    const li = tabs.findIndex((t) => t.noteId === splitPair.left);
    const ri = tabs.findIndex((t) => t.noteId === splitPair.right);
    if (li < 0 || ri < 0) return null;
    return li <= ri ? splitPair.left : splitPair.right;
  }, [splitPair, tabs]);
  const splitLeftTab = useMemo(() => (splitPair ? tabs.find((t) => t.noteId === splitPair.left) ?? null : null), [splitPair, tabs]);
  const splitRightTab = useMemo(() => (splitPair ? tabs.find((t) => t.noteId === splitPair.right) ?? null : null), [splitPair, tabs]);
  /** 本标签显示在哪一栏：分屏组**激活**时 left/right，否则恒 null。 */
  const paneOf = useCallback((noteId: string): "left" | "right" | null => {
    if (!splitActive || !splitPair) return null;
    if (noteId === splitPair.left) return "left";
    if (noteId === splitPair.right) return "right";
    return null;
  }, [splitActive, splitPair]);
  /** 本标签是否显示：分屏组激活时两栏都显示（右栏非焦点由 data-pane-visible 放行）；否则只有焦点标签。 */
  const paneVisible = useCallback((noteId: string) => (splitActive && splitPair ? paneOf(noteId) != null : noteId === activeNoteId), [splitActive, splitPair, paneOf, activeNoteId]);
  /**
   * 内核 floating 层（表格黄叹号 / 菜单 / 对话框）被补丁 portal 到 `document.body`。
   * 为什么在 body：放在实例宿主里会让「自定义排序」对话框进入 measure/reflow 死循环（渲染进程 100%+ CPU、
   * 整窗点不动，用户 261022 报）。放回 body 的代价 = 261009 的「黄叹号逃出标签宿主」会回来 ⇒
   * 这里按**当前可见标签**把其它实例的浮层收起（补丁给容器打了 `data-lake-owner="univer-sheet-<noteId>"`）。
   * 新浮层可能在任意时刻被创建 ⇒ 用 MutationObserver 兜底，而不是只在切 tab 时算一次。
   */
  useEffect(() => {
    const visibleOwners = new Set<string>();
    const addOwner = (noteId: string | null | undefined): void => {
      if (noteId) visibleOwners.add("univer-sheet-" + noteId);
    };
    addOwner(activeNoteId);
    if (splitActive && splitPair) {
      addOwner(splitPair.left);
      addOwner(splitPair.right);
    }
    const syncFloating = (): void => {
      for (const el of document.querySelectorAll<HTMLElement>("[data-lake-univer-floating]")) {
        const owner = el.dataset.lakeOwner ?? "";
        // 没有 owner（理论上只在实例尚未拿到 id 时出现）时保持可见，避免把正常浮层藏掉。
        el.style.display = owner && !visibleOwners.has(owner) ? "none" : "";
      }
    };
    syncFloating();
    const observer = new MutationObserver(syncFloating);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [activeNoteId, splitActive, splitPair]);
  const measureSplitLeft = useCallback(() => {
    const first = panelsRef.current?.querySelector<HTMLElement>('[data-pane="left"]');
    return first ? first.getBoundingClientRect().width : 320;
  }, []);
  /** 点进任一栏即把焦点切到该栏（焦点栏决定 data-active / 面包屑 / 大纲 / 快捷键）。 */
  const handlePanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitActive || !splitPair) return;
    const host = (event.target as HTMLElement).closest<HTMLElement>("[data-pane]");
    const pane = host?.getAttribute("data-pane");
    const noteId = pane === "left" ? splitPair.left : pane === "right" ? splitPair.right : null;
    if (noteId && noteId !== activeNoteId) onTabChange(noteId);
  }, [splitActive, splitPair, activeNoteId, onTabChange]);

  // 活动标签的只读原因（261112 UI 审计 17 P1）：判据/文案单一来源 = core/capabilities/readonlyReason。
  // 注意：正文缺失（bodyMissing）由 MissingBodyPanel 整块接管，横幅不重复；面板文案也取自同一来源。
  const activeTab = tabs.find((t) => t.noteId === activeNoteId) ?? null;
  const activeReadonlyReason = activeTab
    ? readonlyReasonOf({
        locked: lockedNoteIds?.has(activeTab.noteId) ?? false,
        trashed: activeTab.deleted === true,
        cloudDeleted: activeTab.deleted === true && (cloudDeletedNoteIds?.has(activeTab.noteId) ?? false),
      })
    : null;
  /** 横幅原因：locked 不弹（见 readonlyBannerReason）；其余照旧。 */
  const bannerReadonlyReason = readonlyBannerReason(activeReadonlyReason);

  const handleChange = useCallback(
    (noteId: string, content?: string) => {
      onContentChange(noteId, content);
    },
    [onContentChange]
  );


  /** 空闲预热「表格编辑器」模块（Univer 分包）：**纯预取、不渲染**，且**只在 dev 生效**。
   *  实测（261010，隔离实例 + CDP）：首次打开表格的「点击 → 宿主挂载」这段在 dev 要 **1.86s**
   *  （Vite 逐个下发 dev 模块 + 未压缩代码执行，与点击无关），打包（scheme）只要 0.14s。
   *  ⇒ dev 下把它挪到空闲时段；打包侧保持**真懒加载**（不为一个 0.14s 的收益常驻解析 6.3MB 分包）。 */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let idleId: number | undefined;
    let timerId: number | undefined;
    const warm = () => { void import("../usheet/UniverSheetEditor"); };
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => { if (idleId !== undefined) window.cancelIdleCallback(idleId); };
    }
    timerId = window.setTimeout(warm, 2500);
    return () => { if (timerId !== undefined) window.clearTimeout(timerId); };
  }, []);


  return (
    <div className="multi-tab-editor">
      <TabStrip
        tabs={tabs}
        activeNoteId={activeNoteId}
        pinned={pinned}
        splitPair={splitPair}
        splitFirstNote={splitFirstNote}
        splitActive={splitActive}
        splitLeftTab={splitLeftTab}
        splitRightTab={splitRightTab}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        onTabsReorder={onTabsReorder}
        onTogglePin={onTogglePin}
        onActivateSplit={onActivateSplit}
        onCloseSplit={onCloseSplit}
        onExitSplit={onExitSplit}
        onSwapSplit={onSwapSplit}
        topbarLeading={topbarLeading}
        topbarTrailing={topbarTrailing}
      />
      {/* 横幅只给「数据事实类」只读原因（回收站 / 云端已删除）；编辑锁是用户主动行为，不弹横幅（261116 用户裁决）。 */}
      {bannerReadonlyReason && (
        <div className="tab-gone-banner" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{bannerReadonlyReason.title}。{bannerReadonlyReason.releaseHint}</span>
          {bannerReadonlyReason.action === "open-trash" && onOpenTrash && (
            <button type="button" onClick={onOpenTrash}>打开回收站</button>
          )}
        </div>
      )}
      <div
        ref={panelsRef}
        className={`tab-panels${splitActive ? " is-split" : ""}`}
        style={splitActive && effectiveSplitLeft != null ? ({ "--split-left": `${effectiveSplitLeft}px` } as React.CSSProperties) : undefined}
        onPointerDownCapture={handlePanePointerDown}
      >
        {tabs.length === 0 ? <section className="empty-workspace">
          <span className="empty-workspace-icon" aria-hidden="true"><File size={24} /></span>
          <h2>开始写第一篇笔记</h2>
          <p className="empty-workspace-hint">新建文档开始记录，或按 ⌘K 搜索已有笔记</p>
          {emptyAction}
        </section> : <Suspense fallback={<EditorLoadingSkeleton />}>{tabs.map((tab) => (
          tab.bodyMissing ? (
            <MissingBodyPanel
              key={"mb-" + tab.noteId}
              tab={tab}
              onOpenHistory={onOpenHistory}
              onRetryBody={onRetryBody}
              onTabClose={onTabClose}
            />
          ) : tab.kind === "usheet" ? (
            <EditorErrorBoundary key={"us-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
              <UniverSheetEditor
                noteId={tab.noteId}
                content={tab.content}
                visible={visible && paneVisible(tab.noteId)}
                focused={tab.noteId === activeNoteId}
                pane={paneOf(tab.noteId)}
                readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
                onChange={(content) => handleChange(tab.noteId, content)}
                onDirty={() => handleChange(tab.noteId)}
                onCapture={(capture) => onEditorCapture?.(tab.noteId, capture)}
              />
            </EditorErrorBoundary>
          ) : tab.kind === "bitable" ? (
            <EditorErrorBoundary key={"bt-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
              <BitableEditor
                noteId={tab.noteId}
                content={tab.content}
                visible={visible && paneVisible(tab.noteId)}
                focused={tab.noteId === activeNoteId}
                pane={paneOf(tab.noteId)}
                readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
                locked={lockedNoteIds?.has(tab.noteId) ?? false}
                onToggleLock={onToggleNoteLock && tab.deleted !== true ? onToggleNoteLock : undefined}
                onExportCsv={onExportBitableCsv ? () => onExportBitableCsv(tab.noteId) : undefined}
                onChange={(content) => handleChange(tab.noteId, content)}
                onDirty={() => handleChange(tab.noteId)}
                onCapture={(capture) => onEditorCapture?.(tab.noteId, capture)}
                onPreserveDraft={onPreserveBitableDraft ? (content) => onPreserveBitableDraft(tab.noteId, content) : undefined}
              />
            </EditorErrorBoundary>
          ) : tab.kind === "board" ? (
            <EditorErrorBoundary key={"bd-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
              <BoardEditor
                noteId={tab.noteId}
                content={tab.content}
                visible={visible && paneVisible(tab.noteId)}
                focused={tab.noteId === activeNoteId}
                pane={paneOf(tab.noteId)}
                readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
                onChange={(content) => handleChange(tab.noteId, content)}
                onDirty={() => handleChange(tab.noteId)}
                onCapture={(capture) => onEditorCapture?.(tab.noteId, capture)}
              />
            </EditorErrorBoundary>
          ) : tab.kind === "ink" ? (
            <EditorErrorBoundary key={"ink-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
              <DesktopInkPad
                noteId={tab.noteId}
                content={tab.content}
                visible={visible && paneVisible(tab.noteId)}
                focused={tab.noteId === activeNoteId}
                pane={paneOf(tab.noteId)}
                readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
                onChange={(content) => handleChange(tab.noteId, content)}
                onDirty={() => handleChange(tab.noteId)}
                onCapture={(capture) => onEditorCapture?.(tab.noteId, capture)}
              />
            </EditorErrorBoundary>
          ) : (
          /* DT-01（261027）：doc 是唯一挂闭源 Lake 内核的 kind，必须与其余四支一样按标签隔离 ——
             内核 render 抛错时只坏该标签，不能打穿整个 React 根（其余标签的未落盘编辑会一起丢）。 */
          <EditorErrorBoundary key={"doc-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
          <EditorTab
            key={`${tab.noteId}-${tab.reloadKey ?? 0}`}
            noteId={tab.noteId}
            readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
            content={tab.content}
            visible={visible && paneVisible(tab.noteId)}
            focused={tab.noteId === activeNoteId}
            pane={paneOf(tab.noteId)}
            pathTitle={notePathTitle?.(tab.noteId) ?? null}
            moreMenuWrapRef={moreMenuWrapRef}
            onToggleMoreMenu={onToggleMoreMenu}
            tocEnabled={tocEnabled}
            outlineEnhance={outlineEnhance}
            onChange={() => handleChange(tab.noteId)}
            prefs={prefs}
            onEditorReady={onEditorReady}
            onReloadNote={onReloadNote}
          />
          </EditorErrorBoundary>
          )
        ))}</Suspense>}
        {splitActive && (
          <SplitHandle
            className="split-view-handle"
            ariaLabel="调整分屏宽度"
            minWidth={SPLIT_WIDTH_LIMITS.minLeft}
            maxWidth={SPLIT_WIDTH_LIMITS.maxLeft}
            minRight={SPLIT_WIDTH_LIMITS.minRight}
            containerRef={panelsRef}
            /* 传**生效宽度**：没拖过时也给出实测的一半 ⇒ 分隔条有 aria-valuenow，且拖拽起点与视觉一致。
               用户期望值仍只存在 splitLeft（session-only），容器变化不会把它写坏。 */
            width={effectiveSplitLeft ?? (panelsWidth > 0 ? Math.round(panelsWidth / 2) : null)}
            measureLeft={measureSplitLeft}
            onPreview={setSplitLeft}
            onCommit={(next) => setSplitLeft(next)}
          />
        )}
      </div>
    </div>
  );
}
