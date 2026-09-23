# 桌面编辑态浮动工具栏（选区气泡）设计（260919）

> **性质**：设计文档，**不含实现**。用户 260919 决策两条：① 按钮清单按本文 §2 的建议；② **只做桌面编辑态**。
> **内核侧事实**全部在 `docs/LAKEX-CONTRACT.md` **§5.10**（本次调研已回填），本文只讲「我们做什么、怎么做、怎么验收」。
> 关联：§5.9 命令注册表、`docs/BITABLE-PRODUCT-SPEC-260919.md`（同一批调研的另一条线，无关）。

---

## 0. 一句话

在 **wrapper 层自研**一个浮框，**选中文字或图片都浮现**，两种形态按钮不同，均浮在锚点上方，**仅桌面编辑态**，全部用内核原生命令驱动。

- **文字选区**：`正文 · 字号 · B · I · S · U · 链接 · </> · A · 对齐 · ⋮`。
- **图片选中**：`对齐(左/中/右) · 尺寸(小/中/大/原始) · 替换 · 下载 · 复制 · 删除`（用户 260924 定稿，对齐钉钉）。

> **260924 更正**：本文件初稿只规划了文字选区，并写「图片有自己的工具条，互不干扰」——实测**不成立**：
> 内核只给 inline 图片卡片一个 28×28 hover「⋯」按钮（`.ne-ui-image-more`）→ 弹出 `.ne-ui-image-inner-menu` popover（**只有 删除 / 复制**），
> 没有「选中即弹」的浮动条（`.ne-card-toolbar` 实测计数恒 0）。详见 `LAKEX-CONTRACT.md §5.10 六`。

---

## 1. 为什么要自研（三条已核实的结论）

1. 内核**有**浮动工具栏基建（`miniToolbar` 插件 + `showMiniToolbarWhen` 触发开关 + uilib 的 `OverlayBar`/`MiniToolbar`/`BoundaryPopover`），
   但它服务的是**卡片/容器**：条目只有 `复制 / 剪切 / 删除 / 复制链接 / 间距 / 全屏 / 宽度 / 评论`，**没有一条文字格式命令**。
2. 内核**没有文本选区的浮动格式栏**（bundle 枚举：59 个插件、uilib 组件表、overlay 类型里都不存在这种浮层）。
3. 语雀云端**也没有**（编辑态与阅读态实测：编辑态只有顶部固定工具栏 + 分栏容器工具，阅读态只有产品级 AI 入口）；钉钉有，但那是钉钉自家 `wd3-*` 组件。
   ⇒ **要钉钉那种，只能我们自己写。**

---

## 2. 文字形态按钮清单（260924 定稿：对齐内核固定工具栏的 Lake 风格，弃用钉钉风格）

从左到右：**清除格式 · 段落样式(H1–6) · 字号 · 加粗 · 倾斜 · 中划线 · 下划线 · 文字颜色 · 背景色 · 转为 · 超链接**

| 按钮 | 内核命令 | 取值 |
|---|---|---|
| 清除格式 | `clearFormat` | — |
| 段落样式（下拉） | `style` | `p` / `h1`…`h6`（标签沿用内核：正文 / 标题1..6；常量 `PARAGRAPH_STYLES`） |
| 字号（下拉） | `fontsize` | `FONT_SIZE_OPTIONS`（官方 docs/08 区间） |
| 加粗 / 倾斜 / 中划线 / 下划线 | `bold` / `italic` / `strikethrough` / `underline` | — |
| 文字颜色 | `color` / `clearColor` | 色板 |
| 背景色 | `bgColor` / `clearBgColor` | 色板 |
| 转为（下拉） | `orderedList` / `unorderedList` / `taskList` / `quote` / `code` / `alert` | 有序列表·无序列表·待办列表·引用·**代码块(行内代码)**·高亮块（常量 `CONVERT_ITEMS`） |
| 超链接（下拉输入 URL） | `link`(选区) / `insertLink`(光标) / `unlink` | 先用 `queryCommandEnabled` 把门 |

