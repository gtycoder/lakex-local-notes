import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { addQuickNoteTagId, removeQuickNoteTagId, type QuickNoteTagSummary } from "../../core/quickNoteTags";
import { QuickNoteTagPicker } from "../../features/quickNotes/QuickNoteTagPicker";
import { documentTagBridgeAvailable, loadDocumentTagLinks, saveDocumentTags } from "../../features/tags/documentTags";
import "./noteTagRow.css";

/**
 * 文档属性面板的「标签」编辑行（P1）。
 *
 * - chips = 该文档的标签，顺序 = **本机 position**（主进程返回的顺序即落库顺序，组件原样采用）；
 * - 添加复用既有「标签选择器」语汇（QuickNoteTagPicker：搜索/选择/新建），新建走 quick-notes 标签目录
 *   （目录是两端共享的 tags，不在这里另建第二套）；
 * - 新增标签排最前（与小记一致：最近添加在前）；移除即整组重写关系（主进程推进关系版本）。
 */
export interface NoteTagRowProps {
  noteId: string;
  /** 错误提示（不传则静默打印 console）。 */
  onError?: (message: string) => void;
  /** 关系变化后通知宿主（标签空间/侧栏筛选的数据要重读）。 */
  onChanged?: () => void;
  /** 空态文案（属性面板/弹窗可各说一句；缺省「还没有标签。」）。 */
  emptyHint?: string;
}

export function NoteTagRow({ noteId, onError, onChanged, emptyHint = "还没有标签。" }: NoteTagRowProps) {
  const [catalog, setCatalog] = useState<QuickNoteTagSummary[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [available] = useState(() => documentTagBridgeAvailable());
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  const report = useCallback((error: unknown) => {
    const message = getNativeErrorMessage(error);
    if (onError) onError(message); else console.warn("[tags] " + message);
  }, [onError]);

  const loadCatalog = useCallback(async () => {
    try {
      const tags = await native.listQuickNoteTags();
      // 目录 API 给的是 QuickNoteTag（无 count）——选择器只需要 name/id，这里按 0 补齐。
      setCatalog(tags.map((tag) => ({ ...tag, count: 0 })));
    } catch (error) {
      report(error);
    }
  }, [report]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        await loadCatalog();
        if (!available) return;
        const { links } = await loadDocumentTagLinks();
        if (alive) setTagIds(links[noteId] ?? []);
      } catch (error) {
        if (alive) report(error);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [noteId, available, loadCatalog, report]);

  const commit = useCallback(async (next: string[]) => {
    setBusy(true);
    try {
      const saved = await saveDocumentTags(noteId, next);
      setTagIds(saved);
      onChanged?.();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }, [noteId, report, onChanged]);

  const createTag = useCallback(async (name: string): Promise<string> => {
    const created = await native.createQuickNoteTag(name);
    await loadCatalog();
    return created.id;
  }, [loadCatalog]);

  const nameOf = useMemo(() => new Map(catalog.map((tag) => [tag.id, tag.name] as const)), [catalog]);
  const options = useMemo(() => catalog.slice(), [catalog]);

  if (!available) {
    return <p className="note-info-tags-empty" role="status">标签数据暂不可用（请升级到支持文档标签的版本）。</p>;
  }

  return (
    <div className="note-info-tags" role="group" aria-label="标签">
      {loading && <span className="note-info-tags-empty">读取标签…</span>}
      {!loading && tagIds.length === 0 && <span className="note-info-tags-empty">{emptyHint}</span>}
      {tagIds.map((tagId) => (
        <span key={tagId} className="note-info-tag-chip">
          <span className="ln-ellipsis">{nameOf.get(tagId) ?? tagId}</span>
          <button type="button" className="note-info-tag-remove" aria-label={"移除标签 " + (nameOf.get(tagId) ?? tagId)}
            disabled={busy} onClick={() => void commit(removeQuickNoteTagId(tagIds, tagId))}><X size={11} /></button>
        </span>
      ))}
      <button type="button" className="note-info-tag-add" disabled={busy}
        aria-label="添加标签" title="添加标签"
        onClick={(event) => setPickerAnchor(event.currentTarget)}>
        <Plus size={12} /><span>标签</span>
      </button>
      {pickerAnchor && (
        <QuickNoteTagPicker
          anchor={pickerAnchor}
          options={options}
          selected={tagIds}
          onAdd={(tagId) => void commit(addQuickNoteTagId(tagIds, tagId))}
          onCreate={createTag}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </div>
  );
}
