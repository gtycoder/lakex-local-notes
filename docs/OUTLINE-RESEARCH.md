# 大纲（TOC）系统深入研究 — 机制笔记与技术方案

> 分支：`research/outline-system`（独立研究分支，不直接合入 master）。
> 日期：2026-08-05。
> 目标：弄清当前大纲的完整机制与两个已知问题（打开延迟 ~3s、各类修改频繁出错）的根因，
> 评估「应用自建大纲、适配多标签、支持子弹线/级别展示/滚动高亮」的可行路线，为后续只读锁打基础。

---

## 1. 结论速览

1. 当前桌面端（多标签）大纲 **是 Lake 原生能力 + 我们两处应用层补丁**：
   - 原生：编辑器插件 `toc`（PluginName `toc`，编辑模式 TOC 侧栏）与内核 TOC 管理器（同一 PluginName，负责收集标题数据）。
   - 我们补丁 A：`refreshTocSidebar()` — 打开文档后重放 `tocChange` 并轮询重试，弥补「侧栏先用空 toc 创建」的时序缺口。
   - 我们补丁 B：`setupTocScrollFollow()` — 虚拟渲染下原生 watcher 失效，自研滚动高亮/点击校正/列表跟随。
   - 我们补丁 C：`resolveScrollNode()` + `styles.css` 高度链，让 `.ne-editor-wrap` 成为真实滚动容器，原生 absolute 侧栏才能固定可见。
2. **打开延迟 3s 的主要构成**（需 Phase 1 埋点实测确认比例）：
   - 内核 TOC 数据在 `setDocument` 后的 `aftercontentchange` 才计算（虚拟渲染大文档下这步最慢）；
   - 编辑侧栏创建时 `toc: []`，只能等 `tocChange`；
   - 我们的轮询只是「等到数据就绪」，本身不产生 3s，但掩盖不了内核计算时间；
   - 原生侧栏每次 `tocChange` 全量 React 重渲染（`rerender({toc})` → forceUpdate），大文档有卡顿感。
3. **各类修改频繁出问题**：原生侧栏的渲染/选中/折叠状态与我们的 DOM class 补丁互相打架；
   原生 TOC 的 pin/hover/宽度逻辑依赖全局 `localStorage` 与单页 viewport 假设，与多标签/隐藏 tab 不兼容。
4. **开源 lake-main（lakelib 0.4.6）没有 TOC**：TOC 是语雀内部（lakex）新增能力，开源版无对应实现，只能以
   `node_modules/lakex-editor-react-component` 打包产物为权威依据；不能拿 lake-main 当 TOC 参考实现。
5. **推荐路线**：编辑器模式禁用原生 TOC 侧栏（`toc: { enable: false }`，**不要**用 `disabledPlugins: ["toc"]`），
   数据继续用内核 `tocChange` / `getDocExtraContent().toc`（内核管理器不受 enable 影响，永远运行），
   由应用自建每 tab 独立的 `OutlineController` + 自渲染侧栏。这样天然适配多标签，且子弹线/级别/滚动高亮完全可控。

---

## 2. 当前大纲用法审计（我们改了什么、在哪）

### 2.1 功能入口

| 位置 | 内容 |
| --- | --- |
| `src/lib/settings.ts` | `showToc` 设置项（默认 true） |
| `src/components/SettingsPanel.tsx` | 「显示文档大纲（TOC）」开关 → `settings.showToc` |
| `src/App.tsx` | 桌面 `tocEnabled = settings.showToc`；移动端 `mobileTocOpen`（阅读模式按钮） |
| `src/features/editor/EditorTab.tsx` | 每个 tab：`createLakeDocument(..., tocEnabled, ...)` + `setTimeout(() => refreshTocSidebar(editor, host), 0)` |
| `src/features/editor/LakeEditor.tsx` | 移动端单实例：同样调用 + `refreshTocSidebar(editor)` |
| `src/features/editor/lakeRuntime.ts` | `createLakeDocument` 传 `toc: { enable: tocEnabled }`；`setupTocScrollFollow`、`refreshTocSidebar`、`resolveScrollNode` 都在这里 |
| `src/styles.css` | `.lake-editor-tab` 高度链（overflow:hidden 外壳 + mount/.ne-editor height:100% → `.ne-editor-wrap` 内部滚动） |

