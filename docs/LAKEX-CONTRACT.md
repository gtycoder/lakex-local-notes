# LAKEX-CONTRACT.md — 闭源 lakex 内核：行为契约 + 调试速查表（会话必读）

> **本文件是给"所有会话"的知识库**：把我们对**闭源 lakex 内核**（vendor `@dlient/lakex-doc-react` 源码里转换出的内核 bundle，即语雀 `@alipay/lakex-doc` 打包品；2026-09-16 起内核 **v1.99.0**）
> 通过实测 + 反编译**已经观测到的行为**固化成：① 结构化的接口契约（设计为 `lakex-contract.d.ts`，待落地）；② 一张报错定位速查表。
> **什么时候看本文件**：只要会话涉及 lakex 编辑器——遇到内核报错、命令点了没反应（no-op）、DOM/CSS 不对、
> 要新加编辑器能力、要改 `src/features/editor/**` ——先查本文件，再动手。

---

## 0. 一句话定位

- 不是给 lakex 补文档（lakex 文件一个字节都不动）；是给**我们自己的代码**补一份"我们观测到的、可依赖的接口契约"。
- 目的是把散落在 `lakeRuntime.ts` 等文件注释里的反编译结论，收敛成一处可被类型系统检查的"总账"，降低黑盒导致的静默失败。
- 本文件 = 该契约的设计稿 + 维护守则 + 调试速查表；落地产物 = 新增 `src/features/editor/lakex-contract.d.ts` + 替换 `as any`（待办，见 HANDOFF §3 技术债）。

---

## 1. 背景与动机（为什么值得做）

- 260908 内核替换评估（工作区根 `lake-kernel-swap-analysis-260908.md`）的核心反直觉发现：
  vendored "闭源" bundle **未加密、未压缩、字符串/方法名/断言里的源码路径全保留**（es.js 33.8 万行，
  模块注释带真实 monorepo 路径，如 `framework/kernel/src/model/selection/position.ts:44`；命令/文案/i18n 全明文）。
- 因此"很多问题查不到"的真因排序是：**1) 内核无类型（d.ts 仅 9 行 any）→ 全凭试错；2) 体量大（约 49 个插件包）无入口文档；3) 行为契约（事件负载/卡数据形状）不公开**。
- 结论：这些痛点**不依赖换核即可缓解**——本文件就是缓解手段。换核判断与差距矩阵见评估文档 §4/§9，本文件不重复。
- 方法论对齐：项目既定原则 = 先实测拿数据，再反编译 dist 确认机制。本文件只收录**有证据**的观测。

---

## 2. 关键事实速览（已核实，供快速上下文）

| 事实 | 内容 | 证据位置 |
|---|---|---|
| 内核身份 | 语雀商业内核 `@alipay/lakex-doc`，打包为自包含 ESM；无类型、无反编译加密 | `vendor/lakex-doc-react/src/components/lakex/lakex.d.ts`（自白） |
| bundle 位置 | `vendor/lakex-doc-react/src/components/lakex/lakex.js`（内核 ESM 转换产物，未压缩）+ 同目录 `doc.umd.js`（原始 UMD） | vendor 目录 |
| 版本线索 | 内核 **v1.99.0**（`lakex.js` 头部自证；与 `@lakex-react/core@0.2.1` 内核指纹一致）；特性标注 1.6.0+/1.7.0+/1.34.0+；katex 0.16.8；lake-codemirror 7.1.3；antd 4.24.13（css 版权 Alipay） | `lakex.js` 头部、dist types.d.ts |
| 外部运行时 | 引擎按需注入 gw.alipayobjects.com 的 katex/mhchem + CodeMirror；**应用已本地镜像并用 cdnRedirect 重写** | lakeRuntime.ts L12-34/582-591；electron/cdnRedirect.ts |
| 序列化方言 | setDocument/getDocument MIME：text/lake（=落盘格式，`<card … value="data:JSON">` + `data-lake-id`/`ne-*` 类）、text/html、text/plain、text/markdown、json | 真实 .lake 样本；lakeRuntime.ts L36-39 |
| DOM 协议 | `ne-*` 类族（滚动容器 .ne-editor-wrap/.ne-viewer、卡片 .ne-card、.ne-toc-*、.ne-codeblock 等）；应用 src 已有 119 个不同 ne-* token | 应用 src + styles.css |
| 血统关系 | lakex 与开源 lakelib（lake-main，MIT 0.4.6）同 Lake 血统但不同代；**序列化已分叉**（lakex `<card>` vs lakelib `<lake-box>`），不可直接互换 | 评估文档 §2.3/§5 |
| 主题 | 注入 `.lakex-default-theme`（亮）/ `lakex-dark-theme-dark`（暗）变量 | HANDOFF §4 渲染/CSS 坑 |

---

## 3. 与既有文档/红线的关系

- **AGENTS.md §3 #8/#17 + HANDOFF §3（Lake 内核策略）**：A 用开源 lakejs(lakelib) 源码当"机制字典"（它只是参照系，不是本运行内核）；B 版本锚点 + 最小 hack，不整体 fork。本文件是"我们自己运行的内核(lakex)的知识库"，与机制字典互补。
- **定位方法论**：先复现拿数据 → 反编译确认机制 → 再改；新观测回填本文件时按此流程。
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
- **点击定位与 `allowModifyHash`（260916 修订，覆盖旧观测）**：内核 TOC 点击链路 =
  `.ne-toc-item-text` 的 onClick（**绑在 text div，不在外层 `.ne-toc-item`**——合成 click 点外层 div 冒泡路径不经过
  text，无效果）→ `preventDefault` + `renderer.scrollByNodeId(id)`（滚 `scrollNode`，正常跳转）
  **+ `location.hash = id`（`toc.allowModifyHash` 默认 true）**。hash 赋值触发浏览器锚点导航，会滚锚点的**整条祖先滚动链**——
  除 `.ne-editor-wrap` 外还把 `html` 滚满其可滚空间（我们壳里 42px = topbar 高）→ 整壳上移、topbar 滚出视野、
  tab 栏顶到第一行（260916 用户报「点大纲布局全乱」的根因；旧观测「hash 导航能正确滚动内层」只对了半截）。
  修复：`toc: { allowModifyHash: false }` + `html,body{overflow:hidden}` 兜底（base.css）。关闭后条目内 `<a>` 也不再渲染
  （`allowShowHash` 与 `isAllowModifyHash()` 同源）。
- **`toc` option 是扁平 schema（260916 实测）**：内核编辑态（`ekg`）/ 阅读态（`ezx`）两套 TOC 插件 `OptionName` 均为
  `'toc'`，读 `option.toc.allowModifyHash/enable/normalView/...` **扁平键**；`types.ts` 的 `toc.editing/reading` 嵌套是
  LakexEditor React 组件层的转换，**直接 `Doc.createOpenEditor` 不适用**（嵌套传法被内核忽略，实测 hash 仍被改）。
- **应用现状**：桌面**始终创建**原生侧栏（`EditorTab` 不再传 `disableNativeToc`），`refreshTocSidebar` 照常填充；
  `outlineEnhance=false`（默认）→ 显示原生侧栏；`true` → `EditorTab` 给 host 加 `native-toc-hidden` 类，
  CSS `.lake-editor-tab.native-toc-hidden .ne-toc-sidebar{display:none}` 隐藏原生 + 显示应用自建大纲。
  运行中切换开关只切 class、不重建编辑器（大文档重建会重渲染 + 丢滚动），且原生侧栏一直保持填充，
  切回原生即时可见。移动端恒用应用大纲面板。

### 5.2 卡片值/名称的原地更新：`cardData.setName` + `sync(true)`（2026-09-12 实测）

- **需求**：给文件卡「重命名展示名」时**不要** `editor.setDocument(...)`——它会清空整篇并异步重渲染（tile 分批），
  用户会看到**白屏闪烁**（即使配滚动恢复也盖不住；旧 DOM 克隆遮罩只是兜底）。
