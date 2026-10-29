/**
 * 设置 · 资源 —— 未引用资源浏览器。
 * **布局复刻思源资产页，样式仍走我们自己的设计系统**（用户 261006 定稿）。
 *
 * 单栏、上下分区：
 *   · 上半 = 操作 + 列表（吃满剩余高度、内容多了自己滚）：四个大页签（可删 / 历史保护 / 缺失 / 缺正文）、
 *     类型筛选、全选 + 清理选中、按文档分组的列表（行内动作：复制路径 / 在文件夹中显示 / 删除）。
 *   · 下半 = 固定 1/3 高的**纯预览**：只有内容（图片 / PDF / 视频 / 音频），不放文字、不放按钮。
 *
 * 预览不经 IPC / base64，直接用本地资源服务器直链（electron/assetServer.ts）：
 * 图片走 ?w=1024 档位，音视频与 PDF 用原图（服务端支持 Range）。
 * "缺失"是**一等分类**（登记还在、磁盘文件已不在）：由主进程 listRemovedAssets 的 fileMissing 给出，
 * 不靠前端图片 onError 猜——后者对非图片类型根本不触发。
 * "缺正文"（261023）= 文档的 .lake 被手动删除：按可恢复性分三组（可云恢复 / 仅历史 / 无备份），
 * 行内处置 = 从云端拉回 / 恢复最新历史 / 彻底删除（移入回收站后 purge，写墓碑）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudDownload, Copy, FileText, FolderOpen, History, Image as ImageIcon, Paperclip, RefreshCw, StickyNote, Trash } from "lucide-react";
import { escapeId } from "../../lib/cssEscape";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { formatBytes } from "../../lib/formatBytes";
import { localAssetHttpUrl, withAssetWidth } from "../../core/assetUrl";
import type { MissingBodyDoc, MissingQuickNoteDoc } from "../../core/missingBody";
import { ASSET_PORT, withAssetAccessToken } from "../../lib/assetPort";
import { fileKindOf, type AssetFileKind } from "../../core/assetNaming";
import { FileKindIcon } from "../../features/bitable/FileKindIcon";
import { Dialog } from "../ui/Overlay";
import { SplitPane } from "../ui/SplitPane";
import { Select } from "../ui/Select";

/** 全局「被移除资源」条目（与主进程 listRemovedAssets 的返回一致）。 */
export interface RemovedAsset {
  noteId: string;
  filename: string;
  status: "orphan" | "history";
  orphanId?: number;
  size: number;
  mimeType: string;
  noteTitle?: string;
  noteState?: "active" | "trash" | "missing";
  detectedAt?: string;
  fileMissing?: boolean;
}

export type AssetKindBucket = "image" | "media" | "doc" | "other";
export type AssetPreviewKind = "image" | "video" | "audio" | "pdf" | "none";

/** 类型筛选桶（扩展名口径走 core 的单一事实源 fileKindOf）。 */
export function assetKindBucket(kind: AssetFileKind): AssetKindBucket {
  if (kind === "image") return "image";
  if (kind === "video" || kind === "audio") return "media";
  if (kind === "pdf" || kind === "doc" || kind === "sheet" || kind === "slide" || kind === "text" || kind === "code") return "doc";
  return "other";
}

/** 能内嵌预览的类型：优先看 MIME（更准），回落扩展名。 */
export function assetPreviewKind(item: Pick<RemovedAsset, "filename" | "mimeType">): AssetPreviewKind {
  const mime = item.mimeType ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const kind = fileKindOf(item.filename);
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "pdf") return "pdf";
  return "none";
}

/** 预览直链：本地资源服务器 + 运行期 token；`width=null` 表示原图。 */
export function assetDisplayUrl(item: Pick<RemovedAsset, "noteId" | "filename">, width: number | null): string {
  const base = withAssetAccessToken(localAssetHttpUrl(item.noteId, item.filename, { port: ASSET_PORT }));
  return withAssetWidth(base, width);
}

const KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "media", label: "视频 / 音频" },
  { value: "doc", label: "文档" },
  { value: "other", label: "其他" },
];

const keyOf = (item: Pick<RemovedAsset, "noteId" | "filename">): string => item.noteId + "/" + item.filename;

type StatusFilter = "orphan" | "history" | "missing" | "body" | "qbody";

