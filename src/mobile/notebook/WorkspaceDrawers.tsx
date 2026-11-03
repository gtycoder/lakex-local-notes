import type { ReactNode } from "react";
import { Book, ChevronRight, Plus } from "lucide-react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { OutlineSheet } from "../editor/OutlineSheet";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";

/**
 * 手机侧抽屉（261103 P9-5b 拆件，原 NotebookWorkspace 内联 JSX，未改行为/DOM）：
 * 左目录抽屉（.side-panel--left，含笔记本行 + 工具栏「新建」/「收起」+ 树）+ 右大纲抽屉。
 * **只在手机渲染**：平板用 WorkspaceTreePanel / WorkspaceOutlinePanel（悬浮/可固定）；
 * 这里保留平板不渲染的判断交给父层（平板上本组件根本不挂载，与旧行为一致）。
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
}

export function WorkspaceDrawers(props: WorkspaceDrawersProps) {
  const { sidebarOpen, outlineOpen, title, nbIcon, renamingId, notebookId, renameValue, treeList, editor } = props;
  return (
    <>
      <div className={"side-mask" + (sidebarOpen ? " on" : "")} data-panel-mask="left" onClick={() => props.onOpenSidebar(false)} />
      <aside className={"side-panel side-panel--left" + (sidebarOpen ? " on" : "")} aria-label="目录">
        <div className="toolbar toolbar--border toolbar--dark" data-prevent-swipe>
          <div className="toolbar__scroll">
            {/* 笔记本自己也是一行（用户 261014）：**图标 + 标题**；图标可点 = 设置图标（桌面 .tree-row-icon 同款手势） */}
            <span className="mb-tree-icon" aria-hidden="true">{nbIcon ? <MobileNodeIconGlyph value={nbIcon} /> : <Book size={16} />}</span>
            {renamingId === notebookId ? (
              <input
                className="mb-input"
                autoFocus
                value={renameValue}
                onChange={(e) => props.onRenameChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={props.onRenameCommit}
                onKeyDown={(e) => { if (e.key === "Enter") props.onRenameCommit(); if (e.key === "Escape") props.onRenameCancel(); }}
              />
            ) : (
              <span className="toolbar__text">{title}</span>
            )}
          </div>
          {/* 笔记本这一层**不放** ⋮（用户 261014：抽屉里的编辑入口去掉，改到首页「知识库」长按卡片） */}
          {/* 261014 用户点单：目录栏加「新建」（桌面同款清单） */}
          <span className="toolbar__icon" role="button" tabIndex={0} onClick={props.onOpenCreate} aria-label="新建" title="新建"><Plus /></span>
          <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => props.onOpenSidebar(false)} aria-label="收起"><ChevronRight /></span>
        </div>
        {/* 树行 = 可见行扁平数组 + 视口窗口化（2000 节点时不一次挂 2000 个按钮，见 NotebookTreeList）。
            虚拟滚动下拖拽/长按仍靠行上的 data-node-id 与 .side-panel-body 命中（手指下的行必在窗口内）。
            平板时树挂在悬浮左栏（.pad-tree），抽屉不渲染第二份实例。 */}
        {treeList}
      </aside>
      <OutlineSheet side open={outlineOpen} editor={editor} onClose={props.onCloseOutline} />
    </>
  );
}
