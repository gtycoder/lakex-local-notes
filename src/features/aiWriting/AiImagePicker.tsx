/**
 * AI 写作 · 附件图片选择器（261116 第四稿最终口径）。
 *
 * 两种打开方式，形式与「选文档」一致（文档浏览只是**寻址层级**，不产生 docRefs、不带文档正文）：
 * - 多文档推理：docs = 当前已选文档集合；直接列这些文档里的图片（按文档分组）。
 * - 对话写作：先在 AiComposer 里用同款文档面板挑一篇文档（仅寻址），再进到这里列该文档的附件；
 *   面板顶部可「换一篇文档」返回。
 *
 * 缩略图走资源服务器直链（?w=128 + access token），字节只在主进程；不读文件、不转 base64。
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Image as ImageIcon } from "lucide-react";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import {
  AI_WRITING_MAX_ATTACHMENTS,
  aiWritingAttachmentKey,
  isAiWritingLocalAttachment,
  type AiWritingAttachment,
  type AiWritingDocRef,
} from "../../core/aiWriting";
import type { AiAssetRef } from "../../core/aiProviders";
import { native } from "../../lib/native";
import { AIW_ATTACH_TOTAL_BYTES, aiWritingAttachmentUrl, formatAttachmentBytes } from "./aiWritingAttachments";

export interface AiImageAsset {
  filename: string;
  size: number;
  mimeType: string;
}

interface Group {
  doc: { id: string; title: string };
  images: AiImageAsset[];
}

export interface AiImagePickerProps {
  open: boolean;
  anchor: HTMLElement | null;
  /** 附件来源文档（多文档推理 = 已选文档；对话写作 = 寻址选中的那一篇，通常只有一篇）。 */
  docs: readonly AiWritingDocRef[];
  /** 对话写作：回到「选一篇文档」面板（复用同款文档浏览形式）。 */
  onBackToDocs?: () => void;
  /** 当前已挂的附件（用来把「已添加」标灰，避免重复选；本机文件不参与图片网格）。 */
  selected: readonly AiWritingAttachment[];
  onAdd: (refs: AiAssetRef[]) => void;
  onDismiss: () => void;
}

export function AiImagePicker({ open, anchor, docs, onBackToDocs, selected, onAdd, onDismiss }: AiImagePickerProps) {
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, gap: 6, margin: 10, width: 520 });
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Map<string, AiAssetRef>>(new Map());

  const docGroups = useMemo(() => {
    const seen = new Set<string>();
    return docs.filter((doc) => doc.kind === "note" && !seen.has(doc.id) && seen.add(doc.id));
  }, [docs]);
  const quickNoteCount = docs.filter((doc) => doc.kind === "quick-note").length;
  const alreadyKeys = useMemo(() => new Set(selected.filter((ref) => !isAiWritingLocalAttachment(ref)).map(aiWritingAttachmentKey)), [selected]);
  const slots = Math.max(0, AI_WRITING_MAX_ATTACHMENTS - selected.length);

  useEffect(() => {
    if (!open) return;
    setPicked(new Map());
    if (docGroups.length === 0) { setGroups([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const loaded: Group[] = [];
      for (const doc of docGroups) {
        try {
          loaded.push({ doc: { id: doc.id, title: doc.title }, images: await native.listNoteImageAssets(doc.id) });
        } catch {
          loaded.push({ doc: { id: doc.id, title: doc.title }, images: [] });
        }
      }
      if (cancelled) return;
      setGroups(loaded);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, docGroups]);

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

  const toggle = (doc: { id: string }, image: AiImageAsset) => {
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
      label="选择文档里的附件"
      className="aiw-pick"
      style={style ?? undefined}
      surfaceRef={surfaceRef}
    >
      <div className="aiw-pick__head">
        <span className="aiw-pick__title">
          {onBackToDocs && (
            <button type="button" className="ln-iconbtn ln-iconbtn--compact aiw-pick__back" aria-label="换一篇文档" onClick={onBackToDocs}>
              <ArrowLeft size={14} aria-hidden="true" />
            </button>
          )}
          <ImageIcon size={14} aria-hidden="true" />
          {docGroups.length === 1 ? "《" + docGroups[0].title + "》的附件" : "选择文档里的附件"}
        </span>
        <button type="button" className="ln-btn ln-btn--ghost ln-btn--compact" onClick={onDismiss}>取消</button>
      </div>
      <div className="aiw-pick__body">
        {loading && <p className="aiw-pick__empty">读取中…</p>}
        {!loading && docGroups.length === 0 && (
          <p className="aiw-pick__empty">先选择一篇文档，再从它的附件里挑图片{quickNoteCount > 0 ? "（小记图片下一批支持）" : ""}</p>
        )}
        {!loading && docGroups.length > 0 && groups.every((group) => group.images.length === 0) && (
          <p className="aiw-pick__empty">这篇文档里没有可发送的图片附件</p>
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
                    title={image.filename + " " + formatAttachmentBytes(image.size)}
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
        {quickNoteCount > 0 && docGroups.length > 0 && <p className="aiw-pick__hint">小记里的图片下一批支持。</p>}
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
