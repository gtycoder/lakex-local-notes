/**
 * 移动端小记 composer（新建/编辑共用）——**完整编辑能力**，与桌面共用同一套小记编辑器：
 *
 * - **顶部不再有内核工具条**（用户 261013 重做）：移动端小记改用**文档编辑那条 dock**
 *   （`EditorDockHost` = EditorDock + 插入接线；**复用同一份组件** ⇒ 文档侧以后改了这边自动跟），
 *   插入能力因此与文档一致：「＋」全量面板（图片/拍照/附件/表格/引用/分割线/代码块/高亮块/状态/音频/视频/
 *   分栏/折叠/日期/表情/日历/链接/文档引用）+「Aa」字体面板 +「更多」面板。
 *   ⇒ 早先"移动端小记插不了表格/代码块/公式/分栏/画板"的缺口**就此消掉**；
 *   **桌面小记不变**，仍用它自己的九项工具条（两端形态不同是有意的：用户 261013 定"安卓端不要和桌面一样"）。
 * - 写作区 = 桌面同款 `QuickNoteEditor`（一个 Lake 内核实例；`showToolbar:false` 只是关掉内核工具条，
 *   note 版式与正文排版不变。`disableVirtualRendering` 必须开 —— 小记没有内核内部滚动容器，虚拟渲染会量错视口）；
 * - 附件按类型成卡：内核 file input 交给我们 `uploadResource`，经 `bridge.stageQuickNoteAsset` 落盘
 *   `quick-notes/{id}/`，mp4→视频卡、mp3→音频卡、png→图片卡、其它→附件卡（`installMediaCardCategoryRouter`
 *   由 `QuickNoteEditor` 挂好，与文档侧同一模块）；
 * - 保存 = 内核 `text/lake`（body）+ 纯文本镜像 + **按正文引用派生的资源清单**（正文说什么就是什么，
 *   不依赖 UI 时序），与桌面 `.qnote` v2 同格式 ⇒ 两端互开互认。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { bridge } from "../bridge";
import { successFeedback, warnFeedback } from "../ui/haptics";
import { showToast } from "../ui/toastBus";
import { showNativeKeyboard } from "../native/nativeKeyboard";
import { canTouchNetwork } from "../../core/cloudState.js";
import { subscribeSyncSettings } from "../sync/syncSettingsStore";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { uploadLakeResource } from "../../features/editor/resourceUpload";
import { editorCommandFailureMessage, execEditorCommandResult } from "../editor/execCommand";
import { QuickNoteEditor, type QuickNoteEditorApi } from "../../features/quickNotes/QuickNoteEditor";
import { QuickNoteComposerSkeleton } from "./QuickNoteComposerSkeleton";
import { EditorDockHost } from "../editor/EditorDockHost";
// 光标/选区自动跟随滚动：**与文档编辑器同一份实现**（261014 —— 用户：光标必须始终在工具栏上方、
// 不被工具栏/键盘盖住）。小记此前没有这一环，文字一多光标就跑到屏幕外。
import { useCaretIntoView } from "../hooks/useCaretIntoView";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
// 内核样式（ne-* / ne-icon-symbol 的尺寸与配色）**由挂内核的入口自己保证**：
// 桌面走 styles/index.css 的全局 @import；移动端入口不引它，此前只有 mobile/editor/DocumentEditor 引 ⇒
// 冷启动后**先**开小记编辑器（另一个内核消费者）时样式缺席：内核图标按原生尺寸铺满 + 内核的原生
// <input type=file> 直接可见（261009 B2 实测：ne-icon 规则 0 条、7 个 >60px 的 ne-icon-symbol；开过一次文档即自愈）。
// 引在**移动端模块**而不是共享的 QuickNoteEditor：共享模块会把这份 CSS 也打进桌面入口，实测 app-css 1.79MB → 3.07MB（超预算）。
import "@dlient/lakex-doc-react/style.css";
import { emptyLakeBody } from "../../core/lakeDocForm.js";
import { extractAssetRefs, mediaKindOfFilename, mimeTypeForFilename } from "../../core/assetNaming.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { isQuickNoteImageMime, quickNoteBodyFromTextAndImages, type StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { addQuickNoteTag, removeQuickNoteTag, type QuickNoteTagSummary } from "../../core/quickNoteTags.js";
import { MobileQuickNoteTagSheet } from "./MobileQuickNoteTagSheet";

export interface QuickNoteComposerProps {
  /** 编辑目标（已有小记 id + 正文）；null = 新建 */
  editNote?: { id: string; text: string; body?: string; images: StoredQuickNoteImage[]; tags?: string[] } | null;
  /** 已有标签候选（从全部有效小记派生，随首页数据刷新）。 */
  tagOptions: readonly QuickNoteTagSummary[];
  /**
   * 草稿模式（261010：长按图标 / `locallakexnotes://quick-note` 深链那条 capture 路径用）：
   * 挂载时恢复上一次未提交的草稿（含富内容 body）、输入防抖落库、保存/取消清除。
   * 工作台里的「新建小记 / 编辑」不传（行为不变）。
   */
  draft?: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  /**
   * 自动聚焦后**再请系统弹一次软键盘**（原生 ShowKeyboard 插件）。
   * 只给"没有用户手势"的入口传（快捷 capture / 系统分享）：WebView 里程序化 focus 不弹键盘（AGENTS §7.28）。
   * 页面路（点「新建小记」）有手势、键盘本来就弹，不必多此一举。
   */
  raiseKeyboard?: boolean;
  /**
   * 首页「新建面板」带进来的**起手内容**（261014）：
   *   · `files` = 拍摄 / 图片 取到的文件 → 内核就绪后走 **insertFiles**（与 dock 同一条插入通道）；
   *   · `command` = 待办 → 走内核命令（taskList）。
   * 正文一律由内核产出，**不在这层拼 body**（docs/LAKE-CONTENT-WRITING.md）。只在新建时有值。
   */
  initialInsert?: { files?: File[]; command?: "taskList" } | null;
}

