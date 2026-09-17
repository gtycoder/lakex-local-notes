# 块「转化为」容器/卡片类：内核是否支持「转换并保留内容」——问题清单（260917）

> 本文是给**外部审查者**（另一个 AI / 工程师）的自包含问题说明：现状、已实测证据、我方的结论与不确定点、可直接复现的步骤与判据。
> 目的：**确认 lakex 内核是否存在"把段落一次性转成 高亮块 / 分栏 / 折叠块 / 代码块 并把内容带过去"的正规能力**。若存在，请指出命令/API/配置与用法；若确实不存在，请明确说"不存在"。
> 仓库：`/Users/admin/file/local-lake/lake-notes-electron`（Electron 43 + React 18.3 + 语雀 Lake 内核，本地优先笔记应用）。

---

## 0. 一句话问题

云端语雀的块菜单「转化为」里，把**段落**转成**高亮块 / 分栏 / 折叠块 / 代码块** 时，**段落内容会被搬进新容器/卡片**。
我们在本地 lakex 内核里**找不到等价的一次性能力**：现有命令要么**删掉内容**，要么只是**插入一个空容器/空卡**、把原段落留在原地。
**请判断：内核是否有"转换且保留内容"的正规途径？**

---

## 1. 背景与已交付的现状（我们已做了什么）

用户给了云端块菜单截图，要求**行为与菜单项与云端一致**，并明确原则：**优先用内核自身能力、不要自定义样式/UI、不做功能扩展**。

已完成（**未提交**，在工作区）：

1. **块悬浮手柄 + 块操作菜单**已挂上（此前从未挂载：该能力在 vendor 的 React 包装层 `BlockHoverHandle`/`BlockContextMenu`，而本应用直连 `Doc.createOpenEditor`，不走 vendor 的 `LakexEditor`）。
   - 挂载器：`src/features/editor/blockHandleMount.ts`（应用侧新增，无样式；宿主 `<div class="lake-block-handle-host">`）
   - 开关：`LakeEditorPrefs.blockHandle`，仅桌面编辑态；移动端/只读态不挂
2. **菜单与云端一致**（15 项「转化为」+ 删除/复制/剪切/缩进/在下方添加），**未改任何 CSS**（排版是上游 6 列 grid 的自然结果：H1–H6 / 正文·有序·无序·任务·代码 / 高亮块·引用 / 分栏·折叠块）
3. **所有菜单动作改为内核原生命令**（原来一半动作走 vendor 的「整篇 JSON 读改写」，实测会毁自定义卡，见 §5）
4. 护栏与验证：
   - 源码级单测：`src/features/editor/blockMenuNative.test.ts`（禁止再引入整篇 JSON 读写路径、白名单收敛）
   - 端到端：`scripts/e2e-block-menu-smoke.mjs`（**副本上**逐项点菜单，断言"动作生效 / 已有卡片逐字节未变 / 原文本仍在正文里"，原件不打开）
   - 门禁：`tsc` 0 · `vitest` 996 passed / 16 skipped · 桌面 + 移动 build 全绿

---

## 2. 核心问题：容器/卡片类「转化为」搬不动内容

### 2.1 两种执行方式，两种坏结果（均已实测）

转换前（落盘 `.lake` 原文，段落 P 内容为 `自动保存验证ZZZ`）：

```html
<p data-lake-id="ucfd561e7" id="ucfd561e7"><span data-lake-id="u9ca20801" id="u9ca20801">自动保存验证ZZZ</span></p>
```

| 执行方式 | 高亮块 `alert` | 分栏 `columns 2` | 折叠块 `collapse` | 代码块 `insertCard('codeblock')` |
|---|---|---|---|---|
| **A. 先整块选中内容**（`Range.selectNodeContents(el)`，非折叠）再执行 | ❌ **文本彻底消失**（DOM、内核模型 JSON、落盘三处都没有） | ❌ 同左 | 待复核 | ❌ 文本被卡替换掉 |
| **B. 折叠光标**（把 caret 放到块末尾，不选内容）再执行（= 当前实现） | ️ **只插入空高亮块，原段落不动** | ⚠️ 同左 | ⚠️ 同左 | ️ 只插入**空**代码块卡，原段落不动 |

