/**
 * 多维表「编辑字段」弹窗（261112 R1-S2：从 BitableEditor.tsx 原样搬出；原本已是独立组件）。
 * 纯搬移：props / 分支 / 交互零变化。
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../../components/ui/Overlay";
import { ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react";
import type { BitableAiConfig, BitableField, BitableFieldType, BitableRelation, BitableTable } from "../../core/bitableDoc.js";
import { BITABLE_DATE_FORMAT_OPTIONS, BITABLE_DEFAULT_OPTION_COLOR, BITABLE_FIELD_TYPE_LABEL, BITABLE_NUMBER_FORMAT_OPTIONS, BITABLE_OPTION_COLORS, BITABLE_PROGRESS_MAX, BITABLE_RATING_MAX, aiPromptFieldNames, isKnownFieldType, isRelationFieldType, newBitableId, optionColorHex } from "../../core/bitableDoc.js";
import { fieldHasData } from "../../core/bitableMutations.js";
import { ColorPalette, DatePicker, FieldTypeIcon, FieldTypeSelect, Popover, SelectMenu } from "./bitableCells.js";
import { moveItem } from "./bitableEditorModel";
interface FieldEditorModalProps {
  field: BitableField | null;
  readOnly: boolean;
  /** 同一文档的全部数据表（关联字段选目标表用）。 */
  tables: BitableTable[];
  /** 当前数据表 id（关联不允许指向自己，故从候选里排除）。 */
  tableId: string;
  onClose: () => void;
  onSave: (patch: Partial<BitableField>, options?: BitableField["options"]) => void;
  onDelete: () => void;
  onAddField: (patch: { name: string; type: string; required?: boolean; options?: BitableField["options"]; defaultValue?: unknown; dateAutoFill?: boolean; progressColor?: string; relation?: BitableRelation; ai?: BitableAiConfig; format?: string }) => void;
}

