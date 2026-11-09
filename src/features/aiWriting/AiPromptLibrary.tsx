/**
 * 提示词库：锚定输入卡「提示词」按钮的气泡（3 列卡片，语雀同款位置）。
 * 点击卡片 = 把提示词挂到输入卡 chip（不写正文）；再次点按同一条 = 摘下。
 */
import { Menu } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { AI_WRITING_PROMPT_CARDS, type AiWritingPromptCard } from "./aiWritingPrompts";

export interface AiPromptLibraryProps {
  open: boolean;
  anchor: HTMLElement | null;
  activePrompt: string | null;
  onPick: (card: AiWritingPromptCard | null) => void;
  onDismiss: () => void;
}

export function AiPromptLibrary({ open, anchor, activePrompt, onPick, onDismiss }: AiPromptLibraryProps) {
  // 固定宽度：卡片说明不换行，不收宽度会按 max-content 撑满视口（贴底时还会被夹成一条）。
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, gap: 6, align: "start", margin: 10, width: 720 });
  return (
    <Menu
      open={open}
      onDismiss={onDismiss}
      label="提示词"
      className="aiw-prompts"
      style={style ?? undefined}
      surfaceRef={surfaceRef}
    >
      <div className="aiw-prompts__grid">
        {AI_WRITING_PROMPT_CARDS.map((card) => {
          const selected = activePrompt === card.prompt;
          return (
            <button
              key={card.id}
              type="button"
              role="menuitem"
              className={"aiw-prompts__card" + (selected ? " is-selected" : "")}
              onClick={() => onPick(selected ? null : card)}
            >
              <span className="aiw-prompts__icon" aria-hidden="true"><card.Icon size={16} /></span>
              <span className="aiw-prompts__body">
                <span className="aiw-prompts__title ln-ellipsis">{card.title}</span>
                <span className="aiw-prompts__desc ln-ellipsis">{card.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Menu>
  );
}
