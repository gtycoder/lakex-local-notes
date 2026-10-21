# USHEET（Univer 表格）依赖升级规范与路线

> 适用对象：`kind=usheet` 的表格 —— 桌面 `src/features/usheet/UniverSheetEditor.tsx` 与移动端
> `src/mobile/usheet/MobileUsheetViewer.tsx` 用的是**同一套内核**（`@univerjs/*`）。
> 本文是**长期规范**：依赖怎么锁、升级怎么做、我们依赖内核的哪些行为、升级后跑什么、坏在哪怎么退。
>
> 配套三件：
> - `src/features/usheet/usheetKernelContract.ts`：触点清单（常量 + 每条"失效会怎样"）
> - `src/features/usheet/univerContract.test.ts`：静态护栏（`npm test` 时对着实装内核产物核对版本与符号）
> - `scripts/usheet-kernel-probes.mjs`：运行时探针（真 Electron + CDP，一条命令跑完）
> 已核实的内核行为契约见 `docs/LAKEX-CONTRACT.md` §5.25 / §5.26。

## 1. 依赖面

| 包 | 版本 | 说明 |
| --- | --- | --- |
| `@univerjs/presets` | 1.0.3（**精确锁**） | `createUniver` / facade 基座 |
| `@univerjs/preset-sheets-core` | 1.0.3（**精确锁**） | 表格核心 preset（含 footer/工具栏/公式栏配置） |
| `@univerjs/preset-sheets-drawing` | 1.0.3（**精确锁**） | 图片（单元格图 + 浮动图） |
| `@univerjs/engine-render` | 1.0.3（**精确锁**，**必须显式声明**） | 只为一个用途：收起/展开工具栏后调**渲染单元**的 `engine.resize()` |
| `@univerjs/sheets-sort` | 1.0.3（**精确锁**） | 排序**数据层**（`sheet.command.sort-range`；只重排 cellData，不写任何快照字段） |
| `@univerjs/sheets-sort-ui` | 1.0.3（**精确锁**） | 排序 **UI**：桌面 = `UniverSheetsSortUIPlugin`（ribbon「数据」页签）/ 移动 = `UniverSheetsSortMobileUIPlugin` |
| `@univerjs/sheets-filter` | 1.0.3（**精确锁**） | 筛选**数据层**（`sheet.command.set-filter-range` / `set-filter-criteria` / `remove-sheet-filter`） |
| `@univerjs/sheets-filter-ui` | 1.0.3（**精确锁**） | 筛选 **UI**：桌面 = `UniverSheetsFilterUIPlugin`（ribbon + 列头下拉）/ 移动 = `UniverSheetsFilterMobileUIPlugin`（筛选抽屉） |

- **engine-render 为什么要显式声明**：它被 presets 传递依赖；如果解析出**两份副本**，
  `injector.get(IRenderManagerService)` 会拿到另一个 token 的实例 ⇒ 重排**静默失效**（画布不跟手）。
- 间接依赖约 25 个 `@univerjs/*`（`sheets` / `sheets-ui` / `sheets-drawing-ui` / `core` / `ui` …）必须与上面同版本；
  **例外**：`@univerjs/icons` 是独立发版线（当前 1.43.x），不参与同版本约束。
- **有一个 Univer 补丁**：`patches/@univerjs+ui+1.0.3.patch`（261009 起，唯一一个；改的是内核 floating 层的挂载点，
  理由与升级动作见 **§4.7**）。除这一处外**不要再给 Univer 打 patch**：`patch-package` 的其余用途仍是
  `@plait/draw`（`patches/`）与 `@xiangfa/mindmap`（`vendor/lakex-doc-react/patches/`）。

**我们集成的面**（升级时要一起想）：

| 面 | 落点 |
| --- | --- |
| 正文格式 | `core/usheetDoc.ts`（`{kind:"usheet",version:1,workbook:IWorkbookData}`，纯文本 JSON） |
| 编辑器接线 | `features/usheet/UniverSheetEditor.tsx`（preset 配置、命令、菜单、粘贴、主题、几何实测） |
| 主题桥 | `features/usheet/univerTheme.ts`（`--lake-*` → Univer Theme）+ `themes/kernel-theme.css` |
| 内核覆盖 CSS | `features/usheet/usheetEditor.css`（两处，见 §4.3） |
| 默认尺寸 | `core/usheetDoc.ts` 的 `USHEET_DEFAULT_ROWS/COLUMNS`（**单一来源**） |
| 移动端 | `mobile/usheet/MobileUsheetViewer.tsx`（共用正文解析/主题/footer 配置；自绘 chrome 见 `usheetChromeModel.ts`） |
| 排序/筛选插件 | 桌面 `features/usheet/univerSortFilter.ts`（桌面 UI 变体）/ 移动 `mobile/usheet/mobileSortFilter.ts`（**移动 UI 变体**）；数据插件两端必须都装 |

