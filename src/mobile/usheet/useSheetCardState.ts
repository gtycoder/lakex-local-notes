import { useCallback, useEffect, useState } from "react";
import type { SheetCardId } from "./usheetChromeModel";

/** 表格锚定卡片与工作表列表的打开状态；不拥有 Univer 实例或动作。 */
export function useSheetCardState(opts: { active: boolean; editing: boolean }) {
  const [openCard, setOpenCard] = useState<SheetCardId | null>(null);
  const [cardAnchor, setCardAnchor] = useState<HTMLElement | null>(null);
  const [sheetListAnchor, setSheetListAnchor] = useState<HTMLElement | null>(null);

  const closeCard = useCallback(() => {
    setOpenCard(null);
    setCardAnchor(null);
  }, []);

  const toggleCard = useCallback((card: SheetCardId, anchor: HTMLElement) => {
    if (openCard === card) {
      closeCard();
      return;
    }
    setOpenCard(card);
    setCardAnchor(anchor);
  }, [closeCard, openCard]);

  const openSheetList = useCallback((anchor: HTMLElement) => setSheetListAnchor(anchor), []);
  const closeSheetList = useCallback(() => setSheetListAnchor(null), []);

  useEffect(() => {
    if (opts.editing && opts.active) return;
    setOpenCard(null);
    setCardAnchor(null);
  }, [opts.active, opts.editing]);

  return {
    openCard,
    cardAnchor,
    sheetListAnchor,
    closeCard,
    toggleCard,
    openSheetList,
    closeSheetList,
  };
}
