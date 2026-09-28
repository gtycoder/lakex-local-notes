/**
 * 视图配置面板（V02 看板 / V03 画册 / V04 日历）——只渲染浮层**内容**，
 * 浮层锚点与开关状态留在 BitableEditor（它持有视图状态），配置读写统一走 `onPatch`。
 *
 * 全只读态铁律：这里每个写入口都必须受 `readOnly` 封住（下拉 disabled / 勾选 disabled），
 * 否则只读文档（回收站、被锁、被他端删除）还能改视图配置——V02 验收时抓到过这个漏。
 * 样式只复用已有类（bt-panel / bt-rule-row / bt-field-check / bt-panel-note），不新增 CSS。
 */
import {
  bitableAttachmentFields, bitableDateFields, bitableSelectFields, calendarColorField, calendarEndField, calendarStartField,
  galleryCardFieldCandidates, galleryCardFields, galleryCoverField, kanbanCardFieldCandidates, kanbanCardFields, kanbanGroupField,
  type BitableField, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";
import { SelectMenu } from "./bitableCells.js";

export interface ViewConfigPanelProps {
  table: BitableTable;
  view: BitableView;
  readOnly: boolean;
  onPatch: (patch: Partial<BitableView>) => void;
}

/** 勾选/取消卡片字段：未配置时的「全部」先落成显式列表，再增删——语义始终确定。 */
function toggleCardField(candidates: BitableField[], shown: Set<string>, fieldId: string): string[] {
  const next = new Set(shown);
  if (next.has(fieldId)) next.delete(fieldId); else next.add(fieldId);
  return candidates.filter((f) => next.has(f.id)).map((f) => f.id);
}

function CardFieldChecks({ candidates, shown, readOnly, onToggle }: { candidates: BitableField[]; shown: Set<string>; readOnly: boolean; onToggle: (fieldId: string) => void }) {
  if (candidates.length === 0) return <p className="bt-panel-note">没有可上卡的字段（主字段是卡片标题，分栏/封面字段由布局承担）。</p>;
  return (
    <>
      {candidates.map((field) => (
        <label key={field.id} className="bt-field-check">
          <input type="checkbox" checked={shown.has(field.id)} disabled={readOnly} onChange={() => onToggle(field.id)} />{field.name}
        </label>
      ))}
    </>
  );
}

export function KanbanConfigPanel({ table, view, readOnly, onPatch }: ViewConfigPanelProps) {
  const selectFields = bitableSelectFields(table);
  const candidates = kanbanCardFieldCandidates(table, view);
  const shown = new Set(kanbanCardFields(table, view).map((f) => f.id));
  return (
    <>
      <h4>看板配置</h4>
      <div className="bt-rule-row">
        <SelectMenu value={kanbanGroupField(table, view)?.id ?? ""} placeholder="选择分组字段" disabled={readOnly}
          onChange={(value) => onPatch({ kanbanGroupFieldId: value })}
          options={selectFields.map((field) => ({ value: field.id, label: field.name }))} />
      </div>
      {selectFields.length === 0 && <p className="bt-panel-note">这张表还没有单选字段；先在表格视图里新增一个单选字段，看板才能分组。</p>}
      <label className="bt-field-check">
        <input type="checkbox" checked={view.kanbanShowFieldNames !== false} disabled={readOnly}
          onChange={(event) => onPatch({ kanbanShowFieldNames: event.target.checked })} />显示字段名
      </label>
      <span className="bt-field-label-text">卡片字段</span>
      <CardFieldChecks candidates={candidates} shown={shown} readOnly={readOnly} onToggle={(fieldId) => onPatch({ kanbanFieldIds: toggleCardField(candidates, shown, fieldId) })} />
    </>
  );
}

export function GalleryConfigPanel({ table, view, readOnly, onPatch }: ViewConfigPanelProps) {
  const coverFields = bitableAttachmentFields(table);
  const cover = galleryCoverField(table, view);
  const candidates = galleryCardFieldCandidates(table, view);
  const shown = new Set(galleryCardFields(table, view).map((f) => f.id));
  return (
    <>
      <h4>画册配置</h4>
      <div className="bt-rule-row">
        <span className="bt-field-label-text">封面字段</span>
        <SelectMenu value={cover?.id ?? ""} placeholder="无封面" disabled={readOnly}
          onChange={(value) => onPatch({ galleryCoverFieldId: value })}
          options={[{ value: "", label: "无封面" }, ...coverFields.map((field) => ({ value: field.id, label: field.name }))]} />
      </div>
      {coverFields.length === 0 && <p className="bt-panel-note">这张表还没有「图片和附件」字段；卡片会显示无封面占位，多图按第一张可用图片显示。</p>}
      <div className="bt-rule-row">
        <span className="bt-field-label-text">展示</span>
        <SelectMenu value={view.gallerySize ?? "regular"} disabled={readOnly}
          onChange={(value) => onPatch({ gallerySize: value as "regular" | "compact" })}
          options={[{ value: "regular", label: "常规" }, { value: "compact", label: "紧凑" }]} />
        <SelectMenu value={view.galleryFit ?? "cover"} disabled={readOnly}
          onChange={(value) => onPatch({ galleryFit: value as "cover" | "contain" })}
          options={[{ value: "cover", label: "裁剪" }, { value: "contain", label: "适应" }]} />
      </div>
      <label className="bt-field-check">
        <input type="checkbox" checked={view.galleryShowFieldNames !== false} disabled={readOnly}
          onChange={(event) => onPatch({ galleryShowFieldNames: event.target.checked })} />显示字段名
      </label>
      <span className="bt-field-label-text">卡片字段</span>
      <CardFieldChecks candidates={candidates} shown={shown} readOnly={readOnly} onToggle={(fieldId) => onPatch({ galleryFieldIds: toggleCardField(candidates, shown, fieldId) })} />
    </>
  );
}

export function CalendarConfigPanel({ table, view, readOnly, onPatch }: ViewConfigPanelProps) {
  const dateFields = bitableDateFields(table);
  const selectFields = bitableSelectFields(table);
  const toOptions = (fields: BitableField[]) => fields.map((field) => ({ value: field.id, label: field.name }));
  return (
    <>
      <h4>日历配置</h4>
      <div className="bt-rule-row">
        <span className="bt-field-label-text">开始日期</span>
        <SelectMenu value={calendarStartField(table, view)?.id ?? ""} placeholder="选择日期字段" disabled={readOnly}
          onChange={(value) => onPatch({ calendarStartFieldId: value })} options={toOptions(dateFields)} />
      </div>
      {dateFields.length === 0 && <p className="bt-panel-note">这张表还没有日期字段；先在表格视图里新增一个日期字段，日历才能排布。</p>}
      <div className="bt-rule-row">
        <span className="bt-field-label-text">结束日期</span>
        <SelectMenu value={calendarEndField(table, view)?.id ?? ""} placeholder="（无，按单日）" disabled={readOnly}
          onChange={(value) => onPatch({ calendarEndFieldId: value })}
          options={[{ value: "", label: "（无，按单日）" }, ...toOptions(dateFields)]} />
      </div>
      <div className="bt-rule-row">
        <span className="bt-field-label-text">标题字段</span>
        <SelectMenu value={view.calendarTitleFieldId ?? table.fields[0]?.id ?? ""} disabled={readOnly}
          onChange={(value) => onPatch({ calendarTitleFieldId: value })} options={toOptions(table.fields)} />
      </div>
      <div className="bt-rule-row">
        <span className="bt-field-label-text">颜色字段</span>
        <SelectMenu value={calendarColorField(table, view)?.id ?? ""} placeholder="（无）" disabled={readOnly}
          onChange={(value) => onPatch({ calendarColorFieldId: value })}
          options={[{ value: "", label: "（无）" }, ...toOptions(selectFields)]} />
      </div>
      {selectFields.length === 0 && <p className="bt-panel-note">颜色字段第一版只支持单选；这张表还没有单选字段。</p>}
    </>
  );
}
