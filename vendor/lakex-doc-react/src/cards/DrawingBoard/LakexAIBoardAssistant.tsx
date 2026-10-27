import React from "react";
import { createPortal } from "react-dom";
import type { PlaitBoard, PlaitElement } from "@plait/core";
import type { DrawingBoardAIConfig } from "../../components/lakex/types";
import {
  buildAIBoardContextPrompt,
  countAIBoardContextNodes,
  convertAIBoardDocument,
  DRAWING_BOARD_AI_SYSTEM_PROMPT,
  parseAIBoardResponse,
  serializeBoardToAIContext,
} from "./aiBoardSchema";

type Locale = "zh-CN" | "en-US";
export type AIBoardApplyMode = "replace" | "append";

interface Props {
  ai?: DrawingBoardAIConfig;
  board: PlaitBoard | null;
  locale: Locale;
  dark: boolean;
  toolbarHost: Element | null;
  overlayHost: Element | null;
  onOpen?: () => void;
  onApply: (elements: PlaitElement[], mode: AIBoardApplyMode) => void;
}

const copy = {
  "zh-CN": {
    tooltip: "AI 画板助手",
    title: "AI 画板助手",
    description: "描述你想生成的图，AI 会创建可继续编辑的图形和连线。",
    placeholder:
      "例如：生成一个用户登录流程图，包含输入账号、校验密码、登录成功和失败重试，并标注判断分支。",
    replace: "替换当前画布",
    modify: "继续修改当前画布",
    append: "添加到当前画布",
    cancel: "取消",
    cancelGenerating: "取消生成",
    generate: "生成",
    generating: "正在生成…",
    shortcut: "⌘/Ctrl + Enter 生成",
    missing:
      "尚未配置 AI 服务。请通过 config.drawingBoardAI.generate 注入项目的模型调用。",
    empty: "请先输入图的详细描述。",
    invalid: "AI 返回的数据不符合画板 JSON 规范，请重试或让模型减少图形数量。",
    failed: "生成失败，请检查 AI 服务后重试。",
    success: "AI 图形已生成",
    memory: (count: number) => `已记忆 ${count} 条历史需求`,
    boardContext: (count: number) =>
      count ? `将基于当前画布的 ${count} 个图形继续生成` : "当前为空画布",
    resetMemory: "新对话",
  },
  "en-US": {
    tooltip: "AI board assistant",
    title: "AI board assistant",
    description:
      "Describe a diagram and AI will create editable shapes and connectors.",
    placeholder:
      "For example: Create a user login flowchart with credentials, password validation, success, and retry branches.",
    replace: "Replace canvas",
    modify: "Continue editing canvas",
    append: "Add to canvas",
    cancel: "Cancel",
    cancelGenerating: "Cancel generation",
    generate: "Generate",
    generating: "Generating…",
    shortcut: "⌘/Ctrl + Enter to generate",
    missing:
      "AI is not configured. Provide config.drawingBoardAI.generate from your application.",
    empty: "Describe the diagram first.",
    invalid:
      "The AI response does not match the board JSON specification. Please try again.",
    failed: "Generation failed. Check the AI service and try again.",
    success: "AI diagram generated",
    memory: (count: number) => `${count} remembered request${count === 1 ? "" : "s"}`,
    boardContext: (count: number) =>
      count
        ? `Continue from ${count} current canvas shape${count === 1 ? "" : "s"}`
        : "The current canvas is empty",
    resetMemory: "New conversation",
  },
} as const;

interface AIBoardToast {
  type: "success" | "error";
  message: string;
}

