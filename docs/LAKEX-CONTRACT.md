# LAKEX-CONTRACT.md — 闭源 lakex 内核：行为契约 + 调试速查表（会话必读）

> **本文件是给"所有会话"的知识库**：把我们对**闭源 lakex 内核**（vendor `@dlient/lakex-doc-react` 源码里转换出的内核 bundle，即语雀 `@alipay/lakex-doc` 打包品；2026-09-16 起内核 **v1.99.0**）
> 通过实测 + 反编译**已经观测到的行为**固化成：① 结构化的接口契约（设计为 `lakex-contract.d.ts`，待落地）；② 一张报错定位速查表。
> **什么时候看本文件**：只要会话涉及 lakex 编辑器——遇到内核报错、命令点了没反应（no-op）、DOM/CSS 不对、
> 要新加编辑器能力、要改 `src/features/editor/**` ——先查本文件，再动手。
> ⚠️ **分发边界（261022）**：内核产物（`vendor/lakex-doc-react/`、`public/vendor/lakex-doc/`、`public/vendor/lakex/`）
> **以 vendored 形式随本仓库提供**（未取得语雀授权，风险自担，见 `NOTICE`）。下文所有路径/源码引用都指本工作区。

---

## 0. 一句话定位

- 不是给 lakex 补文档（lakex 文件一个字节都不动）；是给**我们自己的代码**补一份"我们观测到的、可依赖的接口契约"。
- 目的是把散落在 `lakeRuntime.ts` 等文件注释里的反编译结论，收敛成一处可被类型系统检查的"总账"，降低黑盒导致的静默失败。
- 本文件 = 该契约的设计稿 + 维护守则 + 调试速查表；落地产物 = 新增 `src/features/editor/lakex-contract.d.ts` + 替换 `as any`（待办，见 HANDOFF §3）。

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
  - **✅ 已解除暂停（260917）**：外部复核结论见 **`docs/LAKEX-CONTRACT.md`** —— 内核确有正规通道（官方 `insertAtSelection` 会自动补 hole 并包裹内容），**已按此实现**（vendor `convertBlockPreservingContent`，见 §5.8.1）；**没有**采用上面那条"搬家"编排。
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

**§5.8.1 复核更正（260917，副本实测 + bundle 源码）** —— 回答 `docs/LAKEX-CONTRACT.md`（完整配方/§7 复核表见 `docs/LAKEX-CONTRACT.md`）：

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
- **宿主 DOM（260924 文字浮栏消失机制用到）**：手柄 `div.ne-block-hover-handle` 与菜单 `div.ne-block-context-menu` **都不是 portal**，两者都在我们创建的宿主 `div.lake-block-handle-host` 内（`blockHandleMount.ts`）；键盘开菜单同样落在这个 host 里。⇒ 外部若要「识别块句柄交互」，只用宿主选择器 `.lake-block-handle-host` 即可同时覆盖手柄、菜单与拖拽，**不需要盯内核类名**。
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
  实测：拖思维导图卡后仍 634B/hash 不变；拖段落成功且卡片零改动。**禁用** `blockDoc.moveBlock` 的整篇 JSON 读改写（实测自定义卡 634B→8859B、抹掉未注册卡）。完整调研见 `docs/LAKEX-CONTRACT.md`。

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

**未做**：多块选区的**拖拽**（批量拖动整段）—— 菜单批量删除/复制/剪切/转化已可用；拖拽仍按单块。云端 Lake 也未实现此交互；可行性/风险/触发条件记录在 `HANDOFF.md` §3 第 11 条（低优先级，暂不做）。

### 5.8.5 整块删除 / 拖拽的「多出一条空行」根因 + 内核节点级删除（260918 实测）

**用户实测现象**：菜单「删除 / 剪切」与**拖拽**都会在原位留下一条空行（拖拽 上→下 时空行在原位上方、下→上 时在原位下方）。

**根因（bundle 复读 + 落盘实测）**：`kernel.execCommand('deleteByRange', range)` 的语义是**删内容**，不是删节点。
`framework/kernel/src/model/utils/range/delete-content.ts` → `delete-content-by-range.ts` 尾部：

```js
h = !u.node.hasCategory([Root, LikeRoot]);
return ( h ? n && (u = oB(e, u, !0))
           : e.acceptNode(u.node.nodeName, e.defaultElementName)
             && (u = e.insertNodeByPosition(u, e.createElement(e.defaultElementName))), ... );
```

即：范围覆盖**根级整块**时，内核会在删除位置**补插一个默认段落**（保证光标有落点）。
实测（副本、以落盘正文解析）：删一个段落 → `顶层块 63→63、空段落 +1`；拖拽 → `63→64`。
（列表项的 `deleteByRange` 能整项消失 —— 差别在是否落在 Root/LikeRoot 层。）

**正规替代 = 内核自己的节点级删除（命令上下文就是模型事务）**：`CommandManager.execute` 里
`n.execute(this._model.editing, ...args)` ⇒ 命令的 `e` 参数 = **`kernel._model.editing`**，它提供
`startTransaction/commit/rollback` 与 `newJob()`；job 提供 `getNodeById(id)` / `removeChild(parent, node)` /
`newPosition` / `newRange` / `newSelection` / `setSelection`（`deleteAlert` / `deleteCollapse` / `deleteCard` /
`deleteEmptyParagraphs` 全部是这套）。宿主侧同一条路径：

```js
const editing = editor.kernel._model.editing;
const txn = editing.startTransaction();
const job = editing.newJob();
const node = job.getNodeById(blockId);            // blockId = DOM 上的 id（= data-lake-id）
job.removeChild(node.parentNode, node);
job.setSelection([job.newRange(job.newPosition(node.parentNode, node.offset))]); // ← 必须
editing.commitJob(job);
txn.commit();
```

**⚠️ 必须先把内核算子挪出被删节点**：否则 `commitJob` 在 `framework/engine/src/view/selection/index.ts` 断言失败，
**整个事务回滚** —— 症状是「点了删除没反应」，且**此后所有块操作继续报错**（实测「复制 → 剪切 → 删除」序列 100% 复现；
删除后的下一次拖拽一并失败），渲染层异常还会让页面重载（CDP 侧表现为 `window.__xxx is not a function`）。
内核自己的命令同理：`alert-command`/`alert-delete-command` 都是先 `deleteContent` 把选区挪走、再 `removeChild`。

**`deleteEmptyParagraphs` 不能拿来兜底**：它是 `job.getNodesByName('p')` 全篇扫描并删除**所有**空段落
（`paragraph` 插件），会把文档里有意为之的空行一起删掉。

**拖拽的顺序口径（260918 改）**：落点 position 是 `(父节点, 子索引)` 形式，**先插后删会让落点索引位移** ⇒ 改为
「**先摘掉源节点 → 再按删除后的目标位置 `insertAtPosition`**」。目标元素在内核重渲染后可能换 DOM 节点，要按 id
在**同一个 engine 根**内重新取（多 tab 同时打开时 `document.getElementById` 会取到隐藏 tab 的同 id 元素 → 误删/误改）。

**列表手柄锚点（260918 修正 §5.8.3 的结论）**：手柄要锚 **项目符号（`ne-uli-i/ne-oli-i/ne-tli-i`）的左缘**。
§5.8.3 曾锚「内容元素（`ne-uli-c`）左缘」，但符号本身占的就是内容左侧那 32px ⇒ 手柄正好压在符号上
（实测 icon 中心落在 marker 内 16px）。锚 marker 后 icon 中心 = `marker.left − 16`，与段落一致
（三级实测 marker.left 387/419/451 → iconCenter 371/403/435）。

**实测（修复后）**：删除 `顶层块 63→62`、拖拽 `63→63`、空段落两者都不变；三个 e2e 套件
（`e2e-block-list-span` / `e2e-block-menu-smoke` / `e2e-block-multi-select`）全绿。

### 5.8.6 引用内块独立编辑 + 引用内「转化为」裁剪 + 手柄顶对齐/选中样式（261004 云端实测）

来源 = browser-skill 驱动 Microsoft Edge 实测云端语雀编辑态（主要做 hover / 开菜单；**经用户授权**在云端对该引用做过一次「取消引用」实测，内部块原样提升、未丢内容）。

**云端 DOM（新 brick 版）**：块手柄 = `.ne-brick-toolbar`（`data-testid=<blockId>`；`position:absolute` + `transform:translate(-100%,0)`），点开 = `.ne-brick-toolbar-overlay > ul.ne-brick-menu.ne-brick-actions`；「转化为」子菜单 = `.ne-ui-turn-into-menu`（图标项 `.ne-ui-turn-into-icon[data-testid]` + 常规项 `.ne-ui-turn-into-normal[data-testid]`，当前项带 `selected`）。
> 注：我们 vendored 的是**旧 brick 实现**（`.ne-block-hover-handle` / `.ne-block-context-menu`），上面的类名仅供对照，**不要照搬**。

**四条已核实行为（照此复刻）**：
1. **引用的首个子块 = 整个引用的合并手柄；其余子块各自出柄**：hover 引用**第一行**（首个 `ne-p`）→ `data-testid` 是外层 `ne-quote`；hover 引用内**非首**的 `ne-tli` → `data-testid` 就是该 `ne-tli`。即「容器第一行手柄 = 合并手柄，其他行仍可单独块编辑」（用户 261004 口径）。
2. **「转化为」按上下文裁剪**：引用**外** 15 项 = h1–h6 / 正文 / 有序 / 无序 / 任务 / 代码块 / 高亮块 / 引用 / 分栏 / 折叠块；引用**内** 11 项 = 去掉 **代码块 / 引用 / 分栏 / 折叠块**（= 用户图 2）。
3. **手柄顶对齐块首行**：实测列表项块 `y=464` → 手柄 `y=464`；引用块 `y=266` → 手柄 `y=266`。**不是**按块高垂直居中。
4. **主操作菜单 6 项**：`转化为 / 删除 / 复制 / 剪切 / 缩进 / 在下方添加`（云端该处没有「取消缩进 / 在上方添加」入口）。
5. **取消引用**：引用第一行手柄 → 转化为 → 「引用」是**回显(selected)** 状态（`.ne-ui-turn-into-normal[data-testid="quote"].selected`）→ 点一下取消引用（实测 `ne-quote` 消失、内部块提升到顶层）。

**我方落地（vendor LOCAL-CHANGES #23）**：`NE-QUOTE` 移出 `STRUCTURAL_BLOCK_TAGS`（非首子块各自出柄）**但保留父块上提**（首个子块 → 整个 `ne-quote`，即合并手柄）；`BlockContextMenu` 的 `QUOTE_HIDDEN_CONVERT_VALUES`（codeblock/quote/columns/collapse）按 `isInsideQuote` 裁剪；**「转化为」不再走子菜单，整体内联到第一级**（沿用原样式：正文/标题/列表/代码为紧凑图标格，「高亮块/引用/分栏/折叠块」为图标 + 文字卡片格；用户 261004 要求）；`updateHandlePosition` 的 `top` 改顶对齐；`selectedTopBlocks` 增加 `blockContainerOfRange`（支持同一引用内部多选）；**块编辑只在「鼠标触达块句柄」时触发**（用户 261004 口径）：`selectionchange` **不扫描块选区、不高亮**（只做选区收缩时的廉价清理），多块判定挪到 `handleMouseMove` 的「松开按键后的普通移动」（`e.buttons === 0`），拖选中不判定 ⇒ 不影响跨行选择性能；选中样式只在鼠标进入手柄时上（`highlightedRef` 记录、每次先全清再重记），并覆盖所有行级块（正文/标题/列表），用 `box-shadow: 0 var(--ln-brick-hl-extend)` **动态**补段间距 —— 扩展量 = 与「下一个高亮行」的实际空隙（单行 / 末尾 / 空隙过大 → 0 ⇒ 只用行高本身，不无谓加高）⇒ 相邻行连成一片且不溢出；`BlockHoverHandle.css` 直接给 `ne-tli/ne-uli/ne-oli` 上 `.ne-brick-highlight` 的**整块背景**（内核只覆盖 p / 标题 / `ne-card` / `ne-collapse` / `ne-columns` / `ne-quote[ne-indent]`，列表项原本没有规则）；⚠️ **不要**照抄内核 `ne-p` 的 `::before + z-index:-1` 画法 —— 在列表项上会被引擎背景盖住、完全不可见（实测像素全白），改用元素自身 `background-color`；新增 `unwrapQuote` 实现取消引用（内部块按原类型提升，不丢列表结构）。

**顺带修掉一个真 bug（261004 实测）**：`getCurrentConvertValue` 原先**无条件** `blockElement.querySelector('ne-oli-i/ne-uli-i/ne-tli-i')` 下探，会把**含列表的引用**误判成 `ol/ul` —— 表现为引用第一行「转化为」回显成「有序」、点「引用」不取消反而再包一层。已收窄为「**块自身是列表项**时才下探」。

**选中样式（用户 261004 明确）**：多块合并的选中样式是**整个块的背景色**（比选中文字浅），不是只盖文字 —— 对应内核 `ne-p.ne-brick-highlight::before` 的画法（`--lakex-editor-background-focus` @ 0.4，`left:-6px; right:0` 铺满整行）；列表项原本没有这条规则，本项目已补齐。

**仍未复现**：云端「多块拖选 → 句柄合并」的确切手势（browser-skill 无法做真实鼠标拖拽；用户口径：多选多行即自动合并，引用这类容器第一行手柄本来就是合并手柄）。

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

**261017 B6 实测（移动端 dock 接入，真机 CDP）**：`style(h5/h6)` / `clearFormat` / `sup` / `sub` / `indent` / `outdent` / `firstIndent` / `lineHeight` 均可用；引擎标记 = `ne-h5|ne-h6`、`ne-bold`、`ne-sup`/`ne-sub`（**互斥**）、`ne-indent`、`ne-text-indent`、`ne-line-height`。`lineHeight` 取值域 = **`[1, 1.15, 1.5, 2, 2.5, 3]`**（bundle `Ik.values`）；`paintFormat` 是**两步模式**（激活后去点目标）。

**块编辑相关命令 → 我们现状**：

| 我们的动作 | 内核命令 | 现状 |
|---|---|---|
| 删除块 / 剪切 | `delete`, `deleteByRange`, `deleteToBlockEnd` | ⚠️ `deleteByRange` **只删内容**（根级整块会在原位补空段落，见 §5.8.5）；整块删除改走**模型事务** `job.removeChild` + 选区复位（`removeBlockNodesNative`），`deleteByRange` 仅兜底 |
| 复制/剪切到剪贴板 | `copy`, `cut`, `paste` | ✅ 已用 |
| 取块内容 | `getNodeContent`, `getSelectionContent` | ✅ 均已用：`getSelectionContent` 用于块菜单取 Markdown（`blockHandleMount.ts:47`；261017 纠正原「未用」结论） |
| 插入/替换块 | `insertAtSelection`, `insertAtPosition` | ✅ 已用 |
| 「转化为」容器/卡片 | **无** convert 命令；= `getNodeContent` + `insertAtSelection` | ✅ 已用（`convertBlockPreservingContent`） |
| 卡片移动 | `moveCard`（+`cardValue`/`setCardValue`/`insertCard`/`insertCardAfter`/`focusCard`/`deleteCard`） | ✅ `moveCard` 已用 |
| 容器/表格移动 | `moveCollapse`, `moveColumns`, `moveColumn`, `moveTable`, `moveImage` | ⚠️ **未用**：`moveBlockNative` 对非卡片块统一「摘节点 → 落点插入」（260918 起为节点级删除，见 §5.8.5） |
| 全选 | `selectAll`（上下文感知）, `selectAllDoc` | ⚠️ **未用**（261017 审计 B3 结案：不做——手工 Range 无缺陷证据、无消费方）；`selectAll` 仅卡片菜单 1 处在用 |
| 选区内写入模型 | `selection` | ✅ 已用 |
| 缩进 | `indent`/`outdent`/`canIndent`/`firstIndent` | ✅ 已用 |
| 行内样式 / 列表 / 引用 | `bold`/`italic`/…, `unorderedList`/`orderedList`/`taskList`, `quote`, `plainText`, `hr` | ✅ 已用 |
| ⚠️ `code`（行内代码）的**状态判据** | **`queryCommandState('code')`**（Executed=1 / Unavailable=-1），**不是** `queryCommandValue('code')` | ✅ 已用（261003 修） |
| 选区字数 / 空判 | `wordCount`/`wordCountSelection`, `isEmpty` | ✅ `wordCount` 已接（B1 状态栏/属性）；`wordCountSelection` **未用**（261017 审计 B5 结案：无选区字数 UI，不做） |
| 批量卡片应用 | `cardBatchApply` | ⚠️ 语义**待实测**：当前只查到 `getValue` = `getNodesByName(name).some(isConnected)`（工具栏 enable 判定） |

**两条容易踩空推断**：
- `ISelectionHelperService`（bundle 类 `eRD`）实例方法只有 `registerToolbar`/`closeToolbar`/`destroy`/`disable`/`enable`/`init`/`isSame` ⇒ 它是**卡片/容器工具栏注册服务**，**不是块选择 API**；不要拿它做「多选块」。
- 多块选择的运行时信号 = **跨多个顶层块的 DOM Range** + 插件事件 `blockSelectionChange`/`unblockSelectionChange`（内核按 `_blockReset` 标记区分块选区/普通选区）；`selectAll` 上下文感知（表格单元格/整列/容器 hole 时选上层结构，否则根节点内容），`selectAllDoc` 整篇。**内核没有**「把块选区批量转成某类型」的命令 ⇒ 批量转化只能对每个选中块逐个走 `convertBlockPreservingContent`（app 层编排，不是重复造内核）。

**候选原生化改造（未做，按用户「能走内核就走内核」原则登记）**：
1. `selectBlockInEditor`/`selectNodeInEditor`：把光标放进目标块后可直接 `execCommand('selectAll')`（上下文感知、容器 hole 自动选对层级）；仅「选中节点本身（非内容）」无对应命令，仍需手工 range。
2. 容器重排优先用 `moveCollapse`/`moveColumns`/`moveColumn`/`moveTable`/`moveImage`，而非统一「读-插-删」（更省且保内部节点 id）。
3. ~~选区取内容/字数改用 `getSelectionContent`/`wordCountSelection`~~ **已核（261017）**：`getSelectionContent` 已在用；`wordCountSelection` 无消费方、审计 B5 结案不做。

> **261017 复核**：本清单 1/2/3 已由 `LAKEX-CONTRACT.md` 的 B3/B4/B5 逐条核过，结论**均为不做**（理由见该文档 §3.2）。

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

### 5.10 浮动工具栏：内核有什么、没有什么（260919 bundle 枚举 + 三端实机）

> 起因：用户要「钉钉那种选中文本弹出的浮动工具栏」，问内核是否自带、能否扩展。

**结论先行（三条）**

1. 内核**有**浮动工具栏基建，但**只有卡片/容器那一类**（复制/剪切/删除/复制链接/间距/全屏/宽度/评论）——它是「块级操作栏」，不是「文字格式栏」。
2. 内核**没有文本选区的浮动格式栏**（bundle 里不存在 selection bubble 这类浮层类型；`FrameworkUiLib` 的浮层原语里也没有）。
3. 语雀云端（编辑态 + 阅读态实测）**同样没有**选区浮栏 —— 与内核一致；云端选择文本时只有顶部固定工具栏（编辑态）与产品级 AI 入口。⇒ **要钉钉那种，只能在 wrapper 层自研。**

**一、内核 miniToolbar 插件（卡片/容器浮动栏）**（bundle 枚举）

- 插件名 `miniToolbar`；服务 `IMiniToolbarService`。命名空间 `MiniToolbar` 的导出：`MiniToolbarEditorPlugin` / `MiniToolbarViewerPlugin` / `IMiniToolbarService` / `cardToolbarCardUIAddon` / `containerToolbarCardUIAddon` / `containerRightToolbarCardUIAddon` / `toolbarControllerCardUIAddon` / `toolbarBoxUIAddon` / `editToolbarPresetAddon`。
- 插件 option：`miniToolbar: { disabledItems: [...] }`（`OptionName = 'miniToolbar'`）。
- service 方法：`setDisabledMiniToolbarItems` / `addDisabledMiniToolbarItems` / `removeDisabledMiniToolbarItems` / `registerFilterMiniToolbarItems`；改完发 `miniToolbar.requestRefreshToolbar` 事件刷新。
- 触发时机：**`showMiniToolbarWhen` ∈ `hover | never | focus | always`**（常量 `MINI_TOOLBAR_TRIGGER`，由 toolbar 插件命名空间导出）。浮层类型按触发器动态拼名：`${trigger}CardToolbar` / `${trigger}ContainerBar`。
- 内置条目（uilib 的 `itemConfig`，即「卡片浮栏能放什么」）：
  `copy(复制) · delete(删除) · copyLink(复制链接) · cut(剪切) · spacing(添加间距, switch) · maximize(全屏) · widthMode(标宽/全宽展示) · comment(评论)`
  ⇒ 全是**结构性操作**，一条文本格式命令都没有。

**二、uilib 浮层原语：可以从 `Doc.FrameworkUiLib` 拿到**（bundle 枚举）

`Doc.FrameworkUiLib`（bundle 内变量 `td`）导出：`OverlayBar` / `OverlayBarButton` / `OverlayBarDivider` / `OverlayManager`、
`MiniToolbar` / `CardToolbar(+View)` / `ContainerToolbar(+View)` / `ContainerRightToolbar(+View)`、
`BoundaryPopover`（定位实现 `calc-position-by-node.ts` / `calc-position-by-point.ts`）、以及 `Button/Dropdown/Menu/Popover/Checkbox` 等。

⇒ 想省样式，可以用 `OverlayBar` + `BoundaryPopover` 拼一个浮栏。但注意层级：`FrameworkUiLib` 本身在 `Doc` 顶层导出表里，而 `OverlayBar` / `MiniToolbar` / `BoundaryPopover` **只是这一层的成员**（不在顶层表里）⇒ 属**内部件**，升级内核时要复核。

**三、固定工具栏的两条官方路（与浮栏无关，别混）**

- 配置：`toolbar: { agentConfig: { default|table|codeblock|simple|note: { items: [...] } } }`（官方文档 04；`TOOLBAR_AGENT` 的五个 agent 名）。
- 增删：`ToolbarOptionHelper.start().removeItems(...).insertBefore([...], anchor).getOption()`（官方文档 05）。
- 自定义按钮：继承 `ToolbarUIDescriptor<'Button'|'StatusButton'|...>`，实现 `getInitUIState / getUIState / onEvent`（`onEvent` 里调 `editor.execCommand(...)`）。
- ⚠️ 官方 `toolbarItems` 清单里**没有 `code`（行内代码）**，但内核有 `code` 命令 —— 官方文档 05 的示例正是用自定义 `StatusButton` 调 `execCommand('code')` 做出来的。要做钉钉那种 `</>` 按钮，走自定义 descriptor 或 wrapper 自研按钮。

**四、钉钉的选区浮栏（对照基线，260919 实机）**

- 条目（截图实测）：`正文(段落样式) | 字号 | B 加粗 | I 斜体 | S 删除线 | U 下划线 | 链接 | </> 行内代码 | A 字体色 | 对齐 | ⋮ 更多 | ↗`
- 实现在钉钉自己的 `wd3-*` 设计系统组件里（`BaseTextSelect` / `wd3-toolbar-item` 等），**不是 lakex**。
- 触发：选中文本后浮在选区上方；固定顶栏同时在（顶栏样式/字号下拉会变成"正文 / 字号"占位态）。

**五、我们这边的现状（260919 实机）**

- 我们的应用选中文本后**没有任何浮层**（DOM 实测 `.ne-card-toolbar` / `.ne-ui-overlay-bar-wrap` / `MiniToolbar` 计数全 0）。
- 我们已有的自研浮层只有：**块悬浮手柄 + 块菜单**（wrapper `BlockHoverHandle`，§5.8）、**卡片右键菜单**（`CardContextMenu`）、**卡片悬浮桥**（`setupCardToolbarHoverBridge`，`lakeRuntime.ts`）。
- ⇒ 要做钉钉式选区浮栏，落在 wrapper 层，做法与 §5.8 同型：监听选区变化 → 定位（`FrameworkUiLib.BoundaryPopover` 或自算）→ 按钮调 `editor.execCommand`（可用命令见 §5.9 与官方 `toolbarItems`）。注意沿用 §5.8 的两条经验：`onMouseDownCapture` 保选区、多 tab keep-alive 下按「当前可见 engine 根」取元素。

**证据（复查方法）**

```bash
cd vendor/lakex-doc-react/src/components/lakex
rg -o --text "plugins/[a-z0-9-]+/src" lakex.js | sort -u | grep toolbar     # plugins/toolbar
rg -o --text "framework/uilib/src/[A-Za-z0-9/._-]+" lakex.js | sort -u      # mini-toolbar / overlay-bar / boundary-popover
python3 -  # 搜 showMiniToolbarWhen / MINI_TOOLBAR_TRIGGER / itemConfig / IMiniToolbarService
```

