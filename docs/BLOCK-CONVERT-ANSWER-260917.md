# 块「转化为」容器/卡片：内核能力复核结论（260917）

> 复核对象：`docs/BLOCK-CONVERT-QUESTION-260917.md` 的 **§3 / §7**。
> 方法（按 AGENTS §2 三级检索）：① 官方出处 `/Users/admin/file/local-lake/yuque-developer-docs/` → ② vendor 内核 bundle 源码
> `vendor/lakex-doc-react/src/components/lakex/lakex.js`（实际运行的 @alipay/lakex-doc）→ ③ **真实 Electron + CDP 副本实测**。
> 实测全程：只读文件不打开；用应用自身右键「复制」建副本，在副本上操作，结束丢回收站（`scripts/e2e-block-menu-smoke.mjs` 同套路）。

---

## 0. 结论（一句话）

**内核没有「把段落转成 高亮块/分栏/折叠块/代码块 并保留内容」的单条命令**（命令级只有 `quote`/`style`/列表是原地或包裹语义）。
**但内核提供了一条通用、官方文档化的正规插入通道 `insertAtSelection`**：它能**一次性插入「带内容的」高亮块/分栏/折叠块/代码块卡**（内核对 alert/分栏自动补 `alertHole`/`containerHole`，内容保留）；
再配合官方 `getNodeContent(blockId,'text/lake')`，即可**一条命令把原块替换成「含原文的容器」**。代码块另有 markdown 一条到位法。
因此对问题文档 §6：**不是纯 (A)，也不是「内核有一条 convert 命令」的 (B)** —— 准确措辞见 §1。

---

## 1. 对「内核有没有正规能力」的准确回答

| 目标 | 内核命令级能力 | 内核通用机制（`insertAtSelection`） | 是否一次性 | 内容是否保留 |
|---|---|---|---|---|
| 正文 / H1–H6 | `style 'p'\|'h1'…'h6'` ✅ 原地换类型 | — | 是 | ✅ |
| 有序/无序/任务 | `orderedList`/`unorderedList`/`taskList` ✅ | — | 是 | ✅ |
| 引用 | `quote` ✅ 走 `wrapRootNode` **真包裹** | — | 是 | ✅ |
| **高亮块** | ❌ `alert` = 删选区 + 插**空**容器 | ✅ `text/lake` 或 `text/markdown` 载荷 | 是 | ✅ |
| **分栏** | ❌ `columns N` = 删选区 + 插**空**分栏 | ✅ `text/lake` 载荷 | 是 | ✅ |
| **折叠块** | ❌ `collapse` = 删选区 + 插**空**折叠块 | ✅ `text/lake` 载荷 | 是 | ✅ |
| **代码块** | 无 `codeblock` 命令（返回 false） | ✅ `text/markdown` 代码围栏，或 `insertCard`+`setCardValue` | 是 | ✅ |

**关键机制证据（源码）**：`insertAtSelection` 的实现 = `kernel.readData(format,data)` → `iD.insertINode(editing, selection, inode)` → commit。
`insert-inode-by-position.ts` 在插入目标是 `alert`/`columns`/`collapse` 这类节点时，会**自动创建 `alertHole`/`containerHole` 并包裹**——
所以「插入一个**已含子节点**的容器」天然成立（这与我们直接调 `alert` 命令得到的「空容器」是两条不同路径）。

---

## 2. §3 逐条回答

### §3.1 官方命令清单是否完整？有无未收录的「转换」命令？
**清单不完整，但没有「转换」类命令。** 在 bundle 里把所有命令注册点提取出来：`kO({command:{…}})` 映射 + `registerCommand('…')` 命令式注册，
共 **147 个命令名**（另有 `alert/alertDelete/alertType/alertMove` 等以 `registerCommand({…})` 映射注册）。
- 与容器/卡片相关且**真实存在**的：`quote`、`columns`/`columnsAddColumn`/`columnDelete`/`columnsWidths`、`collapse`/`collapseBreakLine`/`collapseOpen`、`insertCard`/`insertCardAfter`/`setCardValue`/`cardValue`/`moveCard`、`insertAtSelection`/`getNodeContent`/`insertAtPosition`。
- **不存在**：`convertBlock`/`wrapBlock`/`turnInto`/`toggleBlock`/`changeBlockType`/`callout`（bundle 内 0 命中）。
  `convert` 字符串只出现在 date-card 的值对象与 URL/SVG 工具函数里，与块转换无关。
