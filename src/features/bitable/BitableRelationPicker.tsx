/**
 * 关联记录选择器（260929 用户改版）：**全局大弹窗**，替代原来的单元格小气泡。
 *
 * 用户口径（260929）：
 * - 两个 tab：「所有可关联记录」/「已选 N 条记录」；已选页签同样保留复选框，可取消；
 * - 顶部搜索框做**全局搜索**，右侧带筛选与排序；
 * - 主区域**完整展示**目标表（全部字段 × 全部可关联记录）；
 * - **不做「添加记录」**（原 T02B.2 的新建记录入口按用户要求撤销）。
 *
 * 不变的口径：只改本机草稿，点「确认」才写正文（取消 / 搜索 / 重复选择都不落盘）；
 * 可关联范围由字段的**数据范围**决定（`relation.viewId` → `relationCandidateRecords`，单一来源）；
 * 单元格里的 chip 展示仍走 `relationTargetRecords`（已选记录即使被数据范围过滤掉也照常显示）。
 */
import { useMemo, useState } from "react";
import { ArrowDownUp, Filter, Lock, Plus, Search, Trash2 } from "lucide-react";
import {
  applySortMode, applyViewToRecords, bitableAttachments, bitableFieldText, bitableFilterRuleCount, bitableRecordTitle,
  changeSortField, groupRecords, relationCandidateRecords, relationPickerFields,
  relationRecordIds, relationTargetTable, relationTargetView, sortModeLabel, sortModeOf, sortModesForField, toggleRelationDraft,
  type BitableAttachment, type BitableDisplayContext, type BitableField, type BitableFilterJoin, type BitableFilterNode, type BitableRecord,
  type BitableSortMode, type BitableSortRule, type BitableView,
} from "../../core/bitableDoc.js";
import { Dialog } from "../../components/ui/Overlay.js";
import { BitableVirtualBody } from "./BitableVirtualBody.js";
import { BitableFilterEditor } from "./BitableFilterEditor.js";
import { AttachmentChipList, CellEditor, SelectMenu } from "./bitableCells.js";
import { openBitableAttachment } from "./bitableAssetUrl.js";
import "./bitableRelationPicker.css";

export interface BitableRelationPickerProps {
  field: BitableField;
  /** 单元格当前的已选记录 id（打开时拷进草稿）。 */
  value: unknown;
  ctx?: BitableDisplayContext;
  /** 所在文档 id：图片/附件列要拼资源 URL 才能真正把缩略图加载出来。 */
  noteId?: string;
  /** 点缩略图 → 预览**该单元格**的图片（不跨字段合并；与表格/画册同一条 Lightbox）。 */
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}

type PickerTab = "all" | "selected";
type PickerRow = { kind: "record"; record: BitableRecord } | { kind: "group"; key: string; label: string; count: number };
const pickerRowKey = (item: PickerRow) => item.kind === "record" ? "r:" + item.record.id : "g:" + item.key;
const pickerRowHeight = (item: PickerRow) => item.kind === "record" ? 36 : 32;
// A virtual window must not let newly mounted values resize the whole table.
// Honour field widths, retaining the picker's existing 320px content cap.
const pickerColumnWidth = (field: BitableField) => Math.max(80, Math.min(320, field.width ?? 180));

/**
 * 一格的值渲染：文本类走展示文本；**图片/附件列复用表格那套 `AttachmentChipList`**
 * （用户 260930：「这两处不是同一套代码吗？能做成一套吗？」⇒ 选择器不再自己养一套「📎 文件名」chip）。
 * 没有 noteId（极少数入口）时才退化成纯文本名（不拼资产 URL、不渲染破图）。
 */
