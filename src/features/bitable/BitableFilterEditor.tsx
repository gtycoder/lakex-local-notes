/**
 * 多维表筛选编辑器：远端 lake 风格的递归条件树。
 *
 * 视图筛选与关联选择器的临时筛选共用本组件；后续条件着色只接 core 的
 * `evaluateFilterNode` / `createBitableFilterRule` 与本编辑器即可，不再复制规则 UI。
 */
import { useMemo, useState } from "react";
import { Check, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import {
  BITABLE_DATE_FILTER_MODE_LABEL,
  BITABLE_FILTER_MAX_GROUP_DEPTH,
  bitableRecordTitle,
  createBitableFilterGroup,
  createBitableFilterRule,
  dateFilterModesFor,
  defaultFilterValueFor,
  filterOperatorLabel,
  filterOperatorsFor,
  filterValueKindFor,
  isBitableFilterGroup,
  relationTargetTable,
  type BitableDateFilterMode,
  type BitableDisplayContext,
  type BitableField,
  type BitableFilterGroup,
  type BitableFilterJoin,
  type BitableFilterNode,
  type BitableFilterOperator,
  type BitableFilterRule,
} from "../../core/bitableDoc.js";
import { DatePicker, Popover, SelectMenu } from "./bitableCells.js";
import "./bitableFilterEditor.css";

export interface BitableFilterEditorProps {
  fields: readonly BitableField[];
  filters: readonly BitableFilterNode[];
  operator?: BitableFilterJoin;
  readOnly?: boolean;
  ctx?: BitableDisplayContext;
  onChange?: (filters: BitableFilterNode[], operator: BitableFilterJoin) => void;
  /** 根筛选清空按钮；关联选择器的临时筛选不显示。 */
  onClear?: () => void;
}

type FilterPath = number[];

function replaceAt(nodes: readonly BitableFilterNode[], path: FilterPath, updater: (node: BitableFilterNode) => BitableFilterNode): BitableFilterNode[] {
  const [index, ...rest] = path;
  return nodes.map((node, i) => {
    if (i !== index) return node;
    if (rest.length === 0) return updater(node);
    return isBitableFilterGroup(node) ? { ...node, filters: replaceAt(node.filters, rest, updater) } : node;
  });
}

function removeAt(nodes: readonly BitableFilterNode[], path: FilterPath): BitableFilterNode[] {
  const [index, ...rest] = path;
  return nodes.flatMap((node, i) => {
    if (i !== index) return [isBitableFilterGroup(node) ? { ...node, filters: removeAt(node.filters, rest) } : node];
    if (rest.length === 0) return [];
    return [isBitableFilterGroup(node) ? { ...node, filters: removeAt(node.filters, rest) } : node];
  });
}

function insertAt(nodes: readonly BitableFilterNode[], path: FilterPath, node: BitableFilterNode): BitableFilterNode[] {
  if (path.length === 0) return [...nodes, node];
  const [index, ...rest] = path;
  return nodes.map((item, i) => (i === index && isBitableFilterGroup(item) ? { ...item, filters: insertAt(item.filters, rest, node) } : item));
}

function flattenAt(nodes: readonly BitableFilterNode[], path: FilterPath): BitableFilterNode[] {
  const [index, ...rest] = path;
  return nodes.flatMap((node, i) => {
    if (i !== index) return [node];
    if (rest.length === 0) return isBitableFilterGroup(node) ? node.filters : [node];
    return [isBitableFilterGroup(node) ? { ...node, filters: flattenAt(node.filters, rest) } : node];
  });
}

function pruneEmptyGroups(nodes: readonly BitableFilterNode[]): BitableFilterNode[] {
  const out: BitableFilterNode[] = [];
  for (const node of nodes) {
    if (!isBitableFilterGroup(node)) { out.push(node); continue; }
    const children = pruneEmptyGroups(node.filters);
    if (children.length > 0) out.push({ ...node, filters: children });
  }
  return out;
}

function filterRuleWithField(rule: BitableFilterRule, field: BitableField): BitableFilterRule {
  const next = createBitableFilterRule(field, rule.id);
  return next;
}

function filterRuleWithOperator(rule: BitableFilterRule, field: BitableField, operator: BitableFilterOperator): BitableFilterRule {
  const value = defaultFilterValueFor(field, operator);
  const next: BitableFilterRule = { ...rule, operator };
  if (value === undefined) delete next.value; else next.value = value;
  if (field.type === "date" || field.type === "createdTime" || field.type === "updatedTime") next.valueMode = "custom";
  else delete next.valueMode;
  return next;
}

function effectiveOperator(field: BitableField, rule: BitableFilterRule): BitableFilterOperator {
  const operators = filterOperatorsFor(field);
  return operators.includes(rule.operator) ? rule.operator : operators[0] ?? "isEmpty";
}

function labelForRule(field: BitableField | undefined, rule: BitableFilterRule): string {
  if (!field) return "已删除字段";
  const operator = effectiveOperator(field, rule);
  return `${field.name} ${filterOperatorLabel(field, operator)}`;
}

function optionLabel(values: string[], options: Array<{ value: string; label: string }>): string {
  if (values.length === 0) return "请选择";
  const labels = values.map((value) => options.find((item) => item.value === value)?.label ?? value).filter(Boolean);
  return labels.length <= 2 ? labels.join("、") : `${labels.slice(0, 2).join("、")} +${labels.length - 2}`;
}

function FilterMultiSelect({ field, rule, ctx, readOnly, onChange }: {
  field: BitableField;
  rule: BitableFilterRule;
  ctx?: BitableDisplayContext;
  readOnly?: boolean;
  onChange: (next: BitableFilterRule) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const selected = Array.isArray(rule.value) ? rule.value : typeof rule.value === "string" && rule.value ? [rule.value] : [];
  const options = useMemo(() => {
    if (field.type === "multiSelect") return (field.options ?? []).map((option) => ({ value: option.id, label: option.name }));
    if (field.type === "relationOneWay" || field.type === "relationTwoWay") {
      const table = relationTargetTable(ctx, field);
      return table ? table.records.map((record) => ({ value: record.id, label: bitableRecordTitle(table, record, ctx) })) : [];
    }
    return [];
  }, [ctx, field]);
  const visible = options.filter((option) => !query.trim() || option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
    onChange({ ...rule, value: next });
  };
  return (
    <>
      <button ref={(el) => setAnchor(el)} type="button" className="bt-filter-value-trigger" disabled={readOnly || options.length === 0}
        title={optionLabel(selected, options)} onClick={() => setOpen((value) => !value)}>
        <span className="bt-filter-value-text ln-ellipsis">{optionLabel(selected, options)}</span>
      </button>
      <Popover open={open} anchor={anchor} onClose={() => { setOpen(false); setQuery(""); }} width={280} align="start">
        <div className="bt-filter-multi">
          <label className="bt-filter-multi-search">
            <Search size={13} />
            <input className="ln-input__field" value={query} placeholder="搜索" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="bt-filter-multi-list">
            {visible.map((option) => (
              <button key={option.value} type="button" className="bt-menu-item ln-menu__item" onClick={() => toggle(option.value)}>
                <span className="bt-menu-label ln-ellipsis">{option.label}</span>
                {selected.includes(option.value) && <Check size={14} />}
              </button>
            ))}
            {visible.length === 0 && <div className="bt-filter-multi-empty">无匹配项</div>}
          </div>
        </div>
      </Popover>
    </>
  );
}

function FilterValueEditor({ field, rule, ctx, readOnly, onChange }: {
  field: BitableField;
  rule: BitableFilterRule;
  ctx?: BitableDisplayContext;
  readOnly?: boolean;
  onChange: (next: BitableFilterRule) => void;
}) {
  const kind = filterValueKindFor(field, rule.operator);
  if (kind === "none") return <span className="bt-filter-value-placeholder" />;
  if (kind === "date") {
    const mode = rule.valueMode ?? "custom";
    const modes = dateFilterModesFor(rule.operator).map((value) => ({ value, label: BITABLE_DATE_FILTER_MODE_LABEL[value] }));
    return (
      <div className="bt-filter-date-value">
        <SelectMenu value={mode} disabled={readOnly} options={modes} onChange={(value) => {
          const nextMode = value as BitableDateFilterMode;
          onChange({ ...rule, valueMode: nextMode, value: nextMode === "custom" ? "" : nextMode });
        }} />
        {mode === "custom" && (
          <DatePicker value={rule.value} readOnly={Boolean(readOnly)} onChange={(value) => onChange({ ...rule, value: typeof value === "string" ? value : "" })} />
        )}
      </div>
    );
  }
  if (kind === "select") {
    return <SelectMenu value={typeof rule.value === "string" ? rule.value : ""} disabled={readOnly}
      options={(field.options ?? []).map((option) => ({ value: option.id, label: option.name }))}
      placeholder="请选择" onChange={(value) => onChange({ ...rule, value })} />;
  }
  if (kind === "multiSelect") return <FilterMultiSelect field={field} rule={rule} ctx={ctx} readOnly={readOnly} onChange={onChange} />;
  if (kind === "boolean") {
    return <label className="bt-filter-boolean"><input type="checkbox" disabled={readOnly} checked={rule.value === true}
      onChange={(event) => onChange({ ...rule, value: event.target.checked })} />已勾选</label>;
  }
  return <input className="bt-filter-input" disabled={readOnly} inputMode={kind === "number" ? "decimal" : "text"}
    value={typeof rule.value === "string" ? rule.value : ""} placeholder="请输入"
    onChange={(event) => onChange({ ...rule, value: event.target.value })} />;
}

function FilterSettingMenu({ canGroup, onDelete, onGroup }: { canGroup: boolean; onDelete: () => void; onGroup: () => void }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={(el) => setAnchor(el)} type="button" className="bt-icon-btn bt-filter-more" title="更多" aria-label="更多" onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={15} />
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} width={170} align="end">
        <div className="bt-panel">
          {canGroup && <button type="button" className="bt-menu-item ln-menu__item" onClick={() => { onGroup(); setOpen(false); }}><Plus size={14} />创建分组</button>}
          <button type="button" className="bt-menu-item ln-menu__item is-danger" onClick={() => { onDelete(); setOpen(false); }}><Trash2 size={14} />删除规则</button>
        </div>
      </Popover>
    </>
  );
}

