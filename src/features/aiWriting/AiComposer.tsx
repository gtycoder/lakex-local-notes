/**
 * AI 写作 · 输入卡（语雀同款）：提示词库 / 文档 chip / textarea / 发送·停止。
 *
 * 提示词库（261110 用户定稿）：点卡片 = 把该卡片的完整提示词**直接写进输入框**（可继续补充上下文），
 * 不再挂成 chip。chip 只保留给旧会话（历史里存过 promptText 的仍会显示并可移除）。
 *
 * 深度思考：按用户 261109 定稿**默认开启、不提供关闭入口**（走供应商配置的 thinking/reasoningEffort），
 * 所以这里没有开关；有思考输出时由消息组件显示「已深度思考」。
 */
import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, FileText, Sparkles, Square, X } from "lucide-react";
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
  placeholder?: string;
  onInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onSetPrompt: (text: string | null) => void;
  onSetDocRefs: (refs: AiWritingDocRef[]) => void;
}

function promptTitleOf(promptText: string): string {
  const card = AI_WRITING_PROMPT_CARDS.find((item) => item.prompt === promptText);
  return card?.title ?? "提示词";
}

export function AiComposer({
  mode, input, busy, promptText, docRefs, treeNodes, placeholder = "从这里开始对话",
  onInput, onSend, onStop, onSetPrompt, onSetDocRefs,
}: AiComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * 气泡锚点 = **触发它的那个按钮**（用户 261111 报「提示词弹窗位置错误」：
   * 曾经锚到整张输入卡并居中，弹层飘在卡片中下方、和按钮对不上）。
   * 现在点哪个按钮就贴哪个按钮的左缘展开（放不下时由 usePopoverPosition 翻到上方）。
   */
  const [promptAnchor, setPromptAnchor] = useState<HTMLElement | null>(null);
  const [docAnchor, setDocAnchor] = useState<HTMLElement | null>(null);

  // 高度随内容长：min 100 / max 232（语雀同档），超限内部滚动。
  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = Math.min(232, Math.max(52, area.scrollHeight)) + "px";
  }, [input]);

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
      <textarea
        ref={textareaRef}
        className="aiw-composer__input"
        value={input}
        placeholder={placeholder}
        rows={3}
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
          <button
            type="button"
            className={"ln-btn ln-btn--ghost ln-btn--compact aiw-tool" + (promptText ? " is-selected" : "")}
            onClick={(event) => setPromptAnchor(promptAnchor ? null : event.currentTarget)}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>提示词</span>
          </button>
          {mode === "docs" && (
            <button
              type="button"
              className={"ln-btn ln-btn--ghost ln-btn--compact aiw-tool" + (docRefs.length > 0 ? " is-selected" : "")}
              onClick={(event) => setDocAnchor(docAnchor ? null : event.currentTarget)}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{docRefs.length > 0 ? "已选 " + docRefs.length + " 篇" : "请选择文档"}</span>
            </button>
          )}
        </div>
        <div className="aiw-composer__send">
          {/* 快捷键提示只在「能发送」时显示：生成中按钮已变成「停止」，还挂着「↩ 发送」会读成错位（261111 用户报）。 */}
          {!busy && <span className="aiw-composer__hint" aria-hidden="true"><CornerDownLeft size={12} /> 发送</span>}
          {busy ? (
            /* 停止 = 危险档（红字 + 40% 红框）：中断是要看得见的动作，不再用中性 secondary（261111 用户点单）。 */
            <button type="button" className="ln-btn ln-btn--danger ln-btn--compact aiw-send--stop" aria-label="停止生成" onClick={onStop}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="ln-btn ln-btn--primary ln-btn--compact" aria-label="发送" disabled={!canSend} onClick={onSend}>
              发送
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