function PickerCellValue({ record, field, ctx, noteId, onOpenImages }: {
  record: BitableRecord;
  field: BitableField;
  ctx?: BitableDisplayContext;
  noteId?: string;
  onOpenImages?: (images: BitableAttachment[], index: number) => void;
}) {
  if (field.type === "image" || field.type === "attachment") {
    const files = bitableAttachments(record.values[field.id]);
    if (files.length === 0) return <span className="bt-rel-blank">—</span>;
    /** 没有 noteId（极端入口）时不拼资产 URL —— 退化成纯文本名，绝不渲染破图。 */
    if (!noteId) {
      return <span className="bt-rel-files">{files.map((file) => <span key={file.file} className="bt-rel-file" title={file.name}>{file.name}</span>)}</span>;
    }
    /** 与表格单元格**同一套**附件渲染（用户 260930）：类型图标 / 缩略图 + hover 名称气泡都走 AttachmentChipList。
        点图标 = 预览本格图片 / 用系统应用打开（与表格同一交互）⇒ 这里截断冒泡，别顺带把整行勾选上。 */
    return (
      <span className="bt-rel-files" onClick={(event) => event.stopPropagation()}>
        <AttachmentChipList noteId={noteId} attachments={files} imageOnly={field.type === "image"}
          onOpen={(attachment) => openBitableAttachment(noteId, attachment)}
          onOpenImages={onOpenImages} />
      </span>
    );
  }
  return (
    <CellEditor
      field={field}
      value={record.values[field.id]}
      readOnly
      onChange={() => undefined}
      onAddOption={() => undefined}
      readOnlyScalarDisplay
      record={record}
      ctx={ctx}
      noteId={noteId}
      onOpenImages={onOpenImages}
    />
  );
}

