/**
 * 目录节点图标/表情选择器（261107 从 Sidebar 抽出并 lazy 加载）。
 * 之前 Sidebar 静态 import 表情源表（约 123KB raw / 41KB gzip）只为这个浮层，导致入口 chunk 偏大；
 * 现在只在用户点「设置图标」时加载本模块与表情数据。
 */
import { useMemo, useRef, useState } from "react";
import { EyeOff } from "lucide-react";
import { Popover } from "../ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { LAKE_EMOJIS } from "../../lib/lakeEmojis";
import { LAKE_EMOJI_GROUPS } from "../../lib/lakeEmojiGroups";
import { pushEmojiRecent, readEmojiRecents } from "../../lib/emojiRecents";
import { nodeIconPickerMode, parseNodeIcon } from "../../lib/nodeIcons";
import { NOTEBOOK_ICONS, encodeNotebookIcon } from "../../lib/notebookIcons";
import { emojiZhKeywords } from "../../lib/emojiZhKeywords";
import { filterEmojiChars } from "../../lib/emojiSearch";
import { NodeIconGlyph } from "../ui/NodeIconGlyph";
import type { TreeNodeType } from "../../lib/types";

export const NodeIconPicker = ({ anchor, nodeType, value, onPick, onClose }: { anchor: HTMLElement; nodeType: TreeNodeType; value: string | null; onPick: (icon: string | null) => void; onClose: () => void }) => {
  const current = parseNodeIcon(value);
  // 容器（笔记本/分组）两类资源都能选 ⇒ 保留「表情符号 ｜ 图标」两页；文档类型只有表情，没有页签。
  const isContainer = nodeType !== "note";
  const [mode, setMode] = useState<"icon" | "emoji">(() => nodeIconPickerMode(nodeType));
  const currentNotebookId = current?.kind === "notebook" ? current.icon.id : null;
  const [filter, setFilter] = useState("");
  const recents = useMemo(() => readEmojiRecents(), []);
  const [active, setActive] = useState("最近"); // 「最近」常显（用户 261013 定），空的也留着位置
  const contentRef = useRef<HTMLDivElement>(null);
  // 贴齐当前行左缘（跟随层级缩进），放在整行下方，留出图标与名称供搭配预览。
  const { surfaceRef, style } = usePopoverPosition({ open: true, anchor, side: "below-fixed", gap: 8, margin: 4, width: 418 });
  // 悬停提示文案：优先中文短名（CLDR 取第一个词），没有中文就回英文短名。
  const nameOf = useMemo(() => new Map(LAKE_EMOJIS.map((e) => [e.char, emojiZhKeywords(e.char).split(" ")[0] || e.name])), []);
  const q = filter.trim().toLowerCase();
  const sections = q
    // 搜索三路（单一判据见 lib/emojiSearch.ts）：英文短名、CLDR 中文关键词、粘贴一个表情精确命中。
    ? [{ name: "搜索结果", emojis: filterEmojiChars(filter) }]
    : [
        // 「最近」**常显**（用户 261013 定：空的也显示，避免"这功能到底有没有"的疑问）；内核对空最近是隐藏的，这里是有意偏离。
        { name: "最近", emojis: recents },
        ...LAKE_EMOJI_GROUPS.map((g) => ({ name: g.name, emojis: g.emojis })),
      ];
  const jump = (name: string) => {
    setActive(name);
    const box = contentRef.current;
    const label = box?.querySelector<HTMLElement>(`[data-emoji-group="${name}"]`);
    if (box && label) box.scrollTop = label.offsetTop - box.offsetTop - 4;
  };
  return (
    <Popover
      open
      onDismiss={onClose}
      label="设置图标"
      surfaceRef={surfaceRef}
      style={style ?? undefined}
      className="node-icon-picker"
      closeOnNestedOverlay
    >
      {isContainer ? (
        <div className="ln-tabs node-icon-picker__types">
          <div className="ln-tabs__track" role="tablist" aria-label="图标类型">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "emoji"}
              className={"ln-tabs__item" + (mode === "emoji" ? " is-active" : "")}
              onClick={() => { setMode("emoji"); setFilter(""); }}
            >表情符号</button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "icon"}
              className={"ln-tabs__item" + (mode === "icon" ? " is-active" : "")}
              onClick={() => { setMode("icon"); setFilter(""); }}
            >图标</button>
          </div>
          <button
            type="button"
            className="ln-btn ln-btn--ghost ln-tabs__action"
            aria-label="移除图标"
            onClick={() => onPick(null)}
          ><EyeOff size={14} aria-hidden="true" /><span>移除</span></button>
        </div>
      ) : (
        <div className="node-icon-picker__head">
          <span className="node-icon-picker__title">表情符号</span>
          <button
            type="button"
            className="ln-btn ln-btn--ghost"
            aria-label="移除图标"
            onClick={() => onPick(null)}
          ><EyeOff size={14} aria-hidden="true" /><span>移除</span></button>
        </div>
      )}
      {mode === "emoji" && (
        <div className="node-icon-picker__search">
          <span className="ln-input">
            <input
              className="ln-input__field"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索表情（中文或英文，如 房子 / house）"
              autoFocus
            />
          </span>
        </div>
      )}
      <div className={"node-icon-picker__body" + (mode === "icon" ? " node-icon-picker__body--icons" : "")} ref={contentRef}>
        {mode === "icon" ? (
          <div className="node-icon-grid" aria-label="选择笔记本图标">
            {NOTEBOOK_ICONS.map((def) => (
              <button
                key={def.id}
                type="button"
                className={"node-icon-cell" + (def.id === currentNotebookId ? " is-selected" : "")}
                title={def.label}
                aria-label={def.label}
                aria-pressed={def.id === currentNotebookId}
                onClick={() => onPick(encodeNotebookIcon(def.id))}
              >
                <NodeIconGlyph value={encodeNotebookIcon(def.id)} />
              </button>
            ))}
          </div>
        ) : (
        <>
        {sections.map((section) => (
          <div className="node-icon-picker__group" key={section.name}>
            <div className="node-icon-picker__label" data-emoji-group={section.name}>{section.name}</div>
            {section.emojis.length > 0 ? (
              <div className="node-icon-picker__grid">
                {section.emojis.map((char, index) => (
                  <button
                    type="button"
                    className="node-icon-picker__emoji"
                    key={char + index}
                    title={nameOf.get(char) ?? char}
                    onClick={() => { pushEmojiRecent(char); onPick(char); }}
                  >{char}</button>
                ))}
              </div>
            ) : section.name === "最近" ? (
              <div className="node-icon-picker__empty">用过的表情会出现在这里</div>
            ) : null}
          </div>
        ))}
        {sections.every((section) => section.emojis.length === 0) && <div className="node-icon-picker__empty">无匹配表情</div>}
        </>
        )}
      </div>
      {mode === "emoji" && !q && (
        <div className="node-icon-picker__footer">
          <div className="node-icon-picker__tabs" role="tablist" aria-label="表情分组">
            {sections.map((section) => (
              <button
                key={section.name}
                type="button"
                role="tab"
                aria-selected={section.name === active}
                className={"node-icon-picker__tab" + (section.name === active ? " is-active" : "")}
                onClick={() => jump(section.name)}
              >{section.name}</button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
};
export default NodeIconPicker;