**样式实现**：复用内核固定工具栏的类名与图标 sprite（`ant-btn` / `ne-ui-toolbar-*` / `ne-icon-*` / `#icon-*`），
下拉菜单用内核的 `ant-dropdown-menu + ne-ui-select-*` 结构，active 态用内核 `.checked` 类；**不引入钉钉 `wd3-*` 风格**。

## 2b. 图片形态按钮清单（260924 定稿）

云端语雀实机顺序：裁剪 · 旋转 · 宽高 · 链接 · 描述 · 对齐 · 样式 · 边距 · 批量应用。全部走 `updateImageData`（260924 实测）。

| 按钮 | 内核调用 | 实测状态 |
|---|---|---|
| **裁剪** | 卡实例 `_$cardUI.setCro(true)`（内核交互式裁剪框） | ✅ 弹出 `.ne-ui-image-crop-box`；浮框让位 |
| **旋转** | `{ rotation: (current+90)%360 }` | ✅ `getRotation()=90` |
| **宽高** | `{ width: N }`（小/中/大/原始 + 自定义 px） | ✅ `img[width]` / `getUserWidth()` |
| **链接** | `{ link, linkTarget }` | ✅ 序列化含 link |
| **描述** | `{ title, showTitle }` | ✅ `getTitle()/showTitle()` |
| **对齐** | `{ style: "left"\|"center"\|"right"\|"none" }` | ✅ `ne-image-style-*` |
| **样式** | `{ style: "none"｜"stroke"｜"shadow" }`（云端文案 无样式/图片描边/图片阴影） | ✅ 内核 CSS 均生效 |
| **边距** | `{ margin: { top, bottom } }` | ✅ 命令返回 true |
| **批量应用** | `cardBatchApply("image", { style }｜{ width })` | ✅ = 同步到全文（同名卡片合并 patch） |
| **下载** | `native.saveAssetAs(noteId, filename)` | ✅ canonical URL 可解析时可用 |
| **复制** | `native.copyAssetImage(noteId, filename)` | ✅ 同上 |
| **删除** | `ed.execCommand("deleteCard", cardId)` | ✅ 实测卡片移除 |

> 复制/下载只在图片 src 是 canonical 资源 URL（`.../{noteId}/{filename}?token=`）时启用；data:/外链 置灰。

---

## 3. 显示 / 隐藏规则

**显示**：桌面 + 编辑态 + （**文字选区非折叠** 或 **点中图片卡片**） + 落在**当前可见**编辑器内。
图片形态锚点 = 图片卡片 `getBoundingClientRect()`；文字形态锚点 = 选区 `Range.getBoundingClientRect()`（多行取首行）。

**不显示**（v1 直接不挂）：

- 阅读态（`mode === "viewer"`）、移动端（`EditorDock` 那套不动）；
- `isMaxView`（卡片全屏态，内核自己会隐藏工具栏）；
- **表格内**（表格有自己的 `toolbarItems.table*` 一套，浮栏先让位）；
- 代码块内（v1 不做代码块专用浮栏）。

**隐藏时机**：选区折叠 / 点编辑区其它位置 / Esc / 切换 tab / 打开块菜单（见 §7）。

**长选区**：跨块选区只显示「行内可用」的那几项（B/I/S/U/链接/代码/颜色），段落样式与对齐置灰或隐藏。

---

## 4. 定位

- 锚点 = 选区 `Range.getBoundingClientRect()`（多行选区取**首行**的 rect）；位置 = 选区上方 8px、水平居中；上方空间不足则翻到下方。
- 滚动 / 窗口 resize / 布局变化后**跟随重定位**（内核有 `updatePos` 的同类做法；我们自己的块手柄也是这套）。
- 边界：不越出编辑器滚动容器；不遮住选区。
- 内核里有两个现成的定位算法（`BoundaryPopover` 的 `calc-position-by-node` / `calc-position-by-point`），但 **v1 建议自算**：逻辑简单、可控、不依赖内部件（内部件升级内核要复核，见 §5.10）。

