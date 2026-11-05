import { Suspense, useEffect, useState, type ReactNode } from "react";

/** 首次打开才加载，访问后保留表单状态；关闭时连同尚未完成的加载壳一起隐藏。 */
export function DeferredPanel({ open, fallback, children }: { open: boolean; fallback: ReactNode; children: ReactNode }) {
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  return open || visited ? <Suspense fallback={open ? fallback : null}>{children}</Suspense> : null;
}
