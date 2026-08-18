import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Check, FilePlus2, ImagePlus, Feather, LoaderCircle, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../lib/requestVersion";
import type { NoteDocument, QuickNoteDocument, QuickNoteImage, TreeNode } from "../lib/types";

interface DraftImage {
  image: QuickNoteImage;
  source: "saved" | "staged";
}

interface DraftState {
  id: string;
  text: string;
  images: DraftImage[];
}

export interface QuickNotesWorkspaceHandle {
  /** 返回 true 代表可以离开当前小记页面；false 代表用户选择继续编辑。 */
  confirmLeave(): Promise<boolean>;
  /** 同步完成后刷新小记列表。 */
  refresh(): Promise<void>;
}

interface QuickNotesWorkspaceProps {
  notebooks: TreeNode[];
  onConverted(note: NoteDocument): void;
  onDirtyChange(dirty: boolean): void;
}

const newDraft = (): DraftState => ({ id: crypto.randomUUID(), text: "", images: [] });
const hasDraftContent = (draft: DraftState) => draft.text.trim().length > 0 || draft.images.length > 0;

export const QuickNotesWorkspace = forwardRef<QuickNotesWorkspaceHandle, QuickNotesWorkspaceProps>(function QuickNotesWorkspace(props, ref) {
  const { notebooks: notebookNodes, onConverted, onDirtyChange } = props;
  const [items, setItems] = useState<QuickNoteDocument[]>([]);
  const [createDraft, setCreateDraft] = useState<DraftState>(() => newDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuickNoteDocument | null>(null);
  const [convertItem, setConvertItem] = useState<QuickNoteDocument | null>(null);
  const deleteTimer = useRef<number | null>(null);
  const fileInputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const listVersionRef = useRef(createRequestVersion());

  const activeDraft = editingDraft ?? createDraft;
  const activeIsEditing = editingDraft !== null;
  const dirty = hasDraftContent(createDraft) || (editingDraft !== null && hasDraftContent(editingDraft));

  async function refreshItems(showLoading = false) {
    const version = listVersionRef.current.next();
    if (showLoading) setLoading(true);
    try {
      const nextItems = await native.listQuickNotes();
      if (listVersionRef.current.isCurrent(version)) setItems(nextItems);
    } catch (reason) {
      if (listVersionRef.current.isCurrent(version)) setError(String(reason));
    } finally {
      if (listVersionRef.current.isCurrent(version) && showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void refreshItems(true);
    return () => {
      listVersionRef.current.invalidate();
      if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    async refresh() {
      await refreshItems();
    },
    async confirmLeave() {
      if (!dirty) return true;
      const discard = window.confirm("当前小记尚未保存。放弃本次编辑并离开？");
      if (!discard) return false;
      await discardAllDrafts();
      return true;
    },
  }));

  const notebooks = useMemo(() => notebookNodes
    .filter((node) => node.nodeType === "notebook")
    .sort((a, b) => a.sortOrder - b.sortOrder), [notebookNodes]);

  function updateActiveDraft(patch: Partial<DraftState>) {
    if (activeIsEditing) setEditingDraft((current) => current ? { ...current, ...patch } : current);
    else setCreateDraft((current) => ({ ...current, ...patch }));
  }

  async function discardAllDrafts() {
    const draftIds = [createDraft.id, editingDraft?.id].filter((value): value is string => !!value);
    await Promise.all(draftIds.map((draftId) => native.discardQuickNoteDraft(draftId).catch(() => undefined)));
    setCreateDraft(newDraft());
    setEditingId(null);
    setEditingDraft(null);
  }

  async function addFiles(files: FileList | File[], draft: DraftState) {
    const candidates = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (candidates.length === 0) return;
    setError(null);
    try {
      const staged = await Promise.all(candidates.map(async (file) => {
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        return native.stageQuickNoteImage(draft.id, { bytes, filename: file.name });
      }));
      // 若编辑状态在 await 期间变化，只将图片追加到开始上传时所属的草稿。
      if (editingDraft?.id === draft.id) setEditingDraft((current) => current ? { ...current, images: [...current.images, ...staged.map((image) => ({ image, source: "staged" as const }))] } : current);
      else if (createDraft.id === draft.id) setCreateDraft((current) => ({ ...current, images: [...current.images, ...staged.map((image) => ({ image, source: "staged" as const }))] }));
      else await native.discardQuickNoteDraft(draft.id);
    } catch (reason) { setError(`添加图片失败：${String(reason)}`); }
  }

  async function removeImage(draft: DraftState, draftImage: DraftImage) {
    if (draftImage.source === "staged") await native.discardStagedQuickNoteImage(draft.id, draftImage.image.id).catch(() => undefined);
    const next = draft.images.filter((candidate) => candidate.image.id !== draftImage.image.id);
    if (editingDraft?.id === draft.id) setEditingDraft((current) => current ? { ...current, images: next } : current);
    else if (createDraft.id === draft.id) setCreateDraft((current) => ({ ...current, images: next }));
  }

  async function saveDraft() {
    const draft = activeDraft;
    if (!hasDraftContent(draft)) { setError("请至少记录文字或一张图片"); return; }
    setSaving(true); setError(null);
    try {
      const stagedImageIds = draft.images.filter((item) => item.source === "staged").map((item) => item.image.id);
      const retainedImageIds = draft.images.filter((item) => item.source === "saved").map((item) => item.image.id);
      const saved = activeIsEditing && editingId
        ? await native.updateQuickNote(editingId, { text: draft.text, draftId: draft.id, stagedImageIds, retainedImageIds })
        : await native.createQuickNote({ text: draft.text, draftId: draft.id, stagedImageIds });
      listVersionRef.current.invalidate();
      setItems((current) => {
        const without = current.filter((item) => item.id !== saved.id);
        return [saved, ...without].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      if (activeIsEditing) { setEditingId(null); setEditingDraft(null); }
      else setCreateDraft(newDraft());
    } catch (reason) { setError(`保存小记失败：${String(reason)}`); }
    finally { setSaving(false); }
  }

  async function cancelDraft() {
    if (!hasDraftContent(activeDraft) || window.confirm("放弃这次未保存的小记？")) {
      await native.discardQuickNoteDraft(activeDraft.id).catch(() => undefined);
      if (activeIsEditing) { setEditingId(null); setEditingDraft(null); }
      else setCreateDraft(newDraft());
    }
  }

  async function startEditing(item: QuickNoteDocument) {
    if (editingId === item.id) return;
    if (dirty && !(await confirmSwitchDraft("切换到另一条小记将放弃当前未保存内容，是否继续？"))) return;
    const draft: DraftState = {
      id: crypto.randomUUID(), text: item.content.text,
      images: item.content.images.map((image) => ({ image, source: "saved" })),
    };
    setEditingId(item.id); setEditingDraft(draft);
  }

  async function confirmSwitchDraft(message: string): Promise<boolean> {
    if (!dirty) return true;
    if (!window.confirm(message)) return false;
    await discardAllDrafts();
    return true;
  }

  function scheduleDelete(item: QuickNoteDocument) {
    // 当前 Undo 窗口只承载一条小记；先阻止第二次删除，避免清掉首条计时器后
    // 让卡片从 UI 消失、却没有真正落盘删除或可撤销入口。
    if (pendingDelete) return;
    if (editingId === item.id) { setEditingId(null); setEditingDraft(null); }
    setPendingDelete(item);
    listVersionRef.current.invalidate();
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = window.setTimeout(() => {
      deleteTimer.current = null;
      void native.deleteQuickNote(item.id).catch((reason) => {
        setError(`删除小记失败：${String(reason)}`);
        setItems((current) => [item, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }).finally(() => setPendingDelete(null));
    }, 5000);
  }

  function undoDelete() {
    if (!pendingDelete) return;
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = null;
    listVersionRef.current.invalidate();
    setItems((current) => [pendingDelete, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setPendingDelete(null);
  }

  async function convert(notebookId: string) {
    if (!convertItem) return;
    setSaving(true); setError(null);
    try {
      const note = await native.convertQuickNote(convertItem.id, notebookId);
      listVersionRef.current.invalidate();
      setItems((current) => current.filter((item) => item.id !== convertItem.id));
      setConvertItem(null);
      onConverted(note);
    } catch (reason) { setError(`转换为正式笔记失败：${String(reason)}`); }
    finally { setSaving(false); }
  }

  return <section className="quick-notes-pane" aria-label="小记">
    <header className="quick-notes-header">
      <div><span className="quick-notes-eyebrow">LOCAL TIMELINE</span><h1>小记</h1><p>记下当下，值得留存时再转为笔记。</p></div>
      <span className="quick-notes-count">{items.length} 条</span>
    </header>
    {error && <div className="quick-notes-error"><span>{error}</span><button onClick={() => setError(null)} aria-label="关闭错误"><X size={15} /></button></div>}
    <QuickNoteComposer
      draft={createDraft}
      compact={false}
      saving={saving && !activeIsEditing}
      onChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
      onAddFiles={(files) => void addFiles(files, createDraft)}
      onRemoveImage={(image) => void removeImage(createDraft, image)}
      onSave={() => void saveDraft()}
      onCancel={() => void cancelDraft()}
      inputRef={(node) => { if (node) fileInputs.current.set(createDraft.id, node); }}
    />
    <div className="quick-notes-timeline" aria-live="polite">
      {loading ? <div className="quick-notes-loading"><LoaderCircle className="spin" size={18} /> 正在读取小记…</div> : items.length === 0
        ? <div className="quick-notes-empty"><Feather size={25} /><strong>还没有小记</strong><span>从上面写下第一条临时记录。</span></div>
        : items.map((item) => editingId === item.id && editingDraft
          ? <article className="quick-note-entry editing" key={item.id}><QuickNoteComposer
              draft={editingDraft} compact saving={saving && activeIsEditing}
              onChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
              onAddFiles={(files) => void addFiles(files, editingDraft)}
              onRemoveImage={(image) => void removeImage(editingDraft, image)}
              onSave={() => void saveDraft()} onCancel={() => void cancelDraft()}
              inputRef={(node) => { if (node) fileInputs.current.set(editingDraft.id, node); }}
            /></article>
          : <QuickNoteCard key={item.id} item={item} deletePending={pendingDelete !== null} onEdit={() => void startEditing(item)} onDelete={() => scheduleDelete(item)} onConvert={() => setConvertItem(item)} />)
      }
    </div>
    {pendingDelete && <div className="quick-notes-toast" role="status" aria-live="polite"><span>已删除一条小记</span><button onClick={undoDelete}><RotateCcw size={14} />撤销</button></div>}
    {convertItem && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setConvertItem(null)}>
      <section className="quick-note-convert-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-note-convert-title">
        <h3 id="quick-note-convert-title">转为正式笔记</h3>
        <p>选择一个笔记本。新文档将插入其中的最顶部；转化完成后，小记将从时间线移除。</p>
        <div className="quick-note-notebook-list">
          {notebooks.map((notebook) => <button key={notebook.id} disabled={saving} onClick={() => void convert(notebook.id)}><FilePlus2 size={16} /><span>{notebook.title}</span></button>)}
          {notebooks.length === 0 && <span className="quick-note-no-notebook">请先在资料库中新建一个笔记本。</span>}
        </div>
        <footer><button className="b3-button b3-button--cancel" disabled={saving} onClick={() => setConvertItem(null)}>取消</button></footer>
      </section>
    </div>}
  </section>;
});

interface ComposerProps {
  draft: DraftState;
  compact: boolean;
  saving: boolean;
  onChange(text: string): void;
  onAddFiles(files: FileList | File[]): void;
  onRemoveImage(image: DraftImage): void;
  onSave(): void;
  onCancel(): void;
  inputRef(node: HTMLInputElement | null): void;
}

function QuickNoteComposer({ draft, saving, onChange, onAddFiles, onRemoveImage, onSave, onCancel, inputRef }: ComposerProps) {
  function pasteImages(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) { event.preventDefault(); onAddFiles(files); }
  }
  function dropImages(event: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) { event.preventDefault(); onAddFiles(files); }
  }
  return <div className="quick-note-composer">
    <textarea value={draft.text} onChange={(event) => onChange(event.target.value)} onPaste={pasteImages} onDragOver={(event) => event.preventDefault()} onDrop={dropImages} placeholder="写下这一刻…" aria-label="小记正文" />
    {draft.images.length > 0 && <div className="quick-note-image-grid">
      {draft.images.map((draftImage) => <figure key={draftImage.image.id}><img src={draftImage.image.url} alt="小记图片" /><button type="button" onClick={() => void onRemoveImage(draftImage)} aria-label="移除图片"><X size={14} /></button></figure>)}
    </div>}
    <footer className="quick-note-composer-actions">
      <label className="quick-note-image-button" title="添加图片"><ImagePlus size={17} /><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple onChange={(event) => { if (event.target.files) onAddFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
      <span>可拖入或粘贴图片</span>
      <div className="quick-note-action-spacer" />
      <button className="b3-button b3-button--cancel" disabled={saving} onClick={onCancel}>取消</button>
      <button className="b3-button" disabled={saving} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{saving ? "保存中" : "记下"}</button>
    </footer>
  </div>;
}

function QuickNoteCard({ item, deletePending, onEdit, onDelete, onConvert }: { item: QuickNoteDocument; deletePending: boolean; onEdit(): void; onDelete(): void; onConvert(): void }) {
  const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.createdAt));
  return <article className={`quick-note-entry ${item.isConflict ? "conflict" : ""}`} onDoubleClick={onEdit}>
    <header><time dateTime={item.createdAt}>{date}</time>{item.isConflict && <span className="quick-note-conflict">同步冲突副本</span>}<div className="quick-note-card-actions"><button onClick={onConvert} title="转为正式笔记"><FilePlus2 size={15} /></button><button onClick={onEdit} title="编辑小记"><Pencil size={15} /></button><button className="danger" onClick={onDelete} disabled={deletePending} title={deletePending ? "请先完成当前删除的撤销操作" : "删除小记"}><Trash2 size={15} /></button></div></header>
    {item.content.text && <p>{item.content.text}</p>}
    {item.content.images.length > 0 && <div className="quick-note-saved-images">{item.content.images.map((image) => <img key={image.id} src={image.url} alt="小记图片" loading="lazy" />)}</div>}
  </article>;
}
