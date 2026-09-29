import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, FilePlus, Feather, LayoutList, LoaderCircle, MoreHorizontal, Pencil, Plus, RotateCcw, StickyNote, Trash, X } from "lucide-react";
import { native } from "../lib/native";
import { writeLocalStorage } from "../lib/localStorageSafe";
import { createRequestVersion } from "../core/requestVersion";
import { isQuickNoteImageMime } from "../core/quickNoteModel";
import type { NoteDocument, QuickNoteDocument, QuickNoteImage, ResourceUploadOutput, TreeNode } from "../lib/types";
import { getNativeErrorMessage, reportNativeActionError } from "../lib/nativeErrors";
import { ImageLightbox } from "../features/editor/ImageLightbox";
import { uploadLakeResource } from "../features/editor/resourceUpload";
import { QuickNoteEditor, type QuickNoteEditorApi } from "../features/quickNotes/QuickNoteEditor";
import { QuickNotePreview } from "../features/quickNotes/QuickNotePreview";
import { toggleTaskInBody } from "../features/quickNotes/quickNotePreviewParser";
import { openImagePreview } from "../features/editor/imagePreview";
import { clampPopoverPosition } from "../hooks/topMenuPosition";
import { Dialog, Menu } from "./ui/Overlay";

interface DraftImage {
  image: QuickNoteImage;
  source: "saved" | "staged";
}

interface DraftState {
  id: string;
  /** 纯文本镜像（由编辑器产出；判定「有内容」与预览）。 */
  text: string;
  /** 内核形态正文（编辑器产出；保存写入 `.qnote.body`）。 */
  body: string;
  images: DraftImage[];
  /**
   * 载入时的基线（**判定"有没有改过"用**）。
   * 曾经用 `hasDraftContent()` 判脏 ⇒ 只要编辑一条已有小记（它本来就有内容）就永远是"脏"的，
   * 于是切来切去总弹「是否放弃编辑」，还会把没改动的正文重写一遍（连带触发 S3）。用户 260919 报。
   */
  baseline: { text: string; body: string; imageCount: number };
}

export interface QuickNotesWorkspaceHandle {
  /** 返回 true 代表可以离开当前小记页面；false 代表用户选择继续编辑。 */
  confirmLeave(): Promise<boolean>;
  /** 同步完成后刷新小记列表。 */
  refresh(): Promise<void>;
}

interface QuickNotesWorkspaceProps {
  notebooks: TreeNode[];
  /** 工作区级可见性（keep-alive：小记视图被隐藏时仍挂载，但**不建内核实例** —— 见 QuickNoteEditor.active）。 */
  visible?: boolean;
  onConverted(note: NoteDocument): void;
  onDirtyChange(dirty: boolean): void;
}

const newDraft = (): DraftState => ({ id: crypto.randomUUID(), text: "", body: "", images: [], baseline: { text: "", body: "", imageCount: 0 } });

/** 用一条已保存小记开一份编辑草稿（基线 = 载入内容，用于"改没改过"判定）。 */
const draftOf = (item: QuickNoteDocument): DraftState => ({
  id: crypto.randomUUID(),
  text: item.content.text,
  body: item.content.body,
  images: item.content.images.map((image) => ({ image, source: "saved" as const })),
  baseline: { text: item.content.text, body: item.content.body, imageCount: item.content.images.length },
});
const hasDraftContent = (draft: DraftState) => draft.text.trim().length > 0 || draft.images.length > 0;
/**
 * 「改过没有」= 与载入基线比较（不是"有没有内容"）。
 * 文本先做**去噪归一**：内核空文档的 `text/plain` 是 `"\uFEFF\n"`（零宽 BOM + 换行），
 * 直接字符串比较会把"没动过的新草稿"判成脏（260919 用户报：列表页点条目打不开、还弹「请至少记录文字或一张图片」）。
 */
const normalizeMirror = (text: string) => text.replace(/[\uFEFF\u200B]/g, "").trim();
const isDraftDirty = (draft: DraftState) =>
  normalizeMirror(draft.text) !== normalizeMirror(draft.baseline.text) || draft.images.length !== draft.baseline.imageCount;

/**
 * 正文里是否还有「上传中」的媒体卡。内核的卡片值把状态写在 `status` 字段（`data:` + encodeURIComponent，
 * 两种形态都要认）：图片卡 pending/uploading、视频/音频/附件卡同样先落 pending 节点再回填 url。
 * 保存必须等它消失，否则会把 `url:null` 的 pending 卡写进正文 ⇒ 卡片流看着有、一进编辑就没了。
 */
function hasPendingMediaCard(body: string): boolean {
  return body.includes("%22status%22%3A%22pending%22") || body.includes("%22status%22%3A%22uploading%22")
    || body.includes('"status":"pending"') || body.includes('"status":"uploading"');
}

/**
 * 列表行的标题文案：**只取前 10 个字**（用户 260919：列表列很窄，不用整段渲染再省略）。
 * 用主进程已算好的 `previewText`（截断 120 字），并剥掉内核 text/plain 的待办前缀 `[ ]` / `[x]`。
 */
const indexLabel = (item: QuickNoteDocument): string => {
  const raw = (item.previewText || item.content.text || "").replace(/^\[\s*[xX]?\s*\]\s*/, "").trim();
  if (!raw) return "（无文字）";
  return raw.length > 10 ? `${raw.slice(0, 10)}…` : raw;
};

/** 列表版式的时间戳（对齐云端）：今天 = 「今天 HH:MM」，其余 = 「MM-DD」。 */
function indexStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
  writeLocalStorage(SORT_KEY, value);
};

/**
 * 小记的两种版式（对齐语雀云端，用户 260919 定）：
 * - `note`：写作卡（小块，图片/待办 + 展开）+ 卡片流；
 * - `list`：索引列表（标题 + 时间，选中高亮）+ 右侧**全尺寸编辑器**（完整工具栏）。
 * 同 sortBy：**纯展示偏好**，只存本机 localStorage，不进 S3（各端各按自己的偏好展示）。
 */
/**
 * 置顶（用户 260919 指明）：**纯本地**，不进 S3。
 * 依据（已核查）：小记的同步清单只带 `{id, createdAt, updatedAt, contentHash, isConflict, images}`，
 * 没有任何顺序/置顶字段；各端各按本机偏好排序（桌面存 localStorage，移动端按 updated_at）。
 */
