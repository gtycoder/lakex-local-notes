# 内核能力复用综合检查（261015）— 逐条方案清单

> **状态**：只读审计 + 方案 + 结案登记。**本次未修改任何产品代码**，只新增本文档；261017 完成一轮**结案/回填**（见 §0 当前状态、§3 各条结案行、§9）。
> **目的**：找出「内核已经有能力，我们却自己实现 / 没接 / 需要自己拼」的地方，逐条列出并讨论，方向 = **能复用内核就复用内核，尤其 Lake 文档功能**；桌面端与移动端都查。
> **用法**：每条按「现状 → 内核证据 → 判定 → 建议方案 → 代价/风险 → 验收」写；讨论时直接点编号（如 `B1`）。

---

## 0. 结论摘要

**一句话**：Lake **文档**这一侧，我们其实已经在用内核（工具栏 items、151 条命令、上传钩子、卡片注册、AI 插入通道、大纲数据源、颜色记忆全是内核的）。
真正值得动手的不是"推倒重写"，而是四类**边界清楚的小账**（其中 A/C 两类多数保持现状）：

| 类别 | 含义 | 条数 | 处理建议 |
| --- | --- | --- | --- |
| **A 类** | 内核有该能力，但**内核未导出可用部件**或**用户已定稿自研**，我们自建了 UI/流程 | 6 | 多数**保持**；只收口"数据源/判据单一化" |
| **B 类** | 内核**有命令/查询/API**，我们**没用**（自己在算、自己在做） | 9 | **优先做**：改动小、可实测、纯收益 |
| **C 类** | 可用**组合调度内核多能力**替换我们自己的实现 | 5 | 第二批；其中 2 条需要你裁定 |
| **D 类** | 内核**确实没有**（或官方要求使用方自实现） | 8 | **登记为"不再立项"**，避免反复讨论 |

**当前状态（261017 结案后）**：B 类 9 条 —— **B1 已实施**、**B2 移动端已实施 / 桌面不做**、**B3/B5 结案不做**、**B7 结案已满足**、**B4/B8 已结案不做**、**B6 已定"不着急"**、**B9 结案保持现状**；C 类 5 条 —— **C1 用户明确不做**、**C3 已结案（命题不成立：块卡片浮栏是内核原生在跑；图片浮栏内核本构建不可用）**、**C5 保持现状**；**C2（浮栏/固定栏状态判据盘点）已于 261017 盘点后结案：已一致、无缺口**（逐项表见 §3.3）。新增 **B10**（导出占位，非内核复用、只登记）。
⇒ **本审计的代码级待办已归零**，剩余只有"用户推迟项（B6 / C3）"与"新登记的功能缺口（B10）"。

**进度**：**B1 已于 261016 实施并实测通过** —— 字数统一走内核 `wordCount`，三处自研正则收口到单一来源；**B2（文档内查找）**桌面评估后不做（宿主入口已回滚，内核 ⌘F 可用）、移动端已实施 `MobileFindBar`。

**文档/检索口径漂移**见 §8：261017 已回填 3 条（§5.9 的 `getSelectionContent`、AGENTS §2⓪ 的图标族/检索词），另 3 条已自然解决。

---

## 1. 判定口径

### 1.1 四类问题（对应你给的 1–4）
1. **内核有能力，我们却自己实现**（UI 部件/流程层重复）。
2. **内核支持，我们自己做了**（同样的能力换了种做法）。
3. **可以组合调度内核多个能力来替换我们的实现**（单看一条不够，拼起来才等价）。
4. **内核能力可以直接替代我们的某个功能/方法**（一对一替换）。

### 1.2 三条硬约束（决定了"能不能换"）
- **AGENTS §3#17 三问**：问题真实存在？不做付什么代价？收益明确大于新增复杂度？缺一即不做。
- **移动端 UI 独立（用户 261012/261014 定稿）**：移动端有自己的设计与原语，**不引桌面样式层**；移动端输入面**只有底部 dock**（内核工具栏在移动端是关掉的）。⇒ "把移动端改回内核工具栏"**不是**可选项。
- **内核未导出件不能 import**（颜色面板、`ToolbarUIDescriptor` 基类、`ISelectionHelperService` 等）⇒ 只能"按内核契约复刻"，且**不许为此改 vendor**（AGENTS §3#18）。

### 1.3 资料与方法（三级检索 + 官方 + 逆向仓）
0. `vendor/lakex-doc-react/src/**` 与 `docs/execCommand-reference.md`
1. `/Users/admin/file/local-lake/yuque-developer-docs/docs/`（官方编号主题；**官方文档止于 1.67.0，1.68→1.99 只能靠 bundle + 实测反推**）
2. `docs/LAKEX-CONTRACT.md`（§5.9 命令注册表 / §5.10 浮栏 / §5.27 envAdapter / §5.28–5.30 移动端输入面 / §5.32 命令实测）
3. `/Users/admin/file/local-lake/yuque-re/kernel/`（`LAKEX-API-INVENTORY.md` 机器总账 + `LAKEX-CAPABILITY-MAP.md` 能力地图）
裁决：vendor bundle + 运行时实测。

---

## 2. 内核能力总账（讨论时引用）

### 2.1 命令（151 条 = 147 `kO` + 4 命令式；来源 §5.9 + yuque-re 总账）
| 族 | 代表命令 | 我方使用情况 |
| --- | --- | --- |
| 文本格式 | `bold italic underline strikethrough` `sup sub` `code` `color/clearColor` `bgColor/clearBgColor` `fontsize/defaultFontsize` `clearFormat` `paintFormat` | 大部分用；`paintFormat`、`sup/sub`、`lineHeight`、`typography`、`paragraphSpacing` **未用** |
| 段落/块 | `style(p,h1..h6)` `alignment` `indent/outdent/firstIndent` `quote` `hr` `plainText` `breakLine` | 用；`firstIndent` 未用 |
| 列表 | `orderedList unorderedList taskList taskStatus orderedListIndexType` | 用 |
| 历史/选区 | `undo redo rollbackHistory` `selectAll selectAllDoc` `selection` `focus` `copy cut paste` | `selectAll` 用于卡片菜单；`selectAllDoc` **未用**（手工 range） |
| 查询 | `queryCommandValue/State/Enabled`（`wordCount`、`wordCountSelection`、`isEmpty`、`style`、`fontsize`、`alignment`、`color`…） | 部分用；**`wordCount` 家族未用**（我们自己正则统计） |
| 内容 | `getNodeContent getSelectionContent insertAtSelection insertAtPosition markdownSplit` | 用（`getSelectionContent` 已用，见 §8 漂移 1） |
| 卡片 | `insertCard insertCardAfter setCardValue cardValue moveCard focusCard deleteCard cardIsExist cardBatchApply` | 用 |
| 结构/容器 | `collapse`(8) `columns`(10) `table`(26) `layout` `moveCollapse moveColumns moveColumn moveTable moveImage` | 部分用；**移动族未用**（统一走"摘-插"） |
| 查找 | `search` `replaceText` `replaceAll` | **全部未用**（我们没有文档内查找/替换） |
| 插入/文件 | `insertFile insertFiles dropFile image imageTask insertImage` `link unlink insertLink linkText updateLink cardToLink` | 用 |
| AI/其他 | `alert`(4) `dateCard getSelectDateCard` `math` `codeblock` `markdownStream` `mention` | `markdownStream` 未用 |

### 2.2 扩展点（官方明确）
- 工具栏：`toolbar.agentConfig.{default,table,codeblock,simple,note}.items`（文档 04，`"|"` 分隔）；`ToolbarOptionHelper.start().removeItems().insertBefore().getOption()`（文档 05）；自定义 `ToolbarUIDescriptor`（`getInitUIState/getUIState/onEvent`）。
  **内核默认工具栏 items（vendor bundle 实测）**：`cardSelect | undo redo formatPainter clearFormat | style fontsize bold italic strikethrough underline mixedTextStyle | color bgColor | alignment unorderedList orderedList indent lineHeight | taskList link quote hr search correction`；`table` 另加 `tableCellBgColor tableBorderVisible tableVerticalAlign tableMergeCell`；`codeblock` 为 `codeblockBold/Italic/…` 7 项；`simple` 为 `cardSelect undo redo bold italic strikethrough underline fullscreen`。
  ⚠️ `disabledPlugins` 取值 = 插件 `PluginName`（源码合集 ≈90 项，**官方未枚举**；传未知名不报错）；我们现用 `["save","toolbar","emoji"]`，其中 `emoji` 在 bundle 里 `pluginName:'emoji'` **0 命中**（真实面板走 `unicodeEmoji`），该值是否有效需实测。
- 插入面板：`slash.cardSelect.{general,table,collapse,simple}.groups[].items`（文档 55；**内核注册表**，见 `vendor/.../src/configs/slash.ts`）。
- 自定义卡片：`customCard.cards[]`（`name/cardType/slash/initValue/editorComponent/viewerComponent/writeText/writeHtml`，文档 69）。
- 适配器：`envAdapter`（编辑 7 / 阅读 4 口；文档 48）。
- 卡片/容器浮栏：插件 `miniToolbar` + `IMiniToolbarService`（`setDisabledMiniToolbarItems/addDisabledMiniToolbarItems/removeDisabledMiniToolbarItems/registerFilterMiniToolbarItems`）+ 内置项 `copy delete copyLink cut spacing maximize widthMode comment`（§5.10）。
- 事件：`contentchange selectionchange focusstatuschange focus blur beforedestroy`（文档 07）。
- 读写：`getDocument/setDocument(type)`，`type = text/lake|text/html|text/plain|text/markdown|json`（文档 07）。