- 命令注册表不在 `editor._$commands`（那里只有 4 个编辑器级命令：`correctSelection`/`editorApplyCorrection`/`editorIgnoreCorrection`/`toggleTocView`）；内核命令在 `editor.kernel` / `editor._engine` 上。
- ⚠️ **`queryCommandEnabled(name)` 不能用来判断「命令是否存在」**：`insertAtSelection`/`getNodeContent`/`setCardValue`/`moveCard` 都返回 `false`，但实测 `execCommand` 正常生效（它们的 `getState` 恒为 `NOT_EXECUTED`）。原文档若据此判定「不可用」会误判。

### §3.2 `insertAtSelection` 的正确用法（**原结论「文档无变化」是错的**）
实测（副本，落盘复核）：**它有效**。原会话看到「返回节点但文档无变化」，最可能是
(a) 传的是 `<p id="uProbeA"><br></p>`（空段落，视觉/文本上「看不出变化」），或 (b) 判据只看文本未看结构。

签名与语义（源码 `plugins/content/.../insert-at-selection-command.ts`；官方 `08 - 命令列表`亦有收录）：
```js
// format: 'text/html' | 'text/markdown' | 'text/plain' | 'text/lake' | 'text/ne-inode' | 'Files'
// 返回：解析出的 INode（对象）；解析失败返回 null（不落库）
const node = editor.execCommand('insertAtSelection', format, data /*, modelRange 可选 */);
```
- **折叠光标** → 在光标处**插入**（原块保留，作为同级兄弟）。
- **非折叠选区** → **替换**被选中的内容（官方文档明确：「如果选区非折叠，被选中的内容将会被替换为插入内容」）。

**实测三条（副本 → 落盘）**：
1. `insertAtSelection('text/lake','<p><span>ZZ…</span></p>')` → 插入成功、落盘在。
2. `insertAtSelection('text/lake','<blockquote class="lake-alert lake-alert-info"><p>…ZZALERTMARK…</p></blockquote>')` → 落盘得到**含内容的高亮块**：
   `<blockquote class="lake-alert lake-alert-info"><p id="uZA1"><span>ZZALERTMARK</span></p></blockquote>`。
3. **一次性「段落 → 含原文高亮块」**：先 `getNodeContent(blockId,'text/lake')` 取原文 → 选中该块（非折叠）→
   `insertAtSelection('text/lake', '<blockquote class="lake-alert lake-alert-info">' + frag + '</blockquote>')`
   ⇒ 原段落被替换（`pidGone:true`），新 alert 的 DOM、`getDocument('json')`、落盘 `.lake` **三处都含原文**。分栏/折叠块同理（见 §4 配方）。

### §3.3 卡片 API：能否「插空代码块卡 → 写内容」
**能，且两条路都实测通过：**
- **A（推荐，一次到位）**：`insertAtSelection('text/markdown', <三反引号围栏> + code + <三反引号围栏>)`
  → 落盘 `<card type="inline" name="codeblock" value="data:{…,&quot;code&quot;:&quot;ZZMDCODE&quot;,…}">`（内容在卡里）。
- **B（插卡 + 写值）**：`const id = editor.execCommand('insertCard','codeblock')`（返回卡 id，如 `scN5m`）→
  `editor.execCommand('setCardValue', false, id, { code: 'ZZCODE_MARK' })` → 返回 `true`，落盘卡值归一为
  `{"search":"","code":"ZZCODE_MARK","heightLimit":true,"id":"scN5m"}`。
