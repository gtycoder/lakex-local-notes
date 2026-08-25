/**
 * 桌面小记工作区装配（§20 Phase B：从 src/App.tsx 拆出）。
 */
import type { ReactNode, Ref, RefObject } from "react";
import { QuickNotesWorkspace, type QuickNotesWorkspaceHandle } from "../components/QuickNotesWorkspace";
import type { TreeNode } from "../lib/types";

export interface DesktopQuickNotesProps {
  notebooks: TreeNode[];
  quickNotesRef: RefObject<QuickNotesWorkspaceHandle | null>;
  topbarLeading: ReactNode;
  topbarTrailing: ReactNode;
  onDirtyChange: (dirty: boolean) => void;
  onConverted: (note: import("../lib/types").NoteDocument) => void;
}

export function DesktopQuickNotes(props: DesktopQuickNotesProps) {
  const { notebooks, quickNotesRef, topbarLeading, topbarTrailing, onDirtyChange, onConverted } = props;
  return (
    <>
      <header className="tab-bar desktop-only" aria-label="顶栏">
        <div className="tabbar-leading">{topbarLeading}</div>
        <div className="tabbar-spacer" />
        <div className="tabbar-trailing">{topbarTrailing}</div>
      </header>
      <QuickNotesWorkspace ref={quickNotesRef as Ref<QuickNotesWorkspaceHandle>} notebooks={notebooks} onDirtyChange={onDirtyChange} onConverted={onConverted} />
    </>
  );
}
