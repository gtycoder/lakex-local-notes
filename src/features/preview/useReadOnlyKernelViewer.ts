/**
 * 内核**只读 viewer** 的唯一宿主 hook（261112 审计 02 报告 §3.4；用户裁决 Q01）。
 *
 * 背景：同一件事（createLakeDocument(host,"viewer") + addAssetAccessToken + setDocument + destroy）
 * 被抄了 4 份（历史快照 / 小记卡片兜底 / AI 答案 / 「复制为 Lake」隐藏实例），各写一套生命周期与失败策略。
 * 其中两处已知坑是**漏一次就复发**的：忘 addAssetAccessToken → 图片 401；忘 disableVirtualRendering
 * → 正文只画一屏（小记 260919、AI 261023 各踩过一次）。收口到一个 hook 后这些只在调用方 prefs 里出现。
 *
 * 生命周期契约（与收口前的三处实现**逐条对齐**，护栏 src/features/preview/useReadOnlyKernelViewer.render.test.tsx）：
 * 1. **同 key 只 setDocument，不重建**（历史面板逐条点快照、AI 答案正文流式更新、小记正文晚到）；
 * 2. **换 key / 换文档 / 离开预览 / 卸载 ⇒ 销毁**（不把内核挂在没人看的节点上）；
 * 3. 正文一律经 addAssetAccessToken 注入渲染层令牌（绝不写回正文/模型）；
 * 4. mount="reveal-latch"：进入视口才创建、**进入一次后常驻**（261111 修「小记来回滚反复白屏」）；
 * 5. create 抛错只回调 onError，不抛给宿主（预览失败要退化成兜底视图，绝不能白屏/炸页面）。
 *
 * 明确不做：本 hook 不碰 DOM 语义（不绑点击/不接管交互）、不写 styles、不做数据获取（IPC/bridge 归调用方）。
 * LakeEditor / EditorTab 是**编辑器**（含锁/解锁交接、自愈等语义），不迁到本 hook（02 报告 §6「明确不做」）。
 */
import { useEffect, useRef, useState } from "react";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance, type LakeEditorPrefs } from "../editor/lakeRuntime";
import { addAssetAccessToken } from "../../lib/assetPort";
import type { ReadOnlyKernelMount } from "./types";

/** reveal-latch 的默认预挂载余量（小记卡片用 400；AI 答案传 600，沿用各自实测值）。 */
const DEFAULT_REVEAL_MARGIN_PX = 400;

/** 内核 setDocument 的正文形态：Lake 文档 / Markdown（AI 答案与导入流水线同款）。 */
export type ReadOnlyKernelDocType = "text/lake" | "text/markdown";

/**
 * 内核实例的 setDocument 运行时也支持 "text/markdown"（导入流水线与 AI 答案都在用），
 * 但 LakeEditorInstance 的类型面只暴露了 "text/lake" ⇒ 这里显式放宽，避免 any。
 */
type KernelSetDocument = { setDocument(type: ReadOnlyKernelDocType, content: string): void };

export interface ReadOnlyKernelViewerOptions {
  /** 挂载容器（内核会把 editor mount 塞进它的子节点）。 */
  hostRef: React.RefObject<HTMLElement | null>;
  /** 内容身份：变了就**重建**实例；同 key 的正文变化只 setDocument。null = 不渲染（销毁）。 */
  key: string | null;
  /** 正文；null = 不渲染（销毁）。 */
  body: string | null;
  /** 内核解析正文里的资源/卡片要用的 id（文档 id / 小记 id；AI 答案用固定 id）。 */
  noteId: string | null;
  /** 只读档 prefs（字号/禁用虚拟渲染/禁原生大纲等）。**实例创建时读取一次**：中途变化不重建（与收口前一致）。 */
  prefs?: Partial<LakeEditorPrefs>;
  /** 真实滚动容器（虚拟渲染/大纲定位用）；可传 getter，创建时求值。 */
  scrollNode?: HTMLElement | (() => HTMLElement | null) | null;
  /** 正文形态，默认 text/lake。 */
  docType?: ReadOnlyKernelDocType;
  /** 挂载策略，默认 keep-alive（见 types.ReadOnlyKernelMount）。 */
  mount?: ReadOnlyKernelMount;
  /** reveal-latch 的预挂载余量（px）。 */
  revealRootMarginPx?: number;
  /** 实例创建/销毁回调（AI 答案据此把内核登记进 aiLakeKernelRegistry）。 */
  onInstance?: (instance: LakeEditorInstance | null) => void;
  /** 失败回调（create 抛错 / setDocument 抛错）；调用方据此显示兜底视图。 */
  onError?: (message: string) => void;
}