实机：语雀编辑态与阅读态选中文本均无浮栏（编辑态只出现分栏容器工具「列等宽/自适应宽度」）；钉钉选区浮栏见上文条目；我们应用选区后 DOM 无浮层。

**六、inline 图片卡片：没有「选中浮条」，只有 ⋯ popover（260924 桌面实测，隔离实例）**

- 图片是 `ne-card[data-card-name="image"] data-card-type="inline"`。hover/点击 **不会**出现 `.ne-card-toolbar` 或 overlay bar（实测计数恒 0）——
  §5.10 一的 miniToolbar 只覆盖 block 卡片/容器，**不含 inline 图片卡**。
- 唯一入口 = 卡片内 28×28 的 `.ne-ui-image-more` 按钮；点开是 `.ne-ui-image-inner-menu` popover，**只有「删除 / 复制」两项**。
- 可用命令（`editor.execCommand`，实测）：
  | 命令 | 签名 | 结果 |
  |---|---|---|
  | `updateImageData` | `(cardId, { style: "left"/"center"/"right" })` | ✅ 落成 `.ne-image-style-*` |
  | `updateImageData` | `(cardId, { width: N })` | ✅ `img[width]=N`、`cardData.getUserWidth()=N`（`{src}` / `{url}` **无效**） |
  | `deleteCard` | `(cardId)` | ✅ 卡片移除 |
- `cardData`（`_neRef._virtualNode._instance.cardData`）暴露 `getSrc/getOriginalWidth/setDisplayWidth/setStyle/setImageInfo/...`；
  `setImageInfo({src})` 直接断言失败（`plugins/image/src/kernel/image-card-data.ts:470`）。**替换图片 v1 未接入。**
- 复制/下载走宿主 native：`copyAssetImage(noteId, filename)` / `saveAssetAs(noteId, filename)`（filename 从 canonical URL 解析）。

**七、桌面文字命令实测（260924，隔离实例；供浮动工具栏取用）**

- **有效**：`bold→<strong>`、`italic→<em>`、`underline→<u>`、`strikethrough→<del>`、`color→<span style="color:…">`、
  `bgColor→background-color`、`style "h1"`（p→h1）、`alignment "center"`（段落 `text-align`）、`clearFormat`。
- **`fontsize`**：`execCommand('fontsize', 22)` 落成 `class="lake-fontsize-16"`（= px × 0.75，pt 口径）；**`queryCommandValue('fontsize')` 返回 px（22）**，active 判定用它。
- **`code`**：需**内核自己的选区**；用 DOM Range 伪造选区会插入空 `<code>`。真实用户选区可用；跨多段 selectAllDoc 返回 false。
- **`link` / `unlink` / `insertLink` / `linkText`**：官方 docs/08 有，但 `editor.execCommand` 上多种参数形态实测**均返回 false、正文无变化** ⇒ 链接按钮暂停，待找到内核入口再上（禁止静默 no-op）。
- **active 态取值**（`queryCommandValue`）：mark = `"true"` / `""`；`style` = `"p"`/`"h1"`；`fontsize` = px 或 `"null"`；`alignment` = `""`/值；`color`/`bgColor` = `"null"`/色值。
  **不要用 `queryCommandState`**（实测返回 `0/1/2`，语义不等同 active）。

**八、图片卡片 `updateImageData` 全能力（260924 桌面实测；对齐云端语雀图片浮栏调研）**

云端语雀（`todoo.yuque.com`）图片 hover 浮栏 = 裁剪 · 旋转 · 宽高 · 链接 · 描述 · 对齐 · 样式 · 边距 · 批量应用。
其工具栏组件（`ne-t-image-*` / `ne-t-*` 图标）**不在我们 pin 的 v1.99.0**（bundle 0 命中），但**底层能力都在**：

| 能力 | 调用 | 实测 |
|---|---|---|
| 旋转 | `updateImageData(id, { rotation: 90 })` | ✅ `getRotation()=90` |
| 裁剪（交互） | 卡实例 `_$cardUI.setCro(true)` | ✅ 实测弹出 `.ne-ui-image-crop-box`、`getCroping()=true`；退出用 `_setCroping({croping:false})`。数据裁剪另可 `{ crop }` |
| 宽高 | `updateImageData(id, { width: N })` | ✅ `img[width]` / `getUserWidth()` |
| 链接 | `updateImageData(id, { link, linkTarget })` | ✅ lake 序列化含 link |
| 描述 | `updateImageData(id, { title, showTitle })` | ✅ `getTitle()/showTitle()` |
| 边距 | `updateImageData(id, { margin: { top, bottom } })` | ✅ 命令返回 true |
| 样式 | `updateImageData(id, { style })` | ✅ 内核 CSS 值：`none` 无样式 / `stroke` 图片描边 / `shadow` 图片阴影（dist/style.css 已定义）；另有 left/center/right |
| 批量 | `cardBatchApply(name, patch)` | ✅ = 把 patch 合并进**同名所有卡片**（bundle：`getNodesByName` → `setAttribute(l,'value',{...l.attrs.value,...patch})`）。`cardBatchApply('image',{style})` / `{width}` = 云端「同步到全文」 |

**文字链接（260924 实测，补齐）**：内核 `link` / `insertLink` 都可用，**先用 `queryCommandEnabled` 把门**——
有选区时 `queryCommandEnabled('link')=true` → `execCommand('link', url, true, true)` 把选区包成 `<a target="_blank">`；
光标折叠时 `link` 为 false 而 `queryCommandEnabled('insertLink')=true` → `execCommand('insertLink', text, url, true, true)`。
（此前误判「link 是 no-op」是因为既没按 4 参契约调、也没先查 enabled。）

**前端坑（260924，务必记住）**：用 `requestAnimationFrame` 合并刷新，在 **Electron 窗口未绘制/被遮挡时会暂停** ⇒ 首次刷新永不执行、后续全被 in-flight 守卫吞掉 ⇒ 选区内联浮层**完全不出现**。这类"事件驱动 + 轻量 DOM 读取"的 UI 应**同步刷新**，不要用 rAF 合并。

---

**九、颜色控件（文字色 / 背景色）：本体 vs 下拉三角 + 内核默认色 + 共用记忆（260924 桌面实测 + bundle）**

固定工具栏的颜色按钮是「本体 + 下拉三角」两件（bundle `plugins/color`、`plugins/bg-color` 的 `*-toolbar-descriptor`）：

- **本体**（`.ne-ui-toolbar-color-show-button`）`_clickHandler → onSelect(props.color)`：**直接应用「当前色」，不弹面板**。
- **下拉三角**（`.ne-ui-toolbar-color-dropdown-button`）才打开调色板（`overlayClassName: ne-ui-toolbar-color-picker-overlay`）。
- 「当前色」= 插件上下文 `pluginContext.getColor()` 保存的**上次使用色**，初值 = 内核主题令牌默认色：

  | 控件 | 令牌 | light | dark |
  |---|---|---|---|
  | 文字色 | `editor.color.default` | `#DF2A3F` | `#CA3F4F` |
  | 背景色 | `editor.bgColor.default` | `#FBDE28` | `#C2AC19` |

  文字色清除判定另用 `editor.text.color`（light `#262626` / dark `#E2E2E2`）。
- **清除语义**（`onEvent('select')`，命令收**持久值**）：
  - 文字色：所选视觉值 == `editor.text.color` ⇒ `execCommand('clearColor')`；否则 `execCommand('color', 持久值)`（**非 toggle**）。
  - 背景色：持久值空/transparent，或**已等于当前** `queryCommandValue('bgColor')` ⇒ `execCommand('clearBgColor')`；否则 `execCommand('bgColor', 持久值)`（**是 toggle**）。
  - UI 显示用 `editor.theme.toVisualValue(持久值)`。
- **图标**：固定栏用 `FrameworkUiLib.EmbedIcon`（= bundle `erj`），`type='t-font-color'|'t-bg-color'` + `fill=当前色` ⇒ **下划线随当前色变化**；`fontColorIcon`/`bgColorIcon` 是同一套 SVG 函数。sprite 的 `icon-editor-color`/`icon-editor-bgColor` 是**静态**红/黄，不随色变，颜色按钮别用它。
- **运行时读写内核「上次使用色」（浮动栏与固定栏共用一份）**：

  ```js
  const svc = editor.getService({ value: "IToolbarEditorService" }); // Doc.Plugins.Toolbar.IToolbarEditorService.ID 同款
  const defs = svc.plugin._toolbar._descriptorDefines;               // key: color / bgColor
  defs.color.pluginContext.getColor();   // 持久值（视觉值走 editor.theme.toVisualValue）
  defs.color.pluginContext.setColor(/* 持久值 */);
  ```

  `getService(e)` 只看 `e.value` ⇒ `{ value: "IToolbarEditorService" }` 即可。**固定栏 disabled 时**颜色插件拿不到工具条服务、**不建 pluginContext**（`defs.color` 缺失）⇒ 需退回自持内存记忆 + 令牌默认。桌面隔离实例实测：`colorRaw=#DF2A3F`、`bgRaw=#FBDE28`；浮动栏选色后固定栏图标即变（共用成立）。
- **选区变化后的取值时机（260924 实测）**：内核 `queryCommandValue` 在**选区刚变化时晚一拍**才更新——只读一次会停在「上一次选区的样式/字号」。固定栏在内核 `selectionchange` 上刷新；浮栏若只在 `pointerup` 读一次，就会「固定栏对了、浮栏要再点一下」。正解：**立刻刷 + ~90ms 延迟补读**，并订阅内核 `editor.on('selectionchange')`（与固定栏同源）。真实鼠标拖选 A 段↔B 段实测浮栏与固定栏一致。

---

### 5.11 小记版式（note UI）：`uiSwitch` + `fullscreen` + note 工具条（260919 实机 + bundle 实测）

> 起因：把小记写作区做成「默认一小块（图片/待办 + 右上角展开）→ 展开成完整 Lake 编辑器」，
> 对齐语雀云端小记。**结论：这一整套都在内核里，三条 option 就能开出来；但有两个坑会让它"看起来完全没生效"。**

**一、开 note 版式的三件套（缺一不可）**

```ts
{
  uiSwitch: { default: "note" },            // OptionName = 'uiSwitch'；值 ∈ 'simple' | 'note' | 'small' | null
  fullscreen: { enable: true },             // OptionName = 'fullscreen'；uiType ∈ 'flow'(默认) | 'toolbar'
  toolbar: { agentConfig: { note: { items: [...] }, default: { items: [...] } } },
}
```

- `uiSwitch.default='note'` 的作用（handler 类 `EDITOR_CLASSNAME='ne-note-ui'`）：给编辑根加 `.ne-note-ui`
  （版式 CSS 全挂在它下面）、用 `toolbarType='note'` 注册工具条、并把 `.ne-ui` 里的工具条改成**静态极简**
  版式（图片/待办等 note 项，其余按钮由 CSS 收掉）；同时扩展 `editor.isMiniEditor()/isNoteMiniEditor()`。
- **挂载点必须带 `ne-doc-note-editor`**：note 版式 CSS 全写成 `.ne-doc-note-editor .ne-note-ui …`，
  展开整窗规则是 `.ne-doc-note-editor.ne-ui-fullscreen{position:fixed;z-index:1010}`。内核把
  `.ne-ui-fullscreen` 加在 **`editorNode.parentNode`**（= 我们传给 `createOpenEditor` 的 mount），
  所以这个类必须打在 mount 上（我们：`lake-editor-mount ne-doc-note-editor lakex-note-editor`；
  其中 `lakex-note-editor` 只用来命中内核唯一一条 `.lakex-note-editor .ne-ui-enter-fullscreen{top:6px;right:6px}`）。
- **展开/收起是同一实例切 UI**：`fullscreen` 插件（uiType=`flow`）在 init 时把 `.ne-ui-enter-fullscreen`
  / `.ne-ui-exit-fullscreen` 两个浮动盒挂到编辑根；点击 → `editorNode.parentNode` 加 `.ne-ui-fullscreen`
  （内核 CSS：`position:fixed!important; inset:0; z-index:1000`）→ 发 `enterFullscreen` → note handler
  `hide()`（摘掉 `.ne-note-ui`）⇒ 工具条自动切回 `agentConfig.default`（完整工具栏）、正文回到文档版式；
  收起反向 `show()`。**别用 `uiType:'toolbar'`**：那样退出按钮是 note 工具条里的一项，而展开后工具条
  已切走 ⇒ 没有退出入口。

**二、两个"看起来完全没生效"的坑（都是本轮实际踩到的）**

1. **`document.ready` 不触发 ⇒ note 版式整块失效**。`uiSwitch` 的注册动作、`fullscreen` 的图标渲染
   都挂在 `kernel.once('document.ready')` 上；而**空编辑器不调用 `setDocument` 就永远不会 ready** ——
   症状是「工具条整条空白、右上角展开按钮不渲染、键入也不回传（contentchange 不来）」。
   ⇒ 小记这种"新建即空"的场景必须**无条件 `setDocument` 一次**（我们传单一来源的空正文
   `emptyLakeBody(ownerId)`，见 `src/core/lakeDocForm.ts`）。这也是 HANDOFF §3「小记输入被判定为空」
   的真因。判据：DOM 里 `.ne-editor` 有 `ne-note-ui` 且 `.ne-ui-enter-fullscreen` 有子节点（图标）。
2. **`toolbar.agentConfig` 是整体替换，不是深合并**。只传 `agentConfig.note` ⇒ `getConfig('default')`
   返回 `{}` ⇒ **展开后是一条空工具栏**。必须把 `default` 项一起给出（= 内核内置 `xP` 那一套，
   我们抄成 `DEFAULT_TOOLBAR_ITEMS` 并加护栏单测；内核已 pin，暂不担心漂移）。

**三、note 专用图标不可用（重要）**

内核给 note 版式定义了专属项 `note-image` / `notetaskList` / `note-file`（图标 `note-image` /
`note-checkbox` / `note-file`），但**这些 symbol 不在 kernel bundle 的图标表里**（实测我们页面 416 个
symbol 无一个 `note-*`；语雀页面里的 `#ne-note-image` / `#ne-note-checkbox` 是**语雀 App 自己的 sprite**）。
用了它们 = 按钮有布局、无图形（呈现为空白工具条）。
⇒ 我们改用标准项 **`image`（`#icon-image`）+ `taskList`（`#icon-editor-taskList`）**，二者在 note 版式下
样式与 note 项同源（都带 `ne-ui-toolbar-image` / `ne-ui-toolbar-list` / `ne-ui-toolbar-toggle-button`）。

**附件是例外：必须用 `note-file`**（file 插件只注册了这一个工具项，`toolbar: 'note-file'`，没有别名；
它的 `getInitUIState()` 写死 `icon: 'note-file'`，`onEvent('file', file)` → `insertCardByUI{type:'FileItem'}`）。
缺的那枚 symbol 我们**自补**：`ensureNoteFileIcon()` 往 `<body>` 注入一个同 id 的 `<symbol>`（lucide 纸夹
路径）—— `use` 的片段 id 在**同一文档**内解析，所以不需要任何内核 API 或补丁。多实例幂等（按 id 判重）。

**顺带实测（260930）：内核里没有「文档类型图标」。** 页面 sprite 共 **325 个 `symbol[id]`**，
按 `file|pdf|doc|ppt|word|excel|zip|video|audio|attach` 过滤只命中 `icon-card-mention-doc` 一个；
`ne-card[data-card-name='file'] .ne-card-file-icon` 用的也只是一个通用 `note-file`（就是上面自补的那枚）。
⇒ 云端附件那种「彩色页 + 类型字形（P / 图片 / doc…）」图标属于**语雀 App 自己的 sprite**，内核不提供，
**别再去 bundle 里翻**；要用就用自己的图标库（本仓用 lucide-react，见 `src/features/bitable/FileKindIcon.tsx`）。

**四、语雀云端小记的两种版式（对照基线，260919 实测）**

- **小记视图**：左＝写作卡（工具条 = 图片/待办/书签/附件；右上角展开）+ 发布行，右＝卡片流（时间 + 正文 + 勾选框）。
- **列表视图**（标题右侧分段控件切换）：左＝**索引列表**（约 254px：标题/预览 + 右对齐时间「今天 HH:MM」或「MM-DD」，
  选中行灰底）+ 标签/搜索/更多工具行；右＝**全尺寸编辑器**（完整默认工具栏，无发布按钮 ⇒ 云端是自动保存）。
- 我们按同一套做：`小记` = 写作卡 + 卡片流；`列表` = `b3-list--background` 索引 + `editorMode="document"` 编辑器
  （完整工具栏）；版式是**本机展示偏好**（localStorage，不进 S3）。差异：我们保留显式「保存/小记一下 + 取消」
  （小记是手动保存语义，见 `docs/QUICK-NOTES-SPEC.md`），云端无此按钮。

**五、附件「按类型成卡」的路由在内核哪里（260919 实测）**

- file 插件的工具项固定发 `insertCardByUI{ item:{type:'FileItem', name:'file'} }` ⇒ **一定落附件卡**；
  类型分流在**前置文件读取器**（preFileReader）里，判据是 `category` 与 `from`（`from` 常量 `'ui'`）：
  - image：`from !== 'ui' || category === 'image'` → `uploadImageByFile`
  - video：`(category ∈ {localDoc, video} || useMediaCard) && (from === 'ui' || useMediaCard)` → `uploadVideoByFile`
  - audio：`(category ∈ {audio, localDoc}) && from === 'ui'` → `uploadAudioFile`
  - file：后缀在附件白名单（`acceptUtil.getAttachmentFileAccept`）内 → 附件卡
  file 插件监听**泛化事件** `insertCardByUI`：`execCommand('insertFiles', files, { from: 'ui', category: item.category || item.name })`。
- ⇒ 想让附件按类型成卡，**只需带上正确的 `category` 重发一次 `insertCardByUI`**；`from` 由 file 插件自己补
  （我们拿不到那个常量，也不需要）。两个必须注意的点：
  ① **`name` 必须给**（`{item, name, args:[[file]]}`）——custom-card 插件也监听泛化 `insertCardByUI`
     并执行 `t.name.replace(/^custom-/, "")`，缺 `name` 直接抛 `Cannot read properties of undefined (reading 'replace')`；
  ② 直接 `execCommand('insertFiles', files, {category})` **不带 `from:'ui'` 时不生效**（video/audio 读取器会跳过）。
- 我们落在 `installAttachmentTypeRouting()`（`lakeRuntime.ts`）：在捕获阶段拦「附件」按钮（`.ne-ui-toolbar-file`）
  的 `change`，按 MIME/扩展名算出 image/video/audio/file，非 file 时 `stopPropagation` 后重发上面那条事件；
  图片按钮不接管（内核自己就走图片卡）。实测：paperclip 选 png/mp3/mp4 分别得到图片卡/音频卡/视频卡，
  pdf 仍走附件卡；视频卡拿到 `<video>`、音频卡拿到 `<audio>`（走我们配置的 `createUploadPromise` → 小记 staging）。
- 上传响应约定（沿用文档侧）：**`filename` = 展示名（原始文件名）**、**URL/磁盘名 = `{13ts}_{8hex}.ext`**
  （`electron/resourceRepository.ts` 的 `attachmentOutput` 同口径；小记 `stageFile` 已对齐，展示名经
  `sanitizeDisplayName` 清洗）。
- ⚠️ **媒体卡是两阶段的（260919 实测，写 `.lake` 前必须知道）**：插入图片/视频/音频/附件时，内核**先落一张
  `status:"pending"` 的卡片节点**（`url: null`、只有 `taskId/taskType`），**上传 promise 完成后才回填 url**
  （成功 `status:"done"`，失败 `status:"error"`）。⇒ 在这中间调 `getDocument('text/lake')` 会拿到
  「有卡无 url」的正文：存下来就是一张**永久 pending 的坏卡**（卡片流看不到、一进编辑器就"消失"）。
  判据（`category` 与状态都在卡片值里，两种编码形态都要认）：
  `%22status%22%3A%22pending%22` / `%22status%22%3A%22uploading%22`。
  **结论（我们已落地）：保存前必须等正文里没有 pending/uploading 的媒体卡**（`QuickNotesWorkspace.saveDraft`），
  并且**资源清单以正文引用为准**（`electron/quickNotes.ts`：staging 目录 sidecar ∪ 渲染层 ids，再按
  `body.includes(filename)` 过滤）——两个方向的不一致都能收敛。

**六、我们这边的入口**

**七、小记的白名单与「内核写 / 我们读」分工（260919 用户定稿）**

- **分工**：小记**编辑态挂内核**（保证产出是标准 lake 标记，不手拼），**卡片预览不挂内核**（自研只读渲染）。
  ⇒ 代价从"每张卡一个内核实例（≈+5MB RSS/实例，见 `docs/QUICK-NOTES-SPEC.md`）"
  变成"一个纯字符串解析器"；同时因为没有手拼标记，也就没有"被内核改写"的风险。
- **编辑态外观（260919 最终定稿）**：小记走内核 **note 版式**（`mount.ne-doc-note-editor.lakex-note-editor`
  + `uiSwitch.default='note'` + `fullscreen.enable`）——
  **小卡片 = 最小工具条**（图片 / 待办 / 有序 / 无序 / 分割线，实测 6 个按钮），
  **展开 = 完整工具栏**（`DEFAULT_TOOLBAR_ITEMS` 逐字等于内核默认 `xP`，实测 27 个按钮，与文档页一致）。
  文档编辑器**一个 option 都不加**（挂载点 `ne-doc-major-editor`，能力全量）。
- **对齐手段 = 「+」面板白名单**（`QUICK_NOTE_TOOLBAR_ITEMS` 只管小卡片那条最小工具条；
  「+」面板由 `filterQuickNoteInsert` 过滤，两种状态都生效）：能插的只有
  图片 / 附件 / 视频 / 音频 / 正文·标题 / 有序·无序·任务列表 / 引用 / 分割线。
  **已有内容里的超范围块**（表格/代码块/公式/自定义卡）在预览里降级为占位条，编辑态与保存**原文原样保留**。
  ⚠️ 展开态的完整工具栏里仍有**预览不覆盖**的格式（字号/颜色/背景/对齐/行高/删除线/缩进/素材库/大纲）——
  内容不丢，只是卡片预览看不到这些样式；若要"所见即所得"，可把这些也从展开态工具条收掉。
- **两个裁剪点**（都只在 `restrictedFormats` 分支里；注释见 `lakeRuntime.ts`）：
  ① 工具栏 `toolbar.agentConfig.default.items`（内核这一层是**整体替换**，必须显式给 default）；
  ② 「+」插入面板 `slash.filterOption`（内核官方钩子，签名 `(parsedConfig) => parsedConfig`）
     → `src/features/quickNotes/quickNoteInsertFilter.ts`（按 `mainSearch` 前缀 + 中文 label 兜底过滤）。
  ⚠️ **不要**为了"不给插"而摘掉 `customCard` 注册 —— 未注册的卡在任何一次编辑保存后都会丢（§5.8 末段）。
- **预览解析器的规格 = 内核真实输出**（fixture 见 `src/features/quickNotes/quickNotePreview.test.ts`）：

| 白名单格式 | 内核实际标记 |
|---|---|
| 标题 | `<h1 data-lake-id id><span …>文字</span></h1>`（h1–h6 同形） |
| 无序/有序列表 | `<ul list="u…"><li fid data-lake-id id><span …>…</span></li></ul>`（有序为 `<ol>`） |
| 待办 | `<ul list="u…" class="lake-list"><li … class="lake-list-node lake-list-task"><card type="inline" name="checkbox" value="data:true\|false"></card><span …>…</span></li></ul>` |
| 引用 | `<blockquote data-lake-id id>…内部仍是 p/ul/ol…</blockquote>`（高亮块是 `class="lake-alert …"` 变体） |
| 分割线 | **是块卡**：`<card type="block" name="hr" value="data:%7B%22id%22…"></card>`（不是 `<hr>` 标签） |
| 加粗/斜体/下划线/行内代码 | `<strong>` / `<em>` / `<u>` / `<code>` |
| 删除线 | `<del>…</del>` |
| 字号 | `<span … class="lake-fontsize-18">`（类名里的数字 = px） |
| 字体色 / 背景色 | `<span … style="color: #FF0000">` / `<span … style="background-color: #FFFF00">`（可嵌套，合并时后者覆盖） |
| 对齐 / 行高 | 写在**段落或列表项**上：`style="text-align: center"` / `class="lake-lineheight-2"` |
| 缩进（列表层级） | `<ul list="u…" data-lake-indent="1">`（层级在**列表容器**上；实时 DOM 里是项自身的 `ne-level`） |
| 图片/附件/视频/音频 | `<card type="inline" name="image\|file\|video\|audio" value="data:%7B%22src%22…">`（`src` 里是资源 URL，文件名用于在资源清单里取回真实资源） |

