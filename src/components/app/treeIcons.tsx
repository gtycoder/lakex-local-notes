/** 目录节点图标（单一来源）：Sidebar 原目录树与「置顶」区共用，避免两套图标映射。 */
import { Book, Database, File, Folder, FolderOpen, PenLine, PenTool, Table } from "lucide-react";
import type { TreeNodeType } from "../../lib/types";
import { NodeIconGlyph } from "../ui/NodeIconGlyph";

export function nodeIcon(type: TreeNodeType, open: boolean, customIcon?: string | null, kind?: string) {
  if (customIcon) return <span className="tree-node-custom-icon"><NodeIconGlyph value={customIcon} /></span>;
  if (type === "notebook") return <Book size={16} />;
  if (type === "group") return open ? <FolderOpen size={16} /> : <Folder size={16} />;
  if (kind === "usheet") return <Table size={16} />;
  if (kind === "bitable") return <Database size={16} />;
  if (kind === "board") return <PenTool size={16} />;
  if (kind === "ink") return <PenLine size={16} />;
  return <File size={16} />;
}
