import { useMemo, useState } from "react";
import { Clock, EyeOff } from "lucide-react";
import type { TreeNodeType } from "../../lib/types";
import { nodeIconPickerMode, parseNodeIcon } from "../../lib/nodeIcons";
import { NOTEBOOK_ICONS, encodeNotebookIcon } from "../../lib/notebookIcons";
import { LAKE_EMOJIS } from "../../lib/lakeEmojis";
import { LAKE_EMOJI_GROUPS } from "../../lib/lakeEmojiGroups";
import { pushEmojiRecent, readEmojiRecents } from "../../lib/emojiRecents";
import { MobileNodeIconGlyph } from "./NodeIconGlyph";

/** 目录/知识库自有选择器（261020 精简：容器（笔记本/分组）→ 语雀彩色插画；所有文档类型 → 表情）。
 *
 * 两层含义都写在这里，不再有「图标 / 表情符号」类型页签：
 *   · 面板里**只有一类资源**，页签没有可切换的目标（用户 261020：「只保留表情符号用就行」「笔记本和分组就用新做的这个」）。
 *   · 旧的 40 个线性图标 + 8 档色板已整体删除，`i:` 方言只保留识别（画中性图形）。
 */
export function MobileNodeIconPicker({ nodeType, value, onPick }: {
  nodeType: TreeNodeType;
  value: string | null;
  onPick: (value: string | null) => void;
}) {
  const current = parseNodeIcon(value);
  // 容器（笔记本/分组）两类资源都能选 ⇒ 保留「表情符号 ｜ 图标」两页；文档类型只有表情，没有页签。
  const isContainer = nodeType !== "note";
  const [mode, setMode] = useState<"icon" | "emoji">(() => nodeIconPickerMode(nodeType));
  const currentNotebookId = current?.kind === "notebook" ? current.icon.id : null;
  const [recent, setRecent] = useState(() => readEmojiRecents("icon"));
  const [category, setCategory] = useState("最近");
  const names = useMemo(() => new Map(LAKE_EMOJIS.map((emoji) => [emoji.char, emoji.name])), []);
  const emojis = category === "最近" ? recent : LAKE_EMOJI_GROUPS.find((group) => group.name === category)?.emojis ?? [];
  const pickEmoji = (char: string) => {
    pushEmojiRecent(char, "icon");
    setRecent(readEmojiRecents("icon"));
    onPick(char);
  };
  return (
    <div className="mb-node-picker" data-prevent-swipe>
      <div className="mb-node-picker__head">
        {isContainer ? (
          <div className="mb-node-picker__tabs" role="tablist" aria-label="图标类型">
            <button type="button" role="tab" aria-selected={mode === "emoji"}
              className={"mobile-htab" + (mode === "emoji" ? " active" : "")} onClick={() => setMode("emoji")}>表情符号</button>
            <button type="button" role="tab" aria-selected={mode === "icon"}
              className={"mobile-htab" + (mode === "icon" ? " active" : "")} onClick={() => setMode("icon")}>图标</button>
          </div>
        ) : (
          <span className="mb-node-picker__title">表情符号</span>
        )}
        <button type="button" className="mb-btn mb-btn--ghost" aria-label="移除图标" onClick={() => onPick(null)}>
          <EyeOff size={18} aria-hidden="true" /><span>移除</span>
        </button>
      </div>
      {mode === "icon" ? (
        <div className="mb-node-picker__body mb-node-picker__body--icons">
          <div className="mb-node-picker__grid mb-node-picker__grid--notebook" aria-label="选择笔记本图标">
            {NOTEBOOK_ICONS.map((icon) => {
              const selected = icon.id === currentNotebookId;
              return <button key={icon.id} type="button" className={"mb-node-picker__cell mb-node-picker__cell--notebook" + (selected ? " is-selected" : "")}
                aria-label={icon.label} aria-pressed={selected} onClick={() => onPick(encodeNotebookIcon(icon.id))}>
                <MobileNodeIconGlyph value={encodeNotebookIcon(icon.id)} />
              </button>;
            })}
          </div>
        </div>
      ) : (
        <div className="mb-node-picker__emoji-page">
          <div className="mb-node-picker__categories" role="tablist" aria-label="表情分类">
            <button type="button" role="tab" aria-selected={category === "最近"} aria-label="最近"
              className={"mb-node-picker__category" + (category === "最近" ? " is-selected" : "")}
              onClick={() => setCategory("最近")}><Clock size={20} aria-hidden="true" /></button>
            {LAKE_EMOJI_GROUPS.map((group) => (
              <button key={group.name} type="button" role="tab" aria-selected={category === group.name} aria-label={group.name}
                className={"mb-node-picker__category" + (category === group.name ? " is-selected" : "")}
                onClick={() => setCategory(group.name)}>{group.emojis[0]}</button>
            ))}
          </div>
          <div className="mb-node-picker__emojis">
            <div className="mb-node-picker__grid" aria-label="选择表情">
              {emojis.map((char, index) => (
                <button key={char + index} type="button" className="mb-node-picker__emoji"
                  aria-label={names.get(char) ?? char} onClick={() => pickEmoji(char)}>{char}</button>
              ))}
            </div>
            {emojis.length === 0 && <div className="mb-node-picker__empty">用过的表情会出现在这里</div>}
          </div>
        </div>
      )}
    </div>
  );
}