### 2.2 我们对 Lake 原生 TOC 的改动（全部在应用层，未改 node_modules）

1. **`createLakeDocument`**（lakeRuntime.ts）：
   - `toc: { enable: tocEnabled }` 透传（原生编辑 TOC 开关）。
   - 虚拟渲染开启：`virtualRendering: true`、`scrollNode: () => resolveScrollNode(...)`、`cardLazyInit: true`。
2. **`resolveScrollNode`**：桌面多标签把滚动容器解析为 `.ne-editor-wrap`（原生 `editor.scrollNode` 的回退是
   `document.scrollingElement`，在 body overflow:hidden 下会拿错，导致虚拟渲染视口测量/大纲定位全错）。
3. **`setupTocScrollFollow`**（原生 TOC 的补丁）：
   - 轮询 `host.querySelector(".ne-toc-sidebar")`（≤20 次 × 250ms）找侧栏；
   - 滚动时 80/250/500ms 三次延迟重算高亮 + `tileRenderCompleted`/`generalRenderCompleted` 后重算；
   - 给 `.ne-toc-item` 直接加/删 `ne-toc-selected` class；
   - 复刻 Lake `_makeVisible` 的「选中项滚到大纲可视区居中」逻辑；
   - 点击后 50/200ms 两次 `correctScrollTo` 校正（懒卡片占位高度导致首次定位偏移）；
   - contentchange 后 120/600/1500ms 做卡片水合 + 刷新高亮。
4. **`refreshTocSidebar`**：`setDocument` 后重放 `kernel.emitPluginEvent("tocChange", tocData)`，
   轮询重试直到当前 host 内出现 `.ne-toc-item`（≤8 次，200ms 起、封顶 500ms）。

> 这些补丁是「把原生能力修到能用的程度」，不是「自有大纲」。它们全部耦合在原生 `.ne-toc-sidebar` 的
> DOM/状态机之上，这正是「不好改、经常坏」的结构性原因。

---

## 3. Lake 原生 TOC 机制研究（node_modules 反编译，行号基于 0.1.2 es.js）

### 3.1 三层结构

| 层 | 代码 | 职责 |
| --- | --- | --- |
| 内核 TOC 管理器 | `MA`（PluginName `toc`，**无 PluginOption，永远启用**） | 监听 `nodechange`/`aftercontentchange`，维护 `_tocNodes`（标题节点有序表），产出扁平 toc 数据，`setDocExtraContent({toc})`，emit `tocChange` |
| 编辑器插件 | `ZY`（PluginOption `aWe`，OptionName `toc`） | `option.isEnabled()` 时才创建原生编辑侧栏（`qY`）；订阅 `tocChange`（**debounce 1000ms，leading）** 更新侧栏 |
| 阅读器插件 | `o8`（PluginOption `R3e`） | `option.enable` 时创建 `.ne-viewer-toc-sidebar`；订阅 `tocChange`（**无 debounce，立即**）；`toc` 数据为空时销毁侧栏 |

### 3.2 数据链路（编辑模式）

```
setDocument(text/lake, content)
  └─ 模型解析/渲染（虚拟渲染下异步分片，大文档慢）
      └─ nodechange（标题节点 insert）→ Set 收集
          └─ aftercontentchange → MA._refresh()
              ├─ _updateKernelTocData() → kernel.setDocExtraContent({ toc })  ← 数据就绪点
              └─ kernel.emitPluginEvent("tocChange", toc)
                  ├─ ZY: debounce(1000, leading)(sidebar.update(toc))   ← 原生侧栏重渲染
                  └─ o8（仅阅读模式）: sidebar.update(toc) 立即
```

- toc 条目形状（MA.getToc）：`{ type: "h1".."h6", id, text, level(1-6), depth(压缩后的 1..N) }`。
  文本来自标题节点文本 + 前缀（`service.prefix`）；罗马数字前缀特殊处理。