- **正确接法（内核自带，无需 hack）**：拿到卡片的 `cardData`（React fiber `memoizedProps.cardData`；fiber 挂在
  `.ne-card-file` 等**内部元素**上，**不在 `ne-card` 根**）后：
  ```js
  cardData.setName(name);   // 只改内存卡片值，getDocument 还看不到
  cardData.sync(true);      // 关键：写回文档模型（getDocument 可见）+ 触发更新（随后可落盘）
  ```
  上传流程本身同款：bundle 里 `cardData.setName(e.filename), cardData.setExt(...), cardData.sync(!0)`。
- **实测（2026-09-12）**：重命名期间给 `editor.setDocument` 装计数器 → **调用数 0**；卡片文字原地更新；
  `editor.getDocument("text/lake")` 能读到新名；`readNote` 确认已落盘。
- **`cardData` 可用 API（部分）**：`getName/setName`、`getSrc/setSrc`、`getExt/setExt`、`getSize/setSize`、
  `getStatus/setStatus`、`getMode/setMode`、`getCardValue/formatCardValue`、`sync(force)`、`afterChange()`、
  `_updateCardValue(value)`（实现 = `_resetCardValue(value)` + `afterChange()`）、`emit/on`（EventEmitter）、`destroy()`。
- **坑 / 反例**：
  - `setName` 单独调用**不会写进 `getDocument`**（只改内存 + 可 `emit("change")` 让 DOM 文字更新，但**落不了盘**）。
  - `_updateCardValue(value)` 必须传**当前正确的 value**（bundle 内是 `_updateCardValue(this.modelNode.attrs.value)`）；
    传旧值/构造值会把卡片值**清空**（实测变成 `{name:"",src:""}`）——别用它做重命名。
- **应用实现**：`features/attachment/attachmentPreviewController.ts#findCardData(el)` 从元素找 `cardData`；
  `EditorTab` 重命名走 `setName(基名 + 原扩展名) + sync(true)`（扩展名锁定——附件类型按扩展名判定）；
  `setDocument` + 旧内容克隆遮罩仅作拿不到 `cardData` 的兜底。

### 5.3 自定义卡片的 `.lake` 序列化：`name="customBlock"` + value 里的 `$name`（2026-09-16 实测）

- **现象**：手写 `<card type="block" name="drawing-board" value="data:...">` 会被内核当**未知卡片**，渲染成 fallback「该卡片暂时无法显示」，`ne-card` 的 `data-card-name` 退化为 `block`。
- **正确形态**（编辑态内核写出的格式）：
  ```html
  <card type="block" name="customBlock" value="data:%7B%22%24name%22%3A%22drawing-board%22%2C%22%24htmlStr%22%3A%22%22%2C...%7D"></card>
  ```
  即 `value` = `data:` + `encodeURIComponent(JSON.stringify({ $name: '<卡片名>', $htmlStr: '', ...initValue }))`；tag 的 `name` 固定 **`customBlock`**（行内卡为 `customInline`），**不是**卡片自己的名字（如 `drawing-board`/`mindmap-card`）。
- **机制**（bundle `src/components/lakex/lakex.js`）：`registerCard(e){ this.cards[e.name] = e }`（`e` 来自 `option.cards` = `customCard.cards` 解包后的 config）；读卡时按 `this.cards[attrs.value.$name]` 查表，查不到即 fallback。
- **应用侧对应**：`src/features/editor/lakeRuntime.ts` 的 `prepareCustomCards` 把 `{config}` 解包为 config 并注册；**config.name 必须与 value 的 $name 一致**。
- 证据：2026-09-16 lakex v1.99.0 dev 冒烟（画板 / 思维导图 / 文本绘图 3 卡，0 fallback、0 JS 异常、0 失败请求）。
- **内置画板卡的 `$name`**（vendor `src/configs/customCard.ts` → `src/cards/DrawingBoard/index.ts`）：`drawing-board`（画板）、`flowchart-board`（流程图）、`uml-board`（UML）、`drawing-mindmap-board`（思维导图板）。画板内核（`lakex-drawnix` + `@plait/*`）由 `DrawingBoardEditor/Viewer` **懒加载**（vendor 分包出 `DrawnixBoardCore-*.js`），不随首屏加载。

### 5.4 阅读态（锁定 Viewer）大纲：另一套类名/挂载时机 + 官方配置项（2026-09-16 实测）

- **编辑态与阅读态是两套实现，别混用结论**：编辑态侧栏 `.ne-toc-sidebar`（absolute 钉在 `.ne-editor-body`，见 §5.1）；
  阅读态侧栏 `.ne-viewer-toc-sidebar`，默认由阅读态 toc 插件创建并挂在 **`viewer.domRootNode`（= `.ne-viewer`，滚动容器内）**，
  内核 CSS 为 `position:fixed; top:60px; right:0; z-index:412`（语雀"无外壳阅读页"口径）。
- **阅读态侧栏只在"toc 非空"时才创建**（bundle 236948–236965）：插件在 `kernel.onPluginEvent('tocChange')` 里判断
  `toc.length > 0` 才 `new ezD(...)`（侧栏实例）→ 内核首批 `tocChange` 常先于插件监听发出 ⇒ **侧栏永不创建、大纲零条目**
  （「锁定文档大纲不渲染」的根因）。修法与编辑态同源：`kernel.emitPluginEvent("tocChange", toc)` 重放即可触发挂载 + 填充
  （`refreshTocSidebar` 现在锁定态也调用，且不再前置检查侧栏 DOM）。
- **官方挂载点配置**（语雀文档 65）：扁平 option `toc.getContainer = () => HTMLElement | null`（阅读模式项）；
  内核取值处 `l = option.getContainer(); l || (l = viewer.domRootNode)`。挂到自建宿主后，`open/close/pin` 操作的
  `_mountNode.parentNode` 变成该宿主 ⇒ **`ne-viewer-toc-visible` / `ne-viewer-toc-pin` 属性落在宿主上**（不再是 `.ne-viewer`），
  应用侧让位/显隐 CSS 必须按宿主状态写（本项目用 `:has(.lake-toc-host.ne-viewer-toc-visible)`）。
  注：`setOutsideStatus`（`ne-viewer-toc-outside`）bundle 里**只有定义无调用**，不会隐藏侧栏。
- **官方阅读器配置 `boundaryTopOffset`**（语雀文档 47，顶层 option，非 toc 下）：传给 TOC 组件作 `offsetTop`
  （bundle 236738）→ 决定 watcher 判定「当前标题」时**忽略顶部多少像素**。编辑态内核写死 **40**（bundle 179499），
  阅读态默认 **0** ⇒ 两态高亮口径不一致；本项目阅读态显式传 40 对齐。仅当 `scrollNode === document.scrollingElement`
  时它还参与 `_scrollTo` 的距离计算（我们下发真实滚动容器，不走该分支）。
- **阅读态大纲点击跳转链路**：`_tocSidebar._scrollTo(id)` → `viewer.domRootNode.querySelector('[id="id"]')` +
  `viewer.scrollNode.scrollTop = ...`（bundle 236848–236876）；**因此 `scrollNode` 必须下发到阅读态**，否则内核回退
  `document.scrollingElement`（html，被 `overflow:hidden` 锁死）⇒ 点击只切高亮、正文不滚（260916 用户报的"点了不跳"）。
- **阅读态实例没有 `renderer`**：`editor.renderer.scrollByNodeId` 只存在于编辑态；阅读态实例的 `_renderer` 是空壳，
  其定位能力只在 toc 插件内部（`_scrollTo`）。拿不到 `renderer` 时按 DOM 计算滚动更可靠。

### 5.5 编辑态 ↔ 阅读态：渲染模型差异（跨态恢复位置的唯一可靠依据）（2026-09-16 实测）

