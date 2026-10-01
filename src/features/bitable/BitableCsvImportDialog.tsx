import { Dialog } from "../../components/ui/Overlay";
import { SelectMenu } from "./bitableCells";
import type { BitableTable } from "../../core/bitableDoc";
import { csvImportSummary, type CsvColumnMapping, type CsvImportResult } from "../../core/bitableCsv";

export interface BitableCsvImportDialogProps {
  fileName: string;
  /** 目标数据表（提供已有字段作为映射候选）。 */
  table: BitableTable;
  /** CSV 表头列名。 */
  header: string[];
  /** 数据行（不含表头），仅用于显示行数/示例。 */
  rows: string[][];
  mapping: CsvColumnMapping[];
  /** 导入完成后的结果（非空即进入「结果」态）。 */
  result: CsvImportResult | null;
  onChange: (mapping: CsvColumnMapping[]) => void;
  onConfirm: () => void;
  onDone: () => void;
  onDismiss: () => void;
}

function encodeTarget(target: CsvColumnMapping["target"]): string {
  if (target.kind === "skip") return "skip";
  if (target.kind === "new") return "new:text";
  return "field:" + target.fieldId;
}
function decodeTarget(value: string): CsvColumnMapping["target"] {
  if (value === "new:text") return { kind: "new", type: "text" };
  if (value.startsWith("field:")) return { kind: "field", fieldId: value.slice("field:".length) };
  return { kind: "skip" };
}

/**
 * CSV 导入映射对话框（D01）：首行表头 → 每列选择目标字段（已有字段 / 新建文本字段 / 忽略）。
 * 导入后进入结果态，明确报告「新增 N / 丢弃 N 格 / 跳过 N 行」以及失败原因，绝不悄悄写坏值。
 * 全部复用既有对话框/选择器原语（不新增样式文件）。
 */
export function BitableCsvImportDialog({ fileName, table, header, rows, mapping, result, onChange, onConfirm, onDone, onDismiss }: BitableCsvImportDialogProps) {
  const options = [
    { value: "skip", label: "忽略此列" },
    ...table.fields.map((field) => ({ value: "field:" + field.id, label: field.name })),
    { value: "new:text", label: "新建文本字段" },
  ];
  const mapped = mapping.filter((m) => m.target.kind !== "skip").length;

  return (
    <Dialog open onDismiss={result ? onDone : onDismiss} label="导入 CSV" className="bt-dialog">
      <header className="ln-dialog__head"><h3 className="ln-dialog__title">导入 CSV（{fileName}）</h3></header>
      <div className="ln-dialog__body">
        {result ? (
          <>
            <div className="bt-field-label-text">{csvImportSummary(result)}</div>
            {result.issues.length > 0 && (
              <div className="bt-field-label-text">
                {result.issues.slice(0, 8).map((issue, index) => (
                  <div key={index}>第 {issue.row} 行「{issue.header || "空列名"}」：{issue.reason}</div>
                ))}
                {result.issues.length > 8 && <div>…另有 {result.issues.length - 8} 处</div>}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="bt-field-label-text">共 {header.length} 列 / {rows.length} 行数据。为每列选择目标字段（同名自动匹配，未匹配默认忽略）。</div>
            {header.map((name, column) => (
              <label className="bt-field-label" key={column}>
                <span className="bt-field-name ln-ellipsis" title={name}>{name || "（空列名）"}</span>
                <SelectMenu
                  value={encodeTarget(mapping[column]?.target ?? { kind: "skip" })}
                  onChange={(value) => onChange(mapping.map((m) => (m.column === column ? { ...m, target: decodeTarget(value) } : m)))}
                  options={options}
                />
              </label>
            ))}
          </>
        )}
      </div>
      <div className="ln-dialog__actions">
        {result ? (
          <>
            <span className="bt-toolbar-spacer" />
            <button type="button" className="bt-primary" onClick={onDone}>完成</button>
          </>
        ) : (
          <>
            <span className="bt-field-label-text">已映射 {mapped} 列</span>
            <span className="bt-toolbar-spacer" />
            <button type="button" className="bt-secondary" onClick={onDismiss}>取消</button>
            <button type="button" className="bt-primary" onClick={onConfirm}>导入</button>
          </>
        )}
      </div>
    </Dialog>
  );
}