/** 纯预览台：只有内容，不放文字与按钮（思源式下半区）。 */
function AssetStage({ item, broken, onBroken }: { item: RemovedAsset | null; broken: boolean; onBroken: () => void }) {
  if (!item) return <div className="asset-browser__placeholder" aria-hidden="true"><ImageIcon size={26} /></div>;
  const preview = broken ? "none" : assetPreviewKind(item);
  if (preview === "none") return <div className="asset-browser__placeholder" aria-hidden="true"><FileKindIcon name={item.filename} size={40} /></div>;
  const src = assetDisplayUrl(item, preview === "image" ? 1024 : null);
  return (
    <>
      {preview === "image" && <img src={src} alt="" onError={onBroken} />}
      {preview === "video" && <video src={src} controls preload="metadata" onError={onBroken} />}
      {preview === "audio" && <audio src={src} controls preload="metadata" onError={onBroken} />}
      {preview === "pdf" && <iframe src={src} title={item.filename} onError={onBroken} />}
    </>
  );
}

const BODY_RECOVERY_LABEL: Record<MissingBodyDoc["recovery"], string> = {
  cloud: "可云恢复",
  history: "仅历史",
  none: "无备份",
};
const BODY_RECOVERY_GROUP_LABEL: Record<MissingBodyDoc["recovery"], string> = {
  cloud: "可从云端恢复",
  history: "仅能恢复历史版本",
  none: "无法恢复（只能删除）",
};
const QUICK_RECOVERY_LABEL: Record<MissingQuickNoteDoc["recovery"], string> = {
  cloud: "可云恢复",
  text: "仅缓存文本",
  none: "无备份",
};
const QUICK_RECOVERY_GROUP_LABEL: Record<MissingQuickNoteDoc["recovery"], string> = {
  cloud: "可从云端恢复",
  text: "仅能用搜索缓存恢复纯文本",
  none: "无法恢复（只能删除）",
};
const QUICK_RECOVERY_BADGE: Record<MissingQuickNoteDoc["recovery"], string> = {
  cloud: "badge--accent",
  text: "badge--warn",
  none: "badge--error",
};

function quickRestoreFailureText(reason: "cloud-off" | "no-cloud-config" | "not-in-cloud" | "object-missing" | "hash-mismatch" | "invalid-content"): string {
  switch (reason) {
    case "no-cloud-config": return "没有配置 S3（无法从云端恢复）。";
    case "cloud-off": return "云同步已关闭（应用不会联网），无法从云端恢复。";
    case "not-in-cloud": return "云端没有这条小记（可能已被云端回收）。";
    case "object-missing": return "云端记录里有这条小记，但正文文件已丢失。";
    case "hash-mismatch": return "云端正文校验不通过（hash 不符），已放弃。";
    case "invalid-content": return "云端正文格式无效，已放弃。";
  }
}
const BODY_RECOVERY_BADGE: Record<MissingBodyDoc["recovery"], string> = {
  cloud: "badge--accent",
  history: "badge--warn",
  none: "badge--error",
};

function bodyRestoreFailureText(reason: "cloud-off" | "no-cloud-config" | "not-in-cloud" | "object-missing" | "hash-mismatch"): string {
  switch (reason) {
    case "no-cloud-config": return "没有配置 S3（无法从云端恢复）。";
    case "cloud-off": return "云同步已关闭（应用不会联网），无法从云端恢复。";
    case "not-in-cloud": return "云端没有这篇文档（可能已被云端回收）。";
    case "object-missing": return "云端记录里有这篇文档，但正文文件已丢失。";
    case "hash-mismatch": return "云端正文校验不通过（hash 不符），已放弃，未写入本地。";
  }
}

