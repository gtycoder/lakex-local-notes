/**
 * AI 写作 · 图片附件选择器（261116 Phase 1）。
 *
 * 源 = **已选资料文档（docRefs）里的图片**（对齐移动端 AI 助手 AiImageSheet 的语义）：
 *   - 只列笔记类文档（kind:"note"）的资源目录；小记图片留到下一批（避免资源根路径歧义）；
 *   - 每个文档 = 一组网格；多选，上限 = 剩余槽位（AI_WRITING_MAX_ATTACHMENTS）；
 *   - 缩略图走资源服务器直链（?w=128 + access token），**不读字节、不转 base64**。
 * 图片是否可用（格式/大小/存在）最终由主进程在发送时判定（10MB/张、20MB/次）。
 */
import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { AI_WRITING_MAX_ATTACHMENTS, aiWritingAttachmentKey, type AiWritingDocRef } from "../../core/aiWriting";
import type { AiAssetRef } from "../../core/aiProviders";
import { native } from "../../lib/native";
import { AIW_ATTACH_TOTAL_BYTES, aiWritingAttachmentUrl, formatAttachmentBytes } from "./aiWritingAttachments";

export interface AiImageAsset {
  filename: string;
  size: number;
  mimeType: string;
}

interface Group {
  doc: AiWritingDocRef;
  images: AiImageAsset[];
}

export interface AiImagePickerProps {
  open: boolean;
  anchor: HTMLElement | null;
  docs: readonly AiWritingDocRef[];
  /** 当前已挂的附件（用来把「已添加」标灰，避免重复选）。 */
  selected: readonly AiAssetRef[];
  onAdd: (refs: AiAssetRef[]) => void;
  onDismiss: () => void;
}

export function AiImagePicker({ open, anchor, docs, selected, onAdd, onDismiss }: AiImagePickerProps) {
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, gap: 6, margin: 10, width: 520 });
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Map<string, AiAssetRef>>(new Map());

  const noteDocs = useMemo(() => {
    const seen = new Set<string>();
    return docs.filter((doc) => doc.kind === "note" && !seen.has(doc.id) && seen.add(doc.id));
  }, [docs]);
  const quickNoteCount = docs.filter((doc) => doc.kind === "quick-note").length;
  const alreadyKeys = useMemo(() => new Set(selected.map(aiWritingAttachmentKey)), [selected]);
  const slots = Math.max(0, AI_WRITING_MAX_ATTACHMENTS - selected.length);

  // 每次打开重新拉目录（文档资源可能刚变；选择状态清空）。
  useEffect(() => {
    if (!open) return;
    setPicked(new Map());
    if (noteDocs.length === 0) { setGroups([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const loaded: Group[] = [];
      for (const doc of noteDocs) {
        try {
          loaded.push({ doc, images: await native.listNoteImageAssets(doc.id) });
        } catch {
          loaded.push({ doc, images: [] });
        }
      }
      if (cancelled) return;
      setGroups(loaded);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, noteDocs]);

  const totalBytes = useMemo(() => {
    let sum = 0;
    for (const ref of picked.values()) {
      for (const group of groups) {
        if (group.doc.id !== ref.noteId) continue;
        const image = group.images.find((item) => item.filename === ref.filename);
        if (image) sum += image.size;
      }
    }
    return sum;
  }, [picked, groups]);
  const overBytes = totalBytes > AIW_ATTACH_TOTAL_BYTES;

  const toggle = (doc: AiWritingDocRef, image: AiImageAsset) => {
    const ref: AiAssetRef = { noteId: doc.id, filename: image.filename, name: image.filename };
    const key = aiWritingAttachmentKey(ref);
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < slots && !alreadyKeys.has(key)) next.set(key, ref);
      return next;
    });
  };

  const confirm = () => {
    if (picked.size === 0 || overBytes) return;
    onAdd([...picked.values()]);
    onDismiss();
  };

  return (
    <Popover
      open={open}
      onDismiss={onDismiss}
      label="选择图片"
      className="aiw-pick"
      style={style ?? undefined}
      surfaceRef={surfaceRef}
    >
      <div className="aiw-pick__head">
        <span className="aiw-pick__title"><ImageIcon size={14} aria-hidden="true" />选择图片</span>
        <button type="button" className="ln-btn ln-btn--ghost ln-btn--compact" onClick={onDismiss}>取消</button>
      </div>
      <div className="aiw-pick__body">
        {loading && <p className="aiw-pick__empty">读取中…</p>}
        {!loading && noteDocs.length === 0 && (
          <p className="aiw-pick__empty">先在输入卡选择资料文档，再从文档资源里挑图片{quickNoteCount > 0 ? "（小记图片下一批支持）" : ""}</p>
        )}
        {!loading && noteDocs.length > 0 && groups.every((group) => group.images.length === 0) && (
          <p className="aiw-pick__empty">这些文档里没有可发送的图片</p>
        )}
        {!loading && groups.map((group) => group.images.length > 0 && (
          <section key={group.doc.id} className="aiw-pick__group">
            <p className="aiw-pick__group-title">《{group.doc.title}》，{group.images.length} 张</p>
            <div className="aiw-pick__grid">
              {group.images.map((image) => {
                const ref: AiAssetRef = { noteId: group.doc.id, filename: image.filename, name: image.filename };
                const key = aiWritingAttachmentKey(ref);
                const on = picked.has(key);
                const already = alreadyKeys.has(key);
                const disabled = already || (!on && picked.size >= slots);
                return (
                  <button
                    key={key}
                    type="button"
                    className={"aiw-pick__cell" + (on ? " is-on" : "") + (already ? " is-already" : "")}
                    aria-pressed={on || already}
                    aria-label={(on || already ? "已选：" : "选择：") + image.filename}
                    title={image.filename + " · " + formatAttachmentBytes(image.size)}
                    disabled={disabled}
                    onClick={() => toggle(group.doc, image)}
                  >
                    <img className="aiw-pick__thumb" src={aiWritingAttachmentUrl(ref)} alt={image.filename} loading="lazy" decoding="async" />
                    {already && <span className="aiw-pick__badge">已添加</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {quickNoteCount > 0 && noteDocs.length > 0 && <p className="aiw-pick__hint">小记里的图片下一批支持。</p>}
      </div>
      <div className="aiw-pick__foot">
        <span className={"aiw-pick__meta" + (overBytes ? " is-warn" : "")}>
          已选 <b>{picked.size}</b> / {slots} 张 · {formatAttachmentBytes(totalBytes)}
          {overBytes ? "（超过 20MB，请减少）" : ""}
        </span>
        <button type="button" className="ln-btn ln-btn--primary ln-btn--compact" disabled={picked.size === 0 || overBytes} onClick={confirm}>
          添加{picked.size > 0 ? " " + picked.size + " 张" : ""}
        </button>
      </div>
    </Popover>
  );
}