## 2. 硬规则（违反即埋雷）

1. **所有 `@univerjs/*` 精确锁版本**（不许 `^` / `~` / `*` / `latest`）；presets 与 engine-render 必须同一版本。
2. **一次全升**：不许只升一个包（会出现两份 `@univerjs/core`）。
3. **升级用 `npm install` 走 lockfile**，不要 `npm update`（`update` 会按 semver 漂移）。
4. **任何内核触点的新增/改动**（命令 id、菜单 id/路径、配置键、DOM 钩子、行内样式）必须同步
   `usheetKernelContract.ts` + 本文 §4；否则 `univerContract.test.ts` 会红。
5. 内核覆盖只允许写在 `features/usheet/**` 自己的文件里，**每条必须写明理由**（AGENTS §3#14 的例外口径）。
6. 正文格式若要变，先在 `LAKEX-CONTRACT` 记录新形态 + 写一次性转换脚本，**不做运行时兼容层**（数据只有一份）。

## 3. 升级 playbook

```bash
# 0) 读 release notes，确认目标版本；开分支（或 worktree），不要在 master 上试
# 1) 改 package.json 的 4 个版本号（全部同一个目标版本），重新装
npm install                     # 用 lockfile 语义安装，不要 npm update
# 1b) 确认我们的 Univer 补丁仍应用成功（§4.7）。⚠️ 本机安装时 patch-package 失败**不会**以非零码退出，
#     必须自己看输出；CI / NODE_ENV=production 才会让安装直接失败。
npx patch-package --patch-dir patches
# 2) 静态护栏：版本一致性 + 触点符号存在性
npx tsc --noEmit && npm test
# 3) 运行时探针（真实 Electron + CDP；先 build，探针只读 dist）
npx vite build
node scripts/usheet-kernel-probes.mjs          # 退出码 0 = 致命项全过
node scripts/usheet-kernel-probes.mjs --strict # 连"提示项"也当失败（有 OS 焦点时跑更稳）
# 4) 全量门禁
node scripts/ui-metrics.mjs && npm run check:core && git diff --check
npx vite build && npx vite build -c vite.mobile.config.ts
node scripts/check-bundle-budget.mjs
```

5) **人工走查**（真实端，约 10 分钟；探针覆盖不到的交互）：

- 打开表格 / 新建表格（默认 **50 行 × 16 列**）；工作表标签「＋」新建（同样 50×16）
- 粘贴：截图（单图）→ **落单元格图片**；一次多图 → 浮动图且两张都在
- 单元格右键 → 插入 → **插入单元格图片** → 选图 → 落进当前格
- 工具栏：收起/展开（画布要跟着重排）、图片入口两项目、右键粘贴仍可用
- 计算条与状态栏：计算条 30px、状态栏紧贴其上方 4px 缝
- 主题切换（浅/深/暖）后表格配色与字体跟随；切标签来回不重建、不空帧
- 只读：锁定文档、回收站文档、历史快照预览（无工具条、粘贴无效）
- 移动端：模拟器打开同一篇表格（只读、无工具条/公式栏、图片能显示）

6) **提交纪律**：升级单独一个 commit，body 里贴探针输出 + 全量门禁结果（便于回滚定位）。
7) **回滚**：`git revert <升级 commit>` + `npm ci`；若已产生过新格式正文，先按 §6 处理。

## 4. 触点清单（升级时逐条核对；=`usheetKernelContract.ts`）

### 4.1 命令
| 符号 | 用途 | 失效表现 |
| --- | --- | --- |
| `sheet.command.insert-float-image` | 内核图片粘贴钩子的目标命令；也是"多图/无选区"的兜底路径 | 多图粘贴什么都不发生 |
| `sheet.command.insert-cell-image` | 工具栏「单元格图片」菜单项（我们重映射到自有命令） | 插图入口退回内核 blob 流程（正文出现 blob:/data:） |
| `sheet.command.insert-sheet` | 工作表标签「＋」 | 新建工作表不可用 |
| `sheet.command.sort-range` | **排序实现命令**（无参的 `-asc`/`-desc` 是 sort-ui 的 UI 包装，会弹"是否扩展选区"对话框 ⇒ 我们不用） | 排序点了没反应或弹桌面对话框 |
| `sheet.command.set-filter-range` / `set-filter-criteria` / `remove-sheet-filter` | 筛选数据层（`smart-toggle-filter` = 无参切换） | 筛选范围建不起来 / 跨端筛选状态不一致 |
| `sheet.operation.open-filter-panel` | 打开筛选面板（参数 `{unitId,subUnitId,col}`，**要求 filter 已存在**） | 移动端「筛选」只建范围、面板不弹（261021 踩过） |

