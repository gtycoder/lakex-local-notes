/** 桌面顶栏（§20 Phase C 收尾：topBarLeading 与右侧搜索钮从 App.tsx 移出）。
 *  260922 S1+A：工作空间钮内嵌「当前空间」图标（18px 软底），点开合一菜单（空间 + 工作空间）。 */
import { Check, ChevronDown, Columns2, Feather, FileSearch, Files, Paperclip, Search, Settings, Trash } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type Ref, type RefObject } from "react";
import { Menu } from "../components/ui/Overlay";
import { usePopoverPosition } from "../hooks/usePopoverPosition";
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
  onOpenNote: (noteId: string) => void;
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
    onToggleWorkspaceMenu, onSync, onOpenSettings, onOpenHistory, onOpenNote,
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
        onOpenNote={onOpenNote}
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
export interface DesktopTopBarFindProps {
  /** 打开当前文档的内核查找替换面板（无可用实例时为安全 no-op）。 */
  onOpenFind: () => void;
  disabled?: boolean;
}

/** 顶栏右侧：**文档内查找**（内核自带的查找替换面板；桌面热键 ⌘F）。
 *  与「全文搜索」（库级 FTS，另一个按钮）是两件事，故并列两个入口、图标与标题都区分开。 */
export function DesktopTopBarFind(props: DesktopTopBarFindProps) {
  const { onOpenFind, disabled = false } = props;
  return (
    <button
      className="toolbar__item"
      disabled={disabled}
      onClick={() => { onOpenFind(); }}
      title="文档内查找（⌘F）"
      aria-label="文档内查找"
    >
      <FileSearch size={15} />
    </button>
  );
}

export interface DesktopSplitButtonProps {
  /** 已打开的标签（标题 + 类型图标展示用）。 */
  openTabs: Array<{ noteId: string; title: string; kind?: string }>;
  activeNoteId: string | null;
  /** 已经在分屏中：点击 = 直接取消分屏（快捷；右栏右上角菜单里也有同一项）。 */
  splitActive: boolean;
  onEnterSplit: (noteId: string) => void;
  onExitSplit: () => void;
}

/** 顶栏右侧：文档分屏入口（左右两栏、最多两个、不同文档、临时不持久化）。
 *  未分屏时点开列出**除当前标签外**的已打开标签；已分屏时点击直接取消。 */
export function DesktopSplitButton({ openTabs, activeNoteId, splitActive, onEnterSplit, onExitSplit }: DesktopSplitButtonProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const { surfaceRef, style } = usePopoverPosition({ open, anchor: btnRef.current, align: "end" });
  /** Menu 是 portal 到 body 的：outside-dismiss 必须把浮层表面也算「里面」，否则真实鼠标 pointerdown 会先把菜单关掉、选择被吞。 */
  const setMenuRef = useCallback((el: HTMLElement | null) => { menuRef.current = el; surfaceRef(el); }, [surfaceRef]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-split-menu]") && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const candidates = openTabs.filter((t) => t.noteId !== activeNoteId);
  return (
    <span className="split-entry" data-split-menu>
      <button
        ref={btnRef}
        type="button"
        className="toolbar__item"
        disabled={!splitActive && candidates.length === 0}
        onClick={() => {
          if (splitActive) { setOpen(false); onExitSplit(); return; }
          setOpen((o) => !o);
        }}
        title={splitActive ? "分屏选项（点击取消分屏）" : "分屏：从右侧选择一个已打开的标签"}
        aria-label="分屏"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Columns2 size={15} />
      </button>
      {open && (
        <Menu surfaceClassName="tab-switcher-menu" label="选择分屏标签" onDismiss={() => setOpen(false)} surfaceRef={setMenuRef} style={style ?? undefined}>
          <div className="tab-switcher-heading"><strong>选择右侧标签</strong><span>{candidates.length}</span></div>
          <div className="tab-switcher-list">
            {candidates.map((t) => (
              <button
                key={t.noteId}
                type="button"
                className="tab-switcher-select"
                onClick={() => { onEnterSplit(t.noteId); setOpen(false); }}
                title={t.title || "无标题"}
              >
                <span className="tab-switcher-title ln-ellipsis">{t.title || "无标题"}</span>
              </button>
            ))}
          </div>
        </Menu>
      )}
    </span>
  );
}
