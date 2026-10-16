# 内核能力复用综合检查（261015）— 逐条方案清单

> **状态**：只读审计 + 方案。**本次未修改任何产品代码**，只新增本文档。
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

**优先顺序建议**：`B1 字数/统计` → `B6 文本增强补齐项` → `B3/B4/B5 块级命令原生化` → `C1 移动端面板条目改为内核派生` → `C3 卡片浮栏接内核 miniToolbar` → `B2 文档内查找/替换`。

**进度**：**B1 已于 261016 实施并实测通过** ——字数统一走内核 `wordCount`，三处自研正则收口到单一来源；**B2（文档内查找）评估后决定不做**，为它加的宿主入口已整体回滚（内核自带的 ⌘F 查找替换开箱可用）。

**本次顺手发现的 6 处文档/检索口径漂移**见 §8（含 §5.9 的"未用"结论已过期、AGENTS §2⓪ 的图标族关键词不准确）。

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

**结论与回滚**：内核查找替换**当前即可用**（⌘F，面板自带宽高亮与计数）⇒ **不做宿主入口**。
`d62d06e` 里加的"顶栏按钮 + 主进程 trusted ⌘F 注入"（`src/features/editor/kernelFind.ts` · `electron/ipc/registerEditorIpc.ts` · preload/native/webApiServer 三处 · `DesktopTopBar.tsx` · `App.tsx`）**已整体回滚**（见 §9 的 revert 行），代码恢复到 B2 之前的状态。
⇒ 顶栏恢复原样，**桌面 stylesnap 基线不需要重烤**（此前登记的那条待办随之作废）。

**移动端不做**：内核工具栏在移动端被关（`disabledPlugins:["save","toolbar"]`）⇒ 无面板也无热键；要在移动端做文档内查找只能自研（属添加项，未立项）。

#### B3 全选：手工 Range vs 内核 `selectAll` / `selectAllDoc`
- **现状**：块选择走手工 `createRange` + `transformDOMRange`；`selectAllDoc` **0 处使用**。
- **内核证据**：§5.9 候选 1：`selectAll` 上下文感知（表格单元格/整列/容器 hole 时选上层结构），`selectAllDoc` 整篇。
- **判定**：类型 4。
- **建议**：把"把光标放进目标块 → `execCommand('selectAll')`"用于块选择；`selectAllDoc` 用在"整篇操作"（如导出、AI 全文）。
- **风险**：低；但"仅选中节点本身（非内容）"内核没有对应命令，那部分仍需手工 range（§5.9 已写明）。
- **验收**：`blockMenuNative.test.ts` / 真实端手动多块选择。

#### B4 容器/块移动：统一"摘节点→插入" vs 内核移动族
- **现状**：`moveBlockNative` 对非卡片块统一"摘节点 → 落点插入"；`moveCollapse`/`moveColumns`/`moveColumn`/`moveTable`/`moveImage` **0 处使用**。
- **内核证据**：§5.9 候选 2（"更省且保内部节点 id"）。
- **判定**：类型 4。
- **建议**：容器（折叠块/分栏/表格/图片）优先走内核专用移动命令，卡片已有 `moveCard`。
- **风险**：中——移动语义/撤销栈表现需逐类型实测（表格、分栏、折叠块各一档）。
- **验收**：移动后 `.lake` 序列化对比（节点 id 保留）+ ⌘Z 一次撤销回到原位。

#### B5 选区取内容/字数：`getSelectionContent` 已在用，`wordCountSelection` 未用
- **现状**：`blockHandleMount.ts:47` 已用 `getSelectionContent('text/markdown')`；选区字数未用。
- **内核证据**：§5.9（**其中"getSelectionContent 未用"一句已过期**，见 §8）。
- **判定**：类型 4（小项）。
- **建议**：并入 B1 一起做（选区字数 = `wordCountSelection`）。

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

