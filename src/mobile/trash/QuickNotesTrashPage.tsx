/**
 * 移动端小记回收站页（B：小记全同步闭环的 UI 半）。
 * 对齐桌面小记回收站语义：软删行列表 + 恢复（restore_pending → 同步 local-wins 覆盖墓碑）/彻底删除（墓碑继续传播）。
 * 图片随内容恢复（软删保留 content + 图片文件；墓碑携带图片由引擎保障）。
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Feather, RotateCcw, Trash2 } from "lucide-react";
import { bridge } from "../bridge";

export interface QuickTrashItemUI {
  id: string;
  previewText: string;
  deletedAt: string;
}

export interface QuickNotesTrashPageProps {
  onBack: () => void;
  onChanged: () => Promise<void>;
}

export function QuickNotesTrashPage(props: QuickNotesTrashPageProps) {
  const { onBack, onChanged } = props;
  const [items, setItems] = useState<QuickTrashItemUI[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const all = await bridge.listQuickNoteTrash();
    setItems(all.map((r) => ({ id: r.id, previewText: r.previewText, deletedAt: r.deletedAt })));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const restore = async (item: QuickTrashItemUI) => {
    try {
      await bridge.restoreQuickNote(item.id);
      setMsg("已恢复（同步后传播到其他设备）");
      await load();
      await onChanged();
    } catch (e) {
      setMsg("恢复失败: " + (e as Error).message);
    }
  };

  const purge = async (item: QuickTrashItemUI) => {
    if (!window.confirm("彻底删除这条小记？此操作不可撤销（其他设备同步后也会删除）。")) return;
    try {
      await bridge.purgeQuickNote(item.id);
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
        <div className="mobile-topbar-title">小记回收站</div>
        <div style={{ width: 36 }} />
      </header>
      {msg && <div className="mobile-status-msg">{msg}</div>}
      <div className="mobile-scroll">
        {items.length === 0 && <div className="mobile-empty">小记回收站为空</div>}
        {items.map((it) => (
          <div key={it.id} className="mobile-doc-row">
            <Feather size={18} />
            <span className="mobile-trash-title">{it.previewText || "（空白小记）"}</span>
            <span className="mobile-trash-date">{it.deletedAt.slice(0, 10)}</span>
            <button className="mobile-trash-action" onClick={() => void restore(it)} title="恢复"><RotateCcw size={16} /></button>
            <button className="mobile-trash-action mobile-trash-danger" onClick={() => void purge(it)} title="彻底删除"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
