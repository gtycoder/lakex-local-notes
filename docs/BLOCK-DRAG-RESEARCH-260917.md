# 块拖拽调研 + 块编辑/转化代码审计（260917）

> 目的：① 核实另一会话的《block-hover-handle-plan.md》里"拖拽会毁数据、内核没有移动块命令"的结论；
> ② 审计并优化块编辑/块转化代码。全部结论为本机实测（**副本**上跑，原件不打开），命令/源码出处见文末。

---

## A. 拖拽调研

### A0. 一句话结论

**拖拽不是"不能做"**：真正毁数据的是实现拖拽所用的 **`utils/blockDoc` 整篇 JSON 读改写**（`getDocument('json')` → 改树 → `setDocument('json')`），
而不是"拖拽"这个交互本身。内核**有**原生移动能力：卡片类 `moveCard`（实测**逐字节保真**），折叠块/分栏/表格/图片各有 `moveCollapse`/`moveColumns`/`moveTable`/`moveImage`；
文字块可用**纯原生**的"读-插-删"（`getNodeContent` + `insertAtSelection` + `deleteByRange`）实现，**不经过 JSON 路径、不膨胀**。
所以《plan》里"内核没有移动块命令 ⇒ 拖拽只能停用"的推导**不成立**（它只对当时的 JSON 实现成立）。

### A1. 实测证据（同一篇含真实 `customBlock customName="mindmap-card"` 634B 的文档，副本）

| 做法 | 思维导图卡（原 634 B / hash `bd0ecaf7`） | 其它已注册卡（codeblock×2、hr×2） | 结论 |
|---|---|---|---|
| **JSON 往返** `setDocument('json', getDocument('json'))` | **634 B → 8859 B**（hash 变） | 逐字节不变 | ❌ 证实《plan》的膨胀数字（**JSON 路径的锅**） |
| **原生 `moveCard(cardId, position)`** | **634 B / hash 完全不变**（卡位置改变） | 逐字节不变 | ✅ **保真移动** |
| **原生"读-插-删"** `getNodeContent('text/lake')` → `insertAtSelection` → `deleteByRange` | 634 B 不变，**hash 变**（卡内 `id` 被重新发号；634→634，**无膨胀**） | 逐字节不变 | ✅ 可用（卡 id 会变，载荷不丢） |
| `getNodeContent(cardId,'text/lake')` 读取 | 返回 **634 B 原始 lake**（`type="block" name="customBlock" customName="mindmap-card"`），**不是**水合形态 | — | ✅ 读是干净的 |

> 对照《plan》里的记录：`剪切` 走 `blockDoc.deleteBlock`（JSON）时 `mindmap-card` 634B→8859B —— 与上表第一行一致，**根因是 JSON 读写，不是拖拽**。

### A2. 内核原生移动命令清单（bundle 源码）

| 命令 | 适用节点 | 签名/说明 |
|---|---|---|
| `moveCard` | Card（含块卡 codeblock/hr/customBlock、内联卡） | `execute(editing, cardId, position)` → `insertNodes(editing, position, [card])`；**移动已有节点、不重新序列化 ⇒ 保真** |
| `moveCollapse` / `moveColumns` / `moveColumn` | 折叠块 / 分栏 / 单栏 | 各插件 command map 注册 |
| `moveTable` / `tableRowMoveTo` / `tableColumnMoveTo` | 表格 | `table` 插件 command map |
| `moveImage` | 图片卡 | `image` 插件 |
| **通用文字块** | 段落/标题/引用/列表 | **没有**通用 move 命令 ⇒ 用"读-插-删"（纯原生命令组合） |

`position` 可由 `editor.engine.transformDOMRange(domRange).start`（模型 Position）构造，实测 `ed.execCommand('moveCard', cardId, pos)` 生效。

### A3. 建议的拖拽实现（**260917 已实现**，分支 `feat/block-drag-native`）

1. 沿用 vendor 现成的拖拽视觉层（`BlockHoverHandle.startDrag` 里的 ghost/蓝色落点指示线/自动滚动，**代码已在，只是被短路**）。
2. 落点用"命中块的模型 Position"表达，按落点在目标块上半/下半选 `transformDOMRange(...).start`。
3. 分派：卡片 → `moveCard`（首选，保真）；折叠块/分栏/表格/图片 → 对应 `move*`；段落/标题/引用/列表 → `getNodeContent` + `insertAtSelection` + `deleteByRange`。
4. 全程**禁用** `utils/blockDoc` 的 JSON 路径（护栏已有：`blockMenuNative.test.ts` 断言不得出现 `moveBlock`/`convertBlock` 等）。

