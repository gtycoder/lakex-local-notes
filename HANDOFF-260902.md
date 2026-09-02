# HANDOFF-260902 · 会话交接：语雀/Lake bookmark 卡崩溃已修 + 降级为超链接（桌面完成，移动端编辑未决）

> 写给零上下文的新会话：先读 `AGENTS.md`（长期记忆）再读本文。
> 本会话彻底解决了上份 HANDOFF 悬置的「语雀 URL 卡粘贴崩溃」，并把 bookmark 卡降级为普通超链接（桌面闭环）；移动端编辑态仍有遗留问题，已记入 `docs/TODO.md` 作为长期待办。

## 0. 当前基线

- **master = `4f1d715`**（已推送 Gitee `origin/master`），工作区干净（仅历史遗留未跟踪 `nohup.out`）。
- 质量门槛：`tsc` 全绿 · `vitest 748 passed / 1 skipped` · 桌面 + 移动 `vite build` 全绿。
- 本地分支：仅 `master`（其余分支均已合并/删除；远程引用了 `origin/main`、`origin/master`）。

## 1. 任务目标

修复「从语雀复制含 URL 卡的内容粘贴到 Lake Notes 编辑器时崩溃、不展示、不落盘」的问题，并让 bookmark 卡在本地展示合理（用户明确：**新粘贴的 bookmark 卡统一降级为普通超链接**，与虎扑/果壳一致、可点击跳转）。

## 2. 已完成内容（均已合 master）

### 2.1 根因（重要，理解后不再走弯路）
- bookmark 插件类**其实在 Lake 默认内核插件池 `Uke` 里，并未被 tree-shake/移除**（推翻了上份 HANDOFF「插件可能没进默认插件池」的假设）。
- 真正把 `bookmark` / `bookmarkInline` 卡类写进内核 registry（`_inlineCards` / `_blockCards`）的是 editor 路径的 **`BookmarkEditorPlugin`（`BX`）**，其 `init` 用**三参** `registerBlockCard(this,"bookmark",...)` / `registerInlineCard(this,"bookmarkInline",...)`。
- 但被 **`option.isEnable` 门控**：`isEnable = !!detailAction || !!fetchDetailHandler`。本地无语雀 API → 未提供这两个 option → `isEnable=false` → 卡类**从未注册** → 渲染/粘贴时 `getCardClass` 返回 `null` → `virtual-card-node.ts` 硬断言崩溃。

### 2.2 修复 1：启用卡类注册（防崩溃）
- `src/features/editor/lakeRuntime.ts` 注入 `bookmark.fetchDetailHandler`（返回基于 url 的最小 detail、不出网、不依赖语雀 API），使 `isEnable=true`，完成卡类注册。

### 2.3 修复 2：新粘贴 bookmark 卡降级为普通超链接
- 本地无语雀 API → 卡渲染成「无标题 + 不可点击 + 无样式浮窗」的死卡。
- 实现：`installBookmarkCardDegrade` 监听编辑器挂载容器的 **`paste` 事件**，粘贴后用 Lake **内置 `cardToLink` 命令**把新出现的 `bookmarkInline` / `bookmark` / `bookmarklink` 卡就地转成 `<ne-link>`（与虎扑/果壳一致，可点击跳转）。
- 设计要点：**只在用户粘贴时触发**（历史/加载的文档不主动改动）；`converted` 按卡 id 幂等收敛；**最多重试 3 次**（`150/350/700ms`）覆盖 Lake 异步渲染慢（大文档/移动端）；`destroyLakeEditor` 一并清理监听。

### 2.4 审计重构
- 卡名/命令名/延时/重试提为常量（`BOOKMARK_CARD_NAMES` / `CARD_TO_LINK_COMMAND` / 三组延时）。
- Lake 压缩内核的私有卡数据访问（`_neRef._virtualNode._instance.cardData`，项目已有 hack 路径）抽为独立 `readBookmarkCardInfo`。
- 卡名由常量数组驱动 selector，新增需降级的卡只需加卡名。

### 2.5 移动端是否支持
- 移动端 `DocumentPage.tsx` 用 `LakeEditor`（`mode={editing ? "editor" : "viewer"}`）→ `createLakeDocument(host, mode, ...)` → **editor 分支同样挂载 `installBookmarkCardDegrade`**，因此移动端编辑态与桌面**共享同一降级逻辑**。
- 真机（Android/adb）用合成 paste 注入**纯 URL 卡**（不含图片）后，bookmark 卡正确降级为 `<ne-link>`。

## 3. 当前问题（未决，已记入 `docs/TODO.md`）