---

## 5. 交互细则（「点浮栏不丢选区」是核心）

1. **容器捕获阶段 `onMouseDownCapture` + `preventDefault()`** —— 否则点按钮会先清掉选区，命令拿不到选区（这条我们在块菜单与移动 dock 上已踩过并解决，直接照搬）。
2. 点击按钮后**保持选区**、立即 `execCommand`；执行完刷新按钮 active 态。
3. **不要把焦点抢到浮栏上**（不 `focus()`、不 `blur()` 编辑器）：桌面用鼠标无 IME 问题，但抢焦点会让 next 次输入落点错。
4. 下拉（正文 / 字号 / 颜色 / 对齐 / 更多）走现有浮层容器（`.ln-*` 通用件 + `b3` 视觉语法，见 AGENTS §3 #14），**不写内联样式**。
5. active 态：见 §6 第 3 条 —— 用什么判定必须先定下来，别用会恒返回 `-1` 的写法。

---

## 6. 实现前必须先验证的 3 件事（P0）

1. **`strikethrough` 在桌面到底有没有效**：官方 docs/08 明确写了用法（`editor.execCommand('strikethrough')`），
   内核注册表（§5.9 `basicTextStyle`）也列了 `bold / italic / underline / strikethrough`；
   **但我们自己的 `src/features/editor/editorCommands.ts` 注释把它记成了 no-op** —— 那条记录来源是**移动端 `renderer.execCommand` 踩坑**（HANDOFF §8.2/§8.8），不能直接套到桌面。
   ⇒ 实现第一步：桌面选中文字 → `editor.execCommand('strikethrough')` → 看 DOM/`queryCommandState`；有效就同步把 `editorCommands.ts` 的黑名单注释与 `KNOWN_COMMAND_NAMES` 一起更正（含单测）。
2. **`fontsize`** 同理：官方给了取值区间与 `queryCommandValue` 用法；我们字典里同样记着 no-op。一并实测。
3. **active 态判定方式**：mark 命令的 `queryCommandState` 在部分环境恒返回 `-1`（HANDOFF §8.8 记录的移动端实测）。
   桌面要么用 `queryCommandState === 1`、要么用**DOM 计算样式**（`font-weight ≥ 600` / `font-style` / `text-decoration` / 行内代码的包裹元素）。
   二选一，写进单测，别两套混用。

---

## 7. 与既有浮层的边界（不打架）

| 既有浮层 | 关系 |
|---|---|
| 块手柄 + 块菜单（`BlockHoverHandle`，wrapper 自研） | 手柄在左侧 gutter、菜单挂在块上；浮栏在选区上方 ⇒ 位置不冲突。约定：**块菜单打开时不弹浮栏** |
| 卡片工具栏（`.ne-card-toolbar`，内核自带） | 卡片被选中时显示卡片栏；浮栏只在**文本选区**出现，不抢 |
| 图片 inline 卡片的 `.ne-ui-image-more`「⋯」按钮 | 内核只此一个入口（popover 删除/复制）；我方浮框在**点中图片**时出现，与它并存（v1 不隐藏内核按钮） |
| 表格工具栏（内核 `toolbarItems.table*`） | 表格内浮栏隐藏（§3） |
| 移动端 dock（`EditorDock`） | 完全不动 |

生命周期统一挂在 `src/features/editor/lakeRuntime.ts` 的 `__disposeExtras` 链上（与 `mountBlockHoverHandle` 同层），切 tab / 销毁时一起清理。

---

## 8. 预期落点（写下来给实现会话，本文不含实现）

```text
src/features/editor/selectionToolbar/
  SelectionToolbar.tsx          浮栏 UI（文字 / 图片两形态 + 下拉菜单）
  useSelectionToolbar.ts        显隐 / 定位 / 选区监听 / active 态
  selectionToolbarModel.ts(+test) 纯逻辑（定位算法 / active 解析 / 图片尺寸档位）
  mountSelectionToolbar.ts      React 根挂载 / 卸载
  selectionToolbar.css          样式（只用 --lake-* token；overlay 层，
                                基线已同步 src/styles/cssLayers.test.ts = 91）
```

