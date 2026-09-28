/**
 * 移动端多维表只读视图（kind=bitable）。
 *
 * 与桌面共用同一份数据模型（`src/core/bitableDoc.ts`：字段/选项/视图求值都是纯核心），
 * 这里只做**只读呈现**：多表切换 + 视图（筛选/排序/隐藏列/列顺序）按桌面同一口径求值 + 横向滚动网格 +
 * 附件列直接读 canonical URL（AssetServer 已让本机可达）。
 * 移动端不写库：正文绝不交给 Lake 编辑器，也不保存（对齐「非 doc 只读」铁律）。
 */
import { useMemo, useState } from "react";
import {
  applyViewToRecords,
  bitableAttachments,
  isImplementedViewType,
  isKnownViewType,
  optionChipStyle,
  orderedTableFields,
  parseBitableBody,
  viewTypeLabel,
  type BitableField,
  type BitableRecord,
} from "../../core/bitableDoc.js";
import { extOf, isImageExtension } from "../../core/assetNaming.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { native } from "../../lib/native";
import { showToast } from "../ui/toastBus";

export interface MobileBitableViewerProps {
  noteId: string;
  content: string;
}

/** 附件/图片字段值（`{ file, name }[]`）→ 图片走缩略图（本机 AssetServer，与文档图片同一条路）、
 *  其余按展示名出文件名标签、点击**直接用系统应用打开**（与移动端文档的附件处理一致，
 *  不做应用内预览/播放；同时也避免把音视频/PDF/PPT 一律当 `<img>` 渲染成破图）。 */
function AttachmentCell({ noteId, value }: { noteId: string; value: unknown }) {
  const attachments = bitableAttachments(value);
  if (attachments.length === 0) return <span className="mbt-cell-empty">—</span>;
  const openWithSystem = (file: string) => {
    void native.openAttachment(noteId, file).catch((error: unknown) => {
      showToast(error instanceof Error && error.message ? error.message : "没有可打开此文件的应用", { type: "error" });
    });
  };
  return (
    <span className="mbt-attachments">
      {attachments.map(({ file, name }) => (
        isImageExtension(extOf(file))
          ? <img
              key={file}
              className="mbt-attachment"
              src={withAssetAccessToken(localAssetHttpUrl(noteId, file))}
              alt={name}
              title={name}
              loading="lazy"
            />
          : <button key={file} type="button" className="mbt-attachment-file" title={name} onClick={() => openWithSystem(file)}>{name}</button>
      ))}
    </span>
  );
}

function cellText(field: BitableField, record: BitableRecord): string | null {
  const value = record.values[field.id];
  if (value == null || value === "") return null;
  if (field.type === "select" || field.type === "multiSelect") {
    const ids = Array.isArray(value) ? value : [value];
    const names = ids
      .map((id) => (field.options ?? []).find((option) => option.id === id)?.name)
      .filter((name): name is string => !!name);
    return names.length ? names.join("、") : null;
  }
  if (Array.isArray(value)) return value.join("、");
  return String(value);
}

export function MobileBitableViewer({ noteId, content }: MobileBitableViewerProps) {
  const doc = useMemo(() => parseBitableBody(content), [content]);
  const [tableId, setTableId] = useState<string | null>(null);
  const table = doc?.tables.find((item) => item.id === tableId) ?? doc?.tables[0];

  if (!doc || !table) {
    return <div className="mobile-empty">这张多维表还没有数据表。</div>;
  }
  const view = table.views.find((item) => item.id === table.activeViewId) ?? table.views[0];
  const fields = orderedTableFields(table, view);
  const records = applyViewToRecords(table, view);

  return (
    <div className="mobile-bitable" data-mobile-bitable>
      {doc.tables.length > 1 && (
        <div className="mbt-tables" role="tablist" aria-label="数据表">
          {doc.tables.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={"mbt-table-tab" + (item.id === table.id ? " is-active" : "")}
              aria-selected={item.id === table.id}
              onClick={() => setTableId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className="mbt-meta">
        <span>{table.name}</span>
        <span className="mbt-meta-sep">·</span>
        <span>{records.length} 条记录</span>
        {view?.name && (
          <>
            <span className="mbt-meta-sep">·</span>
            <span>{view.name} 视图</span>
          </>
        )}
        <span className="mbt-readonly">只读</span>
      </div>
      {/* 桌面视图类型是开放集合：移动端首版只做表格只读，非 grid 视图必须给明确交代（不允许空白/静默降级） */}
      {view.type !== "grid" && (
        <div className="mbt-view-notice" role="status">
          {!isKnownViewType(view.type)
            ? "当前版本不支持「" + view.type + "」视图，已按表格只读展示。"
            : isImplementedViewType(view.type)
              ? "「" + viewTypeLabel(view.type) + "」桌面已支持，移动端暂以表格只读展示。"
              : "「" + viewTypeLabel(view.type) + "」暂未提供，移动端以表格只读展示。"}
        </div>
      )}
      <div className="mbt-grid-wrap">
        <table className="mbt-grid">
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.id} style={{ minWidth: field.width ?? 120 }}>
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                {fields.map((field) => {
                  const text = cellText(field, record);
                  if (field.type === "attachment" || field.type === "image") {
                    return (
                      <td key={field.id}>
                        <AttachmentCell noteId={noteId} value={record.values[field.id]} />
                      </td>
                    );
                  }
                  if (field.type === "select" || field.type === "multiSelect") {
                    const ids = Array.isArray(record.values[field.id])
                      ? (record.values[field.id] as unknown[])
                      : [record.values[field.id]];
                    const options = ids
                      .map((id) => (field.options ?? []).find((option) => option.id === id))
                      .filter((option): option is NonNullable<typeof option> => !!option);
                    return (
                      <td key={field.id}>
                        {options.length === 0
                          ? <span className="mbt-cell-empty">—</span>
                          : options.map((option) => (
                          <span
                              key={option.id}
                              className="mbt-option"
                              style={optionChipStyle(option.color)}
                            >
                              {option.name}
                            </span>
                          ))}
                      </td>
                    );
                  }
                  return (
                    <td key={field.id}>
                      {text == null ? <span className="mbt-cell-empty">—</span> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td className="mbt-empty" colSpan={Math.max(1, fields.length)}>当前视图没有记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MobileBitableViewer;