- 注意：`queryCommandValue('cardValue', id)` 实测返回 `undefined`（不可依赖）；写值用 `setCardValue`，读值建议直接看 `getDocument('json')`/落盘。
- `insertCard('codeblock')` 单独用 = **插入空卡**（原段落不动）；整块选中再插卡会把原文本吃掉 ⇒ 必须配 `insertAtSelection` 或 `setCardValue`。

### §3.4 配置类开关
**没有影响「块转换/容器行为」的配置项。** 官方 `47 - 通用配置`/`48 - 适配器`/`55 - 斜杠命令`/`69 - 开发自定义卡片` 无「转化/convert/wrap」条目；
`55 - 斜杠命令` 只把 `alert/columns/collapse` 作为**斜杠菜单的插入项**（与命令同级，都是「插空容器」语义）。
bundle 内 `blockMenu`/`convert` 相关 config 0 命中；`disabledPlugins` 只是关插件。

### §3.5 其它 kernel 方法（`kernel.convert*/wrap*/move*`）
- `editor.kernel` 上没有 `convert*`/`wrap*` 公开方法；**`wrapRootNode` 是内核内部 range 工具**
  （`framework/kernel/src/model/utils/range/wrap-root-node.ts`，全 bundle 仅 2 处：定义 + `quote` 命令调用），**未暴露**成命令/服务。
- **纠正一条旧结论**：「内核没有移动块原生命令」不准确 —— 存在**节点类型专属**的原生移动命令：
  `moveCard`、`moveCollapse`、`moveColumns`、`moveColumn`、`moveTable`、`moveImage`（以及 `tableRowMoveTo`/`tableColumnMoveTo`）。
  但它们接收的是**模型 Position**（`moveCard(cardId, position)`），且只覆盖这些类型；**没有通用「移动任意块」命令**。
  （vendor 拖拽停用仍成立：原生移动不适合通用拖拽，且原实现走的是整篇 JSON 路径。）

### §3.6 参考实现
- `lake-main/`（开源 lakejs，机制字典）：`src/plugins/` 里**根本没有 columns/collapse/alert 插件**，
  「包裹」相关只有 `src/utils/wrap-node-list.ts`（paste 用），**没有可借鉴的「转容器」实现**；且其序列化方言已与运行内核分叉。
- `lake-editor-main/`：只有打包产物（`media/editor/doc.umd.js`），无源码级「转化」实现。
- ⇒ 没有第三方参考实现可抄；结论只能由官方文档 + 运行内核实测得出（即本文件）。

---

## 3. §7 命令表（复核修正版）

