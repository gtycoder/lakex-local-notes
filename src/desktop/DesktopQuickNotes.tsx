/**
 * 桌面小记工作区装配（§20 Phase B：从 src/App.tsx 拆出）。
 */
import type { ReactNode, Ref, RefObject } from "react";
import { QuickNotesWorkspace, type QuickNotesWorkspaceHandle } from "../components/app/QuickNotesWorkspace";
import type { TreeNode } from "../lib/types";

export interface DesktopQuickNotesProps {
  notebooks: TreeNode[];
  /** 工作区级可见性（keep-alive：隐藏时不建内核实例，避免按 0 宽度算死工具条布局） */
  visible?: boolean;
  quickNotesRef: RefObject<QuickNotesWorkspaceHandle | null>;
  topbarLeading: ReactNode;
  onDirtyChange: (dirty: boolean) => void;
  onConverted: (note: import("../lib/types").NoteDocument) => void;
  /** 云同步可用（canTouchNetwork(cloudStateOf(...))）：false ⇒「保存并同步」置灰（判据在 App 里算，单一来源）。 */
  cloudReady?: boolean;
}

export function DesktopQuickNotes(props: DesktopQuickNotesProps) {
  const { notebooks, visible = true, quickNotesRef, topbarLeading, onDirtyChange, onConverted, cloudReady = true } = props;
  return (
    <>
      <header className="tab-bar desktop-only" aria-label="顶栏">
        <div className="tabbar-leading">{topbarLeading}</div>
      </header>
      <QuickNotesWorkspace ref={quickNotesRef as Ref<QuickNotesWorkspaceHandle>} notebooks={notebooks} visible={visible} cloudReady={cloudReady} onDirtyChange={onDirtyChange} onConverted={onConverted} />
    </>
  );
}
