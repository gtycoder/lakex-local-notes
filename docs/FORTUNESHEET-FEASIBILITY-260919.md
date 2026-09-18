# FortuneSheet 替换 jspreadsheet CE 可行性调研（260919）

> 背景：用户试用 FortuneSheet 后认为「很接近云端 Lake 体验」，要求评估把底层表格编辑器从 CE 换成 FortuneSheet 是否可行。
> 数据均为 **2026-09-19 实取自 npm registry / GitHub API / 真实 tarball**（非印象）。关联：`docs/SHEET-BITABLE-DESIGN-260918.md` §6.1（旧结论需按本文更正）。

## 0. 结论先行

**可行，但必须打一个 CSP 补丁。** 没有任何硬阻塞；除补丁外剩下的都是「集成 + spike 验证」成本。

- **推翻旧结论**：§6.1 因 CSP 把 FortuneSheet「一票否决」。本次逐行核实：全包**只有 3 处 `new Function`**，且只出现在 `insertRowOrColumn`（插入行/列）里，可以用 spread 等价替换（已用 Node 验证等价），走本项目已有的 `patch-package` 套路即可。
- **它正好补上 CE 的短板 + 用户已提的诉求**：单元格换行（原生）、**冻结行/列/两者**（原生工具栏项 + `freeze()` API）、**工具栏可按名配置 + 自定义按钮**、图片 src 支持任意字符串、公式 eval-free、条件格式/批注/查找替换等。
- **代价**：懒加载 chunk ≈ **575 KB gzip**（CE 约 60 KB）；**canvas 渲染 → keep-alive 需 spike**；正文格式整体更换（dev 数据可删可重建，符合 AGENTS §3 #7）；维护转冷（最后提交 2025-12-15，MIT，未归档）。

## 0.1 落地结果（260919，已实现，未提交）

用户拍板后已按本报告执行（分支 `feat/sheet-document` 工作区）：

| 项 | 结果 |
|---|---|
| SPIKE | 真实 Electron + 真 CSP（无 `unsafe-eval`）：渲染 ✅、插行列 ✅（**0 securitypolicyviolation**）、冻结 ✅、隐藏→显示重绘 ✅、0 外部资源 ✅、多行 ✅ |
| CSP 补丁 | `patches/@fortune-sheet+core+1.0.4.patch`（3 处 `new Function` → `apply`）；`postinstall` 追加 `&& patch-package --patch-dir patches` |
| 正文格式 | `src/core/sheetDoc.ts` 升 **v2** = `{kind:"sheet",version:2,sheets:Sheet[]}`；保存时规范化（剔 `luckysheet_select_save` 等运行时字段、dense `data`→sparse `celldata`）并**跳过无变化保存**（防「打开即标脏」） |
| 编辑器 | `SheetEditor.tsx` 重写为 `<Workbook>`；keep-alive「**首次可见才挂载**」（canvas 在隐藏态初始化会量成 0）；只读 `allowEdit=false` |
| 体积 | 懒加载 `SheetEditor-*.js` **580 KB gzip** + CSS 8 KB（CE ≈60 KB；Univer 2.48 MB） |
| 门禁 | `tsc` 0 · `vitest` **1024 passed / 16 skipped (1040)** · 桌面+移动 build 全绿 · `check:bundle` app-js 1.82MB/2.90MB · `check:core` 0 · `git diff --check` 干净 |
| 清理 | 删 CE 依赖 `jspreadsheet-ce`/`jsuites`、CE 的 Material Icons 字体资源、全部 spike 文件 |
| 兼容 | v1（CE）正文 parse 返回 null → 空表打开（AGENTS §3 #7，不写兼容） |

**首轮 UI 优化（260919，用户实测 5 点后）**：

