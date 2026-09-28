# PANEL-CONTRACT.md — 桌面左右面板的几何 / 交互契约（单一来源，260923）

> **为什么有这份文件**：目录栏（`src/components/Sidebar.tsx`）与增强大纲（`src/features/outline/OutlineSidebar.tsx`）
> 在 260922 那一批里**各自把同一类坑修了一遍**（顶边取法 / 层序 / 悬停缝 / 宽度默认值）。文档化是防漂移最便宜的一招。
> **定位**：只写「跨侧不变量 + 取舍理由」，不复制实现。数值只认**令牌 / 常量**；代码里出现字面量时以本文件为准。
> 与 `AGENTS.md §3 #14`（UI 改动落点：找根位置、别套覆盖）配合使用。

## 1. 垂直几何栈（唯一来源 = `src/styles/app/base.css` 的令牌）

| 段 | 令牌 / 常量 | 当前值 | 谁在用 |
|---|---|---|---|
| 顶栏 = 标签条 `.tab-bar`（含工作空间菜单 / 同步 / 搜索） | `--topbar-height` | **32px** | `.tab-bar` 高、`.workspace` 顶距、左轨 padding、toast 顶 |
| pane 拼接缝 | 字面 `4px`（`.workspace` margin-top，有意保留的固定缝） | 4px | 所有顶距 `calc()` |
| 面包屑 `.protyle-breadcrumb` | `--breadcrumb-height`（内距 12px） | **30px** | 面包屑自身、各派生顶边 |
| 内核工具条 `.ne-ui-toolbar` | `--editor-toolbar-height` | **34px**（内核按钮 32px，**这是下限**） | 工具条自身、浮层顶 |
| 标签胶囊 `.tab-item` | `--tab-item-height`（**与顶栏解耦**） | **28px** | `.tab-bar` 垂直内距 = (顶栏 − 标签)/2 |

**派生（全部由上面算出，禁止再写死数字）**
- 目录 peek 顶边 `--lake-dir-peek-top` = topbar + 4 + breadcrumb + 6（= **72**）——**有意盖住工具条**（临时层，用完即收）。
- 浮层顶 / 左缘热区顶 `--lake-floating-panel-top` = topbar + 4 + breadcrumb + toolbar（= **100**）——**不盖工具条**。
- 阅读态大纲 `.ne-viewer-toc-sidebar` 的 `top` = topbar + 4 + breadcrumb（窗口坐标，= **66**）。
- 编辑区可视顶 `--lake-editor-top`（**相对 `.document-pane`**）= **运行时量测**（`src/hooks/useEditorTopVar.ts`），当前 **64** = 面包屑 + 工具条；工具条隐藏 / 换高 / 切主题自动跟随。**不要**改回写死（这是 260922 用户立规）。
- 标签胶囊高走**独立令牌** `--tab-item-height`（与顶栏解耦：顶栏收窄不牵动标签）；`.tab-bar` 垂直内距 = (顶栏 − 标签)/2 ⇒ 标签恒居中。`.tab-items` 有 `overflow-y:hidden`，**内距必须由这个差值派生**，写死会裁标签。
- **macOS 红绿灯**（native，不在 DOM）：位置由主进程从共享常量 `src/lib/layoutMetrics.ts` 的 `TOPBAR_HEIGHT` / `TRAFFIC_LIGHT_DIAMETER` 算出 —— `y = (顶栏 − 12)/2`，使红绿灯中心 = 顶栏中心。**禁止写死 y**（曾因顶栏 38→32 错位 3px）；`layoutMetrics.test.ts` 卡住它与 `base.css` 的 `--topbar-height` 一致。

**改高度只改这四个令牌 + 面包屑内距**；改完必跑 `vitest src/styles/cssLayers.test.ts` 与 `node scripts/ui-metrics.mjs`。

## 2. 层序（z-index，高→低）

顶栏/标签条 **400** · 大纲浮层 **260** · 目录浮层 **250** · 左缘热区 **110** · 块手柄簇 **100**（vendor）· 编辑器内面板/触发条/桥 **5 / 3 / 4**。

两条硬规则：① **面板必须盖住召唤它的热区 / 触发条**；② **热区必须压过块手柄**（否则「跟手把手」被手柄盖住）。