（仍不覆盖：`materialLibrary`（素材库）、`toc`（大纲）——卡片预览里显示占位条。）

- **反向约束**：内核 note 版式工具条项若用 `note-image` / `notetaskList` 等**语雀私有图标**项，本地会渲染成空白
  （见 §5.11 三）；白名单里除 `note-file`（file 插件唯一工具项，自补 symbol）外全部用标准项。
- **展开（fullscreen）必须限定在我们的内容区**（260919 用户报「盖住红绿灯、顶栏也看不到、收起不了」）：
  内核 `.ne-ui-fullscreen{position:fixed;inset:0;z-index:1000}` 是"无外壳编辑器"口径 ⇒
  在小记面板里改成 `position:absolute; inset:0; z-index:30`（容器 `.quick-notes-pane` 加 `position:relative`），
  退出按钮 `.ne-ui-exit-fullscreen` 从 `fixed` 改为面板内 `absolute; top/right:6px`
  （与文档侧 `.ne-ui-max-view` 的适配同款，见 `src/styles/app/editor.css`）。
- **261013 实测修订：上面的 `absolute` 必须带 `!important`。** vendor `src/assets/lakex-doc.css` 的 `.ne-ui-fullscreen` 明确写了 `position:fixed!important`，普通层叠的 absolute 无效（真实 Electron 计算值仍 fixed，mount 顶部 0、退出按钮顶部 6）；`src/styles/app/quick-notes.css` 的现有桌面作用域就地改为 `position:absolute!important`，定位基准回到 `.quick-notes-pane`（窗口顶部 38，= topbar + 4px 拼接缝），底部仍贴面板。属于压过第三方 important 的必要例外，不改 vendor、不另加平台分支；普通小记与移动端不受影响。
- ⚠️ **小记编辑器必须 `disableVirtualRendering: true`**（260919 用户报「输入一个字整片空白 + 编辑态顶部大空白」）：
  虚拟渲染靠 `scrollNode` 量视口，小记没有 Lake 内部滚动容器、fallback 到 `.document-pane` 会量错 ⇒
  正文被替换成 `.ne-virtual-render-placeholder`（顶部被顶下 190px；一输入触发重渲染就整片变占位）。
  移动端早已为此置位（HANDOFF §8 同款坑）——**任何"非文档页里的 Lake 编辑器"都要记得关虚拟渲染**。

- `src/features/editor/lakeRuntime.ts`：`LakeEditorPrefs.quickNoteUi`（`"card" | "full"`）/ `QUICK_NOTE_TOOLBAR_ITEMS` /
  `DEFAULT_TOOLBAR_ITEMS` / mount 类名分支 / `customOptions` 的 note 三件套 / `ensureNoteFileIcon()`。
- `src/features/quickNotes/QuickNoteEditor.tsx`：`{ disableNativeToc:true, quickNoteUi: ui, disableVirtualRendering:true }`
  + 无条件 `setDocument` + **首次可见后才建实例**（`active` 闩，见 §5.12.1）。
- `src/components/app/QuickNotesWorkspace.tsx`：版式切换（`VIEW_KEY`）+ 列表索引 + 附件上传分流（`stageQuickNoteFile`）
  + 卡片交给 `QuickNotePreview`（自研只读渲染，零内核实例）+ 保存前 `hasPendingMediaCard()` 等待
  + 编辑器句柄按草稿 id 存（`draftEditorsRef`）。
- `src/features/quickNotes/quickNotePreviewParser.ts`（只读解析）+ `QuickNotePreview.tsx`（渲染）+ 同名测试（fixture 取自内核真实输出）。
- 护栏：`quickNoteNoteUi.test.ts` / `quickNotesView.test.ts`（源码级）、`electron/quickNotes.test.ts`（stageFile 往返）。
- 卡片预览 = **自研只读渲染器**（零内核实例）：按 `body` 解析白名单块（段落/标题/列表/待办/引用/分割线/
  行内格式/媒体卡），白名单外的块显示占位条。**不挂 viewer/viewer 的替代路线已被用户否掉**
  （每卡一实例 ≈ +5MB RSS，见 `docs/QUICK-NOTES-SPEC.md`）；
  因此「预览显示不了的格式」必须同时从**工具栏**与**「+」面板**收掉（`filterQuickNoteInsert`），
  卡片注册保持全量（§5.8：不能摘，否则老内容里的表/自定义卡一编辑就被内核丢弃）。

**证据（复查方法）**

```bash
cd vendor/lakex-doc-react/src/components/lakex
python3 -  # 搜 uiSwitch / EDITOR_CLASSNAME / 'ne-note-ui' / initFlowButton / enterFullscreen 附近
rg -o --text "ne-doc-note-editor[^{]*\{" ../assets/lakex-doc.css | head
```

实机：小记卡 DOM = `mount.ne-doc-note-editor.lakex-note-editor` > `.ne-editor.ne-note-ui`；
note 工具条 `data-toolbar-name="note"`（2 项），default 工具条 `display:none`；
点展开后 mount 加 `.ne-ui-fullscreen`、`.ne-editor` 摘掉 `ne-note-ui`、工具栏切回 default（27 钮）、
右上角出现 `.ne-ui-exit-fullscreen`（42×42，fixed）。

---

### 5.12 小记二审（260920）实测出的三个内核行为坑

> 起因：用户报「列表页**第一次**打开小记，右侧编辑区左右宽度不适配（换一条小记就正常）」。
> 三条都是"只看源码看不出来、必须实测"的结论，改动前务必先读。

**1) 工具条溢出布局**只在**实例创建时算一次**，之后不随容器宽度重算。**
实测（本机 1413px 窗口、列表视图右侧 1015px）：实例若在 **0 宽**容器里创建，
`.ne-ui-toolbar` 的 `scrollWidth=1064 > clientWidth=961`、`.ne-editor` 横向溢出 76px
（工具条右端被裁、正文区可横向滚动）；容器随后变成 1015px 也不重算，派发 `window resize` 同样不重算，
只有**换一条小记（= 重建实例）**才正常。
⇒ **绝不要在隐藏容器里创建 Lake 实例**。本项目 App 的 keep-alive 视图正是 `display:none`
（`.workspace-view--hidden`，小记工作区在应用启动时就已经挂载、宽度 0），
所以 `QuickNoteEditor` 用 `active`（一路来自 `App.tsx` 的 `visible={desktopWorkspace === "quick-notes"}`）
闩到**首次可见之后**才建实例；并且**一旦建过就不再销毁**（卸载会用陈旧的 `initialBody` 重建 ⇒ 丢正在写的正文）。
判据（复查脚本）：`document.querySelector(".ne-editor").scrollWidth === clientWidth`
且 `.ne-ui-toolbar` 的 `clientWidth === scrollWidth`；任一不等 = 曾在错误宽度下创建过。

**2) 媒体卡 value 的字段名按卡类型不同**（真实 `.qnote` 采样，9 张卡实测）：

| 卡 | 资源 URL 字段 | 展示名字段 |
| --- | --- | --- |
| `image`（行内） | `src` | 无（`name` 也是磁盘名） |
| `file`（行内附件） | `src` | `name`（"报告.pdf"） |
| `video`（块卡） | **`url`** | `name` |
| `audio`（行内） | **`audioId`**（= canonical URL） | `fileName` |

只读 `src` ⇒ 视频/音频卡解析不出文件名 ⇒ 卡片预览一律显示「附件（资源缺失）」（二审现场：一条小记 9 个资源只有 1 个能显示）。
另外 `width/height`：图片才有，附件/视频/音频恒为 `null`（`validateQuickNoteImage` 已按此校验）。

**3) 行内媒体卡是插进「当前段落」的**：「先打字、再点图片/附件」产出的正文形如
`<p><span>文字</span><card type="inline" name="image" …></card><card type="inline" name="file" …></card></p>`；
多张卡也可能落在同一个 `<p>` 里。⇒ 解析段落时**不能**假设"段落里只有一张卡"
（旧实现这么假设，混排段落的卡片会被整段静默丢掉；现改为按卡切分、文字与媒体各自成节点）。

**4) 「附件」按类型成卡要**每个编辑器实例**自己装路由**（260920 用户报「插入附件 mp4 没转视频卡」）：
内核「附件」路径的原始调用是 `execCommand("insertFiles", files, {from:"ui", category:"file"})` ⇒ 一律产出 file 卡
（图片/音频/视频都落成附件条），而原生卡片才内嵌播放/显示。按类型改写 category 的路由在
`src/features/editor/mediaCardRouting.ts`（听 `editing.on("beforeExecCommand")`，改 `args` 或按连续类型段重发），
**仓库里文档侧（`EditorTab`）与移动端各自装了它，小记这套新编辑器当时漏挂** ⇒ 小记里 mp4 永远是附件条、
但卡片预览（按 MIME 渲染）却是可播放的视频 ⇒ 两边观感不一致。修法：`QuickNoteEditor` 里同样
`const detach = installMediaCardCategoryRouter(editor)` 并在卸载时 `detach()`。
实测（小记编辑器内直接 `insertFiles(...,{from:"ui",category:"file"})`）：mp4→`video` 卡、mp3→`audio` 卡、
png→`image` 卡、pdf→仍是 `file` 卡，全部符合预期。

**5) 工具条的「…」溢出菜单没有独立内容**：它是 `ne-ui-toolbar-more-button` 打开的浮层，
`content: this.props.widgets`（bundle 实测）⇒ **装的就是同一批工具项**。所以"收工具栏入口"只要收
`toolbar.agentConfig.*.items`，溢出里自然一起消失（小记因此再去掉 `toc` / `materialLibrary` 两个会插入
预览还原不了内容的入口）。

**6) 卡片里的「展开」定位基准 = 最近的定位祖先**：`.ne-ui-fullscreen` 是 `position:absolute; inset:0`，
而分块视图的卡片 `.quick-note-entry` 是 `position:relative` ⇒ 展开只覆盖**卡片那一小块**（实测 793×274），
工具条被挤成溢出、正文区不够高，页脚动作行还压在正文上（用户 260920 截图 3）。
修法：展开期间让卡片退出定位上下文（`.quick-note-entry.editing:has(.ne-ui-fullscreen){position:static}`）⇒
展开层与页脚都落到 `.quick-notes-pane`，与左侧写作卡展开的观感一致（整面板编辑器 + 右下角动作行 + 右上角收起）。

**7) ⚠️ 实例销毁后热键查表会炸整棵工具条**（260920 实测，用户报「点保存反复闪、保存/取消都点不动」）：
内核 hotkey 插件的 `destroy()` 会 **`delete this._named`**（bundle line ~154560），而工具条每个按钮渲染时都要
`getTooltip → renderer.getHotKeyByName(name) → this._named[name]`（line ~112132 / 154613）⇒ **销毁之后再渲染一次**
就抛 `TypeError: Cannot read properties of undefined (reading 'undo'/'slash'/'hr'/…)`。
这是 **React 渲染期抛错**：整棵工具条（进而整个小记面板）崩掉并不断重试 ⇒ 用户看到面板**反复闪烁**、
而且 `hasExtendMethod("getHotKeyByName")` 仍为 true（插件先于 hub 销毁），所以每次渲染都会再抛。
现象特征：控制台/日志里出现**一串**（每个工具项一条）同名错误，而不是一条。
复现：列表视图里连续「保存 → 取消 → 换条目」（本会话实测 12 秒内 20+ 条，脚本化复现一次 41 条）。
**修法**（`src/features/editor/lakeRuntime.ts` 的 `hardenDestroyedHotKeyLookup`，对每个实例生效、对健康实例透明）：

```ts
const r = editor.renderer;
const orig = r.getHotKeyByName;
r.getHotKeyByName = function (name) { try { return orig.call(this, name) ?? null; } catch { return null; } };
```

⇒ 迟到的渲染只丢一个快捷键提示，不再炸 UI（实测同一压力脚本错误数 41 → **0**，分块视图 4 轮编辑/展开/保存/取消同样 0）。
**任何"销毁旧实例 + 立刻重建新实例"的编辑器生命周期都有这个风险**（小记切草稿、换条目、保存后重建都算），
所以补丁挂在 `createLakeDocument`（文档与小记共用）而不是只挂小记。

**8) ⚠️⚠️ 展开层的定位基准会被**任意祖先的 `transform` 悄悄改掉**（260920 最终定位的真凶）：
`.ne-ui-fullscreen` 是 `position:absolute; inset:0`，按**最近的定位祖先**定位；而 CSS 规范里
**`transform`（以及 `filter`/`perspective`/`contain:paint`/`will-change:transform`）会让元素成为
绝对定位后代的定位基准** —— 即使它是 `position:static`。
我们的卡片有一条「按压缩放」反馈（`src/styles/quick-notes.css` 的 `.quick-note-entry:active{transform:scale(.98)}`）
⇒ **鼠标一按下**，卡片瞬间变成展开层的定位基准 ⇒ 展开层高度 810 → 约 220（塌回卡片那一小块）、
鼠标下的「保存/取消」跟着跑掉 ⇒ **真鼠标点击完全没反应**（mousedown 落在按钮上、mouseup 时同一点已经是卡片，
`click` 派发到共同祖先，按钮的 onClick 永不触发），而且伴随**面板一闪一闪**（按压缩放来回切换）。
⚠️ 迷惑点：**合成 `element.click()` 绕过命中测试，所以脚本/自动化测着是"好的"** —— 这类问题必须用
**真鼠标事件**验证（CDP `Input.dispatchMouseEvent` 或人手点）。
修法：编辑态卡片禁止按压缩放（`.quick-note-entry.editing, .quick-note-entry.editing:active { transform: none }`）。
排查口径：任何"挂在内核展开层/绝对定位层旁边的自定义 UI 点不动"，先量**祖先的 computed transform**
（`getComputedStyle(el).transform !== "none"`）+ 对比 `mousedown`/`mouseup` 两帧的 `elementFromPoint`。

**9) 媒体卡是"两阶段"的：先 `status:"pending"` + `url:null`，上传完成后才回填 `url`**（260919/260920 实测）。
⇒ 保存策略要和大盘对齐：**文档侧（`useWorkspaceState`/`EditorTab`）对 pending 卡不做任何等待/拒绝**，正文原样存下；
小记同理 —— 只有"本会话真的在传"才等（15s 上限 + 刚传完 2s 内的 1.2s 收尾窗口），
**上次会话中断留下的死卡**（无上传在传）直接照存 + 提示，绝不把编辑器锁死。
死卡的判据：正文里能搜到 `%22status%22%3A%22pending%22` / `"status":"pending"`（或 uploading）而本次会话没有上传在进行。

```bash
# 复查：直接读某条小记的正文/资源清单（dev 库）
cd ~/Library/Application\ Support/local-lakex-notes-dev/workspace-default/quick-notes
python3 - <<'PY'
import json,re,urllib.parse
d=json.load(open('items/<id>.qnote'))
for m in re.finditer(r'<card\b[^>]*>', d['body']):
    tag=m.group(0); raw=re.search(r'value="([^"]*)"',tag).group(1)
    print(re.search(r'name="([^"]*)"',tag).group(1), json.loads(urllib.parse.unquote(raw[5:])))
PY
```

**10) 内核没有"不建实例就把文本转成 Lake 正文"的能力**（260920，小记轻量框选型核实）：
官方两条路都依赖实例 —— `setDocument('text/markdown'|'text/plain'|…)` 需要**编辑器实例**
（`yuque-developer-docs/docs/07 - API与事件`）；`markdownStream`（`markdownDataSource` 插件）需要先创建
**阅读器实例**（官方 `docs/09 - markdown流展示`：*"在完成阅读器的创建之后"*）。
⇒ 没有内核实例的写入者（移动端轻量速记框、主进程）**无法让内核产出正文**，只能走
`src/core/lakeDocForm.ts` 的**卡片容器**单一来源（`quickNoteBodyFromTextAndImages` 即此），**绝不自造裸标签媒体**。

### 5.14 图片浮动工具栏：云端结构 / 图标 / 子菜单（260924 浏览器实拍 + 仓库源码核对）

> 结论先行：**云端图片工具栏是 `.ne-card-toolbar` 一族（不是文字栏的 `.ne-ui-toolbar`）**，而且它的
> 结构类、图标、文案**大部分本来就在我们 vendored 包里**；只有 2 个图标本地没有、只能从云端运行时抓。

**1) 结构 / 顺序（云端实拍 DOM，2026-09-24）**
```
.ne-card-toolbar
  .ne-card-toolbar-item                          纯图标（旋转 / 裁剪）
  .ne-card-toolbar-dropdown-item[-has-title]     图标（+文字），可下拉（宽高 / 链接 / 边距）
  .ne-card-toolbar-select-item[-has-title]       图标（+文字）+ .ne-card-toolbar-arrow-down-icon（对齐 / 样式 / 批量）
  .ne-ui-card-toolbar-divider                    1×16 分隔线
顺序：旋转 · 裁剪 · 宽高 | 链接 · 描述 | 对齐 · 样式 · 边距 · 批量
```
- 样式**全在内核 CSS** `vendor/lakex-doc-react/src/assets/lakex-doc.css`（`grep -c ne-card-toolbar` = **76**）：
  容器 `inline-flex; padding:6px 12px; radius:4`；`-item` 28×28 + `margin-right:4`；`-dropdown-item` 28×28/padding 5；
  `-select-item` 38×28；`-has-title` = `width:auto; line-height:28` + `span{margin-left:4}`；`input` 宽 54。
- 下拉箭头 = `.ne-card-toolbar-arrow-down-icon`，背景图是远程 svg `…/d5fce5b0-cd60-43b0-a351-9463486be4d2.svg`
  （**本地已镜像**：`public/vendor/cdn/zos/bmw-prod/d5fce5b0-….svg`）。

**2) 图标（`vendor/lakex-doc-react/src/components/lakex/icon.tsx`，13 个本地 `ne-*` symbol）**
- **本地已有**：`ne-t-image-crop / -rotation / -size / -title / -style / -reset`、`ne-t-link`、`ne-t-batch-apply`、
  `ne-check`、`ne-o-unlink`、`ne-o-visit-link`、`ne-card-tb-card-view / -title-view`。
- **本地没有、只能从云端运行时抓**（精确 `<symbol>` 路径已落地 `src/features/editor/selectionToolbar/imageIcons.tsx`）：
  **`ne-t-alignment-center`（对齐）** 与 **`ne-c-tb-spacing`（边距）**。抓法：浏览器 → 语雀编辑态 → 选中图片 →
  `browser_inspect html` → 页面内联 sprite 里的 `<symbol id="ne-…">`（viewBox 有 256 与 14 两种）。

**3) wrapper 里另有一套自研实现（走了我们不走的路径）**
- `vendor/lakex-doc-react/src/components/plugin/imageToolbar/ImageToolbar.tsx`(30KB) + `ImageToolbar.css`(8.6KB)：
  自带 `.ne-image-toolbar` 类 + **硬编码色**（`#ffffff/#e5e6eb`），含宽高（百分比）/样式/链接弹层；文案在
  `components/plugin/i18n.ts`（`image.size.title=宽高`、`image.link.placeholder=请输入网址`…）。
- 它**只被 vendor 的 `LakexEditor` 引用**；我们应用直接 `Doc.createOpenEditor`（`lakeRuntime.ts:881`）⇒ 从不运行。
  **教训**：vendor 组件可能挂在「不用的入口」上 —— 按能力找，不要按调用栈找。

**4) 子菜单内容（云端实拍，260924）**
- 宽高：`宽 [600]` `高 [450]` + 百分比 `25% / 50% / 75% / 100%`（档位高亮）。
- 链接：输入框占位「请输入网址」+ ☐「在当前页面打开」（勾选 ⇒ `linkTarget:""` 本页打开）。
- 对齐：左对齐 / 居中对齐（✓）/ 右对齐，**每项带对齐图标**。
- 样式：无样式（✓）/ 图片描边 / 图片阴影。
- 边距：「为图片添加上边距」/「为图片添加下边距」两个**开关**。
- 批量应用：同步图片样式到全文 / 同步图片宽度到全文。
- **描述：没有弹窗** —— 直接在图片下方出现内联编辑框（内核 `.ne-image-title` 里的 `.ne-image-title-content`，空时显示占位「添加图片描述」）。

**5) 两个易错的语义（别用自造字段）**
- **对齐是块级属性**：`alignment` 命令 → 块上 `ne-alignment`（CSS `[ne-alignment='center']{text-align:center;justify-content:center}`）；
  `cardValue` **没有** `alignment` 字段（曾误写进 `cardValue.style`，与「样式」互相覆盖）。
- **边距是 card spacing**：`cardValue.__spacing` ∈ `both/top/bottom`（cardData `setCardSpacing`，值枚举 TOP/BOTTOM/BOTH）；
  `updateImageData({margin})` **内核不认**（曾用错字段）。

**6) 图片卡右上角内层「复制」按钮：写内核私有 `ne-clipboard`，必须改接我们的入口（260924 实测）**
- **DOM**：`.ne-image-wrap > .ne-ui-image-inner-button-wrap > button.ne-ui-image-inner-button`，图标 `div.ne-icon-action-copy` / `.ne-icon-action-delete`；
  小图（显示宽或高 ≤46）合成「更多」菜单 `.ne-ui-image-inner-menu`（antd portal 到 body），菜单项复用同一图标。
- **按钮动作**（bundle 152968 `ef2.copy.execute`）：`range.selectNode(cardRootNode.parentNode); editor.execCommand('copy', range)`；
  clipboard 插件命令表 `pluginName:'clipboard', command:{copy:'copy',cut:'cut',paste:'paste'}`（bundle 78175）。
- **实测结果**：剪贴板只得到 `text/html` = `<meta charset=utf-8><ne-clipboard data="<percent-encoded fragment>">`，
  图片在片段里是 `"src":"http://127.0.0.1:<port>/…webp"`（canonical URL）⇒ **粘到外部应用（微信/Word/浏览器）拿不到图片**
  （内核仍提示「复制成功」）；我们的 `copyRichSelection` 捕获处理器在这条路径上不生效（内核不把 DOM 选区设成该 range）。
- **修法（应用侧，不改内核；AGENTS §3 #18）**：`src/features/editor/imageCopyBridge.ts` —— 接管**两条**路径，均改调 `native.copyAssetImage`
  （与右键「复制图片」同路；webp/avif 会转 PNG）：① document **捕获阶段** click 命中 `.ne-icon-action-copy` 时 `stopPropagation` 阻止内核 onClick；
  ② **捕获阶段 keydown** 命中 mod+C（⌘C / Ctrl+C）且**无文字选区**时 `preventDefault + stopPropagation`，拦截内核键盘复制。
  实测两条路径剪贴板都由 `ne-clipboard` 变成 `image/png`；**文字选区 / 外链 / data URL 图不接管**、交回内核（指针落回正文会清除「当前图片卡」）。
- ⚠️ 该 bridge 只装在**桌面入口** `src/main.tsx`（移动端未装，移动端是另一套复制链路）。

### 5.15 粘贴内容的样式处理：内核会剥离字体族（260924 实测）

> **结论：内核在粘贴/解析 HTML 时就把 `font-family` 全部剥掉**（解析 → DOM → 落盘三处都没有字体族）⇒ 我们的 MiSans
> （CSS 令牌 `--lake-font-family`）不会被外部字体污染，**应用层无需做任何适配**。

实测方式：在**一次性临时笔记**里合成 `paste` 事件，注入带各种字体写法的 HTML，再读渲染 DOM 的 `getComputedStyle` 与落盘的 `.lake`（验完即 purge）。
- **保留**：`font-size` → `class="lake-fontsize-N"`（N = px×0.75，pt 口径）；`color` / `background-color` → `<span style="color:…; background-color:…">`；加粗/斜体/下划线/删除线/链接等 mark。
- **剥离**：`style="font-family:…"`（含 `!important` / `inherit`）、`font:` 简写、`<font face="…">`、Word 的 `mso-fareast-font-family` / `mso-bidi-font-family`、`<style>` 块、外部 `class` 名 —— 渲染后 `fontFamily` 恒为 `MiSans…`，落盘 `.lake` 里 `font-family|font:|mso-|<foreign font name>` **0 命中**。
- **机制**：内联样式经内核样式映射器 `Bn`（bundle 95165）转换，仅 `background-color`/`font-size`/`text-decoration` 有专门映射，其余落通用分支；`font-family` 不在模型支持集、**不会写回**（`ne-text` 的 `style` 只剩 color/bg）。
- **取舍**：这是对的 —— 字体应来自主题（我们 = `--lake-font-family` 令牌），内容只承载字号/颜色等语义。**不要**为"让粘贴匹配当前格式"再加
  `font-family: var(--lake-font-family) !important` 之类覆盖：会压掉代码块等合法的等宽字体，且属过度设计（AGENTS §3 #17）。

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

