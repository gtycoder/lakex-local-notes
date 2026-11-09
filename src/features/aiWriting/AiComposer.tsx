/**
 * AI 写作 · 输入卡（语雀同款）：提示词 chip / 文档 chip / textarea / 发送·停止。
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
  const promptBtnRef = useRef<HTMLButtonElement>(null);
  const docBtnRef = useRef<HTMLButtonElement>(null);
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
  const pickPrompt = (card: AiWritingPromptCard | null) => {
    onSetPrompt(card ? card.prompt : null);
    setPromptAnchor(null);
  };

  return (
    <div className="aiw-composer">
      {(promptText || docRefs.length > 0) && (
        <div className="aiw-composer__chips">
          {promptText && (
            <div className="aiw-chip">
              <Sparkles size={13} aria-hidden="true" />
              <span className="aiw-chip__title">{promptTitleOf(promptText)}</span>
              <button type="button" className="aiw-chip__close" aria-label="移除提示词" onClick={() => onSetPrompt(null)}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          {docRefs.length > 0 && (
            <div className="aiw-chip">
              <FileText size={13} aria-hidden="true" />
              <span className="aiw-chip__title">{docRefs.length} 篇文档</span>
              <button type="button" className="aiw-chip__close" aria-label="清空已选文档" onClick={() => onSetDocRefs([])}>
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
            ref={promptBtnRef}
            type="button"
            className={"aiw-tool" + (promptText ? " is-active" : "")}
            onClick={() => setPromptAnchor(promptAnchor ? null : promptBtnRef.current)}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>提示词</span>
          </button>
          {mode === "docs" && (
            <button
              ref={docBtnRef}
              type="button"
              className={"aiw-tool" + (docRefs.length > 0 ? " is-active" : "")}
              onClick={() => setDocAnchor(docAnchor ? null : docBtnRef.current)}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{docRefs.length > 0 ? "已选 " + docRefs.length + " 篇" : "请选择文档"}</span>
            </button>
          )}
        </div>
        <div className="aiw-composer__send">
          <span className="aiw-composer__hint" aria-hidden="true"><CornerDownLeft size={12} /> 发送</span>
          {busy ? (
            <button type="button" className="aiw-send aiw-send--stop" aria-label="停止生成" onClick={onStop}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="aiw-send" aria-label="发送" disabled={!canSend} onClick={onSend}>
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
