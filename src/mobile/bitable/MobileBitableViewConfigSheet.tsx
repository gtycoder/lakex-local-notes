/**
 * 移动端多维表「视图配置」底部面板（261030 P0，对齐钉钉三页签：筛选 / 排序 / 布局）。
 *
 * 口径（用户 261030）：
 * - **布局是设备本地偏好**（只读文档也能切，不写正文、不同步）：记录展示方式 表格/卡片、
 *   卡片列数 1/2、封面开关、主/副标题、展示字段；
 * - 筛选 / 排序 / 分组在**只读态只展示**（改了会写正文 ⇒ 违反「打开 = 只读」）；
 *   编辑态可写视图配置（261102 起：筛选/排序/分组都接上；嵌套筛选分组仍只在桌面编辑）。
 */
import { X } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import {
  applySortMode,
  BITABLE_DATE_FILTER_MODE_LABEL,
  BITABLE_SORT_MODE_LABEL,
  bitableFilterRuleCount,
  createBitableFilterRule,
  dateFilterModesFor,
  defaultFilterValueFor,
  filterOperatorLabel,
  filterOperatorsFor,
  filterValueKindFor,
  isBitableFilterGroup,
  isRelationFieldType,
  sortModeLabel,
  sortModeOf,
  sortModesForField,
  type BitableDateFilterMode,
  type BitableField,
  type BitableFilterJoin,
  type BitableFilterNode,
  type BitableFilterOperator,
  type BitableFilterRule,
  type BitableTable,
  type BitableView,
} from "../../core/bitableDoc.js";
import type { BitableRecordLayoutPrefs } from "../../core/bitableRecordLayout";
import type { BitableResolvedRecordLayout } from "../../core/bitableRecordLayout";
import { useEffect, useState } from "react";

type ConfigTab = "filter" | "sort" | "group" | "layout";

export interface MobileBitableViewConfigSheetProps {
  open: boolean;
  table: BitableTable;
  view: BitableView;
  layout: BitableResolvedRecordLayout;
  prefs: BitableRecordLayoutPrefs;
  /** 可选字段（视图可见、已排除标题）。 */
  cardFields: BitableField[];
  editable: boolean;
  onPatchPrefs: (patch: Partial<BitableRecordLayoutPrefs>) => void;
  /** 编辑态写视图配置（排序/分组写正文；只读态不传 ⇒ 面板保持只读说明）。 */
  onUpdateView?: (patch: Partial<BitableView>) => void;
  /** 打开时落在哪个页签（平板工具条 8 项直达筛选/分组/排序）。 */
  initialTab?: ConfigTab;
  onClose: () => void;
}

function filterSummary(view: BitableView): string {
  const count = view.filters?.length ?? 0;
  if (count === 0) return "暂无筛选条件";
  return "已有 " + count + " 组筛选条件";
}

function sortSummary(view: BitableView): string {
  const count = view.sorts?.length ?? 0;
  if (count === 0) return "暂无排序规则";
  return "已有 " + count + " 条排序规则";
}