export function AssetsBrowser({ active, onDataChanged }: { active: boolean; onDataChanged?: () => void }) {
  const [items, setItems] = useState<RemovedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("orphan");
  const [kind, setKind] = useState<string>("all");
  const [pendingDelete, setPendingDelete] = useState<RemovedAsset[] | null>(null);
  /** 预览媒体的 onError 兜底（文件在列表加载后才消失等边角）：仅用于把内容换成类型图标。 */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());

  const listRef = useRef<HTMLDivElement | null>(null);
  const allRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try { setItems(await native.listRemovedAssets()); }
    catch (error) { setMsg(getNativeErrorMessage(error)); }
  }, []);

  // ---- 缺正文（261023）：文档的 .lake 被手动删除后，在这里集中处置（云恢复 / 历史恢复 / 彻底删除） ----
  const [missingBodies, setMissingBodies] = useState<MissingBodyDoc[]>([]);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [bodyBusy, setBodyBusy] = useState<string | null>(null);
  const [bodyMsg, setBodyMsg] = useState<string | null>(null);
  const [pendingPurge, setPendingPurge] = useState<MissingBodyDoc | null>(null);
  // ---- 缺正文小记（261023）：小记没有历史快照，只有 云端镜像 / 搜索缓存纯文本 两条恢复路径 ----
  const [missingQuickNotes, setMissingQuickNotes] = useState<MissingQuickNoteDoc[]>([]);
  const [quickLoaded, setQuickLoaded] = useState(false);
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const [pendingPurgeQuick, setPendingPurgeQuick] = useState<MissingQuickNoteDoc | null>(null);

  const loadMissingQuickNotes = useCallback(async () => {
    try { setMissingQuickNotes(await native.listMissingQuickNotes()); setQuickLoaded(true); }
    catch (error) { setMsg(getNativeErrorMessage(error)); }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadMissingQuickNotes();
  }, [active, loadMissingQuickNotes]);

  const restoreQuickFromCloud = useCallback(async (doc: MissingQuickNoteDoc) => {
    setQuickBusy(doc.id);
    try {
      const result = await native.restoreMissingQuickNoteFromCloud(doc.id);
      if (result.ok) setQuickMsg("已从云端恢复这条小记。");
      else setQuickMsg(quickRestoreFailureText(result.reason));
      await loadMissingQuickNotes();
    } catch (error) {
      setQuickMsg(getNativeErrorMessage(error));
    } finally {
      setQuickBusy(null);
    }
  }, [loadMissingQuickNotes]);

  const restoreQuickFromText = useCallback(async (doc: MissingQuickNoteDoc) => {
    setQuickBusy(doc.id);
    try {
      await native.restoreMissingQuickNoteFromText(doc.id);
      setQuickMsg("已用搜索缓存重建纯文本（图片与格式丢失），恢复后为待同步状态。");
      await loadMissingQuickNotes();
    } catch (error) {
      setQuickMsg(getNativeErrorMessage(error));
    } finally {
      setQuickBusy(null);
    }
  }, [loadMissingQuickNotes]);

  const confirmPurgeQuick = useCallback(async () => {
    if (!pendingPurgeQuick) return;
    setQuickBusy(pendingPurgeQuick.id);
    try {
      await native.purgeMissingQuickNote(pendingPurgeQuick.id);
      setQuickMsg("已彻底删除这条小记（云端与其他设备也会同步删除）。");
      setPendingPurgeQuick(null);
      await loadMissingQuickNotes();
    } catch (error) {
      setQuickMsg(getNativeErrorMessage(error));
    } finally {
      setQuickBusy(null);
    }
  }, [pendingPurgeQuick, loadMissingQuickNotes]);


  const loadMissingBodies = useCallback(async () => {
    try { setMissingBodies(await native.listMissingBodies()); setBodyLoaded(true); }
    catch (error) { setMsg(getNativeErrorMessage(error)); }
  }, []);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useEffect(() => {
    // 每次进入资源空间都重新检查（用户可能刚删过文件）；进入"缺正文"页签时才真正扫描（只 stat）。
    if (!active) return;
    setBodyLoaded(false);
  }, [active]);
  useEffect(() => {
    // 进入资源页就统计一次（只 stat）：页签上的计数要从一开始就是真值，而不是点进去才变。
    if (active) void loadMissingBodies();
  }, [active, loadMissingBodies]);

  const restoreBodyFromCloud = useCallback(async (doc: MissingBodyDoc) => {
    setBodyBusy(doc.id);
    try {
      const result = await native.restoreMissingBodyFromCloud(doc.id);
      if (result.ok) {
        setBodyMsg(`已从云端恢复《${result.title}》。若该文档正在标签页里打开，请点它的「重新读取」。`);
        onDataChanged?.();
      } else {
        setBodyMsg(bodyRestoreFailureText(result.reason));
      }
      await loadMissingBodies();
    } catch (error) {
      setBodyMsg(getNativeErrorMessage(error));
    } finally {
      setBodyBusy(null);
    }
  }, [loadMissingBodies, onDataChanged]);

  const restoreBodyLatestHistory = useCallback(async (doc: MissingBodyDoc) => {
    setBodyBusy(doc.id);
    try {
      const snapshots = await native.listNoteHistory(doc.id);
      const newest = [...snapshots].sort((a, b) => b.id - a.id)[0];
      if (!newest) {
        setBodyMsg("这篇文档没有可恢复的历史版本。");
      } else {
        await native.restoreHistory(newest.id);
        setBodyMsg(`已从历史版本恢复《${doc.title}》（快照 ${newest.createdAt}）。`);
        onDataChanged?.();
      }
      await loadMissingBodies();
    } catch (error) {
      setBodyMsg(getNativeErrorMessage(error));
    } finally {
      setBodyBusy(null);
    }
  }, [loadMissingBodies, onDataChanged]);

  const confirmPurgeBody = useCallback(async () => {
    if (!pendingPurge) return;
    setBodyBusy(pendingPurge.id);
    try {
      await native.purgeMissingBody(pendingPurge.id);
      setBodyMsg(`已彻底删除《${pendingPurge.title}》（云端与其他设备也会同步删除）。`);
      setPendingPurge(null);
      onDataChanged?.();
      await loadMissingBodies();
    } catch (error) {
      setBodyMsg(getNativeErrorMessage(error));
    } finally {
      setBodyBusy(null);
    }
  }, [pendingPurge, loadMissingBodies, onDataChanged]);

  // 切分类/换类型 = 换上下文：右侧预览与勾选都清掉（否则会出现"预览还是上一个页签的文件"、
  // 以及"清理选中把看不见的条目也删了"——用户 261006 报的前者）。
  useEffect(() => {
    setFocus(null);
    setSelected(new Set());
  }, [status, kind]);

  // 列表变化后清理已失效的勾选与预览焦点（返回原引用避免多余渲染）。
  useEffect(() => {
    const alive = new Set(items.map(keyOf));
    setSelected((prev) => {
      const next = new Set([...prev].filter((key) => alive.has(key)));
      return next.size === prev.size ? prev : next;
    });
    setFocus((prev) => (prev && alive.has(prev) ? prev : null));
  }, [items]);

  const markBroken = useCallback((key: string) => setBroken((prev) => (prev.has(key) ? prev : new Set(prev).add(key))), []);

  const isMissing = useCallback((item: RemovedAsset) => item.fileMissing === true || broken.has(keyOf(item)), [broken]);

  const groupList = useMemo(() => {
    // ⚠️ 分组身份必须带 noteId：多篇文档会重名（"无标题文档"满地都是），只按 title|state 做 key
    // 会让 React 收到**重复 key** ⇒ 复用旧 DOM，切页签后左列表留下上一页签的行（用户 261006 报的残留）。
    const map = new Map<string, { key: string; title: string; state: string; items: RemovedAsset[] }>();
    for (const item of items) {
      const state = item.noteState ?? "active";
      const key = item.noteId + "|" + state;
      let group = map.get(key);
      if (!group) { group = { key, title: item.noteTitle ?? item.noteId, state, items: [] }; map.set(key, group); }
      group.items.push(item);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  }, [items]);

  // 三个分类互斥（用户 261006：去掉「全部」，只留可删 / 历史保护 / 缺失）。
  const counts = useMemo(() => ({
    orphan: items.filter((item) => item.status === "orphan" && !isMissing(item)).length,
    history: items.filter((item) => item.status === "history" && !isMissing(item)).length,
    missing: items.filter((item) => isMissing(item)).length,
  }), [items, isMissing]);

  const filtered = useMemo(() => {
    const inStatus = (item: RemovedAsset) => {
      if (status === "missing") return isMissing(item);
      if (status === "history") return item.status === "history" && !isMissing(item);
      return item.status === "orphan" && !isMissing(item);
    };
    return items.filter((item) => inStatus(item) && (kind === "all" || assetKindBucket(fileKindOf(item.filename)) === kind));
  }, [items, status, kind, isMissing]);

  const groups = useMemo(() => {
    const visible = new Set(filtered.map(keyOf));
    return groupList
      .map((group) => ({ ...group, items: group.items.filter((item) => visible.has(keyOf(item))) }))
      .filter((group) => group.items.length > 0);
  }, [groupList, filtered]);

  const visibleItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selectableItems = useMemo(() => filtered.filter((item) => item.orphanId != null), [filtered]);
  const selectedItems = useMemo(() => items.filter((item) => selected.has(keyOf(item))), [items, selected]);
  const selectedBytes = selectedItems.reduce((sum, item) => sum + (item.size || 0), 0);
  const totalBytes = items.reduce((sum, item) => sum + (item.size || 0), 0);
  const focusItem = items.find((item) => keyOf(item) === focus) ?? null;
  const focusKey = focusItem ? keyOf(focusItem) : null;

  useEffect(() => {
    const el = allRef.current;
    if (el) el.indeterminate = selected.size > 0 && selected.size < selectableItems.length;
  }, [selected, selectableItems.length]);

  const toggleSelect = (item: RemovedAsset) => {
    if (item.orphanId == null) return;
    const key = keyOf(item);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size >= selectableItems.length && selectableItems.length > 0)
      ? new Set()
      : new Set(selectableItems.map(keyOf)));
  };

  const moveFocus = (step: 1 | -1) => {
    if (visibleItems.length === 0) return;
    const index = visibleItems.findIndex((item) => keyOf(item) === focus);
    const next = index < 0
      ? (step === 1 ? visibleItems[0] : visibleItems[visibleItems.length - 1])
      : visibleItems[Math.min(visibleItems.length - 1, Math.max(0, index + step))];
    if (!next) return;
    const key = keyOf(next);
    setFocus(key);
    listRef.current?.querySelector<HTMLElement>(`[data-asset-key="${escapeId(key)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const copyPath = async (item: RemovedAsset) => {
    try { setMsg("已复制路径：" + await native.copyAssetPath(item.noteId, item.filename)); }
    catch (error) { setMsg(getNativeErrorMessage(error)); }
  };

  const openFolder = async (item: RemovedAsset) => {
    try { await native.showAttachmentInFolder(item.noteId, item.filename); }
    catch (error) { setMsg(getNativeErrorMessage(error)); }
  };

  const confirmDelete = async () => {
    const targets = pendingDelete ?? [];
    if (targets.length === 0) return;
    setBusy(true);
    setMsg(null);
    let deleted = 0;
    let freed = 0;
    let kept = 0;
    for (const item of targets) {
      if (item.orphanId == null) { kept++; continue; }
      try {
        const result = await native.deleteOrphanAsset(item.orphanId);
        if (result.deleted) { deleted++; freed += result.freedBytes; } else kept++;
      } catch { kept++; }
    }
    setPendingDelete(null);
    setSelected(new Set());
    setFocus(null);
    await refresh();
    setMsg(`已删除 ${deleted} 个未引用资源（释放 ${formatBytes(freed)}）${kept > 0 ? `，${kept} 个仍被引用或删除失败，已保留` : ""}`);
    setBusy(false);
  };

  const STATUS_TABS: Array<{ id: StatusFilter; label: string; count: number | null }> = [
    { id: "orphan", label: "可删", count: counts.orphan },
    { id: "history", label: "历史保护", count: counts.history },
    { id: "missing", label: "缺失", count: counts.missing },
    // 261023：文档正文被手动删除（.lake 不在）单独成一类 —— 可云恢复 / 仅历史 / 只能删除。
    // 未扫描完前不显示数字（不让"0"误导成"没有缺失"）。
    { id: "body", label: "缺正文", count: bodyLoaded ? missingBodies.length : null },
    // 261023：小记的正文文件缺失（无历史快照）。
    { id: "qbody", label: "缺小记", count: quickLoaded ? missingQuickNotes.length : null },
  ];

  const pendingBytes = (pendingDelete ?? []).reduce((sum, item) => sum + (item.size || 0), 0);

  // 非当前空间时不渲染：空间视图是 keep-alive 的，若隐藏视图里仍挂着整块 pane，
  // 每个页面的 DOM 都会多出这几十个元素（快照里表现为**所有态**一起漂）。
  // 组件本身不卸载（勾选/焦点仍在），与 TrashPanel 的 `if (!open) return null` 同口径。
  if (!active) return null;

  return (
    // 与回收站同构的整页 pane（用户 261006：资源提到和回收站一级，套回收站样式）
    <section className="resources-space-pane" role="region" aria-label="资源">
      {/* 操作区：横向页签走 kit 的 .ln-tabs（与回收站/历史面板同一原语）+ 类型筛选 */}
      <div className="asset-browser__status">
        <div className="ln-tabs">
          <div className="ln-tabs__track" role="tablist" aria-label="资源分类">
            {STATUS_TABS.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={status === tab.id}
                className={`ln-tabs__item${status === tab.id ? " is-active" : ""}`}
                onClick={() => setStatus(tab.id)}>
                {tab.label}{tab.count !== null && <span className="ln-tabs__count">{tab.count}</span>}
              </button>
            ))}
          </div>
        </div>
        <span className="ln-spacer" />
        {status !== "body" && <Select label="资源类型" value={kind} options={KIND_OPTIONS} onChange={setKind} className="asset-browser__kind" />}
      </div>

      {status === "qbody" ? (
        <div className="asset-browser__toolbar">
          <span className="asset-browser__summary">
            共 {missingQuickNotes.length} 条缺正文小记。小记没有历史快照：能云恢复的优先云恢复，否则只能用搜索缓存重建纯文本
          </span>
          <span className="ln-spacer" />
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="刷新" title="重新检查小记文件" onClick={() => void loadMissingQuickNotes()}><RefreshCw size={14} /></button>
        </div>
      ) : status === "body" ? (
        <div className="asset-browser__toolbar">
          <span className="asset-browser__summary">
            共 {missingBodies.length} 篇缺正文文档。云恢复需联网（关闭云同步的库不会显示为可恢复）
          </span>
          <span className="ln-spacer" />
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="刷新" title="重新检查正文文件" onClick={() => void loadMissingBodies()}><RefreshCw size={14} /></button>
        </div>
      ) : (
        <div className="asset-browser__toolbar">
          <label className="asset-browser__all">
            <input ref={allRef} type="checkbox" checked={selectableItems.length > 0 && selected.size >= selectableItems.length} onChange={toggleSelectAll} aria-label="全选可删资源" />
            <span>全选可删（{selectableItems.length}）</span>
          </label>
          <span className="ln-spacer" />
          <span className="asset-browser__summary">
            {selected.size > 0 && <strong>{selected.size} 个，{formatBytes(selectedBytes)}　</strong>}
            共 {items.length} 个，{formatBytes(totalBytes)}，{groupList.length} 篇文档
          </span>
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="刷新" title="刷新" onClick={() => void refresh()}><RefreshCw size={14} /></button>
          <button className="ln-btn ln-btn--secondary ln-btn--danger-text" disabled={busy || selected.size === 0} onClick={() => setPendingDelete(selectedItems)}>
            {busy ? "清理中…" : "清理选中" + (selected.size > 0 ? "（" + selected.size + "）" : "")}
          </button>
        </div>
      )}

      {msg && <div className="asset-browser__msg" role="status">{msg}</div>}
      {status === "body" && bodyMsg && <div className="asset-browser__msg" role="status">{bodyMsg}</div>}
      {status === "qbody" && quickMsg && <div className="asset-browser__msg" role="status">{quickMsg}</div>}

      {status === "qbody" ? (
        quickLoaded === false ? (
          <div className="ln-empty"><strong>正在检查小记文件…</strong></div>
        ) : missingQuickNotes.length === 0 ? (
          <div className="ln-empty"><strong>没有缺失正文的小记</strong><small>当前所有小记的正文文件都在。</small></div>
        ) : (
          <div className="asset-browser__list ln-list-panel">
            {(["cloud", "text", "none"] as const).map((recovery) => {
              const docs = missingQuickNotes.filter((doc) => doc.recovery === recovery);
              if (docs.length === 0) return null;
              return (
                <div className="asset-browser__group" key={recovery}>
                  <div className="asset-browser__grouptitle">
                    <StickyNote size={13} />
                    <span>{QUICK_RECOVERY_GROUP_LABEL[recovery]}</span>
                    <span className="asset-browser__gcount">{docs.length} 条</span>
                  </div>
                  {docs.map((doc) => (
                    <div className="ln-row asset-browser__row" key={doc.id}>
                      <span className="ln-row__icon asset-browser__thumb"><StickyNote size={18} /></span>
                      <span className="ln-row__title" title={doc.previewText}>{doc.previewText || "小记"}</span>
                      <span className={"badge " + QUICK_RECOVERY_BADGE[doc.recovery]}>{QUICK_RECOVERY_LABEL[doc.recovery]}</span>
                      <span className="asset-browser__size">{doc.imageCount > 0 ? doc.imageCount + " 张图， " : ""}{doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString("zh-CN") : ""}</span>
                      <span className="ln-row__actions asset-browser__acts">
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="从云端恢复" title={doc.recovery === "cloud" ? "从云端拉回这条小记（需联网）" : "没有可用的云端依据（未配置/未同步过）"} disabled={doc.recovery !== "cloud" || quickBusy === doc.id} onClick={() => void restoreQuickFromCloud(doc)}><CloudDownload size={13} /></button>
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="用缓存重建纯文本" title={doc.hasTextCache ? "用搜索缓存重建全文纯文本（图片/格式会丢）" : "没有搜索缓存"} disabled={!doc.hasTextCache || quickBusy === doc.id} onClick={() => void restoreQuickFromText(doc)}><FileText size={13} /></button>
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="彻底删除" title="彻底删除（写墓碑，云端下架且不会复活）" disabled={quickBusy === doc.id} onClick={() => setPendingPurgeQuick(doc)}><Trash size={13} /></button>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )
      ) : status === "body" ? (
        bodyLoaded === false ? (
          <div className="ln-empty"><strong>正在检查正文文件…</strong></div>
        ) : missingBodies.length === 0 ? (
          <div className="ln-empty"><strong>没有缺失正文的文档</strong><small>当前所有文档的正文文件都在。</small></div>
        ) : (
          <div className="asset-browser__list ln-list-panel">
            {(["cloud", "history", "none"] as const).map((recovery) => {
              const docs = missingBodies.filter((doc) => doc.recovery === recovery);
              if (docs.length === 0) return null;
              return (
                <div className="asset-browser__group" key={recovery}>
                  <div className="asset-browser__grouptitle">
                    <FileText size={13} />
                    <span>{BODY_RECOVERY_GROUP_LABEL[recovery]}</span>
                    <span className="asset-browser__gcount">{docs.length} 篇</span>
                  </div>
                  {docs.map((doc) => (
                    <div className="ln-row asset-browser__row" key={doc.id}>
                      <span className="ln-row__icon asset-browser__thumb"><FileText size={18} /></span>
                      <span className="ln-row__title" title={doc.title}>{doc.title}</span>
                      <span className={"badge " + BODY_RECOVERY_BADGE[doc.recovery]}>{BODY_RECOVERY_LABEL[doc.recovery]}{doc.historyCount > 0 ? "（历史 " + doc.historyCount + " 份）" : ""}</span>
                      <span className="asset-browser__size">{doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString("zh-CN") : ""}</span>
                      <span className="ln-row__actions asset-browser__acts">
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="从云端恢复" title={doc.recovery === "cloud" ? "从云端拉回正文（需联网）" : "没有可用的云端依据（未配置/未同步过）"} disabled={doc.recovery !== "cloud" || bodyBusy === doc.id} onClick={() => void restoreBodyFromCloud(doc)}><CloudDownload size={13} /></button>
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="恢复最新历史" title={doc.historyCount > 0 ? "从最新历史版本恢复（" + doc.historyCount + " 个快照）" : "没有历史快照"} disabled={doc.historyCount === 0 || bodyBusy === doc.id} onClick={() => void restoreBodyLatestHistory(doc)}><History size={13} /></button>
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="彻底删除" title="彻底删除（写墓碑，云端下架且不会复活）" disabled={bodyBusy === doc.id} onClick={() => setPendingPurge(doc)}><Trash size={13} /></button>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="ln-empty"><strong>没有被移除的资源文件</strong><small>当前所有本地资产都仍被正文或历史快照引用。</small></div>
      ) : (
        <>
          {/* 左 2/3 列表、右 1/3 纯预览；可左右拖动（SplitPane 原语，与回收站/历史版本同一套） */}
          <SplitPane ariaLabel="调整资源列表宽度" storageKey="resources" minRight={280}>
          <div className="asset-browser__list ln-list-panel" ref={listRef} tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
            }}>
            {groups.length === 0 ? (
              <div className="ln-empty"><strong>没有匹配的资源</strong><small>换个分类或类型试试。</small></div>
            ) : groups.map((group) => (
              <div className="asset-browser__group" key={group.key}>
                <div className="asset-browser__grouptitle">
                  <Paperclip size={13} />
                  <span className="ln-ellipsis-block" title={group.title}>{group.title}</span>
                  {group.state === "trash" && <span className="badge badge--warn">回收站</span>}
                  {group.state === "missing" && <span className="badge badge--error">文档已删除</span>}
                  <span className="asset-browser__gcount">{group.items.length} 个</span>
                </div>
                {group.items.map((item) => {
                  const key = keyOf(item);
                  const isOrphan = item.orphanId != null;
                  const focused = key === focus;
                  return (
                    <div key={key} data-asset-key={key}
                      className={`ln-row asset-browser__row${focused ? " is-selected" : ""}`}
                      onClick={() => { setFocus(key); listRef.current?.focus(); }}>
                      {/* label 包住勾选框：原生点击只切一次（早先是 span onClick + input onChange 各切一次 ⇒ 一次点击净零，
                          表现为"勾不上"）；外层只拦冒泡，避免顺带改预览焦点。 */}
                      <label className="asset-browser__pick" onClick={(event) => event.stopPropagation()}>
                        {isOrphan
                          ? <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(item)} aria-label={`选择 ${item.filename}`} />
                          : <span className="asset-browser__lock" title="被历史快照引用，不可删除">锁</span>}
                      </label>
                      {/* 行首只留类型图标：不再渲染缩略图（用户 261006：资源列表前边不用展示缩略图） */}
                      <span className="ln-row__icon asset-browser__thumb">
                        <FileKindIcon name={item.filename} size={20} />
                      </span>
                      <span className="ln-row__title" title={item.filename}>{item.filename}</span>
                      {/* 分类标签不放了：三个页签已经把「可删 / 历史保护 / 缺失」分好类（用户 261006） */}
                      <span className="asset-browser__size">{formatBytes(item.size)}</span>
                      <span className="ln-row__actions asset-browser__acts">
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="复制路径" title="复制路径"
                          onClick={(event) => { event.stopPropagation(); void copyPath(item); }}><Copy size={13} /></button>
                        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="在文件夹中显示" title="在文件夹中显示"
                          onClick={(event) => { event.stopPropagation(); void openFolder(item); }}><FolderOpen size={13} /></button>
                        {isOrphan && (
                          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="删除" title="删除（不可撤销）"
                            onClick={(event) => { event.stopPropagation(); setPendingDelete([item]); }}><Trash size={13} /></button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 右栏 · 纯预览（只有内容，不放文字与按钮） */}
          <div className="asset-browser__preview">
            <AssetStage item={focusItem} broken={focusKey != null && broken.has(focusKey)} onBroken={() => focusKey && markBroken(focusKey)} />
          </div>
          </SplitPane>
        </>
      )}

      {pendingDelete && pendingDelete.length > 0 && (
        <Dialog open onDismiss={() => setPendingDelete(null)} label="删除未引用资源" className="asset-browser-confirm">
          <div className="ln-dialog__head"><span className="ln-dialog__title">删除 {pendingDelete.length} 个未引用资源？</span></div>
          <div className="ln-dialog__body">
            <ul className="asset-browser-confirm__list">
              {pendingDelete.slice(0, 6).map((item) => (
                <li key={keyOf(item)} className="ln-ellipsis" title={item.filename}>{item.filename}</li>
              ))}
              {pendingDelete.length > 6 && <li>…等共 {pendingDelete.length} 个</li>}
            </ul>
            <p className="asset-browser-confirm__note">
              共 {formatBytes(pendingBytes)}。物理删除本地文件并使其不再上传；此刻仍被正文或历史快照引用的会自动跳过。
            </p>
          </div>
          <div className="ln-dialog__actions">
            <button className="ln-btn ln-btn--ghost" onClick={() => setPendingDelete(null)}>取消</button>
            <button className="ln-btn ln-btn--secondary ln-btn--danger-text" disabled={busy} onClick={() => void confirmDelete()}>{busy ? "删除中…" : "删除"}</button>
          </div>
        </Dialog>
      )}

      {pendingPurge && (
        <Dialog open onDismiss={() => setPendingPurge(null)} label="彻底删除缺正文文档" className="asset-browser-confirm">
          <div className="ln-dialog__head"><span className="ln-dialog__title">彻底删除《{pendingPurge.title}》？</span></div>
          <div className="ln-dialog__body">
            <p className="asset-browser-confirm__note">
              正文文件已经缺失。彻底删除会同时在云端移除，其他设备会跟随删除，之后无法恢复；此操作不可撤销。
            </p>
          </div>
          <div className="ln-dialog__actions">
            <button className="ln-btn ln-btn--ghost" onClick={() => setPendingPurge(null)}>取消</button>
            <button className="ln-btn ln-btn--secondary ln-btn--danger-text" disabled={bodyBusy === pendingPurge.id} onClick={() => void confirmPurgeBody()}>{bodyBusy === pendingPurge.id ? "删除中…" : "彻底删除"}</button>
          </div>
        </Dialog>
      )}

      {pendingPurgeQuick && (
        <Dialog open onDismiss={() => setPendingPurgeQuick(null)} label="彻底删除缺正文小记" className="asset-browser-confirm">
          <div className="ln-dialog__head"><span className="ln-dialog__title">彻底删除这条小记？</span></div>
          <div className="ln-dialog__body">
            <p className="asset-browser-confirm__note">{pendingPurgeQuick.previewText || "小记"}</p>
            <p className="asset-browser-confirm__note">
              小记没有历史快照，彻底删除后无法恢复；云端与其他设备也会同步删除。此操作不可撤销。
            </p>
          </div>
          <div className="ln-dialog__actions">
            <button className="ln-btn ln-btn--ghost" onClick={() => setPendingPurgeQuick(null)}>取消</button>
            <button className="ln-btn ln-btn--secondary ln-btn--danger-text" disabled={quickBusy === pendingPurgeQuick.id} onClick={() => void confirmPurgeQuick()}>{quickBusy === pendingPurgeQuick.id ? "删除中…" : "彻底删除"}</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
