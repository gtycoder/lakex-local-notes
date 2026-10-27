/**
 * 桌面资料库主区（§20 Phase B：从 src/App.tsx 拆出）。
 * 渲染 MultiTabEditor + 思源式面包屑 + 空态。所有状态/回调由 App 注入，本组件不持有业务状态。
 */
import { useRef, type ReactNode, type RefObject } from "react";
import { useEditorTopVar } from "../hooks/useEditorTopVar";
import { MultiTabEditor, type TabInfo } from "../features/editor/MultiTabEditor";
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";

export interface DesktopLibraryProps {
  tabs: TabInfo[];
  activeNoteId: string | null;
  tocEnabled: boolean;
  outlineEnhance: boolean;
  topbarLeading: ReactNode;
  topbarTrailing: ReactNode;
  wideMode: boolean;
  editorPrefs: { fontSize: number; showToolbar?: boolean; floatingToolbar?: boolean; blockHandle?: boolean };
  /** 每个文档 tab 的笔记本名（面包屑首段）：透传给 EditorTab，由它自渲染面包屑。 */
  notePathTitle: (noteId: string) => string | null;
  /** 工作区级可见性（keep-alive：小记模式隐藏资料库但不卸载，切回时避免重建全部 Lake 编辑器） */
  visible?: boolean;
  moreMenuWrapRef: RefObject<HTMLDivElement>;
  onToggleMoreMenu: () => void;
  lockedNoteIds: ReadonlySet<string>;
  /** 锁定/解锁活动文档（透传给多维表右上角菜单）。 */
  onToggleNoteLock?: () => void;
  /** 多维表导出 CSV（透传给多维表右上角菜单）。 */
  onExportBitableCsv?: (noteId: string) => void;
  /** 活动标签在回收站中：横幅里的"打开回收站"出口。 */
  onOpenTrash?: () => void;
  /** 正文文件缺失面板：打开历史版本。 */
  onOpenHistory?: (noteId: string) => void;
  /** 正文文件缺失面板：重新读取（同步拉回正文后）。 */
  onRetryBody?: (noteId: string) => void;
  pinnedNoteIds: ReadonlySet<string>;
  onTabChange: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
  /** 分屏（261008）：左右两栏的文档；null = 未分屏。 */
  splitPair?: { left: string; right: string } | null;
  /** 点标签栏里的**合并分屏标签** = 回到分屏区域（261008，Edge 式）。 */
  onActivateSplit?: () => void;
  /** 合并标签上的 ×：取消分屏（两个标签都保留）。 */
  onCloseSplit?: () => void;
  onExitSplit?: () => void;
  onSwapSplit?: () => void;
  onTabsReorder: (ordered: string[]) => void;
  onTogglePin: (noteId: string) => void;
  onContentChange: (noteId: string, content?: string) => void;
  onPreserveBitableDraft?: (noteId: string, content: string) => void;
  onEditorReady: (noteId: string, editor: LakeEditorInstance | null) => void;
  onEditorCapture?: (noteId: string, capture: (() => string | null) | null) => void;
  /** 外部改动正文后重载该文档 tab（附件重命名用） */
  onReloadNote: (noteId: string) => void;
  onCreateNote: () => void;
  /**
   * 增强大纲：作为「编辑区内部的一块」渲染在 .document-pane 里（260922 A 方案）。
   * 由 App 传入（它持有大纲状态/回调），但 DOM 落在编辑区内 ⇒ 与编辑区同一块表面、
   * 受同一裁剪/层叠上下文，顶边由 --lake-editor-top 动态给。
   */
  outlineSlot?: ReactNode;
}

export function DesktopLibrary(props: DesktopLibraryProps) {
  const {
    tabs, activeNoteId, tocEnabled, outlineEnhance, topbarLeading, topbarTrailing,
    wideMode, editorPrefs,
    moreMenuWrapRef, onToggleMoreMenu, notePathTitle,
    lockedNoteIds, onToggleNoteLock, onExportBitableCsv, pinnedNoteIds,
    onTabChange, onTabClose, onTabsReorder, onTogglePin, onContentChange,
    splitPair, onActivateSplit, onCloseSplit, onExitSplit, onSwapSplit,
    onEditorReady,
  onEditorCapture, onReloadNote, onCreateNote, onOpenTrash, outlineSlot,
    visible = true,
  } = props;

  // 动态顶：把 pane 内顶部停靠 chrome（面包屑 + 内核工具条）的底边写进 --lake-editor-top，
  // 供「编辑区内部」的大纲面板使用（工具条换高/隐藏/将来浮动都能跟上）。
  const paneRef = useRef<HTMLElement | null>(null);
  useEditorTopVar(paneRef, activeNoteId);


  return (
    <section ref={paneRef} className={`document-pane${wideMode ? " wide-mode" : ""}`}>
      <MultiTabEditor
        visible={visible}
        tabs={tabs}
        activeNoteId={activeNoteId}
        tocEnabled={tocEnabled}
        outlineEnhance={outlineEnhance}
        topbarLeading={topbarLeading}
        topbarTrailing={topbarTrailing}
        notePathTitle={notePathTitle}
        moreMenuWrapRef={moreMenuWrapRef}
        onToggleMoreMenu={onToggleMoreMenu}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        splitPair={splitPair}
        onActivateSplit={onActivateSplit}
        onCloseSplit={onCloseSplit}
        onExitSplit={onExitSplit}
        onSwapSplit={onSwapSplit}
        onTabsReorder={onTabsReorder}
        lockedNoteIds={lockedNoteIds}
        onToggleNoteLock={onToggleNoteLock}
        onExportBitableCsv={onExportBitableCsv}
        onOpenTrash={onOpenTrash}
        pinnedNoteIds={pinnedNoteIds}
        onTogglePin={onTogglePin}
        onContentChange={onContentChange}
        onPreserveBitableDraft={props.onPreserveBitableDraft}
        prefs={editorPrefs}
        onEditorReady={onEditorReady}
        onEditorCapture={onEditorCapture}
        onReloadNote={onReloadNote}
        onOpenHistory={props.onOpenHistory}
        onRetryBody={props.onRetryBody}
        emptyAction={<button className="ln-btn ln-btn--primary" onClick={onCreateNote}>新建文档</button>}
      />
      {outlineSlot}
    </section>
  );
}