#### B7 导出：内核无 export 命令 ⇒ 应走 `getDocument(type)`
- **现状**：`src/components/ExportSubmenuItem.tsx`（markdown/html/pdf）；落地实现需按只读范围核对（本次未展开 electron 侧）。
- **内核证据**：yuque-re 总账：**无 export 命令**；官方 07 `getDocument(type)` 支持 `text/markdown|text/html|text/plain|json`。
- **判定**：类型 4（应确保导出**走内核序列化**，而不是自研 HTML/MD 转换）。
- **建议**：核对现有导出路径；若存在自研转换，替换为 `getDocument`。
- **验收**：导出产物与内核 `getDocument` 输出逐字节对比。

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

---

### 3.3 C 类｜组合调度内核多能力

#### C1 移动端「＋」面板条目改为**内核派生**（保留自绘 UI）
- **现状**：`EditorDock.tsx:374-407` 手写 18 项（图片/拍照/附件/音频/视频/表情/状态/日期/表格/引用/分割线/代码块/高亮块/分栏/折叠块/链接/文档引用/日历 + 公式等），每项自己决定调哪条内核命令。
- **内核证据**：插入面板条目 = 内核注册表（`slash.cardSelect.*.groups[].items`，`src/configs/slash.ts:82-129`）；我们**已经在** `lakeRuntime.ts` 读这份配置（`withNoteRefSlashItem(...)` 注入「文档引用」）。
- **判定**：类型 3（组合：内核注册表 + 我们的命令分发）。
- **建议**：面板条目的"存在/名称/分组"从内核注册表派生（**显式排除**：第三方服务组、移动端不打算给的项目），命令执行仍按现表。好处：内核升级新增卡片时面板自动跟上，避免"内核有、我们面板没有"。
- **风险**：中——派生会引入"内核配置里的隐藏项"（如 `custom-text-to-diagram`）需要排除清单；组名有重名坑（`group-files` 同时是"程序员"和"小工具"，§5.23 提醒只能按 `title` 找）。
- **验收**：`insert-panel-geometry.mjs`（G1–G6）+ 条目集合与内核注册表的对拍脚本。

#### C2 浮动栏与固定栏共用内核状态/记忆
- **现状**：active 判定走 `queryCommandValue`（内核），颜色记忆走 `IToolbarEditorService`（内核）——**已经是对的**。
- **内核证据**：§5.10 九（`getColor/setColor`）；§5.10 七（active 取值口径）。
- **判定**：类型 3（已部分落地）。
- **建议**：把"还有哪些状态是我们自己算的"列一遍（如段落样式`style`、字号`fontsize`、对齐`alignment` 是否全走内核查询），只补差额；**不新增**并行判据。
- **验收**：切换选区时固定栏与浮栏高亮一致（§5.10 七的"晚一拍"口径）。

#### C3 卡片/容器浮栏：接内核 `miniToolbar`，我们只补内核没有的项
- **现状**：`CardContextMenu.tsx`（自绘卡片右键菜单，含"全选"等）+ 图片浮栏（`SelectionToolbar` 的 `renderImage`，已在用 `updateImageData`/`deleteCard`）。
- **内核证据**：§5.10 一——插件 `miniToolbar`、`IMiniToolbarService`（`setDisabledMiniToolbarItems/addDisabled…/removeDisabled…/registerFilterMiniToolbarItems`）、内置项 `copy delete copyLink cut spacing maximize widthMode comment`；`miniToolbar.disabledItems` 选项。
- **判定**：类型 3（组合调度：内核 itemConfig + 过滤 + 事件刷新）。
- **建议**：图片/卡片上的"复制/删除/复制链接/剪切/间距/全屏/宽度"改用内核 inner 浮栏，我们只保留内核没有的项（如 AI、批量应用）；用 `registerFilterMiniToolbarItems` 隐藏不要的项。
- **风险**：中——涉及已有视觉与交互（用户已定稿图片浮栏），**改前需你确认**；且 hidden window 下 rAF 合并刷新会失效（§5.10 七的坑）。
- **验收**：图片/卡片浮栏逐项实拍 + `selectionToolbar.wiring.test.ts`。

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

