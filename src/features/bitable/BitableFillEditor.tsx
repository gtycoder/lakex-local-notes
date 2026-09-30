import { useMemo, useState } from "react";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import {
  BITABLE_FILL_MAX_RULES,
  BITABLE_FILL_MODE_LABEL,
  BITABLE_FILL_NO_COLOR,
  createBitableFillRule,
  filterOperatorsFor,
  type BitableDisplayContext,
  type BitableField,
  type BitableFillMode,
  type BitableFillRule,
} from "../../core/bitableDoc.js";
import { DEFAULT_LIGHT_COLORS } from "../../core/colorPalette.js";
import { ColorPalette, SelectMenu } from "./bitableCells.js";
import { BitableFilterRuleEditor } from "./BitableFilterEditor.js";
import "./bitableFillRules.css";

const FILL_MODE_OPTIONS = (Object.keys(BITABLE_FILL_MODE_LABEL) as BitableFillMode[]).map((value) => ({
  value,
  label: BITABLE_FILL_MODE_LABEL[value],
}));

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function BitableFillEditor({ fields, rules, ctx, readOnly, onChange }: {
  fields: readonly BitableField[];
  rules: readonly BitableFillRule[];
  ctx?: BitableDisplayContext;
  readOnly?: boolean;
  onChange: (rules: BitableFillRule[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [colorEditor, setColorEditor] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const filterFields = useMemo(() => fields.filter((field) => filterOperatorsFor(field).length > 0), [fields]);
  const canAdd = !readOnly && rules.length < BITABLE_FILL_MAX_RULES;

  const replace = (index: number, next: BitableFillRule) => {
    onChange(rules.map((rule, i) => (i === index ? next : rule)));
  };

  const changeMode = (index: number, mode: BitableFillMode) => {
    const rule = rules[index];
    const preferredFieldId = rule.mode === "column" ? rule.fieldId : rule.condition.fieldId;
    const next = mode !== "column" && rule.mode !== "column"
      ? { ...rule, mode, condition: rule.condition } as BitableFillRule
      : createBitableFillRule(mode, fields, rule.color, preferredFieldId);
    if (next) replace(index, next);
  };

  const addRule = () => {
    if (!canAdd) return;
    const color = DEFAULT_LIGHT_COLORS[rules.length % DEFAULT_LIGHT_COLORS.length];
    const next = createBitableFillRule("cell", fields, color);
    if (next) onChange([...rules, next]);
  };

  return (
    <div className="bt-fill-editor" aria-label="填色配置">
      <div className="bt-fill-head">
        <div>
          <strong>填色</strong>
          <span>颜色按规则顺序和模式进行混合；行侧色条独立显示。</span>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="bt-fill-empty">暂无填色规则。添加后按条件给单元格、整行、行侧或整列着色。</div>
      ) : (
        <div className="bt-fill-list">
          {rules.map((rule, index) => {
            const fillColor = rule.color;
            const noColor = fillColor === BITABLE_FILL_NO_COLOR;
            return (
              <div
                key={rule.id}
                className={"bt-fill-row" + (dragIndex === index ? " is-dragging" : "")}
                onDragOver={(event) => { if (dragIndex !== null) event.preventDefault(); }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex !== null) onChange(moveItem(rules, dragIndex, index));
                  setDragIndex(null);
                }}
              >
                <button
                  type="button"
                  className="bt-fill-grip ln-iconbtn ln-iconbtn--compact"
                  title="拖动调整填色顺序"
                  aria-label="拖动调整填色顺序"
                  disabled={readOnly}
                  draggable={!readOnly}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index));
                    setDragIndex(index);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                ><GripVertical size={14} /></button>

                <button
                  type="button"
                  className={"bt-fill-swatch" + (noColor ? " is-empty" : "")}
                  style={noColor ? undefined : { backgroundColor: fillColor }}
                  title="选择填充色"
                  aria-label={noColor ? "选择填充色，当前无背景色" : "选择填充色 " + rule.color}
                  disabled={readOnly}
                  onClick={(event) => { if (!readOnly) setColorEditor({ index, anchor: event.currentTarget }); }}
                >{noColor ? <X size={14} /> : null}</button>

                <div className="bt-fill-mode">
                  <SelectMenu value={rule.mode} disabled={readOnly} options={FILL_MODE_OPTIONS}
                    onChange={(value) => changeMode(index, value as BitableFillMode)} />
                </div>

                {rule.mode === "column" ? (
                  <div className="bt-fill-column">
                    <SelectMenu value={rule.fieldId} disabled={readOnly}
                      options={fields.map((field) => ({ value: field.id, label: field.name }))}
                      onChange={(fieldId) => replace(index, { ...rule, fieldId })} />
                  </div>
                ) : (
                  <BitableFilterRuleEditor
                    className="bt-fill-condition"
                    fields={filterFields}
                    rule={rule.condition}
                    readOnly={readOnly}
                    ctx={ctx}
                    onChange={(condition) => replace(index, { ...rule, condition })}
                  />
                )}

                <button type="button" className="bt-icon-btn bt-fill-delete" title="删除填色规则" aria-label="删除填色规则"
                  disabled={readOnly} onClick={() => onChange(rules.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      <div className="bt-fill-foot">
        <button type="button" className="bt-panel-add" disabled={!canAdd} onClick={addRule}>
          <Plus size={14} />添加填色条件
        </button>
        {rules.length >= BITABLE_FILL_MAX_RULES && <span className="bt-fill-limit">最多 {BITABLE_FILL_MAX_RULES} 条规则</span>}
      </div>

      {colorEditor && (
        <ColorPalette
          anchor={colorEditor.anchor}
          value={rules[colorEditor.index]?.color}
          recentKey={rules[colorEditor.index]?.mode === "rowSide" ? "bitable-fill:rowSide" : "bitable-fill:background"}
          closeOnNestedOverlay
          defaultLabel="无背景色" defaultKind="background"
          onPick={(color) => {
            const rule = rules[colorEditor.index];
            if (rule) replace(colorEditor.index, { ...rule, color });
          }}
          onDefault={() => {
            const rule = rules[colorEditor.index];
            if (rule) replace(colorEditor.index, { ...rule, color: BITABLE_FILL_NO_COLOR });
          }}
          onClose={() => setColorEditor(null)}
        />
      )}
    </div>
  );
}