export function BitableRelationPicker({ field, value, ctx, noteId, onOpenImages, onCancel, onConfirm }: BitableRelationPickerProps) {
  const target = relationTargetTable(ctx, field);
  const scopeView = relationTargetView(ctx, field);
  const allowMultiple = field.relation?.allowMultiple !== false;
  const [draft, setDraft] = useState<string[]>(() => relationRecordIds(value));
  const [tab, setTab] = useState<PickerTab>("all");
  const [query, setQuery] = useState("");
  /** 选择器**本机**的筛选 / 排序（不写正文；复用视图求值引擎，不另造一套规则实现）。 */
  const [filters, setFilters] = useState<BitableFilterNode[]>([]);
  const [filterOperator, setFilterOperator] = useState<BitableFilterJoin>("and");
  const [sorts, setSorts] = useState<BitableSortRule[]>([]);
  const [panel, setPanel] = useState<"filter" | "sort" | null>(null);

  const fields = useMemo(() => relationPickerFields(ctx, field), [ctx, field]);
  const ruleFields = target?.fields ?? [];
  const viewFilters = scopeView?.filters ?? [];
  const viewSorts = scopeView?.sorts ?? [];
  /** 可关联记录 = 目标表全部 或 字段绑定的数据范围视图（core 单一口径）。 */
  const candidates = useMemo(
    () => (target ? relationCandidateRecords(ctx, field) : []),
    [ctx, field, target],
  );
  const allRows = useMemo(() => {
    if (!target) return [];
    const view: BitableView = { id: "rel-picker", name: "rel-picker", type: "grid", filters, filterOperator, sorts };
    return applyViewToRecords({ ...target, records: candidates }, view);
  }, [target, candidates, filters, filterOperator, sorts]);
  /** 已选页签：保持**选择顺序**（不参与字段排序），仍可被搜索与本机筛选收敛。 */
  const selectedRows = useMemo(() => {
    if (!target) return [];
    const byId = new Map(target.records.map((record) => [record.id, record] as const));
    const picked = draft.map((id) => byId.get(id)).filter((record): record is BitableRecord => !!record);
    return applyViewToRecords({ ...target, records: picked }, { id: "rel-picker-picked", name: "rel-picker-picked", type: "grid", filters, filterOperator });
  }, [target, draft, filters, filterOperator]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => (tab === "all" ? allRows : selectedRows)
    .filter(record => !q || ruleFields.some(item => bitableFieldText(record, item, ctx).toLowerCase().includes(q))),
    [tab, allRows, selectedRows, q, ruleFields, ctx]);
  const groupedRows = useMemo(() => {
    const rule = tab === "all" ? scopeView?.groups?.[0] : undefined;
    if (!target || !rule) return [{ key: "", label: "", records: rows }];
    return groupRecords(target, rows, rule);
  }, [target, rows, scopeView, tab]);
  const rowItems = useMemo(() => groupedRows.flatMap(group => [
    ...(group.label ? [{ kind: "group" as const, key: group.key, label: group.label, count: group.records.length }] : []),
    ...group.records.map(record => ({ kind: "record" as const, record })),
  ]), [groupedRows]);
  const draftSet = new Set(draft);
  const toggle = (recordId: string) => setDraft((prev) => toggleRelationDraft(prev, recordId, allowMultiple));

  const scopeText = target ? (scopeView ? target.name + " · " + scopeView.name : target.name + " · 全部记录") : "";

  return (
    <Dialog open onDismiss={onCancel} label="选择关联记录" className="bt-rel-picker" scrimClassName="ln-scrim--top">
      <header className="ln-dialog__head">
        <h3 className="ln-dialog__title">{field.name}</h3>
        <span className="bt-rel-scope" title="数据范围来自字段配置">{scopeText}</span>
      </header>
      {/* 页签走 kit 层原语（260929 用户选定「墨线 + 计数徽标」）：数量进徽标，文案不随数字重排 */}
      <div className="bt-rel-tabs">
        <div className="ln-tabs">
          <div className="ln-tabs__track" role="tablist" aria-label="关联记录范围">
            <button type="button" role="tab" aria-selected={tab === "all"}
              className={"ln-tabs__item" + (tab === "all" ? " is-active" : "")}
              onClick={() => setTab("all")}>所有可关联记录<span className="ln-tabs__count">{candidates.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === "selected"}
              className={"ln-tabs__item" + (tab === "selected" ? " is-active" : "")}
              onClick={() => setTab("selected")}>已选<span className="ln-tabs__count">{draft.length}</span></button>
          </div>
        </div>
      </div>
      <div className="bt-rel-toolbar">
        <span className="bt-rel-search">
          <Search size={14} />
          <input className="ln-input__field" autoFocus value={query} placeholder="搜索相关记录" aria-label="搜索相关记录"
            onChange={(event) => setQuery(event.target.value)} />
        </span>
        <button type="button" className={"bt-icon-btn" + (bitableFilterRuleCount(viewFilters) > 0 || bitableFilterRuleCount(filters) > 0 ? " is-on" : "")}
          title="筛选" aria-label="筛选" aria-expanded={panel === "filter"}
          onClick={() => setPanel((prev) => (prev === "filter" ? null : "filter"))}><Filter size={15} /></button>
        <button type="button" className={"bt-icon-btn" + (viewSorts.length > 0 || sorts.length > 0 ? " is-on" : "")}
          title="排序" aria-label="排序" aria-expanded={panel === "sort"}
          onClick={() => setPanel((prev) => (prev === "sort" ? null : "sort"))}><ArrowDownUp size={15} /></button>
      </div>
      {/* 筛选 / 排序面板做成**弹窗内的内联条**（不嵌气泡）：嵌套气泡在对话框里会被外层面板压住、
          且外点关闭会把面板一起关掉（点击选项丢失）。内联后规则行的下拉都在 .ln-dialog 内，天然抬层。 */}
      {panel === "filter" && (
        <section className="bt-rel-config" aria-label="筛选条件">
          <span className="bt-rel-config-title">筛选</span>
          {viewFilters.length > 0 && (
            <div className="bt-rel-view-filter">
              <span className="bt-rel-rule-badge"><Lock size={12} />视图</span>
              <BitableFilterEditor fields={ruleFields} filters={viewFilters} operator={scopeView?.filterOperator ?? "and"} readOnly ctx={ctx} />
            </div>
          )}
          <BitableFilterEditor fields={ruleFields} filters={filters} operator={filterOperator} ctx={ctx}
            onChange={(next, operator) => { setFilters(next); setFilterOperator(operator); }} />
        </section>
      )}
      {panel === "sort" && (
        <section className="bt-rel-config" aria-label="排序">
          <span className="bt-rel-config-title">排序</span>
          {viewSorts.map((rule, index) => {
            const item = ruleFields.find((fieldItem) => fieldItem.id === rule.fieldId);
            return (
              <div key={"view-sort-" + index} className="bt-rule-row is-view">
                <span className="bt-rel-rule-badge"><Lock size={12} />视图</span>
                <span className="bt-rel-rule-text">{item ? item.name + " · " + sortModeLabel(item, sortModeOf(rule)) : "已删除字段"}</span>
              </div>
            );
          })}
          {sorts.map((rule, index) => (
            <div key={index} className="bt-rule-row">
              <SelectMenu value={rule.fieldId} onChange={(value) => setSorts(sorts.map((r, i) => (i === index ? changeSortField(ruleFields, r, value) : r)))}
                options={ruleFields.map((item) => ({ value: item.id, label: item.name }))} />
              {(() => {
                const item = ruleFields.find((f) => f.id === rule.fieldId) ?? ruleFields[0];
                return (
                  <SelectMenu value={sortModeOf(rule)} onChange={(value) => setSorts(sorts.map((r, i) => (i === index ? applySortMode(r, value as BitableSortMode) : r)))}
                    options={sortModesForField(item).map((mode) => ({ value: mode, label: sortModeLabel(item, mode) }))} />
                );
              })()}
              <button type="button" className="bt-icon-btn" title="删除排序" aria-label="删除排序"
                onClick={() => setSorts(sorts.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
            </div>
          ))}
          <button type="button" className="bt-panel-add" disabled={ruleFields.length === 0}
            onClick={() => setSorts([...sorts, { fieldId: ruleFields[0].id, desc: false }])}><Plus size={14} />添加排序</button>
        </section>
      )}
      <div className="bt-rel-body">
        {rows.length === 0 ? (
          <p className="bt-rel-empty">
            {!target ? "关联的目标数据表不存在" : tab === "selected" ? "还没有选择记录" : q ? "无匹配记录" : "暂无可关联记录"}
          </p>
        ) : (
          <table className="bt-rel-grid" style={{ width: 40 + fields.reduce((sum, field) => sum + pickerColumnWidth(field), 0) }} aria-rowcount={rowItems.length + 1}>
            <colgroup>
              <col className="bt-rel-check" />
              {fields.map(field => <col key={field.id} style={{ width: pickerColumnWidth(field) }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="bt-rel-check" scope="col" />
                {fields.map((item) => <th key={item.id} scope="col" title={item.name}>{item.name}</th>)}
              </tr>
            </thead>
            <BitableVirtualBody
              items={rowItems} getKey={pickerRowKey} estimateSize={pickerRowHeight}
              columns={fields.length + 1} totalRecords={rows.length} visible handleRef={null}
              scrollSelector=".bt-rel-body" fillSpace={false}
              renderRow={(item) => {
                if (item.kind === "group") return (
                  <tr className="bt-rel-group-row">
                    <td colSpan={fields.length + 1}>
                      <span className="bt-rel-group-label">{item.label}</span>
                      <span className="bt-rel-group-count">{item.count} 条</span>
                    </td>
                  </tr>
                );
                const record = item.record;
                const title = target ? bitableRecordTitle(target, record, ctx) : "";
                const checked = draftSet.has(record.id);
                return (
                  <tr data-record-id={record.id} className={checked ? "is-selected" : ""} onClick={() => toggle(record.id)}>
                    <td className="bt-rel-check">
                      <input type="checkbox" checked={checked} aria-label={"选择 " + title}
                        onClick={(event) => event.stopPropagation()} onChange={() => toggle(record.id)} />
                    </td>
                    {fields.map((field) => (
                      <td key={field.id} title={bitableFieldText(record, field, ctx)}>
                        <PickerCellValue record={record} field={field} ctx={ctx} noteId={noteId} onOpenImages={onOpenImages} />
                      </td>
                    ))}
                  </tr>
                );
              }}
            />
          </table>
        )}
      </div>
      <footer className="bt-rel-foot">
        <span className="bt-rel-count">已选 {draft.length} 条记录</span>
        <button type="button" className="bt-secondary" onClick={onCancel}>取消</button>
        <button type="button" className="bt-primary" onClick={() => onConfirm([...draft])}>确认</button>
      </footer>
    </Dialog>
  );
}