### 4.2 菜单与配置
| 符号 | 用途 | 失效表现 |
| --- | --- | --- |
| `sheet.menu.cell-insert` + `contextMenu.mainArea` + `contextMenu.layout` | 右键「插入」子菜单的挂载路径（`createMenu().appendTo([...])`，**逐段单个 key**） | 「插入单元格图片」消失 |
| `sheets-ui.config` / `addSheetButtonConfig.`{`defaultRowCount`,`defaultColumnCount`} | 「＋」新建工作表的默认尺寸（内核默认 1000×20） | 新工作表又变 1000×20 |
| footer 的 `sheetBar` / `statisticBar` / `menus` / `zoomSlider` | 我们显式给全，避免只传 `addSheetButtonConfig` 把默认关掉 | 底栏组件消失 |
| `sheet.menu.paste`、`sheet.command.set-range-font-family`、`sheet.command.numfmt.set.{percent,currency}`、`base-ui.operation.toggle-shortcut-panel` | 「开始」页签里隐藏的 5 项（⚠️ 只藏该位置专属 id） | 多余工具又出现 / 右键粘贴被误伤 |
| `ribbon.data` / `ribbon.data.organization` | 排序/筛选**自动**挂进「数据」页签（`order`：筛选 2 / 排序 3）；**我们不自建菜单** | 整条排序/筛选能力静默消失（探针会红） |

### 4.3 DOM 钩子与 CSS 覆盖（`features/usheet/usheetEditor.css`）
| 钩子/规则 | 用途 | 失效表现 |
| --- | --- | --- |
| `[data-u-comp="ribbon-toolbar"]` | 「收起/展开」按钮定位（实测写 `--usheet-ribbon-toggle-top`）+ 右侧让位 `padding-right: 50px` | 按钮错位 / 「更多」与按钮重叠 |
| `[data-u-comp="ribbon-header-menu"]` | 收起时 `display:none` 藏页签行 | 收起无效 |
| `section:has([data-u-comp="slide-tab-bar"])` | **覆盖内核写进 element 的 inline `height:36px`** → 压到 30px（唯一 `!important`，理由写在规则处） | 计算条回到 36px、状态栏缝变 8px（探针第 2 条会红） |
| `[data-u-comp="slide-tab-bar"]` 的 `padding-block: 1px` | 让 28px 标签装进 30px | 标签被压扁 |
| `[data-u-comp="defined-name"]` / `render-canvas` / `sheet-bar-append-button` | 探针用（就绪判定 / 网格画布 / 「＋」） | 探针失败（不影响产品） |
| `sort-panel-item-handler` / `sheets-filter-panel` | 桌面排序面板 / 筛选面板（探针定位） | 探针失败（不影响产品） |
| `mobile-sheets-filter-drawer`（内含 `mobile-sheets-filter-by-values` / `-by-conditions`） | 移动端筛选抽屉（值/颜色/条件/清除筛选） | 移动端筛选面板不出现（261021 设备实测） |

### 4.4 正文格式（升级**最大**风险点）
- 正文 = Univer 的 `IWorkbookData` 快照（`Workbook.save()` 的结果）原样存 JSON，打开时原样喂 `createWorkbook`。
- **单元格图片** = `cellData[r][c].p` 里的**内联 drawing**（`drawingType: DRAWING_IMAGE` / `layoutType: INLINE`）；
  **浮动图** = `workbook.resources` 里 `SHEET_DRAWING_PLUGIN` 的 `data`。
- 图片 `source` 的**磁盘口径 = 资产 filename**（打开时换成本机 AssetServer URL）——由 `mapUsheetImageSources` 双向映射。
- 单元格图片是**整格覆盖**语义：一格只能一张，第二张替换第一张；格内原有文字 `v` 仍在数据里但被富文本渲染顶掉（实测，见 §5.26）。
- **筛选（261021 P5）= 新增一条 plugin resource**：`workbook.resources[]` 出现
  `{name:"SHEET_FILTER_PLUGIN", data:"{<sheetId>:{ref:{startRow,startColumn,endRow,endColumn},filterColumns:[...]}}"}`。
  `FWorkbook.save()` 会把**每个已注册资源 hook 无条件 toJson 并整份覆盖 `resources`** ⇒ 三条后果：
  1. 升级后**首次保存**会多一条空壳（无筛选时 `data:"{}"`）⇒ 一次内容 hash 变化/一次上传，之后稳定；
  2. **两端必须都装 `UniverSheetsFilterPlugin`**，否则没装的一端保存会**静默抹掉筛选条件**；
  3. 两端插件**注册顺序必须一致**（现在都是 sort→sortUI→filter→filterUI），否则每次保存字节不同 ⇒ 假冲突。