## 4. 建议的讨论顺序（按收益/风险）

1. **第一批（低风险、可量化、纯收益）**：`B1` 字数统计、`B6` 移动端文本增强补齐项。
2. **第二批（小改动、要走内核命令）**：`B3+B4+B5+C4`（块选择/容器移动/选区内容，一起做一次）。
3. **第三批（结构性，需要你裁定）**：`C1` 移动面板条目派生、`C3` 卡片浮栏接 `miniToolbar`、`B2` 文档内查找/替换。
4. **第四批（保持 + 登记）**：`A1–A6`、`D1–D8`（只回填契约，不改代码）。
5. **顺带**：`B7` 导出核对、`B9` 媒体路由读码确认、`B8` envAdapter 探针。

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
1. 移动端「＋」面板条目是否允许改成"内核注册表派生 + 自绘 UI"（C1）？会小幅改变面板内容（跟随内核注册表）。
2. ~~是否要做**文档内查找/替换**（B2）~~ **用户 261016 定：不做**——内核自带的查找替换（⌘F）已经可用；我加的桌面入口已回滚。移动端同样不做（内核面板在移动端不存在，自研属添加项）。
3. 卡片/图片浮栏是否收回内核 `miniToolbar`、我们只补内核没有的项（C3）？会动已定稿的浮栏观感 —— **用户 261016 定：先不做，需要讨论**。
4. 移动端文本增强缺项（B6）是否按"下一会话焦点"全做？—— **用户 261016 定：先不做（属添加项，不着急）**。
5. ~~字数口径若从"我们正则"改成"内核 `wordCount`"，数字可能变化（B1），是否接受？~~ **已实施（261016）**：数字确实变了（见 §9.1 的前后对比）。展示形态：**用户 261016 定 = 保持现状**（状态栏只显示「字数」，不加并列字符数）。

**A 批次实测结果（261016；探针为临时件，不入库）**

| 项 | 结果 | 后续 |
| --- | --- | --- |
| `wordCount` / `wordCountSelection` | ✅ 可用且一致（`selectAllDoc` 后选区 11 = 全文 11，并在 B1 里接了状态栏） | 已完成 |
| 内核查找面板 / ⌘F / 合成事件 | ✅ 面板可用；**只有真实按键能唤起**；合成事件与 `triggerHotKey` 均无效 | 桌面已做入口（B2） |
| `search` / `replaceText` / `replaceAll` 入参 | ✅ 读码确认入参是**选区/ranges**（不是关键词）⇒ 复用单位是面板 | 移动端若要查找只能自研（待讨论） |
| `envAdapter.previewImgs` 是否派发 | ⏳ **未测**：要判定必须临时在 `lakeRuntime` 加一次 `envAdapter` 才能观察；按「不改代码即可做」的口径本轮跳过 | 需要时单独立项 1 次探针 |
| `miniToolbar`（C3） | ⏳ 未测 —— 用户 261016 定「先不做，需要讨论」，故本轮不投入 | 讨论时再测 |
| `moveCollapse` / `moveColumns` / `moveTable` / `moveImage`（B4） | ⏳ 未测：需先有折叠块/分栏/表格/图片四类夹具与入参形态 | 若做 B4 先补探针 |
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