const PIN_KEY = "lake-notes-v3.quick-notes-pinned";
const readPins = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
};
const writePins = (value: Set<string>): void => {
  writeLocalStorage(PIN_KEY, JSON.stringify([...value]));
};

type QuickNotesView = "note" | "list";
const VIEW_KEY = "lake-notes-v3.quick-notes-view";
const readViewPref = (): QuickNotesView => {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "note"; } catch { return "note"; }
};
const writeViewPref = (value: QuickNotesView): void => {
  writeLocalStorage(VIEW_KEY, value);
};

export const QuickNotesWorkspace = forwardRef<QuickNotesWorkspaceHandle, QuickNotesWorkspaceProps>(function QuickNotesWorkspace(props, ref) {
  const { notebooks: notebookNodes, visible = true, onConverted, onDirtyChange } = props;
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
  /** 版式：小记卡（note）/ 列表（list）（纯展示偏好，存 localStorage，不参与同步） */
  const [viewMode, setViewMode] = useState<QuickNotesView>(() => readViewPref());
  const [sortOpen, setSortOpen] = useState(false);
  /** 排序菜单定位（标准 <Menu> 走 portal，需内联 left/top）。 */
  const [sortMenuPos, setSortMenuPos] = useState<{ top: number; left: number } | null>(null);
  /** 行内「⋯」菜单（列表视图，对齐云端图2）：记录当前展开的是哪一条。 */
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [rowMenuPos, setRowMenuPos] = useState<{ top: number; left: number } | null>(null);
  /** 轻提示（标签暂固定全部等）。 */
  const [viewHint, setViewHint] = useState<string | null>(null);
  /** 置顶集合（纯本机偏好，不进 S3）。 */
  const [pinned, setPinned] = useState<Set<string>>(() => readPins());
  const deleteTimer = useRef<number | null>(null);
  /** 编辑器句柄**按草稿 id** 存（写作面板与内联编辑会同时挂两个实例，共用一个 ref 会互相覆盖）。 */
  const draftEditorsRef = useRef(new Map<string, QuickNoteEditorApi>());
  /** 进行中的资源上传/暂存数（保存前要等它归零，否则会写出「有卡没资源」或「有资源没卡」）。 */
  const pendingUploadsRef = useRef(0);
  /** 最近一次上传收尾时间：用于区分"内核刚回填 url 的几十毫秒窗口"和"上次会话留下的死卡"。 */
  const lastUploadSettledAtRef = useRef(0);
  /** 最新草稿快照（保存时点击在前、上传落地在后，需要读到更新后的那份）。 */
  const draftsRef = useRef<{ create: DraftState; editing: DraftState | null }>({ create: createDraft, editing: editingDraft });
  /**
   * 本会话刚落 staging 的资源，**同步**登记（按草稿 id 分组）。
   * 为什么不能只靠 state：点「保存」可能早于上传 promise 的 setState 渲染落地，
   * 那样算出来的资源清单是空的 ⇒ 正文有卡片、资源却没被 promote（用户 260919 报「一编辑就消失」的成因之一）。
   */
  const stagedAssetsRef = useRef(new Map<string, DraftImage[]>());
  const listVersionRef = useRef(createRequestVersion());
  // 撤销窗口内「尚未落盘删除」的小记 id：外部刷新（如同步完成）不得让它重新出现。
  const pendingDeleteIdRef = useRef<string | null>(null);

  const activeIsEditing = editingDraft !== null;
  // 「有未保存改动」= 新建草稿有内容，或编辑中的草稿与载入基线不同（不再拿"有没有内容"当脏判据）
  const dirty = isDraftDirty(createDraft) || (editingDraft !== null && isDraftDirty(editingDraft));

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

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!viewHint) return;
    const timer = window.setTimeout(() => setViewHint(null), 2600);
    return () => window.clearTimeout(timer);
  }, [viewHint]);

  useEffect(() => { draftsRef.current = { create: createDraft, editing: editingDraft }; }, [createDraft, editingDraft]);


  useEffect(() => { pendingDeleteIdRef.current = pendingDelete?.id ?? null; }, [pendingDelete]);

  useImperativeHandle(ref, () => ({
    async refresh() {
      await refreshItems();
    },
    async confirmLeave() {
      // 离开小记页同样"默认保存"（用户 260919）：没改动时不写库；保存失败则留在原地。
      if (!dirty) return true;
      return saveBeforeSwitch();
    },
  }));

  const notebooks = useMemo(() => notebookNodes
    .filter((node) => node.nodeType === "notebook")
    .sort((a, b) => a.sortOrder - b.sortOrder), [notebookNodes]);

  /** 把刚落入 staging 的图片追加到对应草稿的图片清单（保存时据此 promote 文件）。 */
  function appendStagedImage(draftId: string, image: QuickNoteImage) {
    const entry = { image, source: "staged" as const };
    // 同步登记一份（保存路径据此算资源清单，不依赖 React 渲染时序）
    const staged = stagedAssetsRef.current.get(draftId) ?? [];
    if (!staged.some((item) => item.image.id === image.id)) {
      stagedAssetsRef.current.set(draftId, [...staged, entry]);
    }
    if (editingDraft?.id === draftId) setEditingDraft((current) => current ? { ...current, images: [...current.images, entry] } : current);
    else if (createDraft.id === draftId) setCreateDraft((current) => ({ ...current, images: [...current.images, entry] }));
  }

  /** 草稿资源清单 = UI 状态 ∪ 本会话同步登记的 staging 资源（按 id 去重，state 落后时不丢资源）。 */
  function draftAssets(draft: DraftState): DraftImage[] {
    const staged = stagedAssetsRef.current.get(draft.id) ?? [];
    const known = new Map(draft.images.map((item) => [item.image.id, item]));
    for (const item of staged) if (!known.has(item.image.id)) known.set(item.image.id, item);
    return [...known.values()];
  }

  /**
   * 小记编辑态的资源上传钩子（交给 Lake 编辑器）：图片落小记 staging 空间，卡片 src 用 staging URL；
   * 保存时主进程把作用域改写成 `/quick-notes/<小记id>/`。网络图片 v1 拒绝（提示先存本地再拖入）。
   * 附件（非图片，内核 file 卡）走 `stageQuickNoteFile`，与图片共用同一 staging/promote 管线。
   */
  function quickNoteUploader(draftId: string) {
    return (request: unknown) => {
      // 记「进行中」：从内核发起上传（含排队）到暂存+记录完成；保存要等它归零，
      // 否则会写出有卡无资源 / 有资源无卡 的不一致数据。
      pendingUploadsRef.current += 1;
      return uploadLakeResource(request, draftId, {
        allowRemoteDownload: false,
        saveResource: async (input) => {
        setError(null);
        try {
          // 字节**原样**交给 IPC：`input.bytes` 是 Uint8Array，走结构化克隆一次拷贝即可；
          // 早前用 `Array.from()` 转 number[]（沿用旧图片路径）⇒ 附件上限 100MiB 时凭空多出几百 MB 的 JS 数组。
          const payload = { bytes: input.bytes, filename: input.filename };
          // 该输入来自内核 file input（只有字节 + 文件名），没有 MIME ⇒ 按扩展名分流。
          const isImage = /\.(png|jpe?g|gif|webp|avif|bmp|svg|tiff?)$/i.test(input.filename);
          const image = isImage
            ? await native.stageQuickNoteImage(draftId, payload)
            : await native.stageQuickNoteFile(draftId, payload);
          if (!image.url) throw new Error("小记资源暂存地址缺失");
          appendStagedImage(draftId, image);
          return { url: image.url, resourceRef: image.url, filename: image.filename, mimeType: image.mimeType, size: image.size };
        } catch (reason) {
          setError(`添加文件失败：${getNativeErrorMessage(reason)}`);
          throw reason;
        }
        },
      }).finally(() => {
        pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current - 1);
        lastUploadSettledAtRef.current = Date.now();
      });
    };
  }

  /**
   * 保存指定草稿（**由点击的那个 composer 传入自己那份草稿**）。
   *
   * 260919 修两个真 bug：
   * ① 从前 save 用 `activeDraft = editingDraft ?? createDraft` 且编辑器句柄是**单个共享 ref** ⇒
   *    内联编辑打开时，写作面板的「小记一下」会去保存**被编辑的那条小记**，且拿到的可能是另一份文档的正文
   *    （HANDOFF §2.10 潜在缺陷 7）。
   * ② 内核插卡是**异步**的（视频/音频/附件卡要等上传任务完成才进模型）⇒ 选完文件立刻保存，会写出
   *    「资源清单里有、正文里没有卡」的坏数据：卡片流看着正常（它渲染资源清单），一进编辑就"消失"。
   *    处理口径（260920 定稿，**对齐文档侧**）：
   *    - **本会话真的在传**的上传（`pendingUploadsRef`）才等（最多 15s），等到了就写完整数据；
   *    - 等不到 / 正文里有**历史遗留的 pending 死卡**（上次会话被杀留下的）⇒ **照存**、只给一句提示，
   *      绝不因为死卡把整条小记锁死在编辑器里（文档保存本来就不等、不拒绝）；
   *    - 同时按「正文真正引用的资源」收敛清单（顺手解决"编辑器里删掉卡片但资源仍在清单"的幽灵资源）。
   */
  async function saveDraft(clicked: DraftState): Promise<boolean> {
    if (saving) return false;
    setSaving(true); setError(null);
    try {
      // ① 点击可能早于上传/暂存完成 ⇒ 先等**本会话真的在传**的上传落地，再取**最新**草稿
      //    （资源是在这之后追加进 draft.images 的）。等不到也不再拦保存 —— 见下面 ② 的口径：
      //    **文档侧保存从不因为"卡还在上传中"而拒绝**（`useWorkspaceState`/`EditorTab` 里没有任何 pending 判断），
      //    正文原样存下即可；这里只提示一句（用户 260920 定稿：复用文档行为）。
      if (pendingUploadsRef.current > 0 && !(await waitForPendingUploads())) {
        setViewHint("还有附件在处理中，已按当前内容保存");
      }
      const draft = currentDraftFor(clicked);
      const isEditing = editingDraft !== null && draft.id === editingDraft.id;
      if (!hasDraftContent(draft)) { setError("请至少记录文字、一张图片或一个附件"); return false; }
      // 正文以编辑器实时内容为准；编辑器取不到时回落到镜像（两者同源，见 QuickNoteEditor）。
      const api = draftEditorsRef.current.get(draft.id) ?? null;
      const editorText = api ? api.getText() : "";
      const text = editorText.trim() ? editorText : draft.text;
      let body = api ? api.getBody() : draft.body;
      const assetKey = (item: DraftImage): string => item.image.url?.split("/").pop() ?? "";
      // ② 媒体卡是「先落 pending 节点、上传完成后再回填 url」。**只在本会话还有上传在传时**等它落定
      //    （否则会把 `url:null` 的 pending 卡写进正文，就是用户 260919 报的「一编辑视频/附件就消失」）；
      //    本会话没在传、正文里却还有 pending/uploading 的卡 ⇒ 那是**上一次会话中断留下的死卡**
      //    （用户 260920 遇到的那种）：**照存**、只提示，绝不因为死卡把整条小记锁死在编辑器里。
      //    这与文档侧一致（文档保存不会等、也不会因此拒绝；死卡在文档里同样是"上传中"占位）。
      if (api && hasPendingMediaCard(body)) {
        // 有上传在传 ⇒ 等满 15s（正常几十毫秒就落定）；没有在传 ⇒ 只等一个**很短的收尾窗口**
        // （内核"上传完成 → 回填 url"和我们计数归零之间有几十毫秒，不覆盖它就会把 url:null 写进去）。
        // 这个短窗口只在"刚上传完 2s 内"才等：**上次会话留下的死卡**（早已无上传）直接跳过，保存瞬时完成。
        const graceMs = pendingUploadsRef.current > 0
          ? 15000
          : (Date.now() - lastUploadSettledAtRef.current < 2000 ? 1200 : 0);
        const deadline = Date.now() + graceMs;
        while (Date.now() < deadline && hasPendingMediaCard(body)) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          body = api.getBody();
        }
      }
      if (api && hasPendingMediaCard(body)) setViewHint("有媒体还没上传完，已按当前内容保存");
      // ③ **没改动就不写库**（用户 260919 要求）：既不重写正文，也不会把 `sync_state` 打回 'local'
      //    （否则"点开编辑 → 切到别的"都会平白触发一次 S3 上传）。以**正文**为准比较（比文本镜像可靠），
      //    另外把新增/删除的资源数量算进去。命中直接退出编辑态、不发任何 IPC。
      if (isEditing) {
        const unchanged = body === draft.baseline.body && draft.images.length === draft.baseline.imageCount;
        if (unchanged) { settleAfterSave(draft, { text, body, images: draft.images }); return true; }
      }
      const assets = draftAssets(draft);
      const stagedAssets = assets.filter((item) => item.source === "staged");
      /** 等异步插卡落进正文：只等**暂存**资源（已有资源本就在正文里），且只在还有上传在传时等。 */
      if (api && stagedAssets.length > 0) {
        const graceMs = pendingUploadsRef.current > 0
          ? 15000
          : (Date.now() - lastUploadSettledAtRef.current < 2000 ? 1200 : 0);
        const deadline = Date.now() + graceMs;
        while (Date.now() < deadline && stagedAssets.some((item) => { const key = assetKey(item); return key && !body.includes(key); })) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          body = api.getBody();
        }
        // 等超时也不再拒绝保存（文档侧同款），只提示：没进正文的暂存文件会随草稿丢弃（不会变成幽灵资源）。
        const stragglers = stagedAssets.filter((item) => { const key = assetKey(item); return key && !body.includes(key); });
        if (stragglers.length > 0) setViewHint(`有 ${stragglers.length} 个附件还没落到正文，已按当前内容保存`);
      }
      // 按「正文真正引用」收敛清单：正文里没有的（如编辑器中已删卡）不再保存，避免幽灵资源。
      const referenced = assets.filter((item) => { const key = assetKey(item); return !key || body.includes(key); });
      const stagedImageIds = referenced.filter((item) => item.source === "staged").map((item) => item.image.id);
      const retainedImageIds = referenced.filter((item) => item.source === "saved").map((item) => item.image.id);
      const saved = isEditing && editingId
        ? await native.updateQuickNote(editingId, { text, body, draftId: draft.id, stagedImageIds, retainedImageIds })
        : await native.createQuickNote({ text, body, draftId: draft.id, stagedImageIds });
      listVersionRef.current.invalidate();
      setItems((current) => {
        const without = current.filter((item) => item.id !== saved.id);
        return [saved, ...without].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      if (isEditing) settleAfterSave(draft, { text, body, images: saved.content.images.map((image) => ({ image, source: "saved" as const })) });
      else if (createDraft.id === draft.id) setCreateDraft(newDraft());
      return true;
    } catch (reason) { setError(`保存小记失败：${getNativeErrorMessage(reason)}`); return false; }
    finally { setSaving(false); }
  }

  /**
   * 取消某一份草稿（**由点击的那个 composer 传自己那份**，与 saveDraft 同一口径）。
   * 260920 修的 bug：此前用 `activeDraft = editingDraft ?? createDraft` ⇒ 在块状视图里编辑某张卡片时，
   * 点左侧写作卡的「取消」会把**右边正在编辑的那条小记**取消掉（编辑态被关、staging 被误删），
   * 而写作卡自己的草稿反而没被清掉。
   */
  async function cancelDraft(draft: DraftState) {
    if (!hasDraftContent(draft) || window.confirm("放弃这次未保存的小记？")) {
      await native.discardQuickNoteDraft(draft.id).catch((error) => reportNativeActionError("丢弃小记草稿", error));
      stagedAssetsRef.current.delete(draft.id);
      if (editingDraft?.id === draft.id) {
        const item = items.find((candidate) => candidate.id === editingId);
        // 列表视图：取消 = 放弃改动后回到该条的**已保存状态**。直接原地重开这份草稿（一次提交、只重建一次编辑器）；
        // 不能"先清空再靠默认选中补回来" —— 那是两次提交 = 连拆两次编辑器，肉眼一闪（用户 260920 报的闪烁）。
        if (viewMode === "list" && item) { setEditingDraft(draftOf(item)); return; }
        setEditingId(null); setEditingDraft(null);
      } else if (createDraft.id === draft.id) setCreateDraft(newDraft());
    }
  }

  async function startEditing(item: QuickNoteDocument) {
    if (editingId === item.id) return;
    // 切换默认保存（用户 260919）：有改动先把当前草稿存下来（没改动时 saveDraft 直接跳过、不写库），
    // 只有保存失败才中止切换，避免"以为存了其实没存"。
    if (dirty && !(await saveBeforeSwitch())) return;
    setEditingId(item.id); setEditingDraft(draftOf(item));
  }

  /** 列表版式的「新建小记」：切回新建草稿（当前未保存内容先确认）。 */
  async function startNewDraft() {
    if (!editingDraft) return;
    if (dirty && !(await saveBeforeSwitch())) return;
    setEditingId(null);
    setEditingDraft(null);
  }

  /**
   * 卡片预览里勾选待办（用户 260919：#3 只做这一个交互）。
   * 按序号改写正文里对应的 checkbox 卡值 → 走既有 updateQuickNote（正文/资源清单/同步链路一致），
   * 成功后就地刷新该条卡片；失败给可见提示。
   */
  async function togglePreviewTask(noteId: string, checkboxIndex: number, checked: boolean) {
    const item = items.find((candidate) => candidate.id === noteId);
    if (!item) return;
    const body = toggleTaskInBody(item.content.body, checkboxIndex, checked);
    if (body === item.content.body) return;
    try {
      const saved = await native.updateQuickNote(noteId, {
        text: item.content.text,
        body,
        draftId: crypto.randomUUID(),
        stagedImageIds: [],
        retainedImageIds: item.content.images.map((asset) => asset.id),
      });
      listVersionRef.current.invalidate();
      setItems((current) => current.map((candidate) => (candidate.id === noteId ? saved : candidate)));
    } catch (reason) { setError(`更新待办失败：${getNativeErrorMessage(reason)}`); }
  }

  /** 置顶/取消置顶（纯本地）。 */
  function togglePin(id: string) {
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      writePins(next);
      return next;
    });
  }

  function switchView(next: QuickNotesView) {
    setViewMode(next);
    writeViewPref(next);
  }

  /** 复制小记纯文本（云端的「复制链接」在本地语义下换成复制文本；小记没有可分享链接）。 */
  async function copyNoteText(item: QuickNoteDocument) {
    try {
      await navigator.clipboard.writeText(item.content.text ?? "");
      setViewHint("已复制小记文本");
    } catch { setError("复制失败：剪贴板不可用"); }
  }

  /** 编辑器挂载/卸载登记（按草稿 id；两个 composer 并存时互不覆盖）。 */
  function handleEditorReady(draftId: string, api: QuickNoteEditorApi | null) {
    if (api) draftEditorsRef.current.set(draftId, api);
    else draftEditorsRef.current.delete(draftId);
  }

  /**
   * 切换/离开前的保存：**空白草稿直接放行**（不写库、不报错）。
   * 只有真的写了内容才走 saveDraft —— 否则"点开列表里某条"会因为空草稿被判脏而弹「请至少记录文字或一张图片」。
   */
  async function saveBeforeSwitch(): Promise<boolean> {
    const draft = editingDraft ?? createDraft;
    if (!hasDraftContent(draft)) return true;
    return saveDraft(draft);
  }

  /** 等进行中的资源上传/暂存归零（最多 15s）。false = 仍未落地（调用方**只提示、不再拒绝保存**）。 */
  async function waitForPendingUploads(): Promise<boolean> {
    const deadline = Date.now() + 15000;
    while (pendingUploadsRef.current > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return pendingUploadsRef.current === 0;
  }

  /**
   * 保存成功后收尾（成功路径与"没改动不写库"那条早退路径共用）。
   *
   * **列表视图：留在编辑器里**（云端语义：右侧始终是打开的那条），只把基线刷新成刚存下的内容 ——
   * 不能"关掉再由默认选中补回来"：那是两次提交 = 连拆两次内核编辑器（先换回新建面板、再重开该条），
   * 肉眼一闪一闪且"退不出去"（用户 260920 报）。基线用**编辑器实时正文**，这样再点保存仍会被
   * "没改动不写库"命中；不动 `draft.body`（它是 `initialBody`，改它会触发 QuickNoteEditor 重挂载）。
   *
   * 其他视图（分块视图的卡片编辑）：照旧关掉编辑态，回到卡片列表。
   */
  function settleAfterSave(draft: DraftState, values: { text: string; body: string; images: DraftImage[] }) {
    // 判据用草稿身份（`editingDraft`）而不是笔记 id：列表视图里"正在编辑的是这份草稿"才原地留存。
    if (viewMode === "list" && editingDraft?.id === draft.id) {
      stagedAssetsRef.current.delete(draft.id);
      setEditingDraft((current) => current && current.id === draft.id
        ? {
            ...current,
            text: values.text,
            images: values.images,
            baseline: { text: values.text, body: values.body, imageCount: values.images.length },
          }
        : current);
      return;
    }
    setEditingId(null); setEditingDraft(null);
  }

  /** 取该草稿的最新状态（上传落地后 draft.images 才会带上新资源）。 */
  function currentDraftFor(draft: DraftState): DraftState {
    const { create, editing } = draftsRef.current;
    if (editing && editing.id === draft.id) return editing;
    if (create.id === draft.id) return create;
    return draft;
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
    setSelecting(true);   // 卡片左侧的勾选框随时可用：点它就进多选（无需单独的"多选"按钮）
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
    // 置顶优先（纯本机偏好），同组内按所选顺序
    return [...items].sort((a, b) => {
      const pinDiff = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
      return pinDiff !== 0 ? pinDiff : key(b).localeCompare(key(a));
    });
  }, [items, sortBy, pinned]);

  /**
   * 列表页默认选中第一条（用户 260919）：进列表视图 / 首次加载时，若没有正在编辑的小记，
   * 自动打开第一条（没有小记时保持空态）。这样进来就是"左边列表 + 右边内容"，不会是一张空白编辑器。
   */
  useEffect(() => {
    // 隐藏时不预选（keep-alive 视图里建草稿没有意义，还要避免在不可见状态下触发"切换前保存"）
    if (!visible || viewMode !== "list" || loading || activeIsEditing) return;
    const first = visibleItems[0];
    if (!first) return;
    void startEditing(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, viewMode, loading, activeIsEditing, visibleItems.length]);

  /** 排序菜单：标准 <Menu> 走 portal，按触发按钮实测矩形定位。 */
  const toggleSortMenu = (button: HTMLElement) => {
    if (sortOpen) { setSortOpen(false); return; }
    const rect = button.getBoundingClientRect();
    setSortMenuPos(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 140, height: 84 }, 6));
    setSortOpen(true);
  };
  /** 行内 ⋯ 菜单：同上。 */
  const toggleRowMenu = (button: HTMLElement, id: string) => {
    if (rowMenuId === id) { setRowMenuId(null); return; }
    const rect = button.getBoundingClientRect();
    setRowMenuPos(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 150, height: 180 }, 6));
    setRowMenuId(id);
  };
  const rowMenuItem = rowMenuId ? items.find((item) => item.id === rowMenuId) ?? null : null;

  // 左右两栏（对齐云端语雀小记）：左＝常驻写作面板 + 发布行，右＝小记卡片流（各自独立滚动）。
  return <section className="quick-notes-pane" aria-label="小记">
    <header className="quick-notes-header">
      <div className="quick-notes-title">
        <h1>小记</h1>
        {/* 版式切换（对齐云端：标题右侧的分段控件；左侧=列表视图，右侧=小记卡视图） */}
        <div className="seg quick-notes-view-switch" role="group" aria-label="小记版式">
          <button
            className={"b3-button b3-button--outline seg__item" + (viewMode === "list" ? " is-active" : "")}
            aria-pressed={viewMode === "list"} title="列表视图" aria-label="列表视图"
            onClick={() => switchView("list")}
          ><LayoutList size={14} /></button>
          <button
            className={"b3-button b3-button--outline seg__item" + (viewMode === "note" ? " is-active" : "")}
            aria-pressed={viewMode === "note"} title="小记视图" aria-label="小记视图"
            onClick={() => switchView("note")}
          ><StickyNote size={14} /></button>
        </div>
      </div>
      <div className="quick-notes-header-tools">
        {/* 多选工具左对齐（与卡片勾选框同列），「N 条 / 排序」始终保留在右侧 —— 两块同时可见。
            列表视图有自己那条批量条（对齐云端），这里不再重复渲染。 */}
        {selecting && viewMode === "note" && <>
          <button className={"qn-check" + (selected.size > 0 && selected.size === items.length ? " is-on" : "")} role="checkbox" aria-checked={selected.size > 0 && selected.size === items.length} aria-label="全选" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}>{selected.size > 0 && selected.size === items.length && <Check size={13} />}</button>
          <span className="quick-notes-select-info">共选择了 {selected.size} 篇小记</span>
          <span className="quick-notes-tools-divider" />
          <button className="quick-notes-link" onClick={exitSelecting}>取消</button>
          <button className="quick-notes-link" disabled={selected.size === 0 || saving} onClick={() => setConvertItems(items.filter((item) => selected.has(item.id)))}>转为文档</button>
          <button className="quick-notes-link quick-notes-link--danger" disabled={selected.size === 0 || saving} onClick={() => void deleteSelected()}>批量删除</button>
        </>}
        <span className="quick-notes-tools-spacer" />
        {viewMode === "list" && <button className="quick-notes-new" title="新建小记" aria-label="新建小记" onClick={() => void startNewDraft()}>
          <span className="quick-notes-new__icon"><Feather size={14} /><Plus size={9} /></span>
        </button>}
        <span className="quick-notes-count">{items.length} 条</span>
        <div className="quick-notes-sort-wrap">
          <button className="quick-notes-tool-btn" onClick={(event) => toggleSortMenu(event.currentTarget)} aria-haspopup="menu" aria-expanded={sortOpen} title={sortBy === "updated" ? "排序：按更新时间" : "排序：按创建时间"} aria-label="排序"><ArrowUpDown size={16} /></button>
        </div>
      </div>
    </header>
    {viewHint && <div className="quick-notes-hint" role="status">{viewHint}</div>}
    {error && <div className="quick-notes-error"><span>{error}</span><button onClick={() => setError(null)} aria-label="关闭错误"><X size={15} /></button></div>}
    {viewMode === "list" ? <div className="quick-notes-split quick-notes-split--list">
      {/* 列表视图（对齐云端 https://www.yuque.com/dashboard/notes）：左＝索引列表（批量条 + 行⋯菜单），
          右＝编辑器。功能都复用分块视图里已有的动作（编辑/转为正式笔记/删除/多选），这里只是把 UI 补上。 */}
      <div className="quick-notes-index-wrap">
        <div className="quick-notes-index-tools">
          <span className="quick-notes-tools-spacer" />
          <span className="quick-notes-count">{items.length} 条</span>
          <div className="quick-notes-sort-wrap">
            <button className="quick-notes-tool-btn" onClick={(event) => toggleSortMenu(event.currentTarget)} aria-haspopup="menu" aria-expanded={sortOpen} title={sortBy === "updated" ? "排序：按更新时间" : "排序：按创建时间"} aria-label="排序"><ArrowUpDown size={16} /></button>
          </div>
        </div>
        {/* 批量条（对齐云端图1）：勾选框 + N 篇 + 取消 + 动作 */}
        {selecting && <div className="quick-notes-batch">
          <button
            className={"qn-check" + (selected.size > 0 && selected.size === items.length ? " is-on" : "")}
            role="checkbox" aria-checked={selected.size > 0 && selected.size === items.length} aria-label="全选"
            onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
          >{selected.size > 0 && selected.size === items.length && <Check size={13} />}</button>
          <span className="quick-notes-select-info">{selected.size} 篇</span>
          <span className="quick-notes-tools-divider" />
          <button className="quick-notes-link" onClick={exitSelecting}>取消</button>
          <span className="quick-notes-tools-spacer" />
          <button className="quick-notes-tool-btn" title="转为正式文档" aria-label="转为正式文档" disabled={selected.size === 0 || saving} onClick={() => setConvertItems(items.filter((item) => selected.has(item.id)))}><FilePlus size={16} /></button>
          <button className="quick-notes-tool-btn quick-notes-tool-btn--danger" title="批量删除" aria-label="批量删除" disabled={selected.size === 0 || saving} onClick={() => void deleteSelected()}><Trash size={16} /></button>
        </div>}
        <div className="quick-notes-index b3-list b3-list--background">
          {loading
            ? <div className="ln-empty"><LoaderCircle className="spin" size={18} /><span>正在读取小记…</span></div>
            : items.length === 0
              ? <div className="ln-empty ln-empty--idle"><Feather size={22} /><span>还没有小记</span></div>
              : visibleItems.map((item) => <div
                  key={item.id}
                  className={"quick-note-index-row b3-list-item" + (selecting ? " is-selecting" : "") + (!selecting && editingId === item.id ? " b3-list-item--focus" : "") + (selected.has(item.id) ? " is-checked" : "")}
                >
                  <button
                    className={"qn-check quick-note-index-check" + (selected.has(item.id) ? " is-on" : "")}
                    role="checkbox" aria-checked={selected.has(item.id)} aria-label={selected.has(item.id) ? "取消选择" : "选择这篇小记"}
                    onClick={(event) => { event.stopPropagation(); toggleSelected(item.id); }}
                  >{selected.has(item.id) && <Check size={13} />}</button>
                  <button className="quick-note-index-main" onClick={() => (selecting ? toggleSelected(item.id) : void startEditing(item))} title={item.content.text?.trim() || "空小记"}>
                    <span className="b3-list-item__text ln-ellipsis">{indexLabel(item)}</span>
                    <span className="b3-list-item__meta">{indexStamp(item.updatedAt || item.createdAt)}</span>
                  </button>
                  <span className="quick-note-index-actions">
                    <button className="quick-notes-tool-btn" title="更多" aria-label="更多" aria-haspopup="menu" aria-expanded={rowMenuId === item.id} onClick={(event) => { event.stopPropagation(); toggleRowMenu(event.currentTarget, item.id); }}><MoreHorizontal size={16} /></button>
                  </span>
                </div>)
          }
        </div>
      </div>
      <div className="quick-notes-detail">
        {activeIsEditing && editingDraft
          ? <QuickNoteComposer
              draft={editingDraft} variant="inline" ui="full" active={visible} saving={saving && activeIsEditing}
              uploadResource={quickNoteUploader(editingDraft.id)}
              onTextChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
              onEditorReady={(api) => handleEditorReady(editingDraft.id, api)}
              onSave={() => void saveDraft(editingDraft)} onCancel={() => void cancelDraft(editingDraft)}
            />
          : <QuickNoteComposer
              draft={createDraft} variant="pane" ui="full" active={visible} saving={saving && !activeIsEditing}
              uploadResource={quickNoteUploader(createDraft.id)}
              onTextChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
              onEditorReady={(api) => handleEditorReady(createDraft.id, api)}
              onSave={() => void saveDraft(createDraft)} onCancel={() => void cancelDraft(createDraft)}
            />}
      </div>
    </div> : <div className="quick-notes-split">
      <div className="quick-notes-compose">
        <QuickNoteComposer
          draft={createDraft}
          variant="pane"
          active={visible}
          saving={saving && !activeIsEditing}
          uploadResource={quickNoteUploader(createDraft.id)}
          onTextChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
          onEditorReady={(api) => handleEditorReady(createDraft.id, api)}
          onSave={() => void saveDraft(createDraft)}
          onCancel={() => void cancelDraft(createDraft)}
        />
      </div>
      <div className={"quick-notes-list" + (selecting ? " selecting" : "")}>
        <div className="quick-notes-timeline" aria-live="polite">
          {loading ? <div className="ln-empty"><LoaderCircle className="spin" size={18} /><span>正在读取小记…</span></div> : items.length === 0
            ? <div className="ln-empty ln-empty--idle"><Feather size={25} /><strong>还没有小记</strong><span>从左侧写下第一条临时记录。</span></div>
            : visibleItems.map((item) => editingId === item.id && editingDraft
              ? <article className="quick-note-entry editing" key={item.id}><QuickNoteComposer
                  draft={editingDraft} variant="inline" active={visible} saving={saving && activeIsEditing}
                  uploadResource={quickNoteUploader(editingDraft.id)}
                  onTextChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
                  onEditorReady={(api) => handleEditorReady(editingDraft.id, api)}
                  onSave={() => void saveDraft(editingDraft)} onCancel={() => void cancelDraft(editingDraft)}
                /></article>
              : <QuickNoteCard key={item.id} item={item} deletePending={pendingDelete !== null} selecting={selecting} checked={selected.has(item.id)} onToggleSelect={() => toggleSelected(item.id)} onEdit={() => void startEditing(item)} onDelete={() => scheduleDelete(item)} onConvert={() => setConvertItems([item])} onToggleTask={(checkboxIndex, checked) => void togglePreviewTask(item.id, checkboxIndex, checked)} />)
          }
        </div>
      </div>
    </div>}
    {/* 卡片里的图片点击放大：复用编辑器同一套 Lightbox 单例（与 EditorTab / LakeEditor 同款挂法） */}
    <ImageLightbox />
    {pendingDelete && <div className="quick-notes-toast" role="status" aria-live="polite"><span>已删除一条小记</span><button onClick={undoDelete}><RotateCcw size={14} />撤销</button></div>}
    {/* 排序菜单 / 行内 ⋯ 菜单：标准 <Menu>（portal + 外点/Esc + .quick-notes-*-menu 表面） */}
    <Menu open={sortOpen} onDismiss={() => setSortOpen(false)} surfaceClassName="quick-notes-sort-menu" style={sortMenuPos ?? undefined}>
      <button role="menuitemradio" aria-checked={sortBy === "updated"} onClick={() => { setSortBy("updated"); writeSortPref("updated"); setSortOpen(false); }}>{sortBy === "updated" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}按更新时间</button>
      <button role="menuitemradio" aria-checked={sortBy === "created"} onClick={() => { setSortBy("created"); writeSortPref("created"); setSortOpen(false); }}>{sortBy === "created" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}按创建时间</button>
    </Menu>
    {rowMenuItem && (
      <Menu onDismiss={() => setRowMenuId(null)} surfaceClassName="quick-note-row-menu" style={rowMenuPos ?? undefined}>
        <button role="menuitem" onClick={() => { setRowMenuId(null); togglePin(rowMenuItem.id); }}>{pinned.has(rowMenuItem.id) ? "取消置顶" : "置顶"}</button>
        <button role="menuitem" onClick={() => { setRowMenuId(null); void startEditing(rowMenuItem); }}>编辑</button>
        <button role="menuitem" onClick={() => { setRowMenuId(null); void copyNoteText(rowMenuItem); }}>复制文本</button>
        <button role="menuitem" onClick={() => { setRowMenuId(null); setConvertItems([rowMenuItem]); }}>转为正式笔记</button>
        <button role="menuitem" className="quick-notes-link--danger" onClick={() => { setRowMenuId(null); scheduleDelete(rowMenuItem); }} disabled={pendingDelete !== null}>删除</button>
      </Menu>
    )}
    {convertItems && convertItems.length > 0 && (
      <Dialog onDismiss={() => { if (!saving) setConvertItems(null); }} label={convertItems.length > 1 ? `转为正式文档（${convertItems.length} 篇）` : "转为正式笔记"} className="quick-note-convert-dialog">
        <div className="ln-dialog__body">
          <h3>{convertItems.length > 1 ? `转为正式文档（${convertItems.length} 篇）` : "转为正式笔记"}</h3>
          <p>选择一个笔记本。{convertItems.length > 1 ? `${convertItems.length} 篇小记将依次插入该笔记本的最顶部；` : "新文档将插入其中的最顶部；"}转化完成后，小记将从时间线移除。</p>
          <div className="quick-note-notebook-list b3-list b3-list--background">
            {notebooks.map((notebook) => <button key={notebook.id} className="b3-list-item" disabled={saving} onClick={() => void convert(notebook.id)}><span className="b3-list-item__graphic"><FilePlus size={14} /></span><span className="b3-list-item__text ln-ellipsis">{notebook.title}</span></button>)}
            {notebooks.length === 0 && <span className="ln-empty">请先在资料库中新建一个笔记本。</span>}
          </div>
          <footer><button className="b3-button b3-button--cancel" disabled={saving} onClick={() => setConvertItems(null)}>取消</button></footer>
        </div>
      </Dialog>
    )}
  </section>;
});

