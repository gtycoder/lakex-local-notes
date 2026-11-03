import { Database, FilePlus, FolderOpen, FolderPlus, PenLine, PenTool, Plus, Table, X } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import { MobileNodeIconPicker } from "../ui/NodeIconPicker";
import { MobileSheet } from "../ui/MobileSheet";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { NoteInfoSheet } from "../ui/NoteInfoSheet";
import type { NotebookTab } from "./useNotebookTabs";
import type { NotebookTreeItem } from "./useNotebookTreeData";

/**
 * 工作区浮层宿主（261103 P9-5b 拆件，原 NotebookWorkspace 内联 JSX，未改行为/DOM）：
 * 「新建」清单 / 全屏标签列表(.model) / 笔记本切换 / 行菜单 / 属性 / 图标 / 历史版本。
 * 纯展示组件：开关状态、数据与动作全由 props 注入；互斥仍由父层的 useWorkspaceOverlays 单一 owner 保证
 * （本组件只负责“渲染 + 回调上抛”，不自己记任何浮层状态）。
 */
export interface WorkspaceOverlayHostProps {
  /** 目录「新建」清单（open = overlay.kind === "create"）。 */
  createOpen: boolean;
  onCreateSelect: (item: MobileSheetItem) => void;
  onCloseCreate: () => void;

  /** 全屏标签列表（.model，思源 #toolbarTabs → #model）。 */
  tabsOpen: boolean;
  tabs: NotebookTab[];
  activeId: string | null;
  /** 标签行的节点图标（父层按 itemById 提供；无图标返回 null）。 */
  tabIconOf: (id: string) => string | null;
  onOpenTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabs: () => void;
  /** 「打开文档」= 父层拉左目录（手机抽屉）。 */
  onOpenDocPicker: () => void;

  /** 笔记本切换（贴底 sheet 菜单）。 */
  notebookSwitchOpen: boolean;
  notebooks: TreeNode[];
  notebookId: string;
  onSwitchNotebook: (item: MobileSheetItem) => void;
  onCloseNotebookSwitch: () => void;

  /** 目录树行菜单。 */
  menuFor: NotebookTreeItem | null;
  treeMenuItemsFor: (node: NotebookTreeItem) => MobileSheetItem[];
  onTreeMenuSelect: (item: MobileSheetItem, path: MobileSheetItem[]) => void;
  onCloseMenu: () => void;

  /** 文档属性（长按 → 属性）。 */
  infoFor: NotebookTreeItem | null;
  onCloseInfo: () => void;
  onOpenHistoryFromInfo: (node: NotebookTreeItem) => void;

  /** 图标选择器（移动端原语 MobileSheet，类名/DOM 不变）。 */
  iconFor: NotebookTreeItem | null;
  onPickIcon: (node: NotebookTreeItem, icon: string | null) => void;
  onCloseIcon: () => void;

  /** 历史版本 sheet（正文类名 mb-list 逐字保留）。 */
  historyFor: NotebookTreeItem | null;
  historyList: Array<{ id: number; title: string; createdAt: string }>;
  onRestoreHistory: (id: number) => void;
  onDeleteHistory: (id: number) => void;
  onCloseHistory: () => void;
}

