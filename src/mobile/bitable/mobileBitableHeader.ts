/**
 * 移动端多维表**头部模型**（261103 三/四批：3 行 → 1 行 → 现在 2 行）——纯函数，单一来源。
 *
 * 只回答「头部两行渲染哪些部件」，**不碰 records / 不碰视图数据**：
 * - 第 1 行（永远都有）：[☰ 数据表名] …… [字段] [筛选] [＋]
 * - 第 2 行（showViews）：[视图页签（横向滚动）] [视图列表] —— 261103 四批把页签单独放一行；
 * - 只读态第 1 行只剩 [☰ 表名]；单视图且无更多 ⇒ 第 2 行整段不渲染
 *   （**例外**：只读且有视图状态摘要时第 2 行仍渲染，用来放只读 chip）；
 * - 只读态的「视图状态」chip（261103 六批 B1）：只有 筛选/排序/分组 非空才出现，编辑态一律不出现
 *   （编辑态已有「筛选」按钮，chip 只是只读态的摘要入口）——是否出现由 hasViewState 决定，不读 records；
 * - 编辑态才出现 字段 / 筛选 / ＋；**表单视图没有网格** ⇒ 三者都不出现（表单提交走表单自己）；
 * - 记录数 / 「编辑中 · 只读」徽标不再是头部的一部分（记录数在网格末尾统计行）。
 *
 * 性能口径：头部渲染不得依赖 records 数组（旧实现读 records.length 导致每次翻页/记录变化都重算头部）。
 */
export interface MobileBitableHeaderInput {
  /** 编辑态（工作区顶栏「编辑 / 完成」）。 */
  editable: boolean;
  /** 表单视图（填写态）：没有网格工具，头部只留表名与视图切换。 */
  isFormView: boolean;
  /** 视图页签数量（调用方用 useMemo 的 viewTabs.length，避免渲染里重复算）。 */
  viewCount: number;
  /** 当前视图是否有 筛选/排序/分组（纯函数 bitableViewStateSummary 的结果非空；不涉及 records）。 */
  hasViewState: boolean;
}

export interface MobileBitableHeaderModel {
  /** 头部第 2 行（视图页签 + 视图列表按钮）：多视图（只读也要能切）或编辑态（新建视图入口）。 */
  showViews: boolean;
  /** 字段管理（文档结构，与当前视图无关）。 */
  showFieldButton: boolean;
  /** 视图设置（筛选/排序/字段展示…同一个配置面板；261103 三批：删掉与它重复的「视图配置」入口）。 */
  showFilterButton: boolean;
  /** 新增记录（网格末尾另有常驻行；头部只给紧凑 ＋）。 */
  showAddRecord: boolean;
  /** 只读态第 2 行的「视图状态」chip（261103 六批 B1）：只读 + 有筛选/排序/分组才出现。 */
  showViewStateChip: boolean;
}

export function mobileBitableHeaderModel(input: MobileBitableHeaderInput): MobileBitableHeaderModel {
  const contentEditing = input.editable && !input.isFormView;
  return {
    showViews: input.viewCount > 1 || input.editable,
    showFieldButton: contentEditing,
    showFilterButton: contentEditing,
    showAddRecord: contentEditing,
    showViewStateChip: !input.editable && input.hasViewState,
  };
}