interface ComposerProps {
  /** 编辑器版式：card＝小卡片（分块视图）；full＝文档样式（列表视图右侧）。 */
  ui?: "card" | "full";
  draft: DraftState;
  /** 工作区可见性：透传给内核实例的挂载开关（隐藏视图里不建实例，见 QuickNoteEditor.active）。 */
  active?: boolean;
  /** pane＝常驻写作面板（发布行在卡片外，仿语雀）；inline＝编辑既有小记（动作行留在卡片内） */
  variant: "pane" | "inline";
  saving: boolean;
  /** 图片上传落盘（写进该草稿的 staging 空间）。 */
  uploadResource(request: unknown): Promise<ResourceUploadOutput>;
  onTextChange(text: string): void;
  onEditorReady(api: QuickNoteEditorApi | null): void;
  onSave(): void;
  onCancel(): void;
}

function QuickNoteComposer({ draft, saving, variant, ui = "card", active = true, uploadResource, onTextChange, onEditorReady, onSave, onCancel }: ComposerProps) {
  /** ⌘/Ctrl + Enter 发布（对齐语雀小记的快捷键提示）：编辑器可能吞键，故挂捕获阶段兜底。 */
  function publishOnShortcut(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onSave(); }
  }
  const publishLabel = variant === "pane" ? "小记一下" : "保存";
  /** 有内容才强调（用户 260915）：新建空态＝中性描边；编辑既有小记的"保存"恒强调。 */
  const emphasized = variant === "inline" || draft.text.trim().length > 0 || draft.images.length > 0;
  return <>
    <div className="quick-note-composer" onKeyDownCapture={publishOnShortcut}>
      {/* 写作区 = 一个 Lake 内核实例（编辑时挂、离开即销毁）；图片直接拖入或粘贴 */}
      <QuickNoteEditor
        ownerId={draft.id}
        initialBody={draft.body}
        ui={ui}
        active={active}
        uploadResource={uploadResource}
        onTextChange={onTextChange}
        onReady={onEditorReady}
      />
    </div>
    <div className={`quick-note-composer-actions quick-note-composer-actions--${variant}`}>
      {variant === "pane" ? <>
        {/* 写作卡（新建）：主按钮和「取消」并排成一组靠左，快捷键提示跟在后面（仿评论框：动作相邻、提示退后）。
            改前是「发布在最左、取消被 flex:1 占位顶到最右」，两个按钮分居卡片两角（用户 260920 反馈太偏僻）。 */}
        <button className={"b3-button quick-note-publish" + (emphasized ? " is-emphasized" : "")} disabled={saving} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={15} /> : null}{saving ? "保存中" : publishLabel}</button>
        <button className="b3-button quick-note-discard" disabled={saving} onClick={onCancel}>取消</button>
        <span className="quick-note-publish-hint">按 ⌘ Enter 发布</span>
        <span className="quick-note-publish-hint-sub">可拖入或粘贴图片</span>
      </> : <>
        {/* 编辑既有小记：「取消 / 保存」整组靠右下（对齐对话框底栏惯例：取消在左、主按钮在右），不再分居两角 */}
        <button className="b3-button quick-note-discard" disabled={saving} onClick={onCancel}>取消</button>
        <button className={"b3-button quick-note-publish" + (emphasized ? " is-emphasized" : "")} disabled={saving} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={15} /> : null}{saving ? "保存中" : publishLabel}</button>
      </>}
    </div>
  </>;
}

