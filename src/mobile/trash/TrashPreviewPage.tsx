/** 移动端回收站预览页（惰性下载补偿）：点开回收站文档先按需补拉缺失资源，再只读渲染 Lake 正文。
 * 只读 + 「恢复」操作；恢复走 restoreTreeItem（恢复前强拉全量，语义与桌面一致）。 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { bridge } from "../bridge";
import { LakeEditor } from "../../features/editor/LakeEditor";
import { loadSettings } from "../../lib/settings";

export interface TrashPreviewPageProps {
  noteId: string;
  onBack: () => void;
  onRestored: () => void;
}

export function TrashPreviewPage({ noteId, onBack, onRestored }: TrashPreviewPageProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      // 回收站惰性下载补偿：预览前按需补拉该笔记本地缺失资源（best-effort，失败仍显示本地内容）
      await bridge.ensureTrashNoteAssets(noteId).catch(() => undefined);
      const n = await bridge.readNote(noteId);
      if (n) { setTitle(n.title); setContent(n.content); }
    } catch (e) {
      setMsg("预览失败: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => { void load(); }, [load]);

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await bridge.restoreTreeItem(noteId, "note");
      onRestored();
    } catch (e) {
      setMsg("恢复失败: " + (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mobile-document">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <div className="mobile-topbar-title">{title || "回收站文档"}</div>
        <div className="mobile-topbar-actions">
          <button className="mobile-done-btn" onClick={() => void restore()} disabled={busy}>{busy ? "恢复中…" : "恢复"}</button>
        </div>
      </header>
      {msg && <div className="mobile-status-msg">{msg}</div>}
      <section className="mobile-doc-body">
        {loading ? (
          <div className="poc-center"><LoaderCircle className="spin" /><span>正在加载资源…</span></div>
        ) : (
          <LakeEditor
            noteId={noteId}
            content={content}
            mode="viewer"
            tocEnabled={false}
            onChange={() => undefined}
            prefs={{ fontSize: loadSettings().fontSize, showToolbar: false, disableVirtualRendering: true }}
          />
        )}
      </section>
    </div>
  );
}
