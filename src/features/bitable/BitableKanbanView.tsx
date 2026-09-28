/**
 * 多维表看板视图（V02）。
 *
 * 一个看板视图只看**一个单选字段**：**选项即分栏**（空栏目也保留，才能把卡片拖进空分组），
 * 末尾固定「未分组」栏。分栏/卡片字段的求值全在 `src/core/bitableDoc.ts` 的纯函数里，
 * 这里只做渲染与拖拽；拖拽**只写分组字段的值**，不引入视图级手动排序（用户 260928 确认的第一版口径）。
 *
 * 与表格共用同一份记录：改单选值 → 表格/看板同时变；筛选、排序、搜索继续由上层求值后传进来。
 */
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { ASSET_ORIGIN, assetThumbWidthForCss, withAssetAccessToken } from "../../lib/assetPort.js";
import { withAssetWidth } from "../../core/assetUrl.js";
import { extOf, isImageExtension } from "../../core/assetNaming.js";
import {
  bitableAttachments, bitableDisplayValue, bitableRecordTitle, bitableSelectFields, isAttachmentLikeField,
  kanbanCardFields, kanbanColumns, kanbanGroupField, optionChipStyle,
  type BitableAttachment, type BitableRecord, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";
import { ViewTypeIcon } from "./bitableViews.js";
import "./bitableKanbanView.css";

/** 卡片上缩略图的边长（取 ?w= 档位；用户 260928：图片字段上卡只显示缩略图，不显示文件名）。 */
const KANBAN_THUMB_PX = 36;

export interface BitableKanbanViewProps {
  noteId: string;
  table: BitableTable;
  view: BitableView;
  /** 已按视图筛选/排序（含搜索）的记录；组内顺序 = 传入顺序。 */
  records: BitableRecord[];
  readOnly: boolean;
  /** 拖拽落栏 = 写分组字段的值（未分组栏写空字符串）。 */
  onSetValue: (recordId: string, fieldId: string, value: unknown) => void;
  onOpenRecord: (recordId: string) => void;
  /** 「新建分组」= 往分组字段追加一个选项（与字段编辑器同一套选项）。 */
  onAddGroupOption: (name: string) => void;
  /** 点缩略图：只预览**该单元格内**的图片（不跨字段合并）。 */
  onOpenImages: (images: BitableAttachment[], index: number) => void;
}

export function BitableKanbanView({ noteId, table, view, records, readOnly, onSetValue, onOpenRecord, onAddGroupOption, onOpenImages }: BitableKanbanViewProps) {
  const thumbUrl = (file: string) => withAssetAccessToken(withAssetWidth(ASSET_ORIGIN + "/" + noteId + "/" + file, assetThumbWidthForCss(KANBAN_THUMB_PX)));
  /** 附件/图片字段上卡：只出**图片缩略图**（非图片附件不出名称，避免卡片被文件名刷屏）。 */
  const imageAttachmentsOf = (value: unknown): BitableAttachment[] => bitableAttachments(value).filter((item) => isImageExtension(extOf(item.file)));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 折叠是**本机展示态**，不写正文（与表格分组同一口径）。 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** null = 未在输入；"" = 输入框已打开但还没输名字。 */
  const [draft, setDraft] = useState<string | null>(null);

  const groupField = kanbanGroupField(table, view);
  const columns = groupField ? kanbanColumns(table, view, records) : [];
  const cardFields = groupField ? kanbanCardFields(table, view) : [];
  const showNames = view.kanbanShowFieldNames !== false;

  if (!groupField) {
    return (
      <div className="bt-kanban-empty">
        <ViewTypeIcon type="kanban" size={18} />
        <p>
          {bitableSelectFields(table).length > 0
            ? "看板还没有分组字段——点工具栏「看板配置」选择一个单选字段。"
            : "这张表还没有单选字段，无法看板分组；先在表格视图里新增一个单选字段。"}
        </p>
      </div>
    );
  }

  const toggleCollapsed = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const commitDraft = () => {
    const name = draft?.trim();
    if (name) onAddGroupOption(name);
    setDraft(null);
  };

  return (
    <div className="bt-kanban">
      {columns.map((column) => {
        const isCollapsed = collapsed.has(column.key);
        return (
          <section key={column.key || "__ungrouped"} className={"bt-kanban-col" + (isCollapsed ? " is-collapsed" : "")}
            onDragOver={(event) => { if (!readOnly && draggingId) event.preventDefault(); }}
            onDrop={(event) => {
              if (readOnly || !draggingId) return;
              event.preventDefault();
              onSetValue(draggingId, groupField.id, column.optionId ?? "");
              setDraggingId(null);
            }}>
            <header className="bt-kanban-col-head">
              <button type="button" className="bt-kanban-col-toggle" aria-expanded={!isCollapsed} aria-label={isCollapsed ? "展开分组" : "折叠分组"}
                onClick={() => toggleCollapsed(column.key)}>
                <ChevronRight size={12} className={"bt-kanban-caret" + (isCollapsed ? "" : " is-open")} />
              </button>
              <span className="bt-kanban-chip" style={column.optionId ? optionChipStyle(column.color) : undefined}>{column.label}</span>
              <span className="bt-kanban-count">{column.records.length}</span>
            </header>
            {!isCollapsed && (
              <div className="bt-kanban-col-body">
                {column.records.map((record) => (
                  <article key={record.id}
                    className={"bt-kanban-card" + (draggingId === record.id ? " is-dragging" : "")}
                    draggable={!readOnly}
                    onDragStart={() => setDraggingId(record.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => onOpenRecord(record.id)}>
                    <div className="bt-kanban-card-title">{bitableRecordTitle(table, record)}</div>
                    {cardFields.map((field) => {
                      if (isAttachmentLikeField(field.type)) {
                        const images = imageAttachmentsOf(record.values[field.id]);
                        if (images.length === 0) return null;   // 没有图片就不上卡（不拿文件名占位）
                        return (
                          <div key={field.id} className="bt-kanban-field">
                            {showNames && <span className="bt-kanban-field-name">{field.name}</span>}
                            <span className="bt-kanban-thumbs">
                              {images.map((image, index) => (
                                <img key={image.file} className="bt-kanban-thumb" src={thumbUrl(image.file)} alt={image.name} title={image.name} loading="lazy"
                                  onClick={(event) => { event.stopPropagation(); onOpenImages(images, index); }} />
                              ))}
                            </span>
                          </div>
                        );
                      }
                      const text = bitableDisplayValue(field, record.values[field.id]);
                      if (!text) return null;   // 空字段不上卡，卡片才紧凑
                      return (
                        <div key={field.id} className="bt-kanban-field">
                          {showNames && <span className="bt-kanban-field-name">{field.name}</span>}
                          <span className="bt-kanban-field-value" title={text}>{text}</span>
                        </div>
                      );
                    })}
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <div className="bt-kanban-add">
        {draft === null ? (
          <button type="button" className="bt-kanban-add-btn" disabled={readOnly} onClick={() => setDraft("")}>
            <Plus size={13} />新建分组
          </button>
        ) : (
          <input autoFocus className="bt-input" value={draft} placeholder="分组名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDraft();
              if (event.key === "Escape") setDraft(null);
            }}
            onBlur={() => setDraft(null)} />
        )}
      </div>
    </div>
  );
}