function FilterGroupSettingMenu({ onDelete, onFlatten }: { onDelete: () => void; onFlatten: () => void }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={(el) => setAnchor(el)} type="button" className="bt-icon-btn bt-filter-more" title="更多" aria-label="更多" onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={15} />
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} width={170} align="end">
        <div className="bt-panel">
          <button type="button" className="bt-menu-item ln-menu__item" onClick={() => { onFlatten(); setOpen(false); }}>展开分组</button>
          <button type="button" className="bt-menu-item ln-menu__item is-danger" onClick={() => { onDelete(); setOpen(false); }}><Trash2 size={14} />删除分组</button>
        </div>
      </Popover>
    </>
  );
}

function FilterAddMenu({ canGroup, readOnly, onAddRule, onAddGroup }: {
  canGroup: boolean;
  readOnly?: boolean;
  onAddRule: () => void;
  onAddGroup: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (readOnly) return null;
  return (
    <>
      <button ref={(el) => setAnchor(el)} type="button" className="bt-filter-add" onClick={() => setOpen((value) => !value)}><Plus size={14} />添加筛选规则</button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} width={190} align="start">
        <div className="bt-panel">
          <button type="button" className="bt-menu-item ln-menu__item" onClick={() => { onAddRule(); setOpen(false); }}><Plus size={14} />添加筛选规则</button>
          {canGroup && <button type="button" className="bt-menu-item ln-menu__item" onClick={() => { onAddGroup(); setOpen(false); }}><Plus size={14} />添加筛选分组</button>}
        </div>
      </Popover>
    </>
  );
}

