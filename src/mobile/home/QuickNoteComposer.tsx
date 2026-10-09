/**
 * 移动端小记 composer（新建/编辑共用）——**完整编辑能力**，与桌面共用同一套小记编辑器：
 *
 * - 写作区 = 桌面同款 `QuickNoteEditor`（一个 Lake 内核实例 + 小记白名单工具条：图片/待办/有序/无序/分割线；
 *   `disableVirtualRendering` 必须开 —— 小记没有内核内部滚动容器，虚拟渲染会量错视口）；
 * - 附件按类型成卡：内核 file input 交给我们 `uploadResource`，经 `bridge.stageQuickNoteAsset` 落盘
 *   `quick-notes/{id}/`，mp4→视频卡、mp3→音频卡、png→图片卡、其它→附件卡（`installMediaCardCategoryRouter`
 *   由 `QuickNoteEditor` 挂好，与文档侧同一模块）；
 * - 保存 = 内核 `text/lake`（body）+ 纯文本镜像 + **按正文引用派生的资源清单**（正文说什么就是什么，
 *   不依赖 UI 时序），与桌面 `.qnote` v2 同格式 ⇒ 两端互开互认。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { bridge } from "../bridge";
import { successFeedback, warnFeedback } from "../ui/haptics";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import { uploadLakeResource } from "../../features/editor/resourceUpload";
import { QuickNoteEditor, type QuickNoteEditorApi } from "../../features/quickNotes/QuickNoteEditor";
// 内核样式（ne-* / ne-icon-symbol 的尺寸与配色）**由挂内核的入口自己保证**：
// 桌面走 styles/index.css 的全局 @import；移动端入口不引它，此前只有 mobile/editor/DocumentEditor 引 ⇒
// 冷启动后**先**开小记编辑器（另一个内核消费者）时样式缺席：内核图标按原生尺寸铺满 + 内核的原生
// <input type=file> 直接可见（261009 B2 实测：ne-icon 规则 0 条、7 个 >60px 的 ne-icon-symbol；开过一次文档即自愈）。
// 引在**移动端模块**而不是共享的 QuickNoteEditor：共享模块会把这份 CSS 也打进桌面入口，实测 app-css 1.79MB → 3.07MB（超预算）。
import "@dlient/lakex-doc-react/style.css";
import { emptyLakeBody } from "../../core/lakeDocForm.js";
import { extractAssetRefs, mimeTypeForFilename } from "../../core/assetNaming.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { isQuickNoteImageMime, type StoredQuickNoteImage } from "../../core/quickNoteModel.js";

export interface QuickNoteComposerProps {
  /** 编辑目标（已有小记 id + 正文）；null = 新建 */
  editNote?: { id: string; text: string; body?: string; images: StoredQuickNoteImage[] } | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
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

export function QuickNoteComposer({ editNote, onSaved, onCancel }: QuickNoteComposerProps) {
  const noteId = useMemo(() => editNote?.id ?? crypto.randomUUID(), [editNote]);
  const initialBody = editNote?.body && editNote.body.trim() ? editNote.body : emptyLakeBody(noteId);
  const [text, setText] = useState(editNote?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<QuickNoteEditorApi | null>(null);
  /** 本会话上传过的资源元数据（filename → meta）：正文引用提取据此补齐清单。 */
  const uploadedRef = useRef<Map<string, AssetMeta>>(new Map());
  const pendingUploadsRef = useRef(0);
  /** 已有资源（编辑态）：保留 id 与元数据，正文里仍有引用时免去重算。 */
  const existingRef = useRef<Map<string, StoredQuickNoteImage>>(
    new Map((editNote?.images ?? []).map((image) => [image.filename, image])),
  );

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

  const save = async (): Promise<void> => {
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
      await bridge.saveQuickNoteContent(noteId, { text: plain, body, images });
      successFeedback();
      await onSaved();
    } catch (reason) {
      setError("保存失败: " + (reason as Error).message);
      warnFeedback();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mobile-qn-composer">
      <QuickNoteEditor
        ownerId={noteId}
        initialBody={addAssetAccessToken(initialBody)}
        ui="card"
        active
        uploadResource={uploadResource}
        onTextChange={setText}
        onReady={(api) => { apiRef.current = api; }}
      />
      {error && <div className="mobile-qn-error">{error}</div>}
      <footer className="mobile-qn-actions">
        <span className="mobile-qn-hint">工具条：图片 · 待办 · 有序 · 无序 · 分割线</span>
        <div className="mobile-qn-spacer" />
        <button type="button" className="mobile-qn-btn" onClick={onCancel} disabled={saving}>取消</button>
        <button type="button" className="mobile-qn-btn mobile-qn-primary" onClick={() => void save()} disabled={saving}>
          <Check size={15} />{saving ? "保存中…" : "保存"}
        </button>
      </footer>
    </div>
  );
}