- 侧栏挂载：编辑模式 `.ne-toc-sidebar` 挂在 `editorWrapNode.parentNode`（即 `.ne-editor-body`）内，
  CSS `position:absolute; top:0; bottom:0; right:0`；`.ne-toc-visible` 加到 `.ne-editor` 上才 `display:flex`。
  阅读模式 `.ne-viewer-toc-sidebar` 挂在 `getContainer() || viewer.domRootNode`，CSS `position:fixed; top:60px`。
- 侧栏视图 `GY`：React 组件；`componentDidMount` 建 watcher；`rerender({toc})` → forceUpdate 全量重建列表；
  折叠状态在组件实例字段 `_collapsedMap`（按 id），重渲染不丢；选中状态在 `this.state.selected`，
  由 watcher 回调 `_reset` 设置（虚拟渲染下 watcher 二分探测视口外标题无 DOM → 恒 -1 → 永不 setState）。
- watcher `TWe`：二分 + `contentNode.querySelector([id=...])` + `getBoundingClientRect`；
  滚动事件 debounce 300ms 后 `_check()`。
- 点击定位：GY item onClick → `n(id)` → qY emit `tocPositionChange` → 编辑器 emitPluginEvent →
  heading 插件 `execCommand("headingUnfold", id)`；qY `_scrollTo` → `renderer.scrollByNodeId(id)` + 哈希 + 滚动校正。
- 宽度/pin 状态：`YY.check` 按宽度 905px 阈值切 normal/small 视图，pin 状态存 `localStorage["ne_lakex_user_toc_pin_local_store_key"]`（全局共享）。

### 3.3 关键机制结论

1. **内核 toc 数据与事件不依赖 `toc.enable`**：MA 无 PluginOption，永远运行。`toc: { enable: false }`
   只关掉**编辑侧栏 UI**（ZY.afterInit 的 `isEnabled()` 分支），内核仍会 `setDocExtraContent` + emit `tocChange`。
   → 这是「禁用原生侧栏、自建大纲」方案的数据基础。
2. **`disabledPlugins: ["toc"]` 会连内核管理器一起禁用**（kernel.ts 按 PluginName 过滤，MA 的 PluginName 也是 `toc`），
   那样 `getDocExtraContent().toc` 与 `tocChange` 全都没了。**禁止用 disabledPlugins 关 TOC。**
3. 编辑侧栏的 `tocChange` 处理带 1000ms debounce（leading，首次立即触发），阅读侧栏无 debounce。
4. 编辑侧栏创建时 `toc: []`，只在 `document.create` 时 open；数据要等内核 `aftercontentchange` 计算完成。
5. 虚拟渲染下原生 watcher 的 DOM 二分探测失效（视口外标题无 DOM），这是现有 `setupTocScrollFollow` 存在的原因；
   但它直接改 DOM class，绕过了 React state，一旦原生 rerender 就把高亮冲掉（编辑后高亮闪烁/丢失的主因之一）。
6. 原生侧栏是 absolute/fixed 定位 + 全局 localStorage pin 状态 + 单页 viewport 假设，与多标签/隐藏 tab 本质不匹配。

---

## 4. 两个问题的根因分析

### 4.1 打开文档大纲延迟 ~3s + 卡顿

| 因素 | 说明 | 权重 |
| --- | --- | --- |
| 内核 toc 计算时机 | toc 数据在 `setDocument` → `aftercontentchange` 后才算；大文档 + 虚拟渲染下这步是主要耗时 | 高 |
| 编辑侧栏先空后填 | 侧栏创建时 `toc: []`，只能等 tocChange；我们的 `refreshTocSidebar` 轮询只是等待数据就绪 | 中 |
| 原生侧栏全量重渲染 | 每次 tocChange → `rerender({toc})` → 全列表 forceUpdate，大文档主线程卡顿 | 中 |
| 我们的滚动补丁叠加 | 每次滚动 80/250/500ms 三次重算 + MutationObserver + contentchange 重试，事件频繁时开销累积 | 中 |
| 隐藏 tab 空跑 | `display:none` 的 tab 定时器/observer 仍执行（getBoundingClientRect=0） | 低 |