export function MobileBitableViewConfigSheet({ open, table, view, layout, prefs, cardFields, editable, onPatchPrefs, onUpdateView, initialTab, onClose }: MobileBitableViewConfigSheetProps) {
  const [tab, setTab] = useState<ConfigTab>(initialTab ?? "layout");
  useEffect(() => { if (open) setTab(initialTab ?? "layout"); }, [open, initialTab]);

  const cardMode = layout.mode === "card";
  const shownIds = new Set(layout.fields.map((field) => field.id));
  const subtitleId = layout.subtitleField?.id ?? "";
  const titleId = layout.titleField?.id ?? "";

  /** 根筛选（扁平规则可编辑；嵌套分组只展示/删除——移动端不造第二套条件树 UI）。 */
  const filters: BitableFilterNode[] = view.filters ?? [];
  const writeFilters = (next: BitableFilterNode[], join: BitableFilterJoin = view.filterOperator ?? "and"): void => {
    onUpdateView?.({ filters: next, filterOperator: join });
  };
  const patchFilterAt = (index: number, next: BitableFilterNode): void => {
    writeFilters(filters.map((node, i) => (i === index ? next : node)));
  };
  const removeFilterAt = (index: number): void => {
    writeFilters(filters.filter((_, i) => i !== index));
  };
  const addFilterRule = (field: BitableField): void => {
    writeFilters([...filters, createBitableFilterRule(field)]);
  };
  const changeFilterOperator = (index: number, field: BitableField, operator: BitableFilterOperator): void => {
    const node = filters[index];
    if (!node || isBitableFilterGroup(node)) return;
    const valueKind = filterValueKindFor(field, operator);
    const next: BitableFilterRule = { id: node.id, fieldId: field.id, operator };
    const value = defaultFilterValueFor(field, operator);
    if (value !== undefined) next.value = value;
    if (valueKind === "date") next.valueMode = "custom" as BitableDateFilterMode;
    patchFilterAt(index, next);
  };

  return (
    <MobileSheet open={open} title="视图配置" onClose={onClose} bodyClassName="mbt-vcfg mb-sheet__body--form">
      <div className="mbt-vcfg-tabs" role="tablist" aria-label="视图配置">
        {([["filter", "筛选"], ["sort", "排序"], ["group", "分组"], ["layout", "布局"]] as Array<[ConfigTab, string]>).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            className={"mbt-vcfg-tab" + (tab === key ? " is-on" : "")} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "filter" && (
        editable && onUpdateView ? (
          <div className="mbt-vcfg-list">
            {filters.length >= 2 && (
              <div className="mbt-chips-row" role="group" aria-label="条件连接">
                {(["and", "or"] as BitableFilterJoin[]).map((join) => (
                  <button key={join} type="button" className={"mb-chip" + ((view.filterOperator ?? "and") === join ? " is-on" : "")}
                    onClick={() => writeFilters(filters, join)}>{join === "and" ? "且（全部满足）" : "或（任一满足）"}</button>
                ))}
              </div>
            )}
            {filters.length === 0 && <p className="mbt-vcfg-hint">暂无筛选条件：点下方字段添加一条。</p>}
            {filters.map((node, index) => {
              if (isBitableFilterGroup(node)) {
                return (
                  <div className="mbt-filter-rule" key={node.id ?? "group-" + index}>
                    <div className="mbt-filter-rule__head">
                      <span className="mbt-filter-rule__field">分组（{bitableFilterRuleCount(node.filters)} 条规则）</span>
                      <button type="button" className="mb-iconbtn mb-iconbtn--compact" aria-label="删除筛选分组"
                        onClick={() => removeFilterAt(index)}><X size={14} /></button>
                    </div>
                    <p className="mbt-vcfg-hint">嵌套分组请在桌面编辑；这里可以删除整组。</p>
                  </div>
                );
              }
              const field = table.fields.find((item) => item.id === node.fieldId);
              if (!field) {
                return <p className="mbt-vcfg-hint" key={node.id ?? "rule-" + index}>规则字段已不存在（{node.fieldId}）；可删除后重建。</p>;
              }
              const kind = filterValueKindFor(field, node.operator);
              const options = field.options ?? [];
              return (
                <div className="mbt-filter-rule" key={node.id ?? "rule-" + index}>
                  <div className="mbt-filter-rule__head">
                    <span className="mbt-filter-rule__field">{field.name}</span>
                    <button type="button" className="mb-iconbtn mb-iconbtn--compact" aria-label="删除筛选规则"
                      onClick={() => removeFilterAt(index)}><X size={14} /></button>
                  </div>
                  <div className="mbt-chips-row" role="group" aria-label="筛选操作符">
                    {filterOperatorsFor(field).map((operator) => (
                      <button key={operator} type="button" className={"mb-chip" + (node.operator === operator ? " is-on" : "")}
                        onClick={() => changeFilterOperator(index, field, operator)}>{filterOperatorLabel(field, operator)}</button>
                    ))}
                  </div>
                  {kind !== "none" && (
                    <div className="mbt-filter-value">
                      {kind === "text" || kind === "number" ? (
                        <div className="mb-input">
                          <input value={typeof node.value === "string" ? node.value : ""} inputMode={kind === "number" ? "decimal" : "text"}
                            placeholder="请输入" aria-label="筛选值" onChange={(event) => patchFilterAt(index, { ...node, value: event.target.value })} />
                        </div>
                      ) : kind === "boolean" ? (
                        <div className="mbt-chips-row" role="group" aria-label="布尔筛选值">
                          {[{ value: true, label: "已勾选" }, { value: false, label: "未勾选" }].map((option) => (
                            <button key={option.label} type="button" className={"mb-chip" + (node.value === option.value ? " is-on" : "")}
                              onClick={() => patchFilterAt(index, { ...node, value: option.value })}>{option.label}</button>
                          ))}
                        </div>
                      ) : kind === "date" ? (
                        <>
                          <div className="mbt-chips-row" role="group" aria-label="日期范围">
                            {dateFilterModesFor(node.operator).map((mode) => (
                              <button key={mode} type="button" className={"mb-chip" + ((node.valueMode ?? "custom") === mode ? " is-on" : "")}
                                onClick={() => patchFilterAt(index, { ...node, valueMode: mode, value: mode === "custom" ? "" : mode })}>
                                {BITABLE_DATE_FILTER_MODE_LABEL[mode]}
                              </button>
                            ))}
                          </div>
                          {(node.valueMode ?? "custom") === "custom" && (
                            <div className="mb-input">
                              <input type="date" aria-label="筛选日期" value={typeof node.value === "string" ? node.value : ""}
                                onChange={(event) => patchFilterAt(index, { ...node, valueMode: "custom", value: event.target.value })} />
                            </div>
                          )}
                        </>
                      ) : kind === "select" ? (
                        options.length > 0 ? (
                          <div className="mbt-chips-row" role="group" aria-label="选项筛选值">
                            {options.map((option) => (
                              <button key={option.id} type="button" className={"mb-chip" + (node.value === option.id ? " is-on" : "")}
                                onClick={() => patchFilterAt(index, { ...node, value: option.id })}>{option.name}</button>
                            ))}
                          </div>
                        ) : <p className="mbt-vcfg-hint">该字段暂无可选值。</p>
                      ) : kind === "multiSelect" ? (
                        isRelationFieldType(field.type) ? (
                          <p className="mbt-vcfg-hint">关联字段的筛选值请在桌面编辑。</p>
                        ) : options.length > 0 ? (
                          <div className="mbt-chips-row" role="group" aria-label="多选筛选值">
                            {options.map((option) => {
                              const current = Array.isArray(node.value) ? node.value : [];
                              const on = current.includes(option.id);
                              return (
                                <button key={option.id} type="button" className={"mb-chip" + (on ? " is-on" : "")}
                                  onClick={() => patchFilterAt(index, { ...node, value: on ? current.filter((item) => item !== option.id) : [...current, option.id] })}>
                                  {option.name}
                                </button>
                              );
                            })}
                          </div>
                        ) : <p className="mbt-vcfg-hint">该字段暂无可选值。</p>
                      ) : kind === "file" ? (
                        <p className="mbt-vcfg-hint">附件字段只支持「为空 / 非空」。</p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="mbt-vcfg-pick">
              <span className="mbt-vcfg-pick__k">筛选</span>
              <div className="mbt-chips-row">
                {table.fields.filter((field) => filterOperatorsFor(field).length > 0).map((field) => (
                  <button key={field.id} type="button" className="mb-chip" onClick={() => addFilterRule(field)}>+ {field.name}</button>
                ))}
              </div>
            </div>
            <p className="mbt-vcfg-hint">筛选写视图配置（随正文同步）；嵌套筛选分组请在桌面编辑。</p>
          </div>
        ) : (
          <div className="mbt-vcfg-empty">
            <p>{filterSummary(view)}</p>
            <p className="mbt-vcfg-hint">只读状态下不能修改筛选；请点右上角「编辑」或到桌面修改。</p>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" disabled>+ 筛选条件</button>
          </div>
        )
      )}

      {tab === "sort" && (
        editable && onUpdateView ? (
          <div className="mbt-vcfg-list">
            {(view.sorts ?? []).map((rule, index) => {
              const field = table.fields.find((item) => item.id === rule.fieldId);
              const modes = field ? sortModesForField(field) : (["asc", "desc"] as const);
              return (
                <div className="mbt-vcfg-rule" key={(rule.fieldId || "rule") + index}>
                  <span className="mbt-vcfg-rule__name">{field?.name ?? "未知字段"}</span>
                  <div className="mbt-vcfg-rule__modes">
                    {modes.map((mode) => (
                      <button key={mode} type="button" className={"mb-chip" + (sortModeOf(rule) === mode ? " is-on" : "")}
                        onClick={() => onUpdateView({ sorts: (view.sorts ?? []).map((item, i) => (i === index ? applySortMode(item, mode) : item)) })}>
                        {field ? sortModeLabel(field, mode) : BITABLE_SORT_MODE_LABEL[mode]}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="mb-iconbtn mb-iconbtn--compact" aria-label="删除排序"
                    onClick={() => onUpdateView({ sorts: (view.sorts ?? []).filter((_, i) => i !== index) })}>
                    <X size={14} />
                  </button>
                </div>
              );
            })}
            {(view.sorts?.length ?? 0) === 0 && <p className="mbt-vcfg-hint">暂无排序规则：点下方字段追加一条升序规则。</p>}
            <div className="mbt-vcfg-pick">
              <span className="mbt-vcfg-pick__k">排序</span>
              <div className="mbt-chips-row">
                {table.fields.map((field) => (
                  <button key={field.id} type="button" className="mb-chip"
                    onClick={() => onUpdateView({ sorts: [...(view.sorts ?? []), { fieldId: field.id }] })}>+ {field.name}</button>
                ))}
              </div>
            </div>
            <p className="mbt-vcfg-hint">排序写视图配置（随正文同步）；只读状态不可改。</p>
          </div>
        ) : (
          <div className="mbt-vcfg-empty">
            <p>{sortSummary(view)}</p>
            <p className="mbt-vcfg-hint">只读状态下不能修改排序；请点右上角「编辑」或到桌面修改。</p>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" disabled>+ 添加排序</button>
          </div>
        )
      )}

      {tab === "group" && (
        editable && onUpdateView ? (
          <div className="mbt-vcfg-list">
            {(view.groups?.length ?? 0) > 0 ? (
              <div className="mbt-vcfg-rule">
                <span className="mbt-vcfg-rule__name">{table.fields.find((item) => item.id === view.groups?.[0]?.fieldId)?.name ?? "未知字段"}</span>
                <button type="button" className="mb-iconbtn mb-iconbtn--compact" aria-label="取消分组"
                  onClick={() => onUpdateView({ groups: [] })}><X size={14} /></button>
              </div>
            ) : (
              <p className="mbt-vcfg-hint">暂无分组：点下方字段按它分组（只支持一级）。</p>
            )}
            <div className="mbt-vcfg-pick">
              <span className="mbt-vcfg-pick__k">分组</span>
              <div className="mbt-chips-row">
                {table.fields.map((field) => (
                  <button key={field.id} type="button" className={"mb-chip" + (view.groups?.[0]?.fieldId === field.id ? " is-on" : "")}
                    onClick={() => onUpdateView({ groups: [{ fieldId: field.id }] })}>{field.name}</button>
                ))}
              </div>
            </div>
            <p className="mbt-vcfg-hint">分组写视图配置（随正文同步）；只读状态不可改。</p>
          </div>
        ) : (
          <div className="mbt-vcfg-empty">
            <p>{(view.groups?.length ?? 0) === 0 ? "暂无分组" : "已按「" + (table.fields.find((item) => item.id === view.groups?.[0]?.fieldId)?.name ?? "未知字段") + "」分组"}</p>
            <p className="mbt-vcfg-hint">只读状态下不能修改分组；请点右上角「编辑」或到桌面修改。</p>
          </div>
        )
      )}

      {tab === "layout" && (
        <div className="mbt-vcfg-sections">
          <section className="mbt-vcfg-sect">
            <div className="mbt-vcfg-sect__title">记录展示方式</div>
            <div className="mbt-vcfg-tiles">
              <button type="button" className={"mbt-tile" + (cardMode ? " is-on" : "")} aria-pressed={cardMode}
                onClick={() => onPatchPrefs({ mode: "card" })}>
                <span className="mbt-tile__art mbt-tile__art--card" aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="mbt-tile__label">卡片</span>
              </button>
              <button type="button" className={"mbt-tile" + (!cardMode ? " is-on" : "")} aria-pressed={!cardMode}
                onClick={() => onPatchPrefs({ mode: "table" })}>
                <span className="mbt-tile__art mbt-tile__art--table" aria-hidden="true">
                  <i /><i /><i /><i /><i /><i />
                </span>
                <span className="mbt-tile__label">表格</span>
              </button>
            </div>
          </section>

          {cardMode && (
            <>
              <section className="mbt-vcfg-sect">
                <div className="mbt-vcfg-sect__title">封面设置</div>
                <div className="mbt-vcfg-row">
                  <div className="mbt-vcfg-row__main">
                    <div className="mbt-vcfg-row__t">显示封面</div>
                    <div className="mbt-vcfg-row__d">把附件字段里的第一张图显示为封面</div>
                  </div>
                  <button type="button" className={"mb-switch" + (layout.cover ? " is-on" : "")} role="switch"
                    aria-checked={layout.cover} aria-label="显示封面" onClick={() => onPatchPrefs({ cover: !layout.cover })}>
                    <span className="mb-switch__knob" />
                  </button>
                </div>
              </section>

              <section className="mbt-vcfg-sect">
                <div className="mbt-vcfg-sect__title">卡片布局方式</div>
                <div className="mbt-vcfg-cols">
                  {[1, 2].map((cols) => (
                    <button key={cols} type="button" className={"mbt-colbtn" + (layout.columns === cols ? " is-on" : "")}
                      aria-pressed={layout.columns === cols} onClick={() => onPatchPrefs({ columns: cols as 1 | 2 })}>
                      {cols} 列
                    </button>
                  ))}
                </div>
                <div className="mbt-vcfg-hint">3 列在手机上放不下，暂不提供。</div>
              </section>

              <section className="mbt-vcfg-sect">
                <div className="mbt-vcfg-sect__title">标题</div>
                <div className="mbt-vcfg-pick">
                  <span className="mbt-vcfg-pick__k">主标题</span>
                  <div className="mbt-chips-row">
                    {table.fields.map((field) => (
                      <button key={field.id} type="button" className={"mb-chip" + (field.id === titleId ? " is-on" : "")}
                        onClick={() => onPatchPrefs({ titleFieldId: field.id })}>{field.name}</button>
                    ))}
                  </div>
                </div>
                <div className="mbt-vcfg-pick">
                  <span className="mbt-vcfg-pick__k">副标题</span>
                  <div className="mbt-chips-row">
                    <button type="button" className={"mb-chip" + (!subtitleId ? " is-on" : "")}
                      onClick={() => onPatchPrefs({ subtitleFieldId: "" })}>不显示</button>
                    {table.fields.map((field) => (
                      <button key={field.id} type="button" className={"mb-chip" + (field.id === subtitleId ? " is-on" : "")}
                        onClick={() => onPatchPrefs({ subtitleFieldId: field.id })}>{field.name}</button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mbt-vcfg-sect">
                <div className="mbt-vcfg-sect__title">展示字段</div>
                <div className="mbt-vcfg-fields">
                  {cardFields.map((field) => {
                    const on = shownIds.has(field.id);
                    const isTitle = field.id === titleId;
                    const isSubtitle = field.id === subtitleId;
                    return (
                      <div key={field.id} className="mbt-vcfg-field">
                        <span className="mbt-vcfg-field__name">{field.name}</span>
                        {isTitle || isSubtitle
                          ? <span className="mbt-vcfg-field__tag">{isTitle ? "主标题" : "副标题"}</span>
                          : (
                            <button type="button" className={"mb-switch" + (on ? " is-on" : "")} role="switch" aria-checked={on}
                              aria-label={"展示 " + field.name} onClick={() => {
                                const base = prefs.fieldIds ?? layout.fields.map((item) => item.id);
                                const next = on ? base.filter((id) => id !== field.id) : [...base, field.id];
                                onPatchPrefs({ fieldIds: next });
                              }}><span className="mb-switch__knob" /></button>
                          )}
                      </div>
                    );
                  })}
                  {cardFields.length === 0 && <div className="mbt-vcfg-hint">没有可选字段。</div>}
                </div>
              </section>
            </>
          )}

          {!cardMode && <div className="mbt-vcfg-hint">表格布局与桌面一致；切到「卡片」可配置封面、列数与展示字段。</div>}
        </div>
      )}
    </MobileSheet>
  );
}

export default MobileBitableViewConfigSheet;
