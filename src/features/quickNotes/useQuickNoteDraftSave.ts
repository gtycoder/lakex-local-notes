/**
 * 小记草稿与保存域的 hook（261112 R1 Q19-5）：从 QuickNotesWorkspace **原样搬入**（零行为变化）。
 *
 * 单一来源不变（**不要**在这里重写判据）：
 * - 媒体卡 pending 判据 = components/model/quickNoteDraft 的 hasPendingMediaCard；
 * - 「保存并同步」回退文案 = core/quickNoteSyncTypes 的 QUICK_NOTE_FULL_SYNC_TEXT（不折叠理由）；
 * - 「没改动就不写库」/ 上传等待窗口 / 列表视图留编辑器的收尾都在这里保持原实现；
 * - 列表投影/详情缓存走 useQuickNoteList（本 hook 只调用，不另建缓存）。
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { native } from "../../lib/native";
import { getNativeErrorMessage, reportNativeActionError } from "../../lib/nativeErrors";
import { uploadLakeResource } from "../editor/resourceUpload";
import { toggleTaskInBody } from "./quickNotePreviewParser";
import { QUICK_NOTE_FULL_SYNC_TEXT } from "../../core/quickNoteSyncTypes";
import { newDraft, draftOf, hasDraftContent, isDraftDirty, hasPendingMediaCard, type DraftState, type DraftImage } from "../../components/model/quickNoteDraft";
import type { QuickNoteImage, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";
import type { QuickNoteEditorApi } from "./QuickNoteEditor";
import { listSummaryOf, type QuickNoteListApi } from "./useQuickNoteList";

export interface QuickNoteDraftSaveApi {
  createDraft: DraftState;
  setCreateDraft: Dispatch<SetStateAction<DraftState>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  editingDraft: DraftState | null;
  setEditingDraft: Dispatch<SetStateAction<DraftState | null>>;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  syncing: boolean;
  /** 有未保存改动（新建草稿有内容，或编辑中的草稿与载入基线不同）。 */
  dirty: boolean;
  saveDraft(clicked: DraftState): Promise<{ ok: boolean; id: string | null }>;
  saveDraftAndSync(clicked: DraftState): Promise<void>;
  saveBeforeSwitch(): Promise<boolean>;
  cancelDraft(draft: DraftState): Promise<void>;
  startEditing(item: QuickNoteListSummary): Promise<void>;
  startNewDraft(): Promise<void>;
  togglePreviewTask(noteId: string, checkboxIndex: number, checked: boolean): Promise<void>;
  copyNoteText(item: QuickNoteListSummary): Promise<void>;
  handleEditorReady(draftId: string, api: QuickNoteEditorApi | null): void;
  quickNoteUploader(draftId: string): (request: unknown) => ReturnType<typeof uploadLakeResource>;
}