### 2.3 内核**没有**或**未导出**（决定了 A/D 类为什么保持自研）
- `createOpenEditor` **可传 `envAdapter`（官方口，T:581-632），但宿主当前一处都没传**（全仓无 `envAdapter:` 选项）⇒ 见 B8。
- **没有**：文本选区浮动格式栏（云端语雀也没有，§5.10）；"转化为"（convert）命令；批量把块选区转类型；文档内查找的**结果定位 API**；导出（export）命令；`customCard.readHtml`；插件注册公开契约。
- **未导出**：颜色面板组件（`LakeColorBoard` 只能复刻类名+色值）、`ToolbarUIDescriptor` 基类（我们自写最小子集）、`ISelectionHelperService`（只是卡片工具栏注册服务，不是块选择 API）。
- **本构建实测不生效**：`allowClickToMaximize`（图片点击放大不派发，见 `src/features/editor/LakeEditor.tsx:107`）；`/ ` 斜杠在移动端不可靠（§5.23/§5.30）；`unicodeEmoji` 卡只渲染死占位（§5.29）。

---

## 3. 逐条清单

### 3.1 A 类｜内核有该能力，我们自研了（多数**保持**，只收口数据源）

#### A1 移动端输入面（dock + 「＋」面板 + 「Aa」面板）
- **现状**：`src/mobile/editor/EditorDock.tsx`（615 行）自建 7 项主条 + 「＋」18 项（:374-407）+ 「Aa」面板；逐项调内核命令。移动端内核工具栏被关：`lakeRuntime.ts:745-747`（`showToolbar:false` ⇒ `disabledPlugins:["save","toolbar"]`）。
- **内核证据**：官方 04/05（工具栏 items 全量、`ToolbarOptionHelper`、自定义 descriptor）；插入面板 = `slash.cardSelect` 注册表（`src/configs/slash.ts:80-129`）；官方 55。
- **判定**：**UI 自研保留**（用户 261012/261014 定稿：移动端独立 UI、输入面只有 dock，别再搬回去）；但**条目数据源应收编**（并入 C1）。
- **建议**：不动 dock 的形态与交互；只把"能插什么/叫什么/归哪组"改为从内核 `slash.cardSelect` 派生。
- **代价/风险**：低。风险在"内核派生项里有些我们没打算给移动端"（如第三方服务组，已过滤 `third-party-services`）→ 需保留一份**显式排除清单**。
- **验收**：`insert-panel-geometry.mjs`（G1–G6 ALL PASS）+ 设备截图；条目数与分组对拍（当前 18 项 / 4 组）。

#### A2 桌面文字选区浮动格式栏（SelectionToolbar）
- **现状**：`src/features/editor/selectionToolbar/SelectionToolbar.tsx`（980 行）+ `useSelectionToolbar.ts`（257 行）+ `selectionToolbarModel.ts`；命令走 `editor.execCommand`，状态走 `queryCommandValue`（内核查询）。
- **内核证据**：§5.10 结论 2——**内核没有文本选区浮栏**，云端语雀也没有；内核 `miniToolbar` 只覆盖**卡片/容器**。
- **判定**：**自研有据，保持**；不是"重复实现内核能力"。
- **建议**：只做两件收口：① 状态判据继续只用内核查询（现已如此）；② "卡片相关项"（复制/剪切/删除/链接）与内核 `miniToolbar` 的关系见 C3。
- **验收**：不动几何就不跑视觉门禁；若改判据需跑 `selectionToolbar.wiring.test.ts`。

#### A3 颜色面板与色阶（LakeColorBoard + core/colorPalette.ts）
- **现状**：`LakeColorBoard.tsx` 用内核 `lake-colorboard*` 类名 + 我们保存的色阶重画；**颜色记忆已复用内核**（`colorMemory.ts` 读写 `IToolbarEditorService._descriptorDefines[color|bgColor].pluginContext`）。
- **内核证据**：§5.10 九（本体=上次色、三角=面板、`getColor/setColor`）；面板组件**未导出**（`LakeColorBoard.tsx` 头注释）。
- **判定**：**保持**（未导出件无法 import）。
- **建议**：仅登记"若内核未来导出颜色面板，则替换"；当前不立项。
- **风险**：我们复刻的类名随内核升级可能变（升级时按 `docs/USHEET-UPGRADE.md` 同款姿势做探针）。

#### A4 表情面板与表情数据
- **现状**：桌面 `Sidebar` 的 `EmojiIconPicker`、移动 `src/mobile/ui/EmojiPanel.tsx`、数据 `src/lib/lakeEmojis.ts`（从内核资源提取，1055 格 / 9 组）。
- **内核证据**：§5.29 实测——`unicodeEmoji` 卡**只渲染死占位**，"选中表情 ⇒ `insertText` ⇒ 删卡"这套逻辑属于内核自己的选择器上下文；宿主侧正确姿势 = 自实现选择器 + 走插入通道。
- **判定**：**自研有据，保持**（官方要求使用方提供 UI，与 `longPressCard` 同型）。
- **建议**：仅讨论"表情数据是否改运行时从内核取"，避免内核升级后数据陈旧。当前静态提取 + 单测锁住，可接受。
- **验收**：`.css-audit/node-icon-soft-261015/` 已有证据；如改数据源需重跑两端表情面板实拍。

#### A5 增强大纲（features/outline + 隐藏原生 toc）
- **现状**：`OutlineController.ts`（数据 = 内核 `getDocExtraContent().toc`）、`OutlineSidebar/List/Minimap.tsx`、`lakeRuntime.ts:1407-1468`（改 `.ne-toc-item` 的 `ne-toc-selected`、点击定位）、原生侧栏被 CSS 隐藏（`collapseNativeToc` ⇒ 官方 `toc.normalView=false`，`lakeRuntime.ts:791-807`）。
- **内核证据**：官方 65（`toc.enable/normalView/allowModifyHash/getContainer`）+ `tocChange` 事件；§5.1/5.4/5.7（填充时序、阅读态两套类名、隐藏 ≠ 退出布局态）。
- **判定**：**数据源已是内核，UI 自研有据**（虚拟渲染下内核 watcher 失效 + 需要折叠/过滤/层级展开/minimap）。**保持**。
- **建议**：登记一条待实测——内核 `toc.getContainer` 能否让我们少一层 DOM 猜测（现在是 `document.querySelector('.ne-toc-sidebar')` 全局查）。

#### A6 小记预览快路径（quickNotePreviewParser）
- **现状**：自研纯文本/列表/媒体解析器（**零内核实例**）+ 出现不支持节点时整条交给 `QuickNoteKernelPreview`（内核只读兜底）。
- **内核证据**：内核阅读态渲染器可渲染任意格式；§5.30/AGENTS §4 记录了冷启动 6123→533ms 的收益。
- **判定**：**刻意双轨，保持**（有性能证据，不是重复实现）。

---

### 3.2 B 类｜内核有命令/查询/API，我们没用（**优先做**）

> 编号顺序按"建议动手顺序"排：B1 字数 → B2 查找替换 → B3 全选 → B4 移动族 → B5 选区字数 → B6 文本增强 → B7 导出 → **B8 envAdapter 适配口** → B9 媒体路由。

#### B1 字数/字符统计 — ✅ **已实施（261016）**：字数统一走内核 `wordCount`
- **现状**：**三处**各写一套自研口径——
  - 桌面：`src/core/docStats.ts:21` `computeDocStats()`：`content.replace(/<[^>]+>/g,"")` 后取 `.trim().length`（对 ≤32 MiB 正文 O(n)，App 层节流调用）；
  - 移动：`src/mobile/bridge.ts:568`：`plain.match(/[\u4e00-\u9fff]/g)` + `[A-Za-z0-9]+` 另算一套；
  - 主进程文档属性：`electron/store.ts:671-672`：与移动端同款正则（第三套）。
- **内核证据**：插件 `content` 命令 `wordCount`、`wordCountSelection`、`isEmpty`（§5.9）；官方 08 有 `queryCommandValue('wordCount')`。
- **判定**：类型 4（可替代）+ 顺带消掉**两套口径**。
- **建议**：状态栏/详情页字数改 `queryCommandValue("wordCount")`（选区用 `wordCountSelection`）；`docStats` 只保留"图片数"。
- **代价/风险**：中低。**必须先实测**内核 `wordCount` 的语义（字符数 vs 词数、CJK 计数方式）与 32 MiB 大文档下的耗时；口径变化会改状态栏数字（用户可见），需要你确认接受。
- **验收**：同一文档对比"正则 vs 内核"数字（记录差异原因）；`DesktopStatusBar` 单测 / 移动设置页 `NoteInfoSheet` 实拍。

**实施记录（261016）**

