/**
 * 阅读态轻工具条（261021 P3 / P4-4）：语雀读态 5 项（视图/筛选/排序/冻结/查找），无公式栏。
 *
 * 261021 用户定稿：「**读态筛选 = 只对当前设备生效、绝不写正文**」⇒ 只点亮「筛选」，
 * 其余四项仍置灰并写明原因（视图=外壳已有；排序/冻结=写文档数据；查找=待装 find-replace）。
 * 不隐藏死项：隐藏会让读态顶栏空一块，和语雀差得更远。
 */
import { ArrowUpDown, Filter, LayoutGrid, Search, Snowflake } from "lucide-react";

export interface MobileSheetReadingBarProps {
  /** 读态筛选是否可用（文档已存筛选时不可用，见 usheetReadFilter）。 */
  filterEnabled?: boolean;
  /** 本机筛选是否正在生效（按钮高亮）。 */
  filterActive?: boolean;
  /** 不可用时的理由（移动端没有 hover，用 title + 点击 toast）。 */
  filterDisabledReason?: string;
  onFilter?: () => void;
}

const DISABLED_REASON: Record<string, string> = {
  view: "视图：用工作区胶囊（本机视图）",
  sort: "排序会改文档数据，回编辑态使用",
  frozen: "冻结会改文档数据，回编辑态使用",
  search: "查找替换：待接入",
};

export function MobileSheetReadingBar({ filterEnabled = false, filterActive = false, filterDisabledReason, onFilter }: MobileSheetReadingBarProps) {
  const items = [
    { id: "view", label: "视图", Icon: LayoutGrid },
    { id: "filter", label: "筛选", Icon: Filter },
    { id: "sort", label: "排序", Icon: ArrowUpDown },
    { id: "frozen", label: "冻结", Icon: Snowflake },
    { id: "search", label: "查找", Icon: Search },
  ] as const;
  return (
    <div className="mb-usheet-readingbar" data-prevent-swipe role="toolbar" aria-label="表格阅读工具">
      {items.map(({ id, label, Icon }) => {
        if (id === "filter") {
          const enabled = filterEnabled && Boolean(onFilter);
          return (
            <button
              key={id}
              type="button"
              className={"mb-usheet-readingbar__btn" + (filterActive ? " is-active" : "")}
              aria-label={label}
              aria-pressed={filterActive}
              title={enabled ? "筛选（只对本机生效，不写正文）" : filterDisabledReason ?? "筛选不可用"}
              disabled={!enabled}
              onClick={onFilter}
            >
              <Icon size={18} />
            </button>
          );
        }
        return (
          <button key={id} type="button" className="mb-usheet-readingbar__btn" aria-label={label} title={DISABLED_REASON[id]} disabled>
            <Icon size={18} />
          </button>
        );
      })}
    </div>
  );
}

export default MobileSheetReadingBar;