export function useQuickNoteDraftSave({ list, viewMode, tagDirectory, confirm, setError, setViewHint }: {
  list: QuickNoteListApi;
  viewMode: "note" | "list";
  tagDirectory: QuickNoteTag[];
  confirm(options: { title: string; body?: string; confirmText?: string; danger?: boolean }): Promise<boolean>;
  setError: (message: string | null) => void;
  setViewHint: (message: string | null) => void;
}): QuickNoteDraftSaveApi {
  /** 列表只存投影（DT-05）：正文/资源按 id 懒加载进 detailCacheRef。 */
  const [createDraft, setCreateDraft] = useState<DraftState>(() => newDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  /** 「保存并同步」的网络阶段（与 saving 分开：保存是本地写，同步是维护域网络操作）。 */
  const [syncing, setSyncing] = useState(false);

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
  // 「有未保存改动」= 新建草稿有内容，或编辑中的草稿与载入基线不同（不再拿"有没有内容"当脏判据）
  const dirty = isDraftDirty(createDraft) || (editingDraft !== null && isDraftDirty(editingDraft));



  useEffect(() => { draftsRef.current = { create: createDraft, editing: editingDraft }; }, [createDraft, editingDraft]);


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
      list.invalidateListVersion();
      list.cacheDetail(saved);
      list.setItems((current) => {
        const without = current.filter((item) => item.id !== saved.id);
        return [listSummaryOf(saved), ...without].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      if (isEditing) settleAfterSave(draft, { text, body, images: saved.content.images.map((image) => ({ image, source: "saved" as const })), tagIds: saved.content.tagIds });
      else if (createDraft.id === draft.id) setCreateDraft(newDraft());
      return { ok: true, id: saved.id };
    } catch (reason) { setError(`保存小记失败：${getNativeErrorMessage(reason)}`); return { ok: false, id: null }; }
    finally { setSaving(false); }
  }

  /**
   * 「保存并同步」（用户 261013 / 261110 定稿）：走 v3 **单条快路径**（core/s3v3/quickPush，只推这一条）；
   * 只有 4 类情况（无 pointer / 无基线 / 云端索引已变 / 远端墓碑且本机无恢复标记）才回退整轮，
   * 且**如实回传理由**（不折叠，见 core/quickNoteSyncTypes 的 QUICK_NOTE_FULL_SYNC_TEXT）。
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
      } else if (outcome.status === "full-sync") {
        // 4 个理由各有准确文案（单一来源；不折叠，见 F-04）。remote-deleted 还要收起编辑态。
        setViewHint(QUICK_NOTE_FULL_SYNC_TEXT[outcome.reason]);
        if (outcome.reason === "remote-deleted") { setEditingId(null); setEditingDraft(null); }
      }
      await list.refreshItems(); // refreshItems 自己会 bump 版本号（不必先 invalidate）
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
    if (hasDraftContent(draft) && !(await confirm({
      title: "放弃这次未保存的小记？",
      body: "这条小记还没保存，放弃后本次输入的内容会丢失。",
      confirmText: "放弃",
      danger: true,
    }))) return;
    await native.discardQuickNoteDraft(draft.id).catch((error) => reportNativeActionError("丢弃小记草稿", error));
    stagedAssetsRef.current.delete(draft.id);
    if (editingDraft?.id === draft.id) {
      // 列表视图：取消 = 放弃改动后回到该条的**已保存状态**。直接原地重开这份草稿（一次提交、只重建一次编辑器）；
      // 不能"先清空再靠默认选中补回来" —— 那是两次提交 = 连拆两次编辑器，肉眼一闪（用户 260920 报的闪烁）。
      // DT-05：正文不在列表里，先取回该条完整文档。
      const item = editingId ? await list.ensureDetail(editingId) : null;
      if (viewMode === "list" && item) { setEditingDraft(draftOf(item)); return; }
      setEditingId(null); setEditingDraft(null);
    } else if (createDraft.id === draft.id) setCreateDraft(newDraft());
  }

  async function startEditing(item: QuickNoteListSummary) {
    if (editingId === item.id) return;
    // 切换默认保存（用户 260919）：有改动先把当前草稿存下来（没改动时 saveDraft 直接跳过、不写库），
    // 只有保存失败才中止切换，避免"以为存了其实没存"。
    if (dirty && !(await saveBeforeSwitch())) return;
    // DT-05：列表只有 summary，编辑前按 id 取回正文/资源。
    const document = await list.ensureDetail(item.id);
    if (!document) { setError("读取小记失败：这条小记可能已不存在"); return; }
    setEditingId(item.id); setEditingDraft(draftOf(document));
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
    // DT-05：正文不在列表投影里；预览卡片按需取回该条完整文档再改写正文。
    const item = await list.ensureDetail(noteId);
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
      list.invalidateListVersion();
      list.cacheDetail(saved);
      list.setItems((current) => current.map((candidate) => (candidate.id === noteId ? listSummaryOf(saved) : candidate)));
    } catch (reason) { setError(`更新待办失败：${getNativeErrorMessage(reason)}`); }
  }

  /** 复制小记纯文本（云端的「复制链接」在本地语义下换成复制文本；小记没有可分享链接）。 */
  async function copyNoteText(item: QuickNoteListSummary) {
    try {
      // DT-05：复制要完整纯文本（previewText 是截断的），按需取回该条文档。
      const document = await list.ensureDetail(item.id);
      if (!document) return;
      await navigator.clipboard.writeText(document.content.text ?? "");
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

  // 草稿里引用的标签可能被删除（标签管理或同步墓碑）：删掉后从草稿与基线一起剔除，
  // 否则保存时 setQuickNoteTags 会因「标签不存在或已删除」直接失败、卡住整次保存。
  useEffect(() => {
    const active = new Set(tagDirectory.map((tag) => tag.id));
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

  return {
    createDraft, setCreateDraft, editingId, setEditingId, editingDraft, setEditingDraft,
    saving, setSaving, syncing, dirty,
    saveDraft, saveDraftAndSync, saveBeforeSwitch, cancelDraft, startEditing, startNewDraft,
    togglePreviewTask, copyNoteText, handleEditorReady, quickNoteUploader,
  };
}