> 说明：编辑侧栏 tocChange 的 debounce 是 **leading（首次立即执行）**，所以重放 `tocChange` 会立即更新侧栏，
> 3s 不是 debounce 本身造成的，而是「内核 toc 就绪时刻」本身较晚。Phase 1 需埋点验证各段耗时占比。

### 4.2 各类修改大纲频繁出问题

| 故障 | 根因 |
| --- | --- |
| 编辑后高亮丢失/闪烁 | 我们直接改 `.ne-toc-item` 的 class；原生 rerender 用自己 `state.selected`（虚拟渲染下恒 null）重建 → 高亮被冲掉；MutationObserver 重放存在时序差 |
| 标题增删后残留旧高亮 | `activeId` 指向已删除节点；apply 时旧 id 无对应 item |
| 折叠/展开状态不可控 | `_collapsedMap` 是原生组件内部字段，我们无法从外部稳定读写/持久化 |
| 长文档滚动高亮漏算 | 当前小节标题不在视口（未渲染）时，DOM 探测拿不到，靠 80/250/500ms 重试缓解但不彻底 |
| 多 tab 状态串扰 | pin/宽度状态在 `localStorage` 全局共享；隐藏 tab 高度/宽度为 0，原生布局逻辑按单页 viewport 假设运行 |
| 布局跳动/侧栏坍缩 | 原生 absolute 侧栏 + 高度链 + 隐藏 tab 的组合（交接文档已记录的两个矛盾现象） |

---

## 5. 与开源 lake-main 的对比

- `lake-main` = lakelib 0.4.6（MIT 开源版）。源码树中 **没有 TOC/大纲实现**（grep `toc|Toc|outline` 仅命中
  CSS `outline` 属性）。其 `index.ts` 注册的插件列表里没有 toc 插件。
- 我们用的 `lakex-editor-react-component` 0.1.2 是语雀内部 lakex-doc 的 ESM 打包（`Doc.createOpenEditor/createOpenViewer`），
  TOC 是其内部新增能力。
- 结论：**TOC 机制只能以 node_modules 打包产物为权威参考**；lake-main 对 TOC 无参考价值
  （与 `docs/REFERENCE-REVIEW-2026-08-03.md` 的既有结论一致：迁移到 0.4.x 成本巨大、近期不推荐）。

---

## 6. 目标架构：应用自建大纲（P1 推荐方案）

### 6.1 设计原则

- **数据与渲染分离**：数据源用内核 `tocChange` / `getDocExtraContent().toc`（稳定、非私有字段级别）；
  渲染完全由应用拥有。
- **每 tab 一个 `OutlineController`**：输入 = toc 数据 + 滚动位置 + 可见性；输出 = 条目列表、选中项、展开集合；
  生命周期与 `EditorTab` 绑定，关闭即 dispose，隐藏时停 observer/定时器。
- **不依赖原生 `.ne-toc-sidebar`**：编辑器模式 `toc: { enable: false }` 关闭原生侧栏，自建侧栏布局在
  tab panel 内（docked 右栏或浮层，先做 docked）。
- **点击定位**：`renderer.execCommand("headingUnfold", id)`（折叠标题先展开）+ `renderer.scrollByNodeId(id)`
  + 应用侧滚动校正（沿用现有 correctScrollTo 思路，但收敛到单次 rAF + 落位校正）。
- **滚动高亮**：rAF 节流 + 只遍历「已渲染」标题（虚拟渲染下当前小节标题通常在视口附近 → 可探测）；
  选中 id 存于 state（而非 DOM class），渲染时由我们自己同步 class，重渲染不丢高亮。
- **编辑更新**：订阅 `kernel.onPluginEvent("tocChange")`（立即，绕过原生 1s debounce），
  增量更新（按 id diff），保留折叠集合，不整表重建。

### 6.2 模块划分（新建文件，尽量不动 lakeRuntime 核心路径）