| 项 | 落地 |
| --- | --- |
| 内核语义来源 | vendor `lakex.js` 约 3301326 的 `DM()`（即 `content.wordCount` 默认实现 `option.wordCount(kernel.getDocument('text/plain'))`）：非 ASCII 连续串按**字素**逐个计 1 → 替换为空格；`--` 紧跟空白再补 1；余下按空白分词 |
| 新增单一来源 | `src/core/textStats.ts`：`countWords()`（内核同语义移植）+ `countChars()`；`Intl.Segmenter` 字素切分，缺失时退回码点 |
| 桌面状态栏 | `src/core/docStats.ts` 新增 `kernelWordCount()` / `resolveDocStats()`；`src/hooks/useDocumentStats.ts` **优先读内核** `queryCommandValue('wordCount')`（内核自己的状态栏控件同款：同文件约 7437619，订阅 renderer `contentchange`），拿不到实例（锁定预览/未挂载）才用正文兜底 |
| 防闪 0 守卫 | 内核刚挂载、文档还没 `setDocument` 时会返回 0 ⇒ `resolveDocStats` 在此情形用正文兜底（正常运行帧两者一致） |
| 收口的两处自研正则 | `electron/store.ts`（桌面文档属性）+ `src/mobile/bridge.ts`（移动文档属性）都改调 `countWords/countChars` |
| 测试 | 新增 `src/core/textStats.test.ts`（7 例）；`src/core/docStats.test.ts` 扩到 10 例（合计 17 例：含内核 0 值守卫、抛错回退、字素/连字符边界） |

**门禁**：`npx tsc --noEmit` ✓ · `npx vitest run` **258 文件 / 2010 例通过**（5 文件 / 16 例跳过）✓ · `git diff --check` ✓。

**运行时实测**（隔离 `lake://app` 实例 + CDP，`LAKE_USER_DATA=$TMPDIR/lake-b1-probe` / CDP 9266 / 资源 19870）：
夹具正文 `<p>你好 world</p><p>a -- b</p><p>hello-world 3.14</p>` ⇒ 内核 `getDocument('text/plain')` = `"你好 world\na -- b\nhello-world 3.14"`；
`queryCommandValue('wordCount')` = **8**、移植实现 = **8**、状态栏「字数」= **8** ⇒ 三项一致（`PROBE PASS`）。探针脚本为临时件（`/tmp/lake-b1-probe.mjs`），**不入库**。

**口径变化（用户可见，已实测）**：状态栏与文档属性从"去标签后的字符数（含空格标点）"变成**内核/云端语雀口径**。同一夹具：旧桌面口径 = 30，新口径 = **8**；旧移动/主进程口径（CJK 字 + 拉丁 token）在 `3.14`、`hello-world`、中文标点处也与新口径不同。⇒ 现在**两端与云端一致**。**用户 261016 定：保持现状**（不并列显示字符数）；若日后想改，落点仍只在 `DesktopStatusBar` 一处。

**未做（保留）**：编辑器内选区字数 `wordCountSelection`（B5 一起做）；内核 32 MiB 大文档下的 `wordCount` 耗时未单独压测（内核自身在每次 `contentchange` 都这么算，风险与现状同量级）。

#### B2 文档内查找 — ❌ **不做（用户 261016 定）**：内核自带查找已够用，宿主入口已整体回滚

- **现状**：`src/components/SearchPanel.tsx` 是**库级**搜索（`native.searchNotes` + FTS 索引），与"文档内查找"不是一回事；**文档内查找不需要我们做** —— 内核自带。
- **内核证据**：插件 `search`（`toolbar:'search'`，命令 `search`/`replaceText`/`replaceAll`）自带完整面板 `.ne-ui-search-panel`（查找/替换两个页签、输入框、命中计数、上一个/下一个）；热键由该 descriptor 注册，本构建开着虚拟渲染 ⇒ **⌘F**；该命令族**不在官方 08 文档里**（属"文档没写、bundle 有"）。

**A 批次实测（261016，隔离 `lake://app` + CDP）**

| 结论 | 证据 |
| --- | --- |
| 内核面板开箱可用：输入关键词即高亮并给 `N/M` 计数 | 实测 + 用户截图（`1/26`） |
| 只能被**真实按键**唤起：trusted 按键可开；页面内合成 `KeyboardEvent`（untrusted）无效 | 对照实测 |
| 没有可编程打开口：`hotKey` 插件未注册 service；从 `renderer._$services[]` 取到管理器后 `triggerHotKey('openSearchPanel')` 返回 undefined、面板不出现 | 实测 |
| 热键要求**编辑器持焦**；`search` 命令入参是**选区/ranges**（不是关键词） | 实测 + 读码 |

**桌面：不做宿主入口（用户 261016 定）**。内核查找替换**当前即可用**（⌘F，面板自带高亮与计数）；
我一度加的"顶栏按钮 + 主进程 trusted ⌘F 注入"（`d62d06e`）**已整体回滚**（见 §9 的 revert 行），顶栏恢复原样、桌面 stylesnap 基线不需要重烤。

**移动端：已实施（261016）** —— 用户澄清"文档搜索入口"要的是**移动端**。
内核面板在移动端**根本不存在**：移动端关掉了内核工具栏插件（`showToolbar:false` ⇒ `disabledPlugins:["save","toolbar"]`），
而该面板只随工具栏的 search descriptor 一起挂载 ⇒ 没有面板、也没有热键 ⇒ 只能自研。

| 项 | 落地 |
| --- | --- |
| 引擎 | `src/mobile/editor/mobileFind.ts`：DOM 文本节点扫描（**移动端文档开了 `disableVirtualRendering:true` ⇒ 整篇正文都在 DOM 里**）+ CSS Custom Highlight API 双高亮（全部/当前）；`n/m` 计数、环形上一个/下一个；不支持该 API 时降级为只滚动定位 |
| 界面 | `src/mobile/editor/MobileFindBar.tsx` + `mobile-find.css`（新文件，已登记 `mobileLayers`），控件复用 kit 的 `.mb-input` / `.mb-iconbtn--compact`，只加容器与 `::highlight` 两条 |
| 入口 | **工作区顶栏右上角**（与「编辑」并列；工作区胶囊是定稿四格、且明令不放搜索）；只在 `kind==="doc"` 可用，切文档自动收起 |
| 接线 | `DocumentEditor.tsx`（回调 ref 把正文容器以 state 暴露给查找条）+ `NotebookWorkspace.tsx`（顶栏按钮 + 状态 + 传参） |

**设备实测**（AVD lake_gate / emulator-5554，真实点按 + 真实 `Input.insertText`）：
输入正文后打开查找、搜「人类」⇒ **`1/3`**、`CSS.highlights.size=2`；点「下一个」⇒ **`2/3`**；关闭 ⇒ 查找条消失且 **`highlights=0`**（高亮清干净）。截图 `.css-audit/mobile-find-261016/find-bar.png`。
**移动 6 态快照门禁**：入口给顶栏加了 1 个按钮 ⇒ 属 AGENTS §3#21③ 的构成变化，按配方**重烤基线**（`--from gate-warm*.json --write-baseline`），冷启动后复跑 **6 态 0 差异**（基线仍是专用实例 + 夹具口径）。

**门禁**：`tsc` ✓ · `vitest run` **262 文件 / 2029 例通过**（5 文件 16 例跳过）✓ · `git diff --check` ✓ · `ui-metrics` ✓ · `check:mobileui` ✓。

#### B3 全选：手工 Range vs 内核 `selectAll` / `selectAllDoc`
- **现状**：块选择走手工 `createRange` + `transformDOMRange`；`selectAllDoc` **0 处使用**。
- **内核证据**：§5.9 候选 1：`selectAll` 上下文感知（表格单元格/整列/容器 hole 时选上层结构），`selectAllDoc` 整篇。
- **判定**：类型 4。
- **建议**：把"把光标放进目标块 → `execCommand('selectAll')`"用于块选择；`selectAllDoc` 用在"整篇操作"（如导出、AI 全文）。
- **风险**：低；但"仅选中节点本身（非内容）"内核没有对应命令，那部分仍需手工 range（§5.9 已写明）。
- **验收**：`blockMenuNative.test.ts` / 真实端手动多块选择。
- **❌ 结案（261017，用户定不做）**：核对全仓 —— `selectAll` 仅 1 处（`CardContextMenu.tsx:106` 卡片菜单）、`selectAllDoc` **0 处**；无消费方、手工 Range 无缺陷证据 ⇒ 按 AGENTS §3#17 不做，不引入"两套全选并存"。

#### B4 容器/块移动：统一"摘节点→插入" vs 内核移动族
- **现状**：`moveBlockNative` 对非卡片块统一"摘节点 → 落点插入"；`moveCollapse`/`moveColumns`/`moveColumn`/`moveTable`/`moveImage` **0 处使用**。
- **内核证据**：§5.9 候选 2（"更省且保内部节点 id"）。
- **判定**：类型 4。
- **建议**：容器（折叠块/分栏/表格/图片）优先走内核专用移动命令，卡片已有 `moveCard`。
- **风险**：中——移动语义/撤销栈表现需逐类型实测（表格、分栏、折叠块各一档）。
- **验收**：移动后 `.lake` 序列化对比（节点 id 保留）+ ⌘Z 一次撤销回到原位。

**B4 评估记录（261016：读码 + 运行时实测）— 结论：不做（不替换现有实现）**

