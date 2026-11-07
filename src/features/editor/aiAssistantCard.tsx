/**
 * 「AI 写作助手」插入卡（261107 用户点单，对齐语雀云端的写作助手入口）。
 *
 * 形态：插入面板 / 斜杠面板里的一项；选中后内核插入一张占位卡，占位卡一出现就在
 * 它的位置打开既有的 AiAssistantDialog（顶栏 AI 的无上下文模式）。用户生成结果后：
 * - 「插入到选区后」= 在占位卡之后插入 AI 结果（带「AI 生成」标记），然后删掉占位卡；
 * - 「替换选区」 = 在占位卡处插入 AI 结果（无标记），然后删掉占位卡；
 * - 直接关闭 = 删掉占位卡（文档回到插入前）。
 *
 * 为什么不新造面板/请求：复用 AiAssistantDialog 与 aiResultOps 的既有落库能力；
 * 本卡只做「光标锚点 ↔ AI 面板 ↔ 插入位置」的接线。
 */
import { useCallback, useEffect, useRef } from "react";
import { openAiAssistant } from "../ai/aiAssistantSession";
import type { AiAssistantRequest } from "../ai/aiAssistantRequest";
import { appendCustomCard, withCustomCardSlashItem, CUSTOM_CARD_SLASH_GROUP_TITLE } from "./customCardUtils";
import { captureModelRange } from "./selectionToolbar/aiModelSelection";
import { applyAiReplace } from "./selectionToolbar/aiResultOps";
import { deleteCardNative } from "./selectionToolbar/imageCardOps";
import "./aiAssistantCard.css";

export const AI_ASSISTANT_CARD_NAME = "lake-ai-assistant";
export const AI_ASSISTANT_SLASH_ITEM = "custom-" + AI_ASSISTANT_CARD_NAME;
export const AI_ASSISTANT_MAIN_SEARCH = "/ai";
export const AI_ASSISTANT_ICON_ID = "icon-lake-ai-assistant";
export const AI_ASSISTANT_SLASH_GROUP_TITLE = CUSTOM_CARD_SLASH_GROUP_TITLE;

/** 插入面板图标：内核约定 —— 组件只渲染 symbol，sprite 由 lakeRuntime 收集。 */
export function AiAssistantIconSymbol() {
  return (
    <symbol id={AI_ASSISTANT_ICON_ID} viewBox="0 0 72 72" fill="none">
      {/* 与目录/插入面板其它图标同口径：无底色、线性 sparkle；颜色交给 currentColor（不锁绿）。 */}
      <path d="M33 12.5 38.2 25.8 51.5 31 38.2 36.2 33 49.5 27.8 36.2 14.5 31 27.8 25.8Z"
        stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M53 45l2.3 6.2 6.2 2.3-6.2 2.3L53 62l-2.3-6.2L44.5 53.5l6.2-2.3z" fill="currentColor" />
      <circle cx="19" cy="53" r="3.2" fill="currentColor" />
    </symbol>
  );
}

interface AiWritingCardProps {
  editor?: unknown;
  cardValue?: unknown;
}

interface CommandEditor {
  execCommand?: (name: string, ...args: unknown[]) => unknown;
}