| 命令 | 返回/异常 | 实测结果（副本 + 落盘） | 与原表差异 |
|---|---|---|---|
| `style 'p'\|'h1'…'h6'` | `true` | 原地换类型，内容保留 | 同 |
| `unorderedList`/`orderedList`/`taskList` | 成功 | 动作生效、内容保留 | 同 |
| `quote` | 生效 | **包住内容**（源码走 `wrapRootNode`） | 同 |
| `alert` | 生效 | ⚠️ **删选区→插空 alert（+新建空段落）**；折叠光标下原段落保留、旁边多一个空高亮块 | 同（补源码证据） |
| `columns N` | `true` | ⚠️ **删选区→插空分栏**（N 个空 `lake-column-item`） | 同 |
| `collapse` | 生效 | ⚠️ **删选区→插空折叠块** | 同 |
| `codeblock` | `false` | 命令不存在/不适用 | 同 |
| `style 'codeblock'` | 抛错 `invalid node insert: #root can't contain codeblock` | 不可用 | 同 |
| `insertCard('codeblock')` | 返回新卡 id | 插**空**代码块卡；整块选中时会吃原文本 | 同 |
| **`insertCard('codeblock')` + `setCardValue(false,id,{code})`** | `true` | ✅ **得到含代码的代码块卡**（落盘核验） | **新增（代码块有解）** |
| **`insertAtSelection('text/markdown', <三反引号围栏>)`** | 返回 INode | ✅ 一次生成**含内容**代码块卡 | **新增** |
| **`insertAtSelection('text/markdown',':::info…:::')`** | 返回 INode | ✅ 一次生成**含内容**高亮块 | **新增** |
| **`insertAtSelection('text/lake', 容器+内容)`** | 返回 INode；失败 `null` | ✅ 一次插入**含内容**的 alert/columns/collapse | **新增** |
| **`getNodeContent(id,'text/lake'\|'text/plain'\|'text/html')`** | 字符串 | ✅ 取块内容（构造替换载荷用） | **新增** |
| `insertAtSelection('text/lake'\|'text/plain', …)` | 返回节点 | ❌ 原表「文档无变化」**有误**：实测有效（见 §3.2） | **修正** |
| `deleteByRange` | 成功 | 原生删除整块（沿用） | 同 |
| `breakLine` | `true` | 光标处断行，紧邻生成新段落 | 同 |
| `indent`/`outdent`（`editor.execCommand`） | 成功 | 缩进（正文 +26B，卡片零改动） | 同 |
| `hr` | 成功 | 插入分割线 | 同 |
| `copy`（`renderer.execCommand('copy',range)`） | 非 false | 复制整块 DOM | 同 |
| `selection`（`kernel.execCommand`） | — | 设置模型选区 | 同 |
| **`moveCard`/`moveCollapse`/`moveColumns`/`moveColumn`/`moveTable`/`moveImage`** | 命令存在（`queryCommandEnabled` 未必 true） | 节点类型专属的原生移动，接收模型 Position | **新增/纠正** |
| `queryCommandEnabled(name)` | `true\|false` | ⚠️ **不等于「命令是否存在/可用」**（`insertAtSelection` 等返回 false 但可执行） | **新增** |

---

## 4. 可复现的最小用法（全部内核原生命令，无 DOM/JSON 整篇读写）

```js
// 0) 取块内容（官方命令，实测有效）
const frag = editor.execCommand('getNodeContent', blockId, 'text/lake');

// 1) 段落 → 含原文的高亮块（把 blockEl 整块选中为非折叠选区后执行）
editor.kernel.execCommand('selection', {
  anchor: 'start', focus: 'end',
  ranges: [editor.engine.transformDOMRange(rangeOverBlockEl)],
});
editor.execCommand('insertAtSelection', 'text/lake',
  '<blockquote class="lake-alert lake-alert-info">' + frag + '</blockquote>');

// 2) 分栏（两栏，首栏放原文）——lake 外壳
editor.execCommand('insertAtSelection', 'text/lake',
  '<article class="lake-columns">' +
    '<article class="lake-column-item" style="width: 50%">' + frag + '</article>' +
    '<article class="lake-column-item" style="width: 50%"><p><br></p></article>' +
  '</article>');

// 3) 折叠块
editor.execCommand('insertAtSelection', 'text/lake',
  '<details class="lake-collapse" open="true"><summary class="lake-summary"><br></summary>' + frag + '</details>');

// 4) 代码块（推荐 A：markdown 一条到位；内容为纯文本代码）
editor.execCommand('insertAtSelection', 'text/markdown', FENCE + '\n' + code + '\n' + FENCE); // FENCE = 三反引号
//    代码块（B：插空卡 + 写值）
const cardId = editor.execCommand('insertCard', 'codeblock');
editor.execCommand('setCardValue', false, cardId, { code });
```
**规范 lake markup（实测落盘，可直接作为载荷模板）**
- 高亮块：`<blockquote class="lake-alert lake-alert-info">…`（type 见 `lake-alert-<type>`，默认 `info`）
- 分栏：`<article class="lake-columns"><article class="lake-column-item" style="width: 50.000000%">…</article>…</article>`
- 折叠块：`<details class="lake-collapse" open="true"><summary class="lake-summary">…</summary>…</details>`
- 代码块卡：`<card type="inline" name="codeblock" value="data:{\"search\":\"\",\"code\":\"…\",\"heightLimit\":true,\"id\":\"…\"}">`

