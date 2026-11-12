import { Download, FilePlus } from "lucide-react";
import { Menu, Submenu } from "../../ui/Overlay";
import { usePopoverPosition } from "../../../hooks/usePopoverPosition";
import type { ImportPickerKind } from "../../../lib/types";
import { CreateChildItems, type CreateChildKind } from "./CreateChildItems";

/** 目录行「＋」的快捷「新建」菜单：锚在该行按钮上，定位走 usePopoverPosition（贴底翻转）。
 *  261106：末尾加「导入」子菜单（Markdown 多选），目标 = 触发 + 的笔记本/分组。
 *  261106 task-91：「Markdown 文件夹…」入口已删除（多选文件已覆盖，目录入口冗余）。 */
export function CreateMenu({ anchor, onNewChild, importTarget, onImport, onClose }: {
  anchor: HTMLElement;
  onNewChild: (kind: CreateChildKind) => void;
  /** 导入目标父级（最近容器）；null = 根级且没有所属笔记本 ⇒ 禁用并提示。 */
  importTarget: string | null;
  onImport: (targetId: string, kind: ImportPickerKind) => void;
  onClose: () => void;
}) {
  const { surfaceRef, style } = usePopoverPosition({ open: true, anchor, gap: 4, margin: 8 });
  return (
    <Menu surfaceClassName="context-menu" onDismiss={onClose} surfaceRef={surfaceRef} style={style ?? { visibility: "hidden" }}>
      <CreateChildItems onNewChild={onNewChild} onClose={onClose} />
      <div className="context-menu-sep" role="separator" />
      {importTarget ? (
        <Submenu label={<><Download size={15} aria-hidden="true" /><span>导入</span></>}>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onImport(importTarget, "markdown"); onClose(); }}><FilePlus size={15} aria-hidden="true" /><span>Markdown…</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onImport(importTarget, "docx"); onClose(); }}><FilePlus size={15} aria-hidden="true" /><span>Word（.docx）…</span></button>
          <div className="context-menu-sep" role="separator" />
          <button className="ln-menu__item" role="menuitem" onClick={() => { onImport(importTarget, "xlsx"); onClose(); }}><FilePlus size={15} aria-hidden="true" /><span>Excel（.xlsx）…</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onImport(importTarget, "csv"); onClose(); }}><FilePlus size={15} aria-hidden="true" /><span>CSV（.csv）…</span></button>
        </Submenu>
      ) : (
        <button className="ln-menu__item" role="menuitem" disabled title="先选择一个笔记本或分组"><Download size={15} aria-hidden="true" /><span>导入（先选择笔记本）</span></button>
      )}
    </Menu>
  );
}
