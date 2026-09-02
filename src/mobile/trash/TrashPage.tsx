/** 移动端回收站页（Phase B2）。复用桌面 TrashPanel 语义：列表 + 恢复（根节点整棵）/彻底删除。 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FolderOpen, FileText, RotateCcw, Trash2 } from "lucide-react";
import { bridge } from "../bridge";

export interface TrashItemUI {
  id: string;
  title: string;
  kind: "folder" | "note";
  parentId: string | null;
  deletedAt: string | null;
}

export interface TrashPageProps {
  onBack: () => void;
  onChanged: () => Promise<void>;
  /** 点击回收站文档行 → 只读预览（回收站资源惰性下载补偿）。文件夹不可直接预览。 */
  onPreview: (noteId: string) => void;
}

export function TrashPage(props: TrashPageProps) {
  const { onBack, onChanged, onPreview } = props;
  const [items, setItems] = useState<TrashItemUI[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const all = await bridge.listTrashTree();
    // 仅显示根级回收站项（子级随根恢复/删除，对齐桌面 TrashPanel"仅根节点可恢复"语义）
    const trashIds = new Set(all.map((it) => it.id));
    setItems(all.filter((it) => !(it.parentId && trashIds.has(it.parentId))));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const restore = async (item: TrashItemUI) => {
    try {
      await bridge.restoreTreeItem(item.id, item.kind);
      setMsg("已恢复（同步后传播到其他设备）");
      await load();
      await onChanged();
    } catch (e) {
      setMsg("恢复失败: " + (e as Error).message);
    }
  };

  const purge = async (item: TrashItemUI) => {
    if (!window.confirm("彻底删除「" + item.title + "」？此操作不可撤销（其他设备同步后也会删除）。")) return;
    try {
      await bridge.purgeTreeItem(item.id, item.kind);
      setMsg("已彻底删除");
      await load();
      await onChanged();
    } catch (e) {
      setMsg("删除失败: " + (e as Error).message);
    }
  };

  return (
    <div className="mobile-notebook">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <div className="mobile-topbar-title">回收站</div>
        <div style={{ width: 36 }} />
      </header>
      {msg && <div className="mobile-status-msg">{msg}</div>}
      <div className="mobile-scroll">
        {items.length === 0 && <div className="mobile-empty">回收站为空</div>}
        {items.map((it) => (
          <div
            key={it.kind + "-" + it.id}
            className="mobile-doc-row"
            onClick={() => { if (it.kind === "note") onPreview(it.id); }}
            style={it.kind === "note" ? { cursor: "pointer" } : undefined}
            title={it.kind === "note" ? "点击预览内容" : ""}
          >
            {it.kind === "folder" ? <FolderOpen size={18} /> : <FileText size={18} />}
            <span className="mobile-trash-title">{it.title}</span>
            <span className="mobile-trash-date">{it.deletedAt ? it.deletedAt.slice(0, 10) : ""}</span>
            <button className="mobile-trash-action" onClick={(e) => { e.stopPropagation(); void restore(it); }} title="恢复"><RotateCcw size={16} /></button>
            <button className="mobile-trash-action mobile-trash-danger" onClick={(e) => { e.stopPropagation(); void purge(it); }} title="彻底删除"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