- **两态内容总高不可比**：编辑态默认开虚拟渲染（`virtualRendering`），未渲染内容以占位符撑高，其
  `scrollHeight` 与阅读态完整渲染差异巨大 —— 实测同一标题「05--MACD」：编辑态 `scrollTop=3016` / 阅读态 `=9209`
  （**内核自己的 TOC 定位在阅读态给出 9209**，即 3 倍差异是真实的，不是测量误差）。因此**任何"按 scrollHeight 比例换算"
  恢复滚动位置都必然偏**（长文档偏差数百~数千 px）。
- **可靠做法 = 节点锚点**：内核给块挂稳定 id（`ne-p/ne-text/ne-h*/...`，形如 `ueb955b32`）。
  取锚点用 `document.elementFromPoint(容器中心)` → 向上找 `tagName` 匹配 `/^NE-/i` 且有 id 的元素（**不能用 TOC 高亮
  `ne-toc-selected`**：虚拟渲染下 watcher 二分探测失效，恒选中第 0 节）；恢复时编辑态用 `renderer.scrollByNodeId(id)`
  （+ 元素对齐视口中心微调），阅读态用 DOM 直接算 offset。
- **坑：窗口在后台时编辑态不渲染视口内容**。此时 `elementFromPoint(视口中心)` 命中的是
  `.ne-virtual-render-placeholder` 占位符（DOM 里只有缓存区的那几十个块，`top` 全为负），锚点会取错或取空。
  **CDP 实测必须先 `Page.bringToFront` + `Emulation.setFocusEmulationEnabled{enabled:true}`**（必要时再
  `Page.setWebLifecycleState{active}`）解除节流，否则结论全错（本轮曾因此误判方案失效）。

### 5.6 锁/解锁切态的「文字不动」口径：两态滚动盒不同盒 + 内核关了 scroll anchoring（2026-09-16 实测）

- **两态滚动盒几何不同**（同一外壳 744px 高时实测）：编辑态正文滚动盒是 `.ne-editor-wrap`，**顶边在外壳 +38px**
  （顶上 38px 是内核工具栏 `.ne-ui-toolbar`）、高 **694px**（内核 `.ne-editor-body{height:calc(100% - 50px)}`）；
  阅读态滚动盒是 `.ne-viewer`，**从外壳顶开始**、高 **744px**（我们的 CSS 给 `height:100%`）。
  ⇒ 「在新滚动盒里把锚点居中」在切态时会平白挪 **~46px**（实测锚点窗口坐标 453 → 407）。
  正确口径 = **按锚点在外壳里的屏幕偏移恢复**（切前 453 → 切后 453），不是按新盒居中。
- **内核关闭了浏览器的滚动锚定**：`lakex-doc.css` 在 `.ne-editor-wrap` 与 `.ne-engine-box` 上写 `overflow-anchor:none`，
  所以虚拟渲染/图片水合改版式时，浏览器**不会**做「内容变了但视口不动」的补偿 —— 内容整体位移、滚动值不变。
  实测解锁方向：旧层撤掉后 ~440ms 处正文整体上移 ~800px（`contentY` 13279→12482），锚点被推出视口。
  切态后短窗口内需要「盯住锚点屏幕偏移、一偏就纠回」（本项目 `EditorTab` 的 `pinAnchor`，窗口 1200ms、
  用户输入或位移 >40px 即停手），否则要等下一条固定时刻的恢复（~1.35s）才纠回，用户看到一次跳动。
- **阅读态在切换后仍会继续改版式**：实测阅读态首帧渲染出正文后 ~90ms 处 `contentY` 还会跳变一次
  （11883→9989）。因此「旧层撤掉的时机」必须由「位置门」（锚点已进视口）决定，且撤掉后仍需上述钉住机制。
- **样式/内容 id 跨态同源**：同一文档两态的内核块 id 相同（实测阅读态 1125 个带 id 块与编辑态渲染出的块 id 集合
  完全重合），可放心用 id 做跨态锚点；但**同一 id 会同时存在于过渡期的旧实例层里**，查询锚点必须限定在
  当前实例挂载点（`.lake-editor-mount:not(.is-outgoing)`），否则取到旧层那份过期几何。

### 5.7 用 CSS 隐藏原生编辑大纲 ≠ 退出其布局态：正文会留 280px 占位（2026-09-16 实测）

- **现象**：「大纲增强」开启时给 host 加 `.native-toc-hidden` 把原生 `.ne-toc-sidebar` 设 `display:none`，
  但编辑根 `.ne-editor` 上仍有 `.ne-normal-toc` ⇒ 内核按「大纲展开」给正文块设
  `max-width:750px; margin-right:280px`（编辑态；`ne-layout-mode-adapt` 下实测正文块 662~700px，
  去掉该类后回到 942px 全宽）⇒ **增强大纲编辑态右侧一大段空白**（260916 用户报）。
- **判定**：`document.querySelector('.ne-normal-toc')` 存在，且正文块 computed `margin-right === '280px'` 即命中。
- **正确修法（官方途径，语雀文档 65）**：创建编辑器时显式传扁平 `toc: { normalView: false,
  allowAutoPin: false, rememberLastPin: false }`。三键缺一不可：
  ① `normalView:false` 决定初始收纳态，且**显式传值时内核不读** localStorage 里的用户上次偏好（bundle 177935）；
  ②/③ 内核在 `viewSizeChange` 时会 `isAllowAutoPin()` 自动把大纲重新展开（bundle 179780）→ 只传 normalView 会被改回展开。
  这样 `.ne-normal-toc` 不再出现，正文恢复全宽；原生大纲仍照常创建/填充，随时可切回。
- **联动坑**：`outlineEnhance` 必须进 `EditorTab` 重建依赖（本项目已加），否则运行中切换该设置不会重新应用配置。
- **注意**：`.ne-normal-toc` 是**编辑根**的类（侧栏是 `.ne-normal-toc-sidebar`）；`ne-normal-toc-sidebar` 宽度读数是
  迷你条 40px，与「内容是否留位」无关，别用它判断。

---

### 5.8 块级编辑（悬浮手柄 + 块操作菜单）：能力在 wrapper 层，动作必须走原生命令（2026-09-17 实测）

**定位（结论）**：云端语雀的「块锚点 + 块操作菜单」**不在内核**，实现在 vendor 包装层
`src/components/BlockHoverHandle/`（悬浮手柄，含拖拽）+ `src/components/BlockContextMenu/`（菜单）；
唯一挂载点是 vendor 的 `LakexEditor.tsx`。本应用是直接 `Doc.createOpenEditor`，从未经过那层 ⇒
手柄一直不存在（**不是开关、不是内核版本问题**；`disabledPlugins` 与内核 config 里都无相关开关）。
内核侧 grep `moveBlock|convertBlock|insertBlock|blockHandle` **0 命中**，可证明非内核能力。

**动作 → 实现路径（原始实现，务必区分）**：

| 动作 | 原实现 | 是否安全 |
|---|---|---|
| 删除 | `kernel.execCommand("deleteByRange", modelRange)`（range 由 `engine.transformDOMRange` + `renderer.kernel.createModelRange` 构造） | ✅ 原生 |
| 复制 / 剪切 | `renderer.execCommand('copy', range)`；剪切 = 复制 + 上面那条删除 | ✅ 原生 |
| 缩进 / 取消缩进 | `selectBlockInEditor` → `editor.execCommand('indent'\|'outdent')` | ✅ 原生 |
| 转化 | `blockDoc.convertBlock`（JSON 优先）→ 回退 `runNativeConvert` | ⚠️ 见下 |
| 在下方/上方添加 | `blockDoc.insertBlock` | ⚠️ 见下 |
| 复制块(duplicate) | `blockDoc.duplicateBlock` | ⚠️ 见下 |
| 拖拽移动块 | `blockDoc.moveBlock` | ⚠️ 见下 |