**七个命令的真实语义**（读码要点：命令类的**类体在 `Object.defineProperty(Cls,'ID',…)` 之前**，要按 ID 名**往回**找类体）：

| 命令 | 语义 | 前置条件 |
| --- | --- | --- |
| `moveCollapse(collapseId, nodes)` · `moveColumns(columnsId, nodes)` · `moveTable(tableId, nodes)` | **目标侧插入**：把 `nodes` 插到该容器/卡片**所在位置**，再选中该容器（保节点 id） | 目标类型必须匹配（`nodeName === collapse/columns`、`hasCategory(Table)`） |
| `moveCard(cardId, position)` · `moveImage(cardId, position)` | 把该卡片移到 `position`；**`moveImage` 是 `moveCard` 的子类、无自有 execute** | 需要**内核内部的 position 对象** |
| `moveColumn(columnsId, from, to)` | **容器内列重排**（真正的 reorder；越界返回 false） | 目标必须是 columns 节点 |
| `tableRowMoveTo(i)` · `tableColumnMoveTo(i)` | 把**当前选区所在表格**的行/列移到索引 i（整数校验） | 依赖选区 |

**运行时实测**（隔离 `lake://app` + CDP；文档 = 两段 `<ne-p>` + 一张图片卡）：
`moveImage(cardId, …)` 依次试了三种位置形状 —— ① DOM 节点 `{node: <ne-p>, offset:0}`；② `ed.engine.transformDOMRange(range).start`（模型 position，实测 `start.node.type === "p"`）；③ 整个 `{start,end}` ⇒
**三种全部抛 `setStart: parameter 1 is not of type 'Node'`**，且 `.lake` 序列化**逐字节未变**、`undo` 返回 `false`（什么都没发生）⇒ 该 position 是**内核内部类型**（它自己拖拽链路的产物），**无法从公开面构造**。

**为什么不替换**（AGENTS §3#17 三问）：① `moveBlockNative` 覆盖**所有块类型**，内核没有"任意块移动"接口（非卡片块完全没接口）⇒ 换过去只能覆盖子集、还得保留现有实现（两套并存更复杂）；② 能用的两族要么需要内部 position（不可驱动），要么是"容器内重排"而我们**当前没有**这种需求；③ 收益不明确 + 新增对未公开内部结构的依赖 ⇒ **不做**。

**登记为将来选项**（真有需求时直接用，不必自研）：分栏列重排 = `moveColumn(columnsId, from, to)`；表格行列重排 = `tableRowMoveTo(i)` / `tableColumnMoveTo(i)`（都走内核撤销栈、保节点 id）。

#### B5 选区取内容/字数：`getSelectionContent` 已在用，`wordCountSelection` 未用
- **现状**：`blockHandleMount.ts:47` 已用 `getSelectionContent('text/markdown')`；选区字数未用。
- **内核证据**：§5.9（**其中"getSelectionContent 未用"一句已过期**，见 §8）。
- **判定**：类型 4（小项）。
- **建议**：并入 B1 一起做（选区字数 = `wordCountSelection`）。
- **❌ 结案（261017，用户定不做）**：全仓无"选区字数"UI（字数只有状态栏/属性面板的**全文**口径），`wordCountSelection` **0 使用**；真要选区计数属**产品新功能**（另立项），不属"内核复用"。

#### B6 移动端文本增强缺项：内核命令齐全，我们没接（**覆盖缺口表**）
- **现状**（`docs/MOBILE-TECH-STACK.md` §八 编辑缺口 + 本次代码核对）：
  | 缺项 | 内核命令 | 我方代码 |
  | --- | --- | --- |
  | H5/H6 | `style "h5"/"h6"` | `PARAGRAPH_STYLES` 已有 h5/h6；dock 未接 |
  | 行高 | `lineHeight` | **0 命中** |
  | 首行缩进 | `firstIndent` | **0 命中** |
  | 缩进/减少缩进 | `indent/outdent` | 桌面用；移动 dock 未接 |
  | 格式刷 | `paintFormat` | **0 命中**（桌面工具栏 items 里有 `formatPainter`） |
  | 清除格式 | `clearFormat` | 桌面有（`SelectionToolbar.tsx:795`）；移动无 |
  | 上标/下标 | `sup/sub` | **0 命中** |
  | 段落间距/排版 | `typography/paragraphSpacing` | **0 命中** |
- **判定**：类型 2（内核有能力，我们没做）——**这是"复用内核"收益最直接的一块**。
- ⚠️ 注意分工：**桌面内核固定栏（默认 items）本来就含 `lineHeight`/`indent`/`formatPainter`/`clearFormat`/`search`** ⇒ 桌面不是缺口；缺口集中在**移动端 dock / 「Aa」面板**（以及移动端没有 H5/H6 入口）。
- **建议**：按 §3 待办"移动端文本增强二级面板"逐项接入，全部走 `renderer.execCommand` + `queryCommandValue` 回显；不新建渲染逻辑。
- **风险**：低-中；移动端`queryCommandValue` 时序（§5.32 ④⑤）已有结论，照抄即可。
- **验收**：设备实测每项落盘形态（参照 §5.32 的表格口径）+ `edit-surface-invariants.mjs`。

**实施记录（261017，用户点单布局；真机已验证）**

- **Aa 面板**：样式行 5 → **7**（H5/H6，`STYLE_BLOCKS`）；行内标记行 5 → **6**（新增「清除格式」）；一级面板统一 `--lake-bg-block` 灰底 + 白卡（与「＋」「更多」同款）。
- **「更多」面板 = 分行白卡 + 每项文字说明**（261017 三改用户点单）：① 公式 · 上标 · 下标 · 格式刷（图标 + 文字）② 首行缩进 · 减少缩进 · 增加缩进（图标 + 文字）③ **行高**（行首「行高」标签 + 6 个数值 1 / 1.15 / 1.5 / 2 / 2.5 / 3，取自内核 `lineHeight` 取值域）④ 画图占位 5 项（**纯文字** + 置灰）。格式刷激活后**自动收面板 + 放回输入法**（两步模式）。
- **主工具栏**（261017 二改/三改/四改）：**加粗放回原位**（Aa 之后、列表之前）；**撤销 / 重做在更多之后**；中间 8 个按钮**保持原尺寸/间距（各 49px）、在横滑区内左右滑动**（393 工具栏 / 344 滚动区 / 392 内容 ⇒ 可滚 48px；`data-prevent-swipe` 防外壳抢手势）；**键盘键固定在最右端不参与滚动**（用户 261017 定，右侧间隙 0）。
- 落点：`EditorDock.tsx`（`LINE_HEIGHT_VALUES` / `moreRows` / `rowBtn` / `inlineMarks` / `runPanelAndClose`）· `editor-dock.css`（一级面板灰底 + `.med-f-btn:disabled`）· `STYLE_BLOCKS` · `mobileLayers` 基线 228→230。
- **设备实测（真机：小米 2109119BC / HyperOS V816 / Android 14，CDP 真点按 + 属性 diff）**：

  | 命令 | 结果 | 落盘证据 |
  | --- | --- | --- |
  | style h5 / h6 | ✅ | 块标签 → `ne-h5` / `ne-h6` |
  | 加粗 | ✅ | `ne-text` 加 `ne-bold` |
  | 清除格式 | ✅ | `ne-bold` 被移除（块级样式保留） |
  | 上标 / 下标 | ✅ | `ne-sup` / `ne-sub` 互斥（加 sub 同时移除 sup） |
  | 增加 / 减少缩进 | ✅ | 块加 / 移除 `ne-indent` |
  | 首行缩进 | ✅ | 块加 `ne-text-indent` |
  | 行高 1.5 | ✅ | 块加 `ne-line-height="1.5"` |
  | 格式刷 | ✅（模式激活） | 点后**面板自动收起**；取格式后的目标点击未在探针内验证 |

  - 面板结构（二改后实测）：Aa = 6 行（样式行 7 项 / 行内 6 项 / 对齐+列表 / 字色 / 背景色 2 行 / 字号 8 档）；「更多」= **4 行白卡**（4 / 3 / 6 / 5 项，零截断，底色同为 `rgb(244,246,248)`）；主工具栏 = 插入 / 字体 / 列表 / 待办 / 更多 / 撤销 / 重做 / 键盘（**8 × 49px，overflow 0**，无「加粗」）。
  - 追加实测：工具栏「撤销 / 重做」可用 —— 加粗 ⇒ 撤销移除 `ne-bold` ⇒ 重做恢复；「更多」行式按钮仍驱动同一批命令（行高 → `ne-line-height`、首行缩进 → `ne-text-indent`、上标 → `ne-sup`）。
  - **三改/四改实测**：横滑区内 = 插入 / 字体 / **加粗** / 列表 / 待办 / 更多 / 撤销 / 重做（8×49px，`overflowX:auto`、`touch-action:pan-x`、`data-prevent-swipe`，可滚 48px 且「重做」可达）；**键盘键固定在右端**（滚动前后 x 均为 344、右侧间隙 0）；「更多」4 行 —— 公式/上标/下标/格式刷（图标+文字）、首行缩进/减少缩进/增加缩进（图标+文字）、行高（标签 + 数值 6 格）、画板/流程图/UML 图/思维导图/文本绘图（纯文字、置灰）；**零截断**、底色 `rgb(244,246,248)`。
  - **未做**：`typography` / `paragraphSpacing`（语义未文档化、桌面也未暴露，按 §3#17 不立项）。
  - **附带修复 A（261017，验证 B6 时发现）**：移动端**文档编辑器**实例没有 `.renderer`，而 dock 的命令执行只走 `editor.renderer.execCommand` ⇒ 文档里加粗/撤销/重做/插表格/附件/大纲展开**全部静默 no-op**（小记实例有 `.renderer`，所以那边正常）。已抽 `src/mobile/editor/execCommand.ts` 的 `execEditorCommand`（`renderer.execCommand → editor.execCommand` 回退）作为**唯一命令入口**，替换 6 处调用点；新增 6 例单测（含**源码级禁令**：`src/mobile` 不得再写 `renderer?.execCommand`）。
  - **附带修复 B（261017，用户报「打字快了能撤销、慢一点撤销不了」）**：**输入法组合中（候选未上屏）**时内核 history 里还没有这一笔，点撤销/重做**完全无反应**（设备实测：组合态连点 3 次撤销文字不动；组合提交后再撤即正常）。已修：dock 的 `runInline` 在命令执行前检测 `compositionstart/end`，组合中先 `blur→focus` 触发提交、等一拍再执行命令。设备实测：组合 `nihao` → 点撤销 → **一次即清空**；组合 `abc` → 点加粗 → 文本正常提交保留；普通输入撤销/重做均正常。护栏：`dockPanelFocusGuard.test.ts` 新增 1 例。