1. **`docs/LAKEX-CONTRACT.md` §5.9 的"候选原生化改造"里，`getSelectionContent` 标着"未用"——已过期**：`src/features/editor/blockHandleMount.ts:47` 在用（块菜单取 Markdown）。
2. **`HANDOFF.md` §0 的 261015 节写着"未提交/未推送"**，但仓库实况是：该批已提交 `fc87325`，与 `origin/master` 0 ahead / 0 behind、工作树干净。
3. **`§5.27` 的 `previewImgs` 标"✅ 已实现"需要写清边界**：我们的代码里**没有传 `envAdapter.previewImgs`**（全仓无 `envAdapter:` 选项），图片放大是 `attachImagePreviewClick` 的 DOM 点击 + `extractImagesFromContent` 正文解析兜底，原因是本构建 `allowClickToMaximize` 无效（`src/features/editor/LakeEditor.tsx:107`）。⇒ 建议改成"行为等价、非适配口实现"，并把"本构建 `previewImgs` 是否真的不派发"列为待实测（§6）。
4. **字数统计存在两套自研口径**（`src/core/docStats.ts:21` 与 `src/mobile/bridge.ts:568`）：即使不接内核 `wordCount`，这两处也该收口到单一来源。
5. **`AGENTS.md` §2⓪ 的检索提示"图标族 `ne-t-*`"不准确**：vendor 侧 `ne-t-*` 只在 wrapper 自己的 sprite（`src/components/lakex/icon.tsx`，共 8 个：`ne-t-link`、`ne-t-image-crop/reset/rotation/size/style/title`、`ne-t-batch-apply`），**不是内核工具栏图标族**；内核内置图标名是 `editor-main-*`（≈74 个，JS 内联，`style.css` 里 0 条），工具栏类名族是 `ne-ui-toolbar-*`（36 条）、卡片族 `ne-card-*`（210 条）。建议把 AGENTS §2⓪ 的检索关键词改成 `editor-main-*` / `ne-ui-toolbar-*` / `ne-card-*`。
6. **`"insert-panel"` 在 bundle 里 0 命中**：真实标识符是 `quickInput` / `slash` / `cardSelect` + 命令 `insertSlash`（检索时别用"insert panel"当关键词）。

---

## 9. 实施进度日志（每完成一条就追加一行）

| 日期 | 条目 | 状态 | 落地 | 证据 |
| --- | --- | --- | --- | --- |
| 261016 | **B1 字数统计统一走内核** | ✅ 已实施 + 运行时实测 | `src/core/textStats.ts`（新增）· `src/core/docStats.ts` · `src/hooks/useDocumentStats.ts` · `electron/store.ts` · `src/mobile/bridge.ts` | 门禁：tsc ✓ / 258 文件 2010 例 ✓ / `git diff --check` ✓；探针：内核 8 = 移植 8 = 状态栏 8（见 §3.2 B1 实施记录） |
| 261016 | B1 展示形态（字数 vs 字数+字符数） | ✅ 已定：**保持现状** | 不动 `DesktopStatusBar` | 用户 261016 裁定（见 §6#5） |
| 261016 | 并行会话边界登记 | ✅ 已登记 | `docs/KERNEL-REUSE-AUDIT.md` §10 | 对方议程 = `docs/CODE-REVIEW-261015.md`（`e154ef9`） |
| 261016 | **A 批次：内核能力实测**（B2 重点 + B5 + C3/A5 记录） | ✅ 已实测 | 探针临时件（`/tmp`）不入库；结论见 §6「A 批次实测结果」 | 内核查找面板可用但**只认真实按键**；`wordCountSelection` 与全文一致；`search` 入参是 ranges |
| 261016 | B2 文档内查找入口（桌面） | ❌ **已回滚（不做）** | revert `d62d06e`：删除 `kernelFind.ts` / `registerEditorIpc.ts`，还原 preload/native/webApiServer/`DesktopTopBar.tsx`/`App.tsx` | 用户裁定"内核当前查找可用"；代码与 `d62d06e^` 逐字节一致 |
| 261016 | B2 移动端入口 · C3 · A5 · B4 · B6 | ⏳ 待讨论 / 不做 | — | C3 先不做待讨论；A5、B6 不做；B4 未测 |
| 261016 | 其余 A/C/D 条目 | ⏳ 待讨论 | — | §3 · §4 的优先级建议 |

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