**为什么 JSON 路径被全面弃用（实测证据）**：`utils/blockDoc.ts` 的五个函数都是「整篇 JSON 读改写」
（`getDocument('json')` → 改树 → `setDocument('json')`）。副本实测一次「剪切」：
正文 6032B → **12288B**；`customBlock customName="mindmap-card"` 载荷 634B → **8859B**
（`$htmlStr` 被重写成 base64 内联 SVG 的「水合形态」）；内核未注册的 `customBlock customName="board-card"`
**整张消失**并残留内部段落（`<p id="…">画板</p>`）。
**对照实验**：纯原生 `editor.execCommand('indent')` 只 +26B（缩进属性），上述所有卡片片段 hash 一字不变
⇒ 破坏确由 JSON 路径引入，与「保存管线」无关（native 卡 codeblock/hr 在 JSON 路径下也逐字节保真，
被改写/丢失的只有 `customBlock` 自定义卡与未注册卡）。

**「转化为」各目标的内核原生命令（副本实测，`selectBlockInEditor` 后执行）**：

| 目标 | 命令 | 实测 |
|---|---|---|
| 正文 / H1–H6 | `editor.execCommand('style', 'p'\|'h1'…'h6')` | ✅ 成功 |
| 无序 / 有序 / 任务 | `unorderedList` / `orderedList` / `taskList` | ✅ 成功（任务会新增 `checkbox` 卡） |
| 引用 | `quote` | ✅ 成功 |
| 高亮块 | `alert` | ✅ 成功（`ne-alert-hole`） |
| 分栏 | `columns`（第二参 2） | ✅ 成功（`ne-container-hole`） |
| 折叠块 | `collapse` | ✅ 成功（`ne-container-hole`） |
| **代码块** | 内核**没有**「转代码块」命令；只能按插卡落卡：`editor.execCommand('insertCard', 'codeblock')` | ⚠️ 已按用户 260917 指示**加回菜单**：`codeblock` 命令返回 false、`style 'codeblock'` 抛 `invalid node insert: #root can't contain codeblock`，故走 `insertCard`。现状＝「在原段落旁插入**空**代码块卡，原文留在原段落」（不丢数据、但不是真转换，同下面容器类的残留问题） |

**其它实测**：
- **「转化为卡片/容器类」为什么会吃掉/搬不动文本（260917 定位，含修法与残留问题）**：
  - 内核这些命令是**替换/插入**语义，不是"原地换类型"：`alert`/`columns`/`collapse` 在**整块选中**时＝用空容器**替换选区**（实测：高亮块/分栏转换后原文在 DOM、模型 JSON、落盘正文三处全无 ⇒ 用户报的"内容消失"）；而 `quote` 是**包住**原内容（落盘可见 `blockquote > p > span`，文本保留）——所以「通病」里引用是例外。
  - **修法（已落地）**：非 `style` 目标改用**折叠光标**（`collapseCaretAtBlockEnd`）再执行命令 ⇒ 不再丢文本。
  - **残留问题（未解决）**：折叠光标下 `alert`/`columns`/`collapse`/`insertCard('codeblock')` 变成「**在原文旁插入一个空容器/空卡**」，原文段落保持原样（落盘实测：`<p id="ucfd561e7">…自动保存验证ZZZ…</p><blockquote class="lake-alert …">`）⇒ **不丢数据，但转换语义没达成**（云端的"转化为高亮块"是把段落搬进容器）。
    **✅ 260917 已解决**：改走 §5.8.1 的通用插入通道（`getNodeContent` + 一次 `insertAtSelection`），把原块替换成「含原文的容器/卡片」，不再插空容器。
  - **建议修法（⚠️ 已被 §5.8.1 取代，不需要）**：命令后把内容"搬家"——① 记录原段落文本 → ② 折光标执行命令（容器/卡片就位、光标在其内部，待验证）→ ③ `insertText` 写入原文 → ④ `deleteBlockByRange` 删除原段落；全程原生命令，仍不碰整篇 JSON。代价：行内标记（加粗/链接等）会退化为纯文本，需按需处理。
  - **✅ 已解除暂停（260917）**：外部复核结论见 **`docs/BLOCK-CONVERT-ANSWER-260917.md`** —— 内核确有正规通道（官方 `insertAtSelection` 会自动补 hole 并包裹内容），**已按此实现**（vendor `convertBlockPreservingContent`，见 §5.8.1）；**没有**采用上面那条"搬家"编排。
- 「在下方添加」的原生实现 = 把光标收到块首/尾 → `editor.execCommand('breakLine')`（紧邻生成新 `ne-p`）→
  需要类型时再对新块执行 `style`/`quote`/`hr`。官方 `insertAtSelection(format, data)` 实测**可用**（**更正**：早前「返回节点但文档无变化」是误判 —— 传的是空 `<p><br></p>`、且只比对文本；见 §5.8.1），已用它做容器/卡片转换。
- **`editor.execCommand` ≠ `renderer.execCommand`**：`indent/outdent` 在 `editor.execCommand` 上有效（本批实测 +26B），
  而 `src/features/editor/editorCommands.ts` 历史结论记的「indent/outdent 是 no-op」针对 **`renderer.execCommand`**（移动端 dock 走的路径）。
  新增块级命令时先确认走哪条路径。
- 官方命令列表（`yuque-developer-docs/docs/08 - 命令列表`，29 条）**无**代码块转化命令，也无 `insertCard`（后者是 wrapper 内部用法）。

**本仓库的落地与护栏（260917）**：
- 挂载：`src/features/editor/blockHandleMount.ts`（`prefs.blockHandle`，仅桌面编辑态），宿主 `div.lake-block-handle-host` 挂在编辑器挂载容器，清理链进 `editor.__disposeExtras`。
- vendor 改动：`BlockHoverHandle` 的动作改原生 + **拖拽移动停用**；`BlockContextMenu` 加 `SAFE_BLOCK_ACTIONS` 白名单（`convert/delete/copy/cut/indent/outdent/addAfter`）、去掉「复制链接 / 插卡」入口；「转化为」按云端保留 15 项（**代码块已在，走 `insertCard`**）——排版天然是 6 紧凑 + 5 紧凑 + 4 功能卡片两两一行，**无需改 CSS**。登记见 `vendor/lakex-doc-react/LOCAL-CHANGES.md` #9/#10。
- 护栏：`src/features/editor/blockMenuNative.test.ts`（源码级断言：不得再出现 blockDoc 的 JSON 函数调用、白名单收敛、代码块走 `insertCard`）；端到端 `scripts/e2e-block-menu-smoke.mjs`（副本上逐项点菜单 + 每次比对卡片片段 hash）。

**已知独立问题（与块操作无关，待单独立项）**：内核**未注册的遗留卡**（如换源前自研画板的 `board-card`）
在任何一次编辑保存后都会丢 —— 实测纯原生 `style h1` 也让文件 6032B→4166B 且 `board-card` 消失（已注册卡 hash 全不变）。
原因是保存走 `editor.getDocument('text/lake')`，序列化自内核模型，而未注册卡不在模型里（DOM 里也不渲染）。
**这条与「转化后文本可能消失」高度相关**：保存 = 按模型序列化，DOM 里出现而模型里没有的内容会在保存时蒸发
（排查方向：转换后先看 `getDocument('json')` 里新容器是否含原文本，再看保存后的 `.lake`）。

**§5.8.1 复核更正（260917，副本实测 + bundle 源码）** —— 回答 `docs/BLOCK-CONVERT-QUESTION-260917.md`（完整配方/§7 复核表见 `docs/BLOCK-CONVERT-ANSWER-260917.md`）：

1. **`insertAtSelection` 有效**（更正 §5.8 里「实测无效」的结论）：签名 `execCommand('insertAtSelection', format, data[, modelRange])`，
   实现 = `kernel.readData(format,data)` → `iD.insertINode(editing, selection, inode)` → commit；解析失败返回 `null`（不落库），成功返回解析出的 INode。
   **折叠光标 = 插入**（原块保留、作为同级兄弟）；**非折叠选区 = 替换**。支持 `text/html|text/markdown|text/plain|text/lake|text/ne-inode|Files`。