#### B7 导出：内核无 export 命令 ⇒ 应走 `getDocument(type)`
- **现状**：`src/components/ExportSubmenuItem.tsx`（markdown/html/pdf）；落地实现需按只读范围核对（本次未展开 electron 侧）。
- **内核证据**：yuque-re 总账：**无 export 命令**；官方 07 `getDocument(type)` 支持 `text/markdown|text/html|text/plain|json`。
- **判定**：类型 4（应确保导出**走内核序列化**，而不是自研 HTML/MD 转换）。
- **建议**：核对现有导出路径；若存在自研转换，替换为 `getDocument`。
- **验收**：导出产物与内核 `getDocument` 输出逐字节对比。
- **✅ 结案（261017）：已满足，无需改代码**。证据：保存时缓存由内核序列化生成 —— `getDocument("text/markdown")` + `cleanLakeMarkdown`、`getDocument("text/plain")`（`src/hooks/useDesktopHandlers.ts:49-50`、`src/desktop/desktopTypes.ts:90-91`）；导出在主进程读该缓存（`electron/noteExport.ts` 的 `readNoteCaches`），HTML 只做 `mdToHtml` 包装（主进程没有内核实例，这是正确架构）。
  **附带发现（另行登记为 B10）**：usheet 的 CSV/Excel 与 board 的 PNG/SVG 导出仍是 `disabled` 占位 —— 这是**功能缺口**，不属"内核复用"。

#### B8 `envAdapter` 官方适配口整体未接线（6/7 口缺失，1 口为行为等价）
- **现状**：全仓没有传 `envAdapter` 选项；图片放大预览是 `attachImagePreviewClick`（DOM 点击）+ `extractImagesFromContent`（正文解析兜底）；外链靠 Electron/Capacitor 壳层。
- **内核证据**：官方 48 + `types.ts:581-632` 明确 `envAdapter` 是 `createOpenEditor` 的正式 option，编辑 7 口 / 阅读 4 口（`openLink openMentionLink openLocalLink openBookmarkLink openThirdpartyLink previewImgs longPressCard`）。
- **判定**：类型 1/4，但**多数口"不需要接"**：`openLink` 已实测由壳层接管（§5.27），`longPressCard` 官方要求使用方实现 UI（§5.27）。
- **建议**：只做一次**实测探针**——传 `envAdapter.previewImgs` 后，内核在本构建是否会在点击图片时派发（现在 `allowClickToMaximize` 实测无效，见 §8 漂移 3）。若会派发 ⇒ 可删掉"正文正则扫图"这条兜底路径（少一处与正文格式耦合的实现）；若不会 ⇒ 明确写进契约"本构建该口不派发，预览走宿主 DOM + 正文解析"，**不再重复讨论**。
- **风险**：低（只加一个空实现探针）。

#### B9 附件/媒体卡路由：拦 `beforeExecCommand` 改写 category
- **现状**：`src/features/editor/mediaCardRouting.ts` 拦 `beforeExecCommand`，把 `insertFiles` 的 `category` 按扩展名改写（内核按 category 分发 audio/video）。
- **内核证据**：官方 06/63/67/68 给了 `file/video/audio.*` 配置族；内核 `readData("Files", files, {category})`。
- **判定**：类型 3（可能可以用官方配置替代"拦截改写"）；**也可能官方就是没给自动识别** ⇒ 需读码确认。
- **建议**：先查内核是否有扩展名→category 的官方入口；没有就保持并补注释（现状已有注释）。
- **风险**：低（不改也行）。
- **✅ 结案（261017）：保持现状**。官方核对结论：**06 配置上传 / 63 附件 / 67 音频 / 68 视频** 全部只有各卡 `createUploadPromise` / `accept` / `uploadFileURL` 等配置，**没有**"按扩展名自动选 category"的入口；内核分发靠 `readData("Files", files, {category})` ⇒ 宿主侧 `beforeExecCommand` 改写是**唯一**可行桥接（现实现已带完整机制注释）。不改代码。

#### B10 导出占位：usheet 的 CSV/Excel、board 的 PNG/SVG（**非内核复用、功能缺口，只登记**）
- **现状**：`src/components/ExportSubmenuItem.tsx:55-68` 两类导出是 `Placeholder`（`disabled` + title「开发中」）；doc 的 markdown/html/pdf 与 bitable 的 csv/zip 已实现。
- **判定**：不属于"内核已有能力而我们自研"，而是**功能未做**；且落点在 `src/components/`（另一会话的 CODE-REVIEW 写域）。
- **建议**：**本审计只登记、不动手**；要做时按文档类型逐项立产品需求（usheet 取数走 Univer 序列化、board 走 Drawnix 导出），并单独立项。
- **验收（将来）**：导出产物可打开、与原文档数据一致。

---

### 3.3 C 类｜组合调度内核多能力

#### C1 移动端「＋」面板条目改为**内核派生**（保留自绘 UI）
- **现状**：`EditorDock.tsx:374-407` 手写 18 项（图片/拍照/附件/音频/视频/表情/状态/日期/表格/引用/分割线/代码块/高亮块/分栏/折叠块/链接/文档引用/日历 + 公式等），每项自己决定调哪条内核命令。
- **内核证据**：插入面板条目 = 内核注册表（`slash.cardSelect.*.groups[].items`，`src/configs/slash.ts:82-129`）；我们**已经在** `lakeRuntime.ts` 读这份配置（`withNoteRefSlashItem(...)` 注入「文档引用」）。
- **判定**：类型 3（组合：内核注册表 + 我们的命令分发）。
- **建议**：面板条目的"存在/名称/分组"从内核注册表派生（**显式排除**：第三方服务组、移动端不打算给的项目），命令执行仍按现表。好处：内核升级新增卡片时面板自动跟上，避免"内核有、我们面板没有"。
- **风险**：中——派生会引入"内核配置里的隐藏项"（如 `custom-text-to-diagram`）需要排除清单；组名有重名坑（`group-files` 同时是"程序员"和"小工具"，§5.23 提醒只能按 `title` 找）。
- **验收**：`insert-panel-geometry.mjs`（G1–G6）+ 条目集合与内核注册表的对拍脚本。
- **❌ 结案（261017，用户明确不做）**：① 现有排布（两组 8+10 / 4 列 / 顺序 / 末行 2 项）是用户 261015 **亲自定了四轮**的产物，派生化会直接改动它；② 收益仅"内核新增卡时面板自动出现"，**无观测到的痛点**；③ 18 项里拍照/图片/附件/表情/状态/日期/文档引用都是自定义 helper，派生后仍需"内核 item → 我们的 action"映射 + 排除清单，复杂度不低。⇒ 按 AGENTS §3#17 不做。

