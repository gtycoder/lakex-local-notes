# LAKEX-CONTRACT.md — 闭源 lakex 内核：行为契约 + 调试速查表（会话必读）

> **本文件是给"所有会话"的知识库**：把我们对**闭源 lakex 内核**（`lakex-editor-react-component@0.1.2`，即语雀 `@alipay/lakex-doc` 打包品）
> 通过实测 + 反编译**已经观测到的行为**固化成：① 结构化的接口契约（设计为 `lakex-contract.d.ts`，待落地）；② 一张报错定位速查表。
> **什么时候看本文件**：只要会话涉及 lakex 编辑器——遇到内核报错、命令点了没反应（no-op）、DOM/CSS 不对、
> 要新加编辑器能力、要改 `src/features/editor/**` ——先查本文件，再动手。

---

## 0. 一句话定位

- 不是给 lakex 补文档（lakex 文件一个字节都不动）；是给**我们自己的代码**补一份"我们观测到的、可依赖的接口契约"。
- 目的是把散落在 `lakeRuntime.ts` 等文件注释里的反编译结论，收敛成一处可被类型系统检查的"总账"，降低黑盒导致的静默失败。
- 本文件 = 该契约的设计稿 + 维护守则 + 调试速查表；落地产物 = 新增 `src/features/editor/lakex-contract.d.ts` + 替换 `as any`（待办，见 HANDOFF §3.9）。

---

## 1. 背景与动机（为什么值得做）

- 260908 内核替换评估（工作区根 `lake-kernel-swap-analysis-260908.md`）的核心反直觉发现：
  vendored "闭源" bundle **未加密、未压缩、字符串/方法名/断言里的源码路径全保留**（es.js 33.8 万行，
  模块注释带真实 monorepo 路径，如 `framework/kernel/src/model/selection/position.ts:44`；命令/文案/i18n 全明文）。
- 因此"很多问题查不到"的真因排序是：**1) 内核无类型（d.ts 仅 9 行 any）→ 全凭试错；2) 体量大（约 49 个插件包）无入口文档；3) 行为契约（事件负载/卡数据形状）不公开**。
- 结论：这些痛点**不依赖换核即可缓解**——本文件就是缓解手段。换核判断与差距矩阵见评估文档 §4/§9，本文件不重复。
- 方法论对齐：项目既定原则 = 先实测拿数据，再反编译 dist 确认机制（见 docs/PROGRESS.md 方法论节）。本文件只收录**有证据**的观测。

---

## 2. 关键事实速览（已核实，供快速上下文）

| 事实 | 内容 | 证据位置 |
|---|---|---|
| 内核身份 | 语雀商业内核 `@alipay/lakex-doc`，打包为自包含 ESM；无类型、无反编译加密 | vendor dist/components/lakex/lakex.d.ts（自白） |
| bundle 位置 | `vendor/npm/lakex-editor-react-component/dist/lakex-editor-react-component.es.js`（12.5MB / 33.8 万行，未压缩）+ cjs 压缩版 | vendor 目录 |
| 版本线索 | 内核特性标注 1.6.0+/1.7.0+/1.34.0+；katex 0.16.8；lake-codemirror 7.1.3；antd 4.24.13（css 版权 Alipay） | dist types.d.ts、bundle 常量 |
| 外部运行时 | 引擎按需注入 gw.alipayobjects.com 的 katex/mhchem + CodeMirror；**应用已本地镜像并用 cdnRedirect 重写** | lakeRuntime.ts L12-34/582-591；electron/cdnRedirect.ts |
| 序列化方言 | setDocument/getDocument MIME：text/lake（=落盘格式，`<card … value="data:JSON">` + `data-lake-id`/`ne-*` 类）、text/html、text/plain、text/markdown、json | 真实 .lake 样本；lakeRuntime.ts L36-39 |
| DOM 协议 | `ne-*` 类族（滚动容器 .ne-editor-wrap/.ne-viewer、卡片 .ne-card、.ne-toc-*、.ne-codeblock 等）；应用 src 已有 119 个不同 ne-* token | 应用 src + styles.css |
| 血统关系 | lakex 与开源 lakelib（lake-main，MIT 0.4.6）同 Lake 血统但不同代；**序列化已分叉**（lakex `<card>` vs lakelib `<lake-box>`），不可直接互换 | 评估文档 §2.3/§5 |
| 主题 | 注入 `.lakex-default-theme`（亮）/ `lakex-dark-theme-dark`（暗）变量 | PROGRESS.md 暗色模式坑 |

