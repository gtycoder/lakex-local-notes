/**
 * 移动端「修改字段」面板（261030 用户点单：对齐钉钉的触发与交互，设置项用我们桌面端已有的能力）。
 *
 * 交互：字段面板行内铅笔 → 本面板（标题 / 字段类型 / 该类型专属设置 / 必填 / 选项）→ 确认。
 * 设置项语义**逐项对齐桌面 FieldEditorModal**（不新增产品概念）：
 * - 默认值：文本/数字/链接=输入；日期=无/指定日期/添加记录当天三态；布尔=无/是/否；
 *   评分=无/1-5 星；进度=0-100 + 颜色；单选=无/选项。
 * - 选项：单选/多选可增删改名（id 保留，记录值不迁移）。
 * - 类型修改、关联配置、AI 命令、附件属性仍只在桌面端（移动端只显示说明，不做半截转换）。
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BITABLE_DATE_FORMAT_OPTIONS,
  BITABLE_FIELD_TYPE_LABEL,
  BITABLE_NUMBER_FORMAT_OPTIONS,
  BITABLE_OPTION_PALETTE,
  BITABLE_PROGRESS_MAX,
  BITABLE_RATING_MAX,
  fieldSupportsFormat,
  optionColorHex,
  type BitableField,
  type BitableFieldOption,
  type BitableFieldType,
} from "../../core/bitableDoc.js";
import type { BitableFieldConfigPatch } from "../../core/bitableMutations";
import { MobileSheet } from "../ui/MobileSheet";
import { MobileBitableDateField } from "./MobileBitableDateField";
import { dismissKeyboardOnPointerDown } from "../ui/dismissKeyboard";

const DEFAULT_TYPES = new Set(["text", "number", "link", "date", "boolean", "rating", "progress", "select"]);
const RELATION_TYPES = new Set(["relationOneWay", "relationTwoWay"]);
/** 移动端允许互转的目标类型（有数据时整体禁用；关联/AI/系统时间不在此列，需桌面配置）。 */
const CONVERTIBLE_TYPES: readonly BitableFieldType[] = ["text", "number", "date", "select", "multiSelect", "boolean", "link", "rating", "progress", "attachment", "image"];

export interface MobileBitableFieldEditorSheetProps {
  open: boolean;
  field: BitableField | null;
  /** 字段是否已有数据（有数据 ⇒ 禁止改类型；由 core `fieldHasData` 判定）。 */
  hasData: boolean;
  /** 第二个参数 = 要转成的类型（同类型时为 undefined）。 */
  onSave: (patch: BitableFieldConfigPatch, nextType?: string) => void;
  onClose: () => void;
}