#### C2 浮动栏与固定栏共用内核状态/记忆
- **现状**：active 判定走 `queryCommandValue`（内核），颜色记忆走 `IToolbarEditorService`（内核）——**已经是对的**。
- **内核证据**：§5.10 九（`getColor/setColor`）；§5.10 七（active 取值口径）。
- **判定**：类型 3（已部分落地）。
- **建议**：把"还有哪些状态是我们自己算的"列一遍（如段落样式`style`、字号`fontsize`、对齐`alignment` 是否全走内核查询），只补差额；**不新增**并行判据。
- **验收**：切换选区时固定栏与浮栏高亮一致（§5.10 七的"晚一拍"口径）。
- **✅ 结案（261017，只读盘点）：已一致，无缺口**。逐项判据来源：

  | 状态 | 来源 | 自算？ |
  | --- | --- | --- |
  | 段落样式 / 字号 / 对齐 / 字色 / 底色 | 浮栏 `queryCommandValue`（`style` / `fontsize`(false) / `alignment` / `color` / `bgColor`） | 否 |
  | 加粗 / 斜体 / 下划线 / 中划线 | `queryCommandValue` + `isMarkActive` | 否 |
  | 行内代码 | `queryCommandState('code')`（Executed=1 / Unavailable=-1，内核 descriptor） | 否 |
  | 列表 / 待办 / 引用 active | `queryCommandState`（内核 CommandState 数值） | 否 |
  | 按钮 disabled | `queryCommandEnabled` / `state === -1`（按各自 descriptor） | 否 |
  | 颜色记忆（上次色） | 内核 `IToolbarEditorService._descriptorDefines[color|bgColor].pluginContext`（`colorMemory.ts`；无内核上下文时才本地兜底） | 否 |
  | 图片卡状态（原尺寸 / 当前宽 / 旋转 / 样式 / 链接 / 标题 / 边距 / 链接打开方式） | 内核卡实例 `cardData` getters（`imageCardOps.ts`） | 否 |
  | 图片块级对齐 | 读内核渲染的 `[ne-alignment]` DOM 属性 | **是（唯一例外）**：卡片选中态没有文字选区，`queryCommandValue('alignment')` 不可用 ⇒ 读内核自己写的属性，语义等价 |
  | 浮框显隐 / 定位 / AI 自绘高亮几何 | DOM Range/Rect（内核无查询口） | 必然（非格式状态） |
  | 自定义工具项（小记 日期/表情/附件） | 只有 `disabled` 生命周期，无格式态 | 不适用 |

  ⇒ **没有"我们自己算的格式状态"**；唯一非 query API 的图片对齐读的是内核渲染属性。**不做代码改动**（用户 261017 已同意盘点即结案）。

#### C3 卡片/容器浮栏：接内核 `miniToolbar`，我们只补内核没有的项
- **现状**：`CardContextMenu.tsx`（自绘卡片右键菜单，含"全选"等）+ 图片浮栏（`SelectionToolbar` 的 `renderImage`，已在用 `updateImageData`/`deleteCard`）。
- **内核证据**：§5.10 一——插件 `miniToolbar`、`IMiniToolbarService`（`setDisabledMiniToolbarItems/addDisabled…/removeDisabled…/registerFilterMiniToolbarItems`）、内置项 `copy delete copyLink cut spacing maximize widthMode comment`；`miniToolbar.disabledItems` 选项。
- **判定**：类型 3（组合调度：内核 itemConfig + 过滤 + 事件刷新）。
- **建议**：图片/卡片上的"复制/删除/复制链接/剪切/间距/全屏/宽度"改用内核 inner 浮栏，我们只保留内核没有的项（如 AI、批量应用）；用 `registerFilterMiniToolbarItems` 隐藏不要的项。
- **风险**：中——涉及已有视觉与交互（用户已定稿图片浮栏），**改前需你确认**；且 hidden window 下 rAF 合并刷新会失效（§5.10 七的坑）。
- **验收**：图片/卡片浮栏逐项实拍 + `selectionToolbar.wiring.test.ts`。
- **✅ 结案（261017，用户定结案）：命题不成立 / 已在使用**。取证（读码 + vendor/wrapper 配置）：
  - **块卡片/容器**：内核 miniToolbar **本来就在跑**（hover 触发；`ne-card` / `ne-table-hole` / `ne-alert-hole` / `ne-container-hole`）；`lakeRuntime.ts` 的 `setupCardToolbarHoverBridge` 只是修"鼠标移向浮栏被 mouseleave 提前关闭"的可用性 bug ⇒ 是**在用**的证据，不是替代实现。我方未配 `disabledItems`/filter（全仓 0 命中）。
  - **inline 图片**：本构建原生 cardToolbar 的 **focus 通路是空桩**（vendor `plugin/imageToolbar/index.ts` 注释：`getToolbarControllerConfig` 返回 undefined，只有 mouseenter 渲染）；wrapper `configs/image.ts` 因此显式设 `showMiniToolbarWhen:"never"` + `miniToolbar:[]`，并另写 `ImageToolbar.tsx`（945 行）——**但它只挂在 `LakexEditor.tsx:226`，而我们直接 `Doc.createOpenEditor`（`lakeRuntime.ts:741`）⇒ 在产品里从不运行**（AGENTS §2⓪ 的坑）⇒ 图片用内核浮栏**不可行**。
  - **我们自研的图片浮栏**（`SelectionToolbar.renderImage`，用户 260924 定稿）**观感/几何全复用内核类** `.ne-card-toolbar*` / `.ne-ui-card-toolbar-divider`（`SelectionToolbar.tsx:876-895`），能力全走内核命令（`updateImageData` / `deleteCard` / `setCro` / `cardBatchApply`）⇒ 不存在"另造一套视觉"。
  - **右键菜单** `CardContextMenu` = 宿主文件操作（打开/显示位置/另存为/重命名/复制路径/图片/剪切），内核没有；仅"剪切/复制"与内核浮栏语义相邻但不同（系统剪贴板 vs 文档结构）。
  - **唯一残留**：内核浮栏内置项未按卡片类型过滤（`comment` / `maximize` / `widthMode` 对部分卡片可能无意义）——**未实测、无用户反馈/缺陷证据**，按 AGENTS §3#17 不立项。
  ⇒ **不改代码**。

#### C4 块菜单块级动作原生化
- **现状**：`blockHandleMount.ts` 已挂 vendor `BlockHoverHandle`（因为 `createOpenEditor` 不自动挂），菜单动作要求走内核命令（文件头已写安全边界）。
- **内核证据**：§5.9 的块编辑对照表（删除/复制/插入已用；移动族、`selectAllDoc`、`wordCountSelection` 未用）。
- **判定**：类型 3（与 B3/B4/B5 同一批）。
- **建议**：并入 B3/B4/B5 一起改，避免三处各改一次。

#### C5 阅读态/AI 流式：`createOpenViewer` + `markdownStream`
- **现状**：AI 消息用自研轻量 `MarkdownView.tsx`（202 行，React 元素渲染、无内核实例）；历史预览用 `createLakeDocument(viewer)`；AI 结果落正文已走 `insertAtPosition/insertAtSelection`（内核）。
- **内核证据**：官方 09 `viewer.execCommand('markdownStream', markdown)`（可反复更新、不重建）；yuque-re 总账记录 `createMarkdownViewer`（**无文档**）。
- **判定**：类型 3，但**收益不明**——挂内核渲染 AI 流式要付内核实例成本（冷启动/内存），而 `MarkdownView` 是零依赖轻量件。
- **建议**：**保持现状**；只在"需要与正文完全一致的渲染"（例如 AI 预览要支持表格/公式/画板）时再评估，且必须先有三问证据。
- **风险**：若贸然替换 = 违反 AGENTS §3#17（为"统一/优雅"加抽象）。

---

### 3.4 D 类｜内核确实没有 ⇒ 登记"不再立项"

| 编号 | 事项 | 依据 |
| --- | --- | --- |
| D1 | 文字选区浮动格式栏 | §5.10 结论 2：内核没有、云端语雀也没有 |
| D2 | 库级搜索（FTS 索引/增量/短词） | 内核只有**文档内** `search/replaceText`；库级索引是我们的领域 |
| D3 | 历史快照存储与版本链 | 内核无（预览本身已复用内核 viewer） |
| D4 | 回收站/墓碑/恢复/同步/GC/S3 | 内核无关（AGENTS §3 语义） |
| D5 | 多维表 / 表格(usheet) / 画板(Drawnix) 本体 | 非 lakex 内核（Univer / Drawnix / 自研） |
| D6 | 目录树、笔记本、节点图标 | 内核无（用户 261014/261015 已定稿自有图标体系） |
| D7 | 小记预览快路径 | 性能双轨（见 A6） |
| D8 | `envAdapter` 外链打开 / `longPressCard` | §5.27：外链靠壳层（实测正常）；`longPressCard` 官方要求使用方实现 UI |

> 另：**内核未导出件**（颜色面板、`ToolbarUIDescriptor`、`ISelectionHelperService`）只能复刻或自实现，**不要为此改 vendor**（AGENTS §3#18）。

---

## 4. 当前待办（261017 更新）

> 原"建议顺序"已随结案重写；逐条状态看 §3 的结案行与 §9。

1. **无未处理项**（C2 已盘点结案）。
2. **已实施、待用户验收**：`B6` 移动端文本增强缺项（261017：H5/H6 + 清除格式 + 「更多」7 项 + 行高 6 档 + 一级面板灰底；真机逐项实测通过）。
3. **只登记、不动手**：`B10` 导出占位（非内核复用、功能缺口）。
4. **保持 + 契约已回填**：`A1–A6`、`D1–D8`。
5. **已结案**：`B1`（实施）· `B2`（移动实施/桌面不做）· `B3/B5`（不做）· `B4`（不做）· `B7`（已满足）· `B8`（不做）· `B9`（保持）· `C1`（不做）· `C2`（已一致）· `C5`（保持）。

---

## 5. 统一验收口径（每条改完都按这个跑）

- 门禁：`npx tsc --noEmit` + 相关 `vitest` + `git diff --check`（AGENTS §3#21 ①）。
- 内核命令类改动：**必须实测**（CDP 探针），且：
  - **不能用 `queryCommandEnabled` 当"能不能用"的门**（§5.32 ⑤ 会误报 false）；
  - **不能吞命令返回值**（`=== false` 才是内核明确拒绝，§5.32 ⑤）；
  - 从我们自己的输入框交还选区后，桌面同 tick 可用、**移动端需失败重试一次（~160ms）**（§5.32 ④）。