- **任务 T1（待办，HANDOFF §3）**：新增 `src/features/editor/lakex-contract.d.ts`（§4 清单），替换 lakeRuntime 等处的 `as any`，纯类型改动 + 门禁全绿。
- **实验 E1/E2（换核决策前置）**：真实 .lake ↔ lakelib 双向解析；lakelib 大文档渲染。详见工作区根 `lake-kernel-swap-analysis-260908.md` §9。
- 本文件由 260908 只读评估生成；落地/回填后在此追加更新日志（一行一条，勿删历史）。
- 2026-09-11：新增 §5.1（原生编辑 TOC 侧栏填充时序：空 toc 创建 + 1s 节流 + 直接 `_tocSidebar.update` 绕过节流），§4.2/§5 表补对应条目。来源：HANDOFF §2.15–2.16、lakeRuntime.ts `refreshTocSidebar`/`findNativeTocSidebar`。
- 2026-09-16：§5.1 修订「点击定位」为 `allowModifyHash` 真相（内核 TOC 点击会写 `location.hash` → 触发锚点导航滚 html，导致整壳上移；修法 = 关 `allowModifyHash` + 锁 `html,body` overflow），补「`toc` option 是扁平 schema」；新增 §5.4（阅读态 Viewer 大纲：另一套类名/挂载时机、官方 `toc.getContainer` 与 `boundaryTopOffset`、点击跳转链路）与 §5.5（编辑态↔阅读态渲染模型差异、节点锚点恢复位置、窗口后台不渲染的 CDP 陷阱）；§6.6 更新为三级资料检索顺序（用户立规）。来源：260916 会话核实的 bundle 行号与 CDP 实测。
- 2026-09-17：新增 §5.8（块级编辑：能力在 wrapper 层而非内核；动作→实现路径映射；`utils/blockDoc` 整篇 JSON 读改写的实测破坏 —— 正文 6032B→12288B、思维导图卡载荷 634B→8859B、未注册卡被整张抹掉；「转化为」各目标的原生命令实测表与代码块缺口；`editor.execCommand` 与 `renderer.execCommand` 在 indent/outdent 上的差异；`breakLine` 实现「在下方添加」而官方 `insertAtSelection` 实测无效；未注册遗留卡在任何一次保存后丢失）。来源：260917 会话在副本上的实测（`scripts/e2e-block-menu-smoke.mjs`）+ `yuque-developer-docs` 命令列表三级检索。
- 2026-09-17（复核）：新增 **§5.8.1** —— **更正**「`insertAtSelection` 实测无效」为**有效**（`readData`→`insertINode`；折叠=插入、非折叠=替换、失败返回 `null`）；确认它是「插入带内容容器」的正规通道（内核自动补 `alertHole`/`containerHole`），配 `getNodeContent` 可一次性把段落替换成含原文的 alert/columns/collapse；命令级仍无转换命令（`quote` 是唯一 wrap）；代码块可用 markdown 围栏或 `insertCard`+`setCardValue` 写入；补规范 lake markup、`queryCommandEnabled` 不可靠、147 命令注册表、原生 `moveCard/moveCollapse/moveColumns/...` 的存在。来源：`docs/LAKEX-CONTRACT.md`（副本 CDP 实测 + bundle 源码）。
- 2026-09-17（命令清单）：新增 **§5.9** —— 用 balanced-brace 解析 bundle 的 `kO({pluginName, command})`，落地**完整命令注册表 = 43 插件 / 147 条 kO 命令 + 4 条命令式（alert 族）= 151**；给出「块编辑命令 → 我们现状」（已用 / 未用 / 内核无对应）与三条候选原生化改造；澄清 `ISelectionHelperService` 是**工具栏注册服务、不是块选择 API**；记录多块选择 = DOM Range + `blockSelectionChange`/`unblockSelectionChange`，**内核无批量转化命令**。来源：`vendor/lakex-doc-react/src/components/lakex/lakex.js` 静态解析（脚本随 §5.9）。
- 2026-09-19：新增 **§5.10**（浮动工具栏：内核 miniToolbar 只覆盖卡片/容器，无文本选区浮栏；`Doc.FrameworkUiLib` 浮层原语；固定工具栏的两条官方路；对照钉钉/云端实测）与 **§5.11**（小记版式 note UI：`uiSwitch.default='note'` + `fullscreen.enable` + `toolbar.agentConfig.note` 三件套；`ne-doc-note-editor` 挂载点类；展开 = `.ne-ui-fullscreen` 挂 `editorNode.parentNode` 且同一实例切回默认工具栏；**两个坑** —— 空编辑器不 `setDocument` 则 `document.ready` 不触发导致 note 版式整块失效、`agentConfig` 是整体替换导致展开后工具栏为空；**note 专用图标 `note-*` 不在 kernel sprite**（语雀 App 私有）⇒ 图片/待办改用 `image`/`taskList`、**附件只能自补 `#note-file` symbol**；附录一：云端小记「小记视图 / 列表视图」两种版式的对照基线；附录二：**附件按类型成卡的路由**（pre-reader 按 `category`+`from:'ui'` 分流、泛化 `insertCardByUI` 必须带 `name`、直接 `insertFiles` 不带 `from` 不生效、展示名 vs 磁盘名约定））。来源：本会话 bundle 静态解析 + 真实 Electron 实测 + 语雀云端小记对照（browser-skill 观察）。

### 5.13 画板（Drawnix/Plait）：内核卡片 ↔ 独立画板文档（260920 调研 + 实机）

**结论：画布引擎与 Lake 内核完全解耦，可以脱离编辑器独立挂载（`kind=board` 独立画板文档）。**

1. **组件契约**：`vendor/lakex-doc-react/src/cards/DrawingBoard/DrawnixBoardCore.tsx` 的 props = `{ value, readOnly, locale, theme, ai, onChange, onViewportPersist }`。
   它**不 import 内核**（`lakex.js` / `Doc` 计数 0），其 5 个本地子组件也只依赖 `@plait/*` + `lakex-drawnix` + `react-dom`。
   卡片侧那层 `DrawingBoardEditor` 才需要 `ICardProps`（`cardValue`/`updateCardValue`/`editor`）与 `CardResizer` —— 独立文档用不到。
2. **「只做画图」是原设计的自然结果**：`.lakex-drawnix-core .app-toolbar { display:none !important }`（文件/分享菜单在卡片阶段就被隐藏）。
   实机工具条 = 手型 / 选择 / 思维导图 / AI 助手 / 文本 / 画笔 / 箭头 / 形状 / 图片 / 导出（PNG·SVG）；「形状」开图形库（基础图形 + 流程图 + UML 符号）。
3. **数据格式互通**：卡片值 `plaitValue` == 独立正文的 `elements`；`src/core/boardDoc.ts` 提供双向搬运 + 归一化。
4. **`previewImage` 是卡片专用**：卡片每次改动 250ms 后把整幅画布导出成 PNG data URL 写回卡片值；
   实测一篇带画板卡的 `.lake` = **455KB，其中 413KB（91%）是这张 PNG**，而 `plaitValue` 只有 10KB 级。
   独立画板正文（1 个矩形）= **271 字节**，只有 `kind/version/engine/preset/elements`。
5. **分包与懒加载（务必守住）**：`DrawnixBoardCore-*.js` 343KB raw / 118KB gzip + `drawnix-*.js` 1488KB / 415KB gzip，**必须留在独立 chunk**。
   ⇒ vendor 对外暴露画布核心**只能用懒加载器**（`loadDrawnixBoardCore()`）；写成 `export { DrawnixBoardCore }` 会让 vendor 入口静态依赖它，
   构建立刻报 `INEFFECTIVE_DYNAMIC_IMPORT`，`DrawnixBoardCore-*.js` 分包消失、首屏多背 ≈500KB gzip（实测复现过）。
6. **CSP**：`lakex-drawnix` / `lakex-drawnix-react-board` / `@xiangfa/mindmap` 的 `eval`、`new Function` 计数均为 0（画板不受无 `unsafe-eval` 约束影响）。
7. **视口**：`onViewportChange` 是 no-op（LOCAL-CHANGE #8，防 pan/zoom 触发保存）。独立画板若要「记住上次看到哪」，
   用**被动回调** `onViewportPersist` 存 ref、只在保存时写进正文，**不要回灌 value**。
8. **图片**：工具条有图片入口（文件选择 / 粘贴 / 拖放），引擎把图**内联成 data URL** 写进场景元素（`data/image.d.ts` 的 `insertImage`/`buildImage`）。独立画板文档由宿主做**提升**：data URL → `note-assets/{noteId}/` 资产文件（写盘口径 = canonical URL，内存口径 = data URL，见 `docs/STORAGE-LAYERS.md` §九）。
   ⚠️ **导出/预览会 fetch `<img src>`**（`convertImageToBase64`）⇒ ① 跨源资产 URL 会被资产服务的 CORS 规则拦（所以内存保留 data URL）；② `connect-src` 必须放行 `data:`，否则画板带图导出 PNG/SVG 静默失败（既有缺陷，260920 已修）。
9. **语雀侧的文档类型枚举**：内核 `getIconClassName` 白名单 = `['doc','sheet','design','thread','board','mind']`，镜像含 `doc-type-{default,sheet,table,board}.svg` ⇒ 画板/思维导图在官方形态里本就是文档类型。
10. **蓝点快创（auto-complete）的提交语义**（260920 bundle 静态解析 + 实机）：
    plait 的 `withArrowLineAutoComplete`（`@plait/draw`）分两条路——① 在蓝点上**按下并拖动**（> `PRESS_AND_MOVE_BUFFER*2`）只建**连线**；
    ② **悬停**蓝点会出现幽灵形状（`BOARD_TO_PRE_COMMIT`），**再单击**才同时插入「连线 + 形状」。
    提交时的形状由 `createDefaultGeometry(board, points, originElement.shape)` 决定 ⇒ **永远复制源形状的类型**（圆→圆、方→方），
    plait **没有**「先选形状再创建」的钩子。云端语雀的做法是弹「最近使用 / 基础图形」面板让用户挑。
    - **不补丁的做法（LOCAL-CHANGES #20，兜底/或不想动上游时）**：判定「选择态下 pointerup 后画布新增了单个 geometry」= 快创提交 →
      弹面板 → 选中后 `addSelectedElement` + `DrawTransforms.switchGeometryShape(board, shape)`
      （内部 `Transforms.setNode({shape})` + 重算已绑定连线）+ `memorizeLatestShape`。缺点：形状先落地成副本、选完再替换。
    - **补丁的做法（LOCAL-CHANGES #21，当前采用）**：`patches/@plait+draw+0.93.4.patch` 给上游加一个注册表
      `setAutoCompleteCommitHost(board, host)`：`globalPointerUp` 里 pre-commit 的插入块改为「有 host 就交给 host」，
      host 拿到 `{clientX, clientY, shapeElement, arrowLineElement, commit(shape?)}` —— 宿主弹面板，**选完才 `commit(shape)`**，
      `commit()` 不带形状 = 上游原行为（源形状副本）。补丁不碰几何/连线/绑定：`commit` 内部仍复用原来的
      `Transforms.insertNode(arrow)` + `insertElement(shape)`（只是把 `shape` 换掉，元素 id 不变 ⇒ 绑定不破）。
      效果：**点蓝点只弹面板、画布上还没有新形状**；Esc/点外面 = 落地源形状副本（老习惯不变）。
      补丁另给 host 加了 `hoverPreview: false`：**关掉悬停预览的全部视觉**（放大蓝点 / crosshair / 幽灵形状 / 预览连线；连线预览由 `handleArrowLineCreating` 自己 append，补丁给它加了 `suppressPreview` 形参），但保留「悬停→预提交、单击→提交」的状态机 —— 实测悬停期间画布 SVG 元素数不变（104→104）、无 crosshair；我们传了 `hoverPreview: false`。
      文档内嵌的画板卡与独立画板共用同一个 `DrawnixBoardCore` ⇒ **该能力两端同时生效**（卡片实测：卡内画矩形 → 点蓝点 → 选「判断」⇒ 卡片 value 变为 `[rectangle, elbow, decision]`）。

实机验证（隔离 userData + CDP 驱动真实 Electron）与剩余风险见 `docs/STORAGE-LAYERS.md`。

---

## 8. 证据来源与复查方法

- bundle：`vendor/lakex-doc-react/src/components/lakex/lakex.js`（内核 ESM 转换产物；grep 类名/路径/断言串采样即可，勿整读）；原始 UMD 为同目录 `doc.umd.js`。
- 类型/README：`vendor/lakex-doc-react/src/components/lakex/*.d.ts`（含 9 行 lakex.d.ts 自白）、`vendor/lakex-doc-react/dist/index.d.ts`、`README.md`、`LICENSE`。
- 应用锚点：`src/features/editor/lakeRuntime.ts`（实例化 540-815、私有字段 466-905、命令 454-538）、`EditorTab.tsx`、`LakeEditor.tsx`、`editorCommands.ts`、`canvasInteractionGate.tsx`、`mediaCardRouting.ts`、`attachmentPreviewController.ts`。
- 镜像/注入：`public/vendor/cdn/**`、`electron/cdnRedirect.ts`、`electron/assetServer.ts`。
- 评估全文档：工作区根 `lake-kernel-swap-analysis-260908.md`（差距矩阵/换核结论/许可观察）。
---

### 5.13.1 画板 AI 助手：内核只给一个 `generate` 钩子（261003 接通 + 实机验收）

- **配置驱动**：`DrawnixBoardCore` 的 `ai?: DrawingBoardAIConfig` 给了才渲染 `LakexAIBoardAssistant`（工具栏绿色徽标 + 生成面板 + `applyAIGeneratedElements` 落元素）；**不给就连按钮都不渲染**（不是"有按钮点了没反应"）。dist 里对应 `P = l ? (...lakex-ai-board-trigger-wrap)`。
- **契约**（`vendor/.../components/lakex/types.ts`）：`DrawingBoardAIConfig = { generate(request) => Promise<string | Record<string, unknown>> }`；`request = { description, systemPrompt, contextPrompt?, history?, currentBoard?, locale, signal? }`。
  - `systemPrompt` = 内核自带的画板 JSON 规范（实测 **8450 字符**，源自 `docs/lakex-drawing-board-json-format-skills.md`，可直接当 system message）。
  - `contextPrompt` = 历史需求 + **当前画布唯一一份最新 JSON** + 本轮需求；内核注释：**业务侧应优先把它当 user message 发送**（我们照做）。
  - `signal` = 关闭面板时 abort，用于取消业务侧请求。
  - 注释原话：「前端画板不会保存 API Key，也不绑定具体模型」⇒ 与本项目「Key 只在主进程」的架构天然对齐。
- **返回值形态**由 `parseAIBoardResponse` 判定：① 原生 `{ plaitValue | elements: [...] }`；② 中间格式 `{ version:1, diagramType?, nodes:[≤80], edges:[≤120] }`（JSON 字符串或对象皆可）。中间格式约束：`node.id`/`edge.id` 只允许 `[A-Za-z0-9_-]+` 且全局唯一、`source/target` 必须指向已声明节点且不能自环、`shape` 取 `shapeMap` 白名单（`rectangle`/`roundRectangle`/`ellipse`/`diamond`/`terminal`/`decision`/`process`…）；给了 `diagramType` 时形状还必须属于该图类型白名单。
- **本项目的接法**（`src/features/board/BoardEditor.tsx`，唯一改动点）：`ai={{ generate }}` → 组 `[system=systemPrompt, user=contextPrompt ?? description]` → 交给**既有** `runAiChat`（主进程 `ai_chat`，Key 不出主进程、不新增 IPC）；`request.signal` abort → `cancelAiChat`；**只读（锁定/回收站）不传 `ai`**（AI 会往正文落元素，属写操作）。
- **长度**：主进程 `ai_chat` 入参上限 = 40 条消息 / 20 万字符 ⇒ 大画板会把整张画布 JSON 顶到上限，接的时候要先算总长并给中文提示（本项目阈值取 19 万）。
- 实机（261003 · mock）：mock OpenAI 兼容端点收到 `stream:true` + system 8450 / user 243 字符；生成后画布出现「开始→判断→是→结束」；取消时上游连接**真的被中断**（服务端观测到 abort）；锁定画板徽标消失、解锁复现。
- 实机（261003 · **真实 DeepSeek**）：`deepseek-flash` + 思考默认开（effort=high）下，喂「用户登录流程图（含失败重试）」**约 10s** 返回 18 个元素，「是/否」两个分支 + 失败回环 + 「锁定账号」终止都正确，并自动落盘 5.9KB；同一把 Key 在编辑器选区 AI 上「翻译成英文」6s 返回正确译文。
  ⚠️ **模型不传 `width` 时按本文件默认 180px 出节点**，长文本会被截断（实测「输入账号和密码」→「输入账号和密」）。要修应在宿主侧按文本估宽，别改 vendor 的 `aiBoardSchema`。

---

### 5.17 AI 供应商侧（非内核）：真实 DeepSeek 实测结论（260930）

> 这一节记的是**供应商 API**（不是 lakex 内核）的真实行为，来自「本地 mock 端点 + 真实 DeepSeek 账户」实测。

- **`GET {baseUrl}/models` 可用**：`https://api.deepseek.com/v1/models` 与 `/models` 都 200；返回**富结构**：`{ id, name, context_window, max_output_tokens, input_modalities, output_modalities, effort: { supported_levels: ["low","high","max"], default_level }, api_capabilities }`。
  ⇒ 官方 `openai` SDK 的 `client.models.list()` 能解析（实测 `deepseek-flash, deepseek-v4-pro`）。
- **思考相关参数**（官方文档 + 实测均确认）：`reasoning_effort: low|high|max`（思考模式默认开、默认 `high`）；开关是 `thinking: { type: "enabled"|"disabled" }`；**思考模式下 `temperature` 不生效**（传了不报错、也不生效）。我们默认发的 `thinking:enabled + reasoning_effort:high` 被 `deepseek-chat` / `deepseek-v4-pro` 正常接受。
- **模型名写错返回 400 而不是 404**，body 是英文原文：`The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed <name>.` ⇒ 只按状态码归类会漏；`src/core/aiErrors.ts` 因此改为**先按错误类名、再按文案关键词**（含 `supported api model names`），归到 `not_found` + 中文前缀（保留原文里的支持列表）。
- **Key 无效**：`401`，归到 `auth`（"API Key 无效或已失效"）；`aiTestProvider` 回传 `retryable:false`，UI 硬拦保存。
- **账户现状**（260930）：模型为 `deepseek-flash`、`deepseek-v4-pro`；旧名 `deepseek-chat` 仍可作别名调用但**不在 /models 列表里**。静态兜底目录已据此更新，**拉取成功时以接口返回为准**。

---

### 5.16 AI 助手：内核插件形态 + 「替换/后插选区」的正确接法（260930 云端 bundle 取证 + 真机验证）

**云端语雀的 AI 面板是内核插件，不是页面自己写的**（扒云端 240 个 bundle，命中 `doc_editor.*.async.js`）：

- 注册：`pluginRegister({ pluginName:"ai", command:{ aiInsert, aiInsertCard, aiDelete }, service:{ IAIEditorService, IAIViewerService }, toolbar:{ deepSeek } })`，默认选项 `{ api:"", showSelectToolbar:true }`；工具条项类名 `ne-ui-toolbar-deep-seek`。
- 「替换选中内容」= `kernel.execCommand("aiInsert", { dataType:"text/plain", data, select, insertAtAfter:false })`；「插入选区下方」= 同命令 `insertAtAfter:true`。
- `AIInsertCommand.execute` 拿 **job 的当前选区**做 `SelectionUtil.insertINode`（非折叠=替换）；插件自设 `plugin.ignoreSelectionChange = true` 护住选区 ⇒ 浮层抢焦点也不塌。

**我们 vendored 内核（`@alipay/lakex-doc` v1.99.0）这几样全无**：`aiInsert`/`aiInsertCard`/`aiDelete`/`deepSeek`/`ignoreSelectionChange` 实测计数皆为 0；公开 npm 也没有（同族 `@lakex-react/core@0.2.1` 同样为 0）。

**自己拼的正确接法（已真机验证 ✅）**：

1. **打开 AI 面板前**捕获**内核模型选区** `kernel.document.selection.firstRange` 的 `{start:{node,offset}, end:{node,offset}}`（模型态；浮层抢焦点也不丢）—— `aiModelSelection.ts` 的 `captureModelRange()`。
2. **替换**：用内核 `selection` 命令把选区设回 `{start, end}`，再 `insertAtSelection("text/plain", text)` —— 非折叠即替换（`applyModelRange()`）。
3. **插到选区之后**：把内核选区设成**折叠在 `end`**（`{start: end, end: end}`）再 `insertAtSelection`（`applyModelRangeAtEnd()`）。
4. 真实鼠标选中下实测：替换成立，且焦点在编辑器时 **⌘Z 可撤销**。

**反面教材（都试过、都不通）**：`renderer.toViewRange`/`engine.transformDOMRange` 一律返回 null（`dM→dF→cv` 拿不到 view node）；`createModelRange(...)` 当第三参传 `insertAtSelection` → no-op；浏览器 `insertText` / 聚焦+恢复 DOM Range → 插到起点或 no-op；官方 `insertText`/`insertAtSelection` 都依赖「内核当前选区」，而**合成 DOM 选区同步不进内核模型**（CDP 合成拖选后 `firstRange` offset 恒 0/0）⇒ **自动化验证不了，必须真实鼠标**。

**261005 补充（AI「插入到选区后」破坏原块格式的实测与正确接法）**：

- **症状**：选 4 项无序列表 → 点「插入到选区后」→ 4 项被压成 **1 项**（多行变 `<br />` 软换行、只剩一个项目符号）、每行块句柄消失；标题/有序列表/引用同样被降级（用户 261005 报「格式绝对是错误了」）。
- **根因**：旧实现把「原文（`window.getSelection().toString()` = **纯文本**，块结构已丢）+ 空行 + AI」整体 `insertAtSelection("text/markdown", …)` **替换原选区**；markdown 再把连续行并成一个段落/列表项。
- **正确接法（已实施）**：「插入到选区后」**只插新块、绝不碰原块** —— `insertAtPosition({ id: 父节点, offset }, "text/markdown", aiText)`，其中 `offset` = 选区末端所在**顶层块**在父节点 `_children` 里的下标 **+ 1**。AI 结果仍按引用格式（`> ` 逐行）。整篇正文逐字节保留原块（列表 4 → 4、标题/有序/引用/混合均不变；真实 UI + mock AI 实测 31/31）。
- ⚠️ **`transformDOMRange` 对「某元素之后」少 1**：`setStartAfter(el)` 映射出的 `offset` 是 **el 自己的下标**（不是下标+1）——实测 4 项列表得 `offset:3`，会插到第 3 项之后。块级插入落点**按模型父子关系算**（`node._parent` / `parent._children.indexOf(block) + 1`），不要用 DOM→模型映射的「之后」。列表在模型里是**一个 `<ul>`**、在 DOM 里被摊平成多个兄弟项，更要按模型算。
- ⚠️ **`selection` 命令必须走 `kernel.execCommand`**：`editor.execCommand("selection", { ranges:[{start:{node,offset},end:{node,offset}}] })` 会拿模型节点去 `Range.setStart`（要 DOM 节点）→ 抛 `setStart: parameter 1 is not of type 'Node'`；包在 try/catch 里会**静默失败**（此前 `applyModelRange` 一直是 no-op）。`editor.kernel.execCommand("selection", {…})` 实测正确设回模型选区。
- 代码单一来源：落点 `aiModelSelection.ts` 的 `positionAfterModelRange()`；写回 `SelectionToolbar.tsx` 的 `onInsertAfter`；单测 `aiModelSelection.test.ts` + 源码护栏 `selectionToolbar.wiring.test.ts`。
- **内核 Markdown 原生支持表格、但表格不属于任何容器**（261005 实测）：`| a | b |` + `| --- | --- |` 经 `insertAtSelection/insertAtPosition("text/markdown", …)` 落成真 `<table class="lake-table">`（连每行 `> ` 前缀的引用表格也认）；但容器里放不下表格 —— `<alert><table/></alert>` 会连表格带容器一起消失，引用里的表格会被「拎」到引用外、前后文字并进同一引用（`tableHole.parents:[Root]`）。⇒「表格 + 容器式标记」二选一时只能放弃容器；本项目 261005 起插入改用「分隔线（hr 块卡） + AI 生成提示 + 原生正文 + 分隔线」，替换不加标记。


### 5.18 剪贴板格式与 Markdown→内核格式转换（261005 实测）

> **用途：实现「复制为 Lake」——把 AI 输出转成内核格式放剪贴板，粘到 Lake 是原生样式、不再弹「是否需要做样式转换」。**

