/**
 * AI 写作 · 输入卡（261116 chat-demo 造型；对齐 AI 助手 261116 定稿）。
 *
 * 造型：**一张大圆角卡片**（--lake-chat-radius-composer / 0.5px 边 / 卡片阴影）=
 *   上方输入（无边框、`field-sizing: content` 自增高、max 160px）
 *   + 底部一行控制：左 = 药丸（深度思考开关 / 提示词 / 请选择文档），
 *     右 = 添加附件（**占位 disabled**，等 docs/ai/ATTACHMENTS-PLAN.md 的 Phase 1 管线）+ 圆形发送（生成中同格变停止）。
 * 全部走 --lake-* 令牌（禁止颜色字面量）；发送圆形 32px 主色、disabled 走 --lake-disabled-opacity。
 *
 * 提示词库（261110 用户定稿）：点卡片 = 把该卡片的完整提示词**直接写进输入框**（可继续补充上下文），
 * 不再挂成 chip。chip 只保留给旧会话（历史里存过 promptText 的仍会显示并可移除）。
 *
 * 深度思考（261116 用户裁决）：**默认开、可关**，请求级覆盖 = runAiChat 的 options.thinking
 * （经 useAiWriting → aiWritingTurn 透传；不传 ≠ 关，传 "enabled"/"disabled" 才覆盖供应商默认值）。
 * 有思考输出时由消息组件显示「已深度思考」。
 */
import { useRef, useState } from "react";
import { ArrowUp, Brain, FileText, Paperclip, Sparkles, Square, X } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import type { AiWritingDocRef, AiWritingMode } from "../../core/aiWriting";
import { toggleDocRef } from "./aiWritingDocs";
import { AI_WRITING_PROMPT_CARDS, type AiWritingPromptCard } from "./aiWritingPrompts";
import { AiPromptLibrary } from "./AiPromptLibrary";
import { AiDocPicker } from "./AiDocPicker";

export interface AiComposerProps {
  mode: AiWritingMode;
  input: string;
  busy: boolean;
  promptText: string | null;
  docRefs: readonly AiWritingDocRef[];
  treeNodes: readonly TreeNode[];
  /** 深度思考开关（默认开）：请求级覆盖走 useAiWriting → runAiChat options.thinking。 */
  thinking: boolean;
  placeholder?: string;
  onInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onThinkingChange: (value: boolean) => void;
  onSetPrompt: (text: string | null) => void;
  onSetDocRefs: (refs: AiWritingDocRef[]) => void;
}

function promptTitleOf(promptText: string): string {
  const card = AI_WRITING_PROMPT_CARDS.find((item) => item.prompt === promptText);
  return card?.title ?? "提示词";
}