export function WorkspaceOverlayHost(props: WorkspaceOverlayHostProps) {
  const { createOpen, tabsOpen, tabs, activeId, notebookSwitchOpen, notebooks, notebookId, menuFor, infoFor, iconFor, historyFor, historyList } = props;
  return (
    <>
      {/* 目录抽屉「新建」（261014 用户点单）：**清单与桌面 Sidebar 的 CREATE_CHILD_ITEMS 同款同序**
          （文档 / 表格 / 多维表 / 画板 / 分组）。261020 起四类文档都有移动端编辑器（可直接新建并进入编辑），
          分组走目录树创建。不要在移动端建出"打不开的文档"。 */}
      <MobileSheetMenu
        open={createOpen}
        items={[
          { id: "note", label: "新建文档", icon: FilePlus },
          { id: "usheet", label: "新建表格", icon: Table },
          { id: "bitable", label: "新建多维表", icon: Database },
          { id: "board", label: "新建画板", icon: PenTool },
          { id: "ink", label: "新建手写板", icon: PenLine },
          { id: "group", label: "新建分组", icon: FolderPlus },
        ]}
        onClose={props.onCloseCreate}
        onSelect={(it) => props.onCreateSelect(it)}
      />

      {/* 全屏 tab 列表 (.model，思源 #toolbarTabs → #model) */}
      {tabsOpen && (
        <div className="mobile-model-mask" onClick={props.onCloseTabs}>
          <div className="mobile-model" onClick={(e) => e.stopPropagation()}>
            <div className="toolbar toolbar--border mobile-model-head">
              <span className="toolbar__text">标签页</span>
              {tabs.length > 0 && (
                <button className="mobile-model-closeall" onClick={props.onCloseAllTabs} aria-label="关闭全部标签页">关闭全部</button>
              )}
              <span className="toolbar__icon" role="button" tabIndex={0} onClick={props.onCloseTabs} aria-label="关闭"><X /></span>
            </div>
            <div className="mobile-model-body">
              {tabs.length === 0 && <div className="mb-empty">暂无打开的文档</div>}
              {tabs.map((t) => (
                <div key={t.id} className={"mb-row" + (t.id === activeId ? " is-selected" : "")} onClick={() => props.onOpenTab(t.id)}>
                  {props.tabIconOf(t.id) && <span className="mb-tree-icon"><MobileNodeIconGlyph value={props.tabIconOf(t.id)} /></span>}
                  <span className="mb-row__title">{t.title || "无标题"}</span>
                  <button className="mb-iconbtn mb-row__action" onClick={(e) => { e.stopPropagation(); props.onCloseTab(t.id); }} aria-label="关闭"><X size={16} /></button>
                </div>
              ))}
              <button className="mb-btn mb-btn--secondary model-add" onClick={props.onOpenDocPicker}><Plus size={16} />打开文档</button>
            </div>
          </div>
        </div>
      )}

      {/* 笔记本切换（思源 sheet 菜单：贴底、56dvh、下钻即整屏平移） */}
      <MobileSheetMenu
        open={notebookSwitchOpen}
        items={notebooks.map((nb) => ({ id: nb.id, label: nb.title, icon: FolderOpen, note: nb.id === notebookId ? "当前" : undefined }))}
        onClose={props.onCloseNotebookSwitch}
        onSelect={(it) => props.onSwitchNotebook(it)}
      />

      {/* 目录树长按菜单 */}
      <MobileSheetMenu
        open={!!menuFor}
        items={menuFor ? props.treeMenuItemsFor(menuFor) : []}
        onClose={props.onCloseMenu}
        onSelect={props.onTreeMenuSelect}
      />

      {/* 文档属性（长按 → 属性） */}
      {infoFor && (
        <NoteInfoSheet
          noteFileId={infoFor.id}
          title={infoFor.title}
          onClose={props.onCloseInfo}
          onOpenHistory={() => props.onOpenHistoryFromInfo(infoFor)}
        />
      )}

      {/* 图标选择器（MOB-11：scrim / 右滑 / 返回栈 / 焦点 / 滚动锁交给 MobileSheet，类名与 DOM 不变） */}
      {iconFor && (
        <MobileSheet open title="设置图标" onClose={props.onCloseIcon}>
          <MobileNodeIconPicker key={iconFor.id} nodeType={iconFor.kind} value={iconFor.icon}
            onPick={(icon) => {
              const target = iconFor;
              if (!target) return;
              props.onPickIcon(target, icon);
            }} />
        </MobileSheet>
      )}

      {/* 历史版本 sheet（MOB-11：骨架交给 MobileSheet；正文类名 mb-list 逐字保留） */}
      {historyFor && (
        <MobileSheet open title="历史版本" bodyClassName="mb-list" onClose={props.onCloseHistory}>
          {historyList.length === 0 && <p className="mb-empty mb-empty--inset">暂无历史版本</p>}
          {historyList.map((h) => (
            <div key={h.id} className="mb-row" onClick={() => props.onRestoreHistory(h.id)}>
              <span className="mb-row__title">{h.title || "无标题"}</span>
              <span className="mb-row__meta">{new Date(h.createdAt).toLocaleString("zh-CN")}</span>
              <button className="mb-iconbtn mb-row__action" onClick={(e) => { e.stopPropagation(); props.onDeleteHistory(h.id); }} aria-label="删除"><X size={16} /></button>
            </div>
          ))}
        </MobileSheet>
      )}
    </>
  );
}