/** 占位卡：只负责开面板 + 把结果落到自己的位置。 */
function AiWritingCard({ editor }: AiWritingCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);

  const cardElement = useCallback((): HTMLElement | null => {
    const el = cardRef.current?.closest("ne-card") as HTMLElement | null;
    return el && el.isConnected ? el : null;
  }, []);

  const removeCard = useCallback(() => {
    const el = cardElement();
    const ed = editor as CommandEditor | undefined;
    if (!el || !ed?.execCommand) return;
    try { deleteCardNative(el, el.id, ed as never); } catch { /* 卡片已不在：忽略 */ }
  }, [cardElement, editor]);

  const commit = useCallback((text: string): void => {
    const el = cardElement();
    const ed = editor as CommandEditor | undefined;
    if (!el || !ed?.execCommand) return;
    let inserted = false;
    try {
      // 用户口径（261107）：用“替换光标/选区”的落点，不是“插到下一块”。
      // 先让内核把选区落到占位卡，再走与选区浮栏「替换选区」完全相同的 applyAiReplace
      //（insertAtSelection：非折叠=替换；折叠=在光标处插入）。
      ed.execCommand("focusCard", el.id);
      const range = captureModelRange(editor);
      const container = el.closest<HTMLElement>(".lake-editor-mount");
      inserted = Boolean(container) && applyAiReplace(editor as never, container as HTMLElement, range, text);
    } catch {
      inserted = false;
    } finally {
      // 替换语义可能已经吃掉占位卡；仍在 DOM 时再删一次（已删除则忽略）。
      if (inserted) removeCard();
    }
  }, [cardElement, editor, removeCard]);

  /** 打开面板：把“卡片底部”当作光标锚点换算成 at 坐标；P2 单会话 Host 渲染。 */
  const openPanelAtCard = useCallback(() => {
    const el = cardElement();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const container = el.closest<HTMLElement>(".lake-editor-mount");
    if (!container) return;
    const request: AiAssistantRequest = {
      context: { kind: "none" },
      placement: {
        kind: "point",
        at: { x: rect.left, y: rect.bottom },
        container,
        scroller: el.closest<HTMLElement>(".ne-editor-wrap") ?? undefined,
      },
      outputs: ["cursor"],
      applyOutput: (text) => { commit(text); return true; },
    };
    openAiAssistant(request, removeCard);
  }, [cardElement, commit, removeCard]);

  /** 内核给刚插入的卡挂 ne-focused；轮询等它出现再打开（与 noteRef 卡同一坑/同一口径）。 */
  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const el = cardElement();
      if (el && !openedRef.current && el.classList.contains("ne-focused")) {
        openedRef.current = true;
        window.clearInterval(timer);
        openPanelAtCard();
        return;
      }
      if (tries >= 12) window.clearInterval(timer);
    }, 120);
    return () => window.clearInterval(timer);
  }, [cardElement, openPanelAtCard]);

  // 占位卡只是光标锚点：不渲染任何可见内容（CSS 同时把内核卡片外壳收成 0 尺寸）。
  return <div ref={cardRef} className="ai-writing-card" aria-hidden="true" />;
}

/** 只读态：卡若残留（崩溃/旧数据）只显示静态标签，不弹面板。 */
function AiWritingCardViewer() {
  return <div className="ai-writing-card ai-writing-card--view"><span className="ai-writing-card__name">AI 写作助手</span></div>;
}

export const aiAssistantCardConfig = {
  name: AI_ASSISTANT_CARD_NAME,
  cardType: "block" as const,
  slash: {
    icon: AI_ASSISTANT_ICON_ID,
    mainSearch: AI_ASSISTANT_MAIN_SEARCH,
    label: "AI 助手",
    description: "写作助手：把文本变成表格、代码块等",
    keywords: ["ai", "AI", "写作", "助手", "写作助手"],
  },
  initValue: {},
  writeText: () => "",
  writeHtml: () => "",
  editorComponent: (props: AiWritingCardProps) => <AiWritingCard editor={props.editor} />,
  viewerComponent: () => <AiWritingCardViewer />,
};

/** 追加自定义卡（幂等；必须在 prepareCustomCards 之前调用）。 */
export function registerAiAssistantCard(config: Record<string, unknown>): void {
  appendCustomCard(config, AI_ASSISTANT_CARD_NAME, aiAssistantCardConfig, AiAssistantIconSymbol);
}

/** 把斜杠项加进「小工具」分组（幂等）。 */
export function withAiAssistantSlashItem(groups: unknown[]): unknown[] {
  return withCustomCardSlashItem(groups, AI_ASSISTANT_SLASH_ITEM, AI_ASSISTANT_SLASH_GROUP_TITLE);
}