> **由测试强制**（260923 W3）：外壳层序已从散落字面量收进 `src/styles/themes/base.css` 的 `--lake-z-*` 令牌；顺序契约（手柄 < 热区 < 侧栏 < 大纲 < 顶栏，状态栏/编辑条在其下）加上"消费者引用令牌、不再写字面量"由 `src/styles/zOrder.test.ts` 断言 ⇒ 改大改小会被测试拦下。

## 3. 悬停 / 触发条

- 左缘热区宽 **10px**（`.edge-hotzone`；260923 由 8px 放宽，先试 12px、用户随后定为 10px）。**上界由块手柄槽决定**（正文左内距 56px、手柄命中区 34px、图标 24px）：
  - **段落**：手柄命中区 `[22,56]`、图标 `[31,55]`（260923 起图标在盒内右移 3px 贴正文，间隙 4→1px）⇒ 热区 **≤22px 都不碰**。
  - **标题 H1–H6**（默认 folding）：内核 `offset=20` 把命中区推到 `[2,36]`、图标 `[11,35]`；标题折叠钮 20px 在 `[36,56]`（紧贴正文）⇒ **任何 ≤22px 的热区都碰不到折叠钮**。
  - 热区 `z-index: 110` > 手柄 `100` ⇒ 重叠区命中归热区（点一下 = 固定/取消固定目录）。**10px 时连标题图标（从 x=11 起）也不重叠**；`12px` 只少吃标题图标左缘 1px；`~16px` 起图标被吃掉大半；`≥22px` 起连段落手柄也被吃。
- 进热区**立刻**浮出把手；**驻留 `EDGE_HANDLE_DWELL_MS` = 240ms** 才浮出面板预览。
- 计时**只在该轮没在跑时**重新武装；**不能重置已在跑的计时**（否则永远开不了）。
- 指针判定并集 = 热区 ∪ 目录/大纲面板 ∪ 桥/触发条。
- 面板**贴左缘（`left: 0`）**：留 8px 缝会让指针停在缝里 ⇒ 面板被收、且计时不再武装（260922 实测的真 bug）。
- 浮出后「点把手固定」只在 ~240ms 内有效（面板会盖住把手）——**有意的取舍**；可靠入口 = 面板头 📌 或 `⌘]`。
- **画板文档例外**：board 文档的 drawnix 会插入全屏 `.laser-pointer`（`fixed/inset:0/z-index:2022/pointer-events:auto`），从 `(5,120)` 起就命中它 ⇒ 左缘热区在该文档类型下**不生效**（既有行为，非重设计引入；260923 e2e 实测）。

## 4. 宽度持久化与默认值

- 键：宽度 `lake-notes-v3.sidebar-width` / `lake-notes-v3.outline-sidebar-width`；模式 `lake-notes-v2.sidebar-mode` / `lake-notes-v2.outline-sidebar-mode`。
- **必须区分「没存过」**：`Number(null) === 0` 会被钳到**最小值**（曾导致目录恒 160、大纲恒 200 而非默认）。**禁止** `Number(localStorage.getItem(x))` 直接当数值；unset → NaN → 走默认（目录 **224** / 大纲 **280**）。
- 拖拽 = 橡皮筋；键盘微调 ←/→ 8、Shift 24、Home/End 到极值；handle 带 `role="separator"` + aria 值。

## 5. 键盘可达性

- **`⌘]`** = 固定/收起目录栏（`toggleSidebarDock`：docked ↔ collapsed；对齐 Feishu 口径）。注册在 `useWindowShortcuts`（**capture 阶段**，焦点在编辑器也生效；260923 隔离实测内核未占用该组合键）。
- 左缘把手**不做**可聚焦元素（它是 hover affordance）——键盘入口用快捷键表达，不用 tabindex。

## 6. 已知取舍（别当 bug 反复提）

- 三态（固定 / 悬浮 / 收起）**必须都保留**；悬浮是**临时层**：固定高度、贴底浮卡、**不做高度适配**。
- 目录 peek 与大纲**刻意不同口径**：peek 从**面包屑下缘**起（盖工具条），大纲从**工具条下缘**起。不要强行统一。
- 目录树的外部写入通过 `library-changed` 自动刷新；不得再退回只能手动刷新的语义。
- 全桌面 `!important` ≤ 10，新增必须写明理由（`ui-metrics` 会卡）。

---
**改这些之前**：先读本文件 → 找到单一来源规则 → **就地改**；不要新加一层覆盖去调观感（AGENTS §3 #14）。
