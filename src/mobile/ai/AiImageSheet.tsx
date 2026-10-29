/**
 * AI 资料图片选择器（261023 P2）：只列**当前会话资料集**里的图片。
 * 选中项以 `{noteId, filename}` 引用发送（原生读文件），缩略图用 readAssetPreview。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { pushBackHandler } from "../ui/backStack";
import { useSwipeToClose } from "../ui/useSwipeToClose";
import { bridge } from "../bridge";
import { AI_IMAGES_MAX, type AiPendingImage } from "./aiImages";

interface DocRef { id: string; title: string }
interface AssetItem { noteId: string; noteTitle: string; filename: string; mimeType: string; dataUrl?: string }

export interface AiImageSheetProps {
  open: boolean;
  docs: DocRef[];
  /** 已经选中的张数（叠加临时拍照图片时不能超过 10）。 */
  used: number;
  onConfirm: (images: AiPendingImage[]) => void;
  onClose: () => void;
}

export function AiImageSheet({ open, docs, used, onConfirm, onClose }: AiImageSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  useSwipeToClose(sheetRef, onClose, open);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const collected: AssetItem[] = [];
      for (const doc of docs) {
        try {
          const assets = await bridge.aiListNoteImages(doc.id);
          for (const asset of assets) collected.push({ noteId: doc.id, noteTitle: doc.title, filename: asset.filename, mimeType: asset.mimeType });
        } catch { /* 单篇失败跳过 */ }
      }
      if (cancelled) return;
      setItems(collected);
      setLoading(false);
      for (const item of collected) {
        void bridge.readAssetPreview(item.noteId, item.filename).then((preview) => {
          if (cancelled || !("dataUrl" in preview) || !preview.supported) return;
          setItems((prev) => prev.map((entry) => (entry.noteId === item.noteId && entry.filename === item.filename ? { ...entry, dataUrl: preview.dataUrl } : entry)));
        }).catch(() => undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [open, docs]);

  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, AssetItem[]>();
    for (const item of items) {
      const key = item.noteId;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.values()];
  }, [items]);

  if (!open) return null;

  const limit = AI_IMAGES_MAX - used;
  return (
    <>
      <div className="mb-scrim" data-prevent-swipe onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="mb-sheet ai-sheet" role="dialog" aria-modal="true" aria-label="资料里的图片" data-prevent-swipe>
        <div className="mb-sheet__head">
          <span className="mb-sheet__title">资料里的图片</span>
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onClose}>取消</button>
        </div>
        <div className="mb-sheet__body ai-sheet__body">
          {loading && <div className="mb-empty mb-empty--inset">读取中…</div>}
          {!loading && items.length === 0 && <div className="mb-empty mb-empty--inset">资料文档里没有可发送的图片</div>}
          {groups.map((group) => (
            <div key={group[0].noteId} className="ai-img-group">
              <div className="ai-img-group__title">《{group[0].noteTitle}》，{group.length} 张</div>
              <div className="ai-img-grid">
                {group.map((item) => {
                  const key = item.noteId + "/" + item.filename;
                  const on = selected.has(key);
                  return (
                    <button key={key} type="button" className={"ai-img-cell" + (on ? " is-on" : "")} aria-pressed={on}
                      onClick={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else if (next.size < limit) next.add(key);
                          return next;
                        });
                      }}>
                      {item.dataUrl ? <img src={item.dataUrl} alt="" /> : <span className="ai-img-cell__placeholder" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="ai-sheet__foot">
          <span className="ai-budget">已选 <b>{selected.size}</b> / {Math.max(0, limit)} 张（本轮最多 {AI_IMAGES_MAX} 张）</span>
          <button type="button" className="mb-btn mb-btn--primary" disabled={selected.size === 0}
            onClick={() => {
              const picked: AiPendingImage[] = [];
              for (const item of items) {
                const key = item.noteId + "/" + item.filename;
                if (!selected.has(key)) continue;
                picked.push({ id: key + "-" + Date.now(), kind: "asset", noteId: item.noteId, filename: item.filename, title: item.noteTitle, dataUrl: item.dataUrl });
              }
              onConfirm(picked);
            }}>添加</button>
        </div>
      </div>
    </>
  );
}
