import { useMemo, useState } from "react";
import { Clock, EyeOff } from "lucide-react";
import type { TreeNodeType } from "../../lib/types";
import { NODE_ICONS, NODE_ICON_TINTS, encodeNodeIcon, nodeIconPickerMode, parseNodeIcon, type NodeIconTintId } from "../../lib/nodeIcons";
import { LAKE_EMOJIS } from "../../lib/lakeEmojis";
import { LAKE_EMOJI_GROUPS } from "../../lib/lakeEmojiGroups";
import { pushEmojiRecent, readEmojiRecents } from "../../lib/emojiRecents";
import { MobileNodeIconGlyph } from "./NodeIconGlyph";

/** 目录/知识库自有选择器；只共享资源数据，不复用正文输入表情的组件/类名。 */
export function MobileNodeIconPicker({ nodeType, value, onPick }: {
  nodeType: TreeNodeType;
  value: string | null;
  onPick: (value: string | null) => void;
}) {
  const current = parseNodeIcon(value);
  const [mode, setMode] = useState(() => nodeIconPickerMode(nodeType));
  const [tint, setTint] = useState<NodeIconTintId>(current?.kind === "icon" ? current.tint : "blue");
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
        <div className="mb-node-picker__tabs" role="tablist" aria-label="图标类型">
          {(["emoji", "icon"] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={mode === tab}
              className={"mobile-htab" + (mode === tab ? " active" : "")} onClick={() => setMode(tab)}
            >{tab === "emoji" ? "表情符号" : "图标"}</button>
          ))}
        </div>
        <button type="button" className="mb-btn mb-btn--ghost" aria-label="移除图标" onClick={() => onPick(null)}>
          <EyeOff size={18} aria-hidden="true" /><span>移除</span>
        </button>
      </div>
      {mode === "emoji" ? (
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
            {emojis.length === 0 && <div className="mb-node-picker__empty">用过的图标会出现在这里</div>}
          </div>
        </div>
      ) : (
        <div className="mb-node-picker__body">
          <div className="mb-node-picker__label">选择颜色</div>
          <div className="mb-node-picker__grid" aria-label="选择颜色">
            {NODE_ICON_TINTS.map((color) => (
              <button key={color.id} type="button" className="mb-node-picker__cell" data-tint={color.id}
                aria-label={color.label} aria-pressed={tint === color.id} onClick={() => setTint(color.id)}>
                <span className={"mb-node-picker__swatch" + (tint === color.id ? " is-selected" : "")} />
              </button>
            ))}
          </div>
          <div className="mb-node-picker__label">选择图标</div>
          <div className="mb-node-picker__grid" aria-label="选择图标">
            {NODE_ICONS.map((icon) => {
              const selected = current?.kind === "icon" && current.icon.id === icon.id;
              return <button key={icon.id} type="button" className={"mb-node-picker__cell" + (selected ? " is-selected" : "")}
                aria-label={icon.label} aria-pressed={selected} onClick={() => onPick(encodeNodeIcon(icon.id, tint))}>
                <MobileNodeIconGlyph value={encodeNodeIcon(icon.id, tint)} />
              </button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