- **内核粘贴的格式优先级**（`plugins/clipboard/src/kernel/commands/paste-command.ts`，bundle L78340）：
  `['text/ne-inode', 'text/lake', 'text/html', 'text/aone', 'text/plain', 'Files']` —— 按序取第一个「存在 + 在 payload.types 里 + 在 `kernel.getSupportedReaderTypes()` 里」的格式，再 `readData(fmt, data)` → `insertINode`。
- **解析入口 / 序列化出口**：`kernel.readData(fmt, data, opts)`（字符串→inode）、`kernel.writeData(fmt, nodes, opts)`（inode→字符串）。Markdown→内核格式 = `writeData('text/ne-inode'|'text/lake'|'text/html'|'text/plain', readData('text/markdown', md), { since:'copy' })`。实测 `text/ne-inode` 与 `text/lake` 往返都能完整保留 `<strong>`/列表结构；**`text/html` 往返不干净**（内核解析自己的 HTML 会多套一层 `<p>`），不要用 HTML 做原生还原。
- **`navigator.clipboard.write` 写不了自定义类型**：`ClipboardItem({ 'text/lake': … })` → `NotAllowedError: Type text/lake not supported on write`；只放行 `text/plain`/`text/html`。
- **内核的绕法（bundle L205138 `eSz`）**：把 `text/ne-inode` 负载 URL-encode 后**当作 `text/html` 前缀**：
  `'<ne-clipboard data="' + encodeURIComponent(neInode) + '" source="' + encodeURIComponent(location.href) + '"></ne-clipboard>' + html`
  粘贴时 `process()`（L204598）用正则把它取出、还原成 `text/ne-inode` ⇒ 原生直插。**于是 `text/html` 这条可写通道就能携带内核原生负载。**
- **实测达标**：按上面的配方 `navigator.clipboard.write` 写入、再 `read` 读回，`<ne-clipboard data=…>` 外壳**幸存**（只多一个 `<meta charset="utf-8">`）；`text/plain` 用内核 `writeData('text/plain')`（无 markdown 语法）⇒ 不命中内核的 markdown 转换提示。
- **触发「是否需要做样式转换」的判据**（bundle L211374-211555）：粘贴文本命中 14 条宽松正则**任一**即弹（行首 `- `/`1.`/`# `/`> `、链接、代码围栏、表格、`:::`、行内反引号、`**bold**` 等）；`text/html` 前 100 字符含 `lake-content` 或 `types` 含 `text/ne-inode` 则跳过。
- **⚠️ 未证实**：真实按 ⌘V 粘贴回原生样式这一环没在自动化里跑通（CDP 驱动不了真实粘贴），是内核自身标准路径但需真机手验。
- **落地**：`src/features/ai/aiLakeClipboard.ts`（配方 + 护栏单测）；内核实例经 `src/features/editor/editorRegistry.ts` 按挂载点取。

### 5.19 块菜单的 AI 透传口 + DOM→模型选区（261005 实测）

> **用途：块句柄菜单唤起 AI 助手（本项目对所有块开放；云端 Lake 只给标题用）。**

- **上游本来就留了业务接入口**：`BlockContextMenu` 的 `BlockMenuAction` 含 `aiOutline`，`BlockHoverHandle.handleMenuAction` 也有 `case 'aiOutline':`（注释："由业务层接入具体 AI 服务；下方的 onBlockAction 会携带当前块"），并在动作末尾 `onBlockAction(action, data)` 透传；`BlockHoverHandleProps` 有该 prop。缺的只是**菜单项**（上游第 730 行注释「"大纲写作法"入口暂不展示」）。⇒ vendor 只需「放行 + 注入菜单项」（LOCAL-CHANGES #27），AI 面板与落库全在宿主。
- **块 DOM 元素带模型 id**：段落等块元素是 `<ne-p id="<nodeId>-body" ne-role="render-unit">`；`engine.transformDOMRange(range)`（`range.selectNodeContents(el)`）返回**非折叠**的 `{start,end}`，交给 `kernel.execCommand('selection', { focus:'end', anchor:'start', ranges:[mr] })` 即可设成块选区（与 vendor `selectBlockInEditor` 同口径）。
- **⚠️ 菜单点击会把模型选区压成折叠**：`kernel.document.selection.firstRange.start === end`（实测 offset 都落在块末）。⇒ **用选区前必须判折叠**，折叠就自己按块元素选整块；否则 `insertAtSelection` 会退化成「光标处插入」——症状＝AI「替换选区」变成把结果**追加**在原块内容后面（实测 "原始段落内容。AI写的替换内容"）。
- **多块选区**由 vendor 在自己的 `handleMenuAction` 里先 `selectBlocksInEditor(editor, multi)` 还原（非折叠）⇒ 宿主直接 `captureModelRange` 即可拿到整段；`getSelectionContent('text/markdown')` / `insertAtSelection` / `deleteByRange` 均按整段工作。

### 5.20 图片浮栏弹层定位：`.ne-card-toolbar` 自带 `transform`，`position: fixed` 会相对它定位（261005 实测）

- **现象**：图片浮栏（`.selection-toolbar[data-kind=image]` 的内层是内核 `.ne-card-toolbar`）的下拉弹层（对齐/样式/批量，以及宽高/链接/边距）组件已算出**视口坐标**，却出现在错误位置（用户截图：跑到最左）。
- **根因（实测）**：内核 `.ne-card-toolbar` 自带 `transform` ⇒ 对它内部 `position: fixed` 的后代，**包含块从视口变成 `.ne-card-toolbar`**（实测弹层 `offsetParent === ne-card-toolbar`；inline `left:531/top:169` 的最终 `getBoundingClientRect` = 工具栏 `232/128` + `531/169` = `764/298`）。组件按视口算的坐标被**再加一次工具栏偏移**。
- **正确接法**：把 `position: fixed` 的弹层渲染在 `.ne-card-toolbar` **外面**（作为其兄弟节点；父级 `.selection-toolbar` 无 transform ⇒ `offsetParent === null` 即正确）。**不要**用 `!important`/改 CSS 去压 —— 问题在包含块选择，不在样式优先级。
- **旁证**：文字浮栏（`.selection-toolbar` 直接作父级、无 transform）的同类弹层一直正常 ⇒ 不是「浮层原语」的问题，纯粹是「塞进了带 transform 的内核容器」。
- 落地：`src/features/editor/selectionToolbar/SelectionToolbar.tsx`（`renderImage` 返回 Fragment：`.ne-card-toolbar` 只放条目，弹层在其后）+ 护栏 `selectionToolbar.wiring.test.ts`。

### 5.21 图片裁剪：本构建**实际可用**（推翻 vendor 注释的「空桩」说法，261005 实测）

- vendor `src/components/plugin/imageToolbar/ImageToolbar.tsx` 的 crop 分支注释写「本构建中原生 crop 通道是空桩，`_cropImageOp` 恒为 null」，并走 `cardUI._$cardUI._setCroping({croping})`。
- **实测不成立**：直接调 `cardUI._$cardUI.setCro(true)`（= 我们 `imageCardOps.enterImageCrop` 的路径）后：`_isCroping === true`、`getCroping() === true`、`_cropImageOp` 由 `null` 变为**已设置**、裁剪相关 DOM 节点 **11 个**。⇒ **crop 通道可用**；vendor 那句是过期结论（或只针对 `_setCroping` 的某条分支）。
- 结论：图片浮栏的「裁剪」按钮**保留**（不是死按钮）。后续若有人报「裁剪不可用」，先按本口径复核，**不要**据 vendor 注释删按钮。

### 5.22 卡片删除：用内核命令 `deleteCard(cardId)`（**单卡**）；块级删除 / `delete` / `deleteByRange` 都不对（261005 实测）

- 背景：图片上按 Cmd+X 无效。根因是宿主 capture 的 `cut` / `copy` handler 都要求**非折叠 DOM 选区**，而点图片不会建立选区；内核原生 cut 拿到卡片时只把 `image/png` 写进剪贴板，**不删卡片**。
- 强行 `selectNode(卡片)` 后再走这些路径，实测**都不删卡片**：
  - `kernel.execCommand("delete")`（宿主 cut handler 现用）→ 卡片原样留下；
  - outer range → `transformDOMRange` → `createModelRange` → `kernel.execCommand("deleteByRange")` → 不删卡片节点；
  - `editor.execCommand("deleteCard", cardId)`（用**卡片实例自己的 editor**）→ **正确**：只摘这一张卡 ✓。
- ⚠️ vendor 的 `blockMenuHelpers.removeBlockNodesNative`（模型事务）删的是**整块**，**不能**用来删单张卡；它的兜底 `deleteByRange` 又删不掉卡片节点。
- **落地（261005 最终版）**：宿主 `SelectionToolbar` 的 Cmd/Ctrl+X = `selectNode(卡片)` + `execCommand("copy")` 写剪贴板 → `deleteCardNative(cardEl, cardId, editor)`（取**卡片实例自己的 editor** 调 `execCommand("deleteCard", cardId)`）。**不需要任何 vendor 改动**（一度导出过 `deleteBlockByRange`，因**整块删除会连坐同段其它图片/文字**被用户否掉，vendor 已整体还原）。
- **覆盖所有卡片类型（261005）**：`SelectionToolbar` 在 `pointerdown`(capture) 记「最近点过的 `ne-card`」（`activeCardRef`）；Cmd+X 时**图片优先用浮栏 target、其它类型用它**，仅命中卡片才拦（有非折叠文字选区且不在该卡上则让位；卡片内标题等可编辑元素不抢）。真实端实测同文档 **image/file/video/audio 各 2 张**逐个切：计数 `2,2,2,2 → 1,2,2,2 → 1,1,2,2 → 1,1,1,2 → 1,1,1,1`，每类只掉目标 1 张、其余类型零变化。内联卡（父 `NE-P`）与块卡（`NE-HOLE` 包裹）都只删目标卡。
- ⚠️ **踩过的坑**：处理器最初用 `el.closest("input, textarea, [contenteditable='true']")` 当「别抢输入框」守卫，但**主编辑器引擎本身就是 contenteditable** ⇒ 守卫恒真、Cmd+X 永远进不来（表现为「处理器根本没跑」）。守卫必须**排除 `.ne-engine`**。另：e2e 验证剪贴板前要先**清空系统剪贴板**，否则读到跨次运行的残留、误判成「已写入」。
- 真实端实测（可信 CDP 输入）：一个段落 3 张图，Cmd+X **中间那张** → 落盘只剩 seed_1/seed_3、**块内文字保留**、DOM 剩 2 张、剪贴板拿到含 `<img>` 的 `text/html`。
- 另：早期一度判定 `deleteCard`「只移除 DOM、落盘仍有图片」是**误判** —— 当时 handler 因上面那条守卫从未执行，且落盘读得太早。
### 5.23 自定义卡片（配置式）：注册契约 + 面板/序列化实测（261008 实测；落地「文档引用」卡）

**官方出处** `yuque-developer-docs/docs/69 - 开发自定义卡片`；**同款模板** `vendor/lakex-doc-react/src/cards/MindMapCard/index.ts`。

- **描述字段**（`CustomCardConfig`，`types.ts:451`）：`name` / `cardType: 'inline'|'block'` / `slash: { icon, mainSearch?, keywords?, label, description? }`（**`icon` 是 sprite 符号 id 字符串**，不是 React 组件）/ `initValue`（**不得用 `$name` 保留字段**，不放函数与循环引用）/ `editorComponent` / `viewerComponent`（props = `{ editor|viewer, cardValue, updateCardValue, cardType }`，`updateCardValue` 触发重渲染）/ `writeText` / `writeHtml`；`readHtml` 暂未支持。
  卡片以 **`{ config, icon? }` 包装**进 `customCard.cards`（新 vendor 形状）：`lakeRuntime.prepareCustomCards` 把 `label/description` 的函数形态归一化成字符串，`ensureCustomCardIcons` 把包装上的 `icon` 组件渲成 sprite。
- **只配 `slash` 不会出现在面板里**：斜杠项名必须是 `custom-${name}`，**还必须把它加进 `slash.cardSelect.<组>.groups[].items`**。我们的落地 = `lakeRuntime` 的 `customOptions.slash.cardSelect.{general,table}.groups` 里追加（那是"拷默认分组再过滤 `third-party-services`"的地方）。
  ⚠️ **「小工具」组的 `name` 与「程序员」组重名**（都是 `group-files`，`configs/slash.ts` 默认如此）⇒ **只能按 `title` 找**（我们固定 `GetDefaultEditorConfig("zh-cn")`）。
- **面板触发**：`/` 键入在本构建**不可靠**（keydown 与 insertText 两种注入实测都没触发；且光标须落在可触发块内）；**可靠入口 = 工具栏 `.ne-ui-toolbar-card-select-button`**（同一份 `cardSelect.general` 配置）。
  面板 DOM：`.ne-ui-toolbar-card-select`（`.ne-ui-search-card-menu`）、`.ne-menu-item-group`、**`.ne-menu-item-container`（整行可点，内含 `…-title` / `…-content`）**。
  ⚠️ 面板内容**内部滚动**：靠后的分组（如「小工具」）渲染在可视区之外（实测 rect y=1249，面板可视 [161,691]）⇒ CDP 点击前必须 `scrollIntoView` 再重新量 rect，否则会点到文档上并顺手关掉面板。
- **`.lake` 序列化形态**（与 §5.3 一致，本卡实测）：`<card type="block" name="customBlock" customName="lake-note-ref" value="data:%7B%22%24name%22…">`，percent 解码后是 `{$name, $htmlStr, …我们的字段}`。
- **React 实例**：卡组件由内核自己的 React 树渲染，但**与我们共用同一个 React 实例**（实测：本卡内的 `useState/useMemo` + 我们的 `Dialog`(Overlay) 浮层、受控输入、列表交互全部正常）⇒ 可直接用应用侧 React 组件，但**拿不到应用的 context/props** ⇒ 宿主数据只能走**模块级注册表**（我们照 `imagePreview` 的姿势做 `setNoteRefHost`）。
- **内核没有"引用同库文档"的现成卡**（261008 bundle 排查 + 实测）：`mention` 在本构建的「小工具」组里是**被注释掉**的；`category === 'localDoc'` + `ne-card-local-doc(-btn-download/-preview)` 是**「本地文档（上传文件）」卡**（走 `checkFileSize(eZ.localDoc, file.size)`），**不是引用**；云端那张「插入可访问的语雀内容」（`/yq`、`insert-yuque` 图标）是**拉语雀线上内容**，本地没有解析通道 ⇒ "引用同库文档（含表格/多维表/画板）"只能自建自定义卡（本项目已按本套契约实现：`src/features/editor/noteRef.ts` + `noteRefCard.tsx`）。
### 5.24 内核链接的两个浮层：动作条 = 卡片工具栏类、编辑器 = `.ne-link-editor`（261008 源码定位 + 真实端实测）

- **`.ne-link-editor` 的 CSS 就在 vendored 源码里**（`vendor/lakex-doc-react/src/assets/lakex-doc.css` ~L15755；本项目 HANDOFF 早前「类名在、规则没定位到、可能运行时注入」的说法**作废**）：
  `width: 365px` / `max-width: calc(100vw - 32px)` / `border-radius: 5px` / `padding: 16px 12px` / `font-size: 14px`，
  表面 = `--lakex-editor-background-foreground` + 1px `--lakex-editor-border-primary` + `0 8px 16px 4px rgba(0,0,0,.04)`；
  `.ne-link-editor-field` 与 `.ne-link-editor-field-title` 一律 **`margin-bottom: 16px`**。
  JSX 结构（`lakex.js` ~L209363）：`div.ne-link-editor > (div.ne-link-editor-field > label > div.ne-link-editor-field-title + Input) × 2 + Button(「确定」)`。
- **横向动作条 = 卡片工具栏**：`.ne-card-toolbar` / `.ne-card-toolbar-item`（同一文件 ~L1000）：`padding: 6px 12px`、`border-radius: 4px`、
  `display: inline-flex`、条目 **28×28**、条目间距 **margin-right: 4px**（`:first-child`/`:last-child` 收边）、**图标 16px**、
  hover `--lakex-editor-background-tertiary`、`backdrop-filter: blur(50px)`、`box-shadow: 0 8px 16px 4px rgba(0,0,0,.04)`。
  ⚠️ 条目**不要用原生 `<button>`**：该规则只给几何、不重置 UA 的底/边 ⇒ 会多一圈系统灰底（要去覆盖就变成"又写一套样式"）。用 `div[role=button]`（同 `SelectionToolbar` 的 `CardItem`）。
- ⚠️ **内核链接的 hover 菜单不是这条横向工具条**：`plugins/link` 的 `_openMenu`（`lakex.js` ~L209789）用 `euH` 渲染**竖向** `.ne-ui-mode-menu-panel`
  （每项 = 16px 图标 + 文案，首项是 `disabled` 的「链接」标签；`_getTargetNode()` 取 `ne-text` ⇒ 贴文字）。横向排的那条是**卡片工具栏**（图片卡/阅读态同一套）。
  复刻"链接那种浮层"前先认准要的是哪一套，别把两套混成一个。
- **主题桥（关键）**：内核把浅色 schema 以 `.lakex-default-theme{…}` 的 `<style>` 注入（`colorRegistry.toStyleValues(selector, scheme)`，`lakex.js` ~L36220，`selector = 'lakex-default-theme'`）。
  那是**普通类选择器** ⇒ portal 到 `document.body` 的浮层只要自己带上 `lakex-default-theme` 类，就能吃到 `src/styles/kernel-theme.css` 的 `--lakex-editor-*` 主题映射。
  **实测**（暗色）：`.ne-card-toolbar` 背景 `#1e1f23`、字色 text-1、边框 `#2d2f34`。不带这个类 = 暗/暖色下浮层仍是内核浅色字面值。
- **锚点坑**：同一个回调 ref（`titleRef`）挂在外层卡片 div 与标题 span **两层**时，最终锚点漂到**卡片块**（实测浮层比文字低 6~8px）；
  只挂标题文字 + `usePopoverPosition({ gap: 2 })` 才得到"贴文字"（= 内核卡片工具栏默认 offset 2）。
- 落地：`src/features/editor/noteRefCard.tsx`（`surfaceClassName="ne-card-toolbar"` / `"ne-link-editor"` + `className="lakex-default-theme"`）+ `noteRefCardActions.css`（只剩 1 条 cursor）；护栏 `noteRef.test.ts` 卡住"不许用自造几何替换这两组类"。
- **自定义卡的插入面板图标（261008 五改实测）**：
  · `CustomCard.icon`（`types.ts:515`）是**一个 React 组件**，且组件**不画可见图形**，只渲染一个 `<symbol id=... viewBox=...>`；
    它由我们自己的 `lakeRuntime.ensureCustomCardIcons()` 收进隐藏 sprite `#icon-lakexui-custom-cards`（prepend 到 body；
    ⚠️ 必须在 `prepareCustomCards` **之前**调 —— 后者把 `{ config, icon }` 包装解包成 config，icon 就丢了）。
  · `slash.icon` 的解析（`lakex.js` ~L227974 的图标组件）：先把 kebab 名 camelCase 化去查内核别名表（`card-mention-doc → icon-card-mention-doc` 那类）；
    **查不到就原样当 symbol id 用** ⇒ 自绘图标填**全限定 id**（我们：`icon-lake-note-ref`）即可，渲染成 `<use xlink:href="#<id>">`。
  · **尺寸不是固定像素**：卡片选择面板的图标盒 = `.ne-menu-item-container-icon` **36×36 / radius 7**，
    `div.ne-icon { width:1em; height:1em; font-size:36px }`，而 `div.ne-icon .ne-icon-symbol { width:1em; height:1em; fill:currentColor }`
    ⇒ **symbol 按 font-size 缩放**。所以设计稿按 72 网格画、描边 2 → 实测描边 1px；图标**自带底框**（与内核 `日历/表情` 那些彩色面板图标同姿势）才像一块"贴片"。
  · **复核姿势**：面板不在 DOM 里时要先开它 —— 程序化 `button.click()` **不生效**（开关只挂在 React 处理链上）；
    直接调 React 的 `onMouseDown/onClick`（`btn[__reactProps$…].onClick({ preventDefault(){}, stopPropagation(){}, currentTarget:btn, target:btn, button:0, nativeEvent:{} })`），
    再用 `use.getBBox()` / `document.getElementById(<symbol id>).getBBox()` 量真实几何（实测：`use` 35×35 / symbol 70×70 / viewBox `0 0 72 72`）。
  · **卡片的"刚插入"状态怎么认（261008 实测）**：内核给**新插入**的卡挂 `ne-focused`（插入后由内核 `focusCard` 设置），
    **打开既有文档时卡上没有**该类；但 `ne-focused` 语义是「**当前聚焦的卡**」（点另一张会转移、原卡失去）⇒ 只能与「首见该 DOM 元素」配合用，不能单独当插入信号。
    另：插入时内核**可能先把卡渲进游离节点再挂进文档**（挂载那一刻 `closest("ne-card")` 为 null）⇒ 宿主侧判定要**轮询一小段窗口**，一次性判定会漏。
  · ⚠️ **`autoFocus` 在浮层里不可靠**：`usePopoverPosition` 首帧表面是 `visibility:hidden` 占位，此时 `focus()` 会被浏览器**静默忽略** ⇒
    "打开即聚焦"必须等它的 `placed`（或下一帧再 focus）。
  · ⚠️ **symbol 内容活在 `<use>` 的 shadow 树里**：**CSS 选择器打不到它**（`[data-theme=dark] .你` 之类一律无效），
    而 **`var()` 也不能写在 presentation attribute 上**（`fill="var(--x)"` 浏览器不认）⇒ 想要"随主题换色"只有一条路：
    元素用 **`style="fill:var(--x)"`**，变量定义在主题文件（`themes/base.css` + `themes/dark.css`），靠**继承**进 shadow 树。
    本项目落地见 `src/features/editor/noteRefIcon.tsx`（浅色=设计稿原值 / 深色=重绘一套，两套都实测过）。

### 5.25 表格（Univer 内核，非 lakex）图片粘贴：落点写死在命令里，只能在 DOM 层收口（261010 读码 + 真实端实测）

- **内核行为**（`@univerjs/sheets-drawing-ui` v1.0.3）：图片粘贴钩子 `onPasteFiles(pasteTo, files, payload)` 只要剪贴板里有图片文件，
  **无条件**返回 `{ redos: [{ id: "sheet.command.insert-float-image", params: { files } }] }` ⇒ 默认**永远落浮动图**（跟"有没有选中单元格"无关）。
- **钩子层加不了自己的规则**：`@univerjs/sheets-ui` 的 `_executePaste` 是**聚合语义** —— 把所有 enabled hook 返回的 undo/redo mutations
  push 进同两个数组后**一起执行**（`redoMutationsInfo.every((m) => executeCommand(m.id, m.params))`）
  ⇒ 我们再注册一个 `onPasteFiles` 只会「单元格图片 + 浮动图」**两张都插**，压不掉内核那条。
- **命令本身也换不掉**（读码 + 运行时实测三条）：
  ① `CommandRegistry.registerCommand` 对**已存在 id 抛错**（必须先 `unregisterCommand`）；
  ② 注入进来的 `CommandService` **没有 `getCommand`**（`getCommand` 只在 registry 上；运行时实测报 `d.getCommand is not a function`）⇒ 拿不到原实现做兜底委托；
  ③ `beforeCommandExecuted` 的返回值**被忽略**（实现是 `listeners.forEach((l) => l(...))`，不检查返回值）⇒ 不能用它取消命令。
- **本项目收口方式 = window 捕获阶段拦 `paste`**（早于内核任何 document / 元素监听），只接管这一种情况：
  「剪贴板里有图片文件 **且** 纯图片（无 `text/plain` / `text/html`）**且** 事件目标或当前焦点在本表格宿主内 **且** 单图 **且** 有活动单元格」
  ⇒ `preventDefault + stopImmediatePropagation` → `uploadLakeResource` 提升成资产 → `activeRange.insertCellImageAsync(资产URL)`。
  其余（没有选中单元格 / 一次多图 / 带文本）一律**放行**给内核默认（浮动图，保证一张都不丢）。
  落地：`src/features/usheet/usheetImagePaste.ts`（判据，纯函数可单测）+ `UniverSheetEditor.tsx` 的 `onPaste`。
- **正文形态（验收判据）**：
  · **单元格图片** = `cellData[r][c].p` 里的**内联 drawing**（`drawingType: DRAWING_IMAGE` / `layoutType: INLINE` / `docTransform`）；
    它**不出现在** `workbook.resources` 里 ⇒ 落盘断言看 `cellData` 有没有 `p`、`drawingType` 计数即可。
  · **浮动图** = `workbook.resources` 里 `name: "SHEET_DRAWING_PLUGIN"` 的 `data`（JSON 字符串）内的 drawings（每个 `drawingId` 一张）。