```
src/features/outline/
  OutlineController.ts      # 状态机：toc 数据 → 树/扁平列表、选中、展开、事件
  OutlinePanel.tsx          # 自渲染侧栏（条目、级别缩进、子弹线、选中高亮、点击）
  useOutline.ts             # EditorTab 内的 React 接入（订阅/清理/可见性控制）
  outline.css               # 侧栏样式（可用 CSS 变量适配主题）
```

- `lakeRuntime.ts` 仅做小改：编辑模式 `toc: { enable: false }`；移除 `refreshTocSidebar`/`setupTocScrollFollow`
  对原生侧栏的依赖（或保留函数但不再调用）。
- `EditorTab.tsx` 挂载 `OutlinePanel`；`MultiTabEditor` 布局改为「编辑器 + 侧栏」双栏。

### 6.3 分阶段落地

- **Phase 1（机制验证 + 最小可用）**：自建 controller + 原生观感侧栏（先不做子弹线）；禁用原生编辑侧栏；
  埋点验证：`setDocument` 结束 → 内核 toc 就绪 → tocChange → 侧栏首帧的各段耗时；真机验收：
  打开长文档、新建文档、首屏有/无标题、标题增删、撤销/重做、双 tab 切换、关闭 tab、滚动高亮、点击定位。
- **Phase 2（自定义能力）**：子弹线（沿用现有 `ne-toc-content:after` 竖线的可控实现）、级别缩进/小圆点、
  选中项滚动跟随（列表内居中）、平滑滚动（scrollTo behavior）、折叠/展开持久化（按 noteId 存 localStorage 或内存）。
- **Phase 3（只读锁前置评估）**：大纲稳定后，再看只读锁是否需要 Editor↔Viewer 重建、是否有稳定动态只读 API；
  届时大纲已与应用 UI 解耦，锁定时大纲可继续用同一套。

### 6.4 风险与约束

- **不改 node_modules / Lake 源码**；所有适配留在应用层。
- **禁止全局 `document.querySelector` 操作大纲**；一切以当前 tab host 为边界（沿用审计 #15 的结论）。
- **`disabledPlugins: ["toc"]` 会连内核数据一起禁用，禁止使用**；只用 `toc: { enable: false }`。
- 虚拟渲染下「视口外标题无 DOM」是硬约束：滚动高亮必须容忍「当前小节标题未渲染」，用重算策略兜底；
  不自建「所有标题的绝对位置表」除非验证其成本可接受。
- `setDocument` 期间会触发 contentchange，`setting` 标志不能删。
- 清理开发数据只允许删 `/Users/admin/Library/Application Support/lake-notes-dev`；正式目录不动。
- Electron 验证遵循 `docs/CODEX-GUIDE.md`；不用 `pkill -f Electron`。
- 原生编辑 TOC 被禁用后，`tocPositionChange`（heading 折叠展开联动）等事件路径需我们自己补：
  点击时显式 `renderer.execCommand("headingUnfold", id)`。

---

## 7. 验证清单（Phase 1 真机验收）

1. 打开含大量标题/图片/卡片的长文档：记录「窗口可交互 → 大纲条目可见」耗时，目标显著优于当前 ~3s。
2. 新建空文档：无标题时不显示空占位或显示友好占位，不报错。
3. 标题增删/改文字：大纲条目即时更新，折叠集合保留，选中高亮不闪跳。
4. 撤销/重做标题操作：大纲与文档一致。
5. 双 tab 同时打开不同文档：切换 tab 大纲内容/高亮/滚动位置各自独立；关闭 tab 完全 dispose。
6. 隐藏 tab 期间不产生额外定时器/observer 开销（可用 performance 计数对比）。
7. 点击大纲条目：折叠标题先展开再定位，定位偏差 ≤ 2px（懒卡片水合后校正）。
8. 滚动：选中高亮跟随，回顶高亮第一个标题，长列表选中项滚入可视区。
9. 深色模式/字号设置切换后样式正常。
10. `npm test`、`npx tsc --noEmit`、`vite build`、`git diff --check` 全部通过。