---

## 3. 与既有文档/红线的关系

- **AGENTS.md §3.8 / HANDOFF §3.8（Lake 内核策略）**：A 用开源 lakejs(lakelib) 源码当"机制字典"（它只是参照系，不是本运行内核）；B 版本锚点 + 最小 hack，不整体 fork。本文件是"我们自己运行的内核(lakex)的知识库"，与机制字典互补。
- **docs/PROGRESS.md 方法论节（L366-385）**：先复现拿数据 → 反编译确认机制 → 再改。新观测回填本文件时按此流程。
- **docs/TROUBLESHOOTING.md**：踩坑案例；本文件记录的是"机制/契约"层，坑是表现层，互不替代。
- **红线提醒**：本文件及其契约**只新增应用侧声明**，不改 vendor、不 patch 内核本体（除既有最小 hack 模式外）、不复制大段 bundle 源码进仓库。

---

## 4. 契约文件设计（lakex-contract.d.ts，待落地）

### 4.1 形态与放置
- 落地：新增 `src/features/editor/lakex-contract.d.ts`（纯声明，无实现）；引用处把 `(editor as any)` / `editor ?? {} as unknown as …` 换成契约类型。
- 已存在的基础：`lakeRuntime.ts` L36-70 的 `LakeEditorInstance`/`LakeKernelBridge` 就是雏形，契约文件是把它**展开成完整版**并收敛所有调用点。
- 约定：接口名以 `Lakex*` 为前缀，避免与 lakeRuntime 现有类型撞名；每个声明下方用注释标"证据来源"（反编译位置/实测记录）。

### 4.2 内容清单（把下列每项从注释/反编译落成类型）

1. **实例 API**：setDocument/getDocument(type 枚举)/on/off/destroy/requestCardHydration/内部挂载点 `__disposeExtras`/`__disposeBookmarkDegrade`。
2. **工厂与配置**：`Doc.createOpenEditor(container, options)` / `createOpenViewer(...)`；`DefaultEditorConfig` 深合并语义；
   应用覆写过的 key（每 key 给类型）：disabledPlugins、bookmark.fetchDetailHandler、input、defaultFontsize、toc.enable、codeblock.codemirrorURL、
   math.KaTexURL、image/file/video/audio 的 createUploadPromise、slash.cardSelect、customCard.cards、virtualRendering、scrollNode、cardLazyInit。
3. **命令签名表（renderer.execCommand）**：把 editorCommands.ts 注册表 + 各处调用落成联合签名；
   bold/italic/underline/code/quote/unorderedList/orderedList/taskList/hr/undo/redo/style(p|h1..h6)/
   focus/table{rows,columns}/insertFiles(files,{category,from})/insertCard(codeblock)/headingUnfold(id)/scrollByNodeId(id)/cardToLink(id,src,title)。
4. **no-op 黑名单（已知命令名无效，勿用）**：insertUnorderedList/formatBlock/heading/setHeading/insertBulletList/strike/strikethrough/justify*/clearFormat/fontsize 等（editorCommands.ts 注释 + 单测固化）。
5. **事件与负载**：editor.on contentchange / monitorLog；renderer.on tileRenderCompleted / generalRenderCompleted；
   editing.on beforeExecCommand（{commandName,args}，可改 args 重定向）；kernel.onPluginEvent tocChange + emitPluginEvent(tocChange) 回放；
   kernel.getDocExtraContent().toc（扁平 {id,text,level,depth,type}）。
   **编辑 TOC 侧栏**：对 `tocChange` 的订阅是 1s 节流（bundle `cI()(fn, 1e3)`）；侧栏实例在 toc 插件
   `afterInit` 创建，可从 `editor._plugins[*]._tocSidebar` 取到，`update(toc)` 可绕过节流（详见 §5.1）。
