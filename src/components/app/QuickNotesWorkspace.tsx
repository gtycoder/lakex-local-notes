import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUpDown, Check, ChevronDown, FilePlus, Feather, Filter, LayoutList, LoaderCircle, MoreHorizontal, Pencil, Plus, RotateCcw, Search, StickyNote, Tag, Tags, Trash, X } from "lucide-react";
import { native } from "../../lib/native";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { escapeId } from "../../lib/cssEscape";
import { createRequestVersion } from "../../core/requestVersion";
import { isQuickNoteImageMime } from "../../core/quickNoteModel";
import { formatListTime } from "../../core/dateFormat";
// 小记排序：**两端共用的单一来源**（档位/文案/比较器/本机持久化都在这里；261015 用户要求桌面与移动统一）
import { QUICK_NOTE_SORT_OPTIONS, quickNoteSortTime, sortQuickNotes, type QuickNoteSort } from "../../core/quickNoteSort";
// 本机读写单独一层（core 禁 DOM）：与移动端同一份
import { readQuickNoteSort, writeQuickNoteSort } from "../../lib/quickNoteSortPref";
import type { NoteDocument, QuickNoteDocument, QuickNoteImage, QuickNoteTag, ResourceUploadOutput, TreeNode } from "../../lib/types";
import { getNativeErrorMessage, reportNativeActionError } from "../../lib/nativeErrors";
import { uploadLakeResource } from "../../features/editor/resourceUpload";
import { QuickNoteEditor, type QuickNoteEditorApi } from "../../features/quickNotes/QuickNoteEditor";
import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import { toggleTaskInBody } from "../../features/quickNotes/quickNotePreviewParser";
import { QuickNoteTagPicker } from "../../features/quickNotes/QuickNoteTagPicker";
import { QuickNoteTagManager } from "../../features/quickNotes/QuickNoteTagManager";
import { QuickNoteFilterDialog, type QuickNoteFilterState } from "../../features/quickNotes/QuickNoteFilterDialog";
import {
  isQuickNoteTimeFilterActive,
  matchesQuickNoteTimeFilter,
  quickNoteTimeFilterLabel,
  type QuickNoteTimeFilter,
} from "../../core/quickNoteFilters";
import {
  addQuickNoteTagId,
  buildQuickNoteTagIndex,
  buildQuickNoteTagOptions,
  filterQuickNotesByTag,
  removeQuickNoteTagId,
  type QuickNoteTagFilter,
  type QuickNoteTagSummary,
} from "../../core/quickNoteTags";
import {
  QUICK_NOTE_TYPE_OPTIONS,
  filterQuickNotesByType,
  type QuickNoteTypeFilter,
} from "../../core/quickNoteTypeFilter";
import { filterQuickNotesByQuery } from "../../core/quickNoteSearch";
import { openImagePreview } from "../../features/editor/imagePreview";
import { clampPopoverPosition } from "../../hooks/topMenuPosition";
import { useScrollFade } from "../../hooks/useScrollFade";
import { Dialog, Menu } from "../ui/Overlay";

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
  tagIds: string[];
  /**
   * 载入时的基线（**判定"有没有改过"用**）。
   * 曾经用 `hasDraftContent()` 判脏 ⇒ 只要编辑一条已有小记（它本来就有内容）就永远是"脏"的，
   * 于是切来切去总弹「是否放弃编辑」，还会把没改动的正文重写一遍（连带触发 S3）。用户 260919 报。
   */
  baseline: { text: string; body: string; imageCount: number; tagIds: string[] };
}

export interface QuickNotesWorkspaceHandle {
  /** 返回 true 代表可以离开当前小记页面；false 代表用户选择继续编辑。 */
  confirmLeave(): Promise<boolean>;
  /** 同步完成后刷新小记列表。 */
  refresh(): Promise<void>;
  /** 全局搜索命中一条小记：只定位/高亮并滚到视口，不自动进编辑态。 */
  revealNote(id: string): Promise<void>;
}

interface QuickNotesWorkspaceProps {
  notebooks: TreeNode[];
  /** 工作区级可见性（keep-alive：小记视图被隐藏时仍挂载，但**不建内核实例** —— 见 QuickNoteEditor.active）。 */
  visible?: boolean;
  onConverted(note: NoteDocument): void;
  onDirtyChange(dirty: boolean): void;
  /**
   * 云同步是否可用（判据 = core/cloudState 的 canTouchNetwork(cloudStateOf(...))，由 App 传入，单一来源）。
   * false ⇒「保存并同步」**置灰**并给说明（用户 261013 定稿）；「保存」不受影响（本地是真相）。
   */
  cloudReady?: boolean;
}

const newDraft = (): DraftState => ({ id: crypto.randomUUID(), text: "", body: "", images: [], tagIds: [], baseline: { text: "", body: "", imageCount: 0, tagIds: [] } });

/** 用一条已保存小记开一份编辑草稿（基线 = 载入内容，用于"改没改过"判定）。 */
const draftOf = (item: QuickNoteDocument): DraftState => ({
  id: crypto.randomUUID(),
  text: item.content.text,
  body: item.content.body,
  images: item.content.images.map((image) => ({ image, source: "saved" as const })),
  tagIds: [...item.content.tagIds],
  baseline: { text: item.content.text, body: item.content.body, imageCount: item.content.images.length, tagIds: [...item.content.tagIds] },
});
const hasDraftContent = (draft: DraftState) => draft.text.trim().length > 0 || draft.images.length > 0;
/**
 * 「改过没有」= 与载入基线比较（不是"有没有内容"）。
 * 文本先做**去噪归一**：内核空文档的 `text/plain` 是 `"\uFEFF\n"`（零宽 BOM + 换行），
 * 直接字符串比较会把"没动过的新草稿"判成脏（260919 用户报：列表页点条目打不开、还弹「请至少记录文字或一张图片」）。
 */
const normalizeMirror = (text: string) => text.replace(/[\uFEFF\u200B]/g, "").trim();
const isDraftDirty = (draft: DraftState) =>
  normalizeMirror(draft.text) !== normalizeMirror(draft.baseline.text)
  || draft.images.length !== draft.baseline.imageCount
  || draft.tagIds.join("\u0000") !== draft.baseline.tagIds.join("\u0000");

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
  return formatListTime(new Date(iso), new Date());
}

// 小记排序口径（用户 260915 要求；261015 与移动端统一为四档）——**纯展示偏好，只存本机 localStorage、不进 S3**；
// 档位文案、比较器与本机读写全部在 `core/quickNoteSort`（单一来源，移动端用同一份）。

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
const PIN_KEY = "local-lakex-notes-v3.quick-notes-pinned";
const readPins = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
};
const writePins = (value: Set<string>): void => {
  writeLocalStorage(PIN_KEY, JSON.stringify([...value]));
};

type QuickNotesView = "note" | "list";
const VIEW_KEY = "local-lakex-notes-v3.quick-notes-view";
const readViewPref = (): QuickNotesView => {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "note"; } catch { return "note"; }
};
const writeViewPref = (value: QuickNotesView): void => {
  writeLocalStorage(VIEW_KEY, value);
};

