/**
 * AI 助手请求模型（261107 P1 架构收口）。
 *
 * 把入口差异收敛成三个正交轴：
 * - **context**：有上下文（选区/图片）或无上下文（可显式允许附带全文）；
 * - **placement**：无锚点（floating）/ 光标点锚点（point）；
 * - **outputs**：结果可落到光标处（cursor）/ 选区之后（after），空数组 = 只读。
 *
 * 入口只负责构造 request（含快照与 applyOutput 的内核命令），
 * `AiAssistantDialog` 只消费 request —— 不再传 10 个隐式可选 props。
 */
import type { AiAssetRef } from "../../core/aiProviders";
import type { CapturedModelRange } from "../editor/selectionToolbar/aiModelSelection";

/** 上下文：有选区（文字/图片）或无上下文（无选区入口；全文开关必须显式允许）。 */
export type AiAssistantContext =
  | {
    kind: "selection";
    text: string;
    attachments?: AiAssetRef[];
    /** 打开时冻结的模型选区（AI 结果替换/插入用）。 */
    range: CapturedModelRange | null;
    /** 打开时冻结的 DOM 选区（模型选区失效时的兜底）。 */
    domRange?: Range | null;
  }
  | {
    kind: "none";
    /** 显式允许「附加当前文档全文」；不传 = 不显示全文开关（例如写作助手卡）。 */
    allowDocument?: { noteId?: string };
  };

/** 面板出现位置：无锚点（正文栏顶 / 右上角）或光标点锚点。 */
export type AiAssistantPlacement =
  | { kind: "floating"; container?: HTMLElement }
  | { kind: "point"; at: { x: number; y: number }; container: HTMLElement; scroller?: HTMLElement };

/** 结果落点：cursor = 替换/插入到当前光标/选区；after = 插到选区后的新块。 */
export type AiAssistantOutputMode = "cursor" | "after";

export interface AiAssistantRequest {
  context: AiAssistantContext;
  placement: AiAssistantPlacement;
  outputs: readonly AiAssistantOutputMode[];
  /** 由入口执行内核落库命令；返回是否成功（用于保留选区等后续状态）。 */
  applyOutput: (text: string, mode: AiAssistantOutputMode) => boolean;
}

/** 上下文里的选区文字（无上下文 = 空串）。 */
export function aiSelectionText(context: AiAssistantContext): string {
  return context.kind === "selection" ? context.text : "";
}

/** 上下文里的图片附件。 */
export function aiAttachments(context: AiAssistantContext): AiAssetRef[] | undefined {
  return context.kind === "selection" ? context.attachments : undefined;
}

/** 该上下文是否允许「附加当前文档全文」；返回 noteId（无内容时为 undefined）。 */
export function aiDocumentNoteId(context: AiAssistantContext): string | undefined {
  return context.kind === "none" ? context.allowDocument?.noteId : undefined;
}

/**
 * 输出按钮文案：
 * - cursor + 有选区 → 「替换选区」（与原有选区浮栏语义一致）；
 * - cursor + 无选区（写作助手卡/顶栏如果开放）→ 「插入到光标处」；
 * - after → 「插入到选区后」。
 */
export function aiOutputLabel(context: AiAssistantContext, mode: AiAssistantOutputMode): string {
  if (mode === "after") return "插入到选区后";
  return context.kind === "selection" && context.text.trim() ? "替换选区" : "插入到光标处";
}