方式 B 的落盘证据（转高亮块后）：

```html
<p data-lake-id="ucfd561e7" id="ucfd561e7"><span …>自动保存验证ZZZ</span></p><blockquote data-lake-id="uc7d5922f" id="uc7d5922f" class="lake-alert …">
```

⇒ 原段落**原样保留**，旁边多了一个**空**的高亮块。**不丢数据，但这不叫"转化为高亮块"**（云端是把段落搬进容器）。

### 2.2 对照：哪些是"真转换"

| 目标 | 命令 | 实测结果 |
|---|---|---|
| 正文 / H1–H6 | `editor.execCommand('style', 'p'\|'h1'…'h6')` | ✅ 原地换类型，内容保留 |
| 引用 | `editor.execCommand('quote')` | ✅ **真转换**：落盘可见原文被包住（祖先链 `blockquote > p > span`），内容保留 |
| 有序 / 无序 / 任务 | `unorderedList` / `orderedList` / `taskList` | ⚠️ 动作生效且内容保留，但**未逐项验证结构**（大概率与 `style` 同类＝原地转换，请复核） |
| 高亮块 / 分栏 / 折叠块 | `alert` / `columns`(第二参 2) / `collapse` | ❌ 见 §2.1：替换选区（丢内容）或插入空容器 |
| 代码块 | 无命令；`insertCard('codeblock')` | ❌ 见 §2.1 |

**关键差异**：`quote` 是"包住内容"型命令，而 `alert`/`columns`/`collapse`/`insertCard` 是"插入/替换"型。**我们的问题就是：这三者（+代码块）有没有"包住内容/搬运内容"的正规用法？**

---

## 3. 请优先核实的点（我们已排除/未排除的）

1. **官方命令清单是否完整**：`/Users/admin/file/local-lake/yuque-developer-docs/docs/08 - 命令列表 [ndflcx5eprg7gbdl].md` 列了 29 条（focus/style/insertText/alignment/bold/…/indent/outdent/selectAll/**insertAtSelection**/getNodeContent）。**是否存在文档未收录、但内核里注册了的"转换"命令**（例如 `convertBlock` / `wrapBlock` / `callout` / `toggleBlock` / `turnInto` 之类）？
   - 建议做法：在 `vendor/lakex-doc-react/src/components/lakex/lakex.js`（8.9MB 内核 ESM，类名/文案/命令名都是明文字符串）里检索命令**注册表**的落点（我们只确认了 `editor._$commands` 只有 4 个 key，说明注册表不在此处；`editor.plugins` 是 PluginManager，含 `alert/toolbar/layout/slash/heading/history/indent/list/quote/table/codeblock/…` 等插件名）。
2. **`insertAtSelection` 的正确用法**（官方 §insertAtSelection：1=数据格式如 `text/html`/`text/markdown`/`text/plain`/`text/lake`，2=数据字符串；非折叠选区会被替换）。我们实测 `editor.execCommand('insertAtSelection','text/lake','<p id="uProbeA"><br></p>')` **返回节点但文档无变化**（落盘也没有）——**是否是我们格式/用法不对**？如果用它能插入"带内容的容器块"，那就是我们要的正规途径。
3. **卡片 API**：`cardData.setName` + `sync(true)` 在本项目契约里有记录（卡片名称/值的原地更新）。是否可用「插入空代码块卡 → 用卡片 API 写入 `value.code`」来完成"段落→含内容代码块"？这属于内核卡片能力（不是我们自组装 DOM），但**用法与边界需确认**（哪些卡支持、是否会触发额外副作用、行内标记如何保真）。
4. **配置类开关**：`47 - 通用配置`、`48 - 适配器（envAdapter）`、`55 - 斜杠命令（slash）`、`69 - 开发自定义卡片` 里是否有影响"块转换/容器行为"的配置项（我们已排除 `disabledPlugins` 与内核 config 里存在 `blockMenu` 之类开关——grep 无命中）。
5. **其它 kernel 方法**：我们在实例上看到的 `kernel` 方法里有 `genericNodeIndent`、`registerBlockCard`、`getLayout/setLayout` 等；**是否存在 `kernel.convert*`/`kernel.wrap*`/`kernel.move*` 之类可用于转换/搬运的方法**？
6. **参考实现**：`/Users/admin/file/local/lake-main/`（lakejs 开源社区版，"机制字典"，注意序列化方言已与运行内核分叉）与 `/Users/admin/file/local/lake-editor-main/` 里是否有对应的"转化为容器"实现可借鉴（尤其是它是否也走"插入+搬运"或是有专门的 kernel API）。