| 用户反馈 | 根因 | 处理 |
|---|---|---|
| sheet1 只到 H 列 / 滚动条不在最右 / 页面像没占满 | `emptySheetBody` 写死 `column:8,row:30` → canvas 只按 8 列算宽（976px < 容器 1202） | 已改为**不写 row/column**，用 FortuneSheet 默认（60 列×84 行）。⚠️**仅对新建表生效**，旧测试表需重建 |
| 「添加 N 行」的【50】框边框很重 | FortuneSheet 自带 `<input>` 无 class、无任何 CSS 命中 → 吃浏览器默认 `2px inset` | `sheetEditor.css` 补 `.luckysheet-bottom-controll-row input` 弱边框（1px + 3px 圆角） |
| 自动换行不能用 | 默认是「溢出」，不是自动换行 | 实测**可用**：工具栏「文本换行 → 自动换行」，单元格内换行 + 行高自适应 |
| 工具栏没占满 / 左上角重边框 | 与「canvas 只 8 列宽」同源（整页观感错位）；换行/输入上表已述 | 新表下工具栏满宽 1202、canvas 满宽、竖向滚动条在最右、左上角正常 |

**第二轮 UI 优化（260919，用户再报 3 点）**：
- **右键菜单输入框**（行头「向上/向下插入 N 行」「行高 N px」）：与「添加 N 行」同源——FortuneSheet 只给了 width/居中、**没给边框** → 浏览器默认粗边框。已补 `.sheet-editor .fortune-context-menu input, .sheet-editor .luckysheet-cols-menu input` 弱边框。
- **工具栏精简**：用 `Settings.toolbarItems` 白名单，只留高频 18 项（撤销/重做 · 字体/字号 · 粗斜删下 · 字色/背景 · 水平/垂直对齐/自动换行 · 边框/合并 · 冻结/求和 · 更多）；隐藏格式刷/清除格式/货币/百分比/小数/自动格式/文本旋转/条件格式/筛选/链接/图片/批注/数据校验/分列/定位/截图。**实测可见项 = 18**。
- **默认 110% 缩放**：`SheetEditor.initialSheets` 给缺省 `zoomRatio` 补 **1.1**（已有值不覆盖，尊重用户改过的缩放）。**实测状态栏显示 110%**。

**第三轮（260919，用户定稿）**：
- **默认自动换行**：FortuneSheet 无全局默认 wrap（cell 级 `tb`；`"2"`=wrap、`"1"`=overflow、`"0"`=clip）。做法：`initialSheets` 给已有内容单元格补 `tb:"2"`，并用 `hooks.afterUpdateCell` 给新编辑单元格补（**只补缺省、不覆盖显式设置**）。**实测**：A1 打 30 个 W → 自动折成 2 行。
- **默认 20 列**：`emptySheetBody` 加 `column: 20`（行数用 FortuneSheet 默认）。
- **工具栏增减**：增加 `format-painter / clear-format / conditionFormat / filter / image / locationCondition`；**移除 `font`**（默认用全局字体、不可改）。实测工具栏含：格式刷/清除格式/条件格式/排序和筛选/插入图片/定位条件，且无「字体」。
- **默认全局字体**：`ff` 缺省时补 app 的 `--b3-font-family` 栈（`BlinkMacSystemFont,"Segoe UI","PingFang SC",…`）；既不放「字体」下拉，也不改已显式设置过字体的单元格。

**第四轮（260919）：自动换行 + 行高自适应（用户报「换行了但行高没涨」）**
- **根因**：FortuneSheet 的行高自适应只在 `updateCell`（值更新）里跑，且条件为 `curv?.tb === "2" && curv.v`——即「**旧**单元格已带换行且有值」时才调；**首次录入空单元格** `curv.v` 为空 ⇒ 不调；且该段还需要 `canvas`，公开 API（`setCellValue`/`setCellFormat`）不带 canvas，触发不到。
- **做法**：`hooks.afterUpdateCell` 里补 `tb:"2"`/`ff` 后，用**离屏 canvas 按列宽估算行数**（`estimateWrappedRowHeight`），超过当前行高就 `wb.setRowHeight({[row]: needed})`。实测 A3 打 44 个字符 → 行高 `config.rowlen={"2":…}`，换行内容完整可见（估算略宽松，宁可多留不可裁切）。

