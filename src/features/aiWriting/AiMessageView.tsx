/**
 * AI 写作 · 单条消息：用户气泡 / 助手（思考块 + 答案 + 操作条）。
 *
 * 答案渲染：流式期间 MarkdownView（轻、跟手）；收尾后由内核只读 viewer 接管（语雀同款，格式全量）。
 * 思考块仍是 MarkdownView（纯文本为主，不值得再起内核实例）；**默认折叠**（261110 用户定稿），
 * 只显示一行「已深度思考（用时 X 秒）」/「正在深度思考…」，点开才渲染正文（见 AiThinkingBlock）。
 */
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Feather, FilePlus2, RotateCcw, Sparkles } from "lucide-react";
import { MarkdownView } from "../../components/ui/markdown/MarkdownView";
import { useThrottledMarkdown } from "../../components/ui/markdown/useThrottledMarkdown";
import { AiThinkingBlock } from "./AiThinkingBlock";
import { FileKindIcon } from "../bitable/FileKindIcon";
import { aiWritingAttachmentKey, isAiWritingLocalAttachment, type AiWritingMessage } from "../../core/aiWriting";
import { aiWritingAttachmentUrl, aiWritingLocalImageUrl, formatAttachmentBytes } from "./aiWritingAttachments";
import { openImagePreview } from "../editor/imagePreview";
import type { AiWritingStream } from "./useAiWriting";
import type { AiAssetRef } from "../../core/aiProviders";

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
  /** 复制为 Lake（Markdown → 内核剪贴板负载；与文档 AI 弹窗同一能力，内核来源由父级解析）。 */
  onCopyAsLake: (content: string) => Promise<boolean>;
  onPublish: (content: string) => void;
  onSaveQuickNote: (content: string) => void;
}

function durationLabel(ms: number): string {
  const seconds = ms / 1000;
  return "已深度思考（用时 " + (seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)) + " 秒）";
}

/**
 * **memo 边界（261116 P1-2）**：流式期间父级每个 delta 都会重渲染，但如果历史消息拿到的
 * props 完全相等（message 同引用、stream=null、busy 不变、回调稳定），这里直接 bail out。
 * 调用约定：`stream` 只传给 messageId 命中的那一条（见 AiMessageList），回调必须 useCallback 稳定。
 */
