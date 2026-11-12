import type { ReactNode } from "react";
import { Database, FilePlus, FolderPlus, PenLine, PenTool, Table } from "lucide-react";

/**
 * 「新建子项」的 kind（= Sidebar 的 CreateKind 去掉 notebook）。
 * 单一来源说明：Sidebar 的 CreateKind 覆盖七个一级 kind；此处只列「能作为子项创建」的六个。
 */
export type CreateChildKind = "group" | "note" | "usheet" | "bitable" | "board" | "ink";

/** 「新建子项」五个动作（单一来源：右键菜单「新建」子菜单 + 目录行「＋」快捷菜单共用）。 */
const CREATE_CHILD_ITEMS: ReadonlyArray<{ kind: CreateChildKind; label: string; icon: ReactNode }> = [
  { kind: "note", label: "新建文档", icon: <FilePlus size={15} /> },
  { kind: "usheet", label: "新建表格", icon: <Table size={15} /> },
  { kind: "bitable", label: "新建多维表", icon: <Database size={15} /> },
  { kind: "board", label: "新建画板", icon: <PenTool size={15} /> },
  { kind: "ink", label: "新建手写板", icon: <PenLine size={15} /> },
  { kind: "group", label: "新建分组", icon: <FolderPlus size={15} /> },
];

export function CreateChildItems({ onNewChild, onClose }: { onNewChild: (kind: CreateChildKind) => void; onClose: () => void }) {
  return (
    <>
      {CREATE_CHILD_ITEMS.map((item) => (
        <button className="ln-menu__item" key={item.kind} role="menuitem" onClick={() => { onNewChild(item.kind); onClose(); }}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </>
  );
}