**第五轮（260919）：工具栏/公式栏/图片**
- **工具栏再减**：去掉 `conditionFormat`（条件格式）与 `locationCondition`（定位条件）。
- **工具栏更紧凑**：`.sheet-editor .fortune-toolbar` 收内边距（`5px 0 3px 15px` → `2px 0 2px 8px`）、按钮/分隔线间距与高度收小。实测高度 **41px → 33px**。
- **公式栏去掉**：`<Workbook showFormulaBar={false}>`（源码原生支持）。实测 `.fortune-formula-bar` 不再存在。
- **图片插入**：
  - **本地文件**：工具栏「插入图片」= 隐藏的 `<input id="fortune-img-upload" type="file">`（源码在工具栏项里渲染），点击→原生选文件→FileReader→`insertImage`→写入 `sheet.images`。**实测通过**：正文出现 `images:[{id,src:"data:..."}]`，DOM 出现对应 `<img>` 覆盖层（`complete:true`、有尺寸）。
  - **复制粘贴图片**：FortuneSheet 的 `onPaste` **只读 `text/html`/`text/plain`，不处理剪贴板图片** ⇒ 粘贴图片不生效（源码限制）。要支持需自己挂 paste 拦截器（把 `clipboardData.items` 里的图片转 data URL 再 `insertImage`）。

**第六轮（260919）：跨表图片 bug + 默认尺寸 + 标签样式**
- **图片插错表格（严重，已修）**：FortuneSheet 图片按钮用固定 id `fortune-img-upload` + 全局 `document.getElementById` 选文件，而 keep-alive 让多个表格同时挂载 ⇒ 永远命中第一个（别的表格），图片串表。修法：`SheetEditor` 按 `visible` 只让可见实例保留该 id，隐藏实例摘掉 id。**实测**：两表同挂时 `withId=1/hidden=1`，在 B 表插入 → 图进 B 表。
- **默认网格**：`column:15, row:50`（原 20 列 / 默认 84 行）。
- **工作表标签样式**：曾覆盖为透明底 + accent 线，**260919 用户要求回滚**（保留 FortuneSheet 默认的 `#efefef`/29px 观感）。
- **图片是浮动图**：FortuneSheet 只支持浮动图（`sheet.images` overlay），没有单元格图片（`Cell` 无图片字段）；要做单元格图只能自研。
- **全选角（左上角）边框**：由内核 canvas 直接绘制，CSS 覆盖不到；属内核默认观感。

**第七轮（260919）：patch react，精准定位图片 input**
- **根因**：FortuneSheet 图片按钮用全局 `document.getElementById("fortune-img-upload")` 选文件；keep-alive 多实例 ⇒ 命中第一个（别的表）。
- **修法**：patch `@fortune-sheet/react@1.0.4`（`patches/@fortune-sheet+react+1.0.4.patch`），按钮 onClick 改为点击**自己的子 input**（`e.currentTarget.querySelector('input[type=file]')`），彻底不依赖全局 id；两个 dist（`index.js`/`index.esm.js`）都改。
- **实测**：同文档挂 **3 个**实例，插入图片仍进**当前可见**表（不再串表）。之前的 visibility id 补丁已删除。
- **图片独立管理**：已立项，规范见 `docs/SHEET-IMAGE-MANAGEMENT-260919.md`（P1 浮动图独立资产 ~1–1.5 天；P2 单元格图 ~3–5 天）。

**第八轮（260919）：修「窗口被表格异常打崩」（内存正常，非 OOM）**
- **现象**：编辑单元格时窗口整个崩掉；日志 `Uncaught TypeError: Cannot read properties of undefined (reading '2')`，栈在 `setCellFormat`。
- **根因**：内核 `setCellFormat` 用 `var targetSheetData = sheet.data;` 后直接 `targetSheetData[row][column] = cellData;`，**不判空**（对比 `setCellValue` 会走 `getFlowdata` + `if (!d) return`）。当 `currentSheetId` 指向的表没有该行（空表/切表瞬间）⇒ `sheet.data[row]` 为 undefined ⇒ 抛错。且该赋值发生在 `setContext` 的 updater 里，**不在我的 try/catch 里**，直接被 React 冒泡成未捕获错误 → 渲染树卸载 → 窗口崩。
- **修复**：
  1. **patch core**（`patches/@fortune-sheet+core+1.0.4.patch`，现 4 个 hunk）：`setCellFormat` 里补 `if (targetSheetData == null || targetSheetData[row] == null) return;`。
  2. **加错误边界**（`MultiTabEditor.tsx` 的 `SheetEditorErrorBoundary`，按 tab 隔离）：单个表格再出渲染/状态异常只显示占位，不再拖崩整个窗口。
