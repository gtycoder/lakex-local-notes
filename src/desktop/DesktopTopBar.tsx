/** 桌面顶栏（§20 Phase C 收尾：topBarLeading 与右侧搜索钮从 App.tsx 移出）。
 *  260922 S1+A：工作空间钮内嵌「当前空间」图标（18px 软底），点开合一菜单（空间 + 工作空间）。 */
import { Check, ChevronDown, Feather, Files, Paperclip, Search, Settings, Trash } from "lucide-react";
import type { Ref, RefObject } from "react";
import { SyncStatusPopover } from "../components/SyncStatusPopover";
import type { DesktopWorkspace } from "./desktopTypes";
import type { SyncStatus, SyncPendingSummary } from "../lib/types";

export interface DesktopTopBarLeadingProps {
  desktopWorkspace: DesktopWorkspace;
  wsMenuWrapRef?: RefObject<HTMLDivElement>;
  syncBtnRef?: RefObject<HTMLButtonElement>;
  visible?: boolean;
  sync: SyncStatus;
  pendingSummary: SyncPendingSummary;
  cloudEnabled: boolean;
  cloudConfigured: boolean;
  conflictSnapshots: Array<{ noteId: string; title: string }>;
  onToggleWorkspaceMenu: () => void;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenHistory: (noteId: string) => void;
}

const SPACE_META: Record<DesktopWorkspace, { label: string; Icon: typeof Files }> = {
  library: { label: "资料库", Icon: Files },
  "quick-notes": { label: "小记", Icon: Feather },
  trash: { label: "回收站", Icon: Trash },
  resources: { label: "资源", Icon: Paperclip },
};

/** 顶栏左侧：当前空间（空间图标 + 名 + ▾；点开合一菜单）+ 存储/同步段。
 *  同一个悬浮弹窗（复用 SyncStatusPopover）：云同步已启用且配置有效 = 云端同步内容；
 *  否则 = 本地空间图标 + 「当前仅本地」内容 + 「去设置云同步」入口。 */
export function DesktopTopBarLeading(props: DesktopTopBarLeadingProps) {
  const {
    desktopWorkspace, wsMenuWrapRef, syncBtnRef, visible = true, sync,
    pendingSummary, cloudEnabled, cloudConfigured, conflictSnapshots,
    onToggleWorkspaceMenu, onSync, onOpenSettings, onOpenHistory,
  } = props;
  const space = SPACE_META[desktopWorkspace] ?? SPACE_META.library;
  return (
    <>
      <div className="toolbar__menu-wrap" data-top-menu-trigger="workspace" ref={wsMenuWrapRef as Ref<HTMLDivElement> | undefined}>
        <button className="toolbar__item toolbar__workspace" onClick={onToggleWorkspaceMenu}
          title={`空间：${space.label}`} aria-label="切换空间">
          <span className="toolbar__space-ico" aria-hidden="true"><space.Icon size={12} /></span>
          <span className="toolbar__text">{space.label}</span><ChevronDown size={13} />
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
        cloudConfigured={cloudConfigured}
        conflictSnapshots={conflictSnapshots}
        conflictSnapshotText={conflictSnapshots.length > 0 ? "检测到远端版本差异，已保留历史快照" : null}
        onSync={onSync}
        onOpenSettings={onOpenSettings}
        onOpenHistory={onOpenHistory}
      />
    </>
  );
}

export interface DesktopWorkspaceMenuProps {
  desktopWorkspace: DesktopWorkspace;
  onSwitchWorkspace: (workspace: DesktopWorkspace) => void;
  onOpenSettings: () => void;
}

/** 合一菜单条目（空间 ⊕ 工作空间）；由 DesktopOverlays 的 top-menu 渲染。 */
export function DesktopWorkspaceMenuItems({ desktopWorkspace, onSwitchWorkspace, onOpenSettings }: DesktopWorkspaceMenuProps) {
  // 用户 261006：上半「空间」只剩资料库/小记（带 ⌘1/⌘2）；回收站与资源下沉到「工作空间」，
  // 与偏好设置并列、且**都不再给快捷键**（⌘3 的绑定与提示一并去掉）。
  const spaces: Array<{ id: DesktopWorkspace; label: string; Icon: typeof Files; hint?: string }> = [
    { id: "library", label: "资料库", Icon: Files, hint: "⌘1" },
    { id: "quick-notes", label: "小记", Icon: Feather, hint: "⌘2" },
  ];
  const tools: Array<{ id: DesktopWorkspace; label: string; Icon: typeof Files }> = [
    { id: "trash", label: "回收站", Icon: Trash },
    { id: "resources", label: "资源", Icon: Paperclip },
  ];
  const renderItem = ({ id, label, Icon, hint }: { id: DesktopWorkspace; label: string; Icon: typeof Files; hint?: string }) => (
    <button key={id} role="menuitemradio" aria-checked={desktopWorkspace === id} onClick={() => onSwitchWorkspace(id)}>
      <Icon size={15} />
      <span>{label}{hint && <small>{hint}</small>}</span>
      {desktopWorkspace === id && <Check size={14} className="top-menu__check" aria-hidden="true" />}
    </button>
  );
  return (
    <>
      <div className="top-menu__label" role="presentation">空间</div>
      {spaces.map(renderItem)}
      <div className="top-menu__sep" role="separator" />
      <div className="top-menu__label" role="presentation">工作空间</div>
      {tools.map(renderItem)}
      <button role="menuitem" onClick={onOpenSettings}><Settings size={15} /><span>偏好设置</span></button>
    </>
  );
}

export interface DesktopTopBarSearchProps {
  onOpenSearch: () => void;
}

/** 顶栏最右侧：全文搜索（原在左侧工作空间下拉里；⇧⌘F 亦可）。外观切换见「偏好设置 → 外观」。 */
export function DesktopTopBarSearch(props: DesktopTopBarSearchProps) {
  const { onOpenSearch } = props;
  return (
    <button className="toolbar__item" onClick={onOpenSearch} title="全文搜索（⇧⌘F）" aria-label="全文搜索">
      <Search size={15} />
    </button>
  );
}
