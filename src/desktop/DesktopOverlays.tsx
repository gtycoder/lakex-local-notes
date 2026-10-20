/**
 * 桌面 Overlay 装配（§20 Phase B：从 src/App.tsx 尾部 JSX 拆出）。
 * 只负责渲染浮层：ConfirmDelete / 顶栏两个 portal 菜单 / 草稿恢复 / 搜索 / 回收站 / 历史 / 同步 toast / 设置。
 * 所有状态与回调由 App（或后续 useDesktopShell）注入，本组件不持有业务状态。
 */
import { Menu } from "../components/ui/Overlay";
import type { RefObject } from "react";
import { Focus, Lock, LockOpen, Sparkles } from "lucide-react";
import { ConfirmDelete } from "../components/app/Sidebar";
import { ExportSubmenuItem, type ExportFormat } from "../components/ui/ExportSubmenuItem";
import { DraftRecoveryDialog } from "../components/app/DraftRecoveryDialog";
import { SearchPanel } from "../components/app/SearchPanel";
import { TrashPanel } from "../components/app/TrashPanel";
import { HistoryPanel } from "../components/app/HistoryPanel";
import { SyncToast, type SyncToastData } from "../components/app/SyncToast";
import { SettingsPanel, type SettingsCategory } from "../components/app/SettingsPanel";
import { DesktopWorkspaceMenuItems } from "./DesktopTopBar";
import type { DesktopWorkspace } from "./desktopTypes";
import type { AppSettings } from "../lib/settings";
import type { DraftJournalEntry, S3Settings, TreeNode } from "../lib/types";
import { clampPopoverPosition } from "../hooks/topMenuPosition";

export interface DesktopOverlaysProps {
  confirmDelete: TreeNode | null;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;

  workspaceMenuOpen: boolean;
  onCloseWorkspaceMenu: () => void;
  wsMenuWrapRef: RefObject<HTMLDivElement>;
  workspaceMenuRef: RefObject<HTMLDivElement>;
  moreMenuWrapRef: RefObject<HTMLDivElement>;
  moreMenuRef: RefObject<HTMLDivElement>;
  topMenuOpen: boolean;
  desktopWorkspace: DesktopWorkspace;
  onSwitchWorkspace: (workspace: DesktopWorkspace) => void;
  onOpenSettingsFromMenu: (category: SettingsCategory) => void;

  focusMode: boolean;
  onToggleFocusMode: () => void;
  activeNoteId: string | null;
  /** 当前活动文档类型；导出菜单按类型区分（doc/usheet/bitable/board/ink），不再只对 doc 显示。 */
  activeKind: "doc" | "usheet" | "bitable" | "board" | "ink";
  lockedNoteIds: ReadonlySet<string>;
  onToggleNoteLock: () => void;
  /** 顶栏「更多」→ AI 助手（无选区也能用）。 */
  onOpenAiAssistant: () => void;
  /** 顶栏「更多」里的导出（与目录树右键「导出」子菜单同一套动作，作用于当前文档） */
  onExportAs: (format: ExportFormat) => void;
  onCopyMarkdown: () => void;
  onCopyPaths: () => void;
  /** 顶栏「更多」里点了动作后收起菜单（与目录树右键 onClose 同义） */
  onCloseTopMenu: () => void;

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
  onTrashRestored: (restoredId?: string) => void;
  /** 成页回收站（空间）：embed 布局与弹窗一致 */
  trashEmbed?: boolean;

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
  cloudConfigured: boolean;
  cloudEnabled: boolean;
}

