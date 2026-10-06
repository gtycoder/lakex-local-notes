/**
 * 设置 · 资源 —— 未引用资源浏览器（用户 261006 定稿：双栏 / 按文档分组 / 预览类型全带 / 只留「清理选中」+ 全选）。
 *
 * 左列 = 搜索 + 类型筛选 + 状态页签 + 按文档分组的列表（缩略图 · 体积 · 单条动作）；
 * 右列 = 预览台。删除一律走「选中 → 二次确认」，不再有「一键清理全部」。
 *
 * 预览**不经 IPC / base64**，直接用本地资源服务器直链（见 electron/assetServer.ts）：
 *   · 图片：`?w=1024` 离散档位（服务端 sharp 缩放 + immutable 缓存），1:1 时用原图；
 *   · PDF / 视频 / 音频：交给浏览器原生控件（服务端已支持 Range）；
 *   · 其余类型：类型图标 + 「在文件夹中显示」兜底。
 * 窄宽（设置弹窗可自由缩放）折叠为单列，点行开灯箱预览。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, FolderOpen, Image as ImageIcon, Paperclip, RefreshCw, Search, Trash, X } from "lucide-react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { formatBytes } from "../lib/formatBytes";
import { localAssetHttpUrl, withAssetWidth } from "../core/assetUrl.js";
import { ASSET_PORT, withAssetAccessToken } from "../lib/assetPort";
import { fileKindOf, type AssetFileKind } from "../core/assetNaming.js";
import { FileKindIcon } from "../features/bitable/FileKindIcon";
import { Dialog } from "./ui/Overlay";
import { Select } from "./ui/Select";
import { Seg } from "./settingsPrimitives";

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

/** 预览/缩略图直链：本地资源服务器 + 运行期 token；`width=null` 表示原图。 */
export function assetDisplayUrl(item: Pick<RemovedAsset, "noteId" | "filename">, width: number | null): string {
  const base = withAssetAccessToken(localAssetHttpUrl(item.noteId, item.filename, { port: ASSET_PORT }));
  return withAssetWidth(base, width);
}

const KIND_LABEL: Record<AssetFileKind, string> = {
  image: "图片", pdf: "PDF", doc: "文档", sheet: "表格", slide: "演示",
  archive: "压缩包", audio: "音频", video: "视频", code: "代码", text: "文本", file: "文件",
};

const KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "media", label: "视频 / 音频" },
  { value: "doc", label: "文档" },
  { value: "other", label: "其他" },
];

const keyOf = (item: Pick<RemovedAsset, "noteId" | "filename">): string => item.noteId + "/" + item.filename;

type StatusFilter = "all" | "orphan" | "history";

/** 预览台（宽栏右列 / 窄栏灯箱共用）。 */
function AssetPreview({ item, fit, onFit, onDelete, onCopyPath, onOpenFolder, broken, onBroken }: {
  item: RemovedAsset;
  fit: "contain" | "actual";
  onFit: (fit: "contain" | "actual") => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onOpenFolder: () => void;
  /** 文件已不在本机（登记还在）：媒体元素的 onError 命中后由上层置位。 */
  broken: boolean;
  onBroken: () => void;
}) {
  const preview = broken ? "none" : assetPreviewKind(item);
  const kind = fileKindOf(item.filename);
  const imageUrl = assetDisplayUrl(item, fit === "actual" ? null : 1024);
  const originalUrl = assetDisplayUrl(item, null);
  return (
    <>
      <div className="asset-browser__stage">
        {preview === "image" && <img src={imageUrl} alt={item.filename} className={fit === "actual" ? "is-actual" : ""} onError={onBroken} />}
        {preview === "video" && <video src={originalUrl} controls preload="metadata" onError={onBroken} />}
        {preview === "audio" && <audio src={originalUrl} controls preload="metadata" onError={onBroken} />}
        {preview === "pdf" && <iframe src={originalUrl} title={item.filename} onError={onBroken} />}
        {preview === "none" && (
          <div className="ln-empty">
            <FileKindIcon name={item.filename} size={40} />
            <span>{broken ? "文件已不在本机（登记还在，可在文件夹里确认）" : "该类型不支持内嵌预览"}</span>
          </div>
        )}
      </div>
      <div className="asset-browser__meta">
        <div className="asset-browser__metaname" title={item.filename}>{item.filename}</div>
        <div className="asset-browser__metaline">
          <span>{KIND_LABEL[kind]}</span>
          <span>{item.mimeType || "未知类型"}</span>
          <span>{formatBytes(item.size)}</span>
        </div>
        <div className="asset-browser__metaline">
          <span>{item.noteTitle ?? item.noteId}</span>
          {item.noteState === "trash" && <span className="badge badge--warn">回收站</span>}
          {item.noteState === "missing" && <span className="badge badge--error">文档已删除</span>}
          {item.detectedAt && <span>发现于 {item.detectedAt.slice(0, 10)}</span>}
        </div>
        {item.status === "history" && (
          <div className="asset-browser__note">历史保护：仍被某份历史快照引用，删除会破坏历史版本，因此只读。</div>
        )}
        <div className="asset-browser__metacts">
          {preview === "image" && (
            <Seg ariaLabel="图片缩放">
              <button className={`b3-button b3-button--outline seg__item${fit === "contain" ? " is-active" : ""}`} onClick={() => onFit("contain")}>适应</button>
              <button className={`b3-button b3-button--outline seg__item${fit === "actual" ? " is-active" : ""}`} onClick={() => onFit("actual")}>1:1</button>
            </Seg>
          )}
          <span className="fn__space" />
          <button className="b3-button b3-button--outline" onClick={onCopyPath}><Copy size={14} /> 复制路径</button>
          <button className="b3-button b3-button--outline" onClick={onOpenFolder}><FolderOpen size={14} /> 文件夹</button>
          {item.orphanId != null
            ? <button className="b3-button b3-button--outline ft__error" onClick={onDelete}><Trash size={14} /> 删除</button>
            : <span className="asset-browser__lock">受保护</span>}
        </div>
      </div>
    </>
  );
}

