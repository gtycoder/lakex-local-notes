# HANDOFF-260902 · 会话交接：W-9 拆分收尾 + 语雀 URL 卡粘贴崩溃（未解决，重点）

> 写给零上下文的新会话：先读 `AGENTS.md`（长期记忆）再读本文。
> 本会话主要做了两件事：① W-9 App.tsx 拆分第二阶段（已合 master 推送）；② 排查「语雀 URL 卡粘贴崩溃」（**未解决，是下一步的重点**）。

## 0. 当前基线

- **master = e3d59bf**（已推送 Gitee），工作区干净（仅历史遗留未跟踪 `nohup.out`）。
- 质量门槛：`tsc` 全绿 · `vitest 748 passed / 1 skipped` · 桌面 + 移动 `vite build` 全绿。
- 本会话合并了两条分支并推送：
  - `fix/trash-lazy-download`（回收站惰性下载 + 预览/恢复强拉全量，桌面+移动）
  - `refactor/app-split` + `refactor/app-split-2`（W-9 App.tsx 拆分）
- 另有一条**失败 spike 分支**：`fix/bookmark-card`（customCard 注册 bookmark 卡，无效，见 §2）。

## 1. 本会话已完成内容（均已合 master）

1. **A 方案验收补强**：`declared_assets` 表 + 测试（manifest.assets = 当前正文引用 ∪ 已声明元数据，防删除引用挂回）。
2. **回收站惰性下载**：回收站条目下载只记声明元数据、不拉资源；恢复/预览前 best-effort 强拉全量（桌面 `restoreTrashWithAssets`/`ensureTrashNoteAssets` + 移动 `bridge.ensureTrashNoteAssets`）。真实 Kodo 已验证。
3. **W-9 App.tsx 拆分**（`refactor/app-split` + `refactor/app-split-2`）：
   - 第一阶段 5 个 hook：`useNoteActions`/`useSyncRefresh`/`useTreeActions`/`useTabLifecycle`/`useNoteLifecycle`。
   - 第二阶段 8 个单元：`useSyncProgress`/`useBootstrap`/`deriveDesktopView`/`useDesktopLifecycle`/`useOutlineSync`/`useWorkspaceState`/`useSavePipelineGlue`/`useDesktopHandlers`。
   - **App.tsx 从 1175 → 467 行**。
   - 说明：这些是「逐字搬移 + 纯函数抽出」，每批都过了 tsc/vitest/build；但**渲染层 effect 无单测覆盖**，运行时靠 e2e smoke（tab-switch/sidebar-interaction/window-state/renderer-recovery 均绿；`test:ui` 因 SettingsPanel ARIA 既有问题失败，与本次拆分无关）。

## 2. 当前问题（重点，未解决）：语雀 URL 卡粘贴崩溃

### 现象
从语雀复制含 URL 卡的内容粘贴到编辑器，**崩溃、无法展示、不落盘**。日志报：
- `lakex_editor_assert_error CardClass for bookmarkInline not registered`（`virtual-card-node.ts:42`）
- `CardClass for bookmark not registered`
- 连带 `Cannot read properties of undefined (reading 'cells')` / `appendChild ... not of type 'Node'` 等。

### 与飞书的对比（关键线索）
飞书粘贴正常，因为飞书导出的是**普通 `<a>` 链接 / 纯文本 / 占位文案「暂时无法在飞书文档外展示此内容」**，**没有 bookmark 卡**。
语雀/Lake 导出的是 `<ne-clipboard data="...">`（Lake 自有剪贴板格式），里面是：
- `bookmarkInline`（行内 URL 卡，value: {mode:"title", src, text, detail:{title,icon,image,desc,url}}）
- `bookmark`（块级 URL 卡；落盘后名字变 `bookmarklink`）
- 普通 `link` 元素（`<element name="link" attrs={src, external?}>`）

### 根因（已定位）
1. Lake 的 `bookmark` 渲染插件（会 `registerInlineCard("bookmarkInline")` / `registerBlockCard("bookmark")`）**没被加载**。
2. 渲染时 `getCardClass("bookmarkInline"/"bookmark")` 返回 null → `virtual-card-node.ts` 里 `H(...)` **硬断言**直接 throw，没有 fallback。

### 关键结论 / 已证伪的方案（务必记住，别再走弯路）
- ❌ **粘贴层拦截（getData 包装 / upgradePastedHtml）无效**：Lake 粘贴走**浏览器原生 DOM 插入**，不走 `getData("text/html")`。实测 `getData` 被包装后返回的 HTML 已降级（wrappedHas=false），但卡片仍以原样进文档 → 证明 Lake 不走这条路。
- ❌ **`customCard.cards` 注册无效**：它写的是 `getCardOption`（自定义卡表），崩溃点读的是 `getCardClass`（内置卡表 `_inlineCards`/`_blockCards`）。运行时已确认无效（见 `fix/bookmark-card` spike 分支，日志仍报 `bookmarkInline not registered`）。
- ❌ **`fallbackcard` 配置无效**：`FallbackcardConfig`（mainTipHTML/subTipHTML）不接这个崩溃，因为这是硬断言，不是 fallback。
- ❌ **纯文本粘贴 / DOM 手动插入无效**：历史提交 `5e8e160` 已回滚，回滚说明原文「DOM 插入方案被 Lake 文档模型重建清除，真修需内核插入 API，成本高」。

