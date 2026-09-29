/** 移动端「总回收站」列表（设置→回收站）。
 * 小记回收站并入总回收站：合并展示笔记/文件夹回收站（listTrashTree）与小记回收站（listQuickNoteTrash），
 * 按 deletedAt 倒序；支持恢复（同步后传播）/彻底删除；笔记行点击可预览。 */
import { useCallback, useEffect, useState } from "react";
import { Feather, FolderOpen, File, RotateCcw, Trash } from "lucide-react";
import { bridge } from "../bridge";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";

export interface TrashRow {
  key: string;
  id: string;
  title: string;
  kind: "note" | "folder" | "quick";
  deletedAt: string;
}

export interface TrashListProps {
  title?: string;
  /** 数据发生变化（恢复/删除）后刷新外部（如首页/工作区列表）。 */
  onChanged: () => Promise<void>;
  /** 点击笔记行 → 只读预览（回收站资源惰性下载补偿）。文件夹/小记不可预览。 */
  onPreview: (noteId: string) => void;
}

const IconFor = (k: TrashRow["kind"]) => (k === "folder" ? FolderOpen : k === "quick" ? Feather : File);

export function TrashList({ title, onChanged, onPreview }: TrashListProps) {
  const [rows, setRows] = useState<TrashRow[]>([]);

  const load = useCallback(async () => {
    const [tree, quick] = await Promise.all([bridge.listTrashTree(), bridge.listQuickNoteTrash()]);
    // 仅根级（子级随根恢复/删除，对齐桌面 TrashPanel「仅根节点可恢复」语义）
    const trashIds = new Set(tree.map((it) => it.id));
    const noteRows: TrashRow[] = tree
      .filter((it) => !(it.parentId && trashIds.has(it.parentId)))
      .map((it) => ({ key: "t-" + it.id, id: it.id, title: it.title, kind: it.kind === "folder" ? "folder" : "note", deletedAt: it.deletedAt ?? "" }));
    const quickRows: TrashRow[] = quick.map((r) => ({ key: "q-" + r.id, id: r.id, title: r.previewText || "（空白小记）", kind: "quick", deletedAt: r.deletedAt }));
    setRows([...noteRows, ...quickRows].sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || "")));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const restore = async (row: TrashRow) => {
    try {
      if (row.kind === "quick") await bridge.restoreQuickNote(row.id);
      else await bridge.restoreTreeItem(row.id, row.kind === "folder" ? "folder" : "note");
      showToast("已恢复（同步后传播到其他设备）");
      await load();
      await onChanged();
    } catch (e) {
      showToast("恢复失败：" + (e as Error).message, { type: "error" });
    }
  };

  const purge = async (row: TrashRow) => {
    const ok = await confirmMobile({ title: "彻底删除？", body: "「" + row.title + "」不可撤销（其他设备同步后也会删除）。", confirmText: "彻底删除", danger: true });
    if (!ok) return;
    try {
      if (row.kind === "quick") await bridge.purgeQuickNote(row.id);
      else await bridge.purgeTreeItem(row.id, row.kind === "folder" ? "folder" : "note");
      showToast("已彻底删除");
      await load();
      await onChanged();
    } catch (e) {
      showToast("删除失败：" + (e as Error).message, { type: "error" });
    }
  };

  return (
    <div className="mobile-trash-list">
      {rows.length === 0 && <div className="mobile-trash-empty">{title ? title : "回收站"}为空</div>}
      {rows.map((row) => {
        const Icon = IconFor(row.kind);
        const clickable = row.kind === "note";
        return (
          <div
            key={row.key}
            className="mobile-doc-row"
            onClick={() => { if (clickable) onPreview(row.id); }}
            style={clickable ? { cursor: "pointer" } : undefined}
            title={clickable ? "点击预览内容" : row.kind === "quick" ? "小记" : undefined}
          >
            <Icon size={18} />
            <span className="mobile-trash-title ln-ellipsis">{row.title}</span>
            <span className="mobile-trash-date">{row.deletedAt ? row.deletedAt.slice(0, 10) : ""}</span>
            <button className="mobile-trash-action" onClick={(e) => { e.stopPropagation(); void restore(row); }} title="恢复"><RotateCcw size={16} /></button>
            <button className="mobile-trash-action mobile-trash-danger" onClick={(e) => { e.stopPropagation(); void purge(row); }} title="彻底删除"><Trash size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}