- **排序不写任何字段**（只重排 `cellData`）；但含**浮动图**的行被排序后，浮动图不随之移动（它锚在 canvas 坐标上）⇒ 走查要覆盖。

### 4.5 facade / 引擎
| API | 用途 | 注意 |
| --- | --- | --- |
| `createMenu({id,title,icon,action,order}).appendTo(path)` | 右键菜单加项；`action` 传命令 id = **复用已注册命令** | 必须**作为方法调用**（解构会丢 `this` → `_injector` undefined，实测踩过） |
| `updateMenuConfig({...})` | 重映射/隐藏菜单项 | 只改配置，不新增项 |
| `workbook.getActiveSheet().getActiveRange().insertCellImageAsync(url)` | 插入单元格图片 | 无活动单元格时返回 null ⇒ 我们的落点判据回退浮动图 |
| `worksheet.setRowCount(n)` / `getMaxRows()` | 需要时改行数 | 会进撤销栈 |
| `Workbook.save()` / `setEditable()` | 序列化 / 只读 | 见 §4.4 |
| `IRenderManagerService.getRenderAll()[*].engine.resize()` | 收起工具栏后重排画布 | `defaultEngine.resize()` 实测是 no-op；两份副本 ⇒ 静默失效 |

### 4.6 已核实的内核行为（避免重复踩坑）
- 剪贴板钩子 `onPasteFiles` **无条件**返回浮动图命令；`_executePaste` 是"所有钩子 mutations 串起来执行"的**聚合语义**
  ⇒ 加钩子会双插，只能在 DOM 层（window 捕获）拦纯图片粘贴。见 LAKEX-CONTRACT §5.25。
- 单元格图片整格覆盖 / 一格一张 / 文字被顶掉：§5.26。
- 计算条高度是**行内样式**（不是类也不是变量）⇒ 只能 `!important` 覆盖。

### 4.7 我们打的补丁（`patches/@univerjs+ui+1.0.3.patch`）

| 改了什么 | 为什么 | 失效表现 | 谁守它 |
| --- | --- | --- | --- |
| `DesktopWorkbenchContent` / `MobileWorkbench` 里 floating 层的 portal 容器：`document.body.appendChild(portalContainer)` → `mountContainer.appendChild(portalContainer)`；卸载 `document.body.removeChild(...)` → `portalContainer.remove()`；并加 `data-lake-univer-floating` 标记 | 内核把 floating 层（`CanvasPopup`：cell popup、**CellAlert 警告徽标（黄叹号）**、下拉/日期/颜色/选区浮层）**无条件挂到 `document.body`** ⇒ 它不在标签宿主里：我们 keep-alive 的 `opacity/visibility` 隐藏对它无效，而内核自己"看不见就隐藏"的判据读的是**画布 rect**（`visibility:hidden` 的元素 rect 仍有效）⇒ 切文档后浮层残留、层级高于内容（用户 261009 报：黄叹号盖住一切、切文档也盖不住） | `document.body` 下重新出现该容器 ⇒ 浮层又能逃出标签宿主 | `univerContract.test.ts`（护栏③：补丁形态）+ `scripts/usheet-kernel-probes.mjs`（容器在宿主内 / 切走后不可见） |

- **只改 `lib/es/index.js`**（`module` / `exports.import` 入口，app / 移动端 / vitest 都走它）；`lib/cjs` 未改（当前没有 CJS 消费者）。
- **重生成**：改完 node_modules 后执行 `npx patch-package @univerjs/ui --patch-dir patches`，然后跑探针 + 全量门禁。
- **升级时它会怎样**（patch-package 8.0.1 实测行为）：
  1. 这段代码上下文没变 → 补丁自动应用成功，只多一条 version-mismatch 警告（默认不阻塞）⇒ 仍要用上面的命令**重生成补丁**（版本号与内容一起更新）后提交。
  2. 上下文变了（上游重构这段，或上游自己把挂载点修了）→ 补丁应用失败；⚠️ **本机非 CI 时 patch-package 故意不以非零码退出**（`dist/index.js` 注释 "don't want to exit(1) on postinstall locally"），安装照过、应用带着**未打补丁**的状态继续跑 ⇒ 靠护栏③变红发现（CI / `NODE_ENV=production` 才会让安装直接失败）。此时二选一：把这 2 行改动**前移**到新版本，或按上游实现**删掉补丁**（探针继续守行为）。
  3. 若将来删掉补丁：`univerContract.test.ts` 的护栏③要一起删，并同步本表与 `usheetKernelContract.ts` 的 `UNIVER_PATCH_HOOKS`。