6. **卡数据私有形状（反编译所得，最强耦合区）**：`ne-card[data-card-name]` 的 DOM；
   card._neRef._virtualNode._instance.cardData / _cardData 的 getSrc/getDetail/getCardValue（bookmark）；getAudioInfo/setAudioInfo/onTranscodeSuccess（audio）；
   _virtualNode.$appear()/isAppear（手动水合）；_$cardUI.uiViewProxy.rerender；React fiber `__reactFiber$` cardData（附件点击）。
7. **DOM/CSS 协议常量**：滚动容器 .ne-editor-wrap/.ne-viewer；挂载类 .lake-editor-mount.ne-doc-major-editor；
   卡内类 .ne-card-*、.ne-table-wrap/.ne-table-hole/.ne-alert-hole/.ne-container-hole；.ne-toc-*；代码块坏块判定 .ne-codeblock；主题类 .lakex-default-theme/.lakex-dark-theme-dark。
8. **上传回调形状**：image/file/video/audio 的 createUploadPromise 返回 {url, audioId?, filesize?, …}（适配 lakex handleUploadSuccess 读 video_id/audioId 的约束）。

> 落地时每加一类先跑门禁：tsc 0 error；并保证调用点从 any 收紧后行为不变（纯类型改动，不改逻辑）。

---

## 5. 调试速查表（初稿，按证据填充）

> 用法：lakex 抛错或行为异常时，先按**报错/现象**查本表；命中 → 看"已知坑与对策"与"应用锚点"；未命中 → 按 §6 流程新增一行。

| 现象 / 报错里的定位串 | 所属模块 | 已知坑与对策 | 应用锚点 |
|---|---|---|---|
| 断言串含 framework/kernel/src/model/selection/position.ts | 选区模型 | to-dom-range 断言：未连接节点会抛；编辑大文档/跨节点操作易触发 | EditorTab.tsx L622-624 注释 |
| 断言串含 kernel/src/data-source-manager.ts | 数据源管理 | 卡/数据源注册类缺失时 getCardClass 返回 null 直接崩 | lakeRuntime.ts bookmark hack（L567-578） |
| 命令点了没反应（no-op） | 命令表 | 命令名写错/焦点丢失：见 §4.4 no-op 黑名单；先 queryCommandEnabled 再 exec | editorCommands.ts、移动 dock EditorDock.tsx |
| bookmark 卡粘贴后是死卡 | bookmark 插件 | 需给 fetchDetailHandler 注册卡类；无 detail 时 cardToLink 降级为链接 | lakeRuntime.ts L454-538、bookmark 降级 |
| 卡片不水合、停空壳 | 可见性观察器 | hole 上 $appear 不传播到卡 UI；调 card._neRef._virtualNode.$appear() | lakeRuntime.ts ensureCardsInViewHydrated L822-835 |
| 新插入代码块不渲染/找不到 .cm-editor | codeblock | CodeMirror 脚本未就绪（window.CodeMirror 缺失）；检查本地镜像注入与 loaded/error 协议 | lakeRuntime.ts L582-586、预注入 L21-34 |
| math 卡无公式渲染 | math | window.katex 未就绪；需先注入本地 katex+mhchem（async=false 保序） | lakeRuntime.ts L12-34、L587-591 |
| mindmap viewer 报 reading theme of undefined | mindmap 卡 | viewer 不注入 editor prop；注册边界补最小 editor.theme 兼容层 | lakeRuntime.ts prepareCustomCards L135-156 |
| 附件/媒体点击无反应 | file/audio/video 卡 | 卡数据在 React fiber cardData；.ne-card-file DOM 变化会破坏挂接 | attachmentPreviewController.ts L70-177 |
| 虚拟渲染下滚动/TOC 错位 | viewport 虚拟渲染 | 原生 TOC watcher 在虚拟渲染失效；用 kernel toc 数据 + 自研 DOM 定位/高亮 | lakeRuntime.ts L1142-1262、useOutline.ts |
| 打开文档原生大纲为空 / 迟 ~3s 才出现 | 编辑器 TOC 侧栏 | 侧栏以空 toc 创建；插件对 `tocChange` 是 1s 节流，内核在侧栏挂载前先 emit 消耗 leading；对策：等 `.ne-toc-view` 挂载后直接 `_tocSidebar.update(toc)` 绕过节流，回退 emit。详见 §5.1 | lakeRuntime.ts `refreshTocSidebar` / `findNativeTocSidebar`、EditorTab.tsx |
| 保存的文档里图片丢失/不完整 | 虚拟渲染 + 保存 | setDocument 后未等渲染完成就 getDocument 会丢内容；大文档注意 tile 完成事件 | lakeRuntime.ts 注释 L271-367/736 |
| 点击表情/公式框后编辑器失焦折叠 | unicode-emoji / math 卡 | mousedown 默认行为抢焦点；捕获阶段 preventDefault | LakeEditor.tsx preventCardBlur L63-70 |
| 编辑器整体变空/GPU 崩疑似 | React hooks | hooks 放早退 return 之后会卸载整树；检查 if(!open) return null 后是否还有 hooks | HANDOFF §4 渲染坑、SettingsPanel |