### 3.1 移动端编辑遗留（重点）
1. **移动端编辑态粘贴语义未完全对齐**：真机注入「纯 URL 卡」能正确降级；但把**电脑剪贴板数据**（含 36kr 卡 `detail` 内嵌 `data:image/png;base64` 大图标）注入移动端**编辑器不解析、内容为空**；**剥离 base64 后单独注入仍为空** —— 尚未定位根因（怀疑与移动端 Lake 粘贴处理路径 / 移动端未装 `installPasteInterceptor` / base64 图标触发图片处理有关）。
2. **移动端本地资产 canonical URL 真机不可达**：资产用 `http://127.0.0.1:19876/{noteId}/{file}`，手机上 `127.0.0.1` 指向手机自己 → 图片/附件加载失败。真机联调需 `adb reverse tcp:19876 tcp:19876`；本会话绑定 19876 报 `Address already in use` 未成功。
3. **移动端整体编辑体验「还有问题」**（用户反馈 2026-09-02，现象未细化，需用户再反馈具体现象）。

### 3.2 其它挂起（承接之前 HANDOFF，别丢）
- **FTS 搜索重做（暂缓）**：`notes_fts` trigram 只索引 ≥3 字符 → 1/2 字搜不到正文；方案 = trigram(≥3) + <3 字「标题+正文 LIKE」短查询。等用户定重做范围。
- **W-8 ACAO / W-10 dompurify（挂起）**：并入「lake 资源导入统一优化」。
- **移动端大纲只读(viewer)下点击不跳转**：`OutlineSheet` 用 `headingUnfold` + `scrollByNodeId`，viewer 下不生效。
- **安卓同步 DNS 解析失败**（`UnknownHostException`）：设备网络问题，非代码。
- **回收站首拉成本 + 笔记本新建跨端撞号**：撞号问题未动。

## 4. 下一步计划

1. **移动端**：等用户反馈「编辑还有问题」的具体现象后，再定位「电脑剪贴板数据注入不解析」根因 + 移动端资产 canonical `127.0.0.1` 地址解析（`adb reverse` 或移动端可达地址解析）。
2. 桌面 bookmark 卡已闭环，可开新需求或继续其它挂起项（FTS / W-8 W-10 / 移动端大纲）。

## 5. 踩过的坑（务必记住）

### 5.1 bookmark 卡 / Lake 内核
- **注册三参 vs 单参**：`e.registerInlineCard(name)`（scheme 层，写 schema）≠ `registerInlineCard(plugin, name, definition)`（registry 层，写 `_inlineCards`）。崩溃点 `getCardClass` 读的是 **registry 三参**。
- **`customCard.cards` ≠ 内置卡注册表**：`customCard` 写 `getCardOption`，崩溃读的是 `getCardClass`（`_inlineCards`/`_blockCards`），是两张表，customCard 注册无效（`fix/bookmark-card` spike 已证伪）。
- **`fallbackcard` 接不了硬断言**：`getCardClass` 返回 null 直接 throw，不是 fallback。
- **编辑态卡 `clickable` 硬编码 false**（`MX` 组件），无宿主配置点；可点击跳转在 **viewer 态**（`clickable:true`）。要让卡像链接，**用 Lake 内置 `cardToLink` 命令**转成 `<ne-link>`（`bookmarkToLink` → `cardToLink`），这是 Lake 原生机制。
- **bookmark 编辑浮窗**（changeMode / bookmarkToLink / openLinkBtnClick 等）依赖宿主提供 **`editBlockUI` / `editInlineUI`**（语雀自己实现），Lake Notes 未配置 → 无浮窗；这也是选择「降级为链接」的原因。
- **`fetchDetailHandler` 是 isEnable 开关**：存在即 true（`!!fetchDetailHandler`），返回 reject **不影响 isEnable**（只影响 `_loadDetail` 的 `bookmarkRendered success:false`）。但 `rGe._loadDetail` 只在 `!hasDetail()` 时调用它；语雀卡的 `detail` 是 `{_serializer}`（truthy）→ `hasDetail()=true` → **不调用** fetchDetailHandler。
- **`cardToLink` 命令签名**：`execCommand("cardToLink", cardId, src, title)`，`cardId` 是 Lake 模型 node id（渲染后 `ne-card[data-card-name=...]` 的 `id` 属性即模型 id，实测可用）；需要 selection 处于 collapsed 等状态。

