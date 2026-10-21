/**
 * 小记编辑器（QuickNoteComposer）的**按需加载 + 就绪通知**（261019）。
 *
 * 为什么不用 React.lazy + Suspense：lazy 即使在"分包已预取"的情况下也会先抛一次 fallback，
 * 冷启动后点「编辑小记 / 新建小记」必然闪一下加载页（用户实测：一闪而过）。
 * 这里改成自己的缓存 + 订阅：预取完成（模块已求值）后，打开写作卡**同一帧**就渲染真组件，零 fallback；
 * 没赶上预取时先画写作卡骨架，模块一到就换真组件（同样不走 Suspense）。
 *
 * 分包边界保持不变：本文件**不静态** import QuickNoteComposer（只 import type），
 * 内核仍只通过动态 import 进入（护栏 mobileLazyChunks.test.ts / composerPrewarm.test.ts）。
 */
import { useEffect, useState, type ComponentType } from "react";
import type { QuickNoteComposerProps } from "./QuickNoteComposer";
import { QuickNoteComposerSkeleton } from "./QuickNoteComposerSkeleton";

type ComposerComponent = ComponentType<QuickNoteComposerProps>;

let cached: ComposerComponent | null = null;
let pending: Promise<ComposerComponent> | null = null;
const listeners = new Set<() => void>();

/** 已求值的组件（预取完成后非 null）。 */
export function getQuickNoteComposerSync(): ComposerComponent | null {
  return cached;
}

/** 加载分包并缓存组件；重复调用共享同一个 Promise。 */
export function loadQuickNoteComposer(): Promise<ComposerComponent> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = import("./QuickNoteComposer").then((m) => {
      cached = m.QuickNoteComposer;
      for (const fn of listeners) fn();
      return cached;
    }).catch((err: unknown) => {
      // 失败不要把 rejected Promise 永久缓存：下次打开写作卡还能重试
      pending = null;
      throw err;
    });
  }
  return pending;
}

export function subscribeQuickNoteComposer(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}



/** 写作卡懒加载壳：预取过就同步渲染；没预取就先骨架、模块到了自动替换。 */
export function QuickNoteComposerLazy(props: QuickNoteComposerProps) {
  const [Comp, setComp] = useState<ComposerComponent | null>(() => getQuickNoteComposerSync());
  useEffect(() => subscribeQuickNoteComposer(() => setComp(() => getQuickNoteComposerSync())), []);
  useEffect(() => { if (!Comp) void loadQuickNoteComposer().catch(() => undefined); }, [Comp]);
  return Comp ? <Comp {...props} /> : <QuickNoteComposerSkeleton />;
}
