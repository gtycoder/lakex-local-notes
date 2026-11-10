import { useEffect, useRef } from "react";
import { Check, Tag, FilePlus, Pencil, Trash } from "lucide-react";
import type { QuickNoteDocument, QuickNoteImage } from "../../lib/types";
import { isQuickNoteImageMime } from "../../core/quickNoteModel";
import { formatListTime } from "../../core/dateFormat";
import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import { openImagePreview } from "../../features/editor/imagePreview";

export function QuickNoteCard({ item, onNeedDetail, revealed, deletePending, selecting, checked, onToggleSelect, onEdit, onDelete, onConvert, onAddTag, onFilterTag, onToggleTask }: {
  item: QuickNoteDocument; onNeedDetail(): void; revealed: boolean; deletePending: boolean; selecting: boolean; checked: boolean;
  onToggleSelect(): void; onEdit(): void; onDelete(): void; onConvert(): void;
  onAddTag(anchor: HTMLElement): void; onFilterTag(name: string): void;
  onToggleTask(checkboxIndex: number, checked: boolean): void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const needDetailRef = useRef(onNeedDetail);
  needDetailRef.current = onNeedDetail;
  /**
   * DT-05：卡片进入视口（含 200px 缓冲）时才按 id 读回完整正文/资源。
   * 列表由QuickNotesVirtualList窗口化；进入缓冲视口时才读正文，保留编辑/菜单锚点不额外读取屏外正文。
   */
  useEffect(() => {
    const host = cardRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") { needDetailRef.current(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      needDetailRef.current();
    }, { rootMargin: "200px" });
    observer.observe(host);
    return () => observer.disconnect();
    // contentHash 变化 = 列表投影已更新且详情缓存被失效（同步/他端改动）⇒ 重新观察并读回新正文。
  }, [item.id, item.contentHash]);
  /** 资源清单（带 url）：预览里的媒体卡按文件名到这里取真实资源。 */
  const assets = item.content.images.filter((asset): asset is QuickNoteImage & { url: string } => Boolean(asset.url));
  const imagesOnly = assets.filter((asset) => isQuickNoteImageMime(asset.mimeType));
  // 仿语雀：时间戳在卡片顶部（"更新于 08-04 14:16"），正文/图片在下
  const stamp = formatListTime(new Date(item.updatedAt || item.createdAt), new Date(), true);
  return <article
    ref={cardRef}
    data-quick-note-id={item.id}
    className={`quick-note-entry${item.isConflict ? " conflict" : ""}${selecting ? " selecting" : ""}${checked ? " is-checked" : ""}${revealed ? " is-revealed" : ""}`}
    onDoubleClick={selecting ? undefined : onEdit}
    onClick={selecting ? onToggleSelect : undefined}
  >
    {/* 勾选框常驻（左侧固定槽位）：默认 hover 才显形，点多选模式后常显 */}
    <button
      className={"ln-check quick-note-select" + (checked ? " is-on" : "")}
      role="checkbox" aria-checked={checked} aria-label={checked ? "取消选择" : "选择这篇小记"}
      onClick={(event) => { event.stopPropagation(); onToggleSelect(); }}
    >{checked && <Check size={13} />}</button>
    <header><time dateTime={item.updatedAt || item.createdAt}>更新于 {stamp}</time>{item.isConflict && <span className="badge badge--warn quick-note-conflict">同步冲突副本</span>}<div className="quick-note-card-actions"><button className="ln-iconbtn ln-iconbtn--compact" onClick={(event) => { event.stopPropagation(); onAddTag(event.currentTarget); }} aria-label="添加标签" title="添加标签"><Tag size={15} /></button><button className="ln-iconbtn ln-iconbtn--compact" onClick={onConvert} aria-label="转为正式笔记" title="转为正式笔记"><FilePlus size={15} /></button><button className="ln-iconbtn ln-iconbtn--compact" onClick={onEdit} aria-label="编辑小记" title="编辑小记"><Pencil size={15} /></button><button className="ln-iconbtn ln-iconbtn--compact ln-iconbtn--danger" aria-label="删除小记" onClick={onDelete} disabled={deletePending} title={deletePending ? "请先完成当前删除的撤销操作" : "删除小记"}><Trash size={15} /></button></div></header>
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
            <button type="button" className="ln-chip" key={tagId} onClick={(event) => { event.stopPropagation(); onFilterTag(tagId); }} title={`筛选标签：${name}`}>
              <span className="ln-ellipsis">{name}</span>
            </button>
          );
        })}
      </div>
    )}
  </article>;
}
