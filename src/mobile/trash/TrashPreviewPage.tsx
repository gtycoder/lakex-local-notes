/** 移动端回收站预览页（惰性下载补偿）：点开回收站文档先按需补拉缺失资源，再只读渲染 Lake 正文。
 * 只读 + 「恢复」操作；恢复走 restoreTreeItem（恢复前强拉全量，语义与桌面一致）。
 * 261124 用户点单（「小记要和文档一样的预览方式」）：小记行也进本页 —— `itemKind="quick"` 时
 * 读本机保留的 .qnote 正文（移动软删不清文件，无需资源补拉）、恢复走 restoreQuickNote；
 * viewer / 横幅 / 版面与文档完全共用（同一份实现，不另开页面）。 */
import { useCallback, useEffect, useState } from "react";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { bridge } from "../bridge";
import { useDelayedLoading } from "../ui/delayedLoading";
import { LAKE_PREVIEW_FONT_SIZE, LakeEditor } from "../../features/editor/LakeEditor";
// 内核样式必须由**本懒加载入口自己**带（261010 护栏）：冷启动直接从「设置 → 回收站 → 预览」进来时，
// 这条路径是第一个内核消费者 —— 缺样式会渲染成大图标 + 原生控件（261009 在小记上踩过同款）。
// 顺序与 DocumentEditor 一致：内核 style.css 在前，字体覆盖在后（移动端无 @layer，靠顺序生效）。
import "@dlient/lakex-doc-react/style.css";
import "../../styles/fonts/font-overrides.css";
import type { NoteKind } from "../../core/noteKind";

/** 小记读不到（已被恢复 / 彻底删除 / 正文文件丢失）的唯一文案：横幅与正文占位共用，别写两份。 */
const QUICK_UNAVAILABLE = "这条小记已不可预览（可能已被恢复或彻底删除）";

export interface TrashPreviewPageProps {
  noteId: string;
  /** 条目类型：note（默认，既有入口零改动）/ quick（小记回收站行）。 */
  itemKind?: "note" | "quick";
  onBack: () => void;
  onRestored: () => void;
}

export function TrashPreviewPage({ noteId, itemKind = "note", onBack, onRestored }: TrashPreviewPageProps) {
  const quick = itemKind === "quick";
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // 非 doc（表格/多维表/画板/手写板）正文不是 Lake 格式 → 预览一律挡住，不挂 Lake 编辑器。
  const [kind, setKind] = useState<NoteKind>("doc");
  // 261026：远端已彻底删除、本机仅保留这份回收站副本 → 顶部说明「云端已删除 · 仅本地」（仍可恢复）。
  const [cloudDeleted, setCloudDeleted] = useState(false);
  /** 小记读不到：不挂空 viewer（正文区给明确占位，顶部横幅同时报因）。 */
  const [quickUnavailable, setQuickUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  /** 261116 A：<300ms 的快加载直接出正文，不闪「正在加载资源…」；显示后至少 500ms。 */
  const showLoading = useDelayedLoading(loading);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    setQuickUnavailable(false);
    try {
      if (quick) {
        // 小记：软删只标 deleted_at（行与 .qnote 正文都在本机），直接只读取回；不做资源补拉（文件本机保留）。
        const doc = await bridge.readQuickNote(noteId);
        if (!doc) {
          setMsg(QUICK_UNAVAILABLE);
          setQuickUnavailable(true);
          return;
        }
        setTitle(doc.previewText || "小记");
        setContent(doc.content.body);
        setKind("doc");
        // 云端已删除徽标与列表同源（本地查询，非出网）。
        const trash = await bridge.listQuickNoteTrash().catch(() => []);
        setCloudDeleted(trash.some((item) => item.id === noteId && item.cloudDeleted));
        return;
      }
      // 回收站惰性下载补偿：预览前按需补拉该笔记本地缺失资源（best-effort，失败仍显示本地内容）
      await bridge.ensureTrashNoteAssets(noteId).catch((error) => reportNativeActionError("预览回收站附件", error));
      const n = await bridge.readNote(noteId);
      if (n) { setTitle(n.title); setContent(n.content); setKind(n.kind); setCloudDeleted(!!n.cloudDeleted); }
    } catch (e) {
      setMsg("预览失败：" + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [noteId, quick]);

  useEffect(() => { void load(); }, [load]);

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      if (quick) {
        // 小记恢复 = 标 restore_pending（唯一 local-wins 例外），与桌面 restoreQuickNote 同语义。
        await bridge.restoreQuickNote(noteId);
        setMsg("已恢复（同步后传播到其他设备）");
        onRestored();
        return;
      }
      const landing = await bridge.restoreTreeItem(noteId, "note");
      // 261124 同口径：如实报落点（原位置不可用回落默认笔记本时明示，用户按原位找不到 = 「恢复后消失」事故）。
      setMsg(landing.fellBack
        ? `已恢复到「${landing.parentTitle || "默认笔记本"}」：原位置不可用，可手动移回。`
        : landing.parentTitle ? `已恢复到「${landing.parentTitle}」。` : "已恢复。");
      onRestored();
    } catch (e) {
      setMsg("恢复失败：" + (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mobile-document">
      <header className="mobile-topbar" data-mb-topbar data-edge="overlay" data-size="regular">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <div className="mobile-topbar-title">{title || (quick ? "小记" : "回收站文档")}</div>
        <div className="mobile-topbar-actions">
          <button className="mobile-done-btn" onClick={() => void restore()} disabled={busy}>{busy ? "恢复中…" : "恢复"}</button>
        </div>
      </header>
      {msg && <div className="mobile-status-msg">{msg}</div>}
      {cloudDeleted && <div className="mobile-status-msg">云端已删除（仅本地），恢复并同步成功后会重新上传</div>}
      {/* Q04B：回收站文档**只读打开**（不再拒绝）——横幅明说「编辑/保存会被拦」，避免用户以为能改而丢编辑。
          本页永远不再挂可写宿主：LakeEditor 走 interaction="preview"（无卡片菜单 / 无 copy-cut 接管）。 */}
      <div className="mobile-status-msg">
        {quick
          ? "只读预览：该小记在回收站，点右上角「恢复」后才会回到小记列表。"
          : "只读预览：该文档在回收站，编辑与保存会被拦截；点右上角「恢复」后可继续编辑。"}
      </div>
      <section className="mobile-doc-body">
        {loading ? (
          showLoading ? <div className="poc-center"><LoaderCircle className="spin" /><span>正在加载资源…</span></div> : null
        ) : quickUnavailable ? (
          <div className="poc-center"><span>{QUICK_UNAVAILABLE}</span></div>
        ) : kind !== "doc" ? (
          <div className="poc-center">
            <span>{kind === "usheet" ? "表格" : kind === "bitable" ? "多维表" : kind === "ink" ? "手写板" : "画板"}暂不支持在移动端预览，请在桌面端打开。</span>
          </div>
        ) : (
          <LakeEditor
            noteId={noteId}
            content={content}
            mode="viewer"
            interaction="preview"
            hostClassName="mb-kernel-host"
            tocEnabled={false}
            onChange={() => undefined}
            // Q05B：预览固定阅读档（不跟用户正文字号设置走）；禁用虚拟渲染（本页无内部滚动容器）。
            prefs={{ fontSize: LAKE_PREVIEW_FONT_SIZE, showToolbar: false, disableVirtualRendering: true, disableNativeToc: true }}
          />
        )}
      </section>
    </div>
  );
}