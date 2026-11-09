/**
 * AI 写作 · 一轮生成（纯异步，可单测；不依赖 React / IPC）。
 *
 * 职责边界：
 * - 聚合流式增量（正文 + 思考），把「正常结束 / 用户停止 / 失败」统一成一个结果；
 * - 停止语义只有一处：stop() 先把 stopped 置位，再取消请求；即使供应商在 abort 后
 *   正常结束流（OpenAI SDK 实测可能不抛错），结果仍然是 stopped=true 且保留已生成片段；
 * - 请求 / 取消实现由调用方注入（宿主用 lib/ai；测试用假实现）。
 */
import type { AiChatMessage, AiChatResult } from "../../core/aiProviders";

export interface AiWritingTurnDeps {
  run: (
    requestId: string,
    messages: AiChatMessage[],
    onDelta?: (delta: string) => void,
    onReasoning?: (delta: string) => void,
  ) => Promise<AiChatResult>;
  cancel: (requestId: string) => Promise<void>;
}

export interface AiWritingTurnResult {
  content: string;
  reasoning: string;
  stopped: boolean;
  error: string | null;
  durationMs: number;
}

export interface AiWritingTurn {
  /** 本轮结果（永不 reject：停止 / 失败都以字段表达）。 */
  result: Promise<AiWritingTurnResult>;
  /** 用户主动停止：保留已生成片段，标记 stopped。 */
  stop(): void;
}

export interface StartAiWritingTurnInput {
  requestId: string;
  messages: AiChatMessage[];
  deps: AiWritingTurnDeps;
  /** 流式增量回调（每次增量一次；渲染与落库由调用方决定节奏）。 */
  onPartial?: (content: string, reasoning: string) => void;
  /** 计时起点（默认 Date.now；测试可注入固定时间）。 */
  now?: () => number;
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? "").trim();
  return text || "请求失败";
}

export function startAiWritingTurn(input: StartAiWritingTurnInput): AiWritingTurn {
  const { requestId, messages, deps, onPartial } = input;
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  let content = "";
  let reasoning = "";
  let stopped = false;

  const result = deps.run(
    requestId,
    messages,
    (delta) => {
      content += delta;
      onPartial?.(content, reasoning);
    },
    (delta) => {
      reasoning += delta;
      onPartial?.(content, reasoning);
    },
  ).then(
    (value) => ({
      // 供应商可能把正文放在最终结果里（流式增量缺失时兜底）：有结果值就优先用结果。
      content: (value.text ?? "").length > 0 ? value.text! : content,
      reasoning: value.reasoning ?? reasoning,
      stopped,
      error: null as string | null,
      durationMs: Math.max(0, now() - startedAt),
    }),
    (error: unknown) => ({
      content,
      reasoning,
      stopped,
      error: errorMessageOf(error),
      durationMs: Math.max(0, now() - startedAt),
    }),
  );

  return {
    result,
    stop() {
      if (stopped) return;
      stopped = true;
      void deps.cancel(requestId).catch(() => undefined);
    },
  };
}