- **实测验收**（隔离 userData + 真实 Electron + CDP）：单图粘贴 → 正文 230B → 2920B，`cellRichText: true / cellKeys: 1`（单元格图片）；
  双图粘贴 → `cellRichText: false`，`SHEET_DRAWING_PLUGIN` 里 **2 个 drawingId**（两张都保留）。
  ⚠️ 调试姿势：窗口没有 OS 焦点时**真实 ⌘V 不会产生原生 paste 事件** ⇒ 自动化要用
  `new ClipboardEvent("paste", { clipboardData })` + `DataTransfer.items.add(file)` 合成事件驱动（本构建能跑通内核整条粘贴链）。

### 5.26 表格（Univer）工作表默认尺寸 / 单元格图片 / 右键菜单：三个已核实的接口（261010 读码 + 实测）

- **新建工作表（标签「＋」）的默认尺寸只能从 preset 的 footer 配**：内核 `SheetBar` 读
  `useConfigValue(SHEETS_UI_PLUGIN_CONFIG_KEY)`，用 `footer.addSheetButtonConfig.{show,defaultRowCount,defaultColumnCount}`
  （默认 **1000×20**），随后 `executeCommand("sheet.command.insert-sheet", { sheet: { rowCount, columnCount } })`。
  `@univerjs/core` 里那两个 `DEFAULT_WORKSHEET_ROW_COUNT(_KEY)` **不参与**这条路径（只有常量，没读配置服务）。
  ⚠️ 传 `footer` 时要**给全** `sheetBar/statisticBar/menus/zoomSlider` 四个开关，否则会把它们顶掉。
  （本项目取 50×16，与 `core/usheetDoc.ts` 的空表是同一组常量 ⇒ 单一来源。）
- **单元格图片是"整格覆盖"语义**：`insertCellImageByUrl(url, location)` 每次都 `createDocumentModelWithStyle("")`
  新建空文档，`BuildTextUtils.drawing.add` 后 `syncExecuteCommand(SetRangeValuesCommand, { p: 新文档, t: 1 })`
  ⇒ ① **一格只能放一张**，第二张替换第一张；② 格内原有文字 `v` 仍留在数据里，但 `t:1` 让单元格渲染富文本
  ⇒ **界面上文字被图片顶掉、看不见**（实测：二次插入后 `cellData[0][0]` 字段恒为 `p,t,v`，`p` 里 drawing 数恒 1）。
  ⇒ 宿主侧要"多图也进格"只能自己决定落到相邻格（本项目：多图回退浮动图，不静默丢图）。
- **右键菜单加项的官方路径**：facade `univerAPI.createMenu({ id, title, icon, action, order }).appendTo(path)`；
  `action` 传**字符串 = 已注册命令 id**（不会新建命令）；`appendTo` 收**路径数组、逐段单个 key**
  （`["contextMenu.mainArea","contextMenu.layout","sheet.menu.cell-insert"]`；写成点号整串会挂到错误层级）。
  ⚠️ `createMenu` 必须**作为方法调用**：解构出来会丢 `this` ⇒ `Cannot read properties of undefined (reading '_injector')`（实测踩到）。
- **计算条（sheet bar）高度是行内样式** `style="height: 36px"`（不是类、也没有 CSS 变量）：我们压到 30px 时
  只能 `!important`（`.usheet-editor section:has([data-u-comp="slide-tab-bar"])`），并把 `slide-tab-bar` 的
  `padding-block` 收到 1px，让 28px 的标签在 30px 里装得下（实测 30 = 28 + 1×2）。

### 5.27 `envAdapter` 官方适配口全量 + 我方覆盖率取证（261010 官方文档核对 + 仓库实测；**只取证、未改行为**）

**官方出处**（本地副本 `yuque-developer-docs/docs/48 - 适配器（envAdapter）`，第 11–33 行）：
「编辑模式和阅读模式都有自己的适配器」，事件由 `viewer` / `editor` 抛出、`EnvAdapter` 初始化时监听。

| 适配口 | 阅读模式 | 编辑模式 | 我方实现 |
| --- | --- | --- | --- |
| `openLink(url, isExternal)` | ✅ | ✅ | ❌ 未接 —— **实测无需接**（壳层已接管，见下） |
| `openMentionLink(url, isExternal)` | ✅ | ✅ | ❌ 未实现 |
| `openLocalLink(url)` | — | ✅ | ❌ 未实现 |
| `openBookmarkLink(url)` | — | ✅ | ❌ 未实现 |
| `openThirdpartyLink(url)` | — | ✅ | ❌ 未实现 |
| `previewImgs(imgs, index)` | ✅ | ✅ | ✅ **已实现**（`src/features/editor/imagePreview.ts` → 共享 Lightbox） |
| `longPressCard(params)` | ✅ | ✅ | ❌ 未接 —— **官方语义是「使用方自实现 UI」**（原文见下），我方自写手势等价 ⇒ 保留 |

**覆盖率 = 1/7。** 关键：**这个缺口一直没暴露，是因为桌面走了壳层而不是内核适配口** ——
`electron/main.ts` 的窗口级 `setWindowOpenHandler` + will-navigate 把应用页之外的地址一律交给
`shell.openExternal`（L302–326）。所以「编辑器里的链接能打开」是**壳层**的功劳，不是 `envAdapter` 的。

**两条待办的取证结论（261010 均已实测收口）**：

1. **移动端外链：实测「无缺陷」⇒ `envAdapter.openLink` 不必接。**
   实测方法：探针文档 `外链探针 261010`（正文含 `<a href="https://example.com/261010" target="_blank">` 的外链），
   从 **书架 → 最近文档** 打开（文档树抽屉的自动化打不开，改走这条入口），再用 `Input.dispatchMouseEvent` 真点按链接中心。
   ⚠️ **判据必须看前台窗口**：`adb shell dumpsys window | grep mCurrentFocus`。
   Intent 场景下 `location.href` 与 CDP target 列表**都不会变** —— 只看这两个会得出「点了没反应」的**错误**结论
   （本轮就误判过一次，见本节末的修订记录）。
   结果：点前 `com.locallakexnotes.mobile/MainActivity` → 点后 **`com.android.chrome/ChromeTabbedActivity`** ⇒ 系统浏览器正常打开。
   对照 A/B：`<a target="_blank">` 与 `window.open(…, "_blank")` **两条路径都能**打开系统浏览器
   （各自从 App 前台切到 Chrome）⇒ Capacitor 已把外部 origin 转成 Intent。
   ⇒ **单一姿势 = 都靠壳层**（桌面 Electron 窗口钩子 / 移动 Capacitor Intent）。
   仅当将来要「自定义打开方式」（应用内浏览器、域名白名单）才是新需求，那时再接 `openLink`。
2. **`longPressCard`：取证结论 = 保留自写实现（官方口本来就要求使用方自实现 UI）。**
   官方原文（`48 - 适配器`）：「卡片长按事件。提供给移动端使用。入参需要自定义，可以参考 editUI和viewerUI
   **实现一个UI**，然后在UI中通过 `this.viewer.emitEvent('longPressCard', args);` 传递参数、触发该方法的执行。」
   ⇒ 它**不是**「内核自带长按 UI、我们接一下就行」，而是「由使用方实现 UI 并回传参数」。
   我方 `src/features/editor/longPress.ts`（450ms / 位移 < 10px / 吞掉随后的 click；经 `LakeEditor.tsx` 的 `attachLongPress` 挂载）
   做的正是这件「给移动端实现长按交互」的事 ⇒ **保留**。且**无公开证据**表明本构建会主动抛该事件
   （文档给的是「由我方 emit」的用法），要接必须先验证它真会抛，否则接了也不触发。

> 探针文档（261010 建的，按 AGENTS §4 不自动删除）：`外链探针 261010` = `0b69d3ca-cd8b-45b1-8123-5f1b84a1f411`
> （正文 = `<p><a href="https://example.com/261010" target="_blank">外链测试</a></p>`，可直接用它补做手工实测）。

> 修订记录（261010）：本节初稿曾把「移动端外链点了没反应」写成结论 —— **那是观测缺陷**（只看 `location.href`/CDP target，
> 没看前台窗口）。已改判为「工作正常」。留此记录提醒：**验证「是否打开了外部应用」必须看系统层（前台窗口 / Intent），
> 不能只看页面内指标**。

> 方法学提醒：查官方适配口这件事**方向做对了**（两处都查、都有结论）—— 结论是外链不用接、长按本就该自实现。
> **涉及内核交互能力时先查官方适配器清单，再决定要不要自建**；查完得出「官方有但不需要」同样是有效结论。

### 5.28 「+」插入面板：条目来自内核、工具条**没有**日期/表情 id、面板会翻到屏幕外（261010 读码 + 设备实测）

**面板条目 = 内核注册表**（`configs/slash.ts` 的 `groups[].items`，由各卡插件 `registerCardSelect` 注册）。
vendor 原文（`configs/slash.ts:103-113`）的「小工具」组：

    { title: i18nMap[lan]['tools'], name: 'group-files', type: 'normal', items: ['calendar', 'dateCard', 'unicodeEmoji'] }

别名（`lakex.js` 三处 `registerCardSelect`）：**`/rl` 日历 · `/rq` 日期 · `/bq` 表情**；
dateCard 的 value 形态 = `{date: <epoch ms>}`（`insertCard('dateCard', { date })`，`lakex.js:193641`），
unicodeEmoji = `{emoji}`（`insertCardNode(t,n,'unicodeEmoji',{})`，`:121559`，初值为空对象）。
⇒ **「移动端没有日期/表情」不是内核缺能力**，是我们自己的面板白名单（`quickNoteInsertFilter`）把它们裁掉了；
261010 已删除该白名单（面板 = 内核全量）。移动端小记「+」面板实测 **25 项 / 1294px 高**。

**工具条 id 是另一套**：`toolbar.agentConfig.*.items` 里放未知 id 会被**静默丢弃**（实测 11 个候选只渲染 6 个，
`file`/`attachment`/`dateCard`/`date`/`emoji` 全不是有效工具项 id）⇒ 日期/表情/附件的唯一入口是 `cardSelect`（「+」面板）。

**面板浮层定位（踩坑）**：`.ne-ui-boundary-popover` 默认 `position:absolute; top:-999999999px`，真实位置由内核 JS 写**行内**
`top`/`bottom`；它挂在 **portal 到 `body` 的 `.ne-overlay-container`** 下（实测该容器 `position:fixed` 且 **0 尺寸**、位于视口左上）。
面板过高时内核把它翻到 caret 上方 —— 用**负 `bottom`** 表达：24 项面板实测 `bottom:-84.76px` ⇒ 渲染在 `top=-558`（视口 842），
**顶部整段出屏、「基础」那些条目点不到**。**只夹高度解决不了**（翻转判定不吃高度，钳制后仍是 `top=-558`），必须同时：
① `max-height` + `overflow-y:auto`（面板自身 1225px 高，`clientH=scrollH` 时内部根本不能滚）；
② 改锚点 `top:120px !important; bottom:auto !important`（压内核行内样式）。
内核没有定位/高度配置项（官方文档 `55 - 斜杠命令（slash）` 只给 `groups`/`disableQuickInput`）⇒ 我方落在
`src/mobile/mobile-kit.css`、作用域 `body.lake-mobile`。
> （261012 收尾：`mobile-kit.css` 已在移动端 UI 独立化 P5 整份删除，这两条内核修正现落在 `src/mobile/mobile.css` 末尾；规则本身未变。）

**推论（本仓机制）**：内核浮层不在我们的组件树里 ⇒ **移动端要覆盖内核浮层必须用 body 级选择器**（260923 起只有组件树内样式，够不到浮层）。
移动端入口已加 `body.lake-mobile` 标记（`src/mobile/main.tsx`）。

### 5.29 工具条「自定义工具项」契约 + `unicodeEmoji` 卡是**死占位**（261010 读码 + 设备实测）

**内核怎么把 items 变成控件**（`_createToolbarUI` 160955-160974、`createWidget` 160497-160503）：
`agentConfig.<mode>.items` 的元素有三种写法 ——
① 字符串 ⇒ 查 `_descriptorDefines`（内置注册表）；
② **函数/类** ⇒ `new Cls(editor, itemId)` 再 `init()`；
③ 对象 `{clazz, pluginContext}` ⇒ `new clazz(editor, name, pluginContext)`。
之后按 `descriptor.constructor.Type` 选控件（`'Button'` / `'StatusButton'` / `'FileButton'` / `'EmojiButton'` / `'CardSelect'` / …）。

**`Button` 控件真正调用的 descriptor 接口**（159794-159883 + 控制器 160611-160651）：
`getInitUIState()` / `getUIState()` / `onEvent('click', target)` / `isReady()` / `on('statechange', fn)` /
`name` / `disabled` / `toolbarNode`（160706 写入）/ **`enable()` / `disable()` / `destroy()` / `close()` / `refresh()`**。
⚠️ **漏 `enable()`/`disable()` 会整块白屏**（设备实测 `TypeError: e.enable is not a function`：控制器在工具条
建好那一刻就逐个 `enable()`）。`icon` 给**字符串**时由内核图标组件渲染（`<m1 type={icon}/>`）⇒ 直接用内核图标名
（`editor-main-date` / `editor-main-expression` / `editor-main-attachment`，与插入面板同款）；
`tooltip` 形状 = **字符串数组**（`ToolbarUIDescriptor.getTooltip` 147920 返回 `[文案, 快捷键?]`）。
⚠️ 本包**没有导出** `ToolbarUIDescriptor`（`dist/index.d.ts` 只有 `ToolbarItemSpec` 等类型）⇒ 用方按上述接口
自实现最小基类（我方 `src/features/quickNotes/quickNoteToolbarWidgets.ts`）。

**`unicodeEmoji` 卡 = 「插入表情」占位卡，不是表情容器**（设备实测 + 读码）：
它的 `render` 写死 `createElement(m1, { type: 'card-emoji-insert' })`（200615-200625），**从不渲染 value**；
内核自己的选择器逻辑是「选中 emoji ⇒ `execCommand('insertText', emoji, pos)` ⇒ 删掉这张卡」（200891-200897）。
⇒ 在没有内核表情选择器上下文的宿主里插这张卡，只会得到一个**点不开的死框**（插入面板的「表情」项同样如此，实测两次）。
**要表情就插文本**：走内核通用插入通道 `execCommand('insertAtSelection','text/lake', frag)`（与块菜单同一个口）。
⚠️ 原生 `document.execCommand('insertText')` 在本内核模型下**不生效**（实测：选完表情正文无变化）。

**工具条条目间距**：每条内置项自带 `margin: 8px 0 8px 12px` ⇒ 每项占 **44px**（按钮 32 + 间距 12）。
9 项 = 396px > 手机写作卡内容宽 363px ⇒ 内核把最后几项收进「···」。移动端小记把间距收到 6px
（原 `src/mobile/mobile-kit.css`，261012 P5 起已收编进 `src/mobile/mobile.css`；作用域 `body.lake-mobile .mobile-qn-composer`）即一行放得下 —— 注意**桌面写作卡
根类叫 `quick-note-composer`、移动端叫 `mobile-qn-composer`**，写错作用域规则静默不生效（本轮踩过）。

**副作用（用户已知并接受，261010 定稿）**：紧凑工具条按用户指定的九项做，**不含** `cardSelect`（面板按钮），
移动端又不再展开 ⇒ **移动端小记没有插入面板入口**；而 `/` 斜杠在本构建**不可靠**（§5.23 早先实测，
261010 用 keydown + `Input.insertText` 两种注入复测**都没唤起**）⇒ 表格 / 代码块 / 公式 / 高亮块 / 分栏 /
折叠块 / 画板 / 思维导图 / 日历 / 文档引用 在移动端小记里**插不了**（**显示**不受影响：预览走内核只读兜底）。
要插这些格式目前走桌面写作卡（可展开 → 完整工具条里的面板）。**别再提议往移动端工具条加回「＋」**（用户明确否掉：突兀）。


### 5.30 移动端输入面实测：dock 是唯一入口、`/` 不可用、内核工具栏/块手柄/选区浮栏在移动端不挂载（261010 设备实测）

> 详表见 `docs/MOBILE-TECH-STACK.md` 八、覆盖矩阵；装置 `scripts/mobile-lake-coverage.mjs`。

1. **移动端编辑态没有内核固定工具栏**：`DocumentEditor` 传 `showToolbar: !editing`，而 `lakeRuntime.ts` 里
   `showToolbar === false ⇒ disabledPlugins: ["save","toolbar"]` ⇒ 编辑态 `.ne-ui-toolbar` 计数 **0**。
   桌面固定栏 27 项（撤销/重做/格式刷/清除格式/段落样式/字号/B/I/S/U/行内代码/字色(分体)/背景色(分体)/对齐/
   无序/有序/缩进/行高/待办/链接/引用/分割线/搜索/插入面板）在移动端**整条不存在**。
2. **块悬浮手柄与选区浮栏是 opt-in**（`mode === "editor" && prefs?.blockHandle` / `prefs?.floatingToolbar`）：
   移动端 prefs 只传 `fontSize/showToolbar/disableVirtualRendering/attachment` ⇒ 两个宿主计数 **0**。
   配合 §5.10（内核本身没有文本选区浮栏）⇒ 移动端**没有任何块级操作入口**（长按正文实测无菜单）。
3. **`/` 斜杠面板在移动端不可触发**：`adb shell input text '/' `（真实 IME 路径）后正文出现**字面 `/`**，
   `.ne-overlay-container` 面板计数 **0**；小记与文档都一样（用户 261010 确认）⇒ **移动端输入面 = dock**。
4. **移动端插入面板 = dock 的 11 项**（图片/拍照/附件/表格/音频/视频/高亮块/状态/引用/分割线/代码块），
   字体面板 17 项（正文 + H1–H4 + 五个行内标记 + 引用/列表/有序/待办/分隔线 + 撤销重做）；桌面插入面板 22 项里
   **缺 12 项**（分栏卡片/折叠块/画板/流程图/UML 图/思维导图/公式/文本绘图/日历/日期/表情/文档引用）
   —— 这些格式移动端**能显示、不能插入**。
5. **展示无缺口**：同一批格式在移动端全部正常渲染，含真实文件的图片/PDF 附件/音频/视频、Drawnix 画板 `canvas`、
   mermaid `svg`、表格 `table.lake-table`、折叠块、分栏、公式/日历/日期/表情卡片。

**观测（待确认，别当结论）**：内容以 `<h1>` 开头、缺 `-body` 段落的文档，出现过「标题栏对该篇、正文为空折叠块」；
同内容补 `-body` 段后移动端正常，桌面渲染一直正常，设备 DB 内容完好（无损坏）。自动化未稳定隔离 ⇒ 需人工复核。

### 5.31 移动端内嵌画板卡（Drawnix/Plait）：261019 P0 已接通编辑与文档插入

- **卡片组件按模式选**：`cards/DrawingBoard/index.ts` 的 `editorComponent: DrawingBoardEditor` / `viewerComponent: DrawingBoardViewer`；
  编辑态 `DrawingBoardEditor` 渲染 `DrawnixBoardCore` **不传 `readOnly`**，阅读态 `DrawingBoardViewer` 才传 `readOnly`。
  我们这边由 `lakeRuntime.ts` 的 `createLakeDocument(mode)` 决定，`BOARD_CARD_NAMES = {drawing-board, flowchart-board, uml-board, drawing-mindmap-board}` 走 `withCanvasWheelGate`。
- **261019 P0 已修复两个阻断点**（vendor LOCAL-CHANGES #28）：
  1. `DrawnixBoardCore` 根节点加 `data-prevent-swipe`，非只读 `.viewport-container` 加 `touch-action:none` ⇒ 移动端外壳不再抢画板横滑，Drawnix 能收到完整指针手势；
  2. 移动端创建栏不再同时写 `top:auto; bottom:14px`，保留 Drawnix 的 `top:20px` ⇒ 不再上下拉满覆盖画布。
  设备实测：画笔工具在 AVD `lake_gate` 上可画出连续笔迹；画布右拖平移、目录抽屉不出现。
- **文档插入入口**：`EditorDock` 的「更多 → 画板族」已解禁 **画板 / 流程图 / UML 图 / 思维导图** 4 项。
  正确插入路径不是 `insertCard('drawing-board', …)`，而是 custom-card 插件的正式入口：
  `insertCard('customBlock', { $name: '<卡片注册名>', $htmlStr: '', ...cardValue }, true)`；随后 `focusCard(cardId)`。
  `cardValue` 由 `core/boardDoc.ts` 的 `cardValueFromBoardDoc(createBoardDoc(preset))` 生成；flowchart/UML/mindmap 的预设模板由
  `DrawnixBoardCore.afterInit` 自动落地。
- **文本绘图仍不在这批**：它是独立的 `TextToDiagram` 卡片（Mermaid/PlantUML/Graphviz 等），不是 Drawnix 场景，继续保持置灰，待单独验收。
- **落盘实测**：4 张卡在正文中分别保存为
  `<card type="block" name="customBlock" customName="drawing-board|flowchart-board|uml-board|drawing-mindmap-board" value="data:...">`，
  value 解码后含 `$name` 与 `plaitValue`；流程图/UML/思维导图首开分别生成 31 / 36 / 26 个场景 `<g>`（含连线/节点），不是空卡。
- **仍未做**：CardResizer 的高度拖动目前仍是鼠标事件（移动端触控暂不保证可调高）；文本绘图、AI 画板助手移动端入口不在 P0。

### 5.32 移动端「文本增强」五项命令实测：能干活，但**内核对选区的认账有时序**（261012 设备实测）

> 装置：AVD `lake_mobile` + App `com.locallakexnotes.mobile` + CDP（`scripts/emu-cdp.sh 9335`）；走的是 dock 同一条路径
> `window.__mobileEditor.renderer.execCommand`，并用 `queryCommandValue/queryCommandEnabled` 回读。

**① 五项命令都有效**（返回 true 且正文确实改变）：

| 能力 | 命令 | 落盘形态 |
|---|---|---|
| 字号 | `fontsize 12/22/32/48` | `<span class="lake-fontsize-N">` |
| 对齐 | `alignment 'center'` | 块上 `style="text-align: center"` |
| 字色 | `color '#ff0000'` | `style="color: #ff0000"` |
| 背景色 | `bgColor '#ffff00'` | `style="background-color: #ffff00"` |
| 链接 | `link url,true,true` | **行内** `<a href target="_blank" data-lake-id>`（不是卡片） |

**② `lake-fontsize-N` 不是 px，禁止解析它。** 实测 12→`-9`、22→`-16`、32→`-24`、48→`-36`（≈ **px × 0.75**）；
而 `queryCommandValue('fontsize', false)` **回读的就是原始 px**（12/22/32/48 精确一致）⇒ 面板高亮/回显只能读它。
⚠️ 官方 `08 - 命令列表` 写 fontsize 取值 **10 档**（缺 48），**bundle 是 12 档** `[12,13,14,15,16,19,22,24,29,32,40,48]`
（`lakex.js` 与 `dist/index.cjs.js` 一致）⇒ 以 bundle 为准，官方文档滞后。

**③ 内核只认「真实用户选区」或内核自己建立的选区。** 纯 DOM Range（`selectNodeContents` + `addRange`）在**内核模型里不生效**：
同一批命令在这种选线下**全部返回 false**；换成真实指针选区 / `selectAllDoc` 后全部生效。
⇒ dock 的 `snapshotSelection/restoreSelection`（存的就是真实选区）方向正确。

**④ ⚠️ 从我们自己的输入框交还选区后，内核要等一拍才认（最容易踩的一条）。** 链接编辑行里点「确定」时，
「还原选区 → `execCommand('focus')` → **同一个 tick 内**执行 `link`」实测返回 **false、链接不落地**；
同样的还原与 focus、**等一拍（实测 150ms）再执行**就成功（返回卡 id 并写出 `<a href>`）。
⇒ 移动端链接确认必须**失败重试一次**（`EditorDock.confirmLink`，间隔 160ms）；桌面浮栏同 tick 执行正常，**不要**改成两边都延迟。

**⑤ `queryCommandEnabled` 在上述时序下会误报 false。** 同一时刻 `queryCommandEnabled('link')`/`('insertLink')` 都是 false，
而紧接着执行 `link` 完全成功 ⇒ **不能拿它当"能不能用"的门**（桌面旧实现正是用它把门，照搬到移动端会把可用功能整个挡掉）。
共享实现 `selectionToolbar/linkEditor.ts` 因此改为「按选区形态决定 `link`/`insertLink` 先后 + 用**命令自身返回值**判成败」；
配套：两端执行器都必须**回传内核返回值**（`useSelectionToolbar.run` / `EditorDock` 的 `useEditorExec`），
吞掉返回值就会退化成"两条都算成功" = 静默 no-op。
命令返回值的语义（实测）：`link`/`hr` 回**卡片 id 字符串**、简单命令回 `true`、失败回 `false` ⇒ 判据用 `=== false` 表示"内核明确拒绝"。