---

## 4. 可直接复现的步骤（照做即可得到与本文一致的数据）

**环境**：Node 24（`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`）；`npm run dev`（vite `1421` + Electron CDP `9222`）；开发数据 `~/Library/Application Support/lake-notes-dev`（**正式数据 `lake-notes-electron` 禁止触碰**）。

**原则**：**不要打开原件**。用应用自身的右键「复制」把测试文档复制成副本，在副本上操作，用完丢回收站。
现成脚本：`node scripts/e2e-block-menu-smoke.mjs --note <源文档id>`（内部就是这个流程，含断言）。

**手工最小复现（CDP `Runtime.evaluate`）**：

```js
// 1) 折叠光标到块内容末尾（方式 B）
const r = document.createRange(); r.selectNodeContents(blockEl); r.collapse(false);
const mr = editor.engine.transformDOMRange(r);
editor.kernel.execCommand('selection', { focus: 'end', anchor: 'end', ranges: [mr] });

// 2) 执行候选命令
editor.execCommand('alert');          // 高亮块
editor.execCommand('columns', 2);     // 分栏
editor.execCommand('collapse');       // 折叠块
editor.execCommand('insertCard', 'codeblock'); // 代码块
// 对比：editor.execCommand('quote')   ← 这个会包住内容（真转换）

// 3) 整块选中（方式 A，用于对照"丢内容"）
const r2 = document.createRange(); r2.selectNodeContents(blockEl);   // 不 collapse
editor.kernel.execCommand('selection', { focus:'end', anchor:'start', ranges:[editor.engine.transformDOMRange(r2)] });
```

**判据（三处都要看）**：
1. **DOM**：新容器元素（`ne-alert-hole` / `ne-container-hole` / `ne-quote` / `ne-card`）内部是否含原文本；
2. **内核模型**：`JSON.stringify(editor.getDocument('json'))` 是否含原文本（判断"内核认不认"）；
3. **落盘正文**：`window.lakeNative.readNote(noteId)` 返回的 `.lake` 里，原文本之前**未闭合的祖先标签链**是否包含容器标签（例：`quote` 得到 `blockquote > p > span`；`alert` 得到 `p > span`，容器在段落之外）。
4. 别只看"文件 hash 变了"——那只能说明动作生效，不能说明内容去向。

**注意**：本会话踩过的坑——注入页面脚本时不要用 `\w`/`\b` 等反斜杠（模板字符串里是非法转义，会让整段注入静默失败）；虚拟渲染下 DOM 只保留视口窗口内的块，**判结构优先用落盘正文**，DOM 可能扫不到。

---

## 5. 必须知道的其它事实（避免走弯路）

