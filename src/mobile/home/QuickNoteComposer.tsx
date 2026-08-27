/**
 * 移动端小记 composer（新建/编辑共用）：textarea + 图片选择/预览/移除 + 保存/取消。
 * 图片字节经 bridge.saveQuickNoteWithImages 写 quick_note_assets BLOB（与正文/元数据同事务）；
 * 编辑时已有图片字节从 BLOB 读回（getQuickNoteImage），保存时全量重写。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, X } from "lucide-react";
import { bridge } from "../bridge";
import type { StoredQuickNoteImage } from "../../core/quickNoteModel.js";

export interface ComposerImage {
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
  url: string; // 预览 objectURL
}

export interface QuickNoteComposerProps {
  /** 编辑目标（已有小记 id + 内容）；null = 新建 */
  editNote?: { id: string; text: string; images: StoredQuickNoteImage[] } | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}

export function QuickNoteComposer({ editNote, onSaved, onCancel }: QuickNoteComposerProps) {
  const [text, setText] = useState(editNote?.text ?? "");
  const [existing, setExisting] = useState<ComposerImage[]>([]);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);

  /** Uint8Array → Blob（处理 TS5.7 泛型 ArrayBufferLike 与 BlobPart 不兼容：切片到独立 ArrayBuffer） */
  const toBlob = (bytes: Uint8Array, mimeType: string): Blob =>
    new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mimeType });
  const makeUrl = useCallback((bytes: Uint8Array, mimeType: string): string => {
    const url = URL.createObjectURL(toBlob(bytes, mimeType));
    urlsRef.current.push(url);
    return url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时统一释放 objectURL
  useEffect(() => () => {
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
  }, []);

  // 编辑态：从 BLOB 读回已有图片字节（保存用）；预览走 canonical URL 直显（本地 AssetServer
  // 服务 quick-notes/，与桌面一致），加载失败时 onError 回退 BLOB 字节的 objectURL
  useEffect(() => {
    if (!editNote) return;
    let alive = true;
    (async () => {
      const loaded: ComposerImage[] = [];
      for (const img of editNote.images) {
        try {
          const bytes = await bridge.getQuickNoteImage(editNote.id, img.filename);
          if (bytes && alive) {
            loaded.push({
              filename: img.filename,
              mimeType: img.mimeType,
              width: img.width,
              height: img.height,
              bytes,
              url: `http://127.0.0.1:19876/quick-notes/${editNote.id}/${encodeURIComponent(img.filename)}`,
            });
          }
        } catch { /* 单张读失败跳过 */ }
      }
      if (alive) setExisting(loaded);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editNote]);

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const candidates = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (candidates.length === 0) return;
    setError(null);
    const next: ComposerImage[] = [];
    for (const file of candidates) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let width: number | null = null;
        let height: number | null = null;
        try {
          const bmp = await createImageBitmap(new Blob([bytes], { type: file.type }));
          width = bmp.width;
          height = bmp.height;
          bmp.close();
        } catch { /* 解码失败仍可保存（宽高 null） */ }
        next.push({ filename: file.name, mimeType: file.type || "image/png", width, height, bytes, url: makeUrl(bytes, file.type || "image/png") });
      } catch (e) {
        setError("读取图片失败: " + (e as Error).message);
      }
    }
    if (next.length > 0) setImages((prev) => [...prev, ...next]);
  };

  const removeImage = (index: number): void => {
    const all = [...existing, ...images];
    const target = all[index];
    if (!target) return;
    URL.revokeObjectURL(target.url);
    const i = urlsRef.current.indexOf(target.url);
    if (i >= 0) urlsRef.current.splice(i, 1);
    if (index < existing.length) setExisting((prev) => prev.filter((_, k) => k !== index));
    else setImages((prev) => prev.filter((_, k) => k !== index - existing.length));
  };

  const save = async (): Promise<void> => {
    if (!text.trim() && images.length + existing.length === 0) { setError("请至少记录文字或一张图片"); return; }
    setSaving(true);
    setError(null);
    try {
      const all = [...existing, ...images].map((i) => ({ filename: i.filename, mimeType: i.mimeType, width: i.width, height: i.height, bytes: i.bytes }));
      const id = editNote ? editNote.id : crypto.randomUUID();
      await bridge.saveQuickNoteWithImages(id, text, all);
      await onSaved();
    } catch (e) {
      setError("保存失败: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mobile-qn-composer">
      <textarea
        className="mobile-qn-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="写下这一刻…"
        aria-label="小记正文"
      />
      {existing.length + images.length > 0 && (
        <div className="mobile-qn-images">
          {[...existing, ...images].map((img, i) => (
            <figure key={img.url} className="mobile-qn-img">
              <img
                src={img.url}
                alt={img.filename}
                onError={(e) => {
                  // canonical 加载失败（文件缺失）→ 回退 BLOB 字节 objectURL
                  const target = e.currentTarget;
                  if (target.src.startsWith("http://127.0.0.1:19876") && img.bytes) {
                    target.src = makeUrl(img.bytes, img.mimeType);
                  }
                }}
              />
              <button type="button" onClick={() => removeImage(i)} aria-label="移除图片"><X size={14} /></button>
            </figure>
          ))}
        </div>
      )}
      {error && <div className="mobile-qn-error">{error}</div>}
      <footer className="mobile-qn-actions">
        <label className="mobile-qn-add" title="添加图片">
          <ImagePlus size={18} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            multiple
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ""; }}
          />
        </label>
        <span className="mobile-qn-hint">可添加图片</span>
        <div className="mobile-qn-spacer" />
        <button type="button" className="mobile-qn-btn" onClick={onCancel} disabled={saving}>取消</button>
        <button type="button" className="mobile-qn-btn mobile-qn-primary" onClick={() => void save()} disabled={saving}>
          <Check size={15} />{saving ? "保存中…" : "保存"}
        </button>
      </footer>
    </div>
  );
}
