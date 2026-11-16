/**
 * AI 写作 · 输入卡（261116 chat-demo 造型；对齐 AI 助手 261116 定稿）。
 *
 * 造型：**一张大圆角卡片**（--lake-chat-radius-composer / 0.5px 边 / 卡片阴影）=
 *   上方输入（无边框、`field-sizing: content` 自增高；**min 96px** 起步，纯对话区明显更大）
 *   + 底部一行控制：左 = 药丸（深度思考开关 / 提示词 / 请选择文档），
 *     右 = 添加附件（Phase 1：从已选资料文档的图片里选）+ 圆形发送（生成中同格变停止）。
 *
 * **两端输入卡有意不同尺寸（261116 用户裁决）**：AI 写作 = 纯对话，卡片内距更大、textarea 最小 96px；
 * AI 助手 = 资料修改的轻对话，紧凑卡（textarea max 120）。这不是待统一的偏差，**后续不要再合并**。
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
import { ArrowUp, Brain, FileImage, FilePlus2, FileText, Paperclip, Sparkles, Square, X } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { FileKindIcon } from "../bitable/FileKindIcon";
import {
  aiWritingAttachmentKey,
  aiWritingModeCapabilities,
  isAiWritingLocalAttachment,
  type AiWritingAttachment,
  type AiWritingDocRef,
  type AiWritingMode,
} from "../../core/aiWriting";
import { aiWritingAttachmentLabel, aiWritingAttachmentPreviewUrl, aiWritingAttachmentUrl, aiWritingLocalImageUrl, formatAttachmentBytes } from "./aiWritingAttachments";
import { openImagePreview } from "../editor/imagePreview";
import { toggleDocRef } from "./aiWritingDocs";
import { AI_WRITING_PROMPT_CARDS, type AiWritingPromptCard } from "./aiWritingPrompts";
import { AiPromptLibrary } from "./AiPromptLibrary";
import { AiDocPicker } from "./AiDocPicker";
import { AiImagePicker } from "./AiImagePicker";

export interface AiComposerProps {
  mode: AiWritingMode;
  input: string;
  busy: boolean;
  promptText: string | null;
  docRefs: readonly AiWritingDocRef[];
  /** 待发送附件（文档资产图片 / 本机文件；只随下一轮 user 消息；发送后由 controller 清空）。 */
  attachRefs: readonly AiWritingAttachment[];
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
  onAddAttachments: (refs: readonly AiWritingAttachment[]) => void;
  onRemoveAttachment: (asset: AiWritingAttachment) => void;
  /** 主进程 dialog 选本机文件（只在对话写作可用；docs 模式 UI 不提供入口）。 */
  onPickLocalFiles: () => void;
  /** 粘贴剪贴板图片（第三方复制）；docs 模式由 controller 拒绝并给可执行提示。 */
  onPasteImages: (files: File[]) => void;
}

function promptTitleOf(promptText: string): string {
  const card = AI_WRITING_PROMPT_CARDS.find((item) => item.prompt === promptText);
  return card?.title ?? "提示词";
}

