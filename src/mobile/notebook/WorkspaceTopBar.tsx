import { ArrowLeft, Check, CloudUpload, Pencil, Plus, Search, X } from "lucide-react";
import type { NotebookTab } from "./useNotebookTabs";

/**
 * 工作区顶栏（261103 P4/P9 拆件）：平板 = 返回 + 文档页签条 + 查找/编辑/同步；
 * 手机 = 返回 + 可编辑标题 + 查找/编辑/同步（无页签条，多标签在胶囊「标签页」里）。
 * 纯展示组件：数据与动作全由 props 注入，不在组件里读 store/本地状态。
 */
export interface WorkspaceTopBarProps {
  padTwoPane: boolean;
  chromeHidden: boolean;
  title: string;
  active: NotebookTab | null;
  activeId: string | null;
  tabs: NotebookTab[];
  findOpen: boolean;
  onBack: () => void;
  onOpenTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onOpenTree: (open: boolean) => void;
  onToggleFind: () => void;
  onToggleEdit: () => void;
  onSync: () => void;
  /** 手机顶栏改名：父层负责 updateTab + 排自动保存（content 由父层取）。 */
  onRename: (id: string, title: string) => void;
  /** 标题只读（261110：日记条目标题只能是日期，**不允许改**）。 */
  titleReadOnly?: boolean;
}

const EDITABLE_KINDS = ["doc", "usheet", "bitable", "board", "ink"];

export function WorkspaceTopBar(props: WorkspaceTopBarProps) {
  const { padTwoPane, chromeHidden, title, active, activeId, tabs, findOpen } = props;
  const kind = active?.kind ?? "doc";
  const canEdit = !!active?.loaded && EDITABLE_KINDS.includes(kind);
  const autoHidden = !padTwoPane && chromeHidden;
  return (
    <header
      className={"toolbar toolbar--border mobile-topbar" + (autoHidden ? " mobile-topbar--auto-hidden" : "")}
      aria-hidden={autoHidden ? "true" : "false"}
    >
      {padTwoPane ? (
        <>
          <button className="toolbar__button" onClick={props.onBack} aria-label="返回知识库" title="返回知识库"><ArrowLeft /></button>
          {/* 平板：中 = 桌面式文档页签（关闭/新增就地完成，替代手机的全屏标签列表） */}
          <div className="pad-tabs" data-prevent-swipe>
            {tabs.map((t) => (
              <div key={t.id} className={"pad-tab" + (t.id === activeId ? " on" : "")}>
                {/* 261103 六批 A4：页签内小 ×（26/28）低于 44 Rule，而页签条是横滚容器、溢出会被裁，
                    扩命中盒做不到 ⇒ 关闭动作统一收到顶栏右侧那枚 44×44 按钮（关闭**当前**页签）。 */}
                <button className="pad-tab__main" onClick={() => props.onOpenTab(t.id)} title={t.title || "无标题"}>{t.title || "无标题"}</button>
              </div>
            ))}
            <button className="pad-tab-add" onClick={() => props.onOpenTree(true)} aria-label="打开文档" title="打开文档"><Plus size={16} /></button>
          </div>
          <div className="pad-topbar-actions">
            {/* 文档内查找：内核查找面板只随工具栏 search 挂载，手机没有；平板用同一套 MobileFindBar。 */}
            <button
              className={"toolbar__button" + (findOpen ? " toolbar__icon--active" : "")}
              onClick={props.onToggleFind}
              disabled={!active?.loaded || kind !== "doc"}
              aria-label="在文档中查找"
              title={kind !== "doc" ? "该文档类型不支持查找" : "在文档中查找"}
            ><Search /></button>
            <button
              className={"toolbar__button" + (active?.editing ? " toolbar__icon--active" : "")}
              onClick={props.onToggleEdit}
              disabled={!canEdit}
              aria-label={active?.editing ? "完成" : "编辑"}
              title={!canEdit ? "该文档类型在移动端只读" : active?.editing ? "完成" : "编辑"}
            >{active?.editing ? <Check /> : <Pencil />}</button>
            <button className="toolbar__button" onClick={props.onSync} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
            {/* 261103 六批 A4：关闭当前页签 —— toolbar__button 天生 44×44，满足 44 Rule；没有活动页签时禁用。 */}
            <button
              className="toolbar__button"
              onClick={() => { if (activeId) props.onCloseTab(activeId); }}
              disabled={!activeId}
              aria-label="关闭当前页签"
              title={activeId ? "关闭当前页签" : "没有打开的文档"}
            ><X size={18} strokeWidth={1.75} /></button>
          </div>
        </>
      ) : (
        <>
          <button className="toolbar__button" onClick={props.onBack} aria-label="返回"><ArrowLeft /></button>
          <input
            className={"toolbar__title" + (active?.editing && active.loaded ? "" : " toolbar__title--readonly")}
            value={active?.title ?? title}
            readOnly={!active?.editing || !active.loaded || props.titleReadOnly === true}
            title={props.titleReadOnly ? "日记标题就是日期，不能改" : undefined}
            placeholder={active ? "" : title}
            aria-label="文档标题"
            onChange={(e) => { if (activeId && active?.loaded) props.onRename(activeId, e.target.value); }}
          />
          {/* doc / 表格 / 数据表 / 画板 / 手写板都可编辑（261020 起数据表不再只读；各自一个专用 viewer/editor）。 */}
          <button
            className={"toolbar__button" + (active?.editing ? " toolbar__icon--active" : "")}
            onClick={props.onToggleEdit}
            disabled={!canEdit}
            aria-label={active?.editing ? "完成" : "编辑"}
            title={!canEdit ? "该文档类型在移动端只读" : active?.editing ? "完成" : "编辑"}
          >{active?.editing ? <Check /> : <Pencil />}</button>
          {/* 文档内查找（移动端）：内核查找面板在移动端不存在（工具栏插件被关），
              故入口收在这里、由 MobileFindBar 做 DOM 内查找；工作区胶囊是定稿四格、不放搜索。 */}
          <button
            className={"toolbar__button" + (findOpen ? " toolbar__icon--active" : "")}
            onClick={props.onToggleFind}
            disabled={!active?.loaded || kind !== "doc"}
            aria-label="在文档中查找"
            title={kind !== "doc" ? "该文档类型不支持查找" : "在文档中查找"}
          ><Search /></button>
          <button className="toolbar__button" onClick={props.onSync} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
        </>
      )}
    </header>
  );
}