- **实测**：连打多行编辑 → 无异常，`tb:"2"` + `rowlen` 照常写入。

**第九轮（260919）：编辑态宽度按「文本换行」语义约束**
- **语义**（用户定，与云端一致）：`tb==="1"`（溢出）→ 编辑框也允许溢出；`tb==="0"`（截断）/ `tb==="2"`（自动换行）/ 未设（默认=换行）→ 编辑框宽度限制在单元格内，截断不折、换行折行。
- **根因**：编辑框 `.luckysheet-input-box-inner` 只有 `min-width: 单元格宽`、没有 `max-width`（CSS 给到 9900px），内容一宽就横向铺开盖住邻格。
- **修法**：patch `@fortune-sheet/react` 的 InputBox（`patches/@fortune-sheet+react+1.0.4.patch`，现 4 hunk），在 inner style 里按 `cell.tb` 追加 `width/maxWidth = firstSelection.width` + `whiteSpace`。
- 注：也试过在 core `getStyleByCell` 注入（`inputBoxStyle` 来源），但编辑态该 memo 常返回 `{}`，不生效；故改在 InputBox 直接注入。
- **实测**：编辑 `tb:"2"` 单元格 → 编辑框 `max-width: 80px`（=单元格宽）、`pre-wrap`，文字在格内折行、不再覆盖 B/C/D 列。

**剩余（待用户验收）**：真机点一遍；旧表（8 列/无 zoomRatio）以新建为准；图片独立管理按上述规范分阶段做；全选角边框不改。

## 1. 事实（可核对）

| 项 | 值 | 来源 |
|---|---|---|
| 版本 | `@fortune-sheet/core` = `@fortune-sheet/react` = **1.0.4**（latest） | `registry.npmjs.org/@fortune-sheet%2Fcore` |
| 许可 | **MIT** | 同上 |
| 发布时间 | `time.modified = 2025-11-06` | 同上 |
| GitHub | ★3722 · fork 314 · open issues 94 · `pushed_at=2025-12-15` · `archived=false` · MIT | `api.github.com/repos/ruilisi/fortune-sheet` |
| 依赖（core） | `@fortune-sheet/formula-parser`, dayjs, immer@9, lodash, numeral, uuid@8 | package.json |
| 依赖（react） | core + immer/lodash + regenerator-runtime；peer `react>=18.2` | package.json |
| 体积（dist 实测） | core esm raw 3147KB / **gzip 486KB**；react esm raw 470KB / **gzip 80KB**；react css raw 63KB / **gzip 9KB** ⇒ **≈575 KB gzip** | `gzip -9` 实测 tarball |

> npm registry 在本机指向私有镜像 `https://npm.weizhipin.com/`（`npm view` 无响应）；本文用 `curl https://registry.npmjs.org/...` 直取。

## 2. CSP（决定性项）—— 旧「出局」理由不成立

- 全包 grep：**只有 3 处 `new Function`，无 `eval(`**。其余 `Function(` 命中全是误报（`isFunction(`、`searchFunction(`、`runExecFunction(`、`GeneratorFunction(`）。
- 位置（core dist，`insertRowOrColumn`）：
  ```js
  if (direction === "lefttop") {
    if (index === 0) new Function("d", "return d.unshift(" + arr.join(",") + ")")(d);
    else             new Function("d", "return d.splice(" + index + ", 0, " + arr.join(",") + ")")(d);
  } else             new Function("d", "return d.splice(" + (index + 1) + ", 0, " + arr.join(",") + ")")(d);
  ```
  行号：`core/dist/index.js:65802/65804/65807`、`core/dist/index.esm.js:65792/65794/65797`。`arr` = `row` 的 `JSON.stringify` 数组。
