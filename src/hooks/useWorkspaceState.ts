import { useRef, useState } from "react";
import { createRequestVersion } from "../core/requestVersion";
import { loadSettings, type AppSettings } from "../lib/settings";
import { getWorkspaceDisplayName } from "../lib/workspaceName";
import type { DraftJournalEntry, NoteSummary, S3Settings, SyncPendingSummary, SyncStatus, TreeNode, WorkspaceSnapshot } from "../lib/types";
import type { OpenTab } from "../desktop/desktopTypes";
import type { QuickNotesWorkspaceHandle } from "../components/QuickNotesWorkspace";
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";

/** App 的文档/同步/设置数据状态与全局 ref（从 App.tsx 抽出，逐字搬移，纯状态容器）。 */
export function useWorkspaceState() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [conflictSnapshotNotice, setConflictSnapshotNotice] = useState<Array<{ noteId: string; title: string }>>([]);
  const [activeHistoryCount, setActiveHistoryCount] = useState(0);
  const [sync, setSync] = useState<SyncStatus>({ phase: "idle", message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 });
  const [cloudEnabled, setCloudEnabled] = useState(true);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [s3Settings, setS3Settings] = useState<S3Settings | null>(null);
  const [pendingSummary, setPendingSummary] = useState<SyncPendingSummary>({ documents: 0, folders: 0, resources: 0, quickNotes: 0, total: 0, generatedAt: "" });
  const [draftEntries, setDraftEntries] = useState<DraftJournalEntry[]>([]);
  const [syncAnchorRect, setSyncAnchorRect] = useState<DOMRect | null>(null);
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [pinnedNoteIds, setPinnedNoteIds] = useState<Set<string>>(() => new Set());
  const [quickNotesDirty, setQuickNotesDirty] = useState(false);

  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const wsMenuWrapRef = useRef<HTMLDivElement>(null);
  const moreMenuWrapRef = useRef<HTMLDivElement>(null);
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  const openTabsRef = useRef<OpenTab[]>([]);
  const quickNotesRef = useRef<QuickNotesWorkspaceHandle>(null);
  const tabReloadVersionRef = useRef(createRequestVersion());
  const editorsRef = useRef<Map<string, LakeEditorInstance>>(new Map());

  const workspaceName = getWorkspaceDisplayName(cloudEnabled, s3Settings);
  const tocEnabled = settings.showToc;
  const outlineEnhance = settings.outlineEnhance;
  const wideMode = true;

  return {
    workspace, setWorkspace, notes, setNotes, treeNodes, setTreeNodes, openTabs, setOpenTabs,
    activeNoteId, setActiveNoteId, search, setSearch, conflictSnapshotNotice, setConflictSnapshotNotice,
    activeHistoryCount, setActiveHistoryCount,
    workspaceMenuRef, moreMenuRef, wsMenuWrapRef, moreMenuWrapRef, syncBtnRef,
    sync, setSync, cloudEnabled, setCloudEnabled, cloudConfigured, setCloudConfigured,
    s3Settings, setS3Settings, workspaceName, pendingSummary, setPendingSummary, draftEntries, setDraftEntries,
    syncAnchorRect, setSyncAnchorRect, pendingRenameId, setPendingRenameId,
    settings, setSettings, pinnedNoteIds, setPinnedNoteIds, tocEnabled, outlineEnhance, wideMode,
    quickNotesDirty, setQuickNotesDirty, openTabsRef, quickNotesRef, tabReloadVersionRef, editorsRef,
  };
}
