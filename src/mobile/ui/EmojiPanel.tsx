import { useMemo, useState } from "react";
import { Ban, ChevronLeft, Clock } from "lucide-react";
import { LAKE_EMOJIS } from "../../lib/lakeEmojis";
import { LAKE_EMOJI_GROUPS } from "../../lib/lakeEmojiGroups";
import { pushEmojiRecent, readEmojiRecents, type EmojiRecentBucket } from "../../lib/emojiRecents";

/**
 * 移动端表情面板（**微信样式**：顶部分类条 + 浅灰底大格子）。**两个用途共用这一份**：
 *
 * 1. **选图标**（传 `onClear`）：给笔记本/文档设图标；
 * 2. **输入表情**（传 `fill` + `onBack`）：文档 dock 的「＋ → 表情」——**撑满面板区、高度固定不跳**，像输入法那样（用户 261013 定）。
 *
 * **261014 用户定稿：分类条末尾加一个动作键**（位置固定、恒在最后一个），语义按入口：
 * · 输入态（`onBack`）→ **返回**：退出表情选择（dock 里 = 回到「＋」面板）；
 * · 选图标态（`onClear`）→ **清除**：去掉图标。
 * ⇒ 原来「最近」首格那块"清除"格随之撤掉（同一个动作只留一个入口，AGENTS §3#14）。
 *
 * 两条 261013 的定稿都在这里体现：
 * · **不要搜索**（用户："移动端没啥意义"）⇒ 没有搜索入口，也没有输入框；
 * · **分类条一屏放得下、不横向滚动**（用户：左划会被外壳手势抢走 —— 小记切 tab / 文档开大纲）；
 *   （261014 起 = 9 个分类 + 末尾动作键，每格 ≈41px ⇒ 命中区由触达补足注册表补到 44）；另挂 `data-prevent-swipe`，
 *   让偶发的横划不落到 `usePanelDrag` / 弹层右滑关闭上（它们本就排除该属性的元素）。
 *
 * 视觉与几何是移动端自有的（MOBILE-TECH-STACK §九）；「最近」**按入口分桶**（AGENTS §3#14）。
 */
export function EmojiPanel({ bucket = "icon", onPick, onClear, onBack, fill = false }: {
  /** 「最近」的记忆桶：icon = 选图标 / input = 输入表情。 */
  bucket?: EmojiRecentBucket;
  /** 选中一个表情（图标场景拿字符去设图标，输入场景插进正文）。 */
  onPick: (emoji: string) => void;
  /** 选图标态：分类条末尾的动作键 = **清除图标**。 */
  onClear?: () => void;
  /** 输入态：分类条末尾的动作键 = **返回**（退出表情选择，回上一级）。与 onClear 互斥，优先 onBack。 */
  onBack?: () => void;
  /** true = 撑满宿主高度（输入法式面板）；false = 内容自适应（sheet 里）。 */
  fill?: boolean;
}) {
  const recents = useMemo(() => readEmojiRecents(bucket), [bucket]);
  const [active, setActive] = useState("最近");
  const nameOf = useMemo(() => new Map(LAKE_EMOJIS.map((e) => [e.char, e.name])), []);

  const emojis = active === "最近"
    ? recents
    : (LAKE_EMOJI_GROUPS.find((g) => g.name === active)?.emojis ?? []);

  /**
   * 分类条末尾的动作键（261014 用户定）：输入态 = 返回（退出表情选择），选图标态 = 清除图标。
   * 位置恒定（不随分类变化），因此不再需要「最近」首格那块清除格。
   */
  const action = onBack
    ? { label: "返回", Icon: ChevronLeft, run: onBack }
    : onClear
      ? { label: "清除图标", Icon: Ban, run: onClear }
      : null;

  return (
    <div className={"mb-emoji-panel" + (fill ? " mb-emoji-panel--fill" : "")} data-prevent-swipe>
      <div className="mb-emoji-cats">
        {/* 分类轨道：**横滑**（用户 261014 二次定稿 —— 10 个可点目标挤一屏确实太多；微信也是一行 8 个）。
            横滑安全性：面板根已挂 `data-prevent-swipe`，外壳的 `usePanelDrag` / 弹层右滑关闭本就排除这类元素
            ⇒ 拖这条轨道只滚它自己，不会切 tab / 开大纲（261013 立的既有约定，未新造机制）。 */}
        <div className="mb-emoji-cats__track" role="tablist" aria-label="表情分类">
          <button
            type="button"
            role="tab"
            aria-selected={active === "最近"}
            aria-label="最近"
            className={"mb-emoji-cat" + (active === "最近" ? " is-active" : "")}
            onClick={() => setActive("最近")}
          >
            <Clock size={20} />
          </button>
          {LAKE_EMOJI_GROUPS.map((group) => {
            const selected = active === group.name;
            return (
              <button
                key={group.name}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={group.name}
                className={"mb-emoji-cat" + (selected ? " is-active" : "")}
                onClick={() => setActive(group.name)}
              >{group.emojis[0]}</button>
            );
          })}
        </div>
        {/* 动作键**钉在最右、不参与滚动**（返回/清除必须永远够得着，不能被滚出去） */}
        {action && (
          <button
            type="button"
            className="mb-emoji-cat mb-emoji-cat--action"
            aria-label={action.label}
            title={action.label}
            onClick={action.run}
          ><action.Icon size={20} /></button>
        )}
      </div>

      <div className="mb-emoji-body">
        <div className="mb-emoji-grid">
          {emojis.map((char, index) => (
            <button
              key={char + index}
              type="button"
              className="mb-emoji-cell"
              aria-label={nameOf.get(char) ?? char}
              onClick={() => { pushEmojiRecent(char, bucket); onPick(char); }}
            >{char}</button>
          ))}
        </div>
        {emojis.length === 0 && (
          <div className="mb-emoji-empty">
            {active === "最近" ? (bucket === "input" ? "用过的表情会出现在这里" : "用过的图标会出现在这里") : "这个分类还没有内容"}
          </div>
        )}
      </div>
    </div>
  );
}