export function FieldEditorModal({ field, readOnly, tables, tableId, onClose, onSave, onDelete, onAddField }: FieldEditorModalProps) {
  const isNew = field === null;
  /** 有数据 ⇒ 不允许改字段类型（用户 261030：有数据不能互转；没数据才能转）。 */
  const dataTable = tables.find((table) => table.id === tableId);
  const hasData = !isNew && field && dataTable ? fieldHasData(dataTable, field.id) : false;
  const [name, setName] = useState(field?.name ?? "");
  const [format, setFormat] = useState<string>(typeof field?.format === "string" ? field.format : "");
  const [type, setType] = useState<string>(field?.type ?? "text");
  const [required, setRequired] = useState<boolean>(field?.required ?? false);
  const [options, setOptions] = useState(field?.options ?? []);
  const [optionDragId, setOptionDragId] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<{ optionId: string; anchor: HTMLElement } | null>(null);
  /** 进度字段的颜色配置（调色板；缺省走主题强调色）。 */
  const [progressColor, setProgressColor] = useState<string | undefined>(typeof field?.progressColor === "string" ? field.progressColor : undefined);
  const [progressColorAnchor, setProgressColorAnchor] = useState<HTMLElement | null>(null);
  const [defaultValue, setDefaultValue] = useState<string>(
    typeof field?.defaultValue === "string" || typeof field?.defaultValue === "number" ? String(field.defaultValue) : "",
  );
  /** 日期字段的默认值形态（对齐云端）：无 / 指定时间（挑一个日期）/ 添加记录时间（自动填创建日）。 */
  const [dateMode, setDateMode] = useState<"none" | "fixed" | "created">(
    field?.dateAutoFill === true ? "created" : (typeof field?.defaultValue === "string" && field.defaultValue ? "fixed" : "none"),
  );
  /** 关联字段配置（T02B.1/T02B.3）：目标表 + 是否允许多个记录 + 单向/双向。 */
  const [relationTableId, setRelationTableId] = useState<string>(typeof field?.relation?.tableId === "string" ? field.relation.tableId : "");
  const [relationAllowMultiple, setRelationAllowMultiple] = useState<boolean>(field?.relation?.allowMultiple !== false);
  /** **数据范围**（260929 用户追加）：勾选 = 绑定目标表的一个视图；不勾选 = 从目标表全部记录里选。 */
  const [relationViewId, setRelationViewId] = useState<string>(typeof field?.relation?.viewId === "string" ? field.relation.viewId : "");
  const relationTarget = tables.find((table) => table.id === relationTableId);
  const relationViews = relationTarget?.views ?? [];
  /** AI 字段配置（261003）：命令里用「插入字段」插入 `{{字段名}}` 变量（可多个；生成时**原位替换**）。 */
  const [aiPrompt, setAiPrompt] = useState(typeof field?.ai?.prompt === "string" ? field.ai.prompt : "");
  /** 多模态（261006）：把被引用字段里的图片 / PDF 作为内容块一并发送（缺省关闭）。 */
  const [aiIncludeAttachments, setAiIncludeAttachments] = useState<boolean>(field?.ai?.includeAttachments === true);
  const [aiInsertAnchor, setAiInsertAnchor] = useState<HTMLElement | null>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement>(null);
  const isAi = type === "ai";
  const aiRefCandidates = (tables.find((table) => table.id === tableId)?.fields ?? []).filter((candidate) => candidate.id !== field?.id);
  const aiTokenNames = aiPromptFieldNames(aiPrompt);
  const aiCandidateNames = new Set(aiRefCandidates.map((candidate) => candidate.name));
  const aiMissingNames = aiTokenNames.filter((name) => !aiCandidateNames.has(name));
  /** 把 `{{字段名}}` 插到命令的**光标处**（可多次插入多个字段）；插完把光标移到变量之后。 */
  const insertAiToken = (name: string) => {
    const token = "{{" + name + "}}";
    const el = aiPromptRef.current;
    const start = el ? el.selectionStart : aiPrompt.length;
    const end = el ? el.selectionEnd : aiPrompt.length;
    setAiPrompt(aiPrompt.slice(0, start) + token + aiPrompt.slice(end));
    requestAnimationFrame(() => {
      const node = aiPromptRef.current;
      if (node) { node.focus(); node.setSelectionRange(start + token.length, start + token.length); }
    });
  };
  const supportsOptions = type === "select" || type === "multiSelect";
  const knownType = isKnownFieldType(type) ? (type as BitableFieldType) : null;
  const isRelation = isRelationFieldType(type);
  /**
   * 选项编辑（用户口径）：**回车 = 当前选项编辑完成 → 切到下一个选项；已是最后一个才新建一个**。
   * ref map 让「切到下一个」能直接聚焦已存在的输入框；新建的则在 options 变化后的 effect 里聚焦。
   */
  const optionInputsRef = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusOptionRef = useRef<string | null>(null);
  const focusOptionInput = (id: string) => {
    const el = optionInputsRef.current.get(id);
    /** 只聚焦、**不 `select()`**（用户 260930 报的「添加时那块蓝色底色」就是自动全选画出来的系统选区；
        选项名不是「待覆盖的临时值」，没有全选的必要）。光标落末尾 = 与「鼠标点进这个输入框」完全一致。 */
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  };
  useEffect(() => {
    const id = pendingFocusOptionRef.current;
    if (!id) return;
    pendingFocusOptionRef.current = null;
    focusOptionInput(id);
  }, [options]);
  const addOptionRow = () => {
    const id = newBitableId("opt");
    pendingFocusOptionRef.current = id;
    /** 新选项**留空**：默认名只作 `placeholder`（保存时空名按位置兜底成「选项 N」）。
        原先预填「选项 N」再全选，屏幕上就是一块蓝底；留空后直接键入即选项名。 */
    setOptions((prev) => [...prev, { id, name: "", color: BITABLE_OPTION_COLORS[prev.length % BITABLE_OPTION_COLORS.length] }]);
  };
  const handleOptionKeyDown = (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || readOnly) return;
    event.preventDefault();
    const next = options[index + 1];
    if (next) focusOptionInput(next.id);
    else addOptionRow();
  };
  const parseDefault = (): unknown => {
    if (!knownType) return undefined;
    if (knownType === "number") return defaultValue === "" ? undefined : Number(defaultValue);
    if (knownType === "date") return dateMode === "fixed" && defaultValue !== "" ? defaultValue : undefined;
    if (knownType === "text" || knownType === "select" || knownType === "link") return defaultValue === "" ? undefined : defaultValue;
    if (knownType === "rating") return defaultValue === "" ? undefined : Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(Number(defaultValue))));
    if (knownType === "progress") return defaultValue === "" ? undefined : Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(Number(defaultValue))));
    if (knownType === "boolean") return defaultValue === "true" ? true : defaultValue === "false" ? false : undefined;
    return undefined;
  };
  const save = () => {
    const fallbackName = BITABLE_FIELD_TYPE_LABEL[knownType ?? "text"];
    const nextDefault = parseDefault();
    const dateAutoFill = knownType === "date" && dateMode === "created" ? true : undefined;
    const nextColor = knownType === "progress" ? progressColor : undefined;
    // 关联配置：方向由字段类型决定（relationTwoWay 由 createRelationPair 建反向字段/写配对）；目标表未选则不写 tableId
    const relation: BitableRelation | undefined = isRelation ? {
      allowMultiple: relationAllowMultiple,
      ...(relationTableId ? { tableId: relationTableId } : {}),
      ...(relationTableId && relationViewId ? { viewId: relationViewId } : {}),
      ...(type === "relationTwoWay" && typeof field?.relation?.pairedFieldId === "string" ? { pairedFieldId: field.relation.pairedFieldId } : {}),
    } : undefined;
    // 选项名兜底：新加的行留空（placeholder 才是默认名），保存时空名按位置落成「选项 N」——
    // 不加行时 `options` 原样返回，不产生任何差异。
    const nextOptions = supportsOptions
      ? options.map((option, index) => ({ ...option, name: option.name.trim() || "选项 " + (index + 1) }))
      : undefined;
    // AI 配置（261003）：仅 AI 字段带（字段变量写在命令里，可多个）；切走类型时显式 undefined，清掉旧配置。
    const ai: BitableAiConfig | undefined = isAi
      ? { prompt: aiPrompt.trim(), ...(aiIncludeAttachments ? { includeAttachments: true } : {}) }
      : undefined;
    const nextFormat = knownType === "date" || knownType === "number" ? format : undefined;
    if (isNew) { onAddField({ name: name.trim() || fallbackName, type, required, options: nextOptions, defaultValue: nextDefault, dateAutoFill, progressColor: nextColor, relation, ai, format: nextFormat }); return; }
    onSave({ name: name.trim() || field!.name, type, required, defaultValue: nextDefault, dateAutoFill, progressColor: nextColor, relation: isRelation ? relation : undefined, ai, format: nextFormat }, nextOptions);
  };
  return (
    <Dialog open onDismiss={onClose} label={isNew ? "新增字段" : "编辑字段"} className="bt-dialog">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">{isNew ? "新增字段" : "编辑字段"}</h3></header>
      <div className="ln-dialog__body">
        <label className="bt-field-label"><span>字段名称</span>
          <input className="bt-input" autoFocus value={name} readOnly={readOnly} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="bt-field-label"><span>字段类型</span>
          <FieldTypeSelect value={type} disabled={readOnly || hasData} onPick={(next) => {
            if (next === type) return;
            setType(next);
            // 换类型按新类型重建：旧类型的默认值/选项/颜色/格式不能带过去（261030 review）。
            setDefaultValue("");
            setDateMode("none");
            setOptions([]);
            setProgressColor(undefined);
            setFormat("");
          }} />
        </div>
        {hasData && <div className="bt-field-note">该字段已有数据，不能修改类型（清空该列的值后才能转）。</div>}
        <label className="bt-field-check"><input type="checkbox" checked={required} disabled={readOnly} onChange={(event) => setRequired(event.target.checked)} />必填</label>
        {(knownType === "date" || knownType === "number") && (
          <label className="bt-field-label"><span>显示格式</span>
            <SelectMenu value={format} disabled={readOnly} placeholder="原样"
              onChange={setFormat}
              options={(knownType === "date" ? BITABLE_DATE_FORMAT_OPTIONS : BITABLE_NUMBER_FORMAT_OPTIONS).map((option) => ({ value: option.value, label: option.label }))} />
          </label>
        )}
        {(knownType === "text" || knownType === "number" || knownType === "date" || knownType === "select" || knownType === "link" || knownType === "boolean" || knownType === "rating" || knownType === "progress") && (
          <label className="bt-field-label"><span>默认值（新建记录时预填）</span>
            {knownType === "select" ? (
              <SelectMenu value={defaultValue} disabled={readOnly} onChange={setDefaultValue}
                options={[{ value: "", label: "（无）" }, ...options.map((option) => ({ value: option.id, label: option.name }))]} />
            ) : knownType === "date" ? (
              // 日期默认值三态（对齐云端）：无 / 指定时间 / 添加记录时间（新建记录时自动填当天）
              <div className="bt-date-default">
                <SelectMenu value={dateMode} disabled={readOnly} onChange={(value) => setDateMode(value as "none" | "fixed" | "created")}
                  options={[
                    { value: "none", label: "（无）" },
                    { value: "fixed", label: "指定时间（选择日期）" },
                    { value: "created", label: "添加记录时间（自动填创建日）" },
                  ]} />
                {dateMode === "fixed" && (
                  <DatePicker value={defaultValue} readOnly={readOnly} onChange={(value) => setDefaultValue(typeof value === "string" ? value : "")} />
                )}
              </div>
            ) : knownType === "boolean" ? (
              <SelectMenu value={defaultValue === "true" || defaultValue === "false" ? defaultValue : ""} disabled={readOnly} onChange={setDefaultValue}
                options={[{ value: "", label: "（无）" }, { value: "true", label: "是" }, { value: "false", label: "否" }]} />
            ) : knownType === "rating" ? (
              <SelectMenu value={defaultValue} disabled={readOnly} onChange={setDefaultValue}
                options={[{ value: "", label: "（无）" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n + " 星" }))]} />
            ) : knownType === "progress" ? (
              <div className="bt-date-default">
                <input className="bt-input" type="number" min={0} max={100} value={defaultValue} readOnly={readOnly} aria-label="进度默认值"
                  onChange={(event) => setDefaultValue(event.target.value)} />
                <button type="button" className="bt-select-trigger"
                  aria-label="选择进度条颜色" aria-haspopup="dialog" aria-expanded={Boolean(progressColorAnchor)} disabled={readOnly}
                  onClick={(event) => setProgressColorAnchor(event.currentTarget)}>
                  <span className="bt-color-square" style={{ backgroundColor: optionColorHex(progressColor) ?? BITABLE_DEFAULT_OPTION_COLOR }} />
                  <span className="bt-field-name ln-ellipsis">进度条颜色</span>
                  <ChevronDown size={14} />
                </button>
              </div>
            ) : (
              <input className="bt-input" type={knownType === "number" ? "number" : "text"} placeholder={knownType === "link" ? "https://" : undefined}
                value={defaultValue} readOnly={readOnly} onChange={(event) => setDefaultValue(event.target.value)} />
            )}
          </label>
        )}
        {isRelation && (
          <>
            <div className="bt-field-label"><span>关联数据表</span>
              {/* 已配对的双向字段不允许改目标表（改表会让对侧反向字段失去意义） */}
              <SelectMenu value={relationTableId} disabled={readOnly || !!field?.relation?.pairedFieldId}
                onChange={(value) => { setRelationTableId(value); setRelationViewId(""); }}
                placeholder="选择数据表"
                options={tables.filter((table) => table.id !== tableId).map((table) => ({ value: table.id, label: table.name }))} />
            </div>
            {/* 数据范围（对齐云端「从视图筛选记录」）：不勾选 = 全部记录；勾选 = 绑定目标表的一个视图 */}
            <label className="bt-field-check"><input type="checkbox" checked={relationViewId !== ""}
              disabled={readOnly || !relationTableId || relationViews.length === 0}
              onChange={(event) => setRelationViewId(event.target.checked ? (relationViews[0]?.id ?? "") : "")} />从视图筛选记录</label>
            {relationViewId !== "" && (
              <div className="bt-field-label"><span>关联视图</span>
                <SelectMenu value={relationViewId} disabled={readOnly} onChange={setRelationViewId}
                  placeholder="选择视图"
                  options={relationViews.map((view) => ({ value: view.id, label: view.name }))} />
              </div>
            )}
            <label className="bt-field-check"><input type="checkbox" checked={relationAllowMultiple} disabled={readOnly}
              onChange={(event) => setRelationAllowMultiple(event.target.checked)} />允许添加多个记录</label>
          </>
        )}
        {isAi && (
          <div className="bt-ai-config">
            <div className="bt-field-label"><span>命令（AI 按它生成内容；字段变量插在命令里）</span></div>
            <textarea ref={aiPromptRef} className="bt-input bt-ai-prompt" rows={4} value={aiPrompt} readOnly={readOnly}
              placeholder="例如：阅读{{附件}}，先写一段摘要，再列出核心要点"
              onChange={(event) => setAiPrompt(event.target.value)} />
            <button type="button" className="bt-secondary bt-ai-insert" disabled={readOnly}
              aria-haspopup="dialog" aria-expanded={Boolean(aiInsertAnchor)}
              onClick={(event) => setAiInsertAnchor(event.currentTarget)}>
              <Plus size={13} />插入字段<ChevronDown size={14} />
            </button>
            {aiInsertAnchor && (
              <Popover open anchor={aiInsertAnchor} onClose={() => setAiInsertAnchor(null)} width={220}>
                <div className="bt-panel">
                  {aiRefCandidates.length === 0 && <div className="bt-field-label-text">这张表里还没有其它字段可以引用</div>}
                  {aiRefCandidates.map((candidate) => (
                    <button key={candidate.id} type="button" className="bt-menu-item ln-menu__item"
                      onClick={() => { insertAiToken(candidate.name); setAiInsertAnchor(null); }}>
                      <FieldTypeIcon type={candidate.type} size={13} /><span className="bt-menu-label ln-ellipsis">{candidate.name}</span>
                    </button>
                  ))}
                </div>
              </Popover>
            )}
            <label className="bt-field-check"><input type="checkbox" checked={aiIncludeAttachments} disabled={readOnly}
              onChange={(event) => setAiIncludeAttachments(event.target.checked)} />把引用的图片 / PDF 一起发送给 AI</label>
            {aiIncludeAttachments && (
              <div className="bt-field-label-text">图片直接发送；PDF 抽取文字后发送（当前只支持 PDF）；其余附件仍只发文件名。</div>
            )}
            <div className="bt-field-label-text">
              {aiTokenNames.length === 0
                ? "还没有插入字段：请用「插入字段」把要参考的字段插入到命令里（单元格才会出现「AI 生成」）。"
                : "已插入 " + aiTokenNames.length + " 个字段；生成时 " + "{{字段名}}" + " 会原位替换为当前行该字段的值。"}
              {aiMissingNames.length > 0 && (
                <>
                  {" "}
                  <span className="ln-tag ln-tag--error">未找到：{aiMissingNames.map((name) => "{{" + name + "}}").join("、")}（生成时按空处理）</span>
                </>
              )}
            </div>
          </div>
        )}
        {supportsOptions && (
          <div className="bt-options-editor">
            <span className="bt-field-label-text">选项</span>
            {options.map((option, index) => (
              <div key={option.id} className="bt-option-edit-row" draggable={!readOnly}
                onDragStart={() => setOptionDragId(option.id)}
                onDragOver={(event) => { event.preventDefault(); if (optionDragId && optionDragId !== option.id) setOptions(moveItem(options, optionDragId, option.id, (o) => o.id)); }}
                onDragEnd={() => setOptionDragId(null)}>
                <button type="button" className="bt-color-square" style={{ backgroundColor: optionColorHex(option.color) ?? BITABLE_DEFAULT_OPTION_COLOR }}
                  aria-label="选择颜色" disabled={readOnly}
                  onMouseEnter={(event) => { if (!readOnly) setColorFor({ optionId: option.id, anchor: event.currentTarget }); }}
                  onClick={(event) => setColorFor({ optionId: option.id, anchor: event.currentTarget })} />
                <input className="bt-input" value={option.name} readOnly={readOnly}
                  placeholder={"选项 " + (index + 1)}
                  ref={(el) => { if (el) optionInputsRef.current.set(option.id, el); else optionInputsRef.current.delete(option.id); }}
                  onKeyDown={(event) => handleOptionKeyDown(index, event)}
                  onChange={(event) => setOptions(options.map((o, i) => (i === index ? { ...o, name: event.target.value } : o)))} />
                <GripVertical size={13} className="bt-grip" />
                <button type="button" className="bt-icon-btn" title="删除选项" aria-label="删除选项" disabled={readOnly}
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}><Trash2 size={13} /></button>
              </div>
            ))}
            {colorFor && (
              <ColorPalette anchor={colorFor.anchor} value={options.find((o) => o.id === colorFor.optionId)?.color} recentKey="bitable-option"
                defaultLabel="无背景色" defaultKind="background"
                onPick={(color) => setOptions(options.map((o) => (o.id === colorFor.optionId ? { ...o, color } : o)))}
                onDefault={() => setOptions(options.map((o) => (o.id === colorFor.optionId ? { ...o, color: undefined } : o)))}
                onClose={() => setColorFor(null)} />
            )}
            <button type="button" className="bt-panel-add" disabled={readOnly} onClick={addOptionRow}><Plus size={14} />添加选项</button>
          </div>
        )}
        {/* 进度字段的颜色面板：它不属于「选项编辑器」（进度字段 supportsOptions=false）。
            此前被嵌在 options 块内 ⇒ 点色块永远打不开面板（260929-OPT 修复）。 */}
        {progressColorAnchor && (
          <ColorPalette anchor={progressColorAnchor} value={progressColor} recentKey="bitable-progress"
            defaultLabel="默认色" defaultKind="text"
            onPick={(color) => setProgressColor(color)}
            onDefault={() => setProgressColor(undefined)}
            onClose={() => setProgressColorAnchor(null)} />
        )}
      </div>
      <div className="ln-dialog__actions">
        {!isNew && <button type="button" className="bt-danger" disabled={readOnly} onClick={onDelete}><Trash2 size={13} />删除字段</button>}
        <span className="bt-toolbar-spacer" />
        <button type="button" className="bt-secondary" onClick={onClose}>取消</button>
        <button type="button" className="bt-primary" disabled={readOnly} onClick={save}>确定</button>
      </div>
    </Dialog>
  );
}
