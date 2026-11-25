/**
 * 移动端提示条容器（形态口径参考：右上角滑入、点按关闭、error 带标记点；实现 = 自有 .mb-toast）。
 * 替换原 .mb-toast（居中黑色胶囊，无进出动效）。
 */
import { useEffect, useSyncExternalStore, useState } from "react";
import { X } from "lucide-react";
import { getToastSnapshot, hideToast, subscribeToasts, type ToastItem } from "./toastBus";
import { useLongPress } from "./useLongPress";

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
  // 先挂 is-hide（屏外），下一帧移除 → 滑入
  useEffect(() => {
    const el = document.getElementById("mb-sn-" + item.id);
    if (!el) return;
    const raf = requestAnimationFrame(() => el.classList.remove("is-hide"));
    return () => cancelAnimationFrame(raf);
  }, [item.id]);
  // 261205 A 方案（用户点单）：**悬停/长按看明细、可手动关、到时自动关**。
  // 悬停 = CSS :hover（平板/桌面指针）；触屏 = 长按钉住展开（松手后再点空白收起：再长按/关闭钮收）。
  const [pinnedDetail, setPinnedDetail] = useState(false);
  const longPress = useLongPress(() => setPinnedDetail((v) => !v), { ms: 350 });
  return (
    <div id={"mb-sn-" + item.id} data-id={item.id}
      className={"mb-toast is-hide" + (item.type === "error" ? " mb-toast--error" : "") + (pinnedDetail ? " is-detail" : "")}
      onClick={() => hideToast(item.id)}
      {...(item.detail ? longPress : {})}>
      <div className="mb-toast__text">{item.text}</div>
      {item.detail && <div className="mb-toast__detail">{item.detail}</div>}
      {/* 261119 B-8：关闭钮 28×28 < 44 ⇒ 挂 .mb-tap 补足命中区（视觉不变）；261205 起常驻（A 方案「可手动关闭」）。 */}
      <button className="mb-toast__close mb-tap" aria-label="关闭" onClick={(e) => { e.stopPropagation(); hideToast(item.id); }}><X size={16} /></button>
    </div>
  );
}