### A4. 边界与风险（必须知道）

- **未注册卡（如旧自研画板 `board-card`）**：不在内核模型里 ⇒ **任何一次保存都会丢**（与拖拽无关，见 `docs/LAKEX-CONTRACT.md` §5.8 末段 / HANDOFF §3.15）。拖拽救不回来。
- **跨容器拖入**（拖进分栏/折叠块）：内核按 `insert-inode-by-position` 自动补 hole，结构由内核决定，需真机测。
- **历史/撤销**：移动是内核编辑事务，理论上可 undo；需实测确认（尤其 `moveCard`）。
- **虚拟渲染**：DOM 只有视口内块；落点命中依赖 `elementsFromPoint`，需处理滚动/自动滚动。

### A5. 结论（对用户问题）

> **"是否真的是这样？"** —— 《plan》里"JSON 路径会膨胀/毁卡"的**数据是真的**（本机复现 634→8859），但它归因于 **JSON 实现**；"内核没有移动块命令"**不准确**。
> **"拖拽能不能做？"** —— **能**，用内核原生命令即可（卡片 `moveCard` 最稳；文字块"读-插-删"）。**已实现**：`moveBlockNative` + 接通 vendor 拖拽视觉层；e2e 实测卡片逐字节保真、段落移动成功。

---

## B. 块编辑/转化代码审计

### B0. 已修复的缺口（本轮）

1. **菜单"按块类型区分"没真正生效（真实 bug）**：所有**块卡**（代码块/分割线/思维导图/画板…）在 DOM 里都是 `ne-card` 包在 `ne-hole` 内，
   `findBlockNode` 解析出的元素是 `ne-hole` ⇒ 旧逻辑下"图表类不给转化为"落空。
   **修法**：`getBlockMenuKey` 对 `ne-card`/`ne-hole` **看内部 `ne-card` 的 `data-card-name`**，已知可转化的（`codeblock`/`hr`）映射到既有配置，其余走 `ne-card` 基础菜单（**无「转化为」**）。
   实测：思维导图卡菜单 = `[删除, 复制, 剪切, 在下方添加]`；代码块 = `[转化为, 删除, 复制代码, 剪切, 在下方添加]`。护栏加了两条断言。

### B1. 审计结论（结构/可维护性）

- **`blockMenuHelpers.ts`**：职责清晰，错误处理均 try/catch + 返回 false 让调用方回退；"容器源选节点本身""卡片/容器源抽取文本"两条关键规则已覆盖。**建议**：`readSourceBlock` 每次两次 `getNodeContent`（可在需要时才取 plain，收益极小，暂不改）。
- **`BlockContextMenu.tsx`**：`MENU_CONFIGS` 仍有较多复制粘贴式重复（p/h1–h6/quote/list 结构几乎一样）；`ne-card` 里 `duplicate`/`addBefore` 是历史项（已被 `SAFE_BLOCK_ACTIONS` 过滤）。**建议**（未做，避免大改）：抽 `textLikeMenu(fromType?)` 收敛重复、删历史项。
- **`BlockHoverHandle.tsx`**：拖拽视觉层（ghost/indicator/自动滚动）现在是**死代码**（入口短路），按《plan》保留以便复用；若做原生拖拽可直接复用（A3）。
- **重复/无效调用**：`startDrag` 仍在每次 `mousedown` 调用（内部短路），可忽略。
- **测试覆盖**：`blockMenuNative.test.ts`（禁 JSON 路径、白名单、卡片抽取、菜单 key）、`editorCut.test.ts`（剪切走内核）、`scripts/e2e-block-menu-smoke.mjs`（16 项转化 + 卡片源 + 容器源 + 剪切/删除/拖拽回归 + 卡片保真）。

### B2. 建议但**未做**的优化（供拍板）

1. 收敛 `MENU_CONFIGS` 重复（纯重构，需 e2e 复跑）。
2. 实现原生拖拽（A3）。
3. `getCurrentConvertValue` 仍按 `blockType` 判断"当前格式"，块卡场景无意义；可改用 `menuKey`（影响仅高亮态）。