## 5. 升级后人工走查清单

见 §3 第 5 步（10 条）。其中**必须亲手做**的两条：
① 粘贴单图 → 单元格图片；② 右键 → 插入 → 插入单元格图片（探针里这两条依赖合成输入，偶发）。

## 6. 已知风险与预案

| 风险 | 探针/护栏能不能抓到 | 预案 |
| --- | --- | --- |
| **正文快照 schema 变化**（最危险：影响既有文档） | 抓不到（只能打开真表看） | ① 先在隔离 userData 里打开几篇真表看渲染/保存；② 需要时写**一次性转换脚本**（旧快照→新快照）在**打开前**批量转；③ 极端情况：把升级拆两步——先升内核并保留旧版本分支，等转换脚本验证通过再切 |
| 行内样式/类名变化 ⇒ CSS 覆盖失效 | 探针第 2 条（计算条高度）会红 | 更新选择器 + 更新本文 §4.3 |
| 菜单/命令 id 变化 | `univerContract.test.ts` 会红 | 改 `usheetKernelContract.ts`，再跑探针 |
| 事件/钩子语义变化 ⇒ 粘贴落点变 | 探针第 5 条会红 | 复读 §5.25 重新定位收口点 |
| 出现两份 `@univerjs/*` | `univerContract.test.ts` 会红 | 对齐版本 / 检查 lockfile |
| 新版本要求新的 peer 或 polyfill | 构建期报错 | 按 release notes 补 |
| **我们的 Univer 补丁被升级冲掉**（floating 层又逃出标签宿主） | 护栏③（静态）+ 探针（容器在不在宿主内、切走后可不可见） | 重生成补丁（`npx patch-package @univerjs/ui --patch-dir patches`）或按上游实现删补丁，见 §4.7 |

## 7. 路线图

**已完成（261009 追加）**：内核 floating 层收口 —— `patches/@univerjs+ui+1.0.3.patch` 把 floating 容器挂回实例宿主
（切文档后黄叹号 / CellAlert / 下拉等浮层不再残留）；配套静态护栏③ + 探针两条（§4.7）。

**已完成（261010 批次）**：默认尺寸单一来源（50×16）；挂载失败可见提示；版本精确锁 + 静态护栏；
运行时探针入库；触点集中到一个文件；粘贴图片默认单元格图；右键「插入单元格图片」；计算条 30px + 状态栏跟随。

**短期（下次碰表格时，收益明确、代价小）**
1. **canonical 快照挪到空闲时段**：开表时那次 `save()→深拷贝→序列化` 在 40 万格时约 130ms，且落在"画面可见之前"（实测）；50×16 规模无感，真上大表再动。
2. **「开始」工具白名单**：隐藏 5 项后腾出的宽度会被其它工具自动补位 ⇒ 要"真的变短"需点名或白名单（HANDOFF §0 已记）。

**中期（内核已有能力，按"配置式接入 + 探针 + 契约回填"逐项落地）**
- 条件格式（突出显示单元格 / 数据条 / 规则管理）、数据验证（下拉列表 / 复选框）、公式库完整版（Σ 按类别）。
- 每项都要：官方文档确认语义 → 配置式接入（别自造 UI）→ 探针加一条 → LAKEX-CONTRACT 回填 → HANDOFF 记录。

**长期（有真实需求才做）**
- 10 万格以上的大表格体验（内存 ~0.5–1.5KB/格、打开耗时超线性；需先定验收口径）。
- 图表 / 表格内行·列·单元格级保护（云端语雀有，语义要先定稿）。

**明确不做（已论证）**
- 移动端与桌面抽公共 runtime：差异是实质性的（只读 / 焦点闸门 / 资源 URL 带 token / 无工具条），抽出来只会变成参数化的分支。
- 单实例多 workbook 共享：先保证不串台（一个编辑器一个实例）。
- 清理 Univer 依赖里的"未用路径/冗余"：依赖侧冗余不清（AGENTS §3#18）。
- 为旧正文写运行时兼容层：数据只有一份，格式变了就用一次性转换脚本。
