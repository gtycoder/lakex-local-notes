import type { ReactNode } from "react";
import { Book, ChevronRight, Plus } from "lucide-react";
import { TopBarIconButton } from "../ui/TopBarIconButton";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { OutlineSheet } from "../editor/OutlineSheet";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import { SelectionActionBar, type SelectionAction } from "../ui/SelectionActionBar";
import { SelectionTopBar } from "../ui/SelectionTopBar";

/**
 * 手机侧抽屉（261103 P9-5b 拆件，原 NotebookWorkspace 内联 JSX，未改行为/DOM）：
 * 左目录抽屉（.side-panel--left，含笔记本行 + 工具栏「新建」/「收起」+ 树）+ 右大纲抽屉。
 * **只在手机渲染**：平板用 WorkspaceTreePanel / WorkspaceOutlinePanel（悬浮/可固定）；
 * 这里保留平板不渲染的判断交给父层（平板上本组件根本不挂载，与旧行为一致）。
 *
 * 261106 task-8：抽屉页头加「选择」入口；选择模式下页头换成 SelectionTopBar
 * （取消 / 已选 N / 全选），树底部挂 SelectionActionBar（创建副本 / 移动… / 移入回收站）。
 * 复用列表页同一套多选原语，不新造第二套样式。
 */
export interface WorkspaceDrawersProps {
  sidebarOpen: boolean;
  outlineOpen: boolean;
  title: string;
  nbIcon: string | null;
  renamingId: string | null;
  notebookId: string;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  /** 目录树（父层与平板悬浮左栏共用同一份 NotebookTreeList）。 */
  treeList: ReactNode;
  onOpenSidebar: (open: boolean) => void;
  onOpenCreate: () => void;
  editor: LakeEditorInstance | null;
  onCloseOutline: () => void;
  /** 多选模式（261106 task-8）：true 时页头换成选择顶栏、树下方挂选择操作条。 */
  selecting?: boolean;
  selectionCount?: number;
  selectionAllSelected?: boolean;
  /** 当前可见行里是否有可选文档（没有就不显示「选择」入口）。 */
  canSelect?: boolean;
  onEnterSelect?: () => void;
  onCancelSelect?: () => void;
  onToggleAllSelect?: () => void;
  selectionActions?: readonly SelectionAction[];
  onSelectionAction?: (id: string) => void;
}

export function WorkspaceDrawers(props: WorkspaceDrawersProps) {
  const { sidebarOpen, outlineOpen, title, nbIcon, treeList, editor } = props;
  const selecting = props.selecting ?? false;
  return (
    <>
      <div className={"side-mask" + (sidebarOpen ? " on" : "")} data-panel-mask="left" onClick={() => props.onOpenSidebar(false)} />
      <aside className={"side-panel side-panel--left" + (sidebarOpen ? " on" : "") + (selecting ? " side-panel--selecting" : "")} aria-label="目录">
        {selecting ? (
          <SelectionTopBar
            count={props.selectionCount ?? 0}
            allSelected={props.selectionAllSelected ?? false}
            onCancel={props.onCancelSelect ?? (() => undefined)}
            onToggleAll={props.onToggleAllSelect ?? (() => undefined)}
          />
        ) : (
          <div className="toolbar toolbar--border toolbar--dark" data-prevent-swipe>
            <div className="toolbar__scroll">
              {/* 笔记本自己也是一行（用户 261014）：**图标 + 标题**；图标可点 = 设置图标（桌面 .tree-row-icon 同款手势） */}
              <span className="mb-tree-icon" aria-hidden="true">{nbIcon ? <MobileNodeIconGlyph value={nbIcon} /> : <Book size={16} />}</span>
              {/* v2（261107）：重命名改为弹窗（NameSheet），抽屉头只做展示。 */}
              <span className="toolbar__text">{title}</span>
            </div>
            {/* 笔记本这一层**不放** ⋮（用户 261014：抽屉里的编辑入口去掉，改到首页「知识库」长按卡片） */}
            {/* 261106 task-8：文档多选入口（有可选文档时才出现） */}
            {props.canSelect && (
              <button type="button" className="mb-btn mb-btn--ghost" aria-label="选择文档" onClick={props.onEnterSelect}>选择</button>
            )}
            {/* 261014 用户点单：目录栏加「新建」（桌面同款清单） */}
            <TopBarIconButton label="新建" icon={<Plus />} onClick={props.onOpenCreate} />
            <TopBarIconButton label="收起" icon={<ChevronRight />} onClick={() => props.onOpenSidebar(false)} />
          </div>
        )}
        {/* 树行 = 可见行扁平数组 + 视口窗口化（2000 节点时不一次挂 2000 个按钮，见 NotebookTreeList）。
            虚拟滚动下拖拽/长按仍靠行上的 data-node-id 与 .side-panel-body 命中（手指下的行必在窗口内）。
            平板时树挂在悬浮左栏（.pad-tree），抽屉不渲染第二份实例。 */}
        {treeList}
        {/* 选择操作条：抽屉是 flex 列 + 树可滚动 ⇒ 条贴抽屉底（不 fixed 到视口：抽屉 z-index 更高会盖住它）。 */}
        {selecting && (
          <SelectionActionBar overlay actions={props.selectionActions ?? []} onAction={props.onSelectionAction ?? (() => undefined)} />
        )}
      </aside>
      <OutlineSheet side open={outlineOpen} editor={editor} onClose={props.onCloseOutline} />
    </>
  );
}
