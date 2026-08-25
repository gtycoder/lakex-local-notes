/** 桌面左侧 activity rail（§20 Phase C 收尾：资料库/小记切换 + 侧栏 dock）。 */
import { Files, Feather } from "lucide-react";

export interface DesktopActivityRailProps {
  desktopWorkspace: "library" | "quick-notes";
  sidebarMode: "docked" | "floating" | "collapsed";
  onToggleSidebarDock: () => void;
  onSwitchWorkspace: (workspace: "library" | "quick-notes") => void;
  onPreviewEnter: (() => void) | undefined;
  onPreviewLeave: (() => void) | undefined;
}

export function DesktopActivityRail(props: DesktopActivityRailProps) {
  const { desktopWorkspace, sidebarMode, onToggleSidebarDock, onSwitchWorkspace, onPreviewEnter, onPreviewLeave } = props;
  return (
    <nav className="activity-rail desktop-only" aria-label="应用导航"
      onPointerEnter={desktopWorkspace === "library" ? onPreviewEnter : undefined}
      onPointerLeave={desktopWorkspace === "library" ? onPreviewLeave : undefined}>
      <div className="activity-rail-spacer" />
      <button className={`activity-button ${desktopWorkspace === "library" && sidebarMode === "docked" ? "active" : ""}`}
        onClick={() => { if (desktopWorkspace === "library") onToggleSidebarDock(); else onSwitchWorkspace("library"); }}
        title="资料库" aria-label="资料库"><Files size={16} /></button>
      <button className={`activity-button ${desktopWorkspace === "quick-notes" ? "active" : ""}`}
        onClick={() => onSwitchWorkspace("quick-notes")} title="小记" aria-label="小记"><Feather size={16} /></button>
      <div className="activity-rail-fill" />
    </nav>
  );
}
