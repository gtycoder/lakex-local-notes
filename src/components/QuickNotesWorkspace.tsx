import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, CheckSquare, FilePlus, ImagePlus, Feather, LoaderCircle, Pencil, RotateCcw, Trash, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../core/requestVersion";
import type { NoteDocument, QuickNoteDocument, QuickNoteImage, TreeNode } from "../lib/types";
import { getNativeErrorMessage } from "../lib/nativeErrors";

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

/**
 * 小记列表的排序口径（用户 260915 要求）。
 * **纯展示偏好：只存本机 localStorage，不进 S3** —— 小记的先后顺序不重要，
 * 各端各按自己的偏好展示即可，不构成跨端冲突（与 Android 端已有的排序同口径）。
 */
type QuickNoteSort = "updated" | "created";
const SORT_KEY = "lake-notes-v3.quick-notes-sort";
const readSortPref = (): QuickNoteSort => {
  try { return localStorage.getItem(SORT_KEY) === "created" ? "created" : "updated"; } catch { return "updated"; }
};
const writeSortPref = (value: QuickNoteSort): void => {
  try { localStorage.setItem(SORT_KEY, value); } catch { /* 隐私模式忽略 */ }
};

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
  /** 待转成正式笔记的小记（多选时是一批） */
  const [convertItems, setConvertItems] = useState<QuickNoteDocument[] | null>(null);
  /** 多选模式与已选集合（仅本机交互状态，不进 S3） */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /** 排序口径：更新时间 / 创建时间（纯展示偏好，存 localStorage，不参与同步） */
  const [sortBy, setSortBy] = useState<QuickNoteSort>(() => readSortPref());
  const [sortOpen, setSortOpen] = useState(false);
  const deleteTimer = useRef<number | null>(null);
  const fileInputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const listVersionRef = useRef(createRequestVersion());
  // 撤销窗口内「尚未落盘删除」的小记 id：外部刷新（如同步完成）不得让它重新出现。
  const pendingDeleteIdRef = useRef<string | null>(null);

  const activeDraft = editingDraft ?? createDraft;
  const activeIsEditing = editingDraft !== null;
  const dirty = hasDraftContent(createDraft) || (editingDraft !== null && hasDraftContent(editingDraft));

  async function refreshItems(showLoading = false) {
    const version = listVersionRef.current.next();
    if (showLoading) setLoading(true);
    try {
      const nextItems = await native.listQuickNotes();
      if (listVersionRef.current.isCurrent(version)) {
        // 乐观删除尚未到期落盘时，同步完成等外部刷新会把该小记重新拉回列表 → 表现为「删不掉」。
        // 刷新结果里过滤掉撤销窗口内的那条，保持它与 UI 一致（到期由定时器真正删除；撤销则重新显示）。
        const pendingId = pendingDeleteIdRef.current;
        setItems(pendingId ? nextItems.filter((item) => item.id !== pendingId) : nextItems);
      }
    } catch (reason) {
      if (listVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(reason));
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

  // 排序菜单：点空白处收起（用 mousedown 且判断是否落在控件内，避免"点按钮先关再开"）
  useEffect(() => {
    if (!sortOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(".quick-notes-sort-wrap")) setSortOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sortOpen]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => { pendingDeleteIdRef.current = pendingDelete?.id ?? null; }, [pendingDelete]);

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
    } catch (reason) { setError(`添加图片失败：${getNativeErrorMessage(reason)}`); }
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
    } catch (reason) { setError(`保存小记失败：${getNativeErrorMessage(reason)}`); }
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
        setError(`删除小记失败：${getNativeErrorMessage(reason)}`);
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

  /** 转成正式笔记：单选/多选共用同一条路径（逐个转换，全部进同一个笔记本）。 */
  async function convert(notebookId: string) {
    const targets = convertItems;
    if (!targets || targets.length === 0) return;
    setSaving(true); setError(null);
    try {
      for (const item of targets) onConverted(await native.convertQuickNote(item.id, notebookId));
      const ids = new Set(targets.map((item) => item.id));
      listVersionRef.current.invalidate();
      setItems((current) => current.filter((item) => !ids.has(item.id)));
      setConvertItems(null);
      setSelected(new Set()); setSelecting(false);
    } catch (reason) { setError(`转换为正式笔记失败：${getNativeErrorMessage(reason)}`); }
    finally { setSaving(false); }
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelecting() { setSelecting(false); setSelected(new Set()); }

  /** 批量删除：破坏性且不可恢复（小记不备份），先确认；不进撤销窗口（多选场景语义就是"确定删"）。 */
  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`删除选中的 ${ids.length} 篇小记？小记不备份，删除后不可恢复。`)) return;
    setSaving(true); setError(null);
    try {
      for (const id of ids) await native.deleteQuickNote(id);
      const removed = new Set(ids);
      listVersionRef.current.invalidate();
      setItems((current) => current.filter((item) => !removed.has(item.id)));
      exitSelecting();
    } catch (reason) {
      setError(`批量删除失败：${getNativeErrorMessage(reason)}`);
      await refreshItems();
    } finally { setSaving(false); }
  }

  /** 排序只影响本端展示顺序（不写库、不进 manifest）。 */
  const visibleItems = useMemo(() => {
    const key = (item: QuickNoteDocument) => (sortBy === "updated" ? item.updatedAt : item.createdAt);
    return [...items].sort((a, b) => key(b).localeCompare(key(a)));
  }, [items, sortBy]);

  // 左右两栏（对齐云端语雀小记）：左＝常驻写作面板 + 发布行，右＝小记卡片流（各自独立滚动）。
  return <section className="quick-notes-pane" aria-label="小记">
    <header className="quick-notes-header">
      <h1>小记</h1>
      <div className="quick-notes-header-tools">
        <span className="quick-notes-count">{items.length} 条</span>
        <button className={"quick-notes-tool-btn" + (selecting ? " is-on" : "")} disabled={items.length === 0} onClick={() => (selecting ? exitSelecting() : setSelecting(true))} title="多选" aria-label="多选"><CheckSquare size={16} /></button>
        <div className="quick-notes-sort-wrap">
          <button className="quick-notes-tool-btn" onClick={() => setSortOpen((open) => !open)} aria-haspopup="menu" aria-expanded={sortOpen} title={sortBy === "updated" ? "排序：按更新时间" : "排序：按创建时间"} aria-label="排序"><ArrowUpDown size={16} /></button>
          {sortOpen && <div className="quick-notes-sort-menu" role="menu">
            <button role="menuitemradio" aria-checked={sortBy === "updated"} onClick={() => { setSortBy("updated"); writeSortPref("updated"); setSortOpen(false); }}>{sortBy === "updated" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}按更新时间</button>
            <button role="menuitemradio" aria-checked={sortBy === "created"} onClick={() => { setSortBy("created"); writeSortPref("created"); setSortOpen(false); }}>{sortBy === "created" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}按创建时间</button>
          </div>}
        </div>
      </div>
    </header>
    {error && <div className="quick-notes-error"><span>{error}</span><button onClick={() => setError(null)} aria-label="关闭错误"><X size={15} /></button></div>}
    <div className="quick-notes-split">
      <div className="quick-notes-compose">
        <QuickNoteComposer
          draft={createDraft}
          variant="pane"
          saving={saving && !activeIsEditing}
          onChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
          onAddFiles={(files) => void addFiles(files, createDraft)}
          onRemoveImage={(image) => void removeImage(createDraft, image)}
          onSave={() => void saveDraft()}
          onCancel={() => void cancelDraft()}
          inputRef={(node) => { if (node) fileInputs.current.set(createDraft.id, node); }}
        />
      </div>
      <div className={"quick-notes-list" + (selecting ? " selecting" : "")}>
        {selecting && <div className="quick-notes-selectbar">
          <button className={"qn-check" + (selected.size > 0 && selected.size === items.length ? " is-on" : "")} role="checkbox" aria-checked={selected.size > 0 && selected.size === items.length} aria-label="全选" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}>{selected.size > 0 && selected.size === items.length && <Check size={13} />}</button>
          <span className="quick-notes-selectbar-text">共选择了 {selected.size} 篇小记</span>
          <button className="quick-notes-link" onClick={exitSelecting}>取消</button>
          <div className="quick-note-action-spacer" />
          <button className="quick-notes-link" disabled={selected.size === 0 || saving} onClick={() => setConvertItems(items.filter((item) => selected.has(item.id)))}>转为文档</button>
          <button className="quick-notes-link quick-notes-link--danger" disabled={selected.size === 0 || saving} onClick={() => void deleteSelected()}>批量删除</button>
        </div>}
        <div className="quick-notes-timeline" aria-live="polite">
          {loading ? <div className="ln-empty"><LoaderCircle className="spin" size={18} /><span>正在读取小记…</span></div> : items.length === 0
            ? <div className="ln-empty ln-empty--idle"><Feather size={25} /><strong>还没有小记</strong><span>从左侧写下第一条临时记录。</span></div>
            : visibleItems.map((item) => editingId === item.id && editingDraft
              ? <article className="quick-note-entry editing" key={item.id}><QuickNoteComposer
                  draft={editingDraft} variant="inline" saving={saving && activeIsEditing}
                  onChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
                  onAddFiles={(files) => void addFiles(files, editingDraft)}
                  onRemoveImage={(image) => void removeImage(editingDraft, image)}
                  onSave={() => void saveDraft()} onCancel={() => void cancelDraft()}
                  inputRef={(node) => { if (node) fileInputs.current.set(editingDraft.id, node); }}
                /></article>
              : <QuickNoteCard key={item.id} item={item} deletePending={pendingDelete !== null} selecting={selecting} checked={selected.has(item.id)} onToggleSelect={() => toggleSelected(item.id)} onEdit={() => void startEditing(item)} onDelete={() => scheduleDelete(item)} onConvert={() => setConvertItems([item])} />)
          }
        </div>
      </div>
    </div>
    {pendingDelete && <div className="quick-notes-toast" role="status" aria-live="polite"><span>已删除一条小记</span><button onClick={undoDelete}><RotateCcw size={14} />撤销</button></div>}
    {convertItems && convertItems.length > 0 && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setConvertItems(null)}>
      <section className="quick-note-convert-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-note-convert-title">
        <h3 id="quick-note-convert-title">{convertItems.length > 1 ? `转为正式文档（${convertItems.length} 篇）` : "转为正式笔记"}</h3>
        <p>选择一个笔记本。{convertItems.length > 1 ? `${convertItems.length} 篇小记将依次插入该笔记本的最顶部；` : "新文档将插入其中的最顶部；"}转化完成后，小记将从时间线移除。</p>
        <div className="quick-note-notebook-list b3-list b3-list--background">
          {notebooks.map((notebook) => <button key={notebook.id} className="b3-list-item" disabled={saving} onClick={() => void convert(notebook.id)}><span className="b3-list-item__graphic"><FilePlus size={14} /></span><span className="b3-list-item__text">{notebook.title}</span></button>)}
          {notebooks.length === 0 && <span className="ln-empty">请先在资料库中新建一个笔记本。</span>}
        </div>
        <footer><button className="b3-button b3-button--cancel" disabled={saving} onClick={() => setConvertItems(null)}>取消</button></footer>
      </section>
    </div>}
  </section>;
});