### 5.1 原生编辑 TOC 侧栏：填充时序与正确接法（2026-09-11 实测）

- **组件与实例**：编辑器 toc 插件（PluginOption `toc`）在 `afterInit` 创建侧栏实例
  `this._tocSidebar = ao(qY, [editorWrapNode.parentNode, editor, renderer, option])`，监听 `document.create` 后 `open()`。
  DOM：`.ne-toc-sidebar > .ne-toc-view`，条目 `.ne-toc-item`（内含 `<a href="#节点id">`）。
- **坑 1（打开为空）**：侧栏初始以空 toc 渲染（`jI.render(GY, {toc: []})`）。内核 TOC 管理器在文档解析后 emit
  `tocChange`；若侧栏挂载晚于该 emit，侧栏**永远为空**（"关闭软件再进来大纲不渲染"）。必须在 `setDocument` 后主动补数据。
- **坑 2（迟 ~1s）**：插件用 `kernel.onPluginEvent("tocChange", cI()(fn, 1e3))` 订阅（≈1s 节流/去抖）。内核会在侧栏组件
  挂载**之前**先 emit 一次 `tocChange`，白白消耗 leading 边沿 → 仅靠事件重放要再等一个 1s 窗口，实测大纲晚 ~1.3s
  （~3.0–3.3s 才出现）。
- **正确接法（应用层最小 hack）**：等 `.ne-toc-sidebar .ne-toc-view` 挂载后，从 `editor._plugins`（数组/Map/对象）
  找到带 `_tocSidebar.update` 的插件，直接 `_tocSidebar.update(kernel.getDocExtraContent().toc)`。绕过节流，
  实测条目 ~90ms 出现（整体 ~1.9–2.0s，剩余为编辑器创建耗时）；找不到实例时回退 `kernel.emitPluginEvent("tocChange", toc)`。
  收敛轮询固定 120ms × ≤40 次；销毁时清定时器。
- **反例**：`sidebarVisibleChange(false) → _tocSidebar.refresh()` **不能填空白侧栏**（实测触发后仍等 ~1.3s 才出现），别用它救场。
- **`scrollNode` 必须下发（与虚拟渲染解耦）**：`body overflow:hidden` 时 Lake 默认回退 `document.scrollingElement||document.body`
  会拿错，原生 TOC 定位/测量错乱（TROUBLESHOOTING #26）。移动端 `disableVirtualRendering=true`（无内部滚动容器）不传。
- **与虚拟渲染的关系**：原生 TOC 的**列表**来自内核 toc 数据（与 DOM 无关）；但**高亮/跟随** watcher 用二分
  `querySelector('[id=…]')` 探测标题（bundle `TWe._checkIndex`），虚拟渲染下视口外标题无 DOM → 永不选中，故开启虚拟渲染时
  仍需应用侧 `setupTocScrollFollow`。关闭虚拟渲染则原生 watcher 可用。
- **点击定位**：条目是 `<a href="#id">`，hash 导航能正确滚动内层 `.ne-editor-wrap`。
  （注意：CDP `Input.dispatchMouseEvent` 在本机 Electron 渲染进程收不到，无法用合成点击验证。）