function QuickNoteCard({ item, deletePending, selecting, checked, onToggleSelect, onEdit, onDelete, onConvert, onToggleTask }: {
  item: QuickNoteDocument; deletePending: boolean; selecting: boolean; checked: boolean;
  onToggleSelect(): void; onEdit(): void; onDelete(): void; onConvert(): void;
  onToggleTask(checkboxIndex: number, checked: boolean): void;
}) {
  /** 资源清单（带 url）：预览里的媒体卡按文件名到这里取真实资源。 */
  const assets = item.content.images.filter((asset): asset is QuickNoteImage & { url: string } => Boolean(asset.url));
  const imagesOnly = assets.filter((asset) => isQuickNoteImageMime(asset.mimeType));
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
    {/* 勾选框常驻（左侧固定槽位）：默认 hover 才显形，点多选模式后常显 */}
    <button
      className={"qn-check quick-note-select" + (checked ? " is-on" : "")}
      role="checkbox" aria-checked={checked} aria-label={checked ? "取消选择" : "选择这篇小记"}
      onClick={(event) => { event.stopPropagation(); onToggleSelect(); }}
    >{checked && <Check size={13} />}</button>
    <header><time dateTime={item.updatedAt || item.createdAt}>更新于 {stamp}</time>{item.isConflict && <span className="badge badge--warn quick-note-conflict">同步冲突副本</span>}<div className="quick-note-card-actions"><button onClick={onConvert} title="转为正式笔记"><FilePlus size={15} /></button><button onClick={onEdit} title="编辑小记"><Pencil size={15} /></button><button className="danger" onClick={onDelete} disabled={deletePending} title={deletePending ? "请先完成当前删除的撤销操作" : "删除小记"}><Trash size={15} /></button></div></header>
    {/* 卡片预览 = 自研只读渲染（零内核实例）：白名单块按真实结构显示（列表/待办/引用/标题/行内格式），
        媒体卡按正文顺序就地渲染；白名单外的块显示占位。解析不出内容时回落到纯文本镜像。 */}
    <QuickNotePreview
      body={item.content.body}
      assets={assets}
      fallbackText={item.content.text}
      onImageClick={(image) => openImagePreview(imagesOnly.map((it) => ({ src: it.url })), imagesOnly.findIndex((it) => it.id === image.id))}
      onToggleTask={onToggleTask}
    />
  </article>;
}
