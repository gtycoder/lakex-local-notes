/**
 * 移动端确认框（思源 .b3-dialog 口径：scrim opacity 150ms linear + 容器 scale(.8)→none / 150ms cubic-bezier(0,0,.2,1)）。
 * 目的：替换 window.confirm —— 安卓上弹的是系统对话框，风格断裂且无法标危险色。
 * 用法：const ok = await confirmMobile({ title, body, confirmText, danger: true });
 *       <ConfirmHost/> 挂在 App 根部（与 Toasts 同级）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pushBackHandler } from "./backStack";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮走 --b3-theme-error */
  danger?: boolean;
}
interface Pending extends ConfirmOptions { id: number; resolve: (ok: boolean) => void; }

let seq = 0;
let version = 0;
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((l) => l()); };

/** 稳定快照：内容未变时返回同一引用（useSyncExternalStore 要求） */
let cacheVersion = -1;
let cacheValue: Pending | null = null;
function snapshot(): Pending | null {
  if (cacheVersion !== version) { cacheVersion = version; cacheValue = pending; }
  return cacheValue;
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function confirmMobile(opts: ConfirmOptions): Promise<boolean> {
  if (pending) { const prev = pending; pending = null; prev.resolve(false); }
  return new Promise<boolean>((resolve) => { pending = { ...opts, id: ++seq, resolve }; emit(); });
}
function settle(ok: boolean) { const p = pending; pending = null; if (p) p.resolve(ok); emit(); }

export function ConfirmHost() {
  const req = useSyncExternalStoreLite();
  const [shown, setShown] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!req) { setShown(false); return; }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [req]);

  const close = useCallback((ok: boolean) => {
    setShown(false);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; settle(ok); }, 150);
  }, []);

  useEffect(() => { if (!req) return; return pushBackHandler(() => { close(false); return true; }); }, [req, close]);

  if (!req) return null;
  return (
    <div className={"b3-dialog" + (shown ? " b3-dialog--open" : "")}>
      <div className="b3-dialog__scrim" data-prevent-swipe onClick={() => close(false)} />
      <div className="b3-dialog__container ln-confirm" role="alertdialog" aria-label={req.title} data-prevent-swipe>
        <div className="b3-dialog__header">{req.title}</div>
        {req.body && <div className="b3-dialog__content">{req.body}</div>}
        <div className="b3-dialog__action">
          <button className="ln-btn ln-btn--secondary" onClick={() => close(false)}>{req.cancelText ?? "取消"}</button>
          <div className="fn__space" />
          <button className={"ln-btn ln-btn--primary" + (req.danger ? " ln-btn--danger" : "")} onClick={() => close(true)}>{req.confirmText ?? "确定"}</button>
        </div>
      </div>
    </div>
  );
}

function useSyncExternalStoreLite(): Pending | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