- **应用现状**：桌面**始终创建**原生侧栏（`EditorTab` 不再传 `disableNativeToc`），`refreshTocSidebar` 照常填充；
  `outlineEnhance=false`（默认）→ 显示原生侧栏；`true` → `EditorTab` 给 host 加 `native-toc-hidden` 类，
  CSS `.lake-editor-tab.native-toc-hidden .ne-toc-sidebar{display:none}` 隐藏原生 + 显示应用自建大纲。
  运行中切换开关只切 class、不重建编辑器（大文档重建会重渲染 + 丢滚动），且原生侧栏一直保持填充，
  切回原生即时可见。移动端恒用应用大纲面板。

---

## 6. 使用守则（所有会话遵守）

1. **动手前查**：改 `src/features/editor/**`、移动端 `src/mobile/editor/**`、或涉及编辑器内核行为前，先读 §2/§4/§5。
2. **报错先查表**：lakex 抛错 / 命令 no-op / DOM 不符 → 先查 §5；查不到再做新定位。
3. **新观测必须回填**（防止知识再次散落）：定位到新行为后，按 §6.5 的流程更新本文件对应小节，并在可写会话补 `lakex-contract.d.ts` 的类型；回填时写证据（bundle 位置/断言串/复现步骤）。
4. **反编译定位的标准姿势**（PROGRESS 方法论）：CDP/页面内实测复现 → 在 `vendor/.../dist/lakex-editor-react-component.es.js` 用字符串 grep 定位（未加密，类名/路径/文案可搜）→ 对照断言里的源码路径 → 得出结论再改代码。
5. **不要做**：不要给 vendor 内核打补丁（除既有最小 hack 模式，且需注释 + 记录）；不要复制大段 bundle 源码进仓库；不要在本文件写易过期事实（版本号/计数/分支放 HANDOFF §0）。
6. **契约 vs 机制字典分工**：查"这个能力 lakex 有没有/长什么样"用本文件；查"lake 系内核理论上怎么实现/有哪些插件命令"用 lake-main（开源 lakelib 源码）当字典；两者方言已分叉，勿混用结论。

---

## 7. 待落地任务与关联实验

- **任务 T1（待办，HANDOFF §3.9）**：新增 `src/features/editor/lakex-contract.d.ts`（§4 清单），替换 lakeRuntime 等处的 `as any`，纯类型改动 + 门禁全绿。
- **实验 E1/E2（换核决策前置）**：真实 .lake ↔ lakelib 双向解析；lakelib 大文档渲染。详见工作区根 `lake-kernel-swap-analysis-260908.md` §9。
- 本文件由 260908 只读评估生成；落地/回填后在此追加更新日志（一行一条，勿删历史）。
- 2026-09-11：新增 §5.1（原生编辑 TOC 侧栏填充时序：空 toc 创建 + 1s 节流 + 直接 `_tocSidebar.update` 绕过节流），§4.2/§5 表补对应条目。来源：HANDOFF §2.15–2.16、lakeRuntime.ts `refreshTocSidebar`/`findNativeTocSidebar`。

---

## 8. 证据来源与复查方法

- bundle：`vendor/npm/lakex-editor-react-component/dist/lakex-editor-react-component.es.js`（grep 类名/路径/断言串采样即可，勿整读）。
- 类型/README：同目录 dist/components/lakex/*.d.ts（含 9 行 lakex.d.ts 自白）、dist/index.d.ts、README.md、LICENSE。
- 应用锚点：`src/features/editor/lakeRuntime.ts`（实例化 540-815、私有字段 466-905、命令 454-538）、`EditorTab.tsx`、`LakeEditor.tsx`、`editorCommands.ts`、`BoardCard.tsx`、`mediaCardRouting.ts`、`attachmentPreviewController.ts`。
- 镜像/注入：`public/vendor/cdn/**`、`electron/cdnRedirect.ts`、`electron/assetServer.ts`。
- 评估全文档：工作区根 `lake-kernel-swap-analysis-260908.md`（差距矩阵/换核结论/许可观察）。