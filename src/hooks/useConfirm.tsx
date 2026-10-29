/**
 * 确认 / 提示浮层（261027 DT-02）：`window.confirm` / `window.alert` 的**唯一替代入口**。
 *
 * 为什么有它：Chromium 系统对话框会 ① **同步阻塞渲染线程**（自动保存/同步在途时整个主线程被 modal 卡住）；
 * ② 无危险色、无结构化文案，与自有设计系统脱节；③ 「彻底删除」这类不可逆动作说不清后果。
 * 这里把「Promise 化 + Overlay.Dialog 表面 + Esc/遮罩/关闭 = 取消」收敛成单一来源
 * （AGENTS §3#14：浮层表面只走 components/ui/Overlay.tsx，不要手写 createPortal）。
 *
 * 用法（await 之后才执行原逻辑，**不要**改成回调）：
 *   const { confirm, notice, confirmElement } = useConfirm();
 *   if (!(await confirm({ title: "彻底删除？", body: "…不可恢复。", confirmText: "彻底删除", danger: true }))) return;
 *   return <>{body}{confirmElement}</>;
 *
 * 约束：`confirmElement` 必须渲染在调用方 JSX 里（内部 portal 到 body，放哪不影响观感）；
 * 同一时刻只保留一个请求（后到者让前一个按「取消」收尾），与移动端 ConfirmHost 同口径。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "../components/ui/Overlay";

export interface ConfirmOptions {
  /** 标题（同时作对话框 aria-label）。 */
  title: string;
  /** 正文：不可逆动作**必须**写清后果（删了什么、能不能恢复）。 */
  body?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险动作：确认按钮走危险色（kit 的 .ln-btn--danger-text，与目录删除确认同一套）。 */
  danger?: boolean;
}

interface PendingRequest {
  options: ConfirmOptions;
  /** notice = 只有「知道了」一个按钮；点确认/遮罩/Esc 都按「已读」收尾。 */
  kind: "confirm" | "notice";
  resolve: (ok: boolean) => void;
}

export interface ConfirmController {
  /** 确认框：true = 用户点了确认。关闭/Esc/点遮罩都算取消（false）。 */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** 提示框（替代 window.alert）：带「知道了」的单按钮对话框，await 到用户读完为止。 */
  notice: (options: Omit<ConfirmOptions, "cancelText" | "danger">) => Promise<void>;
  /** 渲染到调用方 JSX 里的浮层元素。 */
  confirmElement: ReactNode;
}

export function useConfirm(): ConfirmController {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);

  /** 收尾：先摘 ref 再 resolve（resolve 回调里再次打开时不会读到旧请求）。 */
  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(ok);
  }, []);

  /** 打开：同一时刻只留一个；被顶掉的那个按「取消」收尾，避免留下看不见的悬空 Promise。 */
  const open = useCallback((kind: PendingRequest["kind"], options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false);
    const request = { kind, options, resolve };
    pendingRef.current = request;
    setPending(request);
  }), []);

  // 卸载时把在途请求按取消收尾（否则 await 方永远悬着）
  useEffect(() => () => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    current.resolve(false);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => open("confirm", options), [open]);
  const notice = useCallback(async (options: Omit<ConfirmOptions, "cancelText" | "danger">) => {
    await open("notice", options);
  }, [open]);

  const confirmElement = pending ? (
    <Dialog
      open
      onDismiss={() => settle(pending.kind === "notice")}
      label={pending.options.title}
      className="confirm-dialog"
    >
      <div className="ln-dialog__head"><span className="ln-dialog__title">{pending.options.title}</span></div>
      {pending.options.body !== undefined && <div className="ln-dialog__body">{pending.options.body}</div>}
      <div className="ln-dialog__actions">
        {pending.kind === "confirm" && (
          <button type="button" className="ln-btn ln-btn--ghost" onClick={() => settle(false)}>
            {pending.options.cancelText ?? "取消"}
          </button>
        )}
        <button
          type="button"
          className={"ln-btn ln-btn--secondary" + (pending.options.danger ? " ln-btn--danger-text" : "")}
          onClick={() => settle(true)}
        >
          {pending.options.confirmText ?? (pending.kind === "notice" ? "知道了" : "确定")}
        </button>
      </div>
    </Dialog>
  ) : null;

  return { confirm, notice, confirmElement };
}
