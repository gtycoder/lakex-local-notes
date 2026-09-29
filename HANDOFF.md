# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接 · 260929 · 多维表功能扩展（V01–V04 + T01/T04/T02A + 单级分组/UI2 + 260929-OPT + T02B.1/T02B.2/T02B.3）

> 写给完全没有上下文的新会话。**本轮的方案、进度、修改记录、会话结论全部在 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`（下称「专项文档」）**：先按 README → HANDOFF → AGENTS 读总上下文，再**完整读专项文档**，然后按它的 §8 顺序继续；**本文件不展开专项细节**，专项会话结束前必须回写专项文档 §11/§12/§13。

### 一、任务目标
- 用户 260928 启动「多维表功能扩展」专项：按专项文档 §8 顺序**逐编号实施、每个编号单独验收**——V01 多视图工作台 → V02 看板 → V03 画册 → V04 日历 → T01 列级统计 → **T03 多级分组（260929 废弃，改为单级）** → T04 语义排序 → T02A 基础字段 → T02B.1/.2/.3 关联 → T06 表单 → D01/D02 导入导出。
- 期间用户三次现场追加/纠偏（均已落地，细节见专项文档 §13）：
  1. 图片与附件**拆成两个字段类型**（image 复用附件值模型、上传侧只收图片）；图片预览范围**恒为单个单元格**（两列图片就是两类，绝不跨列合并）；**磁盘名绝不外显/不可编辑**。
  2. 表单视图加「编辑表单 / 预览表单」双模：编辑态**恢复 v1 原形态**，「填写表单」= 直接跳预览 tab（不做独立弹层）；已配置默认进预览、未配置默认进编辑。
  3. 看板图片字段上卡出**缩略图**（不显示文件名）；字段类型选择改 **2 列网格**（不分「基础/高级」组）；**创建/修改时间必须能参与筛选与排序**（这是修掉我之前设的假边界）。

### 二、已完成内容（提交状态见「提交」列）
| 编号 | 内容 | 提交 |
| --- | --- | --- |
| — | 专项文档建立 + HANDOFF §3.9 登记 | `c2aa11a` |
| V01 | 多视图工作台：视图类型开放集合 + 未知类型安全回退；视图壳拆 `BitableViewBar` / `bitableViews` | `b17f652` |
| V02 | 看板：单选字段分栏（空栏保留 / 未分组）、卡片、拖拽只写分组字段值、看板配置面板 | `b17f652` |
| V03 | 画册：封面取第一个图片附件、裁剪/适应、常规/紧凑、卡片字段 | `b17f652` |
| V04 | 日历：月网格 + 跨天展开 + 单选配色 + 拖拽保持时长平移（全程本地日期语义） | `b17f652` |
| 追加批 | image 字段类型；画册/表格/看板/表单预览单单元格；展示名守卫；表单双模 | `b17f652` |
| F01/F02/F03 | 文档图片预览改取**正文**（虚拟渲染下 DOM 不全）；附件命名审计；表单编辑态回退；看板缩略图 | `b17f652` |
| T01 | 列级统计：底栏统计行（通用/数字/日期口径）、视图级配置、随筛选现算 —— 260929 先整体删除、**同日恢复**（用户确认分组后需要按组统计） | `dbe70ae`（同日恢复） |
| T03 | 多级分组：最多 3 级 + 拖动调优先级 + 层级缩进（`groupRecordsTree`）——**260929 已废弃并回退为单级** | `9b80ede` → 本次回退 |
| T04 | 语义排序：单选/多选「选项顺序 / 选项逆序」；日期文案早→晚/晚→早 | `9b80ede` |
| T02A | 基础字段：布尔/链接/评分/进度/创建时间/修改时间（含默认值与进度配色） | `6f046df` |
| T02A-fix | **系统时间字段打通筛选/排序/分组**（记录级取值口径 `bitableFieldValue`）；其中「统计」部分随 T01 于 260929 回退 | `ef75e96` |
| style | 字段类型选择改 2 列网格；顺带修 T02A 漏 import CSS 的 bug | `3a39030` |
| V05 分组样式 + T01 恢复 | 分组头改**整行 56px**（折叠钮 + 分组值 + 每列统计，首列 `N 条记录`）；每组记录后 40px 圆形「加进本组」、顶级分组间 20px；列统计恢复并保留「无配置不显示空条」；**表格内「添加」统一为同一颗圆形 + 钮**（新增字段 / 添加记录 / 加进本组）；分组头**分组值优先占位、首列统计下限 80px（云端实测）、过长省略**，并修掉长文本撑开 `table-layout:auto` 造成的列错位；**V05 续四条**：列选中点外即清、分组汇总行固定 36px、分组头每列都有汇总位、底部汇总栏**常驻**（24px 贴视图底）+ 状态栏上移让位；**分组「加进本组」的 + 有独立行高（32px）但不画行线**（不嵌边线）**、已分组时表底那个 + 隐藏**；**T01 汇总方式逐字对齐云端 config**（只有第一列默认「记录总数」、其余默认空白且占位仅 hover、统计格 = 白底 chip + ▾、按字段类型给选项，进度无求和） | **已提交（待验收）** |
| 浮层定位 | **贴底翻上方**统一：垂直口径收敛到 `placeVertical`/`usePopoverPosition`；多维表日期/单选/展开面板/行菜单 + 标签/卡片右键改走实测定位 | `05b6a96` |
| T02A 续 | 评分：空星**实心** + 选中星对齐云端金（`--lake-rating-star`）；进度：**只留条 + 百分比**（数值框删除），可拖动/键盘可达/Delete 清空、只读不接指针 | `4e19df0` |
| 260929 UI 细节 | 分组重做为**单级白卡 + 边框/圆角**（删除多级树、添加分组、拖动优先级、层级样式）；`+` 行下边线清除；表底重复“共 N 条记录”清除；目录把手增加全局离开清理兜底 | **已提交（待验收）** |
| 260929-UI2 分组底衬 + 底栏收口 | 复刻云端「浅灰分组通道 + 白卡」：表头下 20px 间隙、加进本组/组间/表下空白统一走新令牌 `--lake-bg-subtle`（**不分组时表格下方空白同款**）；**数据表选择区 `.bt-tables` 也改用同一个灰**（原先更深的 `--lake-bg-block`，左右像两套风格）；卡片收口移到该组最后一条记录（+ 行在卡外）；汇总文案「共 N 条」；**删掉表底「已选择 N 个单元格」横条**（其信息改为**多选时**落在底栏最左格：「选择 N 行」/「选择 N 个单元格」，单选不触发）；**底栏底色也改成同一块灰**（与表格区融合、靠 1px 分隔线分界），**汇总行（底栏 + 分组头）去掉行内竖线做整行处理**、光标所在的一格加重到 `--lake-bg-block`；**格线/卡片边线改挂更浅的 `--lake-border-2`**（对齐云端 `rgb(244,245,245)`）；**修「选无统计仍显示共 N 条」**（去掉分组头首列的 `?? "count"` 兜底），**左下角计数改 `shownRecords.length`**（= 当前视图正在展示的记录数，只随筛选/搜索与多选变，与汇总项的实时计算是两套独立逻辑）；**两处添加入口的 ＋ 号改编号列独占一格 + 居中**（落在行号正下方）；**分组面板的删除键改为行尾 🗑「删除分组」**（与筛选/排序行同一套）；**修格内「两层边框」**（单元格自己有 2px 选中环时不再叠输入框焦点环），**链接格改云端形态**（展示文本 + 右端 🔗 图标，点图标用本地浏览器打开，双击编辑，不再常驻输入框）；底栏即最底下那条，状态栏改**实测贴住底栏上沿**（`--lake-bitable-status-bottom`，重叠 0px） | **已提交（待验收）** |
| 260929-OPT 阶段代码优化 | 用户要求「先整理/优化当前阶段代码」：修 6 处真 bug（进度颜色面板打不开 / 表单题序被丢 / 系统时间列查重失效 / 系统时间列复制为空 / 搜索绕开展示口径 / 删字段留脏配置）+ `statForField` 原型链加固 + 令牌合规 + 单一来源 | **已提交（待验收）** |
| T02B.1 关联基础模型 | 同一文档内跨表关联：`BitableRelation` 模型 + 统一解析 `BitableDisplayContext`（可选 ctx）+ 字段配置（目标表/允许多个）+ `RelationCell` chip；失效不崩不级联；CDP 真实端点验收通过 | **已提交（待验收）** |
| T02B.2 单向关联 | 关联选择器：搜索 / 目标记录列表 / 已选计数 / 新建记录 / 取消·确认（草稿确认前不写正文）+ 跳转目标记录；多选·单选均可用；复用 `.bt-option-*` 原语；CDP 真实端点验收通过 | **已提交（待验收）** |
| T02B.3 双向关联 | 反向字段（默认名 = 来源表名 + 来源字段名）+ 回填已有值 + 双向镜像唯一写入口 `applyRelationMirror` + 删一侧解除配对（对侧降级单向、数据保留）；CDP 真实端点验收通过 | **已提交（待验收）** |
| 移动端多维表只读补齐 | 布尔/链接/评分/进度/关联/系统时间的**只读控件**（非裸文本）+ 非 grid 视图回退提示；Android 模拟器 CDP 验收通过（见 §8） | **已提交（待验收）** |
| 数据表行操作浮动 | 「⋯ / 删除表」改绝对定位浮层、悬停浮现、不占流内位置（名称/计数不再被挤压）；CDP 实测无位移 | **已提交（待验收）** |
| 字段类型弹出选择 | 「编辑字段」的字段类型由内联大网格改弹出选择器（一行触发器 + Popover 内同一 2 列网格）；弹窗不再被撑高 | **已提交（待验收）** |
| 类型左对齐 + 选项回车切换 | 字段类型触发器文字左对齐（不再被 button 默认居中）；选项输入框回车 = 当前选项完成并切到下一个，已是最后一个才新建 | **已提交（待验收）** |
| 状态栏「一个表有一个没有」修复 | 底栏位置实测改量**粘性 `td`**（`<tr>` 是 static，纵向溢出时算出负值把状态栏顶出屏幕）；两表实测都显示 | **已提交（待验收）** |
| 关联字段目标表占位 | 「编辑字段」里 `关联数据表` 的占位文案「选择数据表」不再是下拉选项（原先 `value:""` 当选项、空值还被判为选中并打勾）；改走 `SelectMenu` 的 `placeholder`，选项只留同一文档内的其它数据表 | **已提交（待验收）** |
| T02B.4 关联数据范围 + 选择器改版 | 字段配置加「从视图筛选记录」（不勾选=目标表全部记录；勾选=绑定目标表的一个视图，候选只列该视图筛选后的记录）；关联选择器由单元格小气泡改**全局大弹窗**（两个 tab：所有可关联记录 / 已选 N 条；全局搜索 + 右侧筛选·排序；主区域 = 目标表整表；页脚 已选·取消·确认）；按用户要求**不做「添加记录」**，并一并撤销行内「跳转目标记录」 | **已提交（待验收）** |
| 新建数据表默认结构 | 默认表改为**只建 1 列「文本」+ 3 行空白记录**（不再预置单选/日期列）；「新建数据表」、新建多维表文档首表、空正文兜底共用 `createDefaultBitableTable` 单一来源 | **已提交（待验收）** |
| 关联选择器图片/附件真渲染 | 选择器整表里图片出缩略图（可点开预览本格）、非图片附件出「📎 文件名」chip（>2 折成 +N）；资产 URL 收敛为 `bitableAssetUrl` 单一来源（单元格/看板/画册/选择器共用） | **已提交（待验收）** |
| 横向页签原语（B 墨线 + 计数徽标） | 用户从 5 个形态里选定 **B**：`kit.css` 正式原语 `.ln-tabs`（文字 + 选中变强调色 + 与文字等宽的 2px 下划线；数量进 `.ln-tabs__count`、右侧动作 `.ln-tabs__action`），**已全量落地**（关联选择器 / 回收站 / 历史面板 / 表单编辑·预览）；legacy `.ln-tabs` 从 `components.css` 整段收编进 kit（单一来源），过渡变体 `.ln-tabs--seg` 已删除；`.seg` 只剩取值选择/图标开关 | **已提交（待验收）** |

### 三、当前状态与门禁
- 分支 `master`；**本批（上表所有行）已提交并推送**：代码提交 `681f148`（多维表专项收口，含 260928–260929 各批）、文档提交紧随其后；`origin/master` 已同步。更早的 23 个本地提交（`1494331..1fe4d22`）也一并推上去了。**上表各行的「已提交」只表示已入库，功能本身仍是「待用户验收」**。
- 更早的 V05/T01、评分/进度修复（`4e19df0`）、T01 回退（`d2eeb79`）、浮层定位（`05b6a96`）本来就在仓库里；本轮用户 260929 明确授权「合并 master 并推远程」，已 `git push origin master`。
- 多级分组源头为 `9b80ede`；本次已删除多级树/多级面板/层级样式，单级分组、按组统计和「加进本组」保留。
- 门禁全绿：`tsc --noEmit`✓ · `vitest run` **1405 passed / 16 skipped**✓ · `check:core` 0 违规✓ · 桌面 + 移动构建✓ · `ui-metrics`（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · `cssLayers`+`uiPrimitives`✓ · `git diff --check`✓。
- 每个编号都做了 **CDP 真实端点验收**：`env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA=<临时目录> LAKE_ASSET_PORT=<独立端口> electron --disable-gpu --remote-debugging-port=<独立端口> .`，用 Node 24 内置 WebSocket 直驱 `Runtime.evaluate`。

### 四、当前问题 / 遗留（都不阻塞继续）
1. **待用户验收**：V02–V04 + 三批追加需求 + T04 + T02A + **260929 T02A 续（评分星/进度条）+ 浮层定位统一 + V05 单级分组样式（含续四条）+ T01 恢复 + 260929 单级分组/目录把手/重复计数细节优化 + 260929-UI2 分组底衬与底栏收口 + 260929-OPT 阶段代码优化 + T02B.1 关联基础模型 + T02B.2 单向关联 + T02B.3 双向关联 + T02B.4 关联数据范围/选择器改版 + 新建数据表默认结构 + 关联选择器图片/附件真渲染 + 横向页签原语（B 墨线+计数徽标） + 移动端多维表只读补齐 + 数据表行操作浮动 + 字段类型弹出选择 + 类型左对齐/选项回车切换 + 状态栏「一个表有一个没有」修复 + 关联字段目标表占位修复**（专项文档 §11 看板里均为「待验收」）。V01 已验收通过；T03 多级分组已废弃。**T01 列级统计：当天先删后已恢复，并定稿为底部常驻栏**（专项 §11/§13）。
2. 已知口径/边界（用户知情、可接受）：
   - **移动端**：看板 / 画册 / 日历 / 分组仍**回退为只读表格 + 明确提示**；**260929 已补齐多维表只读控件**（布尔/链接/评分/进度/关联/系统时间，不再是裸文本）并**在 Android 模拟器上完成 CDP 验收**（见 §8「多维表只读」）。
   - 分组当前最多一级；历史多分组正文只保留第一级配置（当前产品语义，不做兼容迁移）。
   - 文档图片预览：同一张图在正文出现两次时，双击第二次仍定位到第一张（**张数正确**，定位精度小瑕疵）。
   - 评分是整星（不做半星）；进度是 0–100 整数；图片字段只按扩展名/MIME 判图片（不做内容嗅探）。
   - 表单暂不渲染 `formDescriptions`（逐字段描述）；日历的当前月份是本机展示态（不写正文）。
   - **关联**：T02B.2 选择器支持多选/单选、搜索、新建目标记录、跳转；T02B.3 双向关联建反向字段并双向同步、删一侧降级为单向且数据保留；关联列的筛选/排序/分组/统计当前按「空」处理（专项 §6.4 最小侵入口径）；目标表被删只展示失效、不级联。
3. 与专项无关的上线收尾遗留仍在 §3（真实端双端同步实测、Android 真机验收、发布说明）。

### 五、下一步计划
1. 等用户对第 4 节第 1 条的范围验收（**代码已提交并推送**，验收只看功能；发现问题直接改 + 追加提交）。
2. 按专项文档 §8 顺序本应继续 **D01 CSV → D02 JSON**，但 **260929 用户明确「先不做导入导出」**，D01/D02 暂缓；期间已完成**移动端多维表只读补齐 + Android 模拟器验收**（见 §8）。恢复导入导出时从 D01 开始。
3. 每个编号的固定动作：core 纯函数（`src/core/bitableDoc.ts`）+ 各视图独立组件/独立 CSS 文件（**必须**在 `src/styles/cssLayers.test.ts` 的 FILES/BASELINE 登记）+ 单测 + 全门禁 + CDP 真实验收 + 回写专项文档 §11/§12/§13。

### 六、本轮踩过的坑（关键；长期条目已并入 §4）
1. **改完 `src/**` 必须先 `npx vite build`，再跑 scheme 模式的验收**：`LAKE_RENDERER=scheme` 服务的是 `dist/`，不重建就是在**旧 bundle** 上验收，会出现「改了没生效」的假象（本轮踩过一次，白折腾一轮）。
2. **CDP 查询必须限定可见元素**：`.bitable-editor:not(.fn__none)`。多 tab keep-alive 下，裸 `.bt-viewbar` / `.ln-popover` 会点到隐藏 tab 的菜单。
3. **CDP 依附的窗口 `document.hidden === true`** ⇒ `loading="lazy"` 的图片**不加载**（`naturalWidth=0`）。验收封面/缩略图要临时 `removeAttribute("loading")` 才能看到上屏；**不是产品缺陷**（同一 URL 的 `fetch`/`new Image()` 都 200）。
4. **新增 CSS 文件必须由使用它的组件 `import`**：本轮 T02A 建了 `bitableFieldCells.css` 却漏 import，那批新单元格样式一直没加载（元素在、样式空），直到做 2 列网格发现 `grid-template-columns: none` 才暴露。
5. **`cssLayers.test.ts` 基线是硬上限**：`features/bitable/bitableEditor.css` 已顶满 **1081/1081（headroom = 0）** —— 再加任何一条声明都会让用例变红；本轮所有新样式都进了新文件（`bitableViews.css` / `bitableKanbanView.css` / `bitableGalleryView.css` / `bitableCalendarView.css` / `bitableFormView.css` / `bitableFieldCells.css`）。
6. **读落盘要轮询**：应用层自动保存有防抖，改完立刻 `readNote` 会读到旧值甚至空对象（本轮多次误判「没保存」）。
7. **同一文件被多批改过时没法按批拆 commit**（`git add -p` 的补丁手术风险高）⇒ 本轮代码合成一个 commit、文档单独一个；不要为了「一批一 commit」硬拆。
8. **在 DSH 宿主里跑 CDP 验收必须加 `--no-sandbox`**（260929 新增）：否则 Chromium 自带 sandbox 初始化报 `Operation not permitted`，连锁 `NetworkService/GPU crashed`，最终 `FATAL: GPU process isn't usable. Goodbye.` 整个实例退出（§6 的验收命令本轮首次执行即因此失败）。加 `--no-sandbox`（userData/端口本就隔离）后正常。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 44 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交；**260928 多维表批次已由用户明确授权「提交代码」（仅提交、未推送）**）。移动端另有铁律见 **§8.0**。

## 3. 待办与已知问题（上线后 backlog）

> 当前主线是多维表专项（见 §0 与专项文档）；以下是专项之外真正保留的低优先项。

1. **同步 warning 结构化**：`SyncReport.warnings` 从字符串改为 `{ kind, noteId?, filename?, message }`，与 UI 展示/点击定位一起做。同步红线区，单独立项。
2. **画板 AI 助手**：只接画板卡的 `generate` 钩子；模型、endpoint、Key 代理方式待产品决定。内核绿色文本绘图徽标无注入点，不做。
3. **UI 低优先**：目录树窗口化（先量到真实卡顿再立项）·设计词表继续裁剪·画板 `Wt is not a function` 根因定位。
4. **移动端剩余**：真机验收、数据导出/导入、粘贴与资源 URL、长文档大纲跳转；详细步骤见 §8。
5. **搜索整体重构**：FTS/短词/增量搜索不并入普通维护，单独立项。
6. **历史快照恢复为新文档**：用户已明确先不做；恢复入口仍只覆盖当前文档，恢复前自动留档。
7. **低优先数据/性能**：附件哈希缓存仅在真实痛感出现后立项；回收站惰性下载暂缓；Word/PDF 大附件与历史 `lakex-contract.d.ts` 按需处理。
8. **已知外观**：离线残余资源、移动端缩略图仅覆盖 png/jpg/jpeg（失败回退原图）、多维表附件旧数据的体积展示边界。

9. **多维表优化专项**：唯一方案/进度/修改记录/会话结论在 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`；专项会话先完整读它、结束前必须回写它，**不在 HANDOFF 内展开专项细节**。当前进度见 §0 第二节。

## 4. 关键坑（长期有效）

### 同步 / 数据
- **`purged_at` 不是永久墓碑**：前缀删除成功后会被 `markPurgeSynced()` 清空；永久判定看 `deleted_notes` 墓碑（folder 看 `node_type='folder'`）。
- **purge 必须无条件写墓碑**：`notes` 行缺失时从 `tree_nodes` 兜底；漏写会导致云端复活成不可见文档。
- **manifest.assets 永远全量声明**：上传差集只决定 PUT，不能裁剪声明；否则他端 GC 会误删在用资产。
- **资产存在性只看远端清单差集**，禁止逐对象 HEAD 和本机持久缓存；下载侧用实扫 size+sha256 判本地复用。
- **软删 = 移入回收站笔记本**；`deleted:true` 仅用于 purge 墓碑。混合两者会破坏恢复和删除传播。
- **任何打开文档入口先判 `isGoneNote()`**：回收站/已 purge 文档必须只读并显式提示，绝不允许静默丢保存。
- **静默丢弃用户输入是最坏失败**：拦截保存必须有可见原因和出口。
- **S3 并发峰值 ≤8**：正文 2×资源 4，不要为吞吐继续加。
- **Manifest V1 重置不是兼容模式**：只读写 `{1}`，所有端一起升级；旧 `sync.ts` 已删除。

### 渲染 / UI
- 浮层列布局的固定区用 `flex: 0 0 auto`，否则内容会被列表盖住。
- **表格行里的长文本会撑开 `table-layout: auto` 的列宽**（260929 实测）：多维表分组头是 `<tr>`，长分组值把**表头首列撑到 482px**、记录行仍 80px ⇒ thead/tbody 列错位（用户报的「错位」）。表格里要放"不该影响列宽"的内容，把它**移出流**（`.bt-group-inner` 绝对定位 `inset: 0`），列宽只交给表头/记录行决定；别用 flex/nowrap 直接写在 `<td>` 里。
- **浮层定位禁止用估算高度**（260929）：统一走 `src/hooks/usePopoverPosition.ts`（量真实尺寸 → 下方优先、贴底翻上方 → 夹进视口），垂直口径是 `topMenuPosition.ts` 的 `placeVertical`。历史多处按猜测高度夹 `innerHeight - N`（48/90/300…），贴底就被裁且不翻转；`Overlay` 原语只吃调用方给的 `style`，定位责任在调用点，**新增浮层必须走该 hook**。
- **多维表底栏（`.bt-stat-row`）上沿不是常数**（260929-UI2）：它贴的是**表格视口**底部，横向滚动条会吃掉内容盒高度（实测差 10px，列多时恒有）⇒ 把状态栏钉在它上沿**必须实测**，由 BitableEditor 写 `--lake-bitable-status-bottom`、`chrome.css` 消费（同 sheet 的 `--lake-sheet-status-w` 姿势）。在 CSS 里猜高度必然要么压住底栏、要么离得老远。**在隐藏窗口（CDP 依附）里不能用 `requestAnimationFrame` 做这种实测**：`document.hidden === true` 时 rAF 不触发（本轮踩过，变量永远写不进去）。
- **量这类「贴底栏」位置要取 `position: sticky` 的那个元素（`.bt-stat-row td`），不是它的 `<tr>`**（260929 修「一个数据表有状态栏、另一个没有」）：sticky 挂在 td 上，`<tr>` 仍是 static；内容纵向溢出时 `<tr>` 停在**内容底部（视口外）**，拿它算 `innerHeight - tr.top` 得负值（实测 -231px）把状态栏顶出屏幕；不溢出的空表恰好也贴底所以看着正常。
- 预览切换先 `img.decode()` 再替换，别 `setState(null)` 造成塌陷闪动。
- 改 CSS 先找单一来源和层序；不要靠继续加覆盖层解决。改后跑 `cssLayers` + `ui-metrics`。
- **`src/styles/cssLayers.test.ts` 的基线是硬上限（只许变小）**：`features/bitable/bitableEditor.css` 已顶满 **1081/1081**。新样式一律**新建文件**并登记 `FILES`+`BASELINE`，且**必须由使用它的组件 import**（漏 import 时元素在、样式空，很难发现）。
- `content-visibility`/`contain` 不要加到 Lake 引擎层。
- 内核/第三方 inline style 是唯一允许更高层覆盖或 `!important` 的例外，且要写理由。
- 多 tab keep-alive 下，CDP 查询必须过滤可见 tab（`.bitable-editor:not(.fn__none)`），否则会命中隐藏编辑器。
- **横向 tab 一律用 `kit.css` 的页签原语 `.ln-tabs`**（260929 用户在多方案对比里选定「B 墨线 + 计数徽标」：文字 + 选中项变强调色 + **与文字等宽**的 2px 下划线压住容器的 1px 分隔线；数量放 `.ln-tabs__count` 徽标；右侧动作放 `.ln-tabs__action`）。结构 = `.ln-tabs > .ln-tabs__track[role=tablist] > .ln-tabs__item[role=tab][aria-selected]`；**已全量落地**：关联选择器、回收站、历史面板、表单编辑·预览。`.seg` / `.seg__item` 只剩「取值选择 / 图标型开关」（设置页主题三选一、小记列表·卡片版式），**不要再拿它做横向 tab**。

### 多维表（自研）
- **图片预览范围 = 单个单元格**：两列图片就是两类，绝不跨列/跨行合并；表格/记录详情/表单/看板缩略图都只预览"本格"，画册只预览"封面字段该行那一格"。
- **磁盘名绝不外显、也绝不可编辑**：`uploadResource` 对图片只回**磁盘名**（main 侧忽略请求名）、对附件回**清洗后的原始文件名**；凡把响应 `filename` 当展示名的地方都会显示成 `17xxx_ab12cd34.png`。展示名必须用**用户原始文件名**，并有统一守卫（`bitableAttachments` / `buildAttachmentPreviewItem`：缺展示名或本身就是落盘名 → 中性文案）。
- **落盘名是随机唯一**（`buildAssetFilename` = 13 位毫秒 + 8 位随机 hex），全链路**无内容去重** ⇒ 同一张图上传两次必得两个文件，不会出现"多条引用共用一份文件、删一条把别人删没"。
- **系统时间字段（创建/修改时间）必须走记录级取值口径 `bitableFieldValue(record, field)`**：它们的值不在 `values` 里；筛选/排序/分组任何一处直接读 `record.values[field.id]` 都会得到 `undefined`（表现是"排序等于没排、筛选全空"）。展示走 `bitableFieldText`（到分钟）。
- **文档图片预览列表必须取正文**：编辑态开着虚拟渲染 + `cardLazyInit`，视口外卡片不在 DOM 里 ⇒ `querySelectorAll("img.ne-image")` 会少图、切不动；内核这个构建 `allowClickToMaximize`/`previewImgs` 不可用，列表用 `extractImagesFromContent`（正文解析）。
- **只读（锁定/回收站）必须封死所有写入口**：包括视图配置下拉、视图重命名、看板配置等"非单元格"的写入点（本轮修过泄漏）。

### 工程 / 环境
- Node 必须 24；better-sqlite3 是 Electron ABI，系统 Node 不能替代运行时。
- 改 `electron/**` 或 `src/core/**` 会触发 Electron 重启；验证前确认 CDP 端口连的是新实例。
- Vite dev server 必须长驻；`nohup` 起的进程会随会话回收。
- 杀 Electron 只按唯一 CDP 端口精确定位 PID；禁 `pkill -f Electron`、`killall`。
- DSH 宿主里启动仓库 Electron 要 `env -u ELECTRON_RUN_AS_NODE`。
- 打包版写正式数据目录；试跑必须覆盖 `LAKE_USER_DATA`，发布 smoke 用独立端口。
- **scheme 模式验收前必须 `npx vite build`**（它服务 `dist/`，否则验收的是旧 bundle）。
- **CDP 依附的窗口是隐藏的**（`document.hidden === true`）⇒ `loading="lazy"` 图片不加载；验收图片要临时去掉该属性，别误判成产品 bug。
- **要「仿照云端」时，优先读云端前端资源而不是一个个点 UI**（260929 用户提示，已实践）：`bsk evaluate` 里 fetch `performance.getEntriesByType('resource')` 找到 `gw.alipayobjects.com/**/lakex_table_yq.*.chunk.css|.async.js`（CORS 可读），配置表/样式规则直接 grep 就有（如统计项的 types 限制、占位 hover 规则）；点 UI 只用来交叉验证。
- **用户可能与测试实例共用同一个进程/窗口**（260929 用户明确交代）：我起的隔离实例（LAKE_USER_DATA=$TMPDIR/lake-accept + LAKE_RENDERER=scheme）用户会**直接在同一个窗口里看/操作** ⇒ **不要默认 kill 实例、不要 rm -rf 该 userData**（那是他正在看的数据）；只有用户明确说「清理/重建」时才收尾。同理，验证脚本不要顺手删掉自己建的测试笔记。
- **读落盘要轮询**：自动保存有防抖，改完立刻读会拿到旧值。

## 5. 上线与后续建议
1. 主线是多维表专项（§0）；专项之外只从 §3 取项并单独立项，不要恢复已完成的研究/计划文档。
2. 改同步/GC 前先读 `AGENTS.md` 原则 11~13 + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`；写 Lake 正文前读 `docs/LAKE-CONTENT-WRITING.md`。
3. 编辑器/lakex 相关先按 AGENTS §2 的检索顺序查 vendor → 官方文档 → `LAKEX-CONTRACT.md` → 源码字典。
4. 上线收尾的真实环境验收仍待做：空库双端 V1 同步、Android 真机、发布说明（见 §8 与专项之外的 backlog）。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
node scripts/ui-metrics.mjs && npm run check:core && git diff --check
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
node scripts/lake-roundtrip-check.mjs --note <id>   # 对拍「这篇一打开会不会被内核改写」（只建临时文档，退出码 1=会被改写）
```
- **UI 实测姿势（本轮全程使用，推荐）**：
  ```bash
  # 1) 必须先构建（scheme 模式服务 dist/）
  npx vite build
  # 2) 隔离开一个实例（独立 userData / 资源端口 / CDP 端口）
  env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$TMPDIR/lake-x" \
    LAKE_ASSET_PORT=19890 ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9230 .
  # 3) 取 page target，用 Node 24 内置 WebSocket 直驱 Runtime.evaluate / Page.captureScreenshot
  curl -s http://127.0.0.1:9230/json/list
  ```
  详见 `docs/CODEX-GUIDE.md`。注意 §4 的三条坑（重建、可见元素、lazy 图片）。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8**。

## 7. 文档索引（`docs/` 按需查）
- **契约/规格（单一来源）**：`STORAGE-LAYERS.md`（存储分层 + 设备本地契约）· `SYNC-PROTOCOL.md`（同步协议 V1 重置）· `S3-GC-DESIGN.md`（存储/删除 GC）· `HISTORY-DESIGN.md`（历史快照）· `TRASH-NOTEBOOK-DESIGN.md`（回收站）· `QUICK-NOTES-SPEC.md`（小记）。
- **多维表优化专项**：`BITABLE-OPTIMIZATION-HANDOFF.md`（唯一方案、状态看板、修改记录和多会话交接；**专项会话必读必写**）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md` · `ANDROID-TECH-SCHEME.md` · `ASSET-URL-MOBILE-PLAN.md`。
- **UI/工程规范**：`scripts/css-audit/README.md`（样式层）· `PANEL-CONTRACT.md`（面板几何/层序契约）· `UI-PRIMITIVES-PHASE1-260926.md`（浮层原语）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端速查（完整端）