**⑥ `unlink` 在"整篇跨块全选"这种选区下返回 false。** 正常选区下的取消链接未逐项复核（登记为待验收）。

**⑦ 生成字色/背景色快捷行用的是 `src/core/colorPalette.ts` 的实色阶**（新增 `QUICK_TEXT_COLORS` 单一来源）。
⚠️ **后续已改**：移动端色板改为**照抄语雀排布**（见 §5.33），不再使用 `LakeColorBoard`；颜色仍全部取自内核色阶。

### 5.33 语雀 App 的色板实测 → 内核色阶就近映射（261012 设备采样；移动端色板照此复刻）

> 装置：用户提供 `yuque-android-1.2.2.710-release.apk`（`com.yuque.mobile.android.app`）装在 AVD `lake_mobile`，
> 编辑态格式面板展开后用 `adb exec-out screencap -p` 采样（540px 宽 / density 210 ⇒ **1.3125 px per dp**）。

**排布 = 2 行 × 7 格**（上面还有一排「字色快捷 A」＝ 默认 + 灰/红/琥珀/绿/蓝 + 背景色方块）：

| 排 | 语雀实测（7 格，从左到右） |
|---|---|
| 浅色系 | **无填充** `#FFFFFF` · 粉 `#FBE4E7` · 杏 `#FDE6D3` · 黄 `#F9EFCD` · 绿 `#E8F7CF` · 蓝 `#D9EAFC` · 紫 `#E6DCF9` |
| 实色系 | 灰 `#D8DAD9` · 红 `#DF2A3F` · 橙 `#ED740C` · 琥珀 `#ECAA04` · 绿 `#74B602` · 蓝 `#117CEE` · 紫 `#601BDE` |
| 字色快捷 A | 默认 `#262626` · 灰 `#8A8F8D` · 红 `#DF2A3F` · 琥珀 `#ECAA04` · 绿 `#74B602` · 蓝 `#117CEE` · 背景色方块 `#BFBFBF` |

**几何（实测）**：色块**圆形**，直径 **49px≈37dp**；列距 **68px≈52dp**；行距 **63px≈48dp**（排间净空 ~11dp）。

**★ 关键发现：语雀用的就是同一套 lakex 色板** —— 实测默认字色 `#262626` 与背景色方块 `#BFBFBF`
**逐字节等于**内核色阶 `COLOR_BOARD_GROUPS[0]` 里的值（ΔE 0.0 / 0.9）。其余色按 Lab ΔE 就近取内核色：

| 语雀 | 内核（取用） | ΔE | | 语雀 | 内核（取用） | ΔE |
|---|---|---|---|---|---|---|
| #FBE4E7 | #FFE8E6 | 2.9 | | #D8DAD9 | #D9D9D9 | 0.9 |
| #FDE6D3 | #FFECE0 | 4.4 | | #DF2A3F | #FF4D4F | 10.8 |
| #F9EFCD | #FFEFD1 | 3.0 | | #ED740C | #D46B08 | 9.0 |
| #E8F7CF | #E4F7D2 | 2.1 | | #ECAA04 | #D4B106 | 14.3 |
| #D9EAFC | #DEE8FC | 2.6 | | #74B602 | #73D13D | 13.8 |
| #E6DCF9 | #EFE1FA | 3.2 | | #117CEE | #096DD9 | 6.3 |
| | | | | #601BDE | #722ED1 | 14.9 |

**口径（用户 261012 定）**：**色板照抄语雀的排布与格数，但颜色一律取内核色阶、不自己造色** ⇒ 落在
`src/core/colorPalette.ts` 的 `MOBILE_BOARD_LIGHT` / `MOBILE_BOARD_SOLID` / `QUICK_TEXT_COLORS`（颜色字面量只在该文件）。
移动端色板**不再使用** `LakeColorBoard`（内核色卡是 10 列 × 7 组 ≈ 70 色，与语雀 2×7 的观感与触达尺寸都差很远）；
复刻件在 `src/mobile/editor/EditorDock.tsx` + `editor-dock.css`，**应用语义仍复用** `colorApplyCommand` + `colorMemory`
（清除/无填充、最近使用色、持久值与视觉值的区分都走同一套）。副作用：面板内容高度 **875px → 489px**。

**两处 ΔE 偏大、可人工换档**（留档，未改）：`#ED740C` 取 `#D46B08`（ΔE 9.0，视觉偏棕；次优 `#FA8C16` ΔE 10.2 更接近语雀的亮橙）、
`#DF2A3F` 取 `#FF4D4F`（ΔE 10.8，视觉偏亮；`#F5222D` ΔE 17.0 但更接近语雀的绛红）。

### 5.34 内核两族 mount 类与「桌面引擎几何」在移动端的实测（261013；设备实测 + 读码）

**① ne-doc-major-editor-mobile / ne-doc-major-viewer-mobile（156 / 203 条）：实测零收益 ⇒ 不启用。**
这两族几乎全部（editor 156/156、viewer 201/203）挂在 `.ne-paragraph-spacing-relax.ne-typography-classic` 上；
而我们运行的实例是 **`ne-typography-traditional`**（设备实测 `.ne-viewer` 类名 = `ne-viewer lakex-default-theme fz16 ne-viewer-layout-mode-fixed ne-typography-traditional`）
⇒ 选择器根本不匹配。设备实测：给宿主加上 `ne-doc-major-editor-mobile` 后，h1 / p 的 font-size / line-height / margin **逐项不变**。
⇒ 这两族**不是**可用的「现成移动端排版」，别再当低成本抓手提（AGENTS §3#17：证不了收益就不做）。

**② ne-doc-major-viewer（19 条）：官方要求阅读器带它，我们 viewer 用的是 editor 类 —— 但移动端直接换类是净负。**
- 官方文档 59 要求「阅读器容器带 `ne-doc-major-viewer`、编辑器带 `ne-doc-major-editor`」。
- **读码核对**：非 -mobile 的 `.ne-doc-major-editor` 规则共 160 条，其中**指向 `ne-viewer` 的 0 条** ⇒ 换类不会丢任何阅读态样式。
- 但那 19 条**全部按桌面 750 版心**写：`.ne-viewer-body{padding:0 50px}`（412px 屏上正文只剩 312px）、
  `ne-table-hole.ne-full-width ne-table-wrap{min-width:750px}`、`ne-root-card-hole.ne-full-width > ne-card{min-width:750px}`
  （后两条在手机上必然溢出，且会被我们的 `.ne-editor-wrap{overflow-x:hidden}` 静默裁掉）。
- ⇒ 移动端要换必须**同时中和这三条**，收益（4 条 `ne-*-hole.ne-full-width{max-width:100%}`）与新增复杂度不成比例 ⇒ **本批不做**；
  桌面端换类才可能吃到「750 版心」的正当收益 ⇒ **留给桌面会话单独验收**（本条即实验记录）。

**③ 引擎几何残留（已修）：`.ne-layout-mode-fixed/.ne-layout-mode-adapt .ne-engine { min-height:1024px; padding:20px 70px 90px 70px !important }` 是按桌面写的。**
我们原先只压了左右内距 ⇒ 手机（视口约 790）上短文档会多出约 230px 幻觉滚动，再叠加 90px 底内距＝双份底部空白。
设备级联实测（把合成的 `.ne-layout-mode-fixed > .ne-engine` 放进 `.mobile-doc-body` 读计算值）：
改前 `min-height:1024px` / `padding-bottom:90px`；改后（`mobile.css` 加 `min-height:0!important; padding-bottom:0!important`）= **0 / 0**。
小记写作卡用的是 **note 版式**（`.ne-doc-note-editor`），引擎几何是 16/8/24、min-height 实测 336.9px（不是 1024）⇒ 不受本条影响。

**④ 为什么这里必须 `!important`（机制，别记错）**：内核 CSS **未分层**（由内核/入口直接注入），我们的移动端样式在 `@layer` 里。
按 CSS Cascade 5：**普通声明：未分层 > 分层**；**`!important` 声明：分层 > 未分层（层序反转）**。
所以「分层里的 `!important`」能压未分层的内核 CSS，而分层里的普通声明压不过 —— 这是 `mobile.css` 那 18 条 `!important` 的共同由来。

### 5.35 内核「表情面板」的类契约 + 我方姿势（261013 复用 → **261014 桌面已解耦**；读码 + 设备实测）

**结论：内核表情面板不是导出的组件，但它是一套「类名即契约」的 DOM + 已随内核分发的 CSS ⇒ 可以整体复用。**

**① 它不是公开组件**：`vendor/lakex-doc-react/dist/index.d.ts` 里**没有任何 emoji / picker 导出**；面板是内核内部 React 件
（props 有 `emojiGroups` / `onEmojiSelect` / `disableRecent` / `disableTabs`；`_renderFooter` 里 `tabs = Object.keys(emojiGroups)`，
有最近记录时才前置「最近」），只在点击 `unicodeEmoji` 占位卡时才由内核挂出来（§5.29）⇒ **不能 import，但可以照它的 DOM 结构自己渲染**。

**② 类名族（`dist/style.css` 共 21 条规则，已随我们的构建进包）**：
`.ne-ui-unicode-emoji-panel`（418px / radius 8 / 自带边框 + 投影 + `--lakex-editor-background-foreground` 底）＞
`-panel-header`（padding 16 16 0，内放 `-search`）· `-panel-content`（**固定高 266px** + `overflow-y:scroll` + padding 0 16）＞
`-group` ＞ `-label`（caption 色 / 12px）+ `-content`（**只写 `display:grid`，列数由 JS 内联 `repeat(N, 1fr)` 给**）＞
`-item` ＞ `span`（**32×32 / radius 4 / font-size 26px** / hover 用 `--lakex-editor-background-primary-hover`）；
`-panel-footer` ＞ `-tabs`（flex / space-between / gap 10）＞ `-tab-item`（26 高 / min-width 40 / **选中 700 字重 + text-color**）。

**③ ⚠️ 复用姿势已于 261014 **废弃**（桌面也不再复用内核类；①②仍是内核事实，保留）**：
261013 桌面那份确实按 §5.24 noteRefCard 的姿势复用过（`surfaceClassName="ne-ui-unicode-emoji-panel"` + `className="lakex-default-theme"`）；
**261014 用户点单「这两个面板可以分离了，做到互不影响」后解耦**：
· 根因 = 复用只能靠**全局覆盖**（`.ne-ui-unicode-emoji-item > button` / `-tabs` / `-search input`，写在未分层文件里）
  与**给该表面钉 5 个 `--lakex-editor-*` token** —— 这两样**同时命中文档里内核自己的表情面板**（内核在正文里用同一套类挂它自己的面板）。
· 现在（自有面板）：表面走 Overlay 默认的 `.ln-popover`、输入走 kit 的 `.ln-input`、类型页签走 kit 的 `.ln-tabs`，
  两页（表情符号 / 图标）的网格在 `src/components/ui/nodeIcon.css`；**几何沿用原观感**（418 宽 / 内距 16 / 正文固定 266 高 / 8 列 / 32 格）
  ⇒ 不依赖任何内核 token，三主题一律由 `--lake-*` 决定。上面那 3 条全局覆盖与 5 个 token 已删除。
· 内核这套类**现在只属于内核自己的面板**（移动端 261013 起也是自有的微信样式面板）⇒ **别再加耦合**。
· **261015 桌面应用层更新（含第二轮用户截图修订）**：顶部页签栏右侧（`.ln-tabs__action` / `.ln-btn--ghost`）为EyeOff +「移除」，两页共用；底部仅保留表情分组跳转。自定义图标走`NodeIconGlyph`的**飞书参考浅渐变圆角底块 + 白色线性轮廓**，选择器/目录/标签单一来源，八档底色三主题同源；32×32圆角方色板按用户截图排列，显式code保持落库色号独立于展示顺序。隔离Electron `locallakexnotes://app`实测：表情页418×392 / 图标页418×358，正文仍266高、表情仍26px/1055格；渐变预览与两页移除落库正常。来源：`src/components/{app/Sidebar.tsx,ui/NodeIconGlyph.tsx,ui/nodeIcon.css}` + `.css-audit/node-icon-soft-261015/results.json`（真实点按/计算值/截图）；旧实色证据在`.css-audit/node-icon-tile-261015/`。未改内核API或样式。
· **261015第三轮交互**：目录选择器选图标/表情/移除后保持打开，用更新的picker值即时更新选中格；仅点击外部（含其他浮层）/Esc关闭。实现是Sidebar + Overlay既有外点机制，不影响正文内核表情面板；运行时证据`.css-audit/node-icon-stay-261015/results.json`。
· **261015第六轮应用层定位**：目录图标选择器不再按鼠标点击点定位，改为真实图标元素锚点 + `usePopoverPosition`既有右侧定位，距图标右缘8px。底部/窄窗仍不遮挡锚点；1315×860/760×600/560×600实測相交面积0。色板在采样渐变基础上累计混白约41%。来源`Sidebar.tsx` / `themes/base.css` + `.css-audit/node-icon-anchor-261015/results.json`；不涉及内核改动。
· **261015第七轮应用层图形尺寸**：`NodeIconGlyph`两类共用1.15em居中槽，图标缩小、表情字号放大。目录两类17.82px / 标签两类14.95px；选择器图标底块23px，表情选择格仍26px字号。来源`NodeIconGlyph.tsx` / `nodeIcon.css` / `themes/base.css` + `.css-audit/node-icon-size-261015/results.json`（真实Electron计算值/截图）；不影响内核表情组件。
· **261015移动节点能力接入（用户追加定稿）**：移动`ui/NodeIconPicker.tsx`/`NodeIconGlyph.tsx`/`nodeIcon.css`自有实现，40图标/8浅渐变，节点表情页不import输入态`EmojiPanel`、不使用`mb-emoji-*`类。只共享资源表与编解码，最近记录写`icon`桶；文内输入表情组件未改。两端共同初始页判据`nodeIconPickerMode(nodeType)`：笔记本/分组→图标，所有文档类型→表情（不被当前值覆盖）。知识库、目录、标签列表、新建知识库预览都解析短图标值，选后保持打开。专用Android设备实测来源`.css-audit/mobile-node-icons-261015/{results.json,desktop-defaults.json,create-scroll.json,*.png}`；无内核API或正文改动。
· **261015最新桌面位置修订**：节点选择器真实锚点改为整条`.tree-row`，**贴齐该行左缘，在整行下方8px**（跟随缩进，替代上面的右侧方案）。共用定位`side:"below-fixed"`限制剩余高度，不翻到行上方，内容可滚；其他面板默认定位保留。色板回调深一档（采样版累计混白约30%），两端同档。真实Electron的行名/图标未被面板覆盖、靠底三宽可滚选最后项，来源`.css-audit/node-icon-below-261015/results.json`；仍不涉及内核改动。
列数：**桌面 8 列**（418 − 32 内距 = 386 ⇒ 格宽 ≈48，与内核截图一致）。
⚠️ **移动端最终没有走这条复用路线**（用户 261013 第二轮改口："移动端做成微信样式、分类放顶部，更适合输入"）⇒ 移动端是**自有的微信样式面板**
（261013当时形态：顶部分类按钮 + 选中浅底、正文灰底大格子/表情28px）—— **不复用内核类，也不需要那3个内核token桥**。261015起节点设置使用上面的独立`MobileNodeIconPicker`，文内输入仍使用自己的`EmojiPanel`；两者互不引用。
⇒ §5.35 的正文分两部分：①② 是**内核事实**（长期有效）；③④⑥ 是**当年的复用姿势**（261014 起作废，留作历史与教训）。

**④ 两处内核 CSS 的坑（261013 我们曾就地纠偏；261014 解耦后**与我们无关**，仅记录内核事实）**：
· `-tabs` 写的是 **`overflow-y: scroll`**（横向 tab 行，显系笔误）⇒ 带「最近」共 9 个 tab 时会**溢出到面板之外**；补 `overflow-x: auto`。
· 搜索框是内核**内部输入组件**（自带满宽/边框/内距），我们渲染原生 `input` ⇒ 需自己补盒子（宽度/内距/边框/圆角）。

**⑤ 设备实测（261013；隔离桌面实例 + 门禁 AVD + 用户 AVD）**：
· **桌面**（复用内核面板）：418×266 / 32px 格 / 26px 表情 / 选中 tab `700` / 三主题面板底 `#fff`·`#1e1f23`·`#fff`；
· **移动**（微信样式）：分类按钮 **44×44**、格子 **51×44** / 表情 **28px** / 正文底 `--lake-bg-block`(`rgb(244,246,248)`) / 分类 10 个（搜索·最近·8 组）横向可滚。
两端入口：桌面=目录行首图标本身；移动=目录每行**⋯→设置图标**（文档/分组）、首页知识库卡片**长按→设置图标**（笔记本）、新建知识库里的选择图标。移动目录的笔记本图标只展示，编辑入口在首页长按（用户261014定稿）。

**⑥（261014 起作废，仅留教训）⚠️ 这些 token 是「编辑器挂载时才注入」的 ⇒ 当年复用内核表面的那份面板会**间歇性变透明**（261013 用户实拍 + 复现 + 已修；解耦后自有面板走 `.ln-popover` + `--lake-bg-panel`，不存在该问题）**：
内核把 schema（`.lakex-default-theme{ --lakex-editor-*: … }`）作为 `<style>` **在编辑器初始化时**注入（实测页面里同时存在 HEAD 与编辑器子树两份，**没有编辑器时 tag 数 = 0**）。
⇒ 那一刻面板的 `background-color: var(--lakex-editor-background-foreground)` **失效**（computed = `rgba(0,0,0,0)`），整块**透明**、底下的树行/正文透出来；
等有编辑器挂载后又「自己好了」—— 所以是**间歇**的（复现：全新实例刚启动、tag 数 0 时 `panelBg=rgba(0,0,0,0)`；禁用那两份 style 后同样复现）。
**修法**：在**未分层**的 `src/styles/kernel-theme.css` 里给这个表面**钉住 5 个 token**（`.ne-ui-unicode-emoji-panel.lakex-default-theme{…}`，值走 `--lake-*`）——
未分层才能在 cascade 里压过内核自己的 0-1-0 普通声明（层序优先于特异性），0-2-0 + 只作用于该浮层 ⇒ 不进编辑器树。
修后实测：**把内核那两份 style 禁掉，面板依旧实心**（`panelBg=rgb(255,255,255)`，caption = 我们的 `--lake-text-3`）。
⇒ 通用教训：**凡是我们自己渲染、却依赖内核注入 token 的表面，都要显式钉一份兜底**（`noteRefCard` 那两个浮层同理，只是它们恰好没被发现在无编辑器时打开）。

**⑦ 一处有意偏离内核的行为（用户 261013 定）**：内核的页脚 tab 是 `Object.keys(emojiGroups)`，**只有存在最近记录时才前置「最近」**（`_renderFooter` 里 `!disableRecent && i.length > 0` 才插入）；
我们两侧面板**始终显示「最近」**（空的也留位置，并给一句「用过的图标会出现在这里」）—— 理由是"面板上看不到就等于没有这个能力"。记录在此，避免下次核对内核行为时误判成我们的 bug。

**⑤ 复查命令（只读）**：`grep -c 'ne-doc-major-editor-mobile' vendor/lakex-doc-react/src/assets/lakex-doc.css` ·
`grep 'ne-doc-major-editor-mobile' … | grep -c 'ne-typography-classic'` · `sed -n '5095,5100p' …/lakex-doc.css` ·
`grep -n '^\.ne-doc-major-viewer[ ,{]' …/lakex-doc.css`

### 5.36 面板命令后内核会**抢回焦点** ⇒ 移动端输入法闪出、面板塌陷（261014 设备实测；已在本层收口）

**内核行为（AVD lake_mobile / adjustResize，CDP 事件日志实测）**：在 dock 面板里执行任意一条命令（本例
`execCommand('insertAtSelection','text/lake','<span>😀</span>')`）后，内核会把焦点抢回正文 `ne-engine`：
**一次点按触发 2–3 次 `focusin`**（实测 t+145ms、t+254ms、t+4554ms 各一次，中间夹我们自己的 blur）。若此时没有拦住，
Android 认为"用户要输入"⇒ 输入法弹出（窗口 innerHeight **842 → 530**）。

**我们这层的连锁反应（= 用户看到的"表情栏闪烁"）**：面板高度由 `--kb-offset` 驱动
（`usable = max(0, innerHeight - base + panelHeight)`，语义 = 面板"接管"键盘让出的区域；`.med-panel{height:var(--kb-offset)}`）⇒
输入法一弹出，这个值从 **312px 塌到 0px** ⇒ 面板整块消失（实测 `panelH 312 → 1`），等 blur 生效、输入法收起（约 200ms）再恢复。
原兜底是 `keyboardOpen` 的 effect（`useKeyboard` 报告键盘弹出后再 blur）：实测 **t+1247 才 blur**（`focusout` 时
innerHeight 已是 530、`win-resize` 已在 t+1310 发生）⇒ **晚约 1s，必闪**。

**收口（单一来源 = `EditorDock` 既有的 focusin 守卫）**：非"用户手指点正文"的聚焦，在**面板开着**时于 focusin 的
**同一个任务内**立刻 `blurActiveEditable()`（面板态用 ref 镜射——监听只挂一次）；用户点正文 → 仍按原语义收面板。
护栏 `src/mobile/editor/dockPanelFocusGuard.test.ts`（6 例，自证：改回旧写法 ⇒ 2 例红）。

**⚠️ 与守卫配套的一条硬约束：面板态必须"同步"写进 ref，且只有 `setPanel` 一个写入口。**
`togglePanel` 收起面板是 `setPanel(null) → focusEditor()` **同一个 tick**（要"键盘与面板动画同时开始"）；若 ref 靠 React 渲染才同步，
守卫在那一刻读到的还是旧面板态 ⇒ **把刚 focus 起来的键盘又收掉 ⇒ 收起面板后键盘回不来**（本修复自查发现的真回归，已用
"同步写 ref + 单一写入口"修掉，并用设备实测复核：收起面板后 innerHeight 842 → **530**、焦点回 `ne-engine`、面板 `data-panel=none`）。
⇒ 以后新增面板态写入点，一律走 `setPanel`。

**修后设备实测（同脚本同入口，两处入口都测)**：
· 小记写作卡：`focusin` 3 次，每次 **5–20ms 内**被 blur；全程 **0 次 `resize`/`visualViewport.resize`**、
  innerHeight 恒 **842**、`--kb-offset` 恒 **312px**、`panelH` 恒 312 ⇒ 不闪；
· 文档编辑器（探针文档，测完已移回收站）：`panelH` 恒 **280** / `--kb-offset` 恒 280px / innerHeight 恒 842 / **0 次 resize**。
（对照：修前同一脚本测得 `win-resize` 530 → 842、`panelH` 312 → 1 → 312。）

**口径**：面板的语义是"占住键盘区 = 键盘不显示"（用户 260914 定）。任何让正文重新拿到输入焦点的内核行为都必须在这一处被吞掉；
**不要**去改 `--kb-offset` 的公式 —— 公式本身是对的（键盘真弹出来时面板确实该让位），错的是"让键盘弹出来"这件事发生了。

### 5.37 内核 note 版式的 `min-height: 40vh`：**40vh 跟视口走** ⇒ 移动端"键盘⇄面板"切换时写作卡会长高（261014 设备实测；已收口）

**内核规则（vendor `lakex-doc-react/src/assets/lakex-doc.css:6205`）**：
``.ne-doc-note-editor .ne-note-ui .ne-engine { min-height: 40vh }`` —— 小记用的 **note 版式**给引擎一个按**视口**算的最小高。

**为什么在移动端会坏事**：Android adjustResize 下**只有输入法会让 WebView 变矮**（实测 842 → 530），
我们自己画的面板（`.med-panel`，fixed 占键盘区）**不让视口变矮**。于是：
- 输入法态：40vh = **212px**；面板态：40vh = **337px** ⇒ 小记写作卡 **320 → 428**（用户报的"编辑区跳动"）。