function FilterGroupView({ fields, group, path, depth, root, readOnly, ctx, onReplace, onRemove, onInsert, onFlatten, onRootOperator }: {
  fields: readonly BitableField[];
  group: BitableFilterGroup;
  path: FilterPath;
  depth: number;
  root?: boolean;
  readOnly?: boolean;
  ctx?: BitableDisplayContext;
  onReplace: (path: FilterPath, node: BitableFilterNode) => void;
  onRemove: (path: FilterPath) => void;
  onInsert: (path: FilterPath, node: BitableFilterNode) => void;
  onFlatten: (path: FilterPath) => void;
  onRootOperator: (operator: BitableFilterJoin) => void;
}) {
  const firstField = fields[0];
  const changeOperator = (operator: BitableFilterJoin) => {
    if (root) onRootOperator(operator);
    else onReplace(path, { ...group, operator });
  };
  const addRule = () => onInsert(path, createBitableFilterRule(firstField));
  const addGroup = () => onInsert(path, { ...createBitableFilterGroup(), filters: [createBitableFilterRule(firstField)] });
  return (
    <div className={`bt-filter-group${root ? " is-root" : ""}`} data-depth={depth}>
      {group.filters.map((node, index) => {
        const childPath = [...path, index];
        const join = index === 0 ? "当" : group.operator === "and" ? "与" : "或";
        return (
          <div key={(node.id ?? `${path.join(".")}.${index}`)} className="bt-filter-line">
            <div className="bt-filter-join">
              {index === 1 && !readOnly ? (
                <SelectMenu value={group.operator} options={[{ value: "and", label: "与" }, { value: "or", label: "或" }]} onChange={(value) => changeOperator(value as BitableFilterJoin)} />
              ) : <span className="bt-filter-join-text">{join}</span>}
            </div>
            <div className="bt-filter-node">
              {isBitableFilterGroup(node) ? (
                <div className="bt-filter-group-surface">
                  <FilterGroupView fields={fields} group={node} path={childPath} depth={depth + 1} readOnly={readOnly} ctx={ctx}
                    onReplace={onReplace} onRemove={onRemove} onInsert={onInsert} onFlatten={onFlatten} onRootOperator={onRootOperator} />
                </div>
              ) : (
                <FilterRuleView fields={fields} rule={node} readOnly={readOnly} ctx={ctx} onChange={(next) => onReplace(childPath, next)} />
              )}
            </div>
            <div className="bt-filter-setting-slot">
              {!readOnly && (isBitableFilterGroup(node) ? (
                <FilterGroupSettingMenu onDelete={() => onRemove(childPath)} onFlatten={() => onFlatten(childPath)} />
              ) : (
                <FilterSettingMenu canGroup={depth < BITABLE_FILTER_MAX_GROUP_DEPTH} onDelete={() => onRemove(childPath)}
                  onGroup={() => onReplace(childPath, { ...createBitableFilterGroup(undefined, "and"), filters: [node] })} />
              ))}
            </div>
          </div>
        );
      })}
      <FilterAddMenu canGroup={depth < BITABLE_FILTER_MAX_GROUP_DEPTH} readOnly={readOnly} onAddRule={addRule} onAddGroup={addGroup} />
    </div>
  );
}

