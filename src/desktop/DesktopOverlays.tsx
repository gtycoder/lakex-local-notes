/**
 * 桌面 Overlay 装配（§20 Phase B：从 src/App.tsx 尾部 JSX 拆出）。
 * 只负责渲染浮层：ConfirmDelete / 顶栏两个 portal 菜单 / 草稿恢复 / 搜索 / 回收站 / 历史 / 同步 toast / 设置。
 * 所有状态与回调由 App（或后续 useDesktopShell）注入，本组件不持有业务状态。
 */
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { Focus, Lock, LockOpen, Settings as Settings2Icon, Trash2 } from "lucide-react";
import { ConfirmDelete } from "../components/Sidebar";
import { DraftRecoveryDialog } from "../components/DraftRecoveryDialog";
import { SearchPanel } from "../components/SearchPanel";
import { TrashPanel } from "../components/TrashPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { SyncToast, type SyncToastData } from "../components/SyncToast";
import { SettingsPanel, type SettingsCategory } from "../components/SettingsPanel";
import type { AppSettings } from "../lib/settings";
import type { DraftJournalEntry, S3Settings, TreeNode } from "../lib/types";
import { clampPopoverPosition } from "../hooks/topMenuPosition";

export interface DesktopOverlaysProps {
  confirmDelete: TreeNode | null;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;

  workspaceMenuOpen: boolean;
  wsMenuWrapRef: RefObject<HTMLDivElement>;
  workspaceMenuRef: RefObject<HTMLDivElement>;
  moreMenuWrapRef: RefObject<HTMLDivElement>;
  moreMenuRef: RefObject<HTMLDivElement>;
  topMenuOpen: boolean;
  onOpenSettingsFromMenu: (category: SettingsCategory) => void;
  onOpenTrashFromMenu: () => void;

  focusMode: boolean;
  onToggleFocusMode: () => void;
  activeNoteId: string | null;
  lockedNoteIds: ReadonlySet<string>;
  onToggleNoteLock: () => void;

  draftEntries: DraftJournalEntry[];
  onRestoreDraft: (entry: DraftJournalEntry) => void;
  onDiscardDraft: (noteId: string) => void;
  onCloseDrafts: () => void;

  searchPanelOpen: boolean;
  searchPanelQuery: string;
  onOpenNoteFromSearch: (id: string, query: string) => void;
  onCloseSearch: () => void;

  trashOpen: boolean;
  onCloseTrash: () => void;
  onTrashChanged: () => void;
  onTrashRestored: () => void;

  historyOpen: boolean;
  historyNoteId: string | null;
  onCloseHistory: () => void;
  onHistoryRestored: (restoredId: string) => void;

  syncToast: SyncToastData | null;
  syncAnchorRect: DOMRect | null;
  onCloseSyncToast: () => void;

  settingsOpen: boolean;
  settingsCategory: SettingsCategory;
  settings: AppSettings;
  onCloseSettings: () => void;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onS3SettingsChanged: (next: S3Settings) => void;
  onSyncSettingsChanged: (next: { enabled: boolean }) => void;
}

export function DesktopOverlays(props: DesktopOverlaysProps) {
  const {
    confirmDelete, onConfirmDelete, onCancelDelete,
    workspaceMenuOpen, wsMenuWrapRef, workspaceMenuRef, moreMenuWrapRef, moreMenuRef, topMenuOpen,
    onOpenSettingsFromMenu, onOpenTrashFromMenu,
    focusMode, onToggleFocusMode, activeNoteId, lockedNoteIds, onToggleNoteLock,
    draftEntries, onRestoreDraft, onDiscardDraft, onCloseDrafts,
    searchPanelOpen, searchPanelQuery, onOpenNoteFromSearch, onCloseSearch,
    trashOpen, onCloseTrash, onTrashChanged, onTrashRestored,
    historyOpen, historyNoteId, onCloseHistory, onHistoryRestored,
    syncToast, syncAnchorRect, onCloseSyncToast,
    settingsOpen, settingsCategory, settings, onCloseSettings, onSettingsChange,
    onS3SettingsChanged, onSyncSettingsChanged,
  } = props;

  return (
    <>
      {confirmDelete && (
        <ConfirmDelete node={confirmDelete}
          onConfirm={() => { const id = confirmDelete.id; onCancelDelete(); onConfirmDelete(id); }}
          onCancel={onCancelDelete} />
      )}
      {/* 顶栏下拉用 portal 渲染到 body 根部，避免被 app-shell 内部堆叠上下文/overflow 覆盖 */}
      {workspaceMenuOpen && createPortal(
        <div ref={workspaceMenuRef} className="top-menu top-menu--workspace" role="menu" aria-label="工作空间"
          style={(() => {
            const rect = wsMenuWrapRef.current?.getBoundingClientRect();
            return rect ? clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 180, height: 88 }, 6) : undefined;
          })()}>
          <button role="menuitem" onClick={() => onOpenSettingsFromMenu("editor")}><Settings2Icon size={15} />偏好设置</button>
          <button role="menuitem" onClick={onOpenTrashFromMenu}><Trash2 size={15} />回收站</button>
        </div>,
        document.body,
      )}
      {topMenuOpen && createPortal(
        <div ref={moreMenuRef} className="top-menu top-menu--more" role="menu" aria-label="文档操作"
          style={(() => {
            const rect = moreMenuWrapRef.current?.getBoundingClientRect();
            return rect ? clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 180, height: 150 }, 6) : undefined;
          })()}>
          <button role="menuitem" aria-checked={focusMode} onClick={onToggleFocusMode}>
            <Focus size={15} /><span>{focusMode ? "退出专注模式" : "进入专注模式"}<small>⌘⇧Enter</small></span>
          </button>
          {activeNoteId && (
            <button role="menuitem" onClick={onToggleNoteLock}>
              {lockedNoteIds.has(activeNoteId) ? <Lock size={15} /> : <LockOpen size={15} />}
              <span>{lockedNoteIds.has(activeNoteId) ? "解锁当前文档" : "锁定当前文档（只读）"}</span>
            </button>
          )}
        </div>,
        document.body,
      )}
      <DraftRecoveryDialog entries={draftEntries} onRestore={onRestoreDraft} onDiscard={onDiscardDraft} onClose={onCloseDrafts} />
      <SearchPanel open={searchPanelOpen} initialQuery={searchPanelQuery} onOpenNote={onOpenNoteFromSearch} onClose={onCloseSearch} />
      <TrashPanel open={trashOpen} onClose={onCloseTrash} onChanged={onTrashChanged} onRestored={onTrashRestored} />
      <HistoryPanel open={historyOpen} noteId={historyNoteId} onClose={onCloseHistory} onRestored={onHistoryRestored} />
      {syncToast && <SyncToast data={syncToast} onClose={onCloseSyncToast} anchorRect={syncAnchorRect} />}
      <SettingsPanel open={settingsOpen} openCategory={settingsCategory} settings={settings}
        onClose={onCloseSettings} onChange={onSettingsChange}
        onS3SettingsChanged={onS3SettingsChanged} onSyncSettingsChanged={onSyncSettingsChanged} />
    </>
  );
}