export function AssetsBrowser({ active }: { active: boolean }) {
  const [items, setItems] = useState<RemovedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<string>("all");
  const [fit, setFit] = useState<"contain" | "actual">("contain");
  const [pendingDelete, setPendingDelete] = useState<RemovedAsset[] | null>(null);
  const [narrow, setNarrow] = useState(false);
  /** 文件已不在本机（登记还在）的 key：由缩略图/预览媒体的 onError 置位。 */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const allRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try { setItems(await native.listRemovedAssets()); }
    catch (error) { setMsg(getNativeErrorMessage(error)); }
  }, []);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

  // 列表变化后清理已失效的勾选与预览焦点（返回原引用避免多余渲染）。
  useEffect(() => {
    const alive = new Set(items.map(keyOf));
    setSelected((prev) => {
      const next = new Set([...prev].filter((key) => alive.has(key)));
      return next.size === prev.size ? prev : next;
    });
    setFocus((prev) => (prev && alive.has(prev) ? prev : null));
  }, [items]);

  // 设置弹窗可自由缩放：内容宽度不够就折成单列，用灯箱看预览。
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // 阈值 600：默认 1000px 弹窗里本组件约 700px（双栏各 ~340），最小 620px 弹窗里约 470（折成单栏）。
    const measure = () => setNarrow(el.clientWidth < 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const groupList = useMemo(() => {
    const map = new Map<string, { title: string; state: string; items: RemovedAsset[] }>();
    for (const item of items) {
      const state = item.noteState ?? "active";
      const key = item.noteId + "|" + state;
      let group = map.get(key);
      if (!group) { group = { title: item.noteTitle ?? item.noteId, state, items: [] }; map.set(key, group); }
      group.items.push(item);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [items]);

  const counts = useMemo(() => ({
    all: items.length,
    orphan: items.filter((item) => item.status === "orphan").length,
    history: items.filter((item) => item.status === "history").length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (kind !== "all" && assetKindBucket(fileKindOf(item.filename)) !== kind) return false;
      if (q && !item.filename.toLocaleLowerCase().includes(q) && !(item.noteTitle ?? "").toLocaleLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, status, kind, query]);

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
  const focusItem = visibleItems.find((item) => keyOf(item) === focus) ?? null;
  const focusKey = focusItem ? keyOf(focusItem) : null;
  const focusBroken = focusKey != null && broken.has(focusKey);

  useEffect(() => {
    const el = allRef.current;
    if (el) el.indeterminate = selected.size > 0 && selected.size < selectableItems.length;
  }, [selected, selectableItems.length]);

  const markBroken = (key: string) => setBroken((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

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
    listRef.current?.querySelector<HTMLElement>(`[data-asset-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
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
    setMsg(`已删除 ${deleted} 个未引用资源（释放 ${formatBytes(freed)}）${kept > 0 ? ` · ${kept} 个仍被引用或删除失败，已保留` : ""}`);
    setBusy(false);
  };

  const STATUS_TABS: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "全部", count: counts.all },
    { id: "orphan", label: "可删", count: counts.orphan },
    { id: "history", label: "历史保护", count: counts.history },
  ];

  const pendingBytes = (pendingDelete ?? []).reduce((sum, item) => sum + (item.size || 0), 0);

  return (
    <div className={`asset-browser${narrow ? " is-narrow" : ""}`} ref={rootRef}>
      <div className="asset-browser__filters">
        <span className="ln-input asset-browser__search">
          <Search size={14} className="ln-input__icon" />
          <input
            className="ln-input__field"
            value={query}
            placeholder="搜索文件名或所属文档"
            aria-label="搜索未引用资源"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && <button className="ln-input__clear ln-iconbtn ln-iconbtn--compact" aria-label="清空搜索" onClick={() => setQuery("")}><X size={13} /></button>}
        </span>
        <Select label="资源类型" value={kind} options={KIND_OPTIONS} onChange={setKind} className="asset-browser__kind" />
      </div>

      <div className="ln-tabs asset-browser__tabs">
        <div className="ln-tabs__track" role="tablist" aria-label="资源状态">
          {STATUS_TABS.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={status === tab.id}
              className={`ln-tabs__item${status === tab.id ? " is-active" : ""}`}
              onClick={() => setStatus(tab.id)}>
              {tab.label}<span className="ln-tabs__count">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="ln-tabs__action">
          <span className="asset-browser__summary">共 {counts.all} 个 · {formatBytes(totalBytes)} · {groupList.length} 篇文档</span>
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="刷新" title="刷新" onClick={() => void refresh()}><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="asset-browser__bulk">
        <label className="asset-browser__all">
          <input ref={allRef} type="checkbox" checked={selectableItems.length > 0 && selected.size >= selectableItems.length} onChange={toggleSelectAll} aria-label="全选可删资源" />
          <span>全选可删（{selectableItems.length}）</span>
        </label>
        <span className="fn__space" />
        {selected.size > 0 && <span className="asset-browser__summary">{selected.size} 个 · {formatBytes(selectedBytes)}</span>}
        <button className="b3-button b3-button--outline ft__error" disabled={busy || selected.size === 0} onClick={() => setPendingDelete(selectedItems)}>
          {busy ? "清理中…" : `清理选中${selected.size > 0 ? `（${selected.size}）` : ""}`}
        </button>
      </div>

      {msg && <div className="asset-browser__msg" role="status">{msg}</div>}

      {items.length === 0 ? (
        <div className="ln-empty"><strong>没有被移除的资源文件</strong><small>当前所有本地资产都仍被正文或历史快照引用。</small></div>
      ) : (
        <div className="asset-browser__body">
          <div className="asset-browser__list b3-list" ref={listRef} tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
            }}>
            {groups.length === 0 ? (
              <div className="ln-empty"><strong>没有匹配的资源</strong><small>换个关键词或筛选条件试试。</small></div>
            ) : groups.map((group) => (
              <div className="asset-browser__group" key={group.title + "|" + group.state}>
                <div className="asset-browser__grouptitle">
                  <Paperclip size={13} />
                  <span className="fn__ellipsis" title={group.title}>{group.title}</span>
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
                      <span className="asset-browser__pick" onClick={(event) => { event.stopPropagation(); toggleSelect(item); }}>
                        {isOrphan
                          ? <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(item)} aria-label={`选择 ${item.filename}`} />
                          : <span className="asset-browser__lock" title="被历史快照引用，不可删除">锁</span>}
                      </span>
                      <span className="ln-row__icon asset-browser__thumb">
                        {assetPreviewKind(item) === "image" && !broken.has(key)
                          ? <img src={assetDisplayUrl(item, 128)} alt="" loading="lazy" onError={() => markBroken(key)} />
                          : <FileKindIcon name={item.filename} size={20} />}
                      </span>
                      <span className="ln-row__title" title={item.filename}>{item.filename}</span>
                      <span className={`badge ${broken.has(key) ? "badge--error" : isOrphan ? "badge--muted" : "badge--warn"}`}>{broken.has(key) ? "文件缺失" : isOrphan ? "未引用" : "历史保护"}</span>
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

          <div className="asset-browser__preview">
            {focusItem ? (
              <AssetPreview item={focusItem} fit={fit} onFit={setFit} broken={focusBroken} onBroken={() => markBroken(keyOf(focusItem))}
                onDelete={() => setPendingDelete([focusItem])}
                onCopyPath={() => void copyPath(focusItem)}
                onOpenFolder={() => void openFolder(focusItem)} />
            ) : (
              <div className="ln-empty">
                <ImageIcon size={22} />
                <strong>选择左侧资源查看预览</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {narrow && focusItem && (
        <Dialog open onDismiss={() => setFocus(null)} label={focusItem.filename} className="asset-browser-lightbox">
          <AssetPreview item={focusItem} fit={fit} onFit={setFit} broken={focusBroken} onBroken={() => markBroken(keyOf(focusItem))}
            onDelete={() => setPendingDelete([focusItem])}
            onCopyPath={() => void copyPath(focusItem)}
            onOpenFolder={() => void openFolder(focusItem)} />
        </Dialog>
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
            <button className="b3-button b3-button--cancel" onClick={() => setPendingDelete(null)}>取消</button>
            <button className="b3-button ft__error" disabled={busy} onClick={() => void confirmDelete()}>{busy ? "删除中…" : "删除"}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
