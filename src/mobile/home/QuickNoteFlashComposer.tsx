/**
 * 闪念速记（长按桌面图标 / `lakenotes://quick-note` 深链进来的那条路径）—— **不挂 Lake 内核**的轻量速记框。
 *
 * 为什么单独做一个：挂内核的完整编辑器（`QuickNoteComposer` → `QuickNoteEditor`）冷启动要等内核 bundle +
 * 实例化（实测 ~1–2s），而"随手记一句"要的是秒开。这里就是一个 `textarea` + 图片按钮，形态对齐桌面端
 * **未展开**的小记写作卡，且**不可展开**（图片/待办/有序/无序/分割线那套富编辑是内核编辑器的能力）。
 *
 * 产出格式仍是内核可读的 Lake 正文，但**没有内核实例**：
 * - 内核**没有**"不建实例就把文本转成 Lake 正文"的能力 —— `setDocument('text/*')` 要一个编辑器实例、
 *   `markdownStream` 要一个阅读器实例（官方 docs/09，二者都依赖 DOM）—— 260920 核实；
 * - 因此正文走**无内核写入者唯一被认可的通道** `core/quickNoteModel.quickNoteBodyFromTextAndImages`
 *   → `core/lakeDocForm`（`<p>` + 图片 `<card>` 容器，**绝不产出裸 `<img>`**，见
 *   `docs/LAKE-CONTENT-WRITING.md` §1 ③）。它本就是移动端小记的写入口径
 *   （`quickNotesRepository.saveQuickNoteWithImages`），图片按 `quick-notes/{id}/` 落盘。
 *   ⇒ 之后在小记列表里点开，完整内核编辑器能正常打开并继续富编辑（两端互认）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, X } from "lucide-react";
import { bridge } from "../bridge";
import { successFeedback, warnFeedback } from "../ui/haptics";
import {
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
} from "../../core/quickNoteModel.js";

interface FlashImage {
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
  /** 预览用 objectURL（本地文件还没落盘）。 */
  url: string;
}

export interface QuickNoteFlashComposerProps {
  onSaved: () => Promise<void>;
  onCancel: () => void;
  /** 打开后是否自动聚焦并弹键盘（深链冷启动想要；从别处进来也可关掉）。 */
  autoFocus?: boolean;
}

export function QuickNoteFlashComposer({ onSaved, onCancel, autoFocus = true }: QuickNoteFlashComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<FlashImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const urlsRef = useRef<string[]>([]);

  // 卸载时释放预览 URL
  useEffect(() => () => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    setError(null);
    const next: FlashImage[] = [];
    for (const file of candidates) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const format = validateQuickNoteImageBytes(bytes);
        const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: format.mimeType });
        const bitmap = await createImageBitmap(blob);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        validateQuickNoteImageDimensions(dimensions);
        const url = URL.createObjectURL(blob);
        urlsRef.current.push(url);
        next.push({ filename: file.name, mimeType: format.mimeType, width: dimensions.width, height: dimensions.height, bytes, url });
      } catch (reason) {
        setError("图片读取失败: " + (reason as Error).message);
      }
    }
    if (next.length > 0) setImages((prev) => [...prev, ...next]);
  }, []);

  const removeImage = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target) {
        URL.revokeObjectURL(target.url);
        urlsRef.current = urlsRef.current.filter((url) => url !== target.url);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const save = async () => {
    const plain = text.trim();
    if (!plain && images.length === 0) {
      setError("写点什么，或加一张图片");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = crypto.randomUUID();
      await bridge.saveQuickNoteWithImages(
        id,
        plain,
        images.map((image) => ({
          filename: image.filename,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
        })),
      );
      successFeedback();
      await onSaved();
    } catch (reason) {
      setError("保存失败: " + (reason as Error).message);
      warnFeedback();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mobile-qn-flash" data-mobile-qn-flash>
      <textarea
        ref={inputRef}
        className="mobile-qn-flash__input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="写下这一刻…"
        aria-label="闪念速记"
      />
      {images.length > 0 && (
        <div className="mobile-qn-flash__images">
          {images.map((image, index) => (
            <figure key={image.url} className="mobile-qn-flash__thumb">
              <img src={image.url} alt={image.filename} />
              <button type="button" onClick={() => removeImage(index)} aria-label="移除图片"><X size={13} /></button>
            </figure>
          ))}
        </div>
      )}
      {error && <div className="mobile-qn-error">{error}</div>}
      <footer className="mobile-qn-actions">
        <label className="mobile-qn-add" title="添加图片">
          <ImagePlus size={18} />
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            multiple
            onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }}
          />
        </label>
        <span className="mobile-qn-hint">速记：只记文字与图片</span>
        <div className="mobile-qn-spacer" />
        <button type="button" className="mobile-qn-btn" onClick={onCancel} disabled={saving}>取消</button>
        <button type="button" className="mobile-qn-btn mobile-qn-primary" onClick={() => void save()} disabled={saving}>
          <Check size={15} />{saving ? "保存中…" : "保存"}
        </button>
      </footer>
    </div>
  );
}

export default QuickNoteFlashComposer;