export const AiMessageView = memo(function AiMessageView(props: AiMessageViewProps) {
  const { message, stream, busy, onRegenerate, onCopy, onCopyAsLake, onPublish, onSaveQuickNote } = props;
  // hooks 必须在任何 return 之前（用户/助手分支共用同一实例生命周期）。
  const [richReady, setRichReady] = useState(false);
  const [richFailed, setRichFailed] = useState(false);
  const handleRichReady = useCallback(() => setRichReady(true), []);
  const handleRichFailed = useCallback(() => setRichFailed(true), []);
  /** 「复制为 Lake」成功反馈：勾 1200ms 后复原（与文档 AI 弹窗 markCopied 同口径）。 */
  const [lakeCopied, setLakeCopied] = useState(false);
  const lakeTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (lakeTimerRef.current !== null) window.clearTimeout(lakeTimerRef.current);
  }, []);
  // 流式 Markdown 节流（P1）：来源 deepseek-ai/chat-demo 的 useThrottleMarkdownRender，
  // 改造见 components/ui/markdown/useThrottledMarkdown.ts。只在**生成中**启用；streaming 变 false
  // 的那一帧立即透传完整 message.content，随后的内核 viewer 也拿完整正文（不会残留截断）。
  const streaming = stream !== null && stream.messageId === message.id;
  const streamedContent = streaming ? stream.content : message.content;
  const content = useThrottledMarkdown(streamedContent, streaming && message.role === "assistant");
  if (message.role === "user") {
    const attachRefs = message.attachRefs ?? [];
    // 历史轮里的图片可点开大图：资产图走全尺寸档；本机图片走 /ai-local/<token>（261116 用户反馈：本机图片不能预览）。
    const imagePreviews = attachRefs.flatMap((ref) => {
      const src = isAiWritingLocalAttachment(ref)
        ? aiWritingLocalImageUrl(ref, null)
        : aiWritingAttachmentUrl(ref, null);
      return src ? [{ key: aiWritingAttachmentKey(ref), src }] : [];
    });
    return (
      <div className="aiw-msg aiw-msg--user">
        <div className="aiw-user-block">
          <div className="aiw-bubble">{message.content}</div>
          {attachRefs.length > 0 && (
            <div className="aiw-bubble-attach" aria-label={"随发附件 " + attachRefs.length + " 个"}>
              {attachRefs.map((ref) => {
                const localImage = isAiWritingLocalAttachment(ref) ? aiWritingLocalImageUrl(ref) : null;
                // 本机非图片（文本 / PDF / 未知）仍是文件名 chip（渲染层没有可预览 URL）。
                if (isAiWritingLocalAttachment(ref) && !localImage) {
                  return (
                    <span key={aiWritingAttachmentKey(ref)} className="aiw-bubble-file" title={ref.name}>
                      <FileKindIcon name={ref.name} size={16} className="aiw-bubble-file__icon" />
                      <span className="ln-ellipsis">{ref.name}</span>
                      <span className="aiw-bubble-file__size">{formatAttachmentBytes(ref.size)}</span>
                    </span>
                  );
                }
                // 走到这里 = 资产图或本机图片（上方已 return 本机非图片）。
                const label = ref.name ?? (ref as AiAssetRef).filename;
                const src = localImage ?? aiWritingAttachmentUrl(ref as AiAssetRef);
                return (
                  <button
                    key={aiWritingAttachmentKey(ref)}
                    type="button"
                    className="aiw-bubble-attach__preview"
                    aria-label={"预览附件：" + label}
                    title="点击预览"
                    onClick={() => {
                      const index = imagePreviews.findIndex((item) => item.key === aiWritingAttachmentKey(ref));
                      openImagePreview(imagePreviews.map((item) => ({ src: item.src })), index);
                    }}
                  >
                    <img
                      className="aiw-bubble-attach__img"
                      src={src}
                      alt={label}
                      title={label}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }
  const reasoning = streaming ? stream.reasoning : message.reasoning ?? "";
  // 「还在等正文」按原始流判断：节流延迟不应让思考块一直显示「正在思考」。
  const thinking = streaming && !streamedContent;
  /** 空助手消息（崩溃/重启打断了流）：给一句说明，别留一个空气泡。 */
  const interrupted = !busy && !streaming && content.length === 0 && reasoning.length === 0 && !message.error && !message.stopped;
  /** 复制为 Lake：成功才显示勾（失败静默，不新增 toast 语义）。 */
  const copyAsLake = () => {
    void onCopyAsLake(content).then((ok) => {
      if (!ok) return;
      setLakeCopied(true);
      if (lakeTimerRef.current !== null) window.clearTimeout(lakeTimerRef.current);
      lakeTimerRef.current = window.setTimeout(() => {
        setLakeCopied(false);
        lakeTimerRef.current = null;
      }, 1200);
    });
  };
  const thinkingLabel = streaming
    ? (reasoning ? "正在深度思考…" : "正在思考中…")
    : message.durationMs != null
      ? durationLabel(message.durationMs)
      : reasoning
        ? "已深度思考"
        : null;

  return (
    <div className="aiw-msg aiw-msg--assistant">
      <span className="aiw-avatar" aria-hidden="true"><Sparkles size={14} /></span>
      <div className="aiw-msg__main">
        {/* 思考块默认折叠（261110 用户定稿）：只占一行，点开才渲染思考正文。 */}
        <AiThinkingBlock reasoning={reasoning} label={thinkingLabel} live={thinking} />
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
            <button type="button" className="ln-iconbtn ln-iconbtn--compact aiw-actions__icon" title="重新生成" aria-label="重新生成" onClick={onRegenerate}>
              <RotateCcw size={14} aria-hidden="true" />
            </button>
            {content && (
              <button type="button" className="ln-iconbtn ln-iconbtn--compact aiw-actions__icon" title="复制" aria-label="复制" onClick={() => onCopy(content)}>
                <Copy size={14} aria-hidden="true" />
              </button>
            )}
            {content && (
              <button
                type="button"
                className={"ln-iconbtn ln-iconbtn--compact aiw-actions__icon" + (lakeCopied ? " is-selected" : "")}
                title="复制为 Lake"
                aria-label="复制为 Lake"
                disabled={streaming}
                onClick={copyAsLake}
              >
                {lakeCopied ? <Check size={14} aria-hidden="true" /> : <span className="aiw-lake-badge" aria-hidden="true">lake</span>}
              </button>
            )}
            {content && <span className="aiw-actions__sep" aria-hidden="true" />}
            {content && (
              <>
                <button type="button" className="ln-btn ln-btn--ghost aiw-actions__btn" onClick={() => onPublish(content)}>
                  <FilePlus2 size={14} aria-hidden="true" />
                  <span>生成文档</span>
                </button>
                {/* 「保存到小记」与「生成文档」同级（用户 261110：不要强调成主操作），图标 = 小记空间的 Feather。 */}
                <button type="button" className="ln-btn ln-btn--ghost aiw-actions__btn" onClick={() => onSaveQuickNote(content)}>
                  <Feather size={14} aria-hidden="true" />
                  <span>保存到小记</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