- 正式端：Capacitor Android，包名 `com.lakenotes.mobile`；定位为完整端，桌面红线同样适用。
- 数据在模拟器 App 沙盒，不在 macOS 数据目录；开发可 `adb shell pm clear com.lakenotes.mobile` 重建。
- AVD：`lake_mobile`（Pixel 6 / API 36 / arm64）；SDK 在 `/opt/homebrew/share/android-commandlinetools`。
- Node 24；Android 脚本已内置 JAVA/SDK 环境。

### 常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts
bash scripts/android-build.sh --sync --install
bash scripts/emu-cdp.sh
bash scripts/emu-up.sh
bash scripts/mobile-preview.sh
```

### CDP / 编辑器
- App 重启后 WebView socket 会变化；重新 `adb forward` 后再连 `/json/list`。
- 活跃 Lake 实例暴露为 `window.__mobileEditor`；命令用 `renderer.execCommand`。
- 有效命令：`bold`、`unorderedList`、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style("p"/"h1"/"h2")`、`undo/redo`。
- 无效/易错命令：`insertUnorderedList`、`formatBlock`、`heading`、`strike`、`justify*`、`clearFormat`、`fontsize`。
- 工具栏按钮必须 `onMouseDown preventDefault`，否则抢焦点导致命令 no-op。
- 面板与 IME 必须用 visualViewport 实测状态互斥；不要跟内核异步重聚焦赛跑。
- 真机可能是 edge-to-edge，模拟器是 adjustResize，二者都要覆盖。