- 挂载点：`lakeRuntime.ts` 的 `__disposeExtras` 链（桌面编辑态 opt-in，开关 = `prefs.floatingToolbar`，与 `prefs.blockHandle` 同型）。
- 命令：沿用 `editorCommands.ts`（§6 已按 260924 桌面实测校正：strikethrough/fontsize 等**有效**）。
- **落地状态（260924）**：文字形态全部生效；图片形态 对齐/尺寸/复制/下载/删除生效，**替换置灰**；**链接未上**（内核入口未找到）。

---

## 9. 验收清单（可直接照着点）

1. 桌面编辑态选中一段文字 → 浮栏出现在选区上方；点「B」→ 文字变粗且**选区没有丢**（可继续点「I」叠加）。
2. active 态与真实格式一致：把光标放进刚加粗的字里，浮栏的 B 是高亮态；选中普通文字时不亮。
3. 正文 / 字号 / 颜色 / 对齐 / 链接 / 行内代码逐项生效；**任何一项若为 no-op，必须有可见反馈**（不能点了没反应 —— 这是历史上最坑的体验）。
4. 阅读态、移动端、卡片全屏、表格内**不出现**浮栏。
5. 多 tab keep-alive 下浮栏只出现在**当前可见**编辑器上（不能抓到隐藏 tab 的元素 —— §5.8 的老坑）。
6. 滚动、缩放、切主题后位置与配色正确，不遮挡选区、不引起滚动跳动。
7. 与块手柄/块菜单互斥正确：打开块菜单时浮栏不出现；关掉后选区仍在时可再出现。
8. 门禁：`tsc` 0 · `vitest` 全绿 · 桌面 + 移动 `vite build` 全绿 · `git diff --check` 干净。

---

## 10. 明确不做 / 后置

- 移动端、阅读态的浮栏。
- 卡片/容器浮栏（内核自带，见 §5.10）。
- 表格内浮栏、代码块专用浮栏。
- 分享类按钮（钉钉的 `↗`）、AI、评论、@提及。
- 顶部固定工具栏的改造（它是另一套：官方 `ToolbarOptionHelper` + `ToolbarUIDescriptor`）。

---

## 11. 工作量（单人，含验证）

| 阶段 | 内容 | 估时 |
|---|---|---|
| **P0 验证** | §6 的三件事（桌面实测 `strikethrough` / `fontsize` / active 态判定） | 0.5 小时 |
| **M1 最小版** | 显隐 + 定位 + `B / I / S / U / 链接 / </> / 清除格式` | 0.5 天 |
| **M2 完整版** | 正文（段落样式）、字号、颜色、对齐、⋮ 更多、active 态、暗色主题 | 再 0.5～1 天 |
| **验证** | e2e（选中→点按钮→断言 DOM 与选区不丢）+ 门禁 | 含在上面 |

合计 **1～1.5 天**。

---

## 12. 证据索引

- 内核事实：`docs/LAKEX-CONTRACT.md` **§5.10**（浮动工具栏全貌）与 **§5.9**（命令注册表）
- 官方出处：`yuque-developer-docs/docs/08 - 命令列表`（`strikethrough` / `fontsize` / `link` / `code` / `color` / `alignment` 的用法与取值）、`04 - 配置工具栏`、`05 - 自定义工具栏（高级用法）`、`54 - kernel-assistant`
- 我们现状：`src/features/editor/editorCommands.ts`（命令字典 + no-op 注释）、`src/features/editor/blockHandleMount.ts`（wrapper 浮层先例）、`src/features/editor/lakeRuntime.ts`（挂载链）
- 三端实测截图：钉钉选区浮栏 `/tmp/dtfloat-03-bubble.png`；语雀编辑态（无浮栏）`/tmp/yqfloat-04-edit.png`；我们应用选区后无浮层 `/tmp/lkapp-03-select.png`