**边界/代价**：`text/lake` 载荷保留行内标记（原 `<span>` 原样带过去）；`text/markdown`/`text/plain` 载荷会把行内标记降级为纯文本。
本方案**不碰** `utils/blockDoc` 的整篇 JSON 读改写（那条路径会毁自定义卡，见 §5）。

---

## 5. 证据来源
- 源码：`vendor/lakex-doc-react/src/components/lakex/lakex.js`
  - `plugins/alert/src/kernel/commands/alert-command.ts`（删选区 + `createHole('alertHole')` + 新建空段落）
  - `plugins/columns/.../columns-command.ts`、`plugins/collapse/.../collapse-command.ts`（同为删选区 + 空容器）
  - `plugins/quote/.../quote-command.ts`（`ia.wrapRootNode`，唯一命令级包裹）
  - `framework/kernel/src/model/utils/range/wrap-root-node.ts`（内部工具，未暴露）
  - `framework/kernel/src/model/utils/position/helpers/insert-inode-by-position.ts`（自动补 `alertHole`/`containerHole`）
  - `plugins/card/.../set-card-value-command.ts`、`plugins/content/.../insert-at-selection-command.ts`
- 官方文档：`yuque-developer-docs/docs/07 - API与事件`、`08 - 命令列表`、`55 - 斜杠命令`。
- 运行时：真实 Electron（CDP 9222）在**副本**上实测，每步比对 DOM / `getDocument('json')` / 落盘 `.lake` 三处；副本用后丢回收站，原件未打开。
- 已回填：`docs/LAKEX-CONTRACT.md` §5.8。

---

## 6. 落地状态（260917，已实现）

- **实现位置**：vendor `src/components/BlockHoverHandle/blockMenuHelpers.ts` 新增 `convertBlockPreservingContent`；
  `runNativeConvert` 对 **高亮块/分栏/折叠块/代码** 四个目标优先走它，取不到内容或内核拒绝载荷时**回退**旧的「折叠光标 + 空容器」（不丢数据）。
  **未采用**「记录原文 → 命令 → insertText → 删原段落」那种自组装多步编排。
- **护栏**：`src/features/editor/blockMenuNative.test.ts`（源码级：必须有 `getNodeContent`/`insertAtSelection`/三种 lake 外壳，且不得回归 `utils/blockDoc` 的 JSON 路径）+
  `scripts/e2e-block-menu-smoke.mjs`（副本 e2e；新增「**原文在容器内部**」强断言，代码块改为解码卡值后校验；卡片指纹对卡内 id 做归一，仍能抓到载荷改写/未注册卡丢失）。
- **实测（副本，原件不打开）**：在专用 30 段纯文本夹具上 e2e 全绿 ——
  高亮块 / 分栏 / 折叠块 / 代码块 四项均「原文进入容器内部」，16 个「转化为」+ 复制/剪切/删除/缩进/在下方添加/拖拽回归全部通过，卡片逐字节未变。
- 门禁：`tsc` 0 · `vitest` 997 passed / 16 skipped · 桌面 + 移动 build 全绿。

**260917 二次修正（用户实测）**：① 代码块改用「卡片 value」生成（不带 `hideToolbar` ⇒ 工具栏/代码名称完整展示，markdown 围栏已弃用）；② 代码块是**块卡**，整张塞进 alert 会丢 ⇒ 卡片源转容器/正文/标题一律**抽取文本**；③ `quote`/列表命令对卡片源无效（no-op / 抛错）⇒ 先抽取成段落再执行内核命令；④ 图片/文件是内联卡，嵌容器不丢，保持原样。e2e 新增「卡片源」用例（代码块 → 高亮块 / 正文 / 引用，含卡计数 1→0 断言）全部通过。详见 `vendor/lakex-doc-react/LOCAL-CHANGES.md` #12。
