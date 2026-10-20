/**
 * 阅读态轻工具条（261021 P3）：语雀读态 5 项（视图/筛选/排序/冻结/查找），无公式栏。
 * 我们当前读态只支持浏览/复制，这 5 项里没有可落地的动作 ⇒ 按语雀版式保留、置灰并 title 说明，
 * 不隐藏（隐藏会让读态顶栏空一块，和语雀差得更远）。等内核能力接上再逐个点亮。
 */
import { ArrowUpDown, Filter, LayoutGrid, Search, Snowflake } from "lucide-react";

const ITEMS = [
  { id: "view", label: "视图", Icon: LayoutGrid },
  { id: "filter", label: "筛选", Icon: Filter },
  { id: "sort", label: "排序", Icon: ArrowUpDown },
  { id: "frozen", label: "冻结", Icon: Snowflake },
  { id: "search", label: "查找", Icon: Search },
] as const;

export function MobileSheetReadingBar() {
  return (
    <div className="mb-usheet-readingbar" data-prevent-swipe role="toolbar" aria-label="表格阅读工具">
      {ITEMS.map(({ id, label, Icon }) => (
        <button key={id} type="button" className="mb-usheet-readingbar__btn" aria-label={label} title={label + "（阅读态暂不支持）"} disabled>
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}

export default MobileSheetReadingBar;
