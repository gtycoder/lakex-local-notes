/**
 * 设置 · 资源 —— 未引用资源浏览器。
 * **布局复刻思源资产页，样式仍走我们自己的设计系统**（用户 261006 定稿）。
 *
 * 单栏、上下分区：
 *   · 上半 = 操作 + 列表（吃满剩余高度、内容多了自己滚）：三个大页签（可删 / 历史保护 / 缺失）、
 *     类型筛选、全选 + 清理选中、按文档分组的列表（行内动作：复制路径 / 在文件夹中显示 / 删除）。
 *   · 下半 = 固定 1/3 高的**纯预览**：只有内容（图片 / PDF / 视频 / 音频），不放文字、不放按钮。
 *
 * 预览不经 IPC / base64，直接用本地资源服务器直链（electron/assetServer.ts）：
 * 图片走 ?w=1024 档位，音视频与 PDF 用原图（服务端支持 Range）。
 * "缺失"是**一等分类**（登记还在、磁盘文件已不在）：由主进程 listRemovedAssets 的 fileMissing 给出，
 * 不靠前端图片 onError 猜——后者对非图片类型根本不触发。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, FolderOpen, Image as ImageIcon, Paperclip, RefreshCw, Trash } from "lucide-react";
import { escapeId } from "../../lib/cssEscape";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { formatBytes } from "../../lib/formatBytes";
import { localAssetHttpUrl, withAssetWidth } from "../../core/assetUrl";
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

type StatusFilter = "orphan" | "history" | "missing";

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

export function AssetsBrowser({ active }: { active: boolean }) {
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

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

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
    setMsg(`已删除 ${deleted} 个未引用资源（释放 ${formatBytes(freed)}）${kept > 0 ? ` · ${kept} 个仍被引用或删除失败，已保留` : ""}`);
    setBusy(false);
  };

  const STATUS_TABS: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "orphan", label: "可删", count: counts.orphan },
    { id: "history", label: "历史保护", count: counts.history },
    { id: "missing", label: "缺失", count: counts.missing },
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
                {tab.label}<span className="ln-tabs__count">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>
        <span className="ln-spacer" />
        <Select label="资源类型" value={kind} options={KIND_OPTIONS} onChange={setKind} className="asset-browser__kind" />
      </div>

      <div className="asset-browser__toolbar">
        <label className="asset-browser__all">
          <input ref={allRef} type="checkbox" checked={selectableItems.length > 0 && selected.size >= selectableItems.length} onChange={toggleSelectAll} aria-label="全选可删资源" />
          <span>全选可删（{selectableItems.length}）</span>
        </label>
        <span className="ln-spacer" />
        <span className="asset-browser__summary">
          {selected.size > 0 && <strong>{selected.size} 个 · {formatBytes(selectedBytes)}　</strong>}
          共 {items.length} 个 · {formatBytes(totalBytes)} · {groupList.length} 篇文档
        </span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="刷新" title="刷新" onClick={() => void refresh()}><RefreshCw size={14} /></button>
        <button className="ln-btn ln-btn--secondary ln-btn--danger-text" disabled={busy || selected.size === 0} onClick={() => setPendingDelete(selectedItems)}>
          {busy ? "清理中…" : `清理选中${selected.size > 0 ? `（${selected.size}）` : ""}`}
        </button>
      </div>

      {msg && <div className="asset-browser__msg" role="status">{msg}</div>}

      {items.length === 0 ? (
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
    </section>
  );
}