interface ComposerProps {
  draft: DraftState;
  /** pane＝常驻写作面板（发布行在卡片外，仿语雀）；inline＝编辑既有小记（动作行留在卡片内） */
  variant: "pane" | "inline";
  saving: boolean;
  onChange(text: string): void;
  onAddFiles(files: FileList | File[]): void;
  onRemoveImage(image: DraftImage): void;
  onSave(): void;
  onCancel(): void;
  inputRef(node: HTMLInputElement | null): void;
}

function QuickNoteComposer({ draft, saving, variant, onChange, onAddFiles, onRemoveImage, onSave, onCancel, inputRef }: ComposerProps) {
  function pasteImages(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) { event.preventDefault(); onAddFiles(files); }
  }
  function dropImages(event: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) { event.preventDefault(); onAddFiles(files); }
  }
  /** ⌘/Ctrl + Enter 发布（对齐语雀小记的快捷键提示） */
  function publishOnShortcut(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onSave(); }
  }
  const publishLabel = variant === "pane" ? "小记一下" : "保存";
  return <>
    <div className="quick-note-composer">
      {/* 工具条置顶（仿语雀：图片等在写作区上方），正文区保持整块留白 */}
      <div className="quick-note-composer-tools">
        <label className="quick-note-tool" title="添加图片" aria-label="添加图片"><ImagePlus size={17} /><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple onChange={(event) => { if (event.target.files) onAddFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
      </div>
      <textarea value={draft.text} onChange={(event) => onChange(event.target.value)} onKeyDown={publishOnShortcut} onPaste={pasteImages} onDragOver={(event) => event.preventDefault()} onDrop={dropImages} placeholder={variant === "pane" ? "记你想记…" : "写下这一刻…"} aria-label="小记正文" />
      {draft.images.length > 0 && <div className="quick-note-image-grid">
        {draft.images.map((draftImage) => <figure key={draftImage.image.id}><img src={draftImage.image.url} alt="小记图片" /><button type="button" onClick={() => void onRemoveImage(draftImage)} aria-label="移除图片"><X size={14} /></button></figure>)}
      </div>}
    </div>
    <div className={`quick-note-composer-actions quick-note-composer-actions--${variant}`}>
      <button className="b3-button quick-note-publish" disabled={saving} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={15} /> : null}{saving ? "保存中" : publishLabel}</button>
      {variant === "pane" && <span className="quick-note-publish-hint">按 ⌘ Enter 发布</span>}
      {variant === "pane" && <span className="quick-note-publish-hint-sub">可拖入或粘贴图片</span>}
      <div className="quick-note-action-spacer" />
      <button className="quick-note-discard" disabled={saving} onClick={onCancel}>取消</button>
    </div>
  </>;
}

