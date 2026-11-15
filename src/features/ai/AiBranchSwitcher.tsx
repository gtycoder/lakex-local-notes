import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MessageVersions } from "./aiConversationTree";

/**
 * 消息版本切换（◀ 1/2 ▶），桌面 AI 助手专用（移动端/AI 写作语义不同，不接这里）。
 *
 * 语义对齐 chat-demo 的 BranchSwitcher：
 * - 只有同一 parentId 下 ≥2 个版本时才出现（单版本不占位）；
 * - 生成中禁用（任务裁决）；只有一个方向可去时对应按钮禁用；
 * - 点击时把**当前按钮行的视口位置**一起交给上层：切完版本由上层把滚动位置锚回这里，
 *   而不是强制贴底（useStickToBottom 的 detach 语义）。
 */
export function AiBranchSwitcher({ versions, label, disabled, onSelect }: {
  versions: MessageVersions;
  /** 读屏用的组名（「回答版本」/「提问版本」）。 */
  label: string;
  disabled: boolean;
  onSelect: (messageId: string, anchorTop: number) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const { ids, index } = versions;
  if (ids.length <= 1 || index < 0) return null;
  const select = (messageId: string) => {
    if (disabled) return;
    onSelect(messageId, anchorRef.current?.getBoundingClientRect().top ?? 0);
  };
  return (
    <div ref={anchorRef} className="ai-dialog__branches" role="group" aria-label={label}>
      <button
        type="button"
        className="ln-iconbtn ln-iconbtn--compact"
        aria-label="上一个版本"
        disabled={disabled || index <= 0}
        onClick={() => select(ids[index - 1])}
      >
        <ChevronLeft size={12} aria-hidden="true" />
      </button>
      <span className="ai-dialog__branches-count">{index + 1} / {ids.length}</span>
      <button
        type="button"
        className="ln-iconbtn ln-iconbtn--compact"
        aria-label="下一个版本"
        disabled={disabled || index >= ids.length - 1}
        onClick={() => select(ids[index + 1])}
      >
        <ChevronRight size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
