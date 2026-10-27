/**
 * 自定义卡注册的**通用胶水**（noteRef / lockedText / 以后的卡共用）。
 *
 * 单一来源：把内核 `customCard.cards` 的追加与斜杠项的注入收敛到一处 ——
 * 两张卡各写一份"结构相同、只有名字不同"的循环，就是 AGENTS §3#14 说的"又写一套"。
 * 官方契约见 yuque-developer-docs 69·开发自定义卡片：
 * - 卡必须进 `customCard.cards`，形状 `{ config, icon? }`；
 * - 斜杠项名必须是 `custom-${name}`，且要手动 push 进 `slash.cardSelect.<组>.groups[].items`。
 */
/** 默认插入面板分组：「小工具」（按 title 找：该组 name 与「程序员」组重名，只能按标题定位）。 */
export const CUSTOM_CARD_SLASH_GROUP_TITLE = "小工具";

/** 追加一张自定义卡（幂等：同名的已存在就不动）。 */
export function appendCustomCard(
  config: Record<string, unknown>,
  name: string,
  cardConfig: unknown,
  icon?: unknown,
): void {
  const customCard = config.customCard as { cards?: unknown[] } | undefined;
  if (!customCard) return;
  const cards = Array.isArray(customCard.cards) ? customCard.cards : [];
  const exists = cards.some((card) => (card as { config?: { name?: string } })?.config?.name === name);
  if (!exists) cards.push({ config: cardConfig, ...(icon ? { icon } : {}) });
  customCard.cards = cards;
}

/** 把斜杠项加进指定分组（幂等；其它组一字不动）。 */
export function withCustomCardSlashItem(groups: unknown[], slashItem: string, groupTitle: string): unknown[] {
  return groups.map((group) => {
    const g = group as { title?: string; items?: unknown[] };
    if (g?.title !== groupTitle || !Array.isArray(g.items)) return group;
    return g.items.includes(slashItem) ? group : { ...g, items: [...g.items, slashItem] };
  });
}
