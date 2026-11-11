/**
 * 标签详情里的**小记行富预览**（261106 用户反馈：详情里把待办显示成「[ ] 1111」纯文本）。
 *
 * 与首页卡片**同一套预览**：直接复用 QuickNotePreview（同一解析器；待办 → 勾选框、媒体按卡片规则、
 * 还原不了的块走内核只读兜底）。正文与资源清单**按需** readQuickNote 取（只在本标签聚合里的小记上调用，
 * 不在标签页初始化时批量读），资源 URL 复用首页那套 localAssetHttpUrl + withAssetAccessToken。
 *
 * 只读语义（本轮定稿）：预览里的勾选框**不在本页切换**（不传 onToggleTask ⇒ 复选框只读）；
 * 点卡片进小记（点击由父级行处理），勾选框/图片自身 stopPropagation，不会误触发打开。
 */
import { useEffect, useState } from "react";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { quickNotePreviewAssetUrl } from "../home/quickNoteImage";
import type { StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { QuickNotePreview } from "../../features/quickNotes/QuickNotePreview";
import { bridge } from "../bridge";

export interface TagQuickNotePreviewProps {
  /** 小记 id（正文按需读）。 */
  noteId: string;
  /** 正文没读到时的回落（列表投影里的纯文本摘要）。 */
  fallbackText: string;
}

export function TagQuickNotePreview({ noteId, fallbackText }: TagQuickNotePreviewProps) {
  const [detail, setDetail] = useState<{ body: string; images: StoredQuickNoteImage[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setFailed(false);
    void bridge.readQuickNote(noteId)
      .then((full) => {
        if (!alive) return;
        if (!full) { setFailed(true); return; }
        const images = Array.isArray(full.content.images) ? full.content.images : [];
        setDetail({ body: typeof full.content.body === "string" ? full.content.body : "", images });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [noteId]);

  if (!detail) {
    return <div className="mb-set-item__desc">{failed ? "正文不可用，进入小记里查看" : fallbackText}</div>;
  }

  // 图片统一走资产服务的离散缩略档位（与首页卡片同一个 helper / 同一个 ?w=1024）：
  // 标签详情是列表式富预览，原图直出会在多行卡片里把 WebView 内存顶穿。
  const assets = detail.images.map((image) => {
    const withToken = withAssetAccessToken(localAssetHttpUrl(noteId, image.filename, { space: "quick-notes" }));
    return { ...image, url: quickNotePreviewAssetUrl(withToken, image.mimeType) };
  });
  return (
    <QuickNotePreview
      body={detail.body}
      noteId={noteId}
      assets={assets}
      // 卡片是「打开小记」的入口：图片不抢点击（与首页 qn-card 同口径）。
      onImageClick={() => undefined}
      ellipsisClassName="mb-ellipsis"
    />
  );
}