function QuickNoteCard({ item, deletePending, selecting, checked, onToggleSelect, onEdit, onDelete, onConvert }: {
  item: QuickNoteDocument; deletePending: boolean; selecting: boolean; checked: boolean;
  onToggleSelect(): void; onEdit(): void; onDelete(): void; onConvert(): void;
}) {
  // 仿语雀：时间戳在卡片顶部（"更新于 08-04 14:16"），正文/图片在下
  const stamp = (() => {
    const d = new Date(item.updatedAt || item.createdAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  return <article
    className={`quick-note-entry${item.isConflict ? " conflict" : ""}${selecting ? " selecting" : ""}${checked ? " is-checked" : ""}`}
    onDoubleClick={selecting ? undefined : onEdit}
    onClick={selecting ? onToggleSelect : undefined}
  >
    {selecting && <button
      className={"qn-check quick-note-select" + (checked ? " is-on" : "")}
      role="checkbox" aria-checked={checked} aria-label={checked ? "取消选择" : "选择这篇小记"}
      onClick={(event) => { event.stopPropagation(); onToggleSelect(); }}
    >{checked && <Check size={13} />}</button>}
    <header><time dateTime={item.updatedAt || item.createdAt}>更新于 {stamp}</time>{item.isConflict && <span className="badge badge--warn quick-note-conflict">同步冲突副本</span>}<div className="quick-note-card-actions"><button onClick={onConvert} title="转为正式笔记"><FilePlus size={15} /></button><button onClick={onEdit} title="编辑小记"><Pencil size={15} /></button><button className="danger" onClick={onDelete} disabled={deletePending} title={deletePending ? "请先完成当前删除的撤销操作" : "删除小记"}><Trash size={15} /></button></div></header>
    {item.content.text && <p>{item.content.text}</p>}
    {item.content.images.length > 0 && <div className="quick-note-saved-images">{item.content.images.map((image) => <img key={image.id} src={image.url} alt="小记图片" loading="lazy" />)}</div>}
  </article>;
}
