/**
 * 提示词库：锚定输入卡「提示词」按钮的气泡（菜单行列表，与全仓菜单同一身份）。
 * 点击一行 = 把完整提示词**写进输入框**（261110 用户定稿；不再挂 chip，也不做"再点一次摘下"）。
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
  // 固定宽度 360：两行文本（标题 + 说明）按行省略，不收宽度会按 max-content 撑到整屏（贴底时还会被夹成一条）。
  // 锚点 = 整张输入卡（AiComposer 传进来）：气泡在输入卡下方**居中**展开（261110 用户点单）。
  const { surfaceRef, style } = usePopoverPosition({ open, anchor, gap: 8, align: "center", margin: 10, width: 360 });
  return (
    <Menu
      open={open}
      onDismiss={onDismiss}
      label="提示词"
      style={style ?? undefined}
      surfaceRef={surfaceRef}
    >
      {AI_WRITING_PROMPT_CARDS.map((card) => {
        // 旧会话可能带着 chip（promptText）：仅用来标一下来源，不再参与点击语义。
        const selected = activePrompt === card.prompt;
        return (
          <button
            key={card.id}
            type="button"
            role="menuitem"
            className={"ln-menu__item" + (selected ? " is-selected" : "")}
            onClick={() => onPick(card)}
          >
            <span className="ln-row__icon" aria-hidden="true"><card.Icon size={16} /></span>
            <span className="aiw-prompts__body">
              <span className="aiw-prompts__title ln-ellipsis">{card.title}</span>
              <span className="aiw-prompts__desc ln-ellipsis">{card.description}</span>
            </span>
          </button>
        );
      })}
    </Menu>
  );
}