export default function LakexAIBoardAssistant({
  ai,
  board,
  locale,
  dark,
  toolbarHost,
  overlayHost,
  onOpen,
  onApply,
}: Props) {
  const t = copy[locale];
  const [open, setOpen] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [mode, setMode] = React.useState<AIBoardApplyMode>("replace");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [toast, setToast] = React.useState<AIBoardToast | null>(null);
  const [history, setHistory] = React.useState<string[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const requestRef = React.useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  const requestIdRef = React.useRef(0);
  const toastTimerRef = React.useRef<number | null>(null);

  const showToast = React.useCallback((next: AIBoardToast) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(next);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  const close = React.useCallback(() => {
    requestIdRef.current += 1;
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setLoading(false);
    setOpen(false);
    setError("");
  }, []);

  React.useEffect(
    () => () => {
      requestRef.current?.controller.abort();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() =>
      textareaRef.current?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close, open]);

  const generate = React.useCallback(async () => {
    const prompt = description.trim();
    if (!prompt) {
      setError(t.empty);
      textareaRef.current?.focus();
      return;
    }
    if (!ai) {
      setError(t.missing);
      return;
    }
    if (!board) {
      setError(t.failed);
      return;
    }

    setLoading(true);
    setError("");
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current?.controller.abort();
    requestRef.current = { id: requestId, controller };
    try {
      const currentBoard = serializeBoardToAIContext(board);
      const contextPrompt = buildAIBoardContextPrompt({
        description: prompt,
        history,
        currentBoard,
        mode,
      });
      const response = await ai.generate({
        description: prompt,
        systemPrompt: DRAWING_BOARD_AI_SYSTEM_PROMPT,
        contextPrompt,
        history,
        currentBoard: currentBoard as unknown as Record<string, unknown>,
        locale,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        requestRef.current?.id !== requestId
      ) {
        return;
      }
      const parsed = parseAIBoardResponse(response);
      onApply(
        parsed.kind === "native"
          ? parsed.elements
          : convertAIBoardDocument(parsed.document, board),
        mode,
      );
      setHistory((previous) => [...previous, prompt].slice(-20));
      setOpen(false);
      setDescription("");
      showToast({ type: "success", message: t.success });
    } catch (reason) {
      if (
        controller.signal.aborted ||
        requestRef.current?.id !== requestId
      ) {
        return;
      }
      const message = reason instanceof Error ? reason.message : "";
      const displayMessage =
        message.startsWith("AI_") || message.includes("JSON")
          ? t.invalid
          : message || t.failed;
      setError(displayMessage);
      showToast({ type: "error", message: displayMessage });
    } finally {
      if (requestRef.current?.id === requestId) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [ai, board, description, history, locale, mode, onApply, showToast, t]);

  const currentBoardNodeCount = board
    ? countAIBoardContextNodes(serializeBoardToAIContext(board))
    : 0;

  const trigger = toolbarHost
    ? createPortal(
        <div className="lakex-ai-board-trigger-wrap">
          <button
            type="button"
            className="lakex-ai-board-trigger"
            title={t.tooltip}
            data-tooltip={t.tooltip}
            aria-label={t.tooltip}
            aria-expanded={open}
            onClick={() => {
              onOpen?.();
              setError("");
              if (currentBoardNodeCount === 0 && history.length) {
                setHistory([]);
              }
              setOpen(true);
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <use
                href={`#icon-ai-board-${dark ? "dark" : "default"}`}
                xlinkHref={`#icon-ai-board-${dark ? "dark" : "default"}`}
              />
            </svg>
          </button>
        </div>,
        toolbarHost,
      )
    : null;

  const dialog =
    open && overlayHost
      ? createPortal(
          <div
            className="lakex-ai-board-overlay"
            role="presentation"
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) close();
            }}
          >
            <section
              className="lakex-ai-board-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lakex-ai-board-title"
            >
              <header className="lakex-ai-board-dialog__header">
                <div>
                  <h3 id="lakex-ai-board-title">{t.title}</h3>
                  <p>{t.description}</p>
                </div>
                <button
                  type="button"
                  className="lakex-ai-board-dialog__close"
                  aria-label={t.cancel}
                  onClick={close}
                >
                  ×
                </button>
              </header>
              <textarea
                ref={textareaRef}
                value={description}
                maxLength={4000}
                placeholder={t.placeholder}
                disabled={loading}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    void generate();
                  }
                }}
              />
              <div className="lakex-ai-board-dialog__options">
                <label>
                  <input
                    type="radio"
                    name="lakex-ai-board-mode"
                    value="replace"
                    checked={mode === "replace"}
                    disabled={loading}
                    onChange={() => setMode("replace")}
                  />
                  {currentBoardNodeCount ? t.modify : t.replace}
                </label>
                <label>
                  <input
                    type="radio"
                    name="lakex-ai-board-mode"
                    value="append"
                    checked={mode === "append"}
                    disabled={loading}
                    onChange={() => setMode("append")}
                  />
                  {t.append}
                </label>
              </div>
              <div className="lakex-ai-board-dialog__memory">
                <div>
                  <span>{t.memory(history.length)}</span>
                  <span>{t.boardContext(currentBoardNodeCount)}</span>
                </div>
                <button
                  type="button"
                  disabled={loading || history.length === 0}
                  onClick={() => setHistory([])}
                >
                  {t.resetMemory}
                </button>
              </div>
              {!ai && (
                <p className="lakex-ai-board-dialog__notice">{t.missing}</p>
              )}
              {error && (
                <p className="lakex-ai-board-dialog__error" role="alert">
                  {error}
                </p>
              )}
              <footer className="lakex-ai-board-dialog__footer">
                <span>{t.shortcut}</span>
                <div>
                  <button type="button" onClick={close}>
                    {loading ? t.cancelGenerating : t.cancel}
                  </button>
                  <button
                    type="button"
                    className="lakex-ai-board-dialog__generate"
                    disabled={loading || !description.trim() || !ai}
                    onClick={() => void generate()}
                  >
                    {loading ? t.generating : t.generate}
                  </button>
                </div>
              </footer>
            </section>
          </div>,
          overlayHost,
        )
      : null;

  const notification =
    toast && overlayHost
      ? createPortal(
          <div
            className="lakex-ai-board-toast"
            data-type={toast.type}
            role={toast.type === "error" ? "alert" : "status"}
          >
            <span aria-hidden="true">{toast.type === "success" ? "✓" : "!"}</span>
            {toast.message}
          </div>,
          overlayHost,
        )
      : null;

  return (
    <>
      {trigger}
      {dialog}
      {notification}
    </>
  );
}