- **等价替换（无 eval）**（已用 Node 对 4 种 index/direction 组合验证输出一致）：
  ```js
  const items = arr.map(JSON.parse);
  if (direction === "lefttop") { if (index === 0) d.unshift(...items); else d.splice(index, 0, ...items); }
  else d.splice(index + 1, 0, ...items);
  ```
- 公式引擎：`@fortune-sheet/formula-parser`（打包进 core）**无 eval / new Function**。
- 外部资源：react `index.css` **0 个外链、0 个 `@font-face`**（图标走 SVG，见 react `components/SVGDefines`）；JS 里的 `http://www.google.com/`、`http://www.luckysheet.com/` 只是**公式示例字符串**，不请求。

⇒ 在「prod CSP 不含 `unsafe-eval`」下，**打补丁后 FortuneSheet 可用**。

## 3. 能力对照（重点看用户诉求）

| 能力 | jspreadsheet CE（现状） | FortuneSheet |
|---|---|---|
| 单元格内换行 | 需列级 `wordWrap` + 自写撑高 | **原生** |
| 冻结 | 只有 `freezeColumns`，实测 init/选格/tableOverflow 都不生效 | **`freeze("row"\|"column"\|"both")` + 内置工具栏项 `freeze`** |
| 工具栏 | 数组可覆盖，但默认项 `onclick` 不暴露、自建=重写动作 | **`toolbarItems?: string[]`（按名保留/排序）+ `customToolbarItems`（自定义按钮）** |
| 图片 | 只认 `data:image`（base64） | `Sheet.images: {src,...}[]`，src 任意字符串（URL 可用性待 spike） |
| 公式 | 单表；会 eval（已关） | 内置、eval-free |
| 合并/排序/筛选/条件格式/批注/查找替换 | 基础 | 更全 |
| 只读 | 自己屏蔽 pointer-events | **`Settings.allowEdit: false`** |
| 数据模型 | dense `data[][]` | **sparse `celldata[{r,c,v}] + config`**（正文更小） |
| 渲染 | DOM table（keep-alive 友好） | **canvas（keep-alive 需验证）** |

关键 API/类型（`@fortune-sheet/react` 的 `Workbook`）：
```ts
type AdditionalProps = { onChange?: (data: Sheet[]) => void; onOp?: (op: Op[]) => void };
// ref: freeze(type, range) / insertRowOrColumn / deleteRowOrColumn / setRowHeight / setColumnWidth /
//      getAllSheets / getSheet / updateSheet / handleUndo / handleRedo / scroll ...
type Settings = { data: Sheet[]; allowEdit?; showToolbar?; showFormulaBar?; showSheetTabs?;
                  toolbarItems?: string[]; customToolbarItems?: {...}[]; hooks?: Hooks; ... };
type Sheet = { id?; name; celldata?: {r,c,v}[]; config?: SheetConfig; images?: Image[]; frozen?: {...}; ... };
```

## 4. 集成改造清单

| 文件 | 改动 |
|---|---|
| `package.json` | 加 `@fortune-sheet/react`（peer react 18.3 已有）；`patch-package` 补丁 3 处 `new Function` |
| `src/core/sheetDoc.ts` | `SheetDoc` 由 CE 快照换成 FortuneSheet workbook（`{kind:"sheet",version,sheets: Sheet[]}`）；`emptySheetBody`/`parseSheetBody`/`sheetToSearchText` 改（对抽取文本遍历 celldata） |
| `src/features/sheet/SheetEditor.tsx` | 整体重写：`<Workbook ref data onChange allowEdit showToolbar toolbarItems>`；autosave 用 `onChange` 防抖；`readOnly → allowEdit:false` |
| `src/features/editor/MultiTabEditor.tsx` | 懒加载路径不变（仍 `SheetEditor`），key/reloadKey 语义沿用 |
| `src/features/sheet/sheetEditorMount.test.ts` | 改成 FortuneSheet 版或删 |
| `electron/store.ts` | `searchTextFor` 调 `sheetToSearchText`，接口不变 |
| 旧 `sheets/*.sheet.json` | 按红线 #7 **直接删库重建**，不写兼容 |
| 文档 | `SYNC-PROTOCOL`/`STORAGE-LAYERS`（表格正文格式）、设计文档、HANDOFF；`cssLayers`（第三方 CSS）、`check:bundle`（懒加载 chunk 体积） |

