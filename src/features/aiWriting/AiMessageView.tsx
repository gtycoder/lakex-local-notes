/**
 * AI 写作 · 单条消息：用户气泡 / 助手（思考块 + 答案 + 操作条）。
 *
 * 答案渲染：流式期间 MarkdownView（轻、跟手）；收尾后由内核只读 viewer 接管（语雀同款，格式全量）。
 * 思考块仍是 MarkdownView（纯文本为主，不值得再起内核实例），常显不可折叠（与语雀一致）。
 */
import { lazy, Suspense, useCallback, useState } from "react";
import { Copy, FilePlus2, RotateCcw, Sparkles } from "lucide-react";
import { MarkdownView } from "../../components/ui/markdown/MarkdownView";
import type { AiWritingMessage } from "../../core/aiWriting";
import type { AiWritingStream } from "./useAiWriting";

/**
 * 答案正文的内核只读渲染 = **lazy 边界**（内核 chunk 约 1.6MB gz，绝不进入口静态图）。
 * 流式期间仍用 MarkdownView（轻、跟手）；收尾后由 viewer 接管（任务清单/表格/公式/代码全量）。
 * 护栏：src/features/editor/desktopKernelLazy.test.ts。
 */
const AiAnswerViewer = lazy(() => import("./AiAnswerViewer"));

export interface AiMessageViewProps {
  message: AiWritingMessage;
  stream: AiWritingStream | null;
  busy: boolean;
  onRegenerate: () => void;
  onCopy: (content: string) => void;
  onPublish: (content: string) => void;
  onSaveQuickNote: (content: string) => void;
}

function durationLabel(ms: number): string {
  const seconds = ms / 1000;
  return "已深度思考（用时 " + (seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)) + " 秒）";
}

export function AiMessageView(props: AiMessageViewProps) {
  const { message, stream, busy, onRegenerate, onCopy, onPublish, onSaveQuickNote } = props;
  // hooks 必须在任何 return 之前（用户/助手分支共用同一实例生命周期）。
  const [richReady, setRichReady] = useState(false);
  const [richFailed, setRichFailed] = useState(false);
  const handleRichReady = useCallback(() => setRichReady(true), []);
  const handleRichFailed = useCallback(() => setRichFailed(true), []);
  if (message.role === "user") {
    return (
      <div className="aiw-msg aiw-msg--user">
        <div className="aiw-bubble">{message.content}</div>
      </div>
    );
  }
  const streaming = stream !== null && stream.messageId === message.id;
  const content = streaming ? stream.content : message.content;
  const reasoning = streaming ? stream.reasoning : message.reasoning ?? "";
  const thinking = streaming && !content;
  /** 空助手消息（崩溃/重启打断了流）：给一句说明，别留一个空气泡。 */
  const interrupted = !busy && !streaming && content.length === 0 && reasoning.length === 0 && !message.error && !message.stopped;
  const thinkingLabel = streaming
    ? (reasoning ? "正在深度思考…" : "正在思考中…")
    : message.durationMs != null
      ? durationLabel(message.durationMs)
      : reasoning
        ? "已深度思考"
        : null;

  return (
    <div className="aiw-msg aiw-msg--assistant">
      <span className="aiw-avatar" aria-hidden="true"><Sparkles size={16} /></span>
      <div className="aiw-msg__main">
        {thinkingLabel && <p className="aiw-think__label">{thinking && <span className="aiw-think__dot" aria-hidden="true" />}{thinkingLabel}</p>}
        {reasoning && (
          <div className="aiw-think">
            <div className="aiw-think__body"><MarkdownView source={reasoning} /></div>
          </div>
        )}
        {content && (
          <div className={"aiw-answer" + (richReady ? " aiw-answer--rich" : " aiw-answer--pending")}>
            {/* 流式中 / 内核未就绪 / 内核失败：都用 MarkdownView 兜底，保证任何时候都有正文。 */}
            {!richReady && <MarkdownView source={content} />}
            {!streaming && !richFailed && (
              <Suspense fallback={null}>
                <AiAnswerViewer markdown={content} onReady={handleRichReady} onError={handleRichFailed} />
              </Suspense>
            )}
          </div>
        )}
        {message.stopped && !busy && <p className="aiw-msg__note">已停止生成</p>}
        {interrupted && <p className="aiw-msg__note">生成已中断（应用重启或窗口关闭），可以重新生成。</p>}
        {message.error && !busy && <p className="aiw-msg__error" role="alert">生成失败：{message.error}</p>}
        {!busy && (Boolean(content) || Boolean(message.error) || interrupted || Boolean(message.stopped)) && (
          <div className="aiw-actions">
            <button type="button" className="ln-iconbtn aiw-actions__icon" title="重新生成" aria-label="重新生成" onClick={onRegenerate}>
              <RotateCcw size={14} aria-hidden="true" />
            </button>
            {content && (
              <button type="button" className="ln-iconbtn aiw-actions__icon" title="复制" aria-label="复制" onClick={() => onCopy(content)}>
                <Copy size={14} aria-hidden="true" />
              </button>
            )}
            {content && <span className="aiw-actions__sep" aria-hidden="true" />}
            {content && (
              <>
                <button type="button" className="ln-btn aiw-actions__btn" onClick={() => onPublish(content)}>
                  <FilePlus2 size={14} aria-hidden="true" />
                  <span>生成文档</span>
                </button>
                <button type="button" className="ln-btn ln-btn--primary aiw-actions__btn" onClick={() => onSaveQuickNote(content)}>
                  保存到小记
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
