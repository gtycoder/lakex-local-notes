/**
 * 小记列表卡（M-06① 从 HomePage.tsx 尾部搬出，纯搬移/零行为变化）：大图 + 摘要 + 日期 + 「...」
 * （有图必展示，无图留中性占位）。
 * 图片语义（261112 用户定稿）：单击看大图、双击进编辑；封面只在「正文首块是媒体」时出现（261122）。
 * 护栏：home/quickNoteCoverOrder.test、quickNotes/quickNotePreview.hiddenMedia.render.test、
 * editor/imagePreviewAttach.render.test（都读本文件源码）。
 */
import { useEffect, useMemo, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import type { MobileQuickNote } from "./HomePage";
import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import { openImagePreview } from "../../features/editor/imagePreview";
import { resolvePreviewAssetUrl } from "../../features/preview/previewAsset";
import { isQuickNoteImageMime } from "../../core/quickNoteModel.js";
import { quickNoteStartsWithMedia } from "../../features/quickNotes/quickNotePreviewParser";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { imageBoxAttrs, quickNoteImageUrl, quickNotePreviewAssetUrl } from "./quickNoteImage";
import { formatDateOnly } from "../lib/listTime";
import { rowActivationProps } from "../ui/rowActivation";
import { withAssetAccessToken } from "../../lib/assetPort";
import { useLongPress } from "../ui/useLongPress";
import { SelectionCheckbox } from "../ui/SelectionCheckbox";

/**
 * 小记卡片图片「单击 vs 双击」判定窗（ms）：窗口内同一张图再次点按 = 双击（编辑）。
 * 卡片走的是 click（不是内核宿主，没有元素被重渲染的问题）：WebView 的 click 延迟 ~150ms、
 * 实测两击间隔可达 251ms ⇒ 取 320ms 覆盖它（250ms 会把双击判成两个单击）。
 */
const IMAGE_TAP_WINDOW_MS = 320;

export function QuickNoteCard({ note, revealed, dateValue, onEdit, onMore, onFilterTag, onRequestDetail, onToggleTask, selecting, selected, onEnterSelect, onToggleSelect }: {
  note: MobileQuickNote; revealed: boolean; dateValue: string;
  onEdit: (card: HTMLElement | null) => void; onMore: () => void; onFilterTag: (tagId: string) => void; onRequestDetail: (id: string) => void;
  onToggleTask: (checkboxIndex: number, checked: boolean) => void;
  /** 多选模式（261106 task-82）：长按卡片进入、选择态下点卡片切换勾选（不打开编辑器）。 */
  selecting: boolean; selected: boolean; onEnterSelect: () => void; onToggleSelect: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** 长按进入多选后，抬手补发的那一次 click 要吞掉（否则会误开小记）。 */
  const suppressTap = useRef(false);
  /** 卡片图片「单击看大图 / 双击进编辑」的判定状态（261112 用户定稿）。 */
  const imageTapTimer = useRef<number | null>(null);
  const lastImageTap = useRef<{ key: string; at: number } | null>(null);
  const longPress = useLongPress(() => {
    suppressTap.current = true;
    onEnterSelect();
  }, { moveCancelPx: 10 });
  useEffect(() => {
    if (note.body || typeof IntersectionObserver === "undefined") return;
    const node = cardRef.current;
    if (!node) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return;
      requested = true;
      onRequestDetail(note.id);
      observer.disconnect();
    }, { rootMargin: "320px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [note.id, note.body, onRequestDetail]);

  /**
   * 预览用资源（canonical URL + token + 图片离散缩略档位）：
   *  · 图片走 `?w=1024`（与封面同一档 ⇒ 同一张图在封面/正文里是同一个 URL，浏览器只解码一次）；
   *  · 视频/音频/附件原样（服务端只缩图片，加 query 只会打散缓存）。
   */
  const previewAssets = (note.images ?? []).map((image) => {
    const withToken = withAssetAccessToken(localAssetHttpUrl(note.id, image.filename, { space: "quick-notes" }));
    return {
      ...image,
      url: quickNotePreviewAssetUrl(withToken, image.mimeType),
      // Q02：点开大图后换原图（去显示档 w/date、保留 token）；Lightbox 先显示档位图再替换。
      originalUrl: resolvePreviewAssetUrl(
        { noteId: note.id, filename: image.filename, src: withToken, mimeType: image.mimeType },
        "original",
      ),
    };
  });
  /**
   * Lightbox 画廊**只收图片**（261112 R2）：资源清单是「图片 + 视频/音频/附件」混合数组
   * （core/quickNoteModel 的 StoredQuickNoteContent.images 语义），全塞进画廊会出现「左右切到视频 ⇒ 大图层空白」。
   * 判据与 QuickNotePreview 的渲染判据一致（它用同一个 isQuickNoteImageMime 决定 <img> 还是视频/音频/文件 chip），
   * 所以「预览里能点开大图的」与「画廊里的」是同一集合。
   * 注意：QuickNotePreview 的 assets 仍传**全量**（视频/音频/附件卡要 URL），只有画廊用它。
   */
  const galleryAssets = previewAssets.filter((asset) => isQuickNoteImageMime(asset.mimeType));
  /**
   * 封面只在「正文首块是媒体」时出现（261122 用户现场：编辑态「文字上、图片下」，列表卡却把首图提到最上面）。
   * 文字在前的卡片保持**正文顺序**：不画封面，图片在预览里按原位置出现。
   */
  const leadingMedia = useMemo(
    () => (note.body ? quickNoteStartsWithMedia(note.body) : Boolean(note.firstImage)),
    [note.body, note.firstImage],
  );
  const thumbUrl = leadingMedia && note.firstImage
    ? quickNoteImageUrl(withAssetAccessToken(localAssetHttpUrl(note.id, note.firstImage, { space: "quick-notes" })))
    : null;
  /** 封面比例盒（宽高元数据可用时先占位，加载完不跳版）。 */
  const coverImage = note.firstImage ? (note.images ?? []).find((image) => image.filename === note.firstImage) : undefined;
  const coverBox = imageBoxAttrs(coverImage);
  useEffect(() => () => {
    if (imageTapTimer.current !== null) window.clearTimeout(imageTapTimer.current);
  }, []);

  /**
   * 卡片图片（用户 261112 定稿：**单击看图片、双击编辑**）：
   * - 单击 → 判定窗后开大图（画廊 = 本条小记全部图片，按正文顺序）；
   * - 判定窗内再点同一张 → 取消预览，走卡片默认动作（进编辑）；
   * - 选择态：与卡片一致只切勾选（不看大图）；长按刚进多选后补发的那次点击吞掉。
   * 图片的 click 在 QuickNotePreview 内部已 stopPropagation ⇒ 不会顺带触发卡片 activate。
   */
  const handleImageTap = (image: { filename?: string }): void => {
    if (suppressTap.current) { suppressTap.current = false; return; }
    if (selecting) { onToggleSelect(); return; }
    const key = image.filename ?? "";
    const now = Date.now();
    const previous = lastImageTap.current;
    const doubleTap = previous !== null && previous.key === key && now - previous.at <= IMAGE_TAP_WINDOW_MS;
    lastImageTap.current = { key, at: now };
    if (doubleTap) {
      if (imageTapTimer.current !== null) { window.clearTimeout(imageTapTimer.current); imageTapTimer.current = null; }
      lastImageTap.current = null;
      onEdit(cardRef.current);
      return;
    }
    if (imageTapTimer.current !== null) window.clearTimeout(imageTapTimer.current);
    imageTapTimer.current = window.setTimeout(() => {
      imageTapTimer.current = null;
      const shots = galleryAssets.filter((asset) => Boolean(asset.url));
      const index = Math.max(0, shots.findIndex((asset) => asset.filename === image.filename));
      openImagePreview(shots.map((asset) => ({ src: asset.url as string, originalSrc: asset.originalUrl })), index);
    }, IMAGE_TAP_WINDOW_MS);
  };
  /** 触摸点击 / 外接键盘 Enter·Space 共用同一激活语义（选择态 = 切换勾选，否则进编辑）。 */
  const activate = (): void => {
    if (suppressTap.current) { suppressTap.current = false; return; }
    if (selecting) { onToggleSelect(); return; }
    onEdit(cardRef.current);
  };
  return (
    <div
      ref={cardRef}
      className={"qn-card" + (revealed ? " is-revealed" : "") + (selected ? " is-selected" : "")}
      data-quick-note-id={note.id}
      {...rowActivationProps(activate)}
      aria-pressed={selecting ? selected : undefined}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
      onClick={activate}
    >
      {thumbUrl && (
        <div className="qn-card__cover">
          <img
            className="qn-card__img"
            src={thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            {...(coverBox ?? {})}
            // 封面也是「一点就开大图」的主入口（用户 261112：点击看图片、双击编辑）：
            // 单击 = 预览（画廊 = 本条全部图片，当前这张为第一张）；双击 = 进编辑。
            onClick={(event) => { event.stopPropagation(); handleImageTap({ filename: note.firstImage ?? undefined }); }}
          />
          {note.imageCount > 1 && <span className="qn-card__count">{note.imageCount}</span>}
        </div>
      )}
      <div className="qn-card__body">
        <QuickNotePreview
          // F-B/F-C/F-H（261119 平滑度审计）：恒定槽位 —— 占位（previewText）与富预览同槽同高，
          // 正文到达/内核兜底落地都不改卡高（判据与槽高见 QuickNotePreview.slotFrame）。
          // 多图卡（封面之外还有图）= 折叠上限恒定槽；纯文本卡 = 摘要槽。
          // 有图且没有封面占位时，图会出现在预览里 ⇒ 同样用恒定媒体槽（避免卡高变化）。
          slotFrame={note.imageCount > (thumbUrl ? 1 : 0) ? "media" : "text"}
          ellipsisClassName="mb-ellipsis"
          body={note.body ?? ""}
          // 占位/回落文本 = 列表投影里的纯文本摘要（正文没到时的那半帧）。
          fallbackText={note.previewText || (note.imageCount > 0 ? "[图片]" : "（空白小记）")}
          noteId={note.id}
          assets={previewAssets}
          // 图片：单击看大图、双击进编辑（261112 用户定稿；判定窗见 handleImageTap）。
          onImageClick={handleImageTap}
          // 封面上方已经画过第一张图 ⇒ 预览不再重复（261112 用户报「插一张图预览里出现两张」）。
          hiddenMediaNames={thumbUrl && note.firstImage ? new Set([note.firstImage]) : undefined}
          // 勾选框可点（与桌面卡片预览同能力）；组件内部已 stopPropagation ⇒ 不会顺带进编辑态。
          onToggleTask={onToggleTask}
        />
        <div className="qn-card__meta">
          <span className="qn-card__date">{formatDateOnly(dateValue)}</span>
          {selecting ? (
            <SelectionCheckbox compact checked={selected} />
          ) : (
            <button className="qn-card__more mb-tap" onClick={(e) => { e.stopPropagation(); onMore(); }} aria-label="更多"><MoreHorizontal size={18} /></button>
          )}
        </div>
        {note.tagIds.length > 0 && (
          <div className="qn-card__tags">
            {note.tagIds.map((tagId, index) => {
              const name = note.tags[index];
              if (!name) return null;
              return (
                <button type="button" className="qn-tag" key={tagId} onClick={(event) => { event.stopPropagation(); onFilterTag(tagId); }}>
                  <span className="mb-ellipsis">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