## 5. 风险 / 必做 spike（按重要性）

1. **canvas + keep-alive（最大风险）**：本项目所有 tab 常驻 DOM、用 `fn__none` 隐藏 → 0 尺寸；canvas 系编辑器在隐藏容器里初始化后再显示**可能空白**（Univer 同坑）。spike 必测「隐藏→显示是否自动重绘；不行就在 show 时触发 refresh / remount」。
2. **CSP 补丁生效性**：真实 Electron + 真 CSP 下，插入行列不产生 securitypolicyviolation。
3. **受控数据回环**：`data` + `onChange` 若每次回写可能光标跳动/重渲染（Luckysheet 系典型坑）；确认推荐用法（初始 data + onChange 取最新 + 仅在 reload 时换 key）。
4. **React StrictMode 双挂载**：canvas 初始化是否会重复/错乱。
5. **图片 URL**：资产 URL（`http://127.0.0.1:19876/{noteId}/{file}`）能否渲染；若走 base64 则与 CE 同样的体积问题。
6. **离线**：运行时 0 外部请求（CSS 已确认 0 外链/0 字体；图标 SVG）。
7. **维护冷**：pin `1.0.4` + patch，留意 94 open issues 是否有致命项。
8. **体积**：懒加载 chunk +≈575 KB gzip；`scripts/check-bundle-budget.mjs` 目前只卡主 chunk，需给懒加载 chunk 加预算。

## 6. 建议

- 若「体验优先于体积」且接受打补丁：**可以换**。分两步落地：
  1. **Spike（0.5–1 天）**：spike 页 + 真 CSP，验证 §5 的 1/2/3/5，并量出真实 gzip chunk；
  2. 通过后整体替换 `SheetEditor` + `sheetDoc` + 测试 + 文档（约 2–4 天，含回归）。
- 若不接受第三方补丁/维护冷：维持 CE（但冻结/工具栏/换行体验差），或回到 §6.1 原推荐 Univer（更重但更活）。
- 折中：CE + 自研 sticky 冻结 + 自写非 eval 公式（§6.1 备选）——体验仍不如 FortuneSheet。

## 7. 与旧结论的关系（必须更正）

`docs/SHEET-BITABLE-DESIGN-260918.md`：
- 第 240 行「FortuneSheet 出局 …… 插入行列用 `new Function` → 被 CSP 拦」⇒ **前提正确，但结论应改为「可打补丁后使用」**。
- 第 322 行「FortuneSheet 1.0.4 | 3 new Function（core）| 插入行列 | ❌ 插行列即崩」⇒ 同上：**"即崩"只发生在不打补丁时**。

## 8. 证据索引

- npm：`https://registry.npmjs.org/@fortune-sheet%2Fcore`、`.../@fortune-sheet%2Freact`
- GitHub：`https://api.github.com/repos/ruilisi/fortune-sheet`
- 源码（`@fortune-sheet/core@1.0.4`）：`dist/index.esm.js`（`new Function` @2248536/2248629/2248748；`handleFreeze` @2367830）、`dist/settings.d.ts`（`allowEdit/toolbarItems/customToolbarItems/hooks`）、`dist/modules/freeze.d.ts`、`dist/modules/toolbar.d.ts`、`dist/types.d.ts`（`Sheet/Image/frozen/celldata`）
- react（`@fortune-sheet/react@1.0.4`）：`dist/components/Workbook/index.d.ts`（props + ref API）、`dist/index.css`（0 外链）
- 本仓库现状：`src/features/sheet/SheetEditor.tsx`、`src/core/sheetDoc.ts`、`docs/SHEET-BITABLE-DESIGN-260918.md` §6.1