export function AiComposer({
  mode, input, busy, promptText, docRefs, treeNodes, thinking, placeholder = "从这里开始对话",
  onInput, onSend, onStop, onThinkingChange, onSetPrompt, onSetDocRefs,
}: AiComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * 气泡锚点 = **触发它的那个按钮**（用户 261111 报「提示词弹窗位置错误」：
   * 曾经锚到整张输入卡并居中，弹层飘在卡片中下方、和按钮对不上）。
   * 现在点哪个按钮就贴哪个按钮的左缘展开（放不下时由 usePopoverPosition 翻到上方）。
   */
  const [promptAnchor, setPromptAnchor] = useState<HTMLElement | null>(null);
  const [docAnchor, setDocAnchor] = useState<HTMLElement | null>(null);

  const canSend = input.trim().length > 0 && !busy;
  /**
   * 点提示词卡片 = 把完整提示词写进输入框（261110 用户定稿）：
   *  · 已有文字 ⇒ 换行追加，不覆盖用户已输入的内容；
   *  · 同时清掉 chip 里的旧提示词（否则同一条要求会在请求里出现两次）；
   *  · 关闭面板、聚焦输入框并把光标放到末尾，用户可以马上接着补上下文。
   */
  const pickPrompt = (card: AiWritingPromptCard | null) => {
    setPromptAnchor(null);
    if (!card) return;
    const baseText = input.replace(/\s+$/, "");
    onInput(baseText.length > 0 ? baseText + "\n" + card.prompt : card.prompt);
    onSetPrompt(null);
    window.setTimeout(() => {
      const area = textareaRef.current;
      if (!area) return;
      area.focus();
      const end = area.value.length;
      try { area.setSelectionRange(end, end); } catch { /* 非输入元素/只读时忽略 */ }
    }, 0);
  };

  return (
    <div className="aiw-composer">
      {(promptText || docRefs.length > 0) && (
        <div className="aiw-composer__chips">
          {promptText && (
            <div className="ln-tag aiw-chip">
              <Sparkles size={13} aria-hidden="true" />
              <span className="ln-ellipsis">{promptTitleOf(promptText)}</span>
              <button type="button" className="ln-iconbtn ln-iconbtn--compact aiw-chip__close" aria-label="移除提示词" onClick={() => onSetPrompt(null)}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          {docRefs.length > 0 && (
            <div className="ln-tag aiw-chip">
              <FileText size={13} aria-hidden="true" />
              <span className="ln-ellipsis">{docRefs.length} 篇文档</span>
              <button type="button" className="ln-iconbtn ln-iconbtn--compact aiw-chip__close" aria-label="清空已选文档" onClick={() => onSetDocRefs([])}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
      {/* 输入：无边框、随内容自增高（field-sizing: content，见 aiWriting.css；不再用 JS 量 scrollHeight）。 */}
      <textarea
        ref={textareaRef}
        className="aiw-composer__input"
        value={input}
        placeholder={placeholder}
        rows={1}
        aria-label={placeholder}
        onChange={(event) => onInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (canSend) onSend();
        }}
      />
      <div className="aiw-composer__bar">
        <div className="aiw-composer__tools">
          {/* 深度思考 = 药丸开关（开：主色字 + 淡主色底；关：中性描边）。生成中禁改，避免半途换档。 */}
          <button
            type="button"
            className={"aiw-pill" + (thinking ? " is-on" : "")}
            aria-pressed={thinking}
            aria-label="深度思考"
            title={thinking ? "深度思考：开（点击关闭）" : "深度思考：关（点击开启）"}
            disabled={busy}
            onClick={() => onThinkingChange(!thinking)}
          >
            <Brain size={14} aria-hidden="true" />
            <span>深度思考</span>
          </button>
          <button
            type="button"
            className={"aiw-pill" + (promptText ? " is-on" : "")}
            aria-expanded={Boolean(promptAnchor)}
            onClick={(event) => setPromptAnchor(promptAnchor ? null : event.currentTarget)}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>提示词</span>
          </button>
          {mode === "docs" && (
            <button
              type="button"
              className={"aiw-pill" + (docRefs.length > 0 ? " is-on" : "")}
              aria-expanded={Boolean(docAnchor)}
              onClick={(event) => setDocAnchor(docAnchor ? null : event.currentTarget)}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{docRefs.length > 0 ? "已选 " + docRefs.length + " 篇" : "请选择文档"}</span>
            </button>
          )}
        </div>
        <div className="aiw-composer__send">
          {/* 添加附件 = **占位**（261116 用户点单；设计见 docs/ai/ATTACHMENTS-PLAN.md 的 Phase 1 管线）。
              这里只放一个明确 disabled 的入口，不接任何假交互、不伪造可用状态。 */}
          <button type="button" className="aiw-attach" aria-label="添加附件" title="从本机资产选择（下一批接入）" disabled>
            <Paperclip size={16} aria-hidden="true" />
          </button>
          {busy ? (
            /* 停止 = 同格换按钮（261008 语义）：红底圆形，中断是看得见的动作。 */
            <button type="button" className="aiw-send-circle aiw-send-circle--stop" aria-label="停止生成" onClick={onStop}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="aiw-send-circle" aria-label="发送" disabled={!canSend} onClick={onSend}>
              <ArrowUp size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <AiPromptLibrary
        open={Boolean(promptAnchor)}
        anchor={promptAnchor}
        activePrompt={promptText}
        onPick={pickPrompt}
        onDismiss={() => setPromptAnchor(null)}
      />
      <AiDocPicker
        open={Boolean(docAnchor)}
        anchor={docAnchor}
        treeNodes={treeNodes}
        selected={docRefs}
        onToggle={(ref) => onSetDocRefs(toggleDocRef(docRefs, ref))}
        onReplace={onSetDocRefs}
        onDismiss={() => setDocAnchor(null)}
      />
    </div>
  );
}