2. **它是「插入带内容容器」的正规通道**：内核在插入 alert/columns/collapse 时按 `insert-inode-by-position.ts` **自动补 `alertHole`/`containerHole` 并包裹**。
   实测：`insertAtSelection('text/lake','<blockquote class="lake-alert lake-alert-info"><p>…</p></blockquote>')` 落盘得到**含内容高亮块**；
   配合 `getNodeContent(blockId,'text/lake')` + 非折叠选中该块，可**一次性把段落替换成「含原文的容器」**（DOM / `getDocument('json')` / 落盘 `.lake` 三处均含原文；分栏/折叠同理）。
3. **命令级仍无「转换并保留内容」**：`alert`/`columns`/`collapse` 源码语义 = 删选区 + 插**空**容器（内含新建空段落），从不搬运已有节点；只有 `quote` 走 `ia.wrapRootNode` 真包裹。
   `wrapRootNode`（`framework/kernel/src/model/utils/range/wrap-root-node.ts`）是**内部工具，未暴露**成命令/服务。
4. **代码块有解**：`insertAtSelection('text/markdown', <三反引号围栏> + 代码 + <三反引号围栏>)` 一次生成**含内容**代码块卡；
   或 `insertCard('codeblock')`（返回卡 id）+ `setCardValue(false, id, { code })` ⇒ 卡值归一为 `{"search":"","code":…,"heightLimit":true,"id":…}`。
   `queryCommandValue('cardValue', id)` 实测返回 `undefined`，读值看 `getDocument('json')`/落盘。
5. **规范 lake markup（实测落盘）**：高亮块 `<blockquote class="lake-alert lake-alert-info">`（type 见 `lake-alert-<type>`，默认 `info`）；
   分栏 `<article class="lake-columns">` + 子 `<article class="lake-column-item" style="width: 50.000000%">`；
   折叠块 `<details class="lake-collapse" open="true"><summary class="lake-summary">…</summary>…</details>`；
   代码块卡 `<card type="inline" name="codeblock" value="data:{…}">`。
6. **`queryCommandEnabled(name)` 不能用来判断命令是否存在**：`insertAtSelection`/`getNodeContent`/`setCardValue`/`moveCard` 返回 `false`，但 `execCommand` 实测生效（其 `getState` 恒为 `NOT_EXECUTED`）。
7. **命令注册表**：bundle 内约 **147 个命令名**（`kO({command:{…}})` 映射 + 命令式 `registerCommand('…')`，alert 族 `alert/alertDelete/alertType/alertMove` 走后者）；
   `editor._$commands` 只有 4 个编辑器级命令，不是内核注册表。**无** `convertBlock/wrapBlock/turnInto/toggleBlock/changeBlockType/callout`。
8. **原生移动命令确实存在**（更正 §5.8「内核没有移动块原生命令」）：`moveCard/moveCollapse/moveColumns/moveColumn/moveTable/moveImage`（及 `tableRowMoveTo`/`tableColumnMoveTo`）；
   但它们是**节点类型专属**且接收**模型 Position**，**没有通用「移动任意块」命令** —— vendor 拖拽停用的结论不变（原实现走整篇 JSON 路径）。
9. 官方文档无「转化/turn into」条目；`55 - 斜杠命令` 只把 `alert/columns/collapse` 作为斜杠**插入项**。`lake-main` 无 columns/collapse/alert 插件、无「转容器」实现可借鉴。

10. **260917 二次修正（用户实测三个问题，均已修，副本 e2e 覆盖）**：
    - **代码块要按卡片 value 生成**：`editor.execCommand('insertCard', cardName, value)` 的**第二参就是卡片 value**（`insert-card-command` 源码 `iP.insertCardNode(o, selection, t, n)`）；
      用 `insertAtSelection('text/lake', <card name="codeblock" value="data:{…}">)` 亦可。payload **不带 `hideToolbar`** ⇒ 内核物化时补 `hideToolbar:false`、`mode`、`lineNumbers`、`autoWrap` 等 ⇒ **工具栏与代码名称正常展示**。
      早前走的 markdown 围栏会写 `hideToolbar:true / mode:'plain'` ⇒ 不是完整展示（**已弃用**）。
    - **卡片源转「容器/正文/标题/引用/列表」一律先抽取文本**：代码块是**块卡**（DOM 里是 engine 直接子级，不在 `ne-p` 内；lake 虽写 `type="inline"`），
      把它整张塞进 alert 会**直接丢失**（实测卡计数 1→0 且文本无）；`getNodeContent(源id,'text/plain')` 能取到代码文本 ⇒
      用 `<p><span>line1<br />line2</span></p>`（换行转 `<br />`、文本转义）作为内容。容器/正文/标题走一次 `insertAtSelection`；
      **引用/列表**（`quote`/`unorderedList`/`orderedList`/`taskList`）对卡片源本身无效（引用 no-op、列表抛 `Cannot read properties of undefined (reading 'nodeName')`）⇒ 先抽取成段落（新段落会被自动选中）再执行内核命令。
    - **图片/文件是内联卡**（在 `ne-p` 内，`getNodeContent` 的 `text/plain` 为空）⇒ 沿用原 frag 嵌进容器**不会丢**（实测卡计数不变），无需抽取。
    - 规范引号/列表 markup（实测落盘）：引用 `<blockquote><p>…</p></blockquote>`；无序 `<ul list="…"><li fid="…">…</li></ul>`；有序 `<ol list="…">…`；
      任务 `<ul class="lake-list"><li class="lake-list-node lake-list-task"><card type="inline" name="checkbox" value="data:false"></card>…`。

### 5.8.2 块菜单归属 / 按块类型配置 / 剪切（260917 三次修正）

- **归属**：带「转化为」的**块悬浮手柄 + 块操作菜单不是内核能力**，是 vendor React 层（`BlockHoverHandle`/`BlockContextMenu`，我们 `blockHandleMount.ts` 手动挂载），内核只提供被调用的**命令**。
  内核自带的是**卡片/容器工具栏**（`.ne-card-toolbar`/`.ne-ui-toolbar`；`getCardToolbarConfig`/`getContainerToolbarConfig`/`registerToolbarWidget`，各处 `toolbar`/`cardSelect` 描述符）与**斜杠菜单**（`cardSelectItems`）——不受我们的块菜单控制，只能通过 `disabledPlugins`/config 有限影响。
- **按块类型配置菜单**：`MENU_CONFIGS` 的 key = 块标签；卡片（`ne-card`）额外按 `data-card-name` 细分（`getBlockMenuKey` → `ne-card:<name>`，回退 `ne-card` → `default`）。
  `default` 已收敛为**基础项（无「转化为」）**——图表类/未知块不硬转；需要「转化为」的块必须显式登记（p/h/quote/list/codeblock/容器 `ne-alert-hole`/`ne-container-hole`/`ne-hole`）。要单独配某类卡片，加 `'ne-card:<name>'` 即可。
  ⚠️ **块卡的真实类型在内部 `ne-card` 上**：代码块/分割线/思维导图/画板等**块卡**在 DOM 里都是 `ne-card[data-card-type=block]` 包在 `ne-hole` 内，`findBlockNode` 解析出的是 `ne-hole`
  ⇒ 只按外层标签取菜单会让"图表类不给转化为"失效（全部命中同一菜单）。修法：`getBlockMenuKey` 对 `ne-card`/`ne-hole` **读内部 `ne-card` 的 `data-card-name`**，
  已知可转化的（`codeblock`/`hr`）映射到既有配置，其余走 `ne-card` 基础菜单（无「转化为」）。实测：思维导图卡 `[删除,复制,剪切,在下方添加]`；代码块 `[转化为,删除,复制代码,剪切,在下方添加]`。
