# 移动端多维表 UI/设计审计（261117）

## Design language
- Audited surface: 移动端多维表表面族（`src/mobile/bitable/**`）——网格/看板/日历/画廊视图、记录详情页、编辑记录 Sheet、字段管理/修改字段、视图列表/配置、表/视图操作菜单、填写表单、字段值控件族。
- Design sources: `docs/MOBILE-DESIGN.md`（v3 思源取值基线 + v2 几何/组件口径 + Gates 指标）；`AGENTS.md` §3#14/§4（mb-* 原语、44 Rule、文案与状态口径）；`mobileBitable.css`（域内样式）。
- Documented decisions: 记录面板「点格编辑」形态（261020 P0）；字段面板 → 铅笔 → 修改字段对齐钉钉（261030）；「打开 = 只读」口径（AGENTS）；记录全集不裁剪 + 显式加载更多（BITABLE-VIEWPORT）；261117 项移动选择器 / 折叠展开 / Sheet 拖拽调高（本轮用户点单）。
- Governing owners and consumers: `BitableSelectControl`（选择单一来源）；`MobileSheet`（浮层原语）；`mobileBitableEdit`（写边界）；kit 的 mb-chip / mb-iconbtn / mb-btn / mb-set-*。
- Explicit exceptions: None documented。

## 发现（每条含证据与建议修法；择优落地，不必全做）

### A. 文案与语义
1. **【实锤·中】记录详情只读文案错位**：`MobileBitableRecordPage.tsx:49`「这份收集表默认只读；记录内容不能在这里修改。」在**所有**记录详情页显示；但从表格/看板视图点进记录时该解释不成立（不是收集表）。证据：设备截图（表格视图点行 → 详情页底部出现该句）+ 代码。建议：按视图类型分支文案（收集表语境 vs 普通记录只读原因），或只在收集表视图渲染该句。
2. **【实锤·中】创建动作动词混用**：同一语义族并存「添加字段」「添加选项」「新建选项」「新增记录」「新建视图」；尤其**同一"选项创建"两叫法**（`FieldEditorSheet` 按钮「添加选项」vs `BitableSelectControl`「新建选项」）。证据：grep 全部标签。建议：统一动词体系（推荐：对象名词 +「新建」——新建记录/新建字段/新建选项/新建视图；或全用「添加」），一处不落。
3. **【实锤·低】同动作双名**：字段铅笔 aria-label「编辑字段 X」（FieldSheet:68）vs 面板标题「修改字段」。建议统一（「修改字段」或「编辑字段」取一）。

### B. 触控目标（44 Rule，MOBILE-DESIGN Gates；mobile-walkthrough 是门禁）
4. **【实锤·高】`.mbt-select__toggle` 28×28**（261117 本轮引入，自查）：低于 44 规则，设备走查会红。建议：保留视觉 28 但补命中盒（min-width/height 44 或伪元素扩展命中区）。
5. **【实锤·中】多维表头部族 34–36px**：`数据表`36、`字段管理/筛选/新增记录`（mb-iconbtn）36、`视图列表`36、视图 tab 高 34（设备实测）。建议：与 44 Rule 对齐（补命中盒；tab 高度提 44 或加高命中区）。

### C. 交互与一致性
6. **【实锤·中】记录呈现双轨且入口语义无提示**：点**行** = 「记录详情」只读全屏页（卡片式 + 1/4 翻页器）；点**格** = 「编辑记录」Sheet（表单式）。同一记录两套呈现不同构；可编辑表里详情页也恒只读、且用收集表文案解释（与 #1 叠加）。证据：设备截图 + 代码（tr role=row → RecordPage；cell → RecordSheet）。建议：产品裁决——合并入口（点行也开编辑 Sheet，详情页仅留只读场景/收集表），或至少在详情页给「编辑」入口 + 正确只读原因。
7. **【实锤·低】选择器已选区整行可点但无语义**：`BitableSelectControl` 的 `.mbt-select__chosen` 是 div onClick（展开/收起），无 role/键盘可达，只有箭头按钮有语义。建议：行点击保留为便利，但补 `role="button"`+`tabIndex` 或收编进箭头按钮（44 命中盒同 #4 一起做）。
8. **【实锤·中】网格长值截断无提示**：`mobileBitable.css` 51-62 `white-space:nowrap + text-overflow:ellipsis`；多选 chips 溢出被右缘切断（截图 Ccvv 列），看不出"还有更多"。建议：溢出时给渐隐/计数徽标（如 +N）或行点开看全（记录 Sheet 已能看全 ⇒ 至少给 +N 提示）。
9. **【代码层·待复现】单元格按钮 aria-label 只有字段名**：`MobileBitableViewer.tsx:520` `aria-label={field.name}`——同类按钮在行内同名不可区分（无障碍）；当前网格行未见该按钮（另一视图族使用），复现后补值/上下文。建议：aria-label 带记录首列值或字段值。

### D. 已排除（防止误报）
- 网格表头「深灰底」为缩略图对比错觉：computed = `rgb(238,238,238)` 浅灰 + 深字，与 v3 思源一致 ✓。
- 「4 条记录」统计行与底部胶囊无遮挡 ✓。

### E. 优化机会（非缺陷，可选）
- 视图 tab 未选中态为裸文字，与选中胶囊对比略弱（层级可再明确）。
- 统计行右对齐 vs 域内左对齐语言（对齐微调）。
- 记录详情页字段卡与编辑 Sheet 行样式同构性可收敛（共享 mb-set-item 族）。

## 建议落地顺序
1) #4+#7（触控命中盒，半小时级，门禁直接受益）→ 2) #1+#2+#3（文案一次收敛）→ 3) #8（+N 溢出提示）→ 4) #6（需产品裁决入口合并方案）→ 5) #9（复现后修）。