interface AssetMeta {
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
  hash: string;
}

/** 图片字节 → 尺寸（非图片/解码失败返回 null —— 模型允许附件宽高为空）。 */
async function readDimensions(bytes: Uint8Array, mimeType: string): Promise<{ width: number | null; height: number | null }> {
  if (!isQuickNoteImageMime(mimeType)) return { width: null, height: null };
  try {
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

export function QuickNoteComposer({ editNote, tagOptions, onSaved, onCancel, draft = false, raiseKeyboard = false, initialInsert = null }: QuickNoteComposerProps) {
  /** 初始 id：新建时先固定一个；草稿恢复后用**草稿自己的 id**（沿用 ⇒ 图片作用域一致）。 */
  const initialId = useMemo(() => editNote?.id ?? crypto.randomUUID(), [editNote]);
  const [noteId, setNoteId] = useState(initialId);
  const [initialBody, setInitialBody] = useState(() => (editNote?.body && editNote.body.trim() ? editNote.body : emptyLakeBody(initialId)));
  /** 草稿模式：**等草稿读完再挂内核**（QuickNoteEditor 只在挂载时读 initialBody，晚到会丢正文）。 */
  const [draftReady, setDraftReady] = useState(!draft || Boolean(editNote));
  /**
   * 内核实例（**必须是 state**）：`EditorDockHost` 通过 prop 拿它，而 ref 变化不触发重渲染 ——
   * 编辑器就绪后若不重渲染，dock 会一直拿到 null、命令全部静默失效（与 DocumentEditor 同一坑）。
   */
  const [editorInstance, setEditorInstance] = useState<LakeEditorInstance | null>(null);
  /** 内核实例是否已就绪：就绪前用同构骨架盖住卡片（否则模块到达后到内核就绪前是一张白卡）。 */
  const [editorReady, setEditorReady] = useState(false);
  /** 起手内容只消费一次：重挂/重渲染都不再重复插入。 */
  const pendingInsertRef = useRef(initialInsert);
  /** 保存成功 / 主动取消后不再写草稿。 */
  const committedRef = useRef(false);
  /** 写作卡根（光标跟随滚动的搜索边界：正文滚动容器就在它里面）。 */
  const cardRef = useRef<HTMLDivElement | null>(null);
  useCaretIntoView(cardRef, true);
  const [text, setText] = useState(editNote?.text ?? "");
  const [tags, setTags] = useState<string[]>(editNote?.tags ?? []);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 「保存并同步」的网络阶段（与保存分开：保存是本地写、同步是维护域网络操作）。 */
  const [syncing, setSyncing] = useState(false);
  /**
   * 云同步是否可用（判据 = bridge.getCloudState() → core/cloudState 的 canTouchNetwork，单一来源）。
   * false ⇒「保存并同步」**置灰**并给一行可见说明（用户 261013 定稿）；「保存」不受影响（本地是真相）。
   * 先进后出：设置页开关云同步时会经 syncSettingsStore 通知，这里跟着刷新。
   */
  const [cloudReady, setCloudReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<QuickNoteEditorApi | null>(null);
  /** 本会话上传过的资源元数据（filename → meta）：正文引用提取据此补齐清单。 */
  const uploadedRef = useRef<Map<string, AssetMeta>>(new Map());
  const pendingUploadsRef = useRef(0);
  /** 已有资源（编辑态）：保留 id 与元数据，正文里仍有引用时免去重算。 */
  const existingRef = useRef<Map<string, StoredQuickNoteImage>>(
    new Map((editNote?.images ?? []).map((image) => [image.filename, image])),
  );

  // 草稿恢复（仅 capture 路径）：内核 body **原样**带回；旧草稿（260920 轻量框写的，只有 text）
  // 用无内核写入通道 quickNoteBodyFromTextAndImages 重建，保证不产出裸 <img>。
  useEffect(() => {
    if (!draft || editNote) return;
    let alive = true;
    void (async () => {
      try {
        const saved = await bridge.getQuickNoteDraft();
        if (!alive || !saved) return;
        setNoteId(saved.id);
        // 旧草稿（260920 轻量框写的）只有 text ⇒ 用无内核写入通道重建正文（图片卡 + 段落，绝不裸 <img>）。
        // URL 不带 token：JSX 里 initialBody={addAssetAccessToken(...)} 统一加，与编辑态一致。
        setInitialBody(saved.body && saved.body.trim()
          ? saved.body
          : quickNoteBodyFromTextAndImages(
            saved.text,
            saved.images ?? [],
            (filename) => localAssetHttpUrl(saved.id, filename, { space: "quick-notes" }),
            () => crypto.randomUUID(),
          ));
        setText(saved.text);
        setTags(saved.tags ?? []);
      } catch { /* 读草稿失败不阻断输入 */ }
      finally { if (alive) setDraftReady(true); }
    })();
    return () => { alive = false; };
  }, [draft, editNote]);

  // 输入/正文变化后 300ms 防抖落草稿（纯本地 device_state，不进 S3）。body 存原样 ⇒ 恢复不丢富格式。
  useEffect(() => {
    if (!draft || !draftReady || committedRef.current) return;
    const timer = window.setTimeout(() => {
      if (committedRef.current) return;
      let body = "";
      try { body = stripAssetAccessToken(apiRef.current?.getBody() ?? ""); } catch { body = ""; }
      if (!text.trim() && !body.trim()) return;
      void bridge.saveQuickNoteDraft({ id: noteId, text, body, tags });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, draftReady, text, noteId, tags]);

  /**
   * 新建小记**自动聚焦**（用户 261013 定稿：两条路都要 —— 快捷 capture 与页面「新建小记」）。
   *
   * 为什么补一拍：内核在"刚 setDocument / 刚挂载"那一刻未必吃得下焦点（与 LAKEX-CONTRACT §5.32 的
   * "内核要等一拍"同一类时序），所以就绪后**立即试一次 + 150ms 再补一次**；两次都失败也不报错（用户可手动点）。
   * **只在创建时聚焦**（`editNote` 为空）：打开一条已有小记来编辑时不抢焦点（用户可能只是想看看）。
   * 提交后 capture 会重挂一条新的 ⇒ 这里再次触发，连续记不用手点。
   */
  const autoFocusIfCreating = useCallback(() => {
    if (editNote) return;
    const tryFocus = () => { try { apiRef.current?.focus(); } catch { /* 忽略：内核未就绪 */ } };
    tryFocus();
    window.setTimeout(tryFocus, 150);
    // 没手势的入口（快捷 capture / 分享）：DOM 焦点不够，Android 不会自己弹键盘 ⇒ 请原生动一次手（AGENTS §7.28）。
    // 放在两次聚焦之后，确保 WebView/编辑器已经拿到焦点再弹。
    if (raiseKeyboard) window.setTimeout(() => showNativeKeyboard(), 300);
  }, [editNote, raiseKeyboard]);

  /**
   * 起手内容落地（261014）：内核就绪后把「拍摄 / 图片」的文件插进正文、「待办」切成待办列表。
   * 插入只走 **insertFiles**（与 EditorDockHost 同一条通道）⇒ 与 dock 的文件插入行为完全一致；
   * 插入会把光标带到卡片后，再要一次焦点，用户接着就能打字。
   */
  useEffect(() => {
    const pending = pendingInsertRef.current;
    if (!pending || !editorInstance) return;
    pendingInsertRef.current = null;
    for (const file of pending.files ?? []) {
      const kind = mediaKindOfFilename(file.name);
      const opts = kind ? { category: kind, from: "ui" } : undefined;
      const result = execEditorCommandResult(editorInstance, "insertFiles", [file], opts);
      if (!result.ok && result.reason !== "editor-unavailable") showToast(editorCommandFailureMessage("insertFiles", result), { type: "error" });
    }
    if (pending.command) {
      const result = execEditorCommandResult(editorInstance, pending.command);
      if (!result.ok && result.reason !== "editor-unavailable") showToast(editorCommandFailureMessage(pending.command, result), { type: "error" });
    }
    if (pending.files?.length) {
      window.setTimeout(() => { try { apiRef.current?.focus(); } catch { /* 忽略：内核未就绪 */ } }, 0);
    }
  }, [editorInstance]);

  const uploadResource = useCallback(
    (request: unknown) =>
      uploadLakeResource(request, noteId, {
        // 小记 v1 不下载网络图片（与桌面一致：避免把外链写进小记资源空间）
        allowRemoteDownload: false,
        saveResource: async (input) => {
          pendingUploadsRef.current += 1;
          try {
            const stored = await bridge.stageQuickNoteAsset(noteId, { filename: input.filename, bytes: input.bytes });
            const mimeType = stored.mimeType || mimeTypeForFilename(stored.filename);
            const dimensions = await readDimensions(input.bytes, mimeType);
            uploadedRef.current.set(stored.filename, {
              mimeType,
              width: dimensions.width,
              height: dimensions.height,
              size: stored.size,
              hash: sha256Sync(input.bytes),
            });
            return {
              // 内核要能直接渲染：URL 带访问 token（保存时统一 strip）
              url: addAssetAccessToken(stored.url),
              resourceRef: stored.url,
              filename: stored.filename,
              mimeType,
              size: stored.size,
            };
          } finally {
            pendingUploadsRef.current = Math.max(0, pendingUploadsRef.current - 1);
          }
        },
      }),
    [noteId],
  );

  /** 正文引用 → 资源清单：优先本会话上传的元数据，其次已有清单，最后读回文件兜底。 */
  const collectImages = useCallback(async (body: string): Promise<StoredQuickNoteImage[]> => {
    const refs = extractAssetRefs(body);
    const images: StoredQuickNoteImage[] = [];
    for (const filename of refs) {
      const existing = existingRef.current.get(filename);
      let meta = uploadedRef.current.get(filename);
      if (!meta && existing) {
        meta = {
          mimeType: existing.mimeType,
          width: existing.width,
          height: existing.height,
          size: existing.size,
          hash: existing.hash,
        };
      }
      if (!meta) {
        // 兜底（桌面端插入 / 同步过来的资源）：读回文件算 size/hash，宽高允许为空
        const bytes = await bridge.getQuickNoteImage(noteId, filename).catch(() => null);
        if (!bytes) continue;
        const mimeType = mimeTypeForFilename(filename);
        const dimensions = await readDimensions(bytes, mimeType);
        meta = { mimeType, width: dimensions.width, height: dimensions.height, size: bytes.length, hash: sha256Sync(bytes) };
      }
      images.push({
        id: existing?.id ?? crypto.randomUUID(),
        filename,
        mimeType: meta.mimeType,
        width: meta.width,
        height: meta.height,
        size: meta.size,
        hash: meta.hash,
      });
    }
    return images;
  }, [noteId]);

  /**
   * 保存：withSync=false 只存本机；true =「保存并同步」（用户 261013 点单）。
   * 同步阶段放在 onSaved() **之前**：父组件收到 onSaved 会关掉 composer，之后再报结果就没地方显示了。
   * 同步失败不丢内容（本地已经存住），只如实提示并可重试。
   */
  const save = async (withSync: boolean): Promise<void> => {
    setError(null);
    const api = apiRef.current;
    let body = "";
    try {
      body = stripAssetAccessToken(api?.getBody() ?? "");
    } catch {
      body = "";
    }
    const plain = (api?.getText() ?? text).trim();
    // 内核插卡是异步的（视频/音频/附件卡要等上传完成）⇒ 保存前等本会话上传归零（最多 15s，与桌面同口径）。
    const deadline = Date.now() + 15_000;
    while (pendingUploadsRef.current > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    setSaving(true);
    try {
      const images = await collectImages(body);
      if (!plain && images.length === 0) {
        setError("请至少记录文字、一张图片或一个附件");
        setSaving(false);
        return;
      }
      await bridge.saveQuickNoteContent(noteId, { text: plain, body, images, tags });
      // 提交成功 ⇒ 草稿使命结束（不清会让下次 capture 恢复出已保存的内容）
      committedRef.current = true;
      if (draft) await bridge.clearQuickNoteDraft().catch(() => undefined);
      if (withSync) {
        setSyncing(true);
        try {
          const outcome = await bridge.syncQuickNote(noteId);
          if (outcome.status === "not-found") showToast("这条小记不在本机（可能已被删除）", { type: "error" });
          else if (outcome.status === "pushed") showToast(outcome.unchanged ? "已是最新，无需上传" : "已同步到云端");
          else if (outcome.reason === "no-remote-manifest") showToast("云端还没有小记清单，已执行一次完整同步");
          else showToast("这条小记已在其他设备删除，已按删除处理", { type: "error" });
        } catch (reason) {
          showToast("已保存到本机 · 同步失败：" + (reason as Error).message, { type: "error" });
        } finally {
          setSyncing(false);
        }
      }
      successFeedback();
      await onSaved();
    } catch (reason) {
      setError("保存失败: " + (reason as Error).message);
      warnFeedback();
    } finally {
      setSaving(false);
    }
  };

  // 云同步可用性：挂载时读一次 + 设置里改动时刷新（读操作，不触网）
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void bridge.getCloudState()
        .then((state) => { if (alive) setCloudReady(canTouchNetwork(state)); })
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = subscribeSyncSettings(refresh);
    return () => { alive = false; unsubscribe(); };
  }, []);

  // 草稿未读完先不挂内核（避免用空正文建实例、随后又拿不到已恢复的内容）
  if (!draftReady) return <QuickNoteComposerSkeleton />;

  // data-mb-edit-host / data-mb-kernel = 编辑面契约标记（内核几何收口见 edit-surface-kernel.css）
  return (
    <div className="mobile-qn-composer" ref={cardRef} data-mb-edit-host data-mb-kernel="note" data-capture={draft ? "1" : undefined}>
      <QuickNoteEditor
        ownerId={noteId}
        initialBody={addAssetAccessToken(initialBody)}
        ui="card"
        active
        uploadResource={uploadResource}
        onTextChange={setText}
        onReady={(api) => {
          apiRef.current = api;
          if (!api) return;
          setEditorReady(true);
          autoFocusIfCreating();
        }}
        /* 顶部不要内核那套九项工具条（用户 261013）：移动端小记改用**文档编辑那条 dock**（EditorDockHost），
           关掉用的是内核既有开关（showToolbar:false ⇒ disabledPlugins 去掉 toolbar），不是我们另做一套隐藏。 */
        showToolbar={false}
        onEditorInstance={setEditorInstance}
      />
      {error && <div className="mobile-qn-error">{error}</div>}
      {/* 置灰必须给理由（移动端没有 hover 提示）：只在这一行说明，不新增样式 */}
      {!cloudReady && <div className="mobile-qn-hint">云同步已关闭：不会联网。「保存」只存到本机，开启云同步后可再同步。</div>}
      <div className="qn-tag-row">
        <button type="button" className="qn-tag-add" onClick={() => setTagSheetOpen(true)} disabled={saving || syncing}>
          <Plus size={13} /><span>添加标签</span>
        </button>
        {tags.map((tag) => (
          <span className="qn-tag is-editable" key={tag}>
            <span className="mb-ellipsis">{tag}</span>
            <button type="button" className="qn-tag__remove" aria-label={`移除标签 ${tag}`} onClick={() => setTags(removeQuickNoteTag(tags, tag))} disabled={saving || syncing}>
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
      <footer className="mobile-qn-actions">
        {/* 这里原有一行写死的「工具条：…」清单：工具条条目一变它就变成假话（本轮已发生两次）。
            删掉 —— 工具条自己就是唯一来源，不再抄一份会漂移的清单。 */}
        <div className="mobile-qn-spacer" />
        <button type="button" className="mobile-qn-btn" onClick={() => { committedRef.current = true; if (draft) void bridge.clearQuickNoteDraft().catch(() => undefined); onCancel(); }} disabled={saving || syncing}>取消</button>
        {/* 「保存并同步」= 普通按钮，夹在「取消」与主按钮之间（用户 261013 定稿：主按钮保持原来的「保存」），
            只推这一条小记；保存本身先落本地，网络失败也不丢内容。 */}
        <button
          type="button"
          className="mobile-qn-btn"
          onClick={() => void save(true)}
          disabled={saving || syncing || !cloudReady}
          title={cloudReady ? undefined : "云同步已关闭：不会联网"}
        >
          {syncing ? "同步中…" : "保存并同步"}
        </button>
        <button type="button" className="mobile-qn-btn mobile-qn-primary" onClick={() => void save(false)} disabled={saving || syncing}>
          <Check size={15} />{saving ? "保存中…" : "保存"}
        </button>
      </footer>
      {/* 输入法式底部 dock = **文档编辑器那一份**（EditorDockHost；复用而非照抄，文档侧改了这边自动跟）。
          顶部不再有内核工具条；插入能力（图片/拍照/附件/表格/表情/日历/…）全部由它提供。 */}
      {/* undoBackend="snapshot"：小记用内核 note-mini，键入不进 kernel history ⇒ 走前端快照栈（思源 LocalUndo 式）。 */}
      <EditorDockHost editor={editorInstance} editing undoBackend="snapshot" />
      {/* 261022：模块已到、内核未就绪的窗口期用同一份骨架盖住（不是启动遮罩；就绪即同帧揭掉）。 */}
      {!editorReady && (
        <div className="mb-composer-skel-cover">
          <QuickNoteComposerSkeleton bare />
        </div>
      )}
      <MobileQuickNoteTagSheet
        open={tagSheetOpen}
        options={tagOptions}
        selected={tags}
        onAdd={(tag) => setTags(addQuickNoteTag(tags, tag))}
        onClose={() => setTagSheetOpen(false)}
      />
    </div>
  );
}
