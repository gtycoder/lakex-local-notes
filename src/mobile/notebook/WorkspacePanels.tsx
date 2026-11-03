import type { ReactNode } from "react";
import { ChevronLeft, Pin, PinOff, Plus } from "lucide-react";
import { OutlineSheet } from "../editor/OutlineSheet";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";

/**
 * 平板两侧栏（261103 P4 拆件）：左目录 + 右大纲。两者都是**常驻 DOM**、开合只切 class
 * （P1：状态保持/手势跟手）；closed/floating/pinned 由 shellModel 决定，本组件只渲染。
 * 手机不渲染这一层（抽屉仍在 NotebookWorkspace，`.side-panel` 只服务手机）。
 */
export interface WorkspaceTreePanelProps {
  open: boolean;
  pinned: boolean;
  title: string;
  nbIcon: ReactNode;
  list: ReactNode;
  onNew: () => void;
  onTogglePin: () => void;
  onClose: () => void;
}

export interface WorkspaceOutlinePanelProps {
  open: boolean;
  pinned: boolean;
  editor: LakeEditorInstance | null;
  onTogglePin: () => void;
  onClose: () => void;
}

export function WorkspaceTreePanel(props: WorkspaceTreePanelProps) {
  const { open, pinned, title, nbIcon, list } = props;
  return (
    <aside
      className={"pad-tree" + (open ? " is-open" : "") + (open && pinned ? " pad-tree--pinned" : "")}
      aria-label="目录"
      aria-hidden={open ? undefined : "true"}
    >
      <div className="pad-tree__head">
        <span className="mb-tree-icon" aria-hidden="true">{nbIcon}</span>
        <span className="pad-tree__title">{title}</span>
        <button className="mb-iconbtn" onClick={props.onNew} aria-label="新建" title="新建"><Plus size={18} /></button>
        {/* 固定 = 停靠进布局（可编辑空间随之收窄）；不固定 = 悬浮覆盖。 */}
        <button
          className={"mb-iconbtn" + (pinned ? " is-on" : "")}
          onClick={props.onTogglePin}
          aria-label={pinned ? "取消固定" : "固定目录"}
          title={pinned ? "取消固定（改回悬浮）" : "固定（停靠，占布局）"}
        >{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
        <button className="mb-iconbtn" onClick={props.onClose} aria-label="收起目录" title="收起目录"><ChevronLeft size={18} /></button>
      </div>
      {list}
    </aside>
  );
}

export function WorkspaceOutlinePanel(props: WorkspaceOutlinePanelProps) {
  return (
    <OutlineSheet
      rail
      open={props.open}
      pinned={props.open && props.pinned}
      onTogglePin={props.onTogglePin}
      editor={props.editor}
      onClose={props.onClose}
    />
  );
}
