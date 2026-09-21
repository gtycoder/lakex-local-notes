# 单元格图片 Spike 报告（260921）—— 「自定义 cell 字段能否穿过内核搬运」

> 目的：为「路 2（fork FortuneSheet，让图片进 cell 数据）」做决策依据 —— 判断 **2A（cell 附加字段 + 宿主反推渲染）** 是否成立。
> 方法：① 直接读 FortuneSheet 源码（MIT，`github.com/ruilisi/fortune-sheet`）；② 在用户运行中的实例（CDP 9222，dev server 1421）上用临时探针做运行期验证。
> 结论：**✅ 2A 成立**（**已按 2A 落地，见 HANDOFF §2.21**）。内核把 cell 当作**不透明对象**搬运/原地修改，未知字段（未来的 `cell.img`）能穿过插入/删除行列、编辑、序列化；copy/paste 走 `getdatabyselection`（按引用）+ 写回 cell 对象，跨表同理。**唯一有损路径是 HTML 剪贴板往返**（跨应用粘贴），可接受。

## 1. 运行期实测（isolated probe，临时表 `SPIKE-临时*`，已删除）

| 用例 | 结果 | 证据（cell 对象） |
|---|---|---|
| `applyOp` 注入 `{v,m,__probe}` 后读回 | ✅ 保留 | `{v:"P1",m:"P1",__probe:"P1"}` |
| 在其上方插入 1 行 | ✅ 随内容下移 | 行 8→9：`{v:"P3",m:"P3",__probe:"P3"}`，原 8 行为 null |
| 在其左侧插入 1 列 | ✅ 随内容右移 | 列 2→3：`{v:"P4",m:"P4",__probe:"P4"}` |
| 删除其上方 1 行 | ✅ 随内容上移 | 行 20→19：`{v:"P5",m:"P5",__probe:"P5"}` |
| `wb.setCellValue` 编辑 | ✅ 保留未知字段 | `{v:"edited",m:"edited",__probe:"P6",ct:{fa:"General",t:"g"}}` |
| 序列化（`sheetsToBody`，即保存口径） | ✅ 含 `__probe` | `body().includes("__probe") === true` |
| copy → paste（同表） | ⚠️ 运行期未验完（探针用 `wb.setSelection` 导致选区状态异常、点击坐标拿到 0×0）；**源码判定通过**，见 §2 | — |

## 2. 源码结论（决定性）

- **copy 按引用取 cell**：`packages/core/src/modules/cell.ts:1595 getdatabyselection()` 里 `row.push(d[r][c])`，**不 clone**；跨表时按传入的 `sheetId` 从源表 `data` 取 ⇒ 源 cell 对象（含未知字段）被带到粘贴流程。
- **编辑原地改已有对象**：
  - `cell.ts:137 setCellValue()` → 第 151 行 `let cell = d[r][c]`，只改 `f/ct/v` 等字段，**不换对象**；
  - `cell.ts:683 updateCell()` → 第 723 行 `let curv = flowdata[r][c]`，同样原地改（第 726 行仅 clone 一份给 hook 当 oldValue）。
- **插入/删除行列搬 cell 对象**：`modules/rowcol.ts` 用 `unshift/splice` 移动行/列；列插入是 `d[r].splice(...)`，删除是 `d.splice(...)`/`d[r].splice(...)` ⇒ 整行/整列是**引用移动**（CSP 打补丁那段是 `d.unshift.apply(d, arr.map(JSON.parse))`，JSON 往返同样保留未知字段）。
- **落盘**：`src/core/sheetDoc.ts sanitizeSheetWorksheet()` 只把 `data`→`celldata`、剔运行时字段，`v` 对象原样保留 ⇒ 未知字段进正文。

## 3. 风险 / 未知（2A 落地前要处理）

1. **HTML 剪贴板往返丢字段**：跨应用/跨窗口粘贴时内核解析 HTML 建 cell，未知字段会丢。可接受（同应用内走 `luckysheet_copy_save`，不丢）。
2. **copy/paste 的运行期确认**：本次探针因选格用了 `wb.setSelection`（会把 `luckysheet_select_save` 弄成非数组）而没跑通；2A 落地时应补一个「真实鼠标选区 + Cmd+C/V」的 e2e 断言。
3. **渲染仍要宿主反推**：2A 保留现有 `images[]` DOM 图通道与 `sheetGeometry`，只是把**真相**换成 cell 数据（`onChange` 时从 cell 反推 `images[]` 条目）。需注意「反推 → applyOp → onChange」的环路（同 §2.20 六记的 60fps 死循环教训：值没变要早退）。
4. **正文格式升 v3**：旧表按红线 #7 直接重建，不写迁移。

## 4. 顺带修掉的真 bug（本 Spike 发现）

- 内核 `getSelection()` 在 `ctx.luckysheet_select_save` 非数组时会抛 `TypeError: ...map is not a function`。我们的 `recordClipboardCellImages` / `refreshCellImageMenu` / `selectedAnchor` / `removeCellImageAtSelection` / `pasteClipboardCellImages` 都直接调它 ⇒ 一旦命中，异常冒到 `SheetEditorErrorBoundary`，**整个表格编辑器被卸载**（实测；用户视角就是「编辑器突然没了」）。
- 已修：新增模块级 `safeGetSelection(wb)`（try/catch + `Array.isArray` 兜底空数组），所有调用点改走它；护栏测试断言不再有裸 `getSelection()`。

## 5. 结论与下一步

- **走 2A**：把图片作为 cell 附加字段（建议 `cell.img = { filename, fit }` 或 `cell.ci`），宿主在 `onChange` 时从 cell 数据反推 `images[]` 渲染条目与几何；copy/paste、插入/删除行列、撤销、跨表、序列化全部由内核负责，**结构性**消除现有这一整类 bug。
- 不动 canvas（2B）先不做；若之后要「精确复刻云端、图片编辑控件也由内核画」，再在 vendor 源码里做 2B。
- 预计：vendor 源码 + 构建 1–2 天；数据模型/反推渲染/删旧 hack + e2e 3–5 天。

## 6. 遗留（本次运行在用户实例上产生）

- 回收站里有两个临时表：`SPIKE-临时`、`SPIKE-临时2`（只有 `__probe` 测试数据）。用户可自行清空；应用层没有「按 id 彻底删除」的 API（`purgeTrash` 是整批），故未自动清。