export function AiComposer({
  mode, input, busy, promptText, docRefs, attachRefs, treeNodes, thinking, placeholder = "从这里开始对话",
  onInput, onSend, onStop, onThinkingChange, onSetPrompt, onSetDocRefs, onAddAttachments, onRemoveAttachment, onPickLocalFiles, onPasteImages,
}: AiComposerProps) {

  const caps = aiWritingModeCapabilities(mode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * 气泡锚点 = **触发它的那个按钮**（用户 261111 报「提示词弹窗位置错误」：
   * 曾经锚到整张输入卡并居中，弹层飘在卡片中下方、和按钮对不上）。
   * 现在点哪个按钮就贴哪个按钮的左缘展开（放不下时由 usePopoverPosition 翻到上方）。
   */
  const [promptAnchor, setPromptAnchor] = useState<HTMLElement | null>(null);
  const [docAnchor, setDocAnchor] = useState<HTMLElement | null>(null);
  const [attachAnchor, setAttachAnchor] = useState<HTMLElement | null>(null);
  /** 对话写作的附件来源菜单（文档资产图 / 本机文件）；docs 模式直接开选图器，没有本机文件入口。 */
  const [attachMenuAnchor, setAttachMenuAnchor] = useState<HTMLElement | null>(null);
  const attachMenu = usePopoverPosition({ open: Boolean(attachMenuAnchor), anchor: attachMenuAnchor, gap: 6, margin: 10, width: 232 });
  /** 对话写作：文档浏览面板（只寻址；选中一篇后进入它的附件列表，不产生 docRefs）。 */
  const [assetDocAnchor, setAssetDocAnchor] = useState<HTMLElement | null>(null);
  const [assetDoc, setAssetDoc] = useState<AiWritingDocRef | null>(null);
  const attachBtnRef = useRef<HTMLButtonElement | null>(null);
  const docTitleById = new Map(treeNodes.filter((node) => node.nodeType === "note").map((node) => [node.noteFileId ?? node.id, node.title]));

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

  // 已选图片 → 可点开的大图集合（资产图走全尺寸档去 ?w；本机图片走 /ai-local/<token>）。
  const imagePreviews = attachRefs.flatMap((ref) => {
    const src = isAiWritingLocalAttachment(ref)
      ? aiWritingLocalImageUrl(ref, null)
      : aiWritingAttachmentUrl(ref as Exclude<typeof ref, { kind: "local" }>, null);
    return src ? [{ key: aiWritingAttachmentKey(ref), src }] : [];
  });

  return (
    <div className="aiw-composer">
      {(promptText || (caps.docs && docRefs.length > 0) || attachRefs.length > 0) && (
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
          {caps.docs && docRefs.length > 0 && (
            <div className="ln-tag aiw-chip">
              <FileText size={13} aria-hidden="true" />
              <span className="ln-ellipsis">{docRefs.length} 篇文档</span>
              <button type="button" className="ln-iconbtn ln-iconbtn--compact aiw-chip__close" aria-label="清空已选文档" onClick={() => onSetDocRefs([])}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          {attachRefs.map((ref) => {
            const label = aiWritingAttachmentLabel(ref);
            const previewUrl = aiWritingAttachmentPreviewUrl(ref) ?? aiWritingLocalImageUrl(ref);
            return (
              <div key={aiWritingAttachmentKey(ref)} className="aiw-attach-chip">
                {previewUrl ? (
                  <button
                    type="button"
                    className="aiw-attach-chip__preview"
                    aria-label={"预览附件：" + label}
                    title="点击预览"
                    onClick={() => {
                      const index = imagePreviews.findIndex((item) => item.key === aiWritingAttachmentKey(ref));
                      openImagePreview(imagePreviews.map((item) => ({ src: item.src })), index);
                    }}
                  >
                    <img className="aiw-attach-chip__thumb" src={previewUrl} alt="" loading="lazy" decoding="async" />
                  </button>
                ) : (
                  <FileKindIcon name={isAiWritingLocalAttachment(ref) ? ref.name : "文件"} size={18} className="aiw-attach-chip__kind" />
                )}
                {!caps.docs && !isAiWritingLocalAttachment(ref) && docTitleById.get(ref.noteId) && (
                  <span className="aiw-attach-chip__doc">{docTitleById.get(ref.noteId)}</span>
                )}
                <span className="ln-ellipsis aiw-attach-chip__name">{label}</span>
                {isAiWritingLocalAttachment(ref) && (
                  <span className="aiw-attach-chip__size">{formatAttachmentBytes(ref.size)}{ref.pages ? " / " + ref.pages + " 页" : ""}</span>
                )}
                <button type="button" className="ln-iconbtn ln-iconbtn--compact aiw-attach-chip__remove" aria-label={"移除附件：" + label} onClick={() => onRemoveAttachment(ref)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            );
          })}
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
        onPaste={(event) => {
          // 第三方图片粘贴：只拦截 clipboardData 里 image/* 的文件项；纯文本粘贴保持默认。
          const items = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === "file" && item.type.startsWith("image/"));
          if (items.length === 0) return;
          const files = items.map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
          if (files.length === 0) return;
          event.preventDefault();
          onPasteImages(files);
        }}
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
            className={"ln-pill" + (thinking ? " is-on" : "")}
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
            className={"ln-pill" + (promptText ? " is-on" : "")}
            aria-expanded={Boolean(promptAnchor)}
            onClick={(event) => setPromptAnchor(promptAnchor ? null : event.currentTarget)}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>提示词</span>
          </button>
          {mode === "docs" && (
            <button
              type="button"
              className={"ln-pill" + (docRefs.length > 0 ? " is-on" : "")}
              aria-expanded={Boolean(docAnchor)}
              onClick={(event) => setDocAnchor(docAnchor ? null : event.currentTarget)}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{docRefs.length > 0 ? "已选 " + docRefs.length + " 篇" : "请选择文档"}</span>
            </button>
          )}
        </div>
        <div className="aiw-composer__send">
          {/* 添加附件（261116 第四稿，判据 = aiWritingModeCapabilities）：
              · 对话写作：菜单二选一「文档资产图片 / 本机文件」；
              · 多文档推理：只允许所选文档里的图片（无本机文件入口）。 */}
          <button
            type="button"
            ref={(node) => { attachBtnRef.current = node; }}
            className={"aiw-attach" + (attachRefs.length > 0 ? " is-on" : "")}
            aria-label="添加附件"
            aria-expanded={caps.localFiles ? Boolean(attachMenuAnchor) : Boolean(attachAnchor)}
            title={caps.localFiles ? "添加附件（文档里的附件 / 本机文件）" : "从已选文档的附件里选"}
            disabled={busy}
            onClick={(event) => {
              attachBtnRef.current = event.currentTarget;
              if (caps.localFiles) setAttachMenuAnchor(attachMenuAnchor ? null : event.currentTarget);
              else setAttachAnchor(attachAnchor ? null : event.currentTarget);
            }}
          >
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
      <AiImagePicker
        open={Boolean(attachAnchor)}
        anchor={attachAnchor}
        docs={caps.attachmentsLimitedToDocs ? docRefs : assetDoc ? [assetDoc] : []}
        onBackToDocs={caps.localFiles ? () => { setAttachAnchor(null); setAssetDocAnchor(attachBtnRef.current); } : undefined}
        selected={attachRefs}
        onAdd={onAddAttachments}
        onDismiss={() => setAttachAnchor(null)}
      />
      <AiDocPicker
        open={Boolean(assetDocAnchor)}
        anchor={assetDocAnchor}
        treeNodes={treeNodes}
        selected={assetDoc ? [assetDoc] : []}
        onToggle={(ref) => {
          setAssetDoc(ref);
          setAssetDocAnchor(null);
          setAttachAnchor(attachBtnRef.current);
        }}
        onReplace={(refs) => {
          const first = refs[refs.length - 1] ?? null;
          setAssetDoc(first);
          setAssetDocAnchor(null);
          if (first) setAttachAnchor(attachBtnRef.current);
        }}
        onDismiss={() => setAssetDocAnchor(null)}
      />
      <Popover
        open={Boolean(attachMenuAnchor)}
        onDismiss={() => setAttachMenuAnchor(null)}
        label="添加附件"
        className="aiw-attach-menu"
        style={attachMenu.style ?? undefined}
        surfaceRef={attachMenu.surfaceRef}
      >
        <button
          type="button"
          className="ln-row aiw-attach-menu__item"
          onClick={() => {
            setAttachMenuAnchor(null);
            setAssetDoc(null);
            setAssetDocAnchor(attachBtnRef.current);
          }}
        >
          <FileImage size={16} className="ln-row__icon" aria-hidden="true" />
          <span className="ln-ellipsis">从文档里选附件</span>
        </button>
        <button
          type="button"
          className="ln-row aiw-attach-menu__item"
          onClick={() => {
            setAttachMenuAnchor(null);
            onPickLocalFiles();
          }}
        >
          <FilePlus2 size={16} className="ln-row__icon" aria-hidden="true" />
          <span className="ln-ellipsis">从电脑选择文件…</span>
        </button>
      </Popover>
    </div>
  );
}