**收口口径（我们这层，不动 vendor）**：把 40vh 换成**稳定外壳高的 40%** ——
``.quick-note-editor .ne-doc-note-editor .ne-note-ui .ne-engine { min-height: calc(var(--mb-app-h, 100%) * 0.4) }`
（`--mb-app-h` = 键盘收起时的外壳高 − 当前底部占用，由 `EditorDock` 在 `useLayoutEffect` 里写到 `:root`；
选择器必须比内核那条更具体：`body.lake-mobile` 前缀 = 0-5-0 > 内核 0-3-0）。
修后设备实测：两种状态下引擎 min-height 恒 **212px**、写作卡恒高（398），切换不再跳。

**同源教训（一般化）**：凡是**内核写的 vh / dvh / %** 定高，在移动端都可能在"键盘⇄面板"切换中变形。
判据 = **问它按什么基准算**：按视口算的（vh/dvh）一律要换成按我们的稳定外壳算（`--mb-app-h`）。
另有同类：`.mb-emoji-body { height: 42vh }`（只在面板态出现，视口恒 842 ⇒ 目前无碍，登记备查）。

**② 内核 note 版式的**滚动口高度与上限**也是按视口算的（261014 深挖到的真凶）**：
`.ne-editor-wrap-content`（note 版式里**真正滚动的那个元素**，`overflow-y: auto`）实测：
- `clientHeight` = **260（键盘态 530）⇄ 572（面板态 842）**，`max-height` 计算值 **260.286px ⇄ 572.286px**（≈ 视口高 − 270）；
- 视口一变内核就**重新锚定**：`scrollTop 1264 → 978`、正文首块位移 **285px** ⇒ 这就是用户报的"长内容下编辑区还在跳"
  （短内容看不出来：没超出一屏时它不滚）。

**收口（我们这层，CSS 钉住容器链 + 解除上限）**：
```css
body.lake-mobile .quick-note-editor > .lake-editor-mount { flex: 1 1 auto; min-height: 0; height: 100%; }
body.lake-mobile .quick-note-editor .ne-editor,
body.lake-mobile .quick-note-editor .ne-editor-body,
body.lake-mobile .quick-note-editor .ne-editor-wrap,
body.lake-mobile .quick-note-editor .ne-editor-wrap-content { height: 100%; min-height: 0; box-sizing: border-box; max-height: none !important; }
```
- `max-height` **必须 `!important`**：那条上限来自内核注入的样式，普通声明压不过（我们 0-5-1 也没赢）；
  这正是「目标是内核/第三方样式」的例外（AGENTS §3#14）——夹取本身在移动端就是错的（高度由外壳 `--mb-app-h` 给定）。
- **自证（设备实测）**：改前 `wrap.clientHeight 260 ⇄ 306`、首块 Y 位移 46px；改后**键盘态/面板态/收回态三者
  `clientHeight=306 / scrollTop=1218 / engTop=-1141 / firstBlockY=-1125` 逐项完全相同（位移 0）**。
- ⚠️ 另一条同批教训：**不要给它再加第二个滚动容器**。我一度把 `.quick-note-editor` 也设成 `overflow-y:auto`，
  两层滚动打架（外层 st 0 → 239、sh 318 → 584）——内核的滚动口就让它滚，我们只负责框住高度。

### 5.38 移动端「收输入法但**留住光标**」：`inputmode="none"` + blur/focus（261014 设备实测；两轮才收口）

**要解决的问题**：dock 面板要占住键盘区（面板展开时键盘不显示），但**正文的光标必须留着** ——
用 `blur()` 收输入法会把焦点与光标一起收掉（用户原话："点了 ＋ 之后编辑区的光标会消失"）。

**实测口径（AVD lake_mobile，纯 JS 可做，不需要原生插件）**：给内核正文宿主（`.ne-engine`，即 contenteditable）
加 `inputmode="none"` 再 `blur() → focus()`：

| 状态 | innerHeight | activeElement | 选区 | 光标矩形 |
| --- | --- | --- | --- | --- |
| 聚焦（键盘开） | 530 | `.ne-engine` | 有 | [164,182] |
| **加 inputmode=none + blur+focus** | **842（键盘收了）** | **`.ne-engine`（焦点还在）** | **有** | **[164,182]（逐项不变）** |
| 去掉该属性 + blur+focus | 530（键盘回来） | `.ne-engine` | 有 | [164,182] |

**两条必须记住的坑（都踩过，别再犯）**：
① **不要用布尔量判「用户点了正文」**：面板期正文一直有焦点，点它**不会再触发 focusin**；而那个布尔量会被上一次点击留下 `true`，
   再被**我们自己**抑制输入法时的 blur/focus 触发 ⇒ 误判 ⇒ **面板开了 ~630ms 自己关掉**（逐帧时间线实测：
   `mode=insert/panels=1` 只维持了 630ms 就变回 `none/0`）。⇒ 判据放 **pointerdown**、只用当次事件；
   focusin 分支只服务「内核命令后抢焦点」这一件事，且**只写 `inputmode` 属性、不 blur**。
② **抑制函数自身要防重入**：blur/focus 会**同步**触发 focusin，若 focusin 分支再调抑制函数 ⇒ 无限递归。
   用模块级 `inSetback` 标志包住（本仓已加，落点 `src/mobile/editor/useEditSurface.ts` 的 `suppressImeNow`）。
   P2/P3 之后这三件事（外壳高度 / 面板状态机 / 输入法抑制与焦点守卫）**只有 useEditSurface 一个实现**，
   几何算术在 `editSurfaceModel.ts`（纯函数 + 单测），内核几何收口在 `edit-surface-kernel.css`（doc/note 共用 marker）；
   行为由 `scripts/mobile-audit/edit-surface-invariants.mjs` 的四条不变量卡住。
③ 收面板要收敛成**一个出口**（`closePanel()`：× / 再点 ＋ / 用户点正文三处共用）：`setPanel(null) → focusEditor()`
   （后者负责清抑制 + 重新聚焦把键盘放回来）→ 等键盘真回来再清占位（§5.36 的口径）。

### 5.38.1 展开键盘必须先摘 `inputmode`；稳定外壳高会被 IME 过渡的 `innerHeight` 污染（261015 用户报「键盘只能收不能展」）

**现象**：⌨ 按钮「有键盘时点一下能收、没键盘时点一下不弹」（用户报）。两层根因，都在设备上量出来了：

1. **展开路径漏了"摘抑制"**：收键盘走 `suppressImeNow(true)` —— 它给正文宿主写 `inputmode="none"`（这是"留住光标"的关键）。
   展开时只 `focusEditor()`、**没摘掉该属性** ⇒ 系统认定该宿主不接受软键盘，`focus()` 也不弹
   （修复前两连点实测：`ih` 仍 842、`inputmode` 仍 `none`、按钮标签仍「展开键盘」）。
   ⇒ 正确顺序：**先 `restoreIme()`（摘属性 + blur/focus），再聚焦**；再补 `showNativeKeyboard()` 作兜底（程序化 focus 不保证弹）。
2. **稳定外壳高基准被污染 ⇒ `keyboardOpen` 永久为真**：`viewportShell` 的"单调取历史最大值"会被
   **IME 过渡里单独失真的 `window.innerHeight`** 记牢（本机反推：基准 **866**，真实稳定值 **842**；
   由 `--mb-app-h` / `--kb-offset` 两组读数 + `capturePanelHeight` 的下限 280 解出）。一旦记进去就再也降不下来
   ⇒ `keyboardOpen = shellHeight() − innerHeight > 8` 恒真 ⇒ ⌨ 永远走「收键盘」分支、永远弹不出来。
   ⚠️ 这个污染**不表现在几何上**：`--mb-app-h = shell − occupation` 里两项互相抵消、恒等于 `innerHeight`
   （所以界面看不出来，是"点一下没反应"这种纯行为缺陷 —— 只看截图/Stylesnap 是发现不了的）。
   **修法**：`noteViewport(innerHeight, visualViewport.height)` —— **只在两通道一致（差 ≤8px）时才抬高基准**；
   两通道在 adjustResize 下恒等、edge-to-edge 下只差键盘高，正好拿来做一致性校验（不引入新机制）。
   **判据**：`scripts/mobile-audit/keyboard-toggle.mjs`（K1 收+留光标 / K2 弹+摘属性 / K3 可反复开合）
   **必须与 `edit-surface-invariants.mjs` 联跑**（稳定外壳高是它的地基：I1 三态几何逐项相同）。
3. **面板开着时 ⌨ 不能走「只收键盘」那条路**（261015 用户报「点了 ＋/T 再点键盘 ⇒ 一块空白」）：
   `closePanel("hide")` 的设计语义是"**无面板时**只收键盘、留住光标"；面板开着用它 ⇒ 面板虽然关了，
   但**占位要等 2.5s 兜底才释放、且键盘不回来** ⇒ 用户看到的正是那块空白
   （实测：点后 0.3s / 1.2s 都还是 `--kb-offset:280px / --mb-app-h:562px / inputmode:none`，直到 3.0s 才复位）。
   ⇒ **面板开着时 ⌨ 必须走 `closePanel("restore")`**（与 × / 点正文同一条路：关面板 + 放回输入法）。
   修复后实测：0.3s 内即 `ih 530 / --kb-offset 0 / inputmode null`、面板关闭、工具栏回到键盘上方，**无空白**。
   判据：`dockPanelFocusGuard.test.ts` 断言该分支为 `closePanel("restore")`，且仓内不再有 `dismissKeyboard`。

### 5.39 内核「查找替换」面板：开箱可用，但只有真实按键能唤起（261016 实测；**宿主入口评估后不做**）

**内核能力**：插件 `search`（`toolbar: 'search'`，命令 `search`/`replaceText`/`replaceAll`）自带完整面板 `.ne-ui-search-panel`：
「查找 / 替换」两个页签、`请输入` 输入框、命中计数（`N/M`）、上一个/下一个；输入即高亮。热键由它的 toolbar descriptor 注册：
本构建开着虚拟渲染 ⇒ 热键是 **⌘F**（源码 `virtualRendering ? ['cmd','F'] : shift+cmd+F`）。该命令族**不在官方 08 命令列表**里。

**四条实测（隔离 locallakexnotes://app + CDP，261016）**：
1. **只有真实按键能唤起**：trusted 按键可打开；页面内 `new KeyboardEvent(...)`（untrusted）无效。
2. **没有可编程的打开口**：`hotKey` 插件自身**未注册 service**（`kO({ pluginName: 'hotKey' })` 无 `service`）；
   `renderer._$services[]` 里能扫到 hotKey 管理器（有 `triggerHotKey`/`getKeyByName`），但 `triggerHotKey('openSearchPanel')` 返回 undefined、面板不出现。
3. **要求编辑器持有焦点**：焦点在顶栏按钮上时 ⌘F 无反应（要 `.ne-engine` 持有焦点）。
4. `search`/`replaceText`/`replaceAll` 的入参是**选区/ranges**（`execute(e,t,n)` 里 `t.forEach(range)`），不是关键词 ⇒ 可复用单位是「面板」，不是命令。

**结论（用户 261016 定）：宿主不做入口。** 内核查找替换**当前即可用**（⌘F，面板自带高亮与计数），
为它做"顶栏按钮 + 主进程注入 trusted ⌘F"属于多余（该实现曾提交为 `d62d06e`，已整体回滚）。
移动端同样不做：工具栏被关（`disabledPlugins:["save","toolbar"]`）⇒ descriptor 不注册、无面板也无热键；要做只能自研。

**移动端（261016 已落地）**：移动端关掉了工具栏插件 ⇒ 面板与热键都不存在 ⇒ 宿主自研 `src/mobile/editor/MobileFindBar.tsx`：
DOM 文本节点扫描（移动端文档 `disableVirtualRendering:true`，整篇正文在 DOM 里）+ CSS Custom Highlight API 双高亮（全部/当前）+ `n/m` + 上/下一个；
入口 = **工作区顶栏右上角**（工作区胶囊是定稿四格、不放搜索）。设备实测：搜「人类」`1/3` → 下一个 `2/3` → 关闭后 `CSS.highlights.size=0`；
移动 6 态快照门禁因顶栏多一个按钮而按配方重烤基线，冷启动后 0 差异。
（附录·实现备忘：那次回滚掉的姿势 = 渲染层先 `execCommand('focus')` 再把焦点交给主进程 `webContents.sendInputEvent({ keyCode: 'F', modifiers: ['meta'|'control'] })` 注入 trusted 按键；
若将来移动端要复用内核面板，这条是唯一可行路径。另注：让出一拍**不要用 `requestAnimationFrame`** —— CDP 依附/隐藏窗口下 rAF 不触发，会静默失效。）

### 5.40 图片放大预览：本构建**不派发** `envAdapter.previewImgs`（261016 实测；B8 结案）

**内核侧静态事实**：`envAdapter.previewImgs(imgs, index)` 是官方适配口，内核把它当**编辑器事件**转发
（bundle @1482481：`editor.on('previewImgs', (e,n) => t.previewImgs(e,n))`）；图片卡选项默认 `allowClickToMaximize: true`（bundle @5865257）。

**两条实测（隔离 `locallakexnotes://app` + CDP）**：
1. 在活动宿主内挂 `editor.on('previewImgs')`，对 inline 图片卡（64×64 真图，鼠标落在其中心）真实点击 ⇒ **事件 0 次**。
2. 临时给 `createOpenEditor` 补上 `envAdapter.previewImgs` 并重建后复测 ⇒ **仍然 0 次**（回调与事件都没有）。临时改动已回滚、源码与产物残留检查均为 0。

**结论**：本构建点击 inline 图片卡**不会派发真预览事件** ⇒ 宿主自研的 `.ne-image` DOM 点击 + `extractImagesFromContent()`（从正文取图，
规避 `cardLazyInit` 与虚拟渲染）**是必需路径**，不是"重复实现内核能力"。**不要**按官方口接 `previewImgs` 再把自研预览删掉（会退回"点了没反应"）。

### 5.41 块/容器「移动」命令族的真实语义 + 宿主不入（261016 读码 + 实测）

**语义（读码；注意命令类体在 `Object.defineProperty(Cls,'ID',…)` 之前，按 ID 名往回找类体）**：
- `moveCollapse/moveColumns/moveTable(targetId, nodes)` = **目标侧插入**：把 `nodes` 插到目标容器/卡片**所在位置**并选中它（保节点 id）；前置是目标类型匹配（collapse/columns/table）。
- `moveCard(cardId, position)` / `moveImage(cardId, position)`：把卡片移到 position；**`moveImage` 是 `moveCard` 的子类、无自有 execute**；position 是**内核内部对象**。
- `moveColumn(columnsId, from, to)` = 容器内列重排（越界 false）；`tableRowMoveTo(i)` / `tableColumnMoveTo(i)` = 当前选区所在表格的行/列移动。

**实测（261016，隔离 `locallakexnotes://app` + CDP）**：`moveImage(cardId, …)` 试了 ① DOM 节点 `{node,offset}`、② `engine.transformDOMRange(range).start`（模型 position）、③ `{start,end}` 三种形状，
**全部抛 `setStart: parameter 1 is not of type 'Node'`**；`.lake` 序列化逐字节未变、`undo=false` ⇒ 该 position **无法从公开面构造**。

**结论：宿主不入这套命令。** 我们的「摘-插」模型事务覆盖所有块类型，而内核没有"任意块移动"接口（非卡片块完全没有）。
将来若要做**容器内重排**，直接用 `moveColumn` / `tableRowMoveTo` / `tableColumnMoveTo`（走内核撤销栈、保 id），不要再自研。

### 5.42 偶发 `IndexSizeError: getRangeAt: 0 is not a valid index`（内核选区竞态，不是宿主代码；261023）

**现象**：偶发一条渲染层未捕获异常：

    [window] 未捕获异常 error="IndexSizeError: Failed to execute 'getRangeAt' on 'Selection': 0 is not a valid index." stack="at HTMLDocument.value (locallakexnotes://app/assets/index-*.js:…)"

**为什么容易误判成"我们的代码"**：
1. 帧来自 `index-*.js` —— 本仓库把**闭源内核打进了入口 chunk**（`vite.config.ts` 的 `exclude` 只是 optimizeDeps 的事；产物里 `plugins/selection/...` 这些内核源码标签都在 `dist/assets/index-*.js`）。
2. 函数名显示为 `.value` —— 内核经 Babel 编译，类方法以 `Object.defineProperty(..., { key, value: function … })` 形式挂载，匿名函数在 V8 里就叫 `value`；`HTMLDocument` 只是调用时的 receiver（挂在 document 上的 handler）。

**根因（产物取证）**：在 `dist/assets/index-*.js` 里数 `getRangeAt(0)` 共 **59** 处，其中 **31** 处前后没有 `rangeCount` 守卫；带内核源码标签的落点集中在
`plugins/selection/src/common/dom-selection-helper.ts:1205` 与
`plugins/selection/src/render/selection-observer/keyboard/{table,columns}-keyboard/.../move-{left,right,up,down}.ts`。
⇒ 内核在 selection observer / 键盘移动路径里**假设 DOM 选区恒有 ≥1 个 range**；当选区被清空（切标签、焦点转移、窗口激活、程序化 `removeAllRanges()`）而内核 handler 仍在跑 ⇒ 抛 IndexSizeError。

**宿主侧不是来源**：桌面自有代码里 `getRangeAt` 共 8 处，**全部先判 `rangeCount`**
（`EditorTab.tsx` copy/cut、`LakeEditor.tsx` copy/cut、`selectionToolbar/useSelectionToolbar.ts`、`selectionToolbar/linkEditor.ts`、`SelectionToolbar.tsx` 三处）。排查时**不要**再去动这些守卫。

**触发与频率**：少见竞态。261023 本机只在"自动化建文档 + 机器同时有其他负载"时见过 1 次；随后 10+ 轮受控复现（新建 / 多标签快速切换 / 清空选区）均为 **0** 次。原先"隔离实例必现"的判断不成立。

**处置**：不 patch 内核（闭源 + 需改 vendor；证据只到"内核未守卫"这一层）。该异常已由渲染层 `window.onerror` 兜底记录（见 `docs/LOGGING.md` §5），应用继续运行、不丢数据；同一异常会留两条日志（我们的 `[window] …` + 浏览器 `Uncaught …`），以带 `stack` 字段的那条为准。
若将来**频繁出现**（日志里可数）再考虑：先在 vendor 里定位到具体 observer 函数，按 `vendor/lakex-doc-react/LOCAL-CHANGES.md` 做单点最小 guard。

### 5.43 「加密文本」卡：内核只有占位，语雀是服务端加密（261023 调研 + 自研落地）

**用户问题**：截图里的「加密文本」卡片（标题 + 「未设置密码，将明文显示」/「输入密码 · 解锁」/「锁住」三态）怎么实现的、我们能不能做。

**① 内核侧：只有"身份证"，没有任何实现**（v1.99.0）：
| 位置 | 内容 |
|---|---|
| `lakex.js:76632-76636` | `LOCKED_TEXT:{NODE_NAME:'lockedtext',UI_NAME/OPTION_NAME/LAKE_NAME:'lockedtext'}`（与 VOTE / LOCAL_DOC / TRANSFER / THREE 同组，都是宿主 App 侧卡片） |
| `lakex.js:122918` | 表格版式 cardSelect 的**按名移除**清单里有 `'lockedtext'`（不是"默认面板含它"） |
| `lakex-doc.css:667 / :20698-20703` | `.ne-svg-icon-insert-lockedtext` 图标类、分栏内 `ne-card[data-card-name='lockedtext']` 的 `min-width:380px`（**没有** `.ne-card-lockedtext`） |
| `icon.tsx:1855/1880` + `public/vendor/lakex-doc/kitchen-iconfont.js` | 共享 sprite 里的 `icon-加密文本`（sprite 连内核不认识的卡片图标都有 ⇒ 不能当能力证据；语雀 App 实际用 `editor-main-encrypted-text`，我们全仓 0 命中） |

- **为什么面板里没有它**（可复用机制）：插入面板渲染时按名查注册表，查不到直接 `return null` 再 `filter(Boolean)`（`lakex.js:165979-166007`，`_transformConfig`）⇒ **未 `registerCardSelect` 的项不可能出现**。我们的面板 = 内核默认 groups 只过滤 third-party（`lakeRuntime.ts:855-871`）。
- **内核无任何 crypto 原语**：`password|secret|AES|PBKDF2|importKey|deriveKey` 全 0（唯一 "Encrypt" 是 React 的 `onEncrypted` 属性表）。
- **未知卡不丢数据**：fallback reader（`lakex.js:85085-85100`）读成通用 `block/inline` 节点并保留 `{cardName, cardValue}`，写回原样输出（`:85143-85146`）；界面显示「该卡片暂时无法显示」。副作用：`data-card-name` 退化为 `block`。
- **产物侧也没有懒加载卡包**：`public/vendor/lakex/alipay/**`（195 个 svg/字体文件、0 目录）+ `public/vendor/cdn/**`（35 文件、4 个 js）全量检索 `lockedtext|加密|密码` = 0。

**② 语雀产品侧（`yuque-re/android/out/nebula-offline/p__webapp__mobile_app__noteEdit.async.js`，5.9MB 单行，APK 1.2.2/710 快照）**：
- 卡名：`PluginName "lockedText"` / `cardName "lockedtext"`；DOM `ne-card[data-card-name='lockedtext']` + `.ne-card-locked-text`；状态 `editing / set-password / unlock / read`；底部小把手 = **高度 resizer**（`getResizerConfig(){return{min:240}}`），不是折叠。
- 值形状：`{originData, cryptoData, locked}`；`toLake(e){return e.cryptoData ? {originData:"", cryptoData:e.cryptoData, locked:true} : e}` ⇒ **未设密码时明文直接落 `originData`**（截图文案属实）。
- **加解密不在客户端**：`POST /api/services/crypto`（`action: encrypt|decrypt|autoSave`），请求体含 `{pwd,text,action}`；`AES|PBKDF2|WebCrypto|CryptoJS` 在包内 0 命中 ⇒ **服务端持密码与明文，不是端到端**；算法/KDF/盐不可见。
- 其它：密码只在 React state（不落 localStorage/IDB）；新密码仅 placeholder 建议 6 位；错 5 次 → 60s 冷却；忘记不可恢复（UI 明示）；3s 防抖自动保存；无自动锁定/无独立改密入口；导出降级文案「此处为语雀加密文本卡片，点击链接查看：」。

**③ 我们的落地（用户 261023 定稿：加密存储 / 无密码不可见正文 / 多端同一密码 = 端到端）**：
- **不复用语雀卡名**（`lockedtext` 是服务端密钥，谁也无法互通；复用只会制造"能解开"的错觉）⇒ 自有卡 `lake-locked-text`。
  ⚠️ 语雀那张卡**不会**走到本卡节点上：内核按**节点名**（`lockedtext`）分派，未注册就进 unknown-card fallback
  （「该卡片暂时无法显示」+ 原值原样保留，见上文 ①）⇒ 本卡**没有**（也不需要）「语雀旧卡态」，别把它当功能写进 UI。
- 单一来源 `src/core/lockedText.ts`：PBKDF2-SHA256(210k, 参数随值存) + AES-GCM-256 + 随机 salt/iv + AAD `lake-locked-text:v1`；值只含 `{v,alg,kdf,iter,salt,iv,ct}`，**密码/派生密钥绝不进正文**。
- **会话缓存派生密钥**：设密码/解锁时跑一次 PBKDF2，之后每次保存只做 AES-GCM（实测 210k ≈ 69–87ms；单次 AES 远小于 1ms）⇒ 未落盘窗口从"KDF 级"降到"亚毫秒级"。
- **生命周期补写（评审 B1）**：`features/editor/lockedTextFlush.ts` 注册表；`closeTab` / `toggleNoteLock` 在 F01 持久化闸门**之前** await flush，并在 flush 发生时强制 persist 一次。
  （不这么做时：明文只在组件 state、`tab.dirty` 还是 false ⇒ 关标签/锁文档直接跳过保存，最后 250–600ms 明文静默丢失。）
- 明文只活在组件内存；唯一落盘 = 加密后 `updateCardValue(cipher)`；`writeText/writeHtml` 只给占位 ⇒ 不进 md_cache/text_cache/FTS/剪贴板/导出。
- **外部改动跟随**：解锁态若 `cardValue.ct` 不是本卡刚写出的值（撤销/重做/他端同步/历史恢复），用会话 key 重解密刷新；
  salt/iter 变了（别处改过密码）则锁回并提示，**绝不拿旧明文覆盖新密文**。
- 密码按 **NFC** 归一（macOS 偏 NFD、Android 偏 NFC；不归一会让"多端同一个密码"失败）。
- 实测（隔离 scheme 实例）：`.lake`、`md_cache`、`text_cache`、`notes_fts` 对明文 **0 命中**；锁住/重载后回 locked；错密码「密码错误」；改密码后旧密码失效。

**④ 判据（以后碰这个功能先看）**：内核`lockedtext` 常量 ≠ 能力；面板项必须有 `registerCardSelect` + `customCard.cards` 两处才算"插得进、存得住、读得回"；"加密"必须逐项证明**没有明文路径**（正文/历史/快照/搜索缓存/导出/剪贴板），只用 UI 遮挡一律判为假加密。
**另一个常被漏掉的口子 = 生命周期**：卡片自己 dedupe 的防抖窗口里，文档 tab 还是"干净"的 ⇒ 关标签/锁文档/退出必须先把卡内未落盘内容补写（见 ③ 的 flush 注册表）。
