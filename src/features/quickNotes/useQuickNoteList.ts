/**
 * 小记列表域（261112 R1 Q19-5）：从 QuickNotesWorkspace 抽出（**零行为变化**）。
 *
 * 职责：列表投影 items / 详情缓存与在途去重 / 首屏正文预热 / 标签目录。
 * 单一来源不变：预热判据仍在 core/quickNoteDetailPrewarm（本文件只调用），
 * 列表投影字段口径与主进程一致（DT-05）。
 */
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { native } from "../../lib/native";
import { createRequestVersion } from "../../core/requestVersion";
import { quickNotePrewarmIds } from "../../core/quickNoteDetailPrewarm";
import { getNativeErrorMessage, reportNativeActionError } from "../../lib/nativeErrors";
import type { QuickNoteDocument, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";

export const listSummaryOf = (doc: QuickNoteDocument): QuickNoteListSummary => ({
  id: doc.id,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  previewText: doc.previewText,
  imageCount: doc.imageCount,
  contentHash: doc.contentHash,
  syncState: doc.syncState,
  isConflict: doc.isConflict,
  tagIds: doc.content.tagIds,
  tags: doc.content.tags,
  assetMimeTypes: [...new Set(doc.content.images.map((image) => image.mimeType))],
});

export interface QuickNoteListApi {
  items: QuickNoteListSummary[];
  setItems: Dispatch<SetStateAction<QuickNoteListSummary[]>>;
  loading: boolean;
  tagDirectory: QuickNoteTag[];
  refreshItems(showLoading?: boolean): Promise<QuickNoteListSummary[]>;
  refreshTags(): Promise<void>;
  createTag(name: string): Promise<string>;
  ensureDetail(id: string): Promise<QuickNoteDocument | null>;
  getCachedDetail(id: string): QuickNoteDocument | undefined;
  cacheDetail(doc: QuickNoteDocument): void;
  invalidateListVersion(): void;
}

/**
 * @param visible 工作区可见性（keep-alive）：每次进入小记空间都重拉列表与标签目录。
 * @param setError 错误落到宿主视图（错误条只在宿主渲染，本 hook 不持有 UI）。
 */
export function useQuickNoteList({ visible = true, setError, pendingDeleteIdRef }: {
  visible?: boolean;
  setError: (message: string | null) => void;
  /** 撤销窗口内尚未落盘删除的小记 id（由宿主 pendingDelete 维护）：外部刷新不得把它拉回列表。 */
  pendingDeleteIdRef: MutableRefObject<string | null>;
}): QuickNoteListApi {
  const [items, setItems] = useState<QuickNoteListSummary[]>([]);
  /** 单条完整文档缓存（卡片进视口 / 打开编辑 / 复制 / 勾待办时按需 read_quick_note）。 */
  const detailCacheRef = useRef<Map<string, QuickNoteDocument>>(new Map());
  /** 在途读取去重（同一 id 只飞一次 IPC）。 */
  const detailRequestsRef = useRef<Map<string, Promise<QuickNoteDocument | null>>>(new Map());
  /** 详情缓存不是 state；读回后用这个计数触发重渲染。 */
  const [, bumpDetailRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tagDirectory, setTagDirectory] = useState<QuickNoteTag[]>([]);
  const listVersionRef = useRef(createRequestVersion());

  /** 把完整文档放进缓存（同一 id 覆盖）并触发重渲染。 */
  function cacheDetail(doc: QuickNoteDocument): void {
    detailCacheRef.current.set(doc.id, doc);
    bumpDetailRevision((value) => value + 1);
  }

  /** 按 id 取单条完整文档（缓存命中直接回；并发同一 id 复用同一个 Promise）。 */
  function ensureDetail(id: string): Promise<QuickNoteDocument | null> {
    const cached = detailCacheRef.current.get(id);
    if (cached) return Promise.resolve(cached);
    const pending = detailRequestsRef.current.get(id);
    if (pending) return pending;
    const request = native.readQuickNote(id)
      .then((doc) => { cacheDetail(doc); return doc; })
      .catch((reason) => { reportNativeActionError("读取小记", reason); return null; })
      .finally(() => { detailRequestsRef.current.delete(id); });
    detailRequestsRef.current.set(id, request);
    return request;
  }

  async function refreshItems(showLoading = false): Promise<QuickNoteListSummary[]> {
    const version = listVersionRef.current.next();
    if (showLoading) setLoading(true);
    let result: QuickNoteListSummary[] = [];
    try {
      const nextItems = await native.listQuickNotes();
      if (listVersionRef.current.isCurrent(version)) {
        // 乐观删除尚未到期落盘时，同步完成等外部刷新会把该小记重新拉回列表 → 表现为「删不掉」。
        // 刷新结果里过滤掉撤销窗口内的那条，保持它与 UI 一致（到期由定时器真正删除；撤销则重新显示）。
        const pendingId = pendingDeleteIdRef.current;
        result = pendingId ? nextItems.filter((item) => item.id !== pendingId) : nextItems;
        // 详情缓存按 contentHash 失效：同步/他端改动后列表 hash 会变，不失效会一直显示旧正文。
        const fresh = new Map(result.map((item) => [item.id, item] as const));
        for (const [id, document] of detailCacheRef.current) {
          const summary = fresh.get(id);
          if (!summary || summary.contentHash !== document.contentHash) detailCacheRef.current.delete(id);
        }
        // 首屏正文预热（261112 用户报「小记第一打开闪屏」）：判据与条数上限见 core/quickNoteDetailPrewarm。
        // 列表投影不带正文（DT-05）⇒ 卡片首帧只能画 previewText 纯文本（无标题/加粗），而正文靠
        // IntersectionObserver 懒读（回调必然晚于首帧）⇒ 下一帧才换成富预览 = 肉眼可见的闪。
        // 这里在 setItems **之前**把「一屏条数内」的正文并发读回（进同一份 detailCache，卡片照旧走
        // onNeedDetail 兜底）⇒ 首帧即富预览；命中缓存时零 IPC。
        const prewarmIds = quickNotePrewarmIds(
          result,
          new Map([...detailCacheRef.current].map(([id, document]) => [id, document.contentHash] as const)),
        );
        if (prewarmIds.length > 0) {
          const warmed = await Promise.all(prewarmIds.map((id) => native.readQuickNote(id).catch(() => null)));
          if (listVersionRef.current.isCurrent(version)) {
            for (const document of warmed) if (document) detailCacheRef.current.set(document.id, document);
          }
        }
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每次**进入**小记空间都重新拉列表与标签目录（261111 用户报「AI 写作保存到小记后找不到」）。
  // 本工作区是 keep-alive：只在挂载时拉一次 ⇒ 在别处新增/改动的小记（AI 写作保存、同步拉取、他端改动）
  // 切过来时列表仍是旧的，看着就像「没存上」。进入即刷新，成本只有两条本地 IPC。
  useEffect(() => {
    if (!visible) return;
    void refreshItems(false);
    void refreshTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return {
    items, setItems, loading, tagDirectory,
    refreshItems, refreshTags, createTag, ensureDetail, cacheDetail,
    getCachedDetail: (id: string) => detailCacheRef.current.get(id),
    invalidateListVersion: () => listVersionRef.current.invalidate(),
  };
}
