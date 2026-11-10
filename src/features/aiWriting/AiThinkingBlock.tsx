/**
 * 思考块（261110 用户定稿）：**默认折叠**，只显示一行「已深度思考（用时 X 秒）」/「正在深度思考…」，
 * 点行展开才渲染思考正文（MarkdownView）；再点收起。
 *
 * 为什么独立成件：消息组件要 lazy 内核 viewer，测试不该被内核拖进来；折叠状态与渲染都在这里。
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { MarkdownView } from "../../components/ui/markdown/MarkdownView";

export interface AiThinkingBlockProps {
  /** 思考正文（没有就不渲染展开区）。 */
  reasoning: string;
  /** 行文案（null = 该消息没有思考输出，整块不渲染）。 */
  label: string | null;
  /** 正在流式思考（行前显示一个主色小点）。 */
  live?: boolean;
}

export function AiThinkingBlock({ reasoning, label, live = false }: AiThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  if (!label) return null;
  return (
    <div className="aiw-think-block">
      <button
        type="button"
        className="ln-btn ln-btn--ghost ln-btn--compact aiw-think__label aiw-think__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {live && <span className="aiw-think__dot" aria-hidden="true" />}
        <span>{label}</span>
        <ChevronRight size={12} className={"aiw-think__chevron" + (open ? " is-open" : "")} aria-hidden="true" />
      </button>
      {open && reasoning && (
        <div className="aiw-think"><div className="aiw-think__body"><MarkdownView source={reasoning} /></div></div>
      )}
    </div>
  );
}