function FilterRuleView({ fields, rule, readOnly, ctx, onChange }: {
  fields: readonly BitableField[];
  rule: BitableFilterRule;
  readOnly?: boolean;
  ctx?: BitableDisplayContext;
  onChange: (next: BitableFilterRule) => void;
}) {
  const field = fields.find((item) => item.id === rule.fieldId);
  if (!field) return <span className="bt-filter-missing">已删除字段</span>;
  const operators = filterOperatorsFor(field).map((operator) => ({ value: operator, label: filterOperatorLabel(field, operator) }));
  const operator = effectiveOperator(field, rule);
  return (
    <div className="bt-filter-rule" title={labelForRule(field, rule)}>
      <SelectMenu value={field.id} disabled={readOnly} options={fields.map((item) => ({ value: item.id, label: item.name }))}
        onChange={(fieldId) => { const nextField = fields.find((item) => item.id === fieldId); if (nextField) onChange(filterRuleWithField(rule, nextField)); }} />
      <SelectMenu value={operator} disabled={readOnly} options={operators}
        onChange={(operator) => onChange(filterRuleWithOperator(rule, field, operator as BitableFilterOperator))} />
      <FilterValueEditor field={field} rule={{ ...rule, operator }} ctx={ctx} readOnly={readOnly} onChange={onChange} />
    </div>
  );
}

export function BitableFilterEditor({ fields, filters, operator = "and", readOnly, ctx, onChange, onClear }: BitableFilterEditorProps) {
  const filterFields = useMemo(() => fields.filter((field) => filterOperatorsFor(field).length > 0), [fields]);
  const rootGroup: BitableFilterGroup = { operator, filters: [...filters] };
  if (filterFields.length === 0) return <div className="bt-filter-empty">当前表没有可筛选字段</div>;
  /** 根组操作只改 view 级 operator；子组操作通过路径替换原节点。 */
  const replace = (path: FilterPath, node: BitableFilterNode) => {
    if (!onChange) return;
    if (path.length === 0) return;
    onChange(replaceAt(filters, path, () => node), operator);
  };
  const remove = (path: FilterPath) => onChange?.(pruneEmptyGroups(removeAt(filters, path)), operator);
  const insert = (path: FilterPath, node: BitableFilterNode) => onChange?.(insertAt(filters, path, node), operator);
  const flatten = (path: FilterPath) => onChange?.(pruneEmptyGroups(flattenAt(filters, path)), operator);
  return (
    <div className="bt-filter-editor" aria-label="筛选条件">
      <FilterGroupView fields={filterFields} group={rootGroup} path={[]} depth={0} root readOnly={readOnly} ctx={ctx}
        onReplace={replace} onRemove={remove} onInsert={insert} onFlatten={flatten}
        onRootOperator={(next) => onChange?.([...filters], next)} />
      {onClear && (
        <>
          <div className="bt-filter-hr" />
          <button type="button" className="bt-filter-delete" disabled={readOnly || filters.length === 0} onClick={onClear}><Trash2 size={14} />删除筛选</button>
        </>
      )}
    </div>
  );
}