export const QuickNotesWorkspace = forwardRef<QuickNotesWorkspaceHandle, QuickNotesWorkspaceProps>(function QuickNotesWorkspace(props, ref) {
  const { notebooks: notebookNodes, visible = true, onConverted, onDirtyChange, cloudReady = true } = props;
  const [items, setItems] = useState<QuickNoteDocument[]>([]);
  const [createDraft, setCreateDraft] = useState<DraftState>(() => newDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 「保存并同步」的网络阶段（与 saving 分开：保存是本地写，同步是维护域网络操作）。 */
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuickNoteDocument | null>(null);
  /** 待转成正式笔记的小记（多选时是一批） */
  const [convertItems, setConvertItems] = useState<QuickNoteDocument[] | null>(null);
  /** 多选模式与已选集合（仅本机交互状态，不进 S3） */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /** 排序口径：四档（最近更新 / 最早更新 / 最新创建 / 最早创建）——纯展示偏好，本机 localStorage，不参与同步 */
  const [sortBy, setSortBy] = useState<QuickNoteSort>(() => readQuickNoteSort());
  /** 排序按钮的提示文案（档位文案与菜单同一份来源）。 */
  const sortLabel = QUICK_NOTE_SORT_OPTIONS.find((o) => o.id === sortBy)?.label ?? "";
  /** 版式：小记卡（note）/ 列表（list）（纯展示偏好，存 localStorage，不参与同步） */
  const [viewMode, setViewMode] = useState<QuickNotesView>(() => readViewPref());
  const [sortOpen, setSortOpen] = useState(false);
  /** 排序菜单定位（标准 <Menu> 走 portal，需内联 left/top）。 */
  const [sortMenuPos, setSortMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterMenuPos, setFilterMenuPos] = useState<{ top: number; left: number } | null>(null);
  /** 列表视图的标签筛选下拉（对齐语雀：标签收进「标签 ▾」，不再平铺）。 */
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagMenuPos, setTagMenuPos] = useState<{ top: number; left: number } | null>(null);
  /** 列表视图：搜索（点击放大镜展开）与 ⋯ 菜单（类型/排序/批量操作）。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; left: number } | null>(null);
  /** 行内「⋯」菜单（列表视图，对齐云端图2）：记录当前展开的是哪一条。 */
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [rowMenuPos, setRowMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<HTMLElement | null>(null);
  const [tagPickerFor, setTagPickerFor] = useState<{ noteId: string; anchor: HTMLElement } | null>(null);
  const [tagFilter, setTagFilter] = useState<QuickNoteTagFilter>({ kind: "all" });
  /** 标签目录（唯一来源在标签表；随 Manifest 同步）。 */
  const [tagDirectory, setTagDirectory] = useState<QuickNoteTag[]>([]);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  /** 时间快捷筛选（按创建时间；与类型/标签筛选叠加）。 */
  const [timeFilter, setTimeFilter] = useState<QuickNoteTimeFilter>({ kind: "any" });
  /** 类型筛选：菜单默认「小记」= 全部（对齐语雀 dashboard/notes 的默认勾选）。 */
  const [typeFilter, setTypeFilter] = useState<QuickNoteTypeFilter>("all");
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
  /** 列表视图的左列索引（261017 B：滚动边缘渐隐） */
  const indexListRef = useRef<HTMLDivElement | null>(null);
  /** 全局搜索跳转：等目标卡片渲染后滚到视口（工作区从隐藏变为可见时再试）。 */
  const [revealNoteId, setRevealNoteId] = useState<string | null>(null);
  useScrollFade(indexListRef, viewMode);

  const activeIsEditing = editingDraft !== null;
  // 「有未保存改动」= 新建草稿有内容，或编辑中的草稿与载入基线不同（不再拿"有没有内容"当脏判据）
  const dirty = isDraftDirty(createDraft) || (editingDraft !== null && isDraftDirty(editingDraft));

  async function refreshItems(showLoading = false): Promise<QuickNoteDocument[]> {
    const version = listVersionRef.current.next();
    if (showLoading) setLoading(true);
    let result: QuickNoteDocument[] = [];
    try {
      const nextItems = await native.listQuickNotes();
      if (listVersionRef.current.isCurrent(version)) {
        // 乐观删除尚未到期落盘时，同步完成等外部刷新会把该小记重新拉回列表 → 表现为「删不掉」。
        // 刷新结果里过滤掉撤销窗口内的那条，保持它与 UI 一致（到期由定时器真正删除；撤销则重新显示）。
        const pendingId = pendingDeleteIdRef.current;
        result = pendingId ? nextItems.filter((item) => item.id !== pendingId) : nextItems;
        setItems(result);
      }
    } catch (reason) {
      if (listVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(reason));
    } finally {
      if (listVersionRef.current.isCurrent(version) && showLoading) setLoading(false);
    }
    return result;
  }

  /** 标签目录刷新（标签表是唯一来源；与列表一起在挂载/同步完成/标签操作后刷新）。 */
  async function refreshTags(): Promise<void> {
    try { setTagDirectory(await native.listQuickNoteTags()); }
    catch (reason) { setError(getNativeErrorMessage(reason)); }
  }

  /** 新建标签（写作卡/选择器共用）：先写标签表，再返回 ID 给草稿。 */
  async function createTag(name: string): Promise<string> {
    const created = await native.createQuickNoteTag(name);
    await refreshTags();
    return created.id;
  }

  useEffect(() => {
    void refreshItems(true);
    void refreshTags();
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

  /** 全局搜索命中：只**定位并高亮**，不自动进编辑态（用户 261021 点单）。 */
  async function revealNote(id: string): Promise<void> {
    const target = items.find((item) => item.id === id) ?? (await refreshItems()).find((item) => item.id === id);
    if (!target) {
      setError("这条小记已不存在（可能已被删除或转换）");
      return;
    }
    setTagFilter({ kind: "all" });
    setTypeFilter("all");
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
    setRevealNoteId(id);
  }

  useImperativeHandle(ref, () => ({
    async refresh() {
      await Promise.all([refreshItems(), refreshTags()]);
    },
    async revealNote(id: string) {
      await revealNote(id);
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
  async function saveDraft(clicked: DraftState): Promise<{ ok: boolean; id: string | null }> {
    if (saving) return { ok: false, id: null };
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
      if (!hasDraftContent(draft)) { setError("请至少记录文字、一张图片或一个附件"); return { ok: false, id: null }; }
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
        const unchanged = body === draft.baseline.body
          && draft.images.length === draft.baseline.imageCount
          && draft.tagIds.join("\u0000") === draft.baseline.tagIds.join("\u0000");
        // 没改动 = 不写库，但**小记 id 仍要回传**：「保存并同步」要能推一条"之前只是没同步"的小记（编辑草稿 id ≠ 小记 id，见 draftOf）。
        if (unchanged) { settleAfterSave(draft, { text, body, images: draft.images, tagIds: draft.tagIds }); return { ok: true, id: editingId }; }
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
      const tagsChanged = isEditing
        ? draft.tagIds.join("\u0000") !== draft.baseline.tagIds.join("\u0000")
        : draft.tagIds.length > 0;
      let saved = isEditing && editingId
        ? await native.updateQuickNote(editingId, { text, body, draftId: draft.id, stagedImageIds, retainedImageIds })
        : await native.createQuickNote({ text, body, draftId: draft.id, stagedImageIds });
      // 关系是独立子系统：正文保存成功后，单独调用标签关系 API。
      if (tagsChanged) saved = await native.setQuickNoteTags(saved.id, draft.tagIds);
      listVersionRef.current.invalidate();
      setItems((current) => {
        const without = current.filter((item) => item.id !== saved.id);
        return [saved, ...without].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      if (isEditing) settleAfterSave(draft, { text, body, images: saved.content.images.map((image) => ({ image, source: "saved" as const })), tagIds: saved.content.tagIds });
      else if (createDraft.id === draft.id) setCreateDraft(newDraft());
      return { ok: true, id: saved.id };
    } catch (reason) { setError(`保存小记失败：${getNativeErrorMessage(reason)}`); return { ok: false, id: null }; }
    finally { setSaving(false); }
  }

  /**
   * 「保存并同步」（用户 261013）：v3 起不再有单条推送实现，改为整轮 v3 同步兜底（旧 core/quickNotePush 已删除）。
   * 失败不静默：本地已经存住了 ⇒ 提示「已保存到本机，同步失败：…」，用户可再点一次（幂等）。
   */
  async function pushOneNote(id: string) {
    setSyncing(true); setError(null);
    try {
      const outcome = await native.syncQuickNote(id);
      if (outcome.status === "not-found") {
        setError("这条小记不在本机（可能已被删除或恢复过）");
      } else if (outcome.status === "pushed") {
        setViewHint(outcome.unchanged ? "已是最新，无需上传" : "已同步到云端");
      } else if (outcome.reason === "no-remote-manifest") {
        setViewHint("云端还没有小记清单，已改为执行一次完整同步");
      } else {
        setViewHint("这条小记已在其他设备删除，已按删除处理");
        setEditingId(null); setEditingDraft(null);
      }
      await refreshItems(); // refreshItems 自己会 bump 版本号（不必先 invalidate）
    } catch (reason) {
      setError(`已保存到本机，同步失败：${getNativeErrorMessage(reason)}`);
    } finally { setSyncing(false); }
  }

  /** 先保存（本地写，绝不丢内容）→ 成功才推送这一条；保存失败不推送。 */
  async function saveDraftAndSync(clicked: DraftState) {
    const result = await saveDraft(clicked);
    if (!result.ok || !result.id) return;
    await pushOneNote(result.id);
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
    // 版式切换时收起所有浮层（列表视图的标签下拉/页头筛选/排序）
    setTagMenuOpen(false);
    setFilterOpen(false);
    setSortOpen(false);
    setMoreOpen(false);
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
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
    return (await saveDraft(draft)).ok;
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
  function settleAfterSave(draft: DraftState, values: { text: string; body: string; images: DraftImage[]; tagIds: string[] }) {
    // 判据用草稿身份（`editingDraft`）而不是笔记 id：列表视图里"正在编辑的是这份草稿"才原地留存。
    if (viewMode === "list" && editingDraft?.id === draft.id) {
      stagedAssetsRef.current.delete(draft.id);
      setEditingDraft((current) => current && current.id === draft.id
        ? {
            ...current,
            text: values.text,
            images: values.images,
            tagIds: values.tagIds,
            baseline: { text: values.text, body: values.body, imageCount: values.images.length, tagIds: values.tagIds },
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

  const tagIndex = useMemo(
    () => buildQuickNoteTagIndex(items, tagDirectory, (item) => item.content.tagIds),
    [items, tagDirectory],
  );

  /**
   * 写作区/选择器/管理页用**完整目录**（含 0 条小记的新标签）；标签条只用 `tagIndex.tags`（有计数才展示）。
   * 曾经写作区直接拿 `tagIndex.tags` 查名称 ⇒ 刚加进草稿、尚未保存的标签查不到，回退显示了标签 ID（用户 261024 报）。
   */
  const tagOptions = useMemo<QuickNoteTagSummary[]>(
    () => buildQuickNoteTagOptions(tagDirectory, tagIndex.tags),
    [tagDirectory, tagIndex.tags],
  );

  useEffect(() => {
    if (tagFilter.kind === "tag" && !tagIndex.tags.some((tag) => tag.id === tagFilter.id)) {
      setTagFilter({ kind: "all" });
    }
  }, [tagFilter, tagIndex.tags]);

  // 草稿里引用的标签可能被删除（标签管理或同步墓碑）：删掉后从草稿与基线一起剔除，
  // 否则保存时 setQuickNoteTags 会因「标签不存在或已删除」直接失败、卡住整次保存。
  useEffect(() => {
    const active = new Set(tagDirectory.filter((tag) => !tag.deletedAt).map((tag) => tag.id));
    const prune = (draft: DraftState | null): DraftState | null => {
      if (!draft) return null;
      const tagIds = draft.tagIds.filter((id) => active.has(id));
      const baselineTagIds = draft.baseline.tagIds.filter((id) => active.has(id));
      if (tagIds.length === draft.tagIds.length && baselineTagIds.length === draft.baseline.tagIds.length) return draft;
      return { ...draft, tagIds, baseline: { ...draft.baseline, tagIds: baselineTagIds } };
    };
    setEditingDraft((current) => prune(current));
    setCreateDraft((current) => prune(current) ?? current);
  }, [tagDirectory]);

  // 高级筛选里的标签可能被删除：把已不存在的 ID 从包含/排除里剔掉，避免形成看不见的隐藏 AND。
  useEffect(() => {
    if (tagFilter.kind !== "selection") return;
    const active = new Set(tagOptions.map((tag) => tag.id));
    const include = tagFilter.include.filter((id) => active.has(id));
    const exclude = tagFilter.exclude.filter((id) => active.has(id));
    if (include.length === tagFilter.include.length && exclude.length === tagFilter.exclude.length) return;
    setTagFilter(include.length === 0 && exclude.length === 0 ? { kind: "all" } : { kind: "selection", include, exclude });
  }, [tagFilter, tagOptions]);

  /** 排序只影响本端展示顺序（不写库、不进 manifest）；四档比较器在 core/quickNoteSort（与移动端同一份）。 */
  const visibleItems = useMemo(() => {
    const timed = items.filter((item) => matchesQuickNoteTimeFilter(item.createdAt, timeFilter));
    const filtered = filterQuickNotesByTag(timed, tagFilter, (item) => item.content.tagIds);
    // 类型筛选是标签筛选之后的 AND 过滤（小记 / 图片 / 附件）；分类只认资源清单，见 core/quickNoteTypeFilter
    const typed = filterQuickNotesByType(filtered, typeFilter);
    const ordered = sortQuickNotes(typed, sortBy);
    // 置顶优先（纯本机偏好），同组内保持所选排序（filter 保序 ⇒ 无需二次比较）
    return [...ordered.filter((it) => pinned.has(it.id)), ...ordered.filter((it) => !pinned.has(it.id))];
  }, [items, sortBy, pinned, tagFilter, typeFilter, timeFilter]);
  /** 列表视图的本地搜索（Enter/清空才改 query；卡片视图不参与）。 */
  const listItems = useMemo(() => filterQuickNotesByQuery(visibleItems, searchQuery), [visibleItems, searchQuery]);


  /** 全局搜索跳转后：等目标卡片/索引行渲染出来，滚到视口并短暂高亮（不进编辑态）。 */
  useEffect(() => {
    if (!visible || !revealNoteId) return;
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-quick-note-id="${escapeId(revealNoteId)}"]`);
      if (!target) return;
      target.scrollIntoView({ block: "nearest" });
      timer = window.setTimeout(() => setRevealNoteId((current) => current === revealNoteId ? null : current), 1600);
    });
    return () => { window.cancelAnimationFrame(frame); if (timer !== undefined) window.clearTimeout(timer); };
  }, [visible, revealNoteId, viewMode, items]);

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

  /** 类型筛选：与标签筛选同一套「切筛选前先收住正在编辑的小记」口径，避免筛掉卡片时丢未保存正文。 */
  async function changeTypeFilter(next: QuickNoteTypeFilter): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    // 语雀语义：类型筛选与标签筛选不叠加 —— 任何类型切换都清空标签筛选，标签条由 renderTagBar 隐藏。
    setTagFilter({ kind: "all" });
    setTypeFilter(next);
  }

  /** 排序菜单：标准 <Menu> 走 portal，按触发按钮实测矩形定位。 */
  const toggleSortMenu = (button: HTMLElement) => {
    if (sortOpen) { setSortOpen(false); return; }
    const rect = button.getBoundingClientRect();
    setSortMenuPos(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 140, height: 84 }, 6));
    setSortOpen(true);
  };
  /** 打开列表搜索：先按同一口径收住正在编辑的小记，避免搜索把未保存卡片筛掉。 */
  async function openSearch(): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    setSearchOpen(true);
    setSearchInput(searchQuery);
  }

  function closeSearch(): void {
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
  }

  function toggleSearch(): void {
    if (searchOpen) closeSearch();
    else void openSearch();
  }

  /** ⋯ 菜单（列表视图）：对齐语雀，把类型/排序/批量操作收进这里。 */
  const toggleMoreMenu = (button: HTMLElement) => {
    if (moreOpen) { setMoreOpen(false); return; }
    const rect = button.getBoundingClientRect();
    setMoreMenuPos(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 200, height: 360 }, 6));
    setMoreOpen(true);
  };

  /** 列表视图标签筛选下拉：与排序/类型菜单共用同一个 <Menu> 表面。 */
  const toggleTagMenu = (button: HTMLElement) => {
    if (tagMenuOpen) { setTagMenuOpen(false); return; }
    const rect = button.getBoundingClientRect();
    setTagMenuPos(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 220, height: 320 }, 6));
    setTagMenuOpen(true);
  };

  /** 类型筛选菜单：与排序菜单共用同一个 <Menu> 表面，位置按触发按钮实测矩形夹进视口。 */
  const toggleFilterMenu = (button: HTMLElement) => {
    if (filterOpen) { setFilterOpen(false); return; }
    const rect = button.getBoundingClientRect();
    setFilterMenuPos(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 160, height: 170 }, 6));
    setFilterOpen(true);
  };

  /** 行内 ⋯ 菜单：同上。 */
  const toggleRowMenu = (button: HTMLElement, id: string) => {
    if (rowMenuId === id) { setRowMenuId(null); setRowMenuAnchor(null); return; }
    const rect = button.getBoundingClientRect();
    setRowMenuPos(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width: 150, height: 216 }, 6));
    setRowMenuAnchor(button);
    setRowMenuId(id);
  };
  const rowMenuItem = rowMenuId ? items.find((item) => item.id === rowMenuId) ?? null : null;

  /** 切标签筛选前先收住正在编辑的小记：筛掉的卡片会卸载，不能把未保存正文一起带走。 */
  async function changeTagFilter(next: QuickNoteTagFilter): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    // 类型筛选与标签筛选互斥（261021 规格）：类型筛选生效时标签条隐藏，但卡片上的标签仍可点，
    // 若只改标签筛选就会形成用户看不见的 AND ⇒ 点标签时一并清掉类型筛选。
    if (typeFilter !== "all") setTypeFilter("all");
    setTagFilter(next);
  }

  /** 高级筛选一次应用（时间 / 类型 / 标签包含排除）；与其它筛选切换同一套"先收住编辑态"口径。 */
  async function applyFilterState(next: QuickNoteFilterState): Promise<void> {
    if (editingDraft) {
      if (dirty && !(await saveBeforeSwitch())) return;
      setEditingId(null);
      setEditingDraft(null);
    }
    setTimeFilter(next.time);
    setTypeFilter(next.type);
    // 类型与标签筛选互斥（同 changeTypeFilter）：选了图片/附件就不叠加标签条件，避免隐藏 AND。
    setTagFilter(next.type !== "all" ? { kind: "all" } : next.tagFilter);
    setFilterDialogOpen(false);
  }

  async function applyNoteTags(noteId: string, tagIds: string[]): Promise<void> {
    const item = items.find((candidate) => candidate.id === noteId);
    if (!item) return;
    try {
      // 只改关联，不重写正文。
      const saved = await native.setQuickNoteTags(noteId, tagIds);
      listVersionRef.current.invalidate();
      setItems((current) => current.map((candidate) => (candidate.id === noteId ? saved : candidate)));
    } catch (reason) {
      setError(`更新标签失败：${getNativeErrorMessage(reason)}`);
    }
  }

  /** 列表搜索输入（列表视图的索引头、卡片视图的右栏上方共用）。 */
  function renderSearchInput() {
    return (
      <div className="quick-notes-index-search">
        <Search size={14} />
        <input
          autoFocus value={searchInput} placeholder="搜索小记" aria-label="搜索小记"
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); setSearchQuery(searchInput.trim()); }
            if (event.key === "Escape") { event.preventDefault(); closeSearch(); }
          }}
        />
        {searchInput && <button type="button" className="quick-notes-index-search__clear" aria-label="清空搜索" onClick={() => { setSearchInput(""); setSearchQuery(""); }}><X size={13} /></button>}
      </div>
    );
  }

  /** 标签筛选条：两套版式共用一份；放在**右侧列表列**（对齐语雀），不再占据左侧写作区。 */
  function renderTagBar() {
    // 对齐语雀：类型筛选（图片/附件）生效时标签条隐藏；切回「小记」后标签筛选已被清空。
    if (typeFilter !== "all" || tagFilter.kind === "selection" || items.length === 0 || tagIndex.tags.length === 0) return null;
    return (
      <div className="quick-notes-tagbar" role="group" aria-label="按标签筛选小记">
        {tagIndex.tags.map((tag) => (
          <button
            key={tag.id}
            className={"quick-note-tag" + (tagFilter.kind === "tag" && tagFilter.id === tag.id ? " is-selected" : "")}
            onClick={() => void changeTagFilter(tagFilter.kind === "tag" && tagFilter.id === tag.id ? { kind: "all" } : { kind: "tag", id: tag.id })}
          >
            <span className="ln-ellipsis">{tag.name}</span><span className="quick-note-tag__count">({tag.count})</span>
          </button>
        ))}
        {tagIndex.untaggedCount > 0 && (
          <button className={"quick-note-tag" + (tagFilter.kind === "untagged" ? " is-selected" : "")} onClick={() => void changeTagFilter(tagFilter.kind === "untagged" ? { kind: "all" } : { kind: "untagged" })}>
            <span>无标签</span><span className="quick-note-tag__count">({tagIndex.untaggedCount})</span>
          </button>
        )}
        <button className="quick-note-tag quick-note-tag--manage" onClick={() => setTagManagerOpen(true)} title="管理标签">
          <Tags size={12} /><span>管理</span>
        </button>
      </div>
    );
  }

  /** 标题 + 版式切换（卡片视图页头与列表视图左栏头共用）。 */
  const titleSwitch = (
    <div className="quick-notes-title">
      <h1>小记</h1>
      {/* 版式切换（对齐云端：标题右侧的分段控件；左侧=列表视图，右侧=小记卡视图） */}
      <div className="seg quick-notes-view-switch" role="group" aria-label="小记版式">
        <button
          className={"ln-btn ln-btn--secondary seg__item" + (viewMode === "list" ? " is-active" : "")}
          aria-pressed={viewMode === "list"} title="列表视图" aria-label="列表视图"
          onClick={() => switchView("list")}
        ><LayoutList size={14} /></button>
        <button
          className={"ln-btn ln-btn--secondary seg__item" + (viewMode === "note" ? " is-active" : "")}
          aria-pressed={viewMode === "note"} title="小记视图" aria-label="小记视图"
          onClick={() => switchView("note")}
        ><StickyNote size={14} /></button>
      </div>
    </div>
  );
  const newNoteButton = (
    <button className="quick-notes-new" title="新建小记" aria-label="新建小记" onClick={() => void startNewDraft()}>
      <span className="quick-notes-new__icon"><Feather size={14} /><Plus size={9} /></span>
    </button>
  );
  const notices = <>
    {viewHint && <div className="quick-notes-hint" role="status">{viewHint}</div>}
    {error && <div className="quick-notes-error"><span>{error}</span><button onClick={() => setError(null)} aria-label="关闭错误"><X size={15} /></button></div>}
  </>;

  // 左右两栏（对齐云端语雀小记）：左＝常驻写作面板 + 发布行，右＝小记卡片流（各自独立滚动）。
  return <section className="quick-notes-pane" aria-label="小记">
    {viewMode === "note" && <header className="quick-notes-header">
      {titleSwitch}
      <div className="quick-notes-header-tools">
        {/* 多选工具左对齐（与卡片勾选框同列），「N 条 / 排序」始终保留在右侧 —— 两块同时可见。 */}
        {selecting && <>
          <button className={"qn-check" + (selected.size > 0 && selected.size === items.length ? " is-on" : "")} role="checkbox" aria-checked={selected.size > 0 && selected.size === items.length} aria-label="全选" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}>{selected.size > 0 && selected.size === items.length && <Check size={13} />}</button>
          <span className="quick-notes-select-info">共选择了 {selected.size} 篇小记</span>
          <span className="quick-notes-tools-divider" />
          <button className="quick-notes-link" onClick={exitSelecting}>取消</button>
          <button className="quick-notes-link" disabled={selected.size === 0 || saving} onClick={() => setConvertItems(items.filter((item) => selected.has(item.id)))}>转为文档</button>
          <button className="quick-notes-link quick-notes-link--danger" disabled={selected.size === 0 || saving} onClick={() => void deleteSelected()}>批量删除</button>
        </>}
        <span className="quick-notes-tools-spacer" />
        <span className="quick-notes-count">{items.length} 条</span>
        <button className={"quick-notes-tool-btn" + (searchOpen ? " is-on" : "")} onClick={toggleSearch} title="搜索小记" aria-label="搜索小记"><Search size={16} /></button>
        <button className={"quick-notes-tool-btn" + (typeFilter !== "all" || isQuickNoteTimeFilterActive(timeFilter) || tagFilter.kind === "selection" ? " is-on" : "")} onClick={(event) => toggleFilterMenu(event.currentTarget)} aria-haspopup="menu" aria-expanded={filterOpen} title={"筛选：" + quickNoteTimeFilterLabel(timeFilter)} aria-label="筛选小记"><Filter size={16} /></button>
        <div className="quick-notes-sort-wrap">
          <button className="quick-notes-tool-btn" onClick={(event) => toggleSortMenu(event.currentTarget)} aria-haspopup="menu" aria-expanded={sortOpen} title={"排序：" + sortLabel} aria-label="排序"><ArrowUpDown size={16} /></button>
        </div>
        <button className="quick-notes-tool-btn" onClick={() => setTagManagerOpen(true)} title="标签管理" aria-label="标签管理"><Tags size={16} /></button>
      </div>
    </header>}
    {viewMode === "note" && notices}
    {viewMode === "list" ? <div className="quick-notes-split quick-notes-split--list">
      {/* 列表视图（对齐云端 https://www.yuque.com/dashboard/notes）：左＝索引列表（批量条 + 行⋯菜单），
          右＝编辑器。功能都复用分块视图里已有的动作（编辑/转为正式笔记/删除/多选），这里只是把 UI 补上。 */}
      <div className="quick-notes-index-wrap">
        <div className="quick-notes-list-head">
          {titleSwitch}
          {newNoteButton}
        </div>
        {notices}
        <div className="quick-notes-index-tools">
          {searchOpen ? renderSearchInput() : <>
            {items.length > 0 && typeFilter === "all" && (
              <button
                className={"quick-notes-tag-filter-btn" + (tagFilter.kind !== "all" ? " is-on" : "")}
                onClick={(event) => toggleTagMenu(event.currentTarget)}
                aria-haspopup="menu" aria-expanded={tagMenuOpen}
                title={"标签筛选" + (tagFilter.kind === "all" ? "" : "：" + (tagFilter.kind === "untagged" ? "无标签" : (tagIndex.tags.find((tag) => tag.id === (tagFilter as { id: string }).id)?.name ?? "标签")))}
                aria-label="标签筛选"
              ><Tag size={14} /><span>{tagFilter.kind === "all" ? "标签" : tagFilter.kind === "untagged" ? "无标签" : (tagIndex.tags.find((tag) => tag.id === (tagFilter as { id: string }).id)?.name ?? "标签")}</span><ChevronDown size={14} /></button>
            )}
            <span className="quick-notes-tools-spacer" />
            <button className="quick-notes-tool-btn" onClick={() => setTagManagerOpen(true)} title="标签管理" aria-label="标签管理"><Tags size={16} /></button>
            <button className="quick-notes-tool-btn" onClick={() => void openSearch()} title="搜索小记" aria-label="搜索小记"><Search size={16} /></button>
          </>}
          <button className="quick-notes-tool-btn" onClick={(event) => toggleMoreMenu(event.currentTarget)} aria-haspopup="menu" aria-expanded={moreOpen} title="更多" aria-label="更多"><MoreHorizontal size={16} /></button>
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
        <div className="quick-notes-index ln-list-panel ln-list-panel--background" ref={indexListRef}>
          {loading
            ? <div className="ln-empty"><LoaderCircle className="spin" size={18} /><span>正在读取小记…</span></div>
            : items.length === 0
              ? <div className="ln-empty ln-empty--idle"><Feather size={24} /><span>还没有小记</span></div>
              : listItems.length === 0
                ? <div className="ln-empty ln-empty--idle"><Filter size={28} /><strong>未能找到相关小记</strong><span>{searchQuery ? "换个关键词再试。" : "切换筛选条件后再试。"}</span></div>
                : listItems.map((item) => <div
                  key={item.id}
                  data-quick-note-id={item.id}
                  className={"quick-note-index-row ln-list-item" + (selecting ? " is-selecting" : "") + (!selecting && editingId === item.id ? " ln-list-item--focus" : "") + (selected.has(item.id) ? " is-checked" : "") + (revealNoteId === item.id ? " is-revealed" : "")}
                >
                  <button
                    className={"qn-check quick-note-index-check" + (selected.has(item.id) ? " is-on" : "")}
                    role="checkbox" aria-checked={selected.has(item.id)} aria-label={selected.has(item.id) ? "取消选择" : "选择这篇小记"}
                    onClick={(event) => { event.stopPropagation(); toggleSelected(item.id); }}
                  >{selected.has(item.id) && <Check size={13} />}</button>
                  <button className="quick-note-index-main" onClick={() => (selecting ? toggleSelected(item.id) : void startEditing(item))} title={item.content.text?.trim() || "空小记"}>
                    <span className="ln-list-item__text ln-ellipsis">{indexLabel(item)}</span>
                    <span className="ln-list-item__meta">{indexStamp(quickNoteSortTime(item, sortBy))}</span>
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
              draft={editingDraft} variant="inline" ui="full" active={visible} saving={saving && activeIsEditing} syncing={syncing && activeIsEditing} cloudReady={cloudReady}
              uploadResource={quickNoteUploader(editingDraft.id)}
              tagOptions={tagOptions}
              onTextChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
              onTagIdsChange={(tagIds) => setEditingDraft((current) => current ? { ...current, tagIds } : current)}
              onCreateTag={createTag}
              onEditorReady={(api) => handleEditorReady(editingDraft.id, api)}
              onSave={() => void saveDraft(editingDraft)} onSaveAndSync={() => void saveDraftAndSync(editingDraft)} onCancel={() => void cancelDraft(editingDraft)}
            />
          : <QuickNoteComposer
              draft={createDraft} variant="pane" ui="full" active={visible} saving={saving && !activeIsEditing} syncing={syncing && !activeIsEditing} cloudReady={cloudReady}
              uploadResource={quickNoteUploader(createDraft.id)}
              tagOptions={tagOptions}
              onTextChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
              onTagIdsChange={(tagIds) => setCreateDraft((current) => ({ ...current, tagIds }))}
              onCreateTag={createTag}
              onEditorReady={(api) => handleEditorReady(createDraft.id, api)}
              onSave={() => void saveDraft(createDraft)} onSaveAndSync={() => void saveDraftAndSync(createDraft)} onCancel={() => void cancelDraft(createDraft)}
            />}
      </div>
    </div> : <div className="quick-notes-split">
      <div className="quick-notes-compose">
        <QuickNoteComposer
          draft={createDraft}
          variant="pane"
          active={visible}
          saving={saving && !activeIsEditing}
          syncing={syncing && !activeIsEditing}
          cloudReady={cloudReady}
          uploadResource={quickNoteUploader(createDraft.id)}
          tagOptions={tagOptions}
          onTextChange={(text) => setCreateDraft((current) => ({ ...current, text }))}
          onTagIdsChange={(tagIds) => setCreateDraft((current) => ({ ...current, tagIds }))}
          onCreateTag={createTag}
          onEditorReady={(api) => handleEditorReady(createDraft.id, api)}
          onSave={() => void saveDraft(createDraft)}
          onSaveAndSync={() => void saveDraftAndSync(createDraft)}
          onCancel={() => void cancelDraft(createDraft)}
        />
      </div>
      <div className={"quick-notes-list" + (selecting ? " selecting" : "")}>
        {searchOpen && <div className="quick-notes-list-search">{renderSearchInput()}</div>}
        {renderTagBar()}
        <div className="quick-notes-timeline" aria-live="polite">
          {loading ? <div className="ln-empty"><LoaderCircle className="spin" size={18} /><span>正在读取小记…</span></div> : items.length === 0
            ? <div className="ln-empty ln-empty--idle"><Feather size={24} /><strong>还没有小记</strong><span>从左侧写下第一条临时记录。</span></div>
            : listItems.length === 0
              ? <div className="ln-empty ln-empty--idle"><Filter size={28} /><strong>未能找到相关小记</strong><span>{searchQuery ? "换个关键词再试。" : "切换筛选条件后再试。"}</span></div>
              : listItems.map((item) => editingId === item.id && editingDraft
              ? <article className={"quick-note-entry editing" + (revealNoteId === item.id ? " is-revealed" : "")} key={item.id} data-quick-note-id={item.id}><QuickNoteComposer
                  draft={editingDraft} variant="inline" active={visible} saving={saving && activeIsEditing} syncing={syncing && activeIsEditing} cloudReady={cloudReady}
                  uploadResource={quickNoteUploader(editingDraft.id)}
                  tagOptions={tagOptions}
                  onTextChange={(text) => setEditingDraft((current) => current ? { ...current, text } : current)}
                  onTagIdsChange={(tagIds) => setEditingDraft((current) => current ? { ...current, tagIds } : current)}
                  onCreateTag={createTag}
                  onEditorReady={(api) => handleEditorReady(editingDraft.id, api)}
                  onSave={() => void saveDraft(editingDraft)} onSaveAndSync={() => void saveDraftAndSync(editingDraft)} onCancel={() => void cancelDraft(editingDraft)}
                /></article>
              : <QuickNoteCard key={item.id} item={item} revealed={revealNoteId === item.id} deletePending={pendingDelete !== null} selecting={selecting} checked={selected.has(item.id)} onToggleSelect={() => toggleSelected(item.id)} onEdit={() => void startEditing(item)} onDelete={() => scheduleDelete(item)} onConvert={() => setConvertItems([item])} onAddTag={(anchor) => setTagPickerFor({ noteId: item.id, anchor })} onFilterTag={(tagId) => void changeTagFilter({ kind: "tag", id: tagId })} onToggleTask={(checkboxIndex, checked) => void togglePreviewTask(item.id, checkboxIndex, checked)} />)
          }
        </div>
      </div>
    </div>}
    {/* 卡片里的图片点击放大：复用编辑器同一套 Lightbox 单例（与 EditorTab / LakeEditor 同款挂法） */}
    {pendingDelete && <div className="quick-notes-toast" role="status" aria-live="polite"><span>已删除一条小记</span><button onClick={undoDelete}><RotateCcw size={14} />撤销</button></div>}
    {/* 排序菜单 / 行内 ⋯ 菜单：标准 <Menu>（portal + 外点/Esc + .quick-notes-*-menu 表面） */}
    <Menu open={sortOpen} onDismiss={() => setSortOpen(false)} surfaceClassName="quick-notes-sort-menu" style={sortMenuPos ?? undefined}>
      {QUICK_NOTE_SORT_OPTIONS.map((o) => (
        <button key={o.id} role="menuitemradio" aria-checked={sortBy === o.id} onClick={() => { setSortBy(o.id); writeQuickNoteSort(o.id); setSortOpen(false); }}>{sortBy === o.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{o.label}</button>
      ))}
    </Menu>
    {/* 列表视图标签筛选：收起为「标签 ▾」，不再把全部标签平铺在窄索引列里 */}
    <Menu open={tagMenuOpen} onDismiss={() => setTagMenuOpen(false)} surfaceClassName="quick-notes-sort-menu quick-notes-tag-filter-menu" style={tagMenuPos ?? undefined}>
      <button role="menuitemradio" aria-checked={tagFilter.kind === "all"} onClick={() => { setTagMenuOpen(false); void changeTagFilter({ kind: "all" }); }}>{tagFilter.kind === "all" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}全部</button>
      <span className="quick-notes-filter-menu__sep" role="separator" />
      {tagIndex.tags.map((tag) => (
        <button key={tag.id} role="menuitemradio" aria-checked={tagFilter.kind === "tag" && tagFilter.id === tag.id} onClick={() => { setTagMenuOpen(false); void changeTagFilter({ kind: "tag", id: tag.id }); }}>
          {tagFilter.kind === "tag" && tagFilter.id === tag.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}
          <span className="ln-ellipsis">{tag.name}</span><span className="quick-notes-tag-filter-menu__count">({tag.count})</span>
        </button>
      ))}
      {tagIndex.untaggedCount > 0 && (
        <button role="menuitemradio" aria-checked={tagFilter.kind === "untagged"} onClick={() => { setTagMenuOpen(false); void changeTagFilter({ kind: "untagged" }); }}>{tagFilter.kind === "untagged" ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}无标签<span className="quick-notes-tag-filter-menu__count">({tagIndex.untaggedCount})</span></button>
      )}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <button role="menuitem" onClick={() => { setTagMenuOpen(false); setTagManagerOpen(true); }}>管理标签…</button>
    </Menu>
    {/* 列表视图 ⋯：类型 / 排序 / 批量操作（对齐语雀把这三件收进 ⋯） */}
    <Menu open={moreOpen} onDismiss={() => setMoreOpen(false)} surfaceClassName="quick-notes-sort-menu quick-notes-more-menu" style={moreMenuPos ?? undefined}>
      <span className="quick-notes-menu-section">类型</span>
      {QUICK_NOTE_TYPE_OPTIONS.map((option) => (
        <button key={option.id} role="menuitemradio" aria-checked={typeFilter === option.id} onClick={() => { setMoreOpen(false); void changeTypeFilter(option.id); }}>{typeFilter === option.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{option.label}</button>
      ))}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <span className="quick-notes-menu-section">排序</span>
      {QUICK_NOTE_SORT_OPTIONS.map((option) => (
        <button key={option.id} role="menuitemradio" aria-checked={sortBy === option.id} onClick={() => { setSortBy(option.id); writeQuickNoteSort(option.id); setMoreOpen(false); }}>{sortBy === option.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{option.label}</button>
      ))}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <button role="menuitem" onClick={() => { setMoreOpen(false); setFilterDialogOpen(true); }}>筛选小记…</button>
      <button role="menuitem" onClick={() => { setMoreOpen(false); setSelecting(true); }}>批量操作</button>
    </Menu>
    {/* 类型筛选（对齐语雀 dashboard/notes）：小记 / 图片 / 附件；批量操作单独一档 */}
    <Menu open={filterOpen} onDismiss={() => setFilterOpen(false)} surfaceClassName="quick-notes-sort-menu quick-notes-filter-menu" style={filterMenuPos ?? undefined}>
      {QUICK_NOTE_TYPE_OPTIONS.map((option) => (
        <button key={option.id} role="menuitemradio" aria-checked={typeFilter === option.id} onClick={() => { setFilterOpen(false); void changeTypeFilter(option.id); }}>{typeFilter === option.id ? <Check size={14} /> : <span className="quick-notes-menu-gap" />}{option.label}</button>
      ))}
      <span className="quick-notes-filter-menu__sep" role="separator" />
      <button role="menuitem" onClick={() => { setFilterOpen(false); setFilterDialogOpen(true); }}>更多筛选…</button>
      <button role="menuitem" onClick={() => { setFilterOpen(false); setSelecting(true); }}>批量操作</button>
    </Menu>
    {rowMenuItem && (
      <Menu onDismiss={() => { setRowMenuId(null); setRowMenuAnchor(null); }} surfaceClassName="quick-note-row-menu" style={rowMenuPos ?? undefined}>
        <button role="menuitem" onClick={() => { setRowMenuId(null); togglePin(rowMenuItem.id); }}>{pinned.has(rowMenuItem.id) ? "取消置顶" : "置顶"}</button>
        <button role="menuitem" onClick={() => { setRowMenuId(null); void startEditing(rowMenuItem); }}>编辑</button>
        <button role="menuitem" onClick={() => { const anchor = rowMenuAnchor; setRowMenuId(null); if (anchor) setTagPickerFor({ noteId: rowMenuItem.id, anchor }); }}>添加标签</button>
        <button role="menuitem" onClick={() => { setRowMenuId(null); void copyNoteText(rowMenuItem); }}>复制文本</button>
        <button role="menuitem" onClick={() => { setRowMenuId(null); setConvertItems([rowMenuItem]); }}>转为正式笔记</button>
        <button role="menuitem" className="quick-notes-link--danger" onClick={() => { setRowMenuId(null); scheduleDelete(rowMenuItem); }} disabled={pendingDelete !== null}>删除</button>
      </Menu>
    )}
    {tagPickerFor && (() => {
      const target = items.find((item) => item.id === tagPickerFor.noteId);
      return target ? (
        <QuickNoteTagPicker
          anchor={tagPickerFor.anchor}
          options={tagOptions}
          selected={target.content.tagIds}
          onAdd={(tagId) => { void applyNoteTags(target.id, addQuickNoteTagId(target.content.tagIds, tagId)); }}
          onCreate={createTag}
          onClose={() => setTagPickerFor(null)}
        />
      ) : null;
    })()}
    <QuickNoteTagManager
      open={tagManagerOpen}
      tags={tagOptions}
      onClose={() => setTagManagerOpen(false)}
      onChanged={async () => { await Promise.all([refreshItems(), refreshTags()]); }}
      onError={(message) => setError(message)}
    />
    <QuickNoteFilterDialog
      open={filterDialogOpen}
      tags={tagOptions}
      value={{ time: timeFilter, tagFilter, type: typeFilter }}
      onApply={(next) => { void applyFilterState(next); }}
      onClose={() => setFilterDialogOpen(false)}
    />
    {convertItems && convertItems.length > 0 && (
      <Dialog onDismiss={() => { if (!saving) setConvertItems(null); }} label={convertItems.length > 1 ? `转为正式文档（${convertItems.length} 篇）` : "转为正式笔记"} className="quick-note-convert-dialog">
        <div className="ln-dialog__body">
          <h3>{convertItems.length > 1 ? `转为正式文档（${convertItems.length} 篇）` : "转为正式笔记"}</h3>
          <p>选择一个笔记本。{convertItems.length > 1 ? `${convertItems.length} 篇小记将依次插入该笔记本的最顶部；` : "新文档将插入其中的最顶部；"}转化完成后，小记将从时间线移除。</p>
          <div className="quick-note-notebook-list ln-list-panel ln-list-panel--background">
            {notebooks.map((notebook) => <button key={notebook.id} className="ln-list-item" disabled={saving} onClick={() => void convert(notebook.id)}><span className="ln-list-item__graphic"><FilePlus size={14} /></span><span className="ln-list-item__text ln-ellipsis">{notebook.title}</span></button>)}
            {notebooks.length === 0 && <span className="ln-empty">请先在资料库中新建一个笔记本。</span>}
          </div>
          <footer><button className="ln-btn ln-btn--ghost" disabled={saving} onClick={() => setConvertItems(null)}>取消</button></footer>
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
  /** 「保存并同步」的网络阶段（与 saving 分开：保存是本地写、同步是维护域网络操作）。 */
  syncing: boolean;
  /** 云同步是否可用：false ⇒「保存并同步」置灰（判据由工作区透传，单一来源）。 */
  cloudReady: boolean;
  /** 图片上传落盘（写进该草稿的 staging 空间）。 */
  uploadResource(request: unknown): Promise<ResourceUploadOutput>;
  /** 已有标签选项（从全部有效小记派生）。 */
  tagOptions: QuickNoteTagSummary[];
  onTextChange(text: string): void;
  onTagIdsChange(tagIds: string[]): void;
  /** 新建标签（写标签表后返回 ID）；选择器与写作卡共用。 */
  onCreateTag(name: string): Promise<string>;
  onEditorReady(api: QuickNoteEditorApi | null): void;
  /** 只保存到本机（原有语义）。 */
  onSave(): void;
  /** 保存到本机 **并且** 只把这一条推送到 S3（用户 261013 点单；主按钮）。 */
  onSaveAndSync(): void;
  onCancel(): void;
}

function QuickNoteComposer({ draft, saving, syncing, cloudReady, variant, ui = "card", active = true, uploadResource, tagOptions, onTextChange, onTagIdsChange, onCreateTag, onEditorReady, onSave, onSaveAndSync, onCancel }: ComposerProps) {
  const [tagPickerAnchor, setTagPickerAnchor] = useState<HTMLElement | null>(null);
  const tagNameOf = (id: string) => tagOptions.find((tag) => tag.id === id)?.name ?? "已删除标签";
  /** ⌘/Ctrl + Enter 触发主按钮（发布/保存）：编辑器可能吞键，故挂捕获阶段兜底。 */
  function publishOnShortcut(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onSave(); }
  }
  /** 本地写与网络推送两段都要禁用动作行（避免半途中重复提交）。 */
  const busy = saving || syncing;
  const publishLabel = variant === "pane" ? "小记一下" : "保存";
  /**
   * 主按钮**恒用强调色**（用户 261013 点单："桌面端的小记一下应该有颜色吧"）。
   * 旧口径（260915：新建空态＝中性描边、有内容才强调）作废 —— 动作行现在有**两个**同族描边按钮
   * （主按钮 +「保存并同步」），主按钮再走中性就分不出主次了。
   */
  const primary = (
    <button className="ln-btn ln-btn--primary quick-note-publish" disabled={busy} onClick={onSave}>
      {saving ? <LoaderCircle className="spin" size={15} /> : null}{saving ? "保存中" : publishLabel}
    </button>
  );
  /** 「保存并同步」= **普通按钮**（不强调，与「取消」同族的中性描边），夹在主按钮与取消之间（用户 261013 定稿）。 */
  const saveAndSync = (
    <button
      className="ln-btn ln-btn--secondary quick-note-publish"
      disabled={busy || !cloudReady}
      title={cloudReady ? undefined : "云同步已关闭：不会联网。可先「保存」到本机，开启云同步后再同步。"}
      aria-label={cloudReady ? "保存并同步" : "保存并同步（云同步已关闭，不可用）"}
      onClick={onSaveAndSync}
    >
      {syncing ? <LoaderCircle className="spin" size={15} /> : null}{syncing ? "同步中" : "保存并同步"}
    </button>
  );
  const cancel = <button className="ln-btn ln-btn--ghost quick-note-discard" disabled={busy} onClick={onCancel}>取消</button>;
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
    <div className="quick-note-tags">
      <button
        type="button"
        className="quick-note-tag-add"
        disabled={busy}
        onClick={(event) => setTagPickerAnchor(event.currentTarget)}
      ><Plus size={12} /><span>添加标签</span></button>
      {draft.tagIds.map((tagId) => (
        <span className="quick-note-tag is-editable" key={tagId}>
          <span className="ln-ellipsis">{tagNameOf(tagId)}</span>
          <button type="button" aria-label={`移除标签 ${tagNameOf(tagId)}`} disabled={busy} onClick={() => onTagIdsChange(removeQuickNoteTagId(draft.tagIds, tagId))}><X size={11} /></button>
        </span>
      ))}
    </div>
    <div className={`quick-note-composer-actions quick-note-composer-actions--${variant}`}>
      {variant === "pane" ? <>
        {/* 写作卡（新建）：主按钮在最左、次级动作跟在后面（仿评论框），快捷键提示退到最后。 */}
        {primary}
        {saveAndSync}
        {cancel}
      </> : <>
        {/* 编辑既有小记：整组靠右下（对齐对话框底栏惯例：次级在左、主按钮在右），不再分居两角 */}
        {cancel}
        {saveAndSync}
        {primary}
      </>}
    </div>
    {tagPickerAnchor && (
      <QuickNoteTagPicker
        anchor={tagPickerAnchor}
        options={tagOptions}
        selected={draft.tagIds}
        onAdd={(tagId) => onTagIdsChange(addQuickNoteTagId(draft.tagIds, tagId))}
        onCreate={onCreateTag}
        onClose={() => setTagPickerAnchor(null)}
      />
    )}
  </>;
}

function QuickNoteCard({ item, revealed, deletePending, selecting, checked, onToggleSelect, onEdit, onDelete, onConvert, onAddTag, onFilterTag, onToggleTask }: {
  item: QuickNoteDocument; revealed: boolean; deletePending: boolean; selecting: boolean; checked: boolean;
  onToggleSelect(): void; onEdit(): void; onDelete(): void; onConvert(): void;
  onAddTag(anchor: HTMLElement): void; onFilterTag(name: string): void;
  onToggleTask(checkboxIndex: number, checked: boolean): void;
}) {
  /** 资源清单（带 url）：预览里的媒体卡按文件名到这里取真实资源。 */
  const assets = item.content.images.filter((asset): asset is QuickNoteImage & { url: string } => Boolean(asset.url));
  const imagesOnly = assets.filter((asset) => isQuickNoteImageMime(asset.mimeType));
  // 仿语雀：时间戳在卡片顶部（"更新于 08-04 14:16"），正文/图片在下
  const stamp = formatListTime(new Date(item.updatedAt || item.createdAt), new Date(), true);
  return <article
    data-quick-note-id={item.id}
    className={`quick-note-entry${item.isConflict ? " conflict" : ""}${selecting ? " selecting" : ""}${checked ? " is-checked" : ""}${revealed ? " is-revealed" : ""}`}
    onDoubleClick={selecting ? undefined : onEdit}
    onClick={selecting ? onToggleSelect : undefined}
  >
    {/* 勾选框常驻（左侧固定槽位）：默认 hover 才显形，点多选模式后常显 */}
    <button
      className={"qn-check quick-note-select" + (checked ? " is-on" : "")}
      role="checkbox" aria-checked={checked} aria-label={checked ? "取消选择" : "选择这篇小记"}
      onClick={(event) => { event.stopPropagation(); onToggleSelect(); }}
    >{checked && <Check size={13} />}</button>
    <header><time dateTime={item.updatedAt || item.createdAt}>更新于 {stamp}</time>{item.isConflict && <span className="badge badge--warn quick-note-conflict">同步冲突副本</span>}<div className="quick-note-card-actions"><button onClick={(event) => { event.stopPropagation(); onAddTag(event.currentTarget); }} title="添加标签"><Tag size={15} /></button><button onClick={onConvert} title="转为正式笔记"><FilePlus size={15} /></button><button onClick={onEdit} title="编辑小记"><Pencil size={15} /></button><button className="danger" onClick={onDelete} disabled={deletePending} title={deletePending ? "请先完成当前删除的撤销操作" : "删除小记"}><Trash size={15} /></button></div></header>
    {/* 卡片预览 = 自研只读渲染（零内核实例）：白名单块按真实结构显示（列表/待办/引用/标题/行内格式），
        媒体卡按正文顺序就地渲染；白名单外的块显示占位。解析不出内容时回落到纯文本镜像。 */}
    <QuickNotePreview
      body={item.content.body}
      noteId={item.id}
      assets={assets}
      fallbackText={item.content.text}
      onImageClick={(image) => openImagePreview(imagesOnly.map((it) => ({ src: it.url })), imagesOnly.findIndex((it) => it.id === image.id))}
      onToggleTask={onToggleTask}
    />
    {item.content.tagIds.length > 0 && (
      <div className="quick-note-card-tags">
        {item.content.tagIds.map((tagId, index) => {
          const name = item.content.tags[index];
          if (!name) return null;
          return (
            <button type="button" className="quick-note-tag is-selectable" key={tagId} onClick={(event) => { event.stopPropagation(); onFilterTag(tagId); }} title={`筛选标签：${name}`}>
              <span className="ln-ellipsis">{name}</span>
            </button>
          );
        })}
      </div>
    )}
  </article>;
}