- 视觉层：桌面 `check-stylesnap.mjs --states "<受影响态>"`；移动 `check-mobile-snap.mjs --states home-quicknotes` + 走查传屏名（AGENTS §3#21 ②）。
- **契约回填**：任何新观测写进 `docs/LAKEX-CONTRACT.md`（AGENTS §2 ②），别只留在本文或代码注释。

---

## 6. 需要你裁定 / 需要先实测的问题

**需要裁定**
1. ~~移动端「＋」面板条目是否允许改成"内核注册表派生 + 自绘 UI"（C1）？~~ **已裁定（261017）：不做**（用户明确不想做；理由见 §3.3 C1 结案行）。
2. ~~是否要做**文档内查找**（B2）~~ **已收口（261016）**：**桌面不做宿主入口**（内核自带 ⌘F 面板可用，我加的入口已回滚）；**移动端已实施**——内核面板在移动端不存在，自研 `MobileFindBar`，入口 = 工作区顶栏右上角。
3. 卡片/图片浮栏是否收回内核 `miniToolbar`、我们只补内核没有的项（C3）？会动已定稿的浮栏观感 —— **用户 261016 定：先不做，需要讨论**。**✅ 结案（261017，用户定结案）**：命题不成立/已在使用，证据见 §3.3 C3 结案行；不改代码。
4. 移动端文本增强缺项（B6）是否按"下一会话焦点"全做？—— **用户 261016 定：先不做（属添加项，不着急）**。**（261017 重申：不着急，不排期）**
5. ~~字数口径若从"我们正则"改成"内核 `wordCount`"，数字可能变化（B1），是否接受？~~ **已实施（261016）**：数字确实变了（见 §9.1 的前后对比）。展示形态：**用户 261016 定 = 保持现状**（状态栏只显示「字数」，不加并列字符数）。

**A 批次实测结果（261016；探针为临时件，不入库）**

| 项 | 结果 | 后续 |
| --- | --- | --- |
| `wordCount` / `wordCountSelection` | ✅ 可用且一致（`selectAllDoc` 后选区 11 = 全文 11，并在 B1 里接了状态栏） | 已完成 |
| 内核查找面板 / ⌘F / 合成事件 | ✅ 面板可用；**只有真实按键能唤起**；合成事件与 `triggerHotKey` 均无效 | 桌面已做入口（B2） |
| `search` / `replaceText` / `replaceAll` 入参 | ✅ 读码确认入参是**选区/ranges**（不是关键词）⇒ 复用单位是面板 | 移动端若要查找只能自研（待讨论） |
| `envAdapter.previewImgs` 是否派发（B8） | ✅ **已实测（261016）：本构建不派发** —— ① 在活动宿主内挂 `editor.on('previewImgs')`，真实点击 64×64 inline 图片卡中心：**事件 0 次**；② 临时接上 `envAdapter.previewImgs` 重建复测：**回调仍 0 次**（内核默认 `allowClickToMaximize: true`，也不是"选项没开"）。临时改动已回滚、残留 0 | **B8 结案**：自研 DOM 点击 + 正文解析预览是**必需**，非重复实现（契约 §5.40） |
| `miniToolbar`（C3） | ⏳ 未测 —— 用户 261016 定「先不做，需要讨论」，故本轮不投入 | 讨论时再测 |
| `moveCollapse` / `moveColumns` / `moveTable` / `moveImage`（B4） | ✅ **已评估（261016 读码 + 实测）⇒ 不做**：读码定清 7 个命令的真实语义（`move*` 是**目标侧插入**；`moveCard/moveImage` 需要**内核内部 position**；`moveColumn/tableRowMoveTo/tableColumnMoveTo` 是容器内/表格行列重排）；实测 `moveImage` 三种位置形状全抛 `setStart: … not a Node`、`.lake` 未变 | 见 §3.2 B4 评估记录；将来做容器内重排可用 `moveColumn` / `tableRowMoveTo` / `tableColumnMoveTo` |
| `toc.getContainer`（A5） | ❌ 用户 261016 定：A5 不做 | 关闭 |

---

## 7. 证据与复查方法

```bash
# 1) 内核命令注册表（§5.9 的枚举脚本，可复现：43 插件 / 147 条）
node -e "…"   # 见 docs/LAKEX-CONTRACT.md §5.9 末的脚本原文
# 2) 逆向仓内核总账（重跑会写产物，默认别跑）
node /Users/admin/file/local-lake/yuque-re/kernel/scripts/extract-kernel-api.mjs
# 3) 我方"用了哪些内核命令"（本文 B 类判据）
cd /Users/admin/file/local-lake/lake-notes-electron
grep -rn "execCommand" src --include=*.ts --include=*.tsx | grep -v '\.test\.'
# 4) 官方出处
ls /Users/admin/file/local-lake/yuque-developer-docs/docs/
sed -n '1,60p' "/Users/admin/file/local-lake/yuque-developer-docs/docs/08 - 命令列表 [ndflcx5eprg7gbdl].md"
# 5) vendor 命令参数参考
sed -n '1,40p' vendor/lakex-doc-react/docs/execCommand-reference.md
```

---

## 8. 本次顺手发现的文档漂移（建议回填）

1. **`docs/LAKEX-CONTRACT.md` §5.9 的"候选原生化改造"里，`getSelectionContent` 标着"未用"——已过期**：`src/features/editor/blockHandleMount.ts:47` 在用（块菜单取 Markdown）。**✅ 已回填（261017）**：§5.9 该行已改为「均已用」。
2. **`HANDOFF.md` §0 的 261015 节写着"未提交/未推送"**，但仓库实况是：该批已提交 `fc87325`，与 `origin/master` 0 ahead / 0 behind、工作树干净。
3. **（261016 已结案）`§5.27` 的 `previewImgs` 标"✅ 已实现"需要写清边界**：我们的代码里**没有传 `envAdapter.previewImgs`**（全仓无 `envAdapter:` 选项），图片放大是 `attachImagePreviewClick` 的 DOM 点击 + `extractImagesFromContent` 正文解析兜底，原因是本构建 `allowClickToMaximize` 无效（`src/features/editor/LakeEditor.tsx:107`）。⇒ 建议改成"行为等价、非适配口实现"，该待实测**已结案（261016）**：本构建点击 inline 图片卡确实**不派发**（接不接 envAdapter 都不发），详见契约 **§5.40** 与本文件 B8。
4. **字数统计存在两套自研口径**（`src/core/docStats.ts:21` 与 `src/mobile/bridge.ts:568`）：即使不接内核 `wordCount`，这两处也该收口到单一来源。
5. **`AGENTS.md` §2⓪ 的检索提示"图标族 `ne-t-*`"不准确**：vendor 侧 `ne-t-*` 只在 wrapper 自己的 sprite（`src/components/lakex/icon.tsx`，共 8 个：`ne-t-link`、`ne-t-image-crop/reset/rotation/size/style/title`、`ne-t-batch-apply`），**不是内核工具栏图标族**；内核内置图标名是 `editor-main-*`（≈74 个，JS 内联，`style.css` 里 0 条），工具栏类名族是 `ne-ui-toolbar-*`（36 条）、卡片族 `ne-card-*`（210 条）。**✅ 已回填（261017）**：AGENTS §2⓪ 已改成 `editor-main-*` / `ne-ui-toolbar-*` / `ne-card-*`。
6. **`"insert-panel"` 在 bundle 里 0 命中**：真实标识符是 `quickInput` / `slash` / `cardSelect` + 命令 `insertSlash`（检索时别用"insert panel"当关键词）。**✅ 已回填（261017）**：已补进 AGENTS §2⓪ 的检索提示。

---

## 9. 实施进度日志（每完成一条就追加一行）