export function MobileBitableFieldEditorSheet({ open, field, hasData, onSave, onClose }: MobileBitableFieldEditorSheetProps) {
  const [name, setName] = useState("");
  const [typeDraft, setTypeDraft] = useState<BitableFieldType>("text");
  const [format, setFormat] = useState("");
  const [required, setRequired] = useState(false);
  const [defaultText, setDefaultText] = useState("");
  const [dateMode, setDateMode] = useState<"none" | "fixed" | "created">("none");
  const [progressColor, setProgressColor] = useState<string | undefined>(undefined);
  const [options, setOptions] = useState<BitableFieldOption[]>([]);

  useEffect(() => {
    if (!open || !field) return;
    setName(field.name);
    setTypeDraft((field.type ?? "text") as BitableFieldType);
    setFormat(typeof field.format === "string" ? field.format : "");
    setRequired(field.required === true);
    setOptions(field.options ? field.options.map((option) => ({ ...option })) : []);
    setProgressColor(typeof field.progressColor === "string" ? field.progressColor : undefined);
    setDateMode(field.dateAutoFill === true ? "created" : (typeof field.defaultValue === "string" && field.defaultValue ? "fixed" : "none"));
    const raw = field.defaultValue;
    setDefaultText(raw === undefined || raw === null ? "" : String(raw));
  }, [open, field]);

  const type = typeDraft;
  const label = BITABLE_FIELD_TYPE_LABEL[type] ?? field?.type ?? "";
  const supportsDefault = DEFAULT_TYPES.has(type);
  const supportsOptions = type === "select" || type === "multiSelect";
  const isProgress = type === "progress";
  const optionChoices = useMemo(() => options.map((option) => ({ id: option.id, name: option.name || "未命名选项" })), [options]);

  const addOption = () => {
    setOptions((prev) => [...prev, { id: "opt" + Math.random().toString(36).slice(2, 12), name: "", color: BITABLE_OPTION_PALETTE[prev.length % BITABLE_OPTION_PALETTE.length] }]);
  };
  const commitOptionName = (id: string, value: string) => {
    setOptions((prev) => prev.map((option) => (option.id === id ? { ...option, name: value } : option)));
  };
  const removeOption = (id: string) => {
    setOptions((prev) => prev.filter((option) => option.id !== id));
    if (defaultText === id) setDefaultText("");
  };

  const save = () => {
    if (!field) return;
    const patch: BitableFieldConfigPatch = { name: name.trim() || field.name, required };
    if (supportsOptions) {
      patch.options = options.map((option, index) => ({ ...option, name: option.name.trim() || "选项 " + (index + 1) }));
    }
    if (supportsDefault) {
      let value: unknown;
      if (typeDraft === "date") value = dateMode === "fixed" && defaultText ? defaultText : undefined;
      else if (typeDraft === "boolean") value = defaultText === "true" ? true : defaultText === "false" ? false : undefined;
      else if (typeDraft === "number") value = defaultText === "" ? undefined : Number(defaultText);
      else if (typeDraft === "rating") value = defaultText === "" ? undefined : Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(Number(defaultText))));
      else if (typeDraft === "progress") value = defaultText === "" ? undefined : Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(Number(defaultText))));
      else value = defaultText === "" ? undefined : defaultText;
      patch.defaultValue = value;
      if (typeDraft === "date") patch.dateAutoFill = dateMode === "created" ? true : undefined;
    }
    if (isProgress) patch.progressColor = progressColor;
    if (fieldSupportsFormat(typeDraft)) {
      if (format) patch.format = format;
      else patch.format = undefined;
    } else if (typeof field.format === "string" && field.format) {
      patch.format = undefined;
    }
    onSave(patch, typeDraft !== field.type ? typeDraft : undefined);
  };

  if (!open || !field) return null;
  return (
    <MobileSheet open={open} title="修改字段" onClose={onClose}
      footer={
        <div className="mbt-feditor-foot">
          <button type="button" className="mb-btn mb-btn--secondary" onClick={onClose}>取消</button>
          <button type="button" className="mb-btn mb-btn--primary" onClick={save}>确认</button>
        </div>
      }>
      <div className="mbt-feditor" onPointerDown={dismissKeyboardOnPointerDown}>
        <label className="mbt-feditor__field">
          <span className="mbt-feditor__label">标题</span>
          <input className="mbt-form-input" value={name} aria-label="字段标题"
            onChange={(event) => setName(event.target.value)} />
        </label>

        {hasData ? (
          <>
            <div className="mbt-feditor__row">
              <span className="mbt-feditor__label">字段类型</span>
              <span className="mbt-feditor__value">{label}</span>
            </div>
            <div className="mbt-feditor__note">该字段已有数据，不能修改类型（把该列的值清空后才能转）。</div>
          </>
        ) : (
          <div className="mbt-feditor__section">
            <div className="mbt-feditor__label">字段类型（没有数据时可以互转）</div>
            <div className="mbt-feditor__choices">
              {CONVERTIBLE_TYPES.map((candidate) => (
                <button key={candidate} type="button" aria-pressed={typeDraft === candidate}
                  className={"mbt-feditor__choice" + (typeDraft === candidate ? " is-on" : "")}
                  onClick={() => {
                    if (candidate === typeDraft) return;
                    setTypeDraft(candidate);
                    if (candidate === field.type) {
                      // 切回原类型：恢复原配置（否则「手滑切走后切回」会把选项/默认值全清空并写回）。
                      setOptions(field.options ? field.options.map((option) => ({ ...option })) : []);
                      setProgressColor(typeof field.progressColor === "string" ? field.progressColor : undefined);
                      setDateMode(field.dateAutoFill === true ? "created" : (typeof field.defaultValue === "string" && field.defaultValue ? "fixed" : "none"));
                      setDefaultText(field.defaultValue == null ? "" : String(field.defaultValue));
                      setFormat(typeof field.format === "string" ? field.format : "");
                      return;
                    }
                    // 换类型 = 按新类型重建字段：旧类型的默认值/选项/格式草稿必须清掉，否则会把旧值带进新字段。
                    setDefaultText("");
                    setDateMode("none");
                    setProgressColor(undefined);
                    setOptions([]);
                    setFormat("");
                  }}>{BITABLE_FIELD_TYPE_LABEL[candidate]}</button>
              ))}
            </div>
            {typeDraft !== field.type && <div className="mbt-feditor__note">转换会按新类型重建字段，旧类型的配置（选项/默认值等）会清掉。</div>}
          </div>
        )}

        {fieldSupportsFormat(typeDraft) && (
          <div className="mbt-feditor__section">
            <div className="mbt-feditor__label">显示格式</div>
            <div className="mbt-feditor__choices">
              {(typeDraft === "date" ? BITABLE_DATE_FORMAT_OPTIONS : BITABLE_NUMBER_FORMAT_OPTIONS).map((option) => (
                <button key={option.value} type="button" aria-pressed={format === option.value}
                  className={"mbt-feditor__choice" + (format === option.value ? " is-on" : "")}
                  onClick={() => setFormat(option.value)}>{option.label}</button>
              ))}
            </div>
          </div>
        )}

        {supportsOptions && (
          <div className="mbt-feditor__section">
            <div className="mbt-feditor__label">选项</div>
            <div className="mbt-feditor__options">
              {options.map((option, index) => (
                <div key={option.id} className="mbt-feditor__option">
                  <span className="mbt-feditor__swatch" style={optionColorHex(option.color) ? { background: optionColorHex(option.color) } : undefined} aria-hidden="true" />
                  <input className="mbt-form-input" value={option.name} placeholder={"选项 " + (index + 1)} aria-label={"选项 " + (index + 1)}
                    onChange={(event) => commitOptionName(option.id, event.target.value)} />
                  <button type="button" className="mb-iconbtn" aria-label={"删除选项 " + (option.name || index + 1)} onClick={() => removeOption(option.id)}><Trash2 size={16} /></button>
                </div>
              ))}
              <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={addOption}><Plus size={14} />添加选项</button>
            </div>
          </div>
        )}

        {supportsDefault && (
          <div className="mbt-feditor__section">
            <div className="mbt-feditor__label">默认值（新建记录时预填）</div>
            {type === "date" ? (
              <div className="mbt-feditor__stack">
                {([["none", "无"], ["fixed", "指定日期"], ["created", "添加记录当天"]] as const).map(([value, text]) => (
                  <button key={value} type="button" className={"mbt-feditor__choice" + (dateMode === value ? " is-on" : "")}
                    aria-pressed={dateMode === value} onClick={() => setDateMode(value)}>{text}</button>
                ))}
                {dateMode === "fixed" && (
                  <MobileBitableDateField value={defaultText} ariaLabel="默认日期" onChange={(next) => setDefaultText(next)} />
                )}
              </div>
            ) : type === "boolean" ? (
              <div className="mbt-feditor__choices">
                {[["", "无"], ["true", "是"], ["false", "否"]].map(([value, text]) => (
                  <button key={value} type="button" className={"mbt-feditor__choice" + (defaultText === value ? " is-on" : "")}
                    aria-pressed={defaultText === value} onClick={() => setDefaultText(value)}>{text}</button>
                ))}
              </div>
            ) : type === "select" ? (
              <div className="mbt-feditor__choices">
                <button type="button" className={"mbt-feditor__choice" + (defaultText === "" ? " is-on" : "")} onClick={() => setDefaultText("")}>无</button>
                {optionChoices.map((option) => (
                  <button key={option.id} type="button" className={"mbt-feditor__choice" + (defaultText === option.id ? " is-on" : "")}
                    aria-pressed={defaultText === option.id} onClick={() => setDefaultText(option.id)}>{option.name}</button>
                ))}
              </div>
            ) : type === "rating" ? (
              <div className="mbt-feditor__choices">
                <button type="button" className={"mbt-feditor__choice" + (defaultText === "" ? " is-on" : "")} onClick={() => setDefaultText("")}>无</button>
                {[1, 2, 3, 4, 5].map((stars) => (
                  <button key={stars} type="button" className={"mbt-feditor__choice" + (defaultText === String(stars) ? " is-on" : "")}
                    aria-pressed={defaultText === String(stars)} onClick={() => setDefaultText(String(stars))}>{stars} 星</button>
                ))}
              </div>
            ) : type === "progress" ? (
              <div className="mbt-feditor__stack">
                <input className="mbt-form-input" inputMode="numeric" value={defaultText} aria-label="进度默认值" placeholder="0-100"
                  onChange={(event) => setDefaultText(event.target.value.replace(/[^0-9]/g, ""))} />
                <div className="mbt-feditor__label">进度条颜色</div>
                <div className="mbt-feditor__colors">
                  <button type="button" className={"mbt-feditor__color" + (!progressColor ? " is-on" : "")} aria-label="默认颜色" onClick={() => setProgressColor(undefined)} />
                  {BITABLE_OPTION_PALETTE.slice(0, 8).map((color) => (
                    <button key={color} type="button" aria-label={"颜色 " + color}
                      className={"mbt-feditor__color" + (progressColor === color ? " is-on" : "")}
                      style={{ background: optionColorHex(color) ?? color }} onClick={() => setProgressColor(color)} />
                  ))}
                </div>
              </div>
            ) : (
              <input className="mbt-form-input" type={type === "number" ? "number" : "text"} value={defaultText} aria-label="默认值"
                placeholder={type === "link" ? "https://" : undefined}
                onChange={(event) => setDefaultText(event.target.value)} />
            )}
          </div>
        )}

        <div className="mbt-feditor__row">
          <span className="mbt-feditor__label">必填</span>
          <button type="button" className="mb-switch" role="switch" aria-checked={required} aria-label="必填"
            onClick={() => setRequired((on) => !on)}><span className="mb-switch__knob" /></button>
        </div>

        {!supportsDefault && !supportsOptions && (
          <div className="mbt-feditor__note">
            {RELATION_TYPES.has(type) ? "关联字段的目标表/视图/是否多选请在桌面端修改。" : "这类字段的更多配置请在桌面端修改（附件/图片属性、AI 命令等）。"}
          </div>
        )}
      </div>
    </MobileSheet>
  );
}

export default MobileBitableFieldEditorSheet;
