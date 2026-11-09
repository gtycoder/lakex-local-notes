/**
 * AI 写作 · 答案的**内核只读渲染**（语雀同款；lazy 边界，禁止从入口静态 import）。
 *
 * 为什么交给内核：AI 输出的 Markdown 覆盖标题/列表/任务清单/表格/引用/代码/公式，自研 MarkdownView
 * 只覆盖子集（公式、任务清单会退化）。语雀的消息正文正是「Markdown → Lakex 只读 viewer」，这里复用同一路径：
 * createLakeDocument(host, "viewer") + setDocument("text/markdown")（内核原生解析，不经过渡转换）。
 *
 * 两条内存约束：
 * 1. **懒挂载**：只给进入视口（提前 600px）的消息建实例，长会话未滚到的消息不占内核；
 * 2. **一个实例多次 setDocument**：正文变化只重设正文，不重建内核（销毁会塌高度、滚动跳动）。
 */
import { useEffect, useRef, useState } from "react";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance } from "../editor/lakeRuntime";
import "./aiAnswerViewer.css";

/** 视口预挂载余量：提前这么多像素建实例，滚到时已渲染好。 */
const PREMOUNT_MARGIN_PX = 600;
/** 等内核出内容：轮询间隔 / 上限（超上限 = 视为渲染失败，父级保留 MarkdownView 兜底）。 */
const READY_POLL_MS = 80;
const READY_TIMEOUT_MS = 6000;

/** 内核实例的 setDocument 运行时支持 text/markdown（导入流水线同款；类型面只暴露了 text/lake）。 */
type MarkdownSetDocument = { setDocument(type: "text/markdown", content: string): void };

export interface AiAnswerViewerProps {
  /** AI 输出的 Markdown 原文。 */
  markdown: string;
  /** 内核出内容后回调（父组件据此撤掉兜底 MarkdownView）。 */
  onReady?: () => void;
  /** 渲染失败（父组件保留兜底 MarkdownView）。 */
  onError?: (message: string) => void;
}

export function AiAnswerViewer({ markdown, onReady, onError }: AiAnswerViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const callbacksRef = useRef({ onReady, onError });
  callbacksRef.current = { onReady, onError };
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  // 懒挂载：进入视口才建内核实例（没有 IntersectionObserver 的环境直接挂）。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") { setMounted(true); return; }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) setMounted(true); },
      { rootMargin: PREMOUNT_MARGIN_PX + "px 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // 建实例（只随 mounted 一次）。
  useEffect(() => {
    if (!mounted) return;
    const host = hostRef.current;
    if (!host) return;
    try {
      editorRef.current = createLakeDocument(host, "viewer", () => {}, false, "ai-writing-answer", null, {
        disableNativeToc: true,
        // 本页滚动容器是 .aiw-scroll（不是内核默认视口）：必须关虚拟渲染，否则只画一屏。
        disableVirtualRendering: true,
        showToolbar: false,
        floatingToolbar: false,
        blockHandle: false,
      });
    } catch (error) {
      callbacksRef.current.onError?.(error instanceof Error ? error.message : String(error));
      setFailed(true);
    }
    return () => {
      destroyLakeEditor(editorRef.current);
      editorRef.current = null;
    };
  }, [mounted]);

  // 正文：同一实例内 setDocument；等内核出内容后再通知父级撤兜底。
  useEffect(() => {
    if (!mounted || failed) return;
    const editor = editorRef.current;
    const host = hostRef.current;
    if (!editor || !host) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      callbacksRef.current.onReady?.();
    };
    try {
      (editor as unknown as MarkdownSetDocument).setDocument("text/markdown", markdown);
    } catch (error) {
      callbacksRef.current.onError?.(error instanceof Error ? error.message : String(error));
      setFailed(true);
      return;
    }
    const startedAt = Date.now();
    const poll = () => {
      const body = host.querySelector(".ne-viewer-body");
      if (body && (body.textContent ?? "").trim().length > 0) { finish(); return; }
      if (Date.now() - startedAt > READY_TIMEOUT_MS) {
        // 内核在合理时间内没出内容：明确失败（父级继续用 MarkdownView），不要让消息变白。
        settled = true;
        callbacksRef.current.onError?.("内核渲染超时（已回退到 Markdown 渲染）");
        setFailed(true);
        return;
      }
      timer = setTimeout(poll, READY_POLL_MS);
    };
    timer = setTimeout(poll, READY_POLL_MS);
    return () => { if (timer) clearTimeout(timer); };
  }, [mounted, markdown, failed]);

  return <div className="aiw-answer-viewer" ref={hostRef} data-ai-answer-viewer="1" />;
}

/** lazy() 的默认导出（React.lazy 只认 default）。 */
export default AiAnswerViewer;
