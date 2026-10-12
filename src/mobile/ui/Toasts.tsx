/**
 * 移动端提示条容器（思源 .b3-snackbars 口径：右上角滑入、点按关闭、error 带 ❗）。
 * 替换原 .mb-toast（居中黑色胶囊，无进出动效）。
 */
import { useEffect, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { getToastSnapshot, hideToast, subscribeToasts, type ToastItem } from "./toastBus";

export function Toasts() {
  const items = useSyncExternalStore(subscribeToasts, getToastSnapshot, getToastSnapshot);
  if (items.length === 0) return null;
  return (
    <div className="mb-toast-host is-show" role="status" aria-live="polite">
      <div className="mb-flex1">
        {items.map((t) => <Snackbar key={t.id} item={t} />)}
      </div>
    </div>
  );
}

function Snackbar({ item }: { item: ToastItem }) {
  // 思源：先挂 --hide（屏外），下一帧移除 → 滑入
  useEffect(() => {
    const el = document.getElementById("mb-sn-" + item.id);
    if (!el) return;
    const raf = requestAnimationFrame(() => el.classList.remove("is-hide"));
    return () => cancelAnimationFrame(raf);
  }, [item.id]);
  return (
    <div id={"mb-sn-" + item.id} data-id={item.id}
      className={"mb-toast is-hide" + (item.type === "error" ? " mb-toast--error" : "")}
      onClick={() => hideToast(item.id)}>
      <div className="mb-toast__text">{item.text}</div>
      {item.timeout === 0 && <button className="mb-toast__close" aria-label="关闭" onClick={(e) => { e.stopPropagation(); hideToast(item.id); }}><X size={16} /></button>}
    </div>
  );
}