### 5.2 粘贴路径（重要）
- Lake 粘贴**读 `getData("text/html")`**（多次），**不读 `getData("text/ne-inode")`**（那是 Lake 内部 `setData` 后内部使用，不走 getData）；从 `ne-clipboard data` 解码出 INode 重建文档。
- **改造 getData("text/html") 返回的 HTML 内容**（`upgradePastedHtml`）确实被 Lake 读到（合成 paste），但**剥离 `<ne-clipboard>` / 把 bookmark DOM 归一化为 `<a>` 仍会被 Lake 还原成卡** → 说明 Lake 用 INode 重建，改 DOM 对 bookmark 卡无效。上份 HANDOFF 说「getData 拦截无效」，精确含义是：改 text/html 内容救不了 bookmark 卡（Lake 用 INode）。
- `installPasteInterceptor`（document capture）只在 `src/main.tsx`（桌面入口）绑定，**移动端 `src/mobile/main.tsx` 未装**。
- **合成 `ClipboardEvent` + `DataTransfer`**（`isTrusted=false`）在桌面/移动 WebView 都能触发 Lake 的 paste 处理；但移动端对含 base64 图标 / 电脑 Lake 序列化的内容解析异常（未定位）。

### 5.3 移动端调试（adb / Capacitor）
- **连 Android WebView**：`adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>` → 本地 9223 即手机 WebView CDP（本会话已连上 Android 14 WebView）。
- **读系统剪贴板**：WebView `navigator.clipboard.readText()` 权限被拒；Capacitor **未注册 Clipboard 插件**（Plugins 只有 App/SystemBars/OpenFile/CapacitorCookies/WebView/Filesystem/CapacitorHttp）；`cmd clipboard`（Android 14）不可用。→ 无快捷途径读手机剪贴板。
- **移动端资产** canonical `http://127.0.0.1:19876` 手机不可达，需 `adb reverse`。
- 系统剪贴板 HTML 只能通过 **Electron 一次性脚本**（`clipboard.readHTML()`）读出来，再作为合成 paste 注入。

### 5.4 环境 / 红线
- Node 用 `$HOME/.nvm/versions/node/v24.18.0/bin`。
- 本机 Electron 在 `main.ts` 重建 / 未带 `--use-angle=metal` 时**偶发 GPU/network/render 子进程崩溃**（`exit_code=15`）；用 metal 规避。可在 `vite.config.ts` 的 `onstart` 注入 `"--use-angle=metal"`（`startup([".","--use-angle=metal",\"--remote-debugging-port=9222\"])`）。
- `scripts/multidev.sh`：`nohup` 起不了 Electron，需前台 tty；`MULTIDEV_CDP_PORT` 控 CDP 端口。
- 杀 Electron 只 kill 具体 PID，**禁 `pkill -f Electron`**。
- 只用 `lake-notes-dev` 开发数据，绝不碰正式数据；`src/core/` 禁 `node:` 导入；本地是真相、S3 只是镜像；云端备份绝不能反噬本地；**不为旧数据写兼容/迁移代码**（bookmark 卡无需修历史，只求未来新粘贴正常）。

## 6. 关键代码 / 文件 / 样例

- `src/features/editor/lakeRuntime.ts`：`bookmark.fetchDetailHandler`（防崩溃）+ `installBookmarkCardDegrade` + `readBookmarkCardInfo` + 常量 + `destroyLakeEditor` 清理。
- `src/features/editor/clipboardHtml.ts`：`installPasteInterceptor` / `upgradePastedHtml`（本次未改；粘贴拦截仍存在但对 bookmark 卡无效）。
- `docs/TODO.md`：长期待办（bookmark 卡移动端遗留 + 其它挂起）。
- `vendor/npm/lakex-editor-react-component/dist/lakex-editor-react-component.es.js`：Lake 内核（12MB minified）。崩溃点搜 `CardClass for ${t} not registered`；`registerInlineCard/registerBlockCard/getCardClass` 在 registry（`_inlineCards`/`_blockCards`）。
- 样例文档：`3344`（id `167bb16e-...`，含 bookmarkInline/bookmarklink 卡）；`112233`（id `5282d8f3-...`，飞书内容，正常对照）；**`啦啦耳朵`**（id `4165a26c-...`，含 bookmark 卡 + 普通 `<a>`，本会话验证用，已多次被测试粘贴污染）。

## 7. 红线（违反即返工，见 AGENTS.md）

1. `src/core/` 禁 `node:` 导入。
2. 本地是真相、S3 只是镜像；不改同步协议语义、不改 DB 写入行为。
3. 开发数据只用 `lake-notes-dev`，绝不碰 `lake-notes-electron` 正式数据。
4. 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`。
5. **不为旧数据写兼容/迁移代码**（能删重建就删重建）→ bookmark 卡不修历史，只求未来新粘贴不崩/降级正常。
6. 云端备份绝不能反噬本地数据。