export function DesktopOverlays(props: DesktopOverlaysProps) {
  const {
    confirmDelete, onConfirmDelete, onCancelDelete,
    workspaceMenuOpen, onCloseWorkspaceMenu, wsMenuWrapRef, workspaceMenuRef, moreMenuWrapRef, moreMenuRef, topMenuOpen,
    desktopWorkspace, onSwitchWorkspace,
    onOpenSettingsFromMenu,
    focusMode, onToggleFocusMode, activeNoteId, activeKind, lockedNoteIds, onToggleNoteLock, onOpenAiAssistant,
    onExportAs, onCopyMarkdown, onCopyPaths, onCloseTopMenu,
    draftEntries, onRestoreDraft, onDiscardDraft, onCloseDrafts,
    searchPanelOpen, searchPanelQuery, onOpenNoteFromSearch, onCloseSearch,
    trashOpen, onCloseTrash, onTrashChanged, onTrashRestored, trashEmbed = false,
    historyOpen, historyNoteId, onCloseHistory, onHistoryRestored,
    syncToast, syncAnchorRect, onCloseSyncToast,
    settingsOpen, settingsCategory, settings, onCloseSettings, onSettingsChange,
    onS3SettingsChanged, onSyncSettingsChanged, cloudConfigured, cloudEnabled,
  } = props;

  return (
    <>
      {confirmDelete && (
        <ConfirmDelete node={confirmDelete}
          onConfirm={() => { const id = confirmDelete.id; onCancelDelete(); onConfirmDelete(id); }}
          onCancel={onCancelDelete} />
      )}
      {/* 顶栏下拉用 portal 渲染到 body 根部，避免被 app-shell 内部堆叠上下文/overflow 覆盖 */}
      {workspaceMenuOpen && (
        <Menu surfaceClassName="top-menu top-menu--workspace" label="工作空间" onDismiss={onCloseWorkspaceMenu} surfaceRef={workspaceMenuRef}
          style={(() => {
            const rect = wsMenuWrapRef.current?.getBoundingClientRect();
            return rect ? clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 220, height: 260 }, 6) : undefined;
          })()}>
          <DesktopWorkspaceMenuItems
            desktopWorkspace={desktopWorkspace}
            onSwitchWorkspace={onSwitchWorkspace}
            onOpenSettings={() => onOpenSettingsFromMenu("editor")}
          />
        </Menu>
      )}
      {topMenuOpen && (
        <Menu surfaceClassName="top-menu top-menu--more" label="文档操作" onDismiss={onCloseTopMenu} surfaceRef={moreMenuRef}
          style={(() => {
            const rect = moreMenuWrapRef.current?.getBoundingClientRect();
            return rect ? clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 236, height: 200 }, 6) : undefined;
          })()}>
          <button role="menuitem" onClick={onOpenAiAssistant}>
            <Sparkles size={15} /><span>AI 助手<small>对话</small></span>
          </button>
          <button role="menuitem" aria-checked={focusMode} onClick={onToggleFocusMode}>
            <Focus size={15} /><span>{focusMode ? "退出专注模式" : "进入专注模式"}<small>⌘⇧Enter</small></span>
          </button>
          {activeNoteId && (
            <button role="menuitem" onClick={onToggleNoteLock}>
              {lockedNoteIds.has(activeNoteId) ? <Lock size={15} /> : <LockOpen size={15} />}
              <span>{lockedNoteIds.has(activeNoteId) ? "解锁当前文档" : "锁定当前文档（只读）"}</span>
            </button>
          )}
          {/* 导出：与目录树右键「导出」子菜单同一套动作（作用于当前文档），按 activeKind 区分菜单，见 ExportSubmenuItem */}
          {activeNoteId && (
            <ExportSubmenuItem
              kind={activeKind}
              onExportAs={onExportAs}
              onCopyMarkdown={onCopyMarkdown}
              onCopyPaths={onCopyPaths}
              onClose={onCloseTopMenu}
            />
          )}
        </Menu>
      )}
      <DraftRecoveryDialog entries={draftEntries} onRestore={onRestoreDraft} onDiscard={onDiscardDraft} onClose={onCloseDrafts} />
      <SearchPanel open={searchPanelOpen} initialQuery={searchPanelQuery} onOpenNote={onOpenNoteFromSearch} onClose={onCloseSearch} />
      {/* 弹窗形态：仅当非 embed 空间仍需浮层时；空间成页在 App 工作区渲染 */}
      {!trashEmbed && (
        <TrashPanel open={trashOpen} onClose={onCloseTrash} onChanged={onTrashChanged} onRestored={onTrashRestored} />
      )}
      <HistoryPanel open={historyOpen} noteId={historyNoteId} onClose={onCloseHistory} onRestored={onHistoryRestored} />
      {syncToast && <SyncToast data={syncToast} onClose={onCloseSyncToast} anchorRect={syncAnchorRect} />}
      <SettingsPanel open={settingsOpen} openCategory={settingsCategory} settings={settings}
        onClose={onCloseSettings} onChange={onSettingsChange}
        onS3SettingsChanged={onS3SettingsChanged} onSyncSettingsChanged={onSyncSettingsChanged}
        cloudConfigured={cloudConfigured} cloudEnabled={cloudEnabled} />
    </>
  );
}
