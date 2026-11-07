/**
 * 底部弹窗操作条原语（261107 架构整理）：统一 `.mb-sheet__foot` + 取消/主操作按钮的 DOM 与禁用/忙态语义。
 *
 * 之前 18 个文件各写一遍同一段 JSX（连 class 名、busy 文案、disabled 组合都靠抄），
 * 改一处（例如 busy 文案、按钮顺序、danger 变体）要全仓找。这里只收口**标准两键/单键**形态；
 * 三键或需要自定义布局的浮层（签名板、表格表单、日期选择、资源清理）继续传 children 或保持原样。
 *
 * 纪律：不新增 CSS（继续用 kit.css 的 .mb-btn/.mb-sheet__foot）；不改变既有 aria/文案。
 */
import type { ReactNode } from "react";

export interface SheetFooterAction {
  label: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** 进行中：按钮禁用，label 换成 busyLabel（默认「处理中…」）。 */
  busy?: boolean;
  busyLabel?: string;
  /** 按钮变体：primary（默认）/ secondary（取消）/ danger（红底主按钮）。 */
  variant?: "primary" | "secondary" | "danger";
  /** 撑满剩余宽度（.mb-flex1；两键平分 / 三键布局时用）。 */
  grow?: boolean;
  /** 紧凑型（.mb-btn--sm）。 */
  compact?: boolean;
}

export interface SheetFooterProps {
  /** 次要操作（通常「取消」）；null/省略 = 不渲染。 */
  cancel?: SheetFooterAction | null;
  /** 主操作；null/省略 = 只有取消（或自定义 children）。 */
  confirm?: SheetFooterAction | null;
  /** 追加自定义按钮/布局（原样放进 .mb-sheet__foot）。 */
  children?: ReactNode;
  className?: string;
}

function actionClass(action: SheetFooterAction): string {
  const parts = ["mb-btn"];
  if (action.variant === "danger") parts.push("mb-btn--primary", "mb-btn--danger");
  else if (action.variant === "primary" || action.variant === undefined) parts.push("mb-btn--primary");
  else parts.push("mb-btn--secondary");
  if (action.grow) parts.push("mb-flex1");
  if (action.compact) parts.push("mb-btn--sm");
  return parts.join(" ");
}

function ActionButton({ action }: { action: SheetFooterAction }): ReactNode {
  const label = action.busy ? action.busyLabel ?? "处理中…" : action.label;
  return (
    <button
      type="button"
      className={actionClass(action)}
      disabled={action.disabled || action.busy}
      onClick={action.onClick}
    >{label}</button>
  );
}

export function SheetFooter({ cancel, confirm, children, className }: SheetFooterProps) {
  return (
    <div className={"mb-sheet__foot" + (className ? " " + className : "")}>
      {cancel ? <ActionButton action={{ ...cancel, variant: "secondary" }} /> : null}
      {children}
      {confirm ? <ActionButton action={{ ...confirm, variant: confirm.variant ?? "primary" }} /> : null}
    </div>
  );
}