| 日期 | 条目 | 状态 | 落地 | 证据 |
| --- | --- | --- | --- | --- |
| 261016 | **B1 字数统计统一走内核** | ✅ 已实施 + 运行时实测 | `src/core/textStats.ts`（新增）· `src/core/docStats.ts` · `src/hooks/useDocumentStats.ts` · `electron/store.ts` · `src/mobile/bridge.ts` | 门禁：tsc ✓ / 258 文件 2010 例 ✓ / `git diff --check` ✓；探针：内核 8 = 移植 8 = 状态栏 8（见 §3.2 B1 实施记录） |
| 261016 | B1 展示形态（字数 vs 字数+字符数） | ✅ 已定：**保持现状** | 不动 `DesktopStatusBar` | 用户 261016 裁定（见 §6#5） |
| 261016 | 并行会话边界登记 | ✅ 已登记 | `docs/KERNEL-REUSE-AUDIT.md` §10 | 对方议程 = `docs/CODE-REVIEW-261015.md`（`e154ef9`） |
| 261016 | **A 批次：内核能力实测**（B2 重点 + B5 + C3/A5 记录） | ✅ 已实测 | 探针临时件（`/tmp`）不入库；结论见 §6「A 批次实测结果」 | 内核查找面板可用但**只认真实按键**；`wordCountSelection` 与全文一致；`search` 入参是 ranges |
| 261016 | B2 文档内查找（**移动端**） | ✅ 已实施 + 设备实测 + 门禁重烤 | 新增 `src/mobile/editor/{mobileFind.ts,MobileFindBar.tsx,mobile-find.css,mobileFind.test.ts}`；改 `DocumentEditor.tsx` / `NotebookWorkspace.tsx` / `mobileLayers.test.ts` / `scripts/mobile-audit/baseline/mobile-snap.json` | 设备：搜「人类」1/3 → 下一个 2/3，关闭后 highlights=0；6 态门禁重烤后 0 差异；截图 `.css-audit/mobile-find-261016/find-bar.png` |
| 261016 | B2 文档内查找入口（桌面） | ❌ **已回滚（不做）** | revert `d62d06e`：删除 `kernelFind.ts` / `registerEditorIpc.ts`，还原 preload/native/webApiServer/`DesktopTopBar.tsx`/`App.tsx` | 用户裁定"内核当前查找可用"；代码与 `d62d06e^` 逐字节一致 |
| 261016 | **B4 移动命令族评估** | ✅ 已评估 ⇒ **不做**（不替换现有摘-插） | 无代码改动（只读码 + 探针） | 语义见 §3.2 B4 记录；`moveImage` 三种 position 形状全抛 `setStart`；契约 §5.41 |
| 261016 | B2 移动端入口（已完成）· C3 · A5 · B6 | ⏳ C3 待讨论 / A5、B6 不做 | — | C3 先不做待讨论；A5、B6 不做 |
| 261016 | **收口：查找条查漏补缺** | ✅ 已实施 + 设备复验 | `MobileFindBar.tsx`（正文变化自动重扫 + 命中上限显示 `600+`）· `mobileFind.ts` 新增纯函数 `reconcileMatchIndex` · `mobileFind.test.ts`（7 例）· `DocumentEditor.tsx` 传 `revision` | 设备实测：搜「人类」`1/3` → 正文再插一处 ⇒ **自动 `1/4`**、关闭后 `highlights=0`；门禁 tsc ✓ / vitest **266 文件 2050 例** ✓ / `ui-metrics` ✓ / `check:mobileui` ✓ |
| 261016 | 移动 6 态基线**重烤**（收口第二次） | ✅ 已重烤 + 连跑两次 0 差异 | `scripts/mobile-audit/baseline/mobile-snap.json`；成因写进 `scripts/mobile-audit/README.md` | 定位到差异行 = `ne-p$<uuid>-body#0`：**指纹 row key 里带文档节点 id** ⇒ 重灌夹具（`pm clear`）必换 id，元素数相同也会红 ⇒ 必须重烤 |
| 261016 | 其余 A/C/D 条目 | ⏳ 待讨论 | — | §3 · §4 的优先级建议 |
| 261017 | **B3 全选原生化** | ❌ 结案：用户定不做 | 无代码改动 | `selectAll` 仅卡片菜单 1 处（`CardContextMenu.tsx:106`）、`selectAllDoc` 0 处；无消费方/无缺陷证据 |
| 261017 | **B5 选区字数** | ❌ 结案：用户定不做 | 无代码改动 | 全仓无选区字数 UI，`wordCountSelection` 0 使用；属产品新功能 |
| 261017 | **B7 导出核对** | ✅ 结案：已满足 | 无代码改动 | 缓存由内核 `getDocument("text/markdown"/"text/plain")` 生成（`useDesktopHandlers.ts:49-50`），导出读缓存 |
| 261017 | **B9 媒体路由核对** | ✅ 结案：保持现状 | 无代码改动 | 官方 06/63/67/68 无扩展名→category 入口；`beforeExecCommand` 是唯一宿主侧桥接 |
| 261017 | **C1 移动面板派生** | ❌ 结案：用户明确不做 | 无代码改动 | 排布由用户 261015 定稿；无观测痛点；派生仍需逐项 action 映射 + 排除清单 |
| 261017 | **B10 导出占位（新登记）** | ⏳ 只登记（非内核复用） | 无代码改动 | usheet CSV/Excel、board PNG/SVG 为 `disabled` 占位（`ExportSubmenuItem.tsx:55-68`） |
| 261017 | **移动端文档命令静默失效修复**（验证 B6 时发现） | ✅ 修复 + 单测 | 新增 `src/mobile/editor/execCommand.ts`（唯一入口）+ 替换 EditorDock / EditorDockHost / QuickNoteComposer / OutlineSheet 6 处调用点 | 根因：文档编辑器实例无 `.renderer` ⇒ dock 命令全部 no-op；回退 `editor.execCommand`；`execCommand.test.ts` 5 例 + 1 例源码级禁令，全库 vitest 270 文件 / 2063 例 |
| 261017 | **输入法组合中撤销无效修复**（用户报「慢打不能撤销」） | ✅ 修复 + 设备实测 | `EditorDock.tsx` 的 `runInline`：组合中先 `blur→focus` 提交 composition 再执行命令；护栏 `dockPanelFocusGuard.test.ts` +1 | 设备实测：组合态 `nihao` → 撤销 → 一次清空（修复前连点 3 次无反应）；普通输入撤销/重做正常 |
| 261017 | **契约回填** | ✅ 完成 | `docs/LAKEX-CONTRACT.md` §5.9 · `AGENTS.md` §2⓪ | 见 §8 的「✅ 已回填（261017）」标注 |
| 261017 | **C2 固定栏/浮栏状态判据盘点** | ✅ 结案：已一致，无缺口 | 无代码改动 | 逐项表见 §3.3 C2；唯一例外 = 图片块级对齐读内核 `ne-alignment` DOM 属性（卡片选中无文字选区，query 不可用） |
| 261017 | **C3 卡片/容器浮栏接 `miniToolbar`** | ❌ 结案：命题不成立/已在使用 | 无代码改动 | 块卡片浮栏 = 内核原生在跑（`setupCardToolbarHoverBridge` 是可用性补丁）；inline 图片原生 focus 通路空桩 + wrapper 已 `never` ⇒ 不可行；我方图片浮栏复用 `.ne-card-toolbar*` 类 + 内核命令 |
| 261017 | **B6 移动端文本增强缺项** | ✅ 已实施 + 真机逐项实测 | `EditorDock.tsx`（H5/H6 · 清除格式 · 上标/下标 · 首行缩进 · 缩进 · 格式刷 · 行高 6 档 · 灰底）· `editor-dock.css` · `STYLE_BLOCKS` · `mobileLayers` 基线 228→237 · `MOBILE-DESIGN.md` | 真机（小米 2109119BC / Android 14）属性 diff：`ne-h5/h6`、`ne-bold`、`ne-sup/ne-sub`、`ne-indent`、`ne-text-indent`、`ne-line-height`；格式刷激活后面板自动收起；面板 7 样式项 / 6 行内项 / 更多 20 项、底色一致 |

> 口径：**状态**只用三档 —— ⏳ 待讨论 / 🔧 进行中 / ✅ 已实施（+ 实测）。每条实施必须同时写：落地文件、门禁结果、运行时证据；改到内核契约的观测回填 `docs/LAKEX-CONTRACT.md`。

---

## 10. 与并行会话的边界（261016 登记，防撞车）

同一仓库上另有一个会话在做**代码 review 与整改**（议程在 `docs/CODE-REVIEW-261015.md`，已随 `e154ef9` 入库）：
公共函数/方法抽提 · 能力抽象与封装 · 模块划分/分层/分包 · 前端样式（层层套 / `!important`）· 样式统一（选中态收归令牌）；
并且已在 `scripts/ui-metrics.mjs` 落过 B0 护栏。

| | 本审计（内核能力复用） | 并行会话（代码 review / 重构） |
| --- | --- | --- |
| 目标 | 能用内核的就不用自研；内核没有的登记不再立项 | 抽象/分层/抽提/样式收敛 |
| 主要落点 | `docs/KERNEL-REUSE-AUDIT.md` · `docs/LAKEX-CONTRACT.md` · 少量 `src/**` 内核调用点 | `src/**` 公共函数与分层 · `src/styles/**` · `scripts/ui-metrics.mjs` · `HANDOFF.md` |

**约好的避让规则（本会话执行）**：
1. 不碰 `scripts/ui-metrics.mjs`、`HANDOFF.md`（并行会话在写）；确需改动先在这里登记再动。
2. **样式类条目一律推迟**（A2 浮栏 / A3 颜色面板 / C3 `miniToolbar` / B6 移动面板）——避免与样式 review 打架。
3. `src/core/textStats.ts` 是本会话新建的**字数/字符数唯一来源**（B1）：并行会话做"公共方法抽提"时请把它当既有来源，**不要另建第二份**；同类语义（去标签、纯文本统计）如需抽提，落点应指向它。
4. 只读探针放 `/tmp` 或新增独立脚本，不改既有脚本；证据与结论回填本文件 §9 与 `docs/LAKEX-CONTRACT.md`。
5. 提交前先 `git status` 看对方是否有在途改动；`git add` **只加自己这次动过的文件**（本会话已有一次 push 顺带带上对方 `e154ef9` 的记录）。

> **261017 本会话边界**：只做本文档范围内的结案登记 + §8 回填；**未碰** `HANDOFF.md` / `scripts/ui-metrics.mjs` / 样式层 / `src/components`（另一会话正在做 CODE-REVIEW 整改）。
