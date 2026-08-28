/**
 * 桌面资料库主区（§20 Phase B：从 src/App.tsx 拆出）。
 * 渲染 MultiTabEditor + 思源式面包屑 + 空态。所有状态/回调由 App 注入，本组件不持有业务状态。
 */
import { ChevronRight, File } from "lucide-react";
import type { ReactNode, Ref, RefObject } from "react";
import { MultiTabEditor, type TabInfo } from "../features/editor/MultiTabEditor";
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";

export interface HeadingPathItem {
  id: string;
  level: number;
  text: string;
}

export interface DesktopLibraryProps {
  tabs: TabInfo[];
  activeNoteId: string | null;
  tocEnabled: boolean;
  topbarLeading: ReactNode;
  topbarTrailing: ReactNode;
  wideMode: boolean;
  paragraphSpacing: boolean;
  editorPrefs: { fontSize: number; showToolbar: boolean };
  activePathTitle: string | null;
  headingPath: HeadingPathItem[];
  /** 工作区级可见性（keep-alive：小记模式隐藏资料库但不卸载，切回时避免重建全部 Lake 编辑器） */
  visible?: boolean;
  moreMenuWrapRef: RefObject<HTMLDivElement | null>;
  onToggleMoreMenu: () => void;
  onScrollToTop: () => void;
  onNavigateToHeading: (id: string) => void;
  lockedNoteIds: ReadonlySet<string>;
  pinnedNoteIds: ReadonlySet<string>;
  onTabChange: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
  onTabsReorder: (ordered: string[]) => void;
  onTogglePin: (noteId: string) => void;
  onContentChange: (noteId: string, content: string) => void;
  onEditorReady: (noteId: string, editor: LakeEditorInstance | null) => void;
  onEditorCopyMarkdown: (noteId: string) => void;
  onEditorExport: (noteId: string, format: "markdown" | "html" | "lake") => void;
  onEditorCopyPaths: (noteId: string) => void;
  onCreateNote: () => void;
}

export function DesktopLibrary(props: DesktopLibraryProps) {
  const {
    tabs, activeNoteId, tocEnabled, topbarLeading, topbarTrailing,
    wideMode, paragraphSpacing, editorPrefs,
    activePathTitle, headingPath, moreMenuWrapRef, onToggleMoreMenu,
    onScrollToTop, onNavigateToHeading,
    lockedNoteIds, pinnedNoteIds,
    onTabChange, onTabClose, onTabsReorder, onTogglePin, onContentChange,
    onEditorReady, onEditorCopyMarkdown, onEditorExport, onEditorCopyPaths, onCreateNote,
    visible = true,
  } = props;

  const breadcrumb = activePathTitle !== null ? (
    <nav className="protyle-breadcrumb" aria-label="文档路径">
      {/* 只保留笔记本名（目录路径不重要，顶部有文档名） */}
      <button type="button" className="protyle-breadcrumb__item protyle-breadcrumb__item--notebook" onClick={onScrollToTop} title="回到文档顶部">{activePathTitle || "无标题"}</button>
      {headingPath.length > 0 && (
        <>
          <span className="protyle-breadcrumb__divider" aria-hidden="true"><ChevronRight size={12} /></span>
          <span className="protyle-breadcrumb__outline" aria-label="大纲位置">
            {headingPath.map((hn, i) => (
              <button
                key={hn.id}
                type="button"
                className={`protyle-breadcrumb__item${i === headingPath.length - 1 ? " protyle-breadcrumb__item--current" : ""}`}
                onClick={() => onNavigateToHeading(hn.id)}
                title={`跳转到 H${hn.level}：${hn.text}`}
              >
                {i > 0 && <ChevronRight size={12} />}
                <span className="protyle-breadcrumb__h">H{hn.level}</span>
                {hn.text}
              </button>
            ))}
          </span>
        </>
      )}
      <div className="toolbar__menu-wrap protyle-breadcrumb__more" ref={moreMenuWrapRef as Ref<HTMLDivElement>}>
        <button className="toolbar__item protyle-breadcrumb__more-btn" onClick={onToggleMoreMenu} title="更多" aria-label="更多"><File size={15} /></button>
      </div>
    </nav>
  ) : undefined;

  return (
    <section className={`document-pane ${wideMode ? "wide-mode" : ""} ${paragraphSpacing ? "paragraph-spacing" : ""}`}>
      <div className="read-progress" aria-hidden="true" />
      <MultiTabEditor
        visible={visible}
        tabs={tabs}
        activeNoteId={activeNoteId}
        tocEnabled={tocEnabled}
        topbarLeading={topbarLeading}
        topbarTrailing={topbarTrailing}
        breadcrumb={breadcrumb}
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        onTabsReorder={onTabsReorder}
        lockedNoteIds={lockedNoteIds}
        pinnedNoteIds={pinnedNoteIds}
        onTogglePin={onTogglePin}
        onContentChange={onContentChange}
        prefs={editorPrefs}
        onEditorReady={onEditorReady}
        onEditorCopyMarkdown={onEditorCopyMarkdown}
        onEditorExport={onEditorExport}
        onEditorCopyPaths={onEditorCopyPaths}
        emptyAction={<button className="b3-button" onClick={onCreateNote}>新建文档</button>}
      />
    </section>
  );
}