- **容器源不能被"再套一层"**：容器 hole 的 `selectNodeContents` 只选到容器**内部**，插入新容器就成了「分栏套高亮块」（用户实测）。修法 = 容器源选中**容器节点本身**（`selectNodeInEditor` → `range.selectNode(blockquote/article/details)`）。
- **cmd+X 剪切失效（严重，已修）**：根因在**应用层**而非内核 —— `src/features/editor/EditorTab.tsx` 的 `cutHandler` 在 capture 阶段 `stopImmediatePropagation()` 抢在内核 `cut` 事件处理（`clipboard` 插件的 `_handleCut`，内核里确实有）之前，却用 `document.execCommand("delete")` 做 **DOM 级删除** ⇒ 现象 = 选区文字消失（DOM 删了）→ 点块后被内核模型重绘回来（模型没删，`bytes` 不变），转换后的内容同样受影响。
  修法 = 删除改走内核命令（`ed.kernel.execCommand("delete")`，`execCommand`/`document.execCommand` 仅兜底）；副本实测：cut 后**内存模型 + 落盘都删掉**（4400→4381B）。护栏：`src/features/editor/editorCut.test.ts`。
- **原生移动块 / 拖拽（260917 已实现，分支 `feat/block-drag-native`）**：内核**有**移动能力 —— `moveCard(cardId, position)`（卡片，实测**逐字节保真**，含卡 id）、`moveCollapse`/`moveColumns`/`moveColumn`/`moveTable`/`moveImage`（各自类型）；**通用文字块无 move 命令**，用纯原生「读-插-删」（`getNodeContent('text/lake')` + `insertAtSelection` + `deleteByRange`）。
  落点 `position` 由「目标元素前/后的折叠 DOM range」`transformDOMRange(...).start` 得到。注意：插入的副本会复用原块 id，**必须插入前固化原块模型 range** 再 `deleteByRange`，否则按 id 反查会删到副本（表现＝没移动）。 **不要用 `insertAtSelection` 折叠光标做块移动**：它会把内容吸附进相邻块（段落融合丢换行、列表项文本追加到目标项）；改用 `insertAtPosition(position, format, data)`（走 `insertINodeByPosition` 的块级插入/补 hole）。列表项要抽**裸 `<li>`**（`getNodeContent` 返回的是整段 `<ul>` 包一个 `<li>`）且**先删源再插**（插入同列表会重建节点、源 range 失效）；其它块**先插后按插入前固化的源 range 删**（段落删除会留一个空段落）。
  实测：拖思维导图卡后仍 634B/hash 不变；拖段落成功且卡片零改动。**禁用** `blockDoc.moveBlock` 的整篇 JSON 读改写（实测自定义卡 634B→8859B、抹掉未注册卡）。完整调研见 `docs/BLOCK-DRAG-RESEARCH-260917.md`。

### 5.8.3 列表父项 = 一个整块：嵌套在 `ne-level` 上，整段用跨元素 range（Issue 3，260917 实测）

**内核列表的 DOM 形态（关键）**：所有列表项都是 `.ne-engine` 的**平级子节点**（`NE-ULI`/`NE-OLI`/`NE-TLI`），
DOM 里**没有**列表容器元素、也没有 `data-lake-indent`；嵌套层级渲染在**项自身**的 `ne-level="N"`
（一级缺省 = 0）。模型里同样是平级兄弟，缩进编码在 `attrs.level` / `parentIndex`。

**由此产生的坑**：`getNodeContent(父项id, 'text/lake')` 只返回父项那一行（`<ul><li>父项</li></ul>`），
**不含任何子项** ⇒ 删除/转化/复制/拖拽父项时子项被落下（与云端「父项手柄代表整个条目」不一致）。

**整段口径（已落地，纯 DOM、不读整篇 JSON）**：
- `blockSpanElements(el)`：非列表项返回 `[el]`；列表项返回「自身 + 紧随其后、`ne-level` 更大且同族
  （`ne-uli-c`/`ne-oli-c`/`ne-tli-c`）的连续项」。
- `spanDomRange(span)`：`setStartBefore(首)` / `setEndAfter(末)` 的跨元素 outer range（**恒为非折叠**；
  列表项用 `selectNode` 变换后是折叠的，会触发 `deleteByRange` 断言）。
- `selectBlockSpanInEditor` / `selectWholeBlockForEdit`：多元素时把该 range 设为内核选区。
- **读取整段用 `getSelectionContent(format)`**（`getNodeContent` 只能取单节点）。
- `deleteBlockByRange` / `copyDomBlock` / `movableFragment` / `moveBlockNative` /
  `convertBlockPreservingContent` 全部改走整段；手柄高亮与拖拽 ghost 也覆盖整段。

**实测（副本，`scripts/e2e-block-list-span.mjs`）**：三级父项（level 0/1/2）→ 手柄高亮 3 项；
「转化为 → 高亮块」后落盘 `<blockquote class="lake-alert lake-alert-info"><ul list=…>…</ul>…</blockquote>`
且**父项 + 2 子项文本都在容器内**；「删除」整段全部移除；原件 hash 不变。
- ⚠️ alert 的落盘形态属性顺序是 `<blockquote data-lake-id="…" id="…" class="lake-alert …">`
  （`class` **不在**第一个属性）⇒ 断言正则要写 `<blockquote[^>]*class="lake-alert`。

**多块选区（跨多个顶层块）的聚合手柄 / 批量操作**见 §5.8.4。

### 5.8.4 多块选区 / 批量操作：整段选区就是「批量」原语（Issue 4，260917 实测）

**结论**：内核不需要「批量命令」。跨多个顶层块的 DOM 选区在内核里是**块选区**；用 `selection` 命令设好模型选区后，
`getSelectionContent` / `deleteByRange` / `insertAtSelection` 以及所有作用于选区的命令（`style`/`quote`/
`unorderedList`/`alert`/`columns`/`collapse`…）都**按整个选区**工作 ⇒ 批量 = 一次命令，不逐块搬运。

**识别（纯 DOM，不读 JSON）**：
- `selectedTopBlocks()`：从 `window.getSelection()` 的 range 起点找到 `.ne-engine`，返回**与 range 相交**的顶层块（`TOP_BLOCK_TAGS` 过滤）。
- `hasMultiBlockSelection()`：选到 ≥2 个顶层块，且它们**不属于同一个列表父项整段**（否则按 §5.8.3 的「一个整块」处理）。

**批量动作落点**：
- 读取：`readBlockContent` 在多块选区时直接 `getSelectionContent(format)`；
- 复制/删除：`copyDomBlock` / `deleteBlockByRange` 用 `currentSelectionRange()`；
- 转化：`runMultiBlockConvert` —— `p/h` 走 `style`、引用/列表走 `quote`/`unorderedList`/`orderedList`/`taskList`、
  容器/代码块走 `convertBlockPreservingContent`（`insertAtSelection` 一次替换整个选区）。

**手柄聚合（关键交互坑）**：跨块拖选后手柄要落在**首块**（`selectionchange` 监听）；但**点击手柄会让编辑区失焦、
浏览器清掉选区** ⇒ 手柄的 `onMouseDownCapture` 先 `preventDefault` 并 `selectBlocksInEditor(editor, blocks)` 还原选区，
`handleMenuAction` 在执行前再还原一次；动作完成后退出多块选区。
（「选区一收缩就清 multi」的写法会误伤点击手柄 —— 已改为「在编辑区内按下鼠标（非手柄）才清」。）

**实测（副本，`scripts/e2e-block-multi-select.mjs`，真实鼠标拖选）**：拖选 3 段（诊断显示相交 4 块）→ 聚合手柄
`@353,391`、高亮 4 块；批量「删除」3 段文本全部消失；批量「转化为 → 高亮块」后 3 段文本都在**同一个**
`<blockquote class="lake-alert lake-alert-info">` 内。

**未做**：多块选区的**拖拽**（批量拖动整段）—— 菜单批量删除/复制/剪切/转化已可用；拖拽仍按单块。

### 5.9 内核命令注册表（43 插件 / 147 条 kO 命令 + 4 条命令式 = 151，bundle 实测枚举，260917）