### 可行方向（下一步从这里选）
- **A1（首选，最原生/治本）**：查 `bookmark` 插件为什么没进默认插件池/没加载，直接启用它。
  - 已确认：vendor 里 `bookmark` 插件类存在（`PluginName="bookmark"`，`init` 里 `registerBlockCard(this,"bookmark",K3e)` + `registerInlineCard(this,"bookmarkInline",J3e)`）。
  - 未完成：默认插件池（`kernelPlugins`/`renderPlugins`/`editorPlugins`）的装配位置还没精确定位到；`DefaultEditorConfig`（导出名 `$9`）只是 content 配置（image/audio/video/...），**不含插件列表**。
  - `disabledPlugins` 当前是 `["save","toolbar","emoji"]`，未禁 bookmark。
- **A2（次选，重）**：用 `onAfterKernelPluginInit(kernel, pluginInstance)` 钩子调 `kernel.registerInlineCard(pluginInstance, "bookmarkInline", definition)` / `registerBlockCard(...)`。
  - 但 `definition` 是 Lake 内部**卡节点类**（构造器 `(renderer, viewNode, cardRootNode, pluginInstance)` + `init()`，且带 `$CardUI`（React UI）+ `$CardData`（数据模型）静态属性），**不是简单 React 组件**，需逆向。
- **B（不推荐，已证伪）**：粘贴层 preventDefault + 手动插入，缺 `insertHTML` 命令，且历史已证明 DOM 插入被 Lake 清掉。

### 关键代码/文件位置
- `src/features/editor/lakeRuntime.ts` → `createLakeDocument`（编辑器 config 装配处，`customCard`/`disabledPlugins`/`onAfterKernelPluginInit` 都在这加）。
- `src/features/editor/clipboardHtml.ts` → 现有粘贴/复制自定义（`installPasteInterceptor`/`upgradePastedHtml`/`normalizeClipboardHtml`）。
- `vendor/npm/lakex-editor-react-component/dist/lakex-editor-react-component.es.js` → Lake 内核（12MB minified）。
- 崩溃点：搜 `CardClass for ${t} not registered`（`virtual-card-node.ts`）。
- 注册表：`registerInlineCard(e,t,n)` 写 `_inlineCards[t]={pluginInstance:e,definition:n}`；`getCardClass` 读 `_inlineCards[e]||_blockCards[e]`。
- 卡名映射：剪贴板片段块卡名 `bookmark`，落盘后 `bookmarklink`；行内始终 `bookmarkInline`。

## 3. 下一步计划（建议顺序）

1. **先做 A1**：定位默认插件池装配，确认 `bookmark` 渲染插件是否被 tree-shake 排除 / 未注册；若能启用，是最干净的解。
2. 若 A1 走不通，评估 **A2**（逆向最小卡节点类，`$CardUI`/`$CardData`）。
3. 无论 A1/A2，验证场景：
   - 粘贴语雀 5 种 URL 样式（2 个标题 bookmarkInline + 1 个卡片 bookmark + 2 个普通 link）不再崩、URL 变成链接/可点击。
   - 示例文档：`3344`（id `167bb16e-...`，已含 bookmarkInline/bookmarklink 卡，打开即复现崩溃）；`112233`（id `5282d8f3-...`，飞书内容，正常，做对照）。

## 4. 踩过的坑（务必记住）

- **Lake 粘贴不走 getData**：别在 `upgradePastedHtml`/`installPasteInterceptor` 上做降级，白费（本会话三次都失败：纯文本降级、link 元素降级、customCard 注册）。
- **`customCard` ≠ 内置卡注册表**：`getCardOption` vs `getCardClass` 是两张表。
- **`fallbackcard` 救不了硬断言**。
- 环境：Node 用 `$HOME/.nvm/versions/node/v24.18.0/bin`；杀 Electron 只 kill 具体 PID；桌面 CDP 9222，`npm run dev` 需 tty 长驻。
- 三门槛：`npx tsc --noEmit && npx vitest run && node node_modules/vite/bin/vite.js build`（移动端加 `--config vite.mobile.config.ts`）。
- 真实验证用 Kodo（七牛）前缀 `lake-notes`，密钥存 dev 库 `s3_settings`（secret 经 safeStorage 加密）。

## 5. 其他仍未做/挂起（承接上一份 HANDOFF，别丢）

- **FTS 搜索重做（暂缓，独立立项）**：`notes_fts` 用 `tokenize='trigram'`（`store.ts:297`），只索引 ≥3 字符 → 1/2 字搜不到正文。本机 SQLite 无 `ngram`，落地方案 = trigram(≥3) + <3 字「标题+正文 LIKE」短查询。等用户明确重做范围。
- **W-8 ACAO / W-10 dompurify（挂起）**：可能影响 lake 资源加载，并入「lake 资源导入统一优化」一起做。
- **移动端大纲只读(viewer)下点击不跳转**（bug，记 `docs/TODO.md`）：`OutlineSheet` 用 `renderer.execCommand("headingUnfold")` + `scrollByNodeId`，viewer 下不生效。
- **安卓同步 DNS 解析失败**（`UnknownHostException`）：设备网络问题，非代码，联网重试。
- **回收站首拉成本 + 笔记本新建跨端撞号**：见历史交接（回收站惰性下载本次已做，撞号问题未动）。

## 6. 红线（违反即返工，见 AGENTS.md）

1. `src/core/` 禁 `node:` 导入（双端共享层）。
2. 本地是真相，S3 只是镜像；不改同步协议语义、不改 DB 写入行为。
3. 开发数据只用 `lake-notes-dev`，绝不碰 `lake-notes-electron` 正式数据。
4. 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`。
5. **不为旧数据写兼容/迁移代码**（用户反复强调：能删重建就删重建）。→ 所以 bookmark 卡崩溃「不用管已有 3344 文档」，只求未来粘贴不崩即可。
6. 云端备份绝不能反噬本地数据。
