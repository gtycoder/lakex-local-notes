/** 桌面顶栏（§20 Phase C 收尾：topBarLeading/topBarTrailing 从 App.tsx 移出）。 */
import { ChevronDown, Moon, Sun } from "lucide-react";
import type { Ref, RefObject } from "react";
import { SyncStatusPopover } from "../components/SyncStatusPopover";
import type { SyncStatus, SyncPendingSummary } from "../lib/types";

export interface DesktopTopBarLeadingProps {
  workspaceName: string;
  wsMenuWrapRef?: RefObject<HTMLDivElement>;
  syncBtnRef?: RefObject<HTMLButtonElement>;
  visible?: boolean;
  sync: SyncStatus;
  pendingSummary: SyncPendingSummary;
  cloudEnabled: boolean;
  conflictSnapshots: Array<{ noteId: string; title: string }>;
  onToggleWorkspaceMenu: () => void;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenHistory: (noteId: string) => void;
}

/** 顶栏左侧：工作空间（下拉：设置/回收站）+ 云同步状态。 */
export function DesktopTopBarLeading(props: DesktopTopBarLeadingProps) {
  const {
    workspaceName, wsMenuWrapRef, syncBtnRef, visible = true, sync,
    pendingSummary, cloudEnabled, conflictSnapshots,
    onToggleWorkspaceMenu, onSync, onOpenSettings, onOpenHistory,
  } = props;
  return (
    <>
      <div className="toolbar__menu-wrap" data-top-menu-trigger="workspace" ref={wsMenuWrapRef as Ref<HTMLDivElement> | undefined}>
        <button className="toolbar__item" onClick={onToggleWorkspaceMenu} title="工作空间" aria-label="工作空间">
          <span className="toolbar__text">{workspaceName}</span><ChevronDown size={13} />
        </button>
      </div>
      <SyncStatusPopover
        buttonRef={syncBtnRef}
        visible={visible}
        sync={sync}
        pendingDocuments={pendingSummary.documents}
        pendingFolders={pendingSummary.folders}
        pendingQuickNotes={pendingSummary.quickNotes}
        cloudEnabled={cloudEnabled}
        conflictSnapshots={conflictSnapshots}
        conflictSnapshotText={conflictSnapshots.length > 0 ? "检测到远端版本差异，已保留历史快照" : null}
        onSync={onSync}
        onOpenSettings={onOpenSettings}
        onOpenHistory={onOpenHistory}
      />
    </>
  );
}

export interface DesktopTopBarTrailingProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

/** 顶栏最右侧：外观模式（浅色/深色切换）。 */
export function DesktopTopBarTrailing(props: DesktopTopBarTrailingProps) {
  const { theme, onToggleTheme } = props;
  return (
    <button className="toolbar__item" onClick={onToggleTheme} title="外观模式（浅色/深色）" aria-label="外观模式">
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