export interface ReadOnlyKernelViewerState {
  /** 当前实例（未创建/已销毁为 null）。 */
  instance: LakeEditorInstance | null;
  /** reveal-latch 是否已进入视口（keep-alive 恒为 true）。 */
  revealed: boolean;
}

export function useReadOnlyKernelViewer(options: ReadOnlyKernelViewerOptions): ReadOnlyKernelViewerState {
  const {
    hostRef,
    key,
    body,
    noteId,
    docType = "text/lake",
    mount = "keep-alive",
    revealRootMarginPx = DEFAULT_REVEAL_MARGIN_PX,
  } = options;
  const [instance, setInstance] = useState<LakeEditorInstance | null>(null);
  const [revealed, setRevealed] = useState(mount !== "reveal-latch");
  /** 回调/配置走 ref：不参与 effect 依赖（否则每次渲染 prefs 新对象就销毁重建，比收口前更差）。 */
  const prefsRef = useRef(options.prefs);
  prefsRef.current = options.prefs;
  const scrollNodeRef = useRef(options.scrollNode);
  scrollNodeRef.current = options.scrollNode;
  const onInstanceRef = useRef(options.onInstance);
  onInstanceRef.current = options.onInstance;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const reportError = (reason: unknown): void => {
    onErrorRef.current?.(reason instanceof Error ? reason.message : String(reason));
  };

  // ① 视口闩锁（仅 reveal-latch）：进入一次常驻；没有 IntersectionObserver 的环境直接放行（老 WebView/测试）。
  useEffect(() => {
    if (mount !== "reveal-latch" || revealed) return;
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) setRevealed(true); },
      { rootMargin: revealRootMarginPx + "px 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef, mount, revealRootMarginPx, revealed]);

  const hasBody = body !== null;

  // ② 实例：revealed + 内容身份齐备才创建；依赖一变先跑 cleanup 销毁，再按新 key 重建。
  useEffect(() => {
    const host = hostRef.current;
    if (!revealed || !key || !host || noteId === null || !hasBody) return;
    let editor: LakeEditorInstance | null = null;
    try {
      const scrollNode = typeof scrollNodeRef.current === "function" ? scrollNodeRef.current() : scrollNodeRef.current;
      editor = createLakeDocument(host, "viewer", () => {}, false, noteId, scrollNode ?? undefined, prefsRef.current);
      setInstance(editor);
      onInstanceRef.current?.(editor);
    } catch (reason) {
      reportError(reason);
      return;
    }
    return () => {
      try { destroyLakeEditor(editor); } catch { /* 实例可能已被内核自己销毁 */ }
      setInstance(null);
      onInstanceRef.current?.(null);
    };
    // 只认「内容身份 + 宿主 + 是否可见」：body/回调/prefs 变化不重建（同 key 复用实例）。
  }, [hostRef, revealed, key, noteId, hasBody]);

  // ③ 正文：同一实例只 setDocument（切正文不重建内核）；初挂载与正文更新都走这一条。
  useEffect(() => {
    if (!instance || body === null) return;
    try {
      (instance as unknown as KernelSetDocument).setDocument(docType, addAssetAccessToken(body));
      instance.requestCardHydration?.();
    } catch (reason) {
      reportError(reason);
    }
  }, [instance, body, docType]);

  return { instance, revealed };
}
