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
 *
 * 261112 R1：实例创建/正文注入/视口闩锁/销毁已收口到
 * src/features/preview/useReadOnlyKernelViewer（mount="reveal-latch"）；本文件保留**答案特有**的三件事：
 * 内核登记（复制为 Lake）、ready 轮询、超时回退（父级继续用 MarkdownView）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LakeEditorInstance } from "../editor/lakeRuntime";
import { registerLakeKernel, unregisterLakeKernel } from "../ai/aiLakeKernelRegistry";
import type { LakePayloadKernel } from "../ai/aiLakeClipboard";
import { useReadOnlyKernelViewer } from "../preview/useReadOnlyKernelViewer";
import "./aiAnswerViewer.css";

/** 视口预挂载余量：提前这么多像素建实例，滚到时已渲染好。 */
const PREMOUNT_MARGIN_PX = 600;
/** 等内核出内容：轮询间隔 / 上限（超上限 = 视为渲染失败，父级保留 MarkdownView 兜底）。 */
const READY_POLL_MS = 80;
const READY_TIMEOUT_MS = 6000;
/** AI 答案没有活动文档编辑器：用固定 id 让内核解析正文里的资源（与编辑态互不影响）。 */
const ANSWER_NOTE_ID = "ai-writing-answer";

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
  const callbacksRef = useRef({ onReady, onError });
  callbacksRef.current = { onReady, onError };
  const [failed, setFailed] = useState(false);
  /** 已登记给「复制为 Lake」的内核（销毁/重建前撤销；拿不到就保持 null）。 */
  const registeredRef = useRef<LakePayloadKernel | null>(null);

  const registerKernel = useCallback((instance: LakeEditorInstance | null) => {
    if (registeredRef.current) {
      unregisterLakeKernel(registeredRef.current);
      registeredRef.current = null;
    }
    if (!instance) return;
    const kernel = instance.kernel as unknown as Partial<LakePayloadKernel> | undefined;
    if (kernel && typeof kernel.readData === "function" && typeof kernel.writeData === "function") {
      registeredRef.current = kernel as LakePayloadKernel;
      registerLakeKernel(registeredRef.current);
    }
  }, []);

  const { instance } = useReadOnlyKernelViewer({
    hostRef,
    /** 内容身份固定：同一答案的正文（流式/重渲染）只 setDocument，不重建内核。 */
    key: ANSWER_NOTE_ID,
    body: markdown,
    noteId: ANSWER_NOTE_ID,
    docType: "text/markdown",
    mount: "reveal-latch",
    revealRootMarginPx: PREMOUNT_MARGIN_PX,
    prefs: {
      disableNativeToc: true,
      // 本页滚动容器是 .aiw-scroll（不是内核默认视口）：必须关虚拟渲染，否则只画一屏。
      disableVirtualRendering: true,
      showToolbar: false,
      floatingToolbar: false,
      blockHandle: false,
    },
    onInstance: registerKernel,
    onError: (message) => {
      callbacksRef.current.onError?.(message);
      setFailed(true);
    },
  });

  // 正文：setDocument 由 useReadOnlyKernelViewer 统一完成；这里只等内核真的出内容再通知父级撤兜底。
  useEffect(() => {
    if (!instance || failed) return;
    const host = hostRef.current;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      callbacksRef.current.onReady?.();
    };
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
  }, [instance, markdown, failed]);

  return <div className="aiw-answer-viewer" ref={hostRef} data-ai-answer-viewer="1" />;
}

/** lazy() 的默认导出（React.lazy 只认 default）。 */
export default AiAnswerViewer;