来源 = `vendor/lakex-doc-react/src/components/lakex/lakex.js` 里 `kO({ pluginName:'X', command:{…} })` 的**括号配对解析**（脚本见本节末），补上 §5.8.1 第 7 条「只给计数、没给清单」的缺口。**新增块级能力前先在这张表里找命令；表里没有才写 wrapper 层。**

| 插件 | 命令 |
|---|---|
| alignment | `alignment` |
| basicTextStyle | `bold`, `italic`, `underline`, `strikethrough` |
| bgColor | `bgColor`, `clearBgColor` |
| breakLine | `breakLine` |
| card | `setCardValue`, `insertCard`, `insertCardAfter`, `focusCard`, `deleteCard`, `cardValue`, `moveCard`, `cardIsExist`, `cardBatchApply` |
| clearFormat | `clearFormat` |
| clipboard | `copy`, `cut`, `paste` |
| code | `code` |
| collapse | `collapse`, `moveCollapse`, `deleteCollapse`, `collapseOpen`, `collspseClosable`, `collapseBreakLine`, `collapseToggleWidthMode`, `tryUnfoldCollapse` |
| color | `color`, `clearColor` |
| columns | `columns`, `columnsWidths`, `columnsAddColumn`, `columnDelete`, `columnDeleteByIndex`, `selectColumnEnd`, `deleteColumns`, `moveColumns`, `moveColumn`, `columnsToggleWidthMode` |
| content | `wordCount`, `wordCountSelection`, `isEmpty`, `getNodeContent`, `getSelectionContent`, `insertAtSelection`, `insertAtPosition`, `markdownSplit` |
| correction | `applyCorrection`, `editorApplyCorrection`, `editorIgnoreCorrection`, `correctSelection` |
| dateCard | `dateCard`, `getSelectDateCard` |
| delete | `delete`, `deleteByRange`, `deleteToBlockEnd` |
| dropFile | `dropFile` |
| file | `insertFile` |
| focus | `focus` |
| fontsize | `fontsize`, `defaultFontsize`, `clearDefaultFontsize` |
| formatPainter | `paintFormat` |
| history | `redo`, `undo`, `rollbackHistory` |
| hr | `hr` |
| image | `image`, `imageTask`, `moveImage`, `insertImage`, `imageTitleBreakLine`, `updateImageData`, `insertAfterImage` |
| indent | `indent`, `outdent`, `canIndent`, `firstIndent` |
| input | `input`, `canInput`, `insertText`, `autoSpacing`, `autoClosing` |
| layout | `layout` |
| lineHeight | `lineHeight` |
| link | `link`, `unlink`, `insertLink`, `linkText`, `updateLink`, `cardToLink`, `selectionPureLink` |
| list | `orderedList`, `unorderedList`, `taskList`, `orderedListIndexType`, `orderedListIndexQuery`, `taskStatus` |
| markdownDataSource | `markdownStream` |
| markdownPasteParse | `markdownPasteParse` |
| paragraph | `plainText`, `deleteEmptyParagraphs` |
| quote | `quote` |
| save | `save` |
| search | `search`, `replaceText`, `replaceAll` |
| selectAll | `selectAll`, `selectAllDoc` |
| selection | `selection` |
| slash | `insertSlash`, `canInsertSlash` |
| subscript | `sup`, `sub` |
| table | `tableBorderVisible`, `tableClearContent`, `tableColumnMoveTo`, `tableColumnWidth`, `tableDeleteColumn`, `tableDeleteRow`, `deleteTable`, `tableEquallyColumn`, `tableInsertBeforeColumn`, `tableInsertAfterColumn`, `tableInsertBeforeRow`, `tableInsertAfterRow`, `tableMergeCell`, `moveTable`, `tableRowHeight`, `tableRowMoveTo`, `tableSpacing`, `tableCellBgColor`, `tableSetQueueNo`, `table`, `tableToggleWidthMode`, `tableUnmergeCell`, `tableVerticalAlign`, `tableRowHead`, `tableColHead`, `tableColumnAdaptation` |
| textDataSource | `text` |
| thirdparty | `linkToThirdparty` |
| typography | `typography`, `paragraphSpacing` |

命令式注册（**不在**上表，走 `registerCommand({…})`）：`alert`、`alertDelete`、`alertType`、`alertMove` ⇒ 合计 **151**。

**块编辑相关命令 → 我们现状**：

| 我们的动作 | 内核命令 | 现状 |
|---|---|---|
| 删除块 / 剪切 | `delete`, `deleteByRange`, `deleteToBlockEnd` | ✅ 已用（`deleteBlockByRange`） |
| 复制/剪切到剪贴板 | `copy`, `cut`, `paste` | ✅ 已用 |
| 取块内容 | `getNodeContent`, `getSelectionContent` | ✅ `getNodeContent` 已用；`getSelectionContent` **未用** |
| 插入/替换块 | `insertAtSelection`, `insertAtPosition` | ✅ 已用 |
| 「转化为」容器/卡片 | **无** convert 命令；= `getNodeContent` + `insertAtSelection` | ✅ 已用（`convertBlockPreservingContent`） |
| 卡片移动 | `moveCard`（+`cardValue`/`setCardValue`/`insertCard`/`insertCardAfter`/`focusCard`/`deleteCard`） | ✅ `moveCard` 已用 |
| 容器/表格移动 | `moveCollapse`, `moveColumns`, `moveColumn`, `moveTable`, `moveImage` | ⚠️ **未用**：`moveBlockNative` 目前对非卡片块统一「读-插-删」 |
| 全选 | `selectAll`（上下文感知）, `selectAllDoc` | ⚠️ **未用**：目前手工 `createRange` + `transformDOMRange` + `selection` |
| 选区内写入模型 | `selection` | ✅ 已用 |
| 缩进 | `indent`/`outdent`/`canIndent`/`firstIndent` | ✅ 已用 |
| 行内样式 / 列表 / 引用 | `bold`/`italic`/…, `unorderedList`/`orderedList`/`taskList`, `quote`, `plainText`, `hr` | ✅ 已用 |
| 选区字数 / 空判 | `wordCount`/`wordCountSelection`, `isEmpty` | ⚠️ **未用** |
| 批量卡片应用 | `cardBatchApply` | ⚠️ 语义**待实测**：当前只查到 `getValue` = `getNodesByName(name).some(isConnected)`（工具栏 enable 判定） |

**两条容易踩空推断**：
- `ISelectionHelperService`（bundle 类 `eRD`）实例方法只有 `registerToolbar`/`closeToolbar`/`destroy`/`disable`/`enable`/`init`/`isSame` ⇒ 它是**卡片/容器工具栏注册服务**，**不是块选择 API**；不要拿它做「多选块」。
- 多块选择的运行时信号 = **跨多个顶层块的 DOM Range** + 插件事件 `blockSelectionChange`/`unblockSelectionChange`（内核按 `_blockReset` 标记区分块选区/普通选区）；`selectAll` 上下文感知（表格单元格/整列/容器 hole 时选上层结构，否则根节点内容），`selectAllDoc` 整篇。**内核没有**「把块选区批量转成某类型」的命令 ⇒ 批量转化只能对每个选中块逐个走 `convertBlockPreservingContent`（app 层编排，不是重复造内核）。

**候选原生化改造（未做，按用户「能走内核就走内核」原则登记）**：
1. `selectBlockInEditor`/`selectNodeInEditor`：把光标放进目标块后可直接 `execCommand('selectAll')`（上下文感知、容器 hole 自动选对层级）；仅「选中节点本身（非内容）」无对应命令，仍需手工 range。
2. 容器重排优先用 `moveCollapse`/`moveColumns`/`moveColumn`/`moveTable`/`moveImage`，而非统一「读-插-删」（更省且保内部节点 id）。
3. 选区取内容/字数改用 `getSelectionContent`/`wordCountSelection`。

**枚举脚本（可复现）**：

