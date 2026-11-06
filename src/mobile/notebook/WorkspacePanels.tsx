import type { ReactNode } from "react";
import { ChevronLeft, ListChecks, Pin, PinOff, Plus } from "lucide-react";
import { OutlineSheet } from "../editor/OutlineSheet";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { SelectionActionBar, type SelectionAction } from "../ui/SelectionActionBar";
import { SelectionTopBar } from "../ui/SelectionTopBar";

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
  /** 多选模式（261106 task-8）：与手机抽屉同一套页头/底部条原语。 */
  selecting?: boolean;
  selectionCount?: number;
  selectionAllSelected?: boolean;
  canSelect?: boolean;
  onEnterSelect?: () => void;
  onCancelSelect?: () => void;
  onToggleAllSelect?: () => void;
  selectionActions?: readonly SelectionAction[];
  onSelectionAction?: (id: string) => void;
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
  const selecting = props.selecting ?? false;
  return (
    <aside
      className={"pad-tree" + (open ? " is-open" : "") + (open && pinned ? " pad-tree--pinned" : "")}
      aria-label="目录"
      aria-hidden={open ? undefined : "true"}
    >
      {selecting ? (
        <SelectionTopBar
          count={props.selectionCount ?? 0}
          allSelected={props.selectionAllSelected ?? false}
          onCancel={props.onCancelSelect ?? (() => undefined)}
          onToggleAll={props.onToggleAllSelect ?? (() => undefined)}
        />
      ) : (
        <div className="pad-tree__head">
          <span className="mb-tree-icon" aria-hidden="true">{nbIcon}</span>
          <span className="pad-tree__title">{title}</span>
          {/* 261106 task-8：文档多选入口（有可选文档时才出现）。平板页头是纯图标语言（宽度最小 240），
              这里用图标钮保持命中 44 且不挤标题；手机抽屉用文本「选择」（见 WorkspaceDrawers）。 */}
          {props.canSelect && (
            <button type="button" className="mb-iconbtn" aria-label="选择文档" title="选择" onClick={props.onEnterSelect}><ListChecks size={18} /></button>
          )}
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
      )}
      {list}
      {selecting && (
        <SelectionActionBar actions={props.selectionActions ?? []} onAction={props.onSelectionAction ?? (() => undefined)} />
      )}
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