### 多维表只读（260929 补齐 + Android 模拟器验收）
- 单元格按字段类型给**只读控件**（不再是裸文本）：布尔=禁用复选框、链接=`<a target="_blank">`（外部 origin 走系统浏览器）、评分=5 星、进度=条+百分比、关联=目标记录主字段 chip、附件/图片=缩略图、单选/多选=色块；其余走 `bitableFieldText`（系统时间到分钟）。
- 非 grid 视图（看板/画册/日历/未知类型）仍走「明确提示 + 表格只读」，不空白、不改数据。
- **验收姿势**：`android-build.sh --sync --install` → `emu-up.sh --no-window` → `emu-cdp.sh 9335` → 连 `http://127.0.0.1:9335/json/list`（Node 内置 WebSocket 直驱 `Runtime.evaluate`）。
- **造数据**（模拟器是全新安装、库里 0 条）：DB = `databases/lake-notes-mobileSQLite.db`；`notes` 表写 `doc_kind='bitable'`、`content=<正文 JSON>`、`parent_id='notebook-personal'`（**必须挂到笔记本**，否则首页点开会提示「未找到该文档所属笔记本」）。改法：force-stop → `exec-out run-as … cat` 拉出 db/wal/shm → python sqlite3 写 + `PRAGMA wal_checkpoint(TRUNCATE)` → push 回 + 删 -wal/-shm → 重启 App。
- **点开笔记必须用真实点按**：首页最近文档是 `<button class="doc-card">`，CDP 里 `el.click()` **不触发**导航（页面不动），要用 `Input.dispatchMouseEvent` 在元素中心 mousePressed/Released。
- 已验收（模拟器 lake_mobile，Pixel 6 / API36）：`移动多维表`（全字段）断言 bool=[true,false] 且 disabled、链接 href/target 正确、评分星数=[4,2]、进度=60%/0%（条宽一致）、关联 chip=[目标A,目标B]/[目标B]、创建时间到分钟、只读徽标；`移动看板表` 显示「「看板视图」桌面已支持，移动端暂以表格只读展示。」

### 当前剩余验收
- V1 空库多端同步：创建/编辑/删除/恢复/GC。
- 真机：图片与附件、编辑保存、同步后图片加载、键盘安全区。
- 数据导出/导入、剪贴板粘贴、长文档大纲跳转。
- 缩略图目前仅 png/jpg/jpeg，失败会回退原图。
- ~~多维表只读控件（布尔/链接/评分/进度/关联/时间）~~ 260929 已在模拟器验收；真机复验仍可做。