```js
const s = require('fs').readFileSync('vendor/lakex-doc-react/src/components/lakex/lakex.js', 'utf8');
const plugs = [...s.matchAll(/pluginName: '([^']+)'/g)].map((m) => ({ name: m[1], idx: m.index }));
const balanced = (from) => { let d = 0; for (let i = from; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return s.slice(from, i + 1); } };
const out = {};
for (let k = 0; k < plugs.length; k++) {
  const seg = s.slice(plugs[k].idx, k + 1 < plugs.length ? plugs[k + 1].idx : s.length);
  const ci = seg.indexOf('command: {');
  if (ci < 0) continue;
  const block = balanced(plugs[k].idx + ci + 'command: '.length);
  if (!block) continue;
  out[plugs[k].name] = [...new Set([...block.matchAll(/[A-Za-z_$][\w$]*\s*:\s*'([^']+)'/g)].map((x) => x[1]))];
}
console.log(out); // 43 插件 / 147 条
```

---

## 6. 使用守则（所有会话遵守）

1. **动手前查**：改 `src/features/editor/**`、移动端 `src/mobile/editor/**`、或涉及编辑器内核行为前，先读 §2/§4/§5。
2. **报错先查表**：lakex 抛错 / 命令 no-op / DOM 不符 → 先查 §5；查不到再做新定位。
3. **新观测必须回填**（防止知识再次散落）：定位到新行为后，按 §6.5 的流程更新本文件对应小节，并在可写会话补 `lakex-contract.d.ts` 的类型；回填时写证据（bundle 位置/断言串/复现步骤）。
4. **反编译定位的标准姿势**（PROGRESS 方法论）：CDP/页面内实测复现 → 在 `vendor/lakex-doc-react/src/components/lakex/lakex.js`（内核 ESM 转换产物，类名/路径/文案可搜；`doc.umd.js` 为原始 UMD）用字符串 grep 定位→ 对照断言里的源码路径 → 得出结论再改代码。
5. **不要做**：不要给 vendor 内核打补丁（除既有最小 hack 模式，且需注释 + 记录）；不要复制大段 bundle 源码进仓库；不要在本文件写易过期事实（版本号/计数/分支放 HANDOFF §0）。
6. **资料检索顺序（260916 用户立规，与 AGENTS §2 一致）**：涉及调用内核 API/配置项/命令时按三级走 ——
   ① **官方出处** `/Users/admin/file/local-lake/yuque-developer-docs/`（语雀开发者文档本地副本：`65 - 大纲（toc)`、
   `47 - 通用配置`、`07 - API与事件`、`08 - 命令列表` 等）**先确认官方有没有该能力及其语义，官方有就用官方途径**；
   ② **本文件**（已核实契约 + 实测坑，新观测必须回填）；
   ③ **源码字典对照** `lake-editor-main/`（VSCode yuque-editor 插件）、`lake-main/`（开源 lakelib，仅机制字典、
   序列化方言已分叉勿套用）。最终仲裁 = vendor bundle `vendor/lakex-doc-react/src/components/lakex/lakex.js` + 运行时实测。

---

## 7. 待落地任务与关联实验

- **任务 T1（待办，HANDOFF §3 技术债）**：新增 `src/features/editor/lakex-contract.d.ts`（§4 清单），替换 lakeRuntime 等处的 `as any`，纯类型改动 + 门禁全绿。
- **实验 E1/E2（换核决策前置）**：真实 .lake ↔ lakelib 双向解析；lakelib 大文档渲染。详见工作区根 `lake-kernel-swap-analysis-260908.md` §9。
- 本文件由 260908 只读评估生成；落地/回填后在此追加更新日志（一行一条，勿删历史）。
- 2026-09-11：新增 §5.1（原生编辑 TOC 侧栏填充时序：空 toc 创建 + 1s 节流 + 直接 `_tocSidebar.update` 绕过节流），§4.2/§5 表补对应条目。来源：HANDOFF §2.15–2.16、lakeRuntime.ts `refreshTocSidebar`/`findNativeTocSidebar`。
- 2026-09-16：§5.1 修订「点击定位」为 `allowModifyHash` 真相（内核 TOC 点击会写 `location.hash` → 触发锚点导航滚 html，导致整壳上移；修法 = 关 `allowModifyHash` + 锁 `html,body` overflow），补「`toc` option 是扁平 schema」；新增 §5.4（阅读态 Viewer 大纲：另一套类名/挂载时机、官方 `toc.getContainer` 与 `boundaryTopOffset`、点击跳转链路）与 §5.5（编辑态↔阅读态渲染模型差异、节点锚点恢复位置、窗口后台不渲染的 CDP 陷阱）；§6.6 更新为三级资料检索顺序（用户立规）。来源：260916 会话核实的 bundle 行号与 CDP 实测。
- 2026-09-17：新增 §5.8（块级编辑：能力在 wrapper 层而非内核；动作→实现路径映射；`utils/blockDoc` 整篇 JSON 读改写的实测破坏 —— 正文 6032B→12288B、思维导图卡载荷 634B→8859B、未注册卡被整张抹掉；「转化为」各目标的原生命令实测表与代码块缺口；`editor.execCommand` 与 `renderer.execCommand` 在 indent/outdent 上的差异；`breakLine` 实现「在下方添加」而官方 `insertAtSelection` 实测无效；未注册遗留卡在任何一次保存后丢失）。来源：260917 会话在副本上的实测（`scripts/e2e-block-menu-smoke.mjs`）+ `yuque-developer-docs` 命令列表三级检索。
- 2026-09-17（复核）：新增 **§5.8.1** —— **更正**「`insertAtSelection` 实测无效」为**有效**（`readData`→`insertINode`；折叠=插入、非折叠=替换、失败返回 `null`）；确认它是「插入带内容容器」的正规通道（内核自动补 `alertHole`/`containerHole`），配 `getNodeContent` 可一次性把段落替换成含原文的 alert/columns/collapse；命令级仍无转换命令（`quote` 是唯一 wrap）；代码块可用 markdown 围栏或 `insertCard`+`setCardValue` 写入；补规范 lake markup、`queryCommandEnabled` 不可靠、147 命令注册表、原生 `moveCard/moveCollapse/moveColumns/...` 的存在。来源：`docs/BLOCK-CONVERT-ANSWER-260917.md`（副本 CDP 实测 + bundle 源码）。
- 2026-09-17（命令清单）：新增 **§5.9** —— 用 balanced-brace 解析 bundle 的 `kO({pluginName, command})`，落地**完整命令注册表 = 43 插件 / 147 条 kO 命令 + 4 条命令式（alert 族）= 151**；给出「块编辑命令 → 我们现状」（已用 / 未用 / 内核无对应）与三条候选原生化改造；澄清 `ISelectionHelperService` 是**工具栏注册服务、不是块选择 API**；记录多块选择 = DOM Range + `blockSelectionChange`/`unblockSelectionChange`，**内核无批量转化命令**。来源：`vendor/lakex-doc-react/src/components/lakex/lakex.js` 静态解析（脚本随 §5.9）。

---

## 8. 证据来源与复查方法

- bundle：`vendor/lakex-doc-react/src/components/lakex/lakex.js`（内核 ESM 转换产物；grep 类名/路径/断言串采样即可，勿整读）；原始 UMD 为同目录 `doc.umd.js`。
- 类型/README：`vendor/lakex-doc-react/src/components/lakex/*.d.ts`（含 9 行 lakex.d.ts 自白）、`vendor/lakex-doc-react/dist/index.d.ts`、`README.md`、`LICENSE`。
- 应用锚点：`src/features/editor/lakeRuntime.ts`（实例化 540-815、私有字段 466-905、命令 454-538）、`EditorTab.tsx`、`LakeEditor.tsx`、`editorCommands.ts`、`canvasInteractionGate.tsx`、`mediaCardRouting.ts`、`attachmentPreviewController.ts`。
- 镜像/注入：`public/vendor/cdn/**`、`electron/cdnRedirect.ts`、`electron/assetServer.ts`。
- 评估全文档：工作区根 `lake-kernel-swap-analysis-260908.md`（差距矩阵/换核结论/许可观察）。
