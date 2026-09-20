/**
 * 小记（长按桌面图标 / `lakenotes://quick-note` 深链进来的那条路径）—— **不挂 Lake 内核**的轻量速记框。
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
 *   `docs/LAKE-CONTENT-WRITING.md` §1 ③）。图片加入即按 `quick-notes/{id}/` 落盘。
 *
 * 草稿防丢：文字 + 图片引用写本机 `device_state`（纯本地、不进 S3、不是小记本体），进程被杀可恢复。
 * 外部带入（系统分享）：`seed` 提供文本与图片字节，挂载时套用为**一条新小记**。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, X } from "lucide-react";
import { bridge } from "../bridge";
import { successFeedback, warnFeedback } from "../ui/haptics";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { sha256Sync } from "../../core/sha256Sync.js";
import {
  quickNoteBodyFromTextAndImages,
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
  type StoredQuickNoteImage,
} from "../../core/quickNoteModel.js";

interface FlashImage {
  id: string;
  /** 已落盘的唯一文件名（quick-notes/{noteId}/ 下）。 */
  filename: string;
  /** 原文件名（仅用于展示）。 */
  displayName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
  hash: string;
  /** 预览 URL：新加的是 objectURL，从草稿恢复的是 canonical URL。 */
  url: string;
}

/** 外部带入的初始内容（系统分享）：文本 + 图片字节。 */
export interface QuickNoteSeed {
  text: string;
  images: Array<{ filename: string; mimeType: string; bytes: Uint8Array }>;
}

export interface QuickNoteFlashComposerProps {
  onSaved: () => Promise<void>;
  onCancel: () => void;
  /** 打开后是否自动聚焦并弹键盘（深链冷启动想要；从别处进来也可关掉）。 */
  autoFocus?: boolean;
  /** 系统分享带入的初始内容：挂载时套用为一条新小记（不读上次草稿）。 */
  seed?: QuickNoteSeed | null;
}

export function QuickNoteFlashComposer({ onSaved, onCancel, autoFocus = true, seed = null }: QuickNoteFlashComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<FlashImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  /** 草稿 id：挂载即固定（保存也沿用），恢复草稿时换成草稿里的 id。 */
  const [noteId, setNoteId] = useState<string>(() => crypto.randomUUID());
  /** 草稿/seed 处理完成前不写草稿，避免用空文本覆盖上次未保存的内容。 */
  const [draftLoaded, setDraftLoaded] = useState(false);
  /** 已提交（保存/取消）：之后不再写草稿。 */
  const committedRef = useRef(false);

  // 卸载时释放预览 objectURL
  useEffect(() => () => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  /** 校验 + 落盘一张图（quick-notes/{forNoteId}/），返回可展示/可保存的条目。 */
  const stageImage = useCallback(async (forNoteId: string, filename: string, bytes: Uint8Array): Promise<FlashImage> => {
    const format = validateQuickNoteImageBytes(bytes);
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: format.mimeType });
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    validateQuickNoteImageDimensions(dimensions);
    const stored = await bridge.stageQuickNoteAsset(forNoteId, { filename, bytes });
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    return {
      id: crypto.randomUUID(),
      filename: stored.filename,
      displayName: filename,
      mimeType: stored.mimeType || format.mimeType,
      width: dimensions.width,
      height: dimensions.height,
      size: stored.size,
      hash: sha256Sync(bytes),
      url,
    };
  }, []);

  // 挂载：系统分享优先（= 一条新小记）；否则恢复上次未提交草稿（文字 + 图片引用）。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (seed && (seed.text.trim() || seed.images.length > 0)) {
          const id = crypto.randomUUID();
          if (!alive) return;
          setNoteId(id);
          setText(seed.text);
          const staged: FlashImage[] = [];
          for (const img of seed.images) {
            try { staged.push(await stageImage(id, img.filename, img.bytes)); } catch { /* 坏图跳过 */ }
          }
          if (alive) setImages(staged);
          return;
        }
        const draft = await bridge.getQuickNoteDraft();
        if (alive && draft) {
          setNoteId(draft.id);
          setText(draft.text);
          setImages(draft.images.map((img) => ({
            id: img.id,
            filename: img.filename,
            displayName: img.filename,
            mimeType: img.mimeType,
            width: img.width,
            height: img.height,
            size: img.size,
            hash: img.hash,
            url: withAssetAccessToken(localAssetHttpUrl(draft.id, img.filename, { space: "quick-notes" })),
          })));
        }
      } catch { /* 读草稿/seed 失败不阻断输入 */ }
      finally { if (alive) setDraftLoaded(true); }
    })();
    return () => { alive = false; };
    // 只在挂载时跑一次：seed 是一次性带入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 输入/图片变化后 300ms 防抖写草稿（纯本地 device_state；保存/取消后不再写）。
  useEffect(() => {
    if (!draftLoaded || committedRef.current) return;
    const timer = window.setTimeout(() => {
      if (committedRef.current) return;
      void bridge.saveQuickNoteDraft({
        id: noteId,
        text,
        images: images.map((i) => ({ id: i.id, filename: i.filename, mimeType: i.mimeType, width: i.width, height: i.height, size: i.size, hash: i.hash })),
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, images, noteId, draftLoaded]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    setError(null);
    const next: FlashImage[] = [];
    for (const file of candidates) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        next.push(await stageImage(noteId, file.name, bytes));
      } catch (reason) {
        setError("图片读取失败: " + (reason as Error).message);
      }
    }
    if (next.length > 0) setImages((prev) => [...prev, ...next]);
  }, [noteId, stageImage]);

  const removeImage = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target && target.url.startsWith("blob:")) {
        URL.revokeObjectURL(target.url);
        urlsRef.current = urlsRef.current.filter((url) => url !== target.url);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  /** 主动取消 = 丢弃草稿（进程被杀不经过这里，草稿会保留）。 */
  const cancel = (): void => {
    committedRef.current = true;
    void bridge.clearQuickNoteDraft().catch(() => undefined);
    onCancel();
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
      const body = quickNoteBodyFromTextAndImages(
        plain,
        images.map((image) => ({ filename: image.filename, size: image.size, width: image.width, height: image.height, mimeType: image.mimeType })),
        (filename) => localAssetHttpUrl(noteId, filename, { space: "quick-notes" }),
        () => crypto.randomUUID(),
      );
      await bridge.saveQuickNoteContent(noteId, {
        text: plain,
        body,
        images: images.map((image): StoredQuickNoteImage => ({
          id: image.id,
          filename: image.filename,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          size: image.size,
          hash: image.hash,
        })),
      });
      committedRef.current = true;
      await bridge.clearQuickNoteDraft().catch(() => undefined);
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
        aria-label="小记"
      />
      {images.length > 0 && (
        <div className="mobile-qn-flash__images">
          {images.map((image, index) => (
            <figure key={image.url} className="mobile-qn-flash__thumb">
              <img src={image.url} alt={image.displayName} />
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
        <span className="mobile-qn-hint">只记文字与图片</span>
        <div className="mobile-qn-spacer" />
        <button type="button" className="mobile-qn-btn" onClick={cancel} disabled={saving}>取消</button>
        <button type="button" className="mobile-qn-btn mobile-qn-primary" onClick={() => void save()} disabled={saving}>
          <Check size={15} />{saving ? "保存中…" : "保存"}
        </button>
      </footer>
    </div>
  );
}

export default QuickNoteFlashComposer;