1. **不要建议走 vendor 原来的 JSON 路径**：`vendor/lakex-doc-react/src/utils/blockDoc.ts` 的 `moveBlock/deleteBlock/duplicateBlock/convertBlock/insertBlock` 全部是「`getDocument('json')` → 改树 → `setDocument('json')`」的**整篇 JSON 读改写**。实测一次「剪切」：正文 6032B→**12288B**、自定义卡 `customBlock(mindmap-card)` 载荷 634B→**8859B**（被重写成 base64 内联 SVG 的"水合形态"）、未注册卡 `board-card` 整张被抹掉。**这条路径已废弃**（不要作为解法）。
2. **未注册遗留卡**（如换源前自研画板的 `board-card`）在任何一次编辑保存后都会丢（原因：保存走 `editor.getDocument('text/lake')`，序列化自内核模型，未注册卡不在模型里）。用户已确认**这个不管**。
3. **拖拽移动块已停用**：内核没有"移动块"原生命令，vendor 的拖拽实现走上面的 JSON 路径（会毁卡）⇒ 手柄只保留"点击开菜单"。若你知道内核有正规的移动/搬运块 API，也请一并指出。
4. **`editor.execCommand` ≠ `renderer.execCommand`**：本项目中 `indent/outdent` 在 `editor.execCommand` 上有效（实测 +26B），而 `renderer.execCommand`（移动端 dock 走的路径）下是 no-op。新增块级命令时请指明走哪条路径。
5. 相关记录（可直接读）：`docs/LAKEX-CONTRACT.md` **§5.8**（本问题的完整实测记录与命令表）、`vendor/lakex-doc-react/LOCAL-CHANGES.md` #9/#10（我们对 vendor 的改动清单）、`HANDOFF.md` §2 第 11–16 条。

---

## 6. 我们希望的结论形式

请给出其中一种明确答复：

- **(A) 内核确实没有**"转换并保留内容"的能力（除了 `quote`/`style`/列表这类），高亮块/分栏/折叠块/代码块只能"插入空容器/空卡"；—— 那我们就把这四项按"内核原样行为"处理或从菜单撤掉，**不自己组装搬运逻辑**（用户明确不接受自组装）。
- **(B) 有正规途径**：请给出**准确的命令名/API/配置 + 参数 + 用法示例**，并说明它是否属于"内核的一次性能力"（而非"调多个命令拼出来"）。若涉及卡片 API（如 `cardData.* + sync(true)`）或 `insertAtSelection`，请给出**可复现的正确用法**。
- **(C) 需要补的验证**：如果关键点无法从文档/源码判断，请列出**最小验证命令**（我们可以在真实 Electron + CDP 上跑，副本策略、判据见 §4）。

---

## 7. 附：本次所有实测过的命令与结果（速查）

| 命令 | 返回值/异常 | 结果 |
|---|---|---|
| `style`（`'p'`/`'h1'`…`'h6'`） | `true` | 原地换类型，内容保留 |
| `unorderedList` / `orderedList` / `taskList` | 成功 | 动作生效、内容保留（结构未逐项验证） |
| `quote` | `undefined`（生效） | **包住内容**（真转换） |
| `alert` | `undefined`（生效） | 全选→空容器替换选区（丢内容）；折叠光标→插入空容器 |
| `columns`（`2`） | `true` | 同上 |
| `collapse` | `undefined`（生效） | 同上 |
| `codeblock` | **`false`** | 无效果（命令不存在/不适用） |
| `style 'codeblock'` | **抛错** `invalid node insert: #root can't contain codeblock` | 不可用 |
| `insertCard('codeblock')` | 返回新卡 id | 插入**空**代码块卡；整块选中时会把原文本吃掉 |
| `insertAtSelection('text/lake' \| 'text/plain', …)` | 返回节点 | **文档无变化**（疑用法/格式问题，请复核） |
| `deleteByRange`（`kernel.execCommand`，range 由 `engine.transformDOMRange` + `renderer.kernel.createModelRange` 构造） | 成功 | 删除整块（我们用它的原生删除替代 JSON 删除） |
| `breakLine` | `true` | 在光标处断行，紧邻生成新段落（我们用它实现"在下方添加"） |
| `indent` / `outdent`（`editor.execCommand`） | 成功 | 缩进（正文 +26B，卡片零改动） |
| `hr` | 成功 | 插入分割线 |
| `copy`（`renderer.execCommand('copy', range)`） | 非 false | 复制整块 DOM |
| `selection`（`kernel.execCommand`） | — | 设置模型选区（`{focus,anchor,ranges:[modelRange]}`，用于全选块 / 折叠光标） |