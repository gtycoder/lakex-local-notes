# Lake Notes Electron 交接文档

> **本文是项目的唯一主交接文档。** 面向完全没有上下文的后续会话：请先完整读完本文，再修改任何代码。
> 最后更新：2026-08-02（本会话：大文档性能定位 + virtualRendering 试验，见下方「最新交接」）

---

## 一、项目概览与任务目标

**项目**：Lake Notes —— 本地优先的 Lake（语雀）编辑器笔记应用。
**当前形态**：Electron 33 桌面应用，已替代 Tauri（trui）版本成为**正式版**，路线验证完成。

**为什么从 Tauri 2 换到 Electron**：
- Tauri 在 macOS 强制 WKWebView，无法渲染 SVG foreignObject 文字（画板、复杂排版 bug 频发）
- Lake 编辑器是 Web 组件，Chromium 是它的原生环境（语雀跑在 Chrome 上）
- Electron 有完整 DevTools，调试效率高；思源笔记（同类型产品）也是 Electron

**核心设计理念（仿思源笔记资源管理）**：
1. 图片/附件按笔记分目录存储（`note-assets/{noteId}/`），文档与资源分离
2. 不做图片去重（冗余存储可接受）
3. 用 S3 做备份/同步（参照思源的 S3 同步思路）
4. 复制到第三方（微信）时图片能正常显示（webp→png 转换）
5. 本地资源完全离线可用（Lake 编辑器 CDN 依赖全量本地镜像）
6. **不弹"正在加载"之类的 toast**

**技术栈**：Electron 33.4 + React 18.3 + TypeScript + better-sqlite3 11 + Lake 编辑器（`lakex-editor-react-component@0.1.2` ESM）+ Drawnix 画板（`lakex-drawnix@0.1.0`）+ sharp（图片转换）+ @aws-sdk/client-s3

---

## ★ 最新交接（2026-08-02 会话）：大文档性能定位 + virtualRendering 试验

> **本段写给零上下文的新会话**：本次会话共解决四件事——(A) 用实测数据定位了「大文档打开时图片裂 3-5 秒」的根因；(B) 在新分支 `experiment/virtual-rendering` 上开启 Lake 虚拟渲染并验证了大部分收益；(C) **修复了大纲（TOC）三问题：滚出视口消失 / 无高亮不跟随 / 点击定位不准，以及代码块粘贴后不可见**；(D) **Phase B 表格浮动工具栏 hover 消失**，并将试验代码收敛为正式实现。**当前工作分支是 `audit/code-optimization`（已合回，`experiment/virtual-rendering` 与之同指向 `4a76c76`），不是 main。** 先读完本段再读 §八/九/十。

### 任务目标（本会话）
1. 用户报安装版 bug：关窗不退出后打开大文档，图片默认"裂的"、3-4s 后才开始加载
2. 判断是性能问题还是数据/网络问题，找到根因并验证解决方案

### 已完成（含实测数据）
1. **排除了网络与主线程瓶颈**（全部实测）：
   - 图片请求全部 200、无失败无重试（用户逐个核对）
   - 大文档 HTML 解析仅 79ms（jsdom 实测 583KB → 1281 节点）
   - Lake renderTime 仅 136-226ms（docInitPerf），Long Tasks 合计 <1s，主线程空闲
   - **结论：3.5s 是"图片请求被延迟发起"**，根因是含 107 个 codeblock 卡片的文档里，卡片 UI 提交/hydration 被 Lake 调度推迟；纯图片文档（52 图）只要 70ms
2. **性能埋点体系**（`lakeRuntime.ts`，仍保留在分支上，很好用）：
   - `window.__lakePerfReport()`：measures/marks + Long Tasks + docInitPerf + 本地图片 Resource Timing + TOC 探测
   - `EditorTab` 打印 `[lake-perf] tab visible`（标签可见性时间线）
   - `createLakeDocument` 订阅内核 `tocChange` 打印 `[lake-perf:xxxx] kernel tocChange`
3. **dev 脚本修复**（commit `3b7db20`）：`npm run dev` 之前会**启动两个 Electron**（vite-plugin-electron 自动拉起 + 脚本里手动 `electron .`）→ 单实例锁冲突 + ERR_FAILED 级联退出。已改为只跑 `vite`，由插件统一拉起。
4. **virtualRendering 试验**（`experiment/virtual-rendering` 分支，13 个 commit）：
   - `customOptions` 注入 `virtualRendering: true` + `scrollNode`（指向真实滚动容器）+ `cardLazyInit: true`（= allowCardLazyInit 配置键）
   - **收益实测**：大文档首图从 3.5s → 88ms；滚动渐进加载不卡顿；**编辑器工具栏恢复置顶**；**多标签滚动位置独立**
   - TOC 打开时为空（编辑后才出现）已修：`refreshTocSidebar()` 从 `kernel.getDocExtraContent().toc` 取数 + 内核总线重放 `tocChange` + 重试（约 600ms 延迟，用户接受）
   - Phase A：删掉了 TOC `position:fixed`/`--toc-top` 和表格工具栏 `display:none` 等历史补丁，回归 Lake 原生
   - Phase A.5：每标签页独立滚动容器（`.lake-editor-tab` overflow-y:auto）+ scrollNode 指向各自标签 → 解决多标签滚动共享

### 本会话（后续）：TOC 三问题 + 代码块粘贴修复（2026-08-02，实测验证）

**根因（全部实测/反编译定位）**：
1. **大纲滚出视口**：高度链断裂——`.lake-editor-mount` 高度 auto 被内容撑高（实测 `.ne-editor-body` 高 5809px），TOC（`position:absolute; top:0; bottom:0` 钉在 `.ne-editor-body` 上）随内容滚出视口。Lake 原生滚动层 `.ne-editor-wrap`（`ne-layout-mode-* .ne-editor-wrap { height:100%; overflow-y:auto }`）从未生效。
2. **无高亮/不跟随**：Lake TOC watcher 用**二分查找**探测标题 DOM（`querySelector('[id=...]').getBoundingClientRect()`），虚拟渲染下视口外标题无 DOM，中间探测项返回 null → 二分立即返回 -1，永远不选中。
3. **点击定位不准**：Lake `_scrollTo` 把标题滚到滚动容器顶部，但旧布局下滚动容器在外层、工具栏 sticky 悬浮盖顶；且 cardLazyInit 邻近卡片占位高度导致偏差。
4. **代码块粘贴不可见**：cardLazyInit 下插入的卡片**永远停留在未水合空壳**（80px 空 `.ne-codeblock-content`）——Lake 可见性观察器观察的是 hole 节点，`hole.$appear` 不会传播到卡片 UI；实测 `卡片._neRef._virtualNode.$appear()` 可立即水合。卡片在模型里（保存正常），只是不渲染。

**修复（commit 待提交）**：
1. **布局修复**（`src/styles.css`）：`.lake-editor-tab` 改 `overflow:hidden` 只做固定外壳；`.lake-editor-mount`/`.ne-editor` 补 `height:100%` 高度链 → Lake 规则生效，`.ne-editor-wrap` 成为真实内部滚动容器 → TOC 固定可见、工具栏天然置顶、点击定位数学恢复正确。
2. **scrollNode 指向 `.ne-editor-wrap`**（`resolveScrollNode()`，仅 `.lake-editor-tab` 宿主启用内部滚动；移动端路径不变）。
3. **自研 TOC 滚动跟随高亮 + 点击精确滚动**（`setupTocScrollFollow()`）：滚动/渲染批次完成后按文档序遍历**已渲染**标题，标题顶越过视口顶 → 高亮对应 `.ne-toc-item`（滚动回顶部时高亮第一个标题）；点击后在 50/200ms 做两次 `scrollTop += headingTop - vpTop` 精确校正。绕过 Lake 失效的二分 watcher。
4. **修复性卡片水合**（`ensureCardsInViewHydrated()`）：contentchange/滚动/tileRenderCompleted 后，对视口内未 `isAppear` 的 `ne-card` 直接调 `_neRef._virtualNode.$appear()`。保留 cardLazyInit 性能收益，粘贴代码块 300ms 内立即可见。

**实测验收**（Playwright 驱动真实 Electron）：
- 大纲固定：任意滚动位置 `.ne-toc-sidebar` 保持 121→792（视口高）；滚动跟随高亮正确、回顶恢复第一标题
- 点击定位：5 个不同深度条目落点偏差 0-4px
- 多标签：滚动位置独立、各自 TOC 独立高亮
- 代码块粘贴：插入 300ms 内水合（2 行、CM6 完整）；历史卡壳卡片（之前粘贴的）重开后也被修复性水合
- 首图仍 ~0.5-0.8s（无性能回退）；`npm test` 56 用例全绿

**已收敛为正式实现**：清理 `[lake-perf]` console 探针、重试/轮询封顶、删除死代码；
`VIRTUAL_RENDERING.enabled` 保持 true（实测收益稳定）。合回 audit 的决策见 §九 第 4 项。

### 本会话（后续）：Phase B 表格浮动工具栏 hover 修复（2026-08-02，实测验证）

**根因**：Lake 卡片工具栏 overlay 的显隐监听挂在**卡片根节点**上（mouseenter → 显示 /
mouseleave → lazyCancel 300ms 后隐藏），工具栏渲染在卡片上方（placement top + 2px），
鼠标从卡片移到工具栏即触发卡片 mouseleave → 工具栏在用户到达前就被隐藏（实测移到
工具栏 350ms 内消失）。

**修复**（`setupCardToolbarHoverBridge`，lakeRuntime.ts）：
1. 拦截：mouseleave 不冒泡但有捕获阶段，document 捕获层先于目标监听器执行；真实
   mouseleave 目标是卡片、relatedTarget 在工具栏上下文（.ne-card-toolbar /
   .ne-ui-boundary-popover / ne-overlay-tmp / [data-event-boundary=overlay]）时
   `stopImmediatePropagation`，阻止 Lake 排定隐藏 → 悬停工具栏期间保持。
2. 补发：指针离开工具栏上下文时，向最近停留的卡片补发合成 mouseleave（untrusted
   事件拦截器放行），触发正常延迟隐藏。

**实测验收**（Playwright 真实鼠标）：
- 悬停表格 → 工具栏出现；移到工具栏停留 1100ms 不消失（修复前 350ms 内消失）
- 移回表格保持、移出才隐藏（约 300ms 延迟）
- 按钮可点击：maximize 进入/退出 max-view 正常、borderVisible 切换正常、点击后工具栏保持
- 3 轮「表格↔工具栏」往返定位零漂移（gap 恒 0）
- 回归：TOC 固定/高亮/回顶、代码块粘贴 300ms 水合、多标签正常，vitest 56 全绿

**已知次要边缘**：表格点「最大化」（max-view）进入再退出后，该表格工具栏定位偏移约
28px（不影响使用，重开文档自愈）。定位是 Lake boundary popover 在 max-view 切换后的
既有行为，非 hover 桥引起（无 max-view 时零漂移），暂不处理。

### 当前问题（未解决，见 §八）
1. ~~TOC 滚动高亮不跟随 / 点击定位不准~~ → **已修复**（见上）
2. **表格浮动工具栏 hover 消失**（Phase B：z-index/sticky 链）
3. ~~代码块粘贴后默认不可见~~ → **已修复**（修复性水合，cardLazyInit 保留）
4. TOC 侧边栏在条目渲染前的异常尺寸（40px 宽/整文高/top 偏移）——已随高度链修复自愈（当前 TOC 恒为视口高 671px）

### 下一步计划（详细见 §九）
1. **Phase B**：移除 `.ne-ui` sticky 覆盖 + `z-index:auto` 七件套 + overlay 层级 → 验证表格浮动工具栏 hover（唯一剩余功能问题）
2. 试验收敛：把 `VIRTUAL_RENDERING` 开关/`refreshTocSidebar` 重试/`setupTocScrollFollow`/`ensureCardsInViewHydrated` 收敛为正式实现（清理探针日志、收敛重试次数），跑完 `VIRTUAL-RENDERING-TEST.md` 回归清单后决策合回 `audit/code-optimization`
3. TOC 高亮边缘场景观察：无标题段落区（如引言）滚动时高亮保持上一标题，用户可接受后再合回

### 本会话踩过的坑（速览，细节见 §十 D）
- scrollNode 必须指向**真实滚动容器**（body 是 overflow:hidden，Lake 默认回退 document.scrollingElement 会拿错）
- 新建标签元素在编辑器创建时**尚未布局（clientHeight=0）**→ 虚拟渲染初始视口错乱（曾用读 offsetHeight 强制 reflow，但 TOC 根因不在此）
- **TOC 侧边栏创建时用空 toc 渲染**、`ready` 早于 `tocChange` → 打开时大纲为 0（补丁见上）
- **TOC 条目是 `div.ne-toc-item` 不是 `<a>`**（探针选择器坑）
- 多标签共用 `.document-pane` 一个滚动容器 → 滚动位置共享；需每标签独立滚动容器
- HMR 不会重建已创建的编辑器实例 → 测试新埋点必须 Cmd+R / 重启
- `console.debug` 被 DevTools 默认过滤 → 埋点用 `console.log`

---

## 二、当前状态与仓库

### 2.1 状态总览

| 项 | 状态 |
|---|---|
| 路线验证 | ✅ **完成**（Electron 正式版接入，替代 trui） |
| 阶段 A：资源归一化 + 第三方图片下载/复制修复 | ✅ 完成，用户验证通过 |
| 阶段 B：S3 备份同步（七牛云） | ✅ 完成，真实同步验证通过 |
| 打包发布：dmg | ✅ 完成并冒烟验证（未签名、默认图标） |
| 阶段 C：代码审计 + 优化 + 单测 | 🚧 进行中（分支 `audit/code-optimization`；**82 个 vitest 用例通过**；虚拟渲染试验已合回 + Store DB/S3 校验测试补全） |
| 大文档性能：virtualRendering 试验 | 🚧 **试验分支 `experiment/virtual-rendering`**：首图 3.5s→88ms、工具栏置顶、多标签滚动独立；TOC 三问题、代码块粘贴、表格浮动工具栏 hover 全部已修复；**试验代码已收敛**（探针清理、重试/轮询封顶）；剩余：**合回 `audit/code-optimization` 决策** + max-view 后工具栏定位偏移 ~28px 次要边缘 |
| 远程仓库 | ✅ 已推送 Gitee `master` 分支 |

### 2.2 仓库与分支

**本地仓库**：`/Users/admin/file/local-lake/lake-notes-electron`（独立 git 仓库）
**当前分支**：`audit/code-optimization`（虚拟渲染试验已合回，与 `experiment/virtual-rendering` 同指向 `4a76c76`）
**远程**（已配置 origin）：
```
origin  https://gitee.com/gtycoder/local-lake.git
```
**Gitee 远程分支**：
- `master` = Electron 正式版（最新 commit `74062e3`，本仓库 main 的镜像）
- `main` = 旧 Tauri（trui）版，**保留未动**（正式版分支是 master；如需让 master 成为默认分支，需在 Gitee 后台设置）

**本地分支**：
- `audit/code-optimization`（审计/优化工作分支：503742f 修复、4bf3728 测试、808b72d~db539db 性能埋点 + dev 脚本修复）
- `experiment/virtual-rendering`（**当前**，自 audit 分出：虚拟渲染试验，13 commit，详见「★ 最新交接」）
**本地历史分支**（均已过时，勿基于它们开发）：`feature/electron`、`asset-server-poc`

**推送方式**：本机 SSH key 未注册 Gitee，**必须用 HTTPS**（macOS 钥匙串已缓存凭据）：
```bash
git push origin main:master   # Electron 正式版 → Gitee master
```

### 2.3 参考仓库（只读，勿修改）

| 仓库 | 用途 |
|---|---|
| `/Users/admin/file/local-lake/lake-notes-tauri-poc/` | Tauri 版源码：Rust 后端下载逻辑参考、**CSS 基准** |
| `/Users/admin/file/local-lake/siyuan/` | 思源笔记：S3 同步、资源管理、TLS 指纹方案参考 |
| `/Users/admin/file/local-lake/local-lake-notes-devlop/` | GitHub 上 devlop 分支的开发版（历史） |

---

## 三、快速开始（开发 / 构建 / 打包）

### 3.1 环境要求（重要）

- **Node 必须是 ≥ 20.12**：系统默认 node 是 v18（`~/.nvm/versions/node/v18.20.8`），**跑 vite 8（rolldown）会报 `styleText` 缺失**。必须用 nvm v24：
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
  ```
- **npm 镜像**：私有镜像 `npm.weizhipin.com` 不可达（2026-08-02 实测 npm 命令会挂起）。安装新依赖用：
  ```bash
  export npm_config_registry=https://registry.npmmirror.com
  export npm_config_cache=/tmp/npm-cache-lake
  ```
- **better-sqlite3** 安装后必须重编译到 Electron ABI：
  ```bash
  npx @electron/rebuild -f -w better-sqlite3
  ```
  （或交给 electron-builder 打包时自动 rebuild）
- **测试用 Node ABI**：`npm test`（vitest）需要单独的 Node ABI 构建，首次运行前：
  ```bash
  bash scripts/setup-test-abi.sh   # 装到 test-node-abi/（gitignore），vitest alias 自动指过去
  ```

### 3.2 开发

```bash
cd /Users/admin/file/local-lake/lake-notes-electron
PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" npm run dev
```
- Vite dev server：`http://127.0.0.1:1421/`
- 本地图片服务器（asset server）：`http://127.0.0.1:19876/`
- `vite-plugin-electron` 监听 `electron/*.ts` 变更自动重建并重启 Electron；渲染层走 HMR

**杀进程时绝不能用 `pkill -f "Electron"`**——Trae CN（用户的 IDE）也是 Electron 应用，会被误杀。正确方式：
```bash
kill $(ps aux | grep "lake-notes-electron" | grep -v grep | awk '{print $2}')
```

### 3.3 构建与打包

```bash
# 1. 类型检查 + 渲染层/主进程构建（必须用 Node 24）
PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" node node_modules/vite/bin/vite.js build

# 2. 打包 dmg + zip（electron-builder）
./node_modules/.bin/electron-builder --mac
```
产物输出到 `release/`（已在 .gitignore）：
- `release/Lake Notes-0.1.0-arm64.dmg`（约 158MB）
- `release/Lake Notes-0.1.0-arm64-mac.zip` + 两个 `.blockmap`
- `release/mac-arm64/Lake Notes.app`（未打包的应用）

**打包版注意事项**：
- 未签名/未公证：首次打开需右键 → 打开（或系统设置 → 隐私与安全性）
- 默认 Electron 图标（尚未做应用图标）
- 打包版与开发版**共用同一 userData**（`~/Library/Application Support/lake-notes-electron/`，因为 package.json `name` 是 `lake-notes-electron`），测试方便，正式发布前需决策是否隔离

---

## 四、架构总览

### 4.1 进程结构

```
Electron 主进程 (electron/main.ts)
├── Store (electron/store.ts)：better-sqlite3 + 文件系统后端（从 Tauri Rust 移植）
├── assetServer (electron/assetServer.ts)：本地 HTTP 图片服务器 :19876
│     ├── /{noteId}/{filename}               → 图片二进制（immutable 缓存）
│     ├── /{noteId}/{filename}?base64=1      → data:image/png;base64（复制到微信用，webp/avif 用 sharp 转 png）
│     └── /vendor/cdn/<path>                 → Lake 编辑器 CDN 资源本地镜像
├── sync (electron/sync.ts)：S3 同步引擎（七牛等 S3 兼容服务）
└── IPC：bootstrap/note CRUD/tree/资源上传下载/orphan/S3 配置/同步

Preload (electron/preload.cjs)：原生 CJS，contextBridge 暴露 window.lakeNative（23 个方法）
└── 渲染进程 (React + Lake 编辑器 + Drawnix)
```

### 4.2 关键文件索引

| 文件 | 说明 |
|---|---|
| `electron/main.ts` | 主进程：窗口、IPC、CDN 重定向注册、asset server 启动 |
| `electron/store.ts` | 后端：SQLite（notes/tree_nodes/device_state/settings/orphan_assets/deleted_notes/sync_base）+ 文件系统；图片下载（electronNet.fetch 防 JA3 403） |
| `electron/assetServer.ts` | 本地图片服务器 + webp→png（sharp）+ `/vendor/cdn` 静态路由 |
| `electron/sync.ts` | S3 同步引擎（manifest + 内容寻址 + 增量 + 冲突副本 + 墓碑 + 孤儿跳过） |
| `electron/preload.cjs` | **原生 CJS**（不走 Vite），暴露 lakeNative；打包版需 asarUnpack |
| `src/App.tsx` | 主应用（多 Tab、侧边栏、状态栏、同步面板入口） |
| `src/main.tsx` | React 入口：**顶部**调用 `installPasteInterceptor()` |
| `src/lib/native.ts` | 前端 IPC 封装 + 类型（`window.lakeNative`） |
| `src/lib/types.ts` | 共享类型（S3Settings/SyncResult/SyncProgress/SyncStatusInfo 等） |
| `src/features/editor/lakeRuntime.ts` | Lake 编辑器创建；`deepMerge` 深合并；`isCaptureImageURL` 排除本地 URL；vendor 相对路径 |
| `src/features/editor/BoardCard.tsx` | Drawnix 画板卡片（+ `src/vendor/drawnix*.css`） |
| `src/features/editor/resourceUpload.ts` | 图片/附件上传管线（WebP→PNG、base64、远程下载） |
| `src/features/editor/clipboardHtml.ts` | 粘贴拦截升级（知乎懒加载 SVG→真实 URL）+ 复制清洗（空行/零宽字符） |
| `src/components/SyncPanel.tsx` | S3 配置 + 进度条 + 最近同步结果 |
| `index.html` | `<script src="./vendor/lakex-doc/codemirror.js">` + KITCHEN_URL（**必须相对路径**） |
| `public/vendor/cdn/` | Lake 编辑器 35 个 CDN 资源本地镜像 |
| `public/vendor/lakex-doc/` | codemirror/katex/字体/图标（最早 vendor 的） |
| `vite.config.ts` | vite + vite-plugin-electron；external 含 better-sqlite3/sharp/@aws-sdk；Drawnix alias |

### 4.3 图片数据流（核心链路）

```
粘贴/拖入/远程图片
  → clipboardHtml.installPasteInterceptor（粘贴时：知乎懒加载空 SVG → data-actualsrc 真实 URL）
  → lakeRuntime createUploadPromise → resourceUpload.uploadLakeResource(request, noteId)
  → native.uploadResource / downloadRemoteResource(url, noteId)
  → store：webp→png（本地上传）或 electronNet.fetch 下载（第三方，Referer=图片自身 URL + 浏览器 UA + 重试）
  → 写入 note-assets/{noteId}/{timestamp}_{random8}.{ext}
  → 返回 http://127.0.0.1:19876/{noteId}/{filename}
复制到微信
  → copy 捕获阶段 handler（先于 Lake 内部）
  → clipboardHtml.normalizeClipboardHtml：本地图用同步 XHR 请求 ?base64=1 → data:image/png;base64 替换
  → event.clipboardData.setData("text/html", ...)
```

---

## 五、已完成内容

### 5.1 阶段 A：资源归一化 + 第三方图片下载/复制修复 ✅（commit a703492）

**资源归一化**（仿思源）：
- 图片按 `note-assets/{noteId}/{timestamp}_{random8}.ext` 存储，URL `http://127.0.0.1:19876/{noteId}/{filename}`
- `orphan_assets` 表记录孤儿（saveNote 扫描 content 引用 vs 磁盘文件，不自动删文件）
- 删笔记 = 删 .lake + 整个 note-assets/{noteId}/ + 清 orphan
- IPC：`list_orphan_assets` / `clean_orphan_assets`（UI 未做）

**第三方图片下载修复**（对齐 Rust + 思源）：
- 主进程用 **`electronNet.fetch`**（Chromium 网络栈 = Chrome JA3 TLS 指纹）解决知乎 CDN 403
- `Referer = 图片 URL 自身` + 浏览器 UA + 3 次重试 + SSRF 防护（拒绝 localhost/私网）+ 流式限量读取
- 用户验证：85 张图全部本地化、0 空 SVG

**粘贴修复**：`installPasteInterceptor()` 在 document 捕获阶段 patch `clipboardData.getData("text/html")`（原生 paste DataTransfer 只读，setData 无效）→ 知乎懒加载空 SVG 替换为 data-actualsrc 真实 URL

**复制到微信**：`?base64=1` 端点用 sharp 把 webp/avif 转 png（Electron nativeImage 不支持 WebP，实测 isEmpty）

### 5.2 阶段 B：S3 备份同步 ✅（commit c57a3a4 / 898e7b9）

- `electron/sync.ts`：同步引擎（详见 §七）
- `store.ts`：S3 配置存取（settings 表 `s3_settings`）、`sync_base` 表、`deleted_notes` 墓碑表
- IPC：`get/saveS3Settings`、`testS3Connection`、`syncNow`、`getSyncStatus`
- 同步面板：状态栏入口 → 配置表单 + 测试连接 + 立即同步
- **真实七牛同步验证通过**（本地 8 篇笔记 ↔ 云端 282 个对象逐字节一致）

### 5.4 阶段 C：代码审计与优化（分支 audit/code-optimization，commit 503742f）🚧

**审计范围**：`61ee469..HEAD` 全量（OCR delegate 模式 + 人工逐文件 4,250 行）。

**修复要点**：
- **安全**：SSRF 拦截 IPv4-mapped IPv6（`[::ffff:7f00:1]` 可绕过，已实测确认）；渲染层下载回退加 25MiB 流式上限；S3 Secret 改用 `safeStorage` 加密落盘（兼容旧明文）；IPC 增加 sender frame 校验
- **健壮性**：asset server 全路由 try/catch（畸形 `%` 编码不再挂起连接）+ MIME 嗅探只读前 16 字节；WorkerPool worker 崩溃时拒绝 in-flight 任务（原 Promise 永不 settle）
- **同步优化**：下载阶段消除 N+1 查询、资源并行下载；上传跳过云端同 hash 资源（增量零重传）；墓碑写入清单后剪除
- **并发/生命周期**：单实例锁（dev 与打包版**不能同时运行**，共用 userData）+ sync 并发锁
- **清理**：删除死代码 `electron/preload.ts`（与 preload.cjs 重复，未参与构建）；`importRemoteNote` 去掉未用参数

**行为变化（注意）**：① 单实例锁 → 开 dev 前先退出打包版；② S3 Secret 下次保存时转加密存储，换机需重填。

**同步进度/结果 UI**：
- `syncNow(store, onProgress)` 新增 `SyncProgress` 事件：connect/download/upload/manifest/done（带 current/total）
- 主进程 `event.sender.send("sync-progress", p)` 推送；preload/native 加 `onSyncProgress` 订阅
- SyncPanel：进度条（百分比/indeterminate）+ 阶段文案 + 最近一次同步结果（上传/下载/冲突数、commit id，持久化在 device_state）
- 端到端验证：首轮 connect→upload→manifest→done；次轮带 download，增量幂等（0/0）

**资源本地化（Lake 编辑器 CDN 全量离线）**：
- 35 个 `gw.alipayobjects.com` 资源镜像到 `public/vendor/cdn/`（含 codemirror 7.1.3、katex 0.16.8 + mhchem、25 个图标、hitu 插图）
- 主进程 `registerCdnRedirect()`：`session.webRequest.onBeforeRequest` 重定向 `*://gw.alipayobjects.com/*` → `http://127.0.0.1:19876/vendor/cdn/<path>`
- asset server 新增 `/vendor/cdn/` 静态路由（无扩展名 MIME 嗅探 + CORS）
- `index.html` / `lakeRuntime.ts` 的 `/vendor/...` 全部改为相对 `./vendor/...`（打包版 file:// 下绝对路径失效）
- 打包版实测 CDN 重定向 5/5 通过

**electron-builder 打包**：
- `release/` 输出 dmg（158MB）+ zip + blockmap；见 §10 打包坑

---

### 5.5 大文档性能定位 + 虚拟渲染试验（2026-08-02，分支 experiment/virtual-rendering）

- 实测定位「大文档图片裂 3.5s」根因：非网络/主线程/渲染，而是 Lake 卡片 UI 提交/hydration 调度（107 codeblock 卡片时）
- 虚拟渲染收益：首图 88ms、滚动渐进、工具栏置顶、多标签滚动独立
- 详细数据、补丁、遗留问题见「★ 最新交接」段与 `VIRTUAL-RENDERING-TEST.md`

---

## 六、数据与存储

### 6.1 本地目录结构

```
~/Library/Application Support/lake-notes-electron/workspace-default/
├── metadata.sqlite3          # 主数据库（WAL 模式）
├── notes/
│   └── {noteId}.lake         # 文档内容（含 http://127.0.0.1:19876/{noteId}/{filename} 引用）
└── note-assets/
    └── {noteId}/
        └── {timestamp}_{random8}.{png|jpg|webp|...}
```

### 6.2 SQLite 表

| 表 | 说明 |
|---|---|
| `notes` | 笔记元数据（sync_state、is_conflict、deleted_at） |
| `tree_nodes` | 目录树（notebook/group/note） |
| `device_state` | key-value（last_opened_note_id、last_synced_at、last_sync_result） |
| `settings` | key-value（`s3_settings` = S3 配置 JSON） |
| `orphan_assets` | 孤儿资源记录（唯一索引 file_path） |
| `deleted_notes` | 本地删除墓碑（同步用） |
| `sync_base` | note_id → content_hash（同步基线，冲突判定用） |

### 6.3 S3 云端布局（prefix = `lake-notes`）

```
lake-notes/
├── objects/{contentHash}.lake        # 文档内容（内容寻址）
├── assets/{noteId}/{filename}        # 资源（跳过 orphan_assets）
└── manifests/
    ├── latest.json                   # 当前清单（Manifest v2）
    └── {commitId}.json               # 历史快照（每次同步累积，可清理）
```

### 6.4 七牛云已验证配置（用户真实账号）

```
Endpoint:    https://s3.cn-north-1.qiniucs.com
Region:      cn-north-1
Bucket:      local-lake-hebei     ← 不是 local-lake！
对象前缀:     lake-notes
Path-style:  ✅ 勾选
```
- AK/SK 保存在本机 settings 表（含密钥，勿外泄、勿提交）
- 账号下实际空间：`image-store-hebei`、`joplin-s3-hebei`、`local-image-lake`、`local-lake-hebei`、`siyuan-qiniu-hebei`
- 用户说后续**安卓端同步**也用这一套配置

---

## 七、S3 同步机制（electron/sync.ts）

- **Manifest**：`version=2`、`workspaceId="default"`、notes[]（id/title/parentId/sortOrder/updatedAt/contentHash/assets[]/deleted）
- **增量**：contentHash（sha256 of .lake）比对，本地 = 远端则只 setBaseHash
- **下载**：远端有本地缺/不同 → 下载 objects/{hash}.lake + assets；本地已删除（墓碑）优先，不重拉
- **冲突**：本地和远端都改过 → 生成「（冲突副本 日期）」笔记（isConflict=true）
- **上传**：仅 hash 不同才上传 .lake + 资源；**跳过 orphan_assets 记录的文件**
- **墓碑**：本地删除而云端未标记 → 清单标记 deleted（不删云端对象，防重拉）
- **进度**：`syncNow(store, onProgress)` 回调，主进程转发 `sync-progress` IPC
- **结果持久化**：device_state 存 `last_synced_at` + `last_sync_result`（JSON）

---

## 八、当前问题 / 已知限制

1. **应用未签名、未公证**：dmg 首次打开需右键 → 打开；分发前需 Developer ID 签名 + 公证
2. **默认 Electron 图标**：尚无应用图标
3. **打包版与开发版共用 userData**（`lake-notes-electron`）：当前方便测试；正式发布需决策是否用 productName 隔离（避免用户数据目录名是 `lake-notes-electron`）
4. **大文档性能**：已通过「图片文件化不进 V8 堆」+ `--max-old-space-size=8192` 缓解；`virtualRendering` 在 `experiment/virtual-rendering` 分支**试验可用**（首图 3.5s→88ms），但有遗留问题（见下 10-13）
5. **渲染包超大（已部分优化）**：画板已拆独立 chunk（drawnix 4.2MB），主 chunk 仍约 9.4MB（大头是 Lake 编辑器本体 + slate + react）；真正收益需编辑器懒加载（改异步创建，属 Lake 阶段，未动）
6. **自动化测试**：**82 个 vitest 用例全绿**（ssrf / sync 引擎 / clipboardHtml / **Store 层 DB 22 例** / **S3 配置校验 4 例**）。Store 层 DB 用例用**双 ABI 方案**落地：`test-node-abi/` 单独装 Node ABI 的 better-sqlite3（`scripts/setup-test-abi.sh` 一键复现），vitest `resolve.alias` 指过去；`vi.mock("electron")` 提供 safeStorage/net 替身；Store 的 DB/树/孤儿/S3 密钥加密/同步状态/导入全部覆盖
7. **孤儿资源无 UI**：IPC 已具备（list/clean），设置面板未做展示与清理按钮
8. **npm 私有镜像不可达**：装新依赖必须显式用 npmmirror registry
9. **远程仓库默认分支仍是 main（tauri）**：Gitee 后台可把默认分支切到 master
10. ~~TOC 滚动高亮不跟随、点击定位不准~~ → **已修复**（本会话：自研 `setupTocScrollFollow` 滚动跟随 + 点击精确校正 + scrollNode 指向 `.ne-editor-wrap`；打开文档大纲约 600ms 出现由 `refreshTocSidebar` 补丁保留）
11. ~~表格浮动工具栏 hover 消失~~ → **已修复**（Phase B：`setupCardToolbarHoverBridge` 捕获拦截 + 补发合成 mouseleave；见最新交接）← 遗留次要边缘：max-view 进出后工具栏定位偏移 ~28px（重开自愈）
12. ~~代码块粘贴后默认不可见~~ → **已修复**（本会话：`ensureCardsInViewHydrated` 修复性水合，cardLazyInit 保留；根因是 Lake 可见性观察器作用在 hole 节点、`hole.$appear` 不传播到卡片 UI）
13. ~~TOC 侧边栏异常尺寸~~ → **已随高度链修复自愈**（TOC 恒为视口高）

---

## 九、下一步计划（建议顺序）

**（虚拟渲染试验分支 `experiment/virtual-rendering` 优先，用户认可先做小测试）**
1. ~~Phase B（表格工具栏）~~ → **已修复**（hover 桥，见最新交接）；历史 `.ne-ui` sticky / `z-index:auto` 七件套 / overlay z-index 补丁保留未动（内部滚动布局下已不冲突，收敛时评估是否删除）
2. ~~代码块粘贴不可见~~ → **已修复**（修复性水合，见最新交接）
3. ~~TOC 高亮/点击定位~~ → **已修复**（自研跟随 + 校正，见最新交接）
4. ~~试验收敛~~ → **已收敛**（本会话：清理 `[lake-perf]` console 探针噪音、`refreshTocSidebar` 重试收敛为 8 次/延时封顶 500ms、`setupTocScrollFollow` 轮询封顶 5s、删除死代码 `__disposeTocFollow`；保留 `window.__lakePerfReport` 排查工具与必要 error/warn）。回归清单关键项已跑通（TOC/表格工具栏/代码块粘贴/多标签/图片）。**剩余：决策合回 `audit/code-optimization`**（功能问题已全部解决，不再阻塞合回）
5. **发布完善**：应用图标（icns）→ 代码签名 + 公证 → 重新打包；Gitee 默认分支切到 master
6. **孤儿资源 UI**：SyncPanel/设置面板展示 orphan_assets 列表 + 清理按钮（IPC 已就绪）
7. ~~自动化测试~~ → **已补**：Store 层 DB 用例（双 ABI，`scripts/setup-test-abi.sh`）+ S3 配置校验，`npm test` 82 全绿
8. **安卓端同步**：复用同步协议（manifests/objects/assets 布局已是跨端设计）
9. **userData 隔离决策**（若正式分发）

---

## 十、踩过的坑（按主题整理，修改前必读）

### A. 打包与发布（electron-builder）

1. **preload 必须纯 JS，绝不能混 TS 语法**：曾把 `: (progress: unknown) => void` 类型注解写进 `electron/preload.cjs` → 开发/打包全部 `SyntaxError: Unexpected token ':'`（以 sandbox_bundle 或 makeContextifyScript 两种面目出现，曾误判为沙箱/asar 冲突）。**preload.cjs 里禁止任何 TS 语法。**
2. **build.files 必须包含 `electron/preload.cjs`**：漏配 → asar 里没有 preload → `lakeNative` undefined → 页面空白。
3. **产物目录必须独立**：输出目录用 `dist/` 会把上一轮的 dmg/zip/.app 递归打进 asar（曾膨胀到 1GB）。必须 `directories.output: "release"`。
4. **vite 8（rolldown）需要 Node ≥ 20.12**：系统 node 18 报 `styleText` 缺失；用 nvm v24。
5. **asar CLI extract-file 会剥离目录**：`asar extract-file app.asar dist/index.html` 会把文件写到**当前目录**（不是 dist/），曾覆盖根 index.html → `git checkout -- index.html` 恢复。
6. **防御性配置（实测可用，暂勿回退）**：`webPreferences.sandbox: false`（contextIsolation 仍开）+ `asarUnpack: ["electron/preload.cjs"]` + 打包版 preload 直接指向 `path.join(__dirname, "../../app.asar.unpacked/electron/preload.cjs")`。
7. **打包版必须用相对路径加载 vendor**：`file://` 下 `/vendor/...` 会指向系统根目录。`index.html` 与 `lakeRuntime.ts` 用 `./vendor/...`（dev 下等价）。

### B. 资源本地化（CDN）

8. **CDN 重定向 handler 不要 decodeURIComponent**：asset server 统一 decode 一次即可；hitu 文件名是双编码 `%25E5...`，二次 decode 会 404。
9. **math.KaTexURL 传数组**（katex + mhchem）；插件对 string/array 都兼容，但 mhchem 需要数组第二个元素。
10. **vendored codemirror.js 要与包默认版本逐字节一致**：实测 7.1.27 与 CDN sha256 一致才可离线工作；另有 7.1.3（代码块卡片回退）也要镜像。

### C. 图片下载与复制（阶段 A 核心）

11. **Node fetch 的 TLS 指纹被 CDN 识别（403）**：知乎等做 JA3 检测，curl/Go/undici 时 200 时 403。解法：主进程 `electronNet.fetch`（Chromium 栈 = Chrome 指纹）+ `Referer=图片URL自身` + 浏览器 UA + 3 次重试 + SSRF 防护。
12. **原生 paste 的 clipboardData 只读**：`setData` 无效（合成事件可写会骗过测试）。解法：`installPasteInterceptor()` 在 **document 捕获阶段 patch `getData("text/html")`**，且必须在编辑器创建前安装。
13. **验证剪贴板必须走真实路径**：用 `webContents.paste()` + 系统剪贴板；合成 `dispatchEvent` 会骗过自己。
14. **Electron nativeImage 不支持 WebP 解码**（`createFromBuffer` 实测 isEmpty）：复制到微信的 webp/avif 转换必须用 **sharp**。
15. **同步 XHR 不支持 arraybuffer**：`responseType="arraybuffer"` 静默失败、`overrideMimeType` 会丢字节。解法：服务器 `?base64=1` 直接返回 base64 文本，客户端零转换。
16. **navigator.clipboard.write() 对 macOS 原生应用无效**：微信读不到 text/html。必须 `event.clipboardData.setData()` 同步写入（因此用了同步 XHR）。
17. **复制到微信的空行**：Lake 图片前后有空段落（零宽字符 `\u200B`、`<span><br></span>`）。`normalizeClipboardHtml` 末尾正则清理。
18. **Lake copy handler 优先级**：用捕获阶段 + `stopImmediatePropagation()` 确保先于 Lake 内部 handler。
19. **`isCaptureImageURL` 必须排除本地 URL**：否则每次 `setDocument` 都重新下载上传本地图片，产生冗余文件与竞态。当前实现已排除 `http://127.0.0.1:19876/`。

### D. 编辑器与 CSS

20. **性能优化破坏 TOC（历史教训，已被本会话部分推翻）**：历史上 `content-visibility: auto`、`virtualRendering`、Tab 离屏销毁、MutationObserver 懒加载都曾破坏 TOC。**但 2026-08-02 会话证明：`virtualRendering` + `scrollNode` 指对真实滚动容器 + setDocument 后重放 `tocChange`，TOC 可以工作**（打开时延迟 ~600ms 出现）。遗留：滚动高亮不跟随、点击定位不准（虚拟渲染下视口外标题无 DOM）。详见「★ 最新交接」。
21. **overflow 修改影响 Lake 浮动 UI（已演进）**：`.multi-tab-editor`/`.tab-panels` 设 overflow 曾裁剪表格工具栏与 TOC 按钮（表格工具栏另有 z-index/sticky 链问题，Phase B 未完成）。**Phase A.5 之后每标签独立滚动容器（`.lake-editor-tab` overflow-y:auto）是可行的**——`.multi-tab-editor` 用 `height:100%`（确定高度）而非 `min-height`（否则内容撑高、内部滚动失效、外层裁剪导致无法滚动）。
22. **`-webkit-app-region: drag` 原生层吃点击**：`pointer-events: none` 无效。`.tab-bar` 设 drag、`.tab-item` 设 no-drag。
23. **CSS 修改铁律**：改前先 `diff lake-notes-tauri-poc/src/styles.css src/styles.css`；绝不加 `content-visibility`/`contain` 到引擎层。
24. **Drawnix CSS 不能直接 import**：包的 exports 没导出 CSS。复制到 `src/vendor/` 从本地路径导入。
25. **DefaultEditorConfig 必须递归深合并**：一层合并丢嵌套配置（`deepMerge` 已实现）。
26. **scrollNode 必须指向真实滚动容器**（虚拟渲染/大纲定位前提）：本项目滚动容器是 `.document-pane`（桌面多标签后改为每个 `.lake-editor-tab`）；`body` 是 `overflow:hidden`，Lake 默认回退 `document.scrollingElement || document.body` 会拿错，导致视口测量/TOC 全乱。
27. **新建标签元素在编辑器创建时尚未布局**：`useEffect` 同步阶段 `clientHeight=0`，虚拟渲染初始视口按 0 算 → 首屏/大纲异常。`scrollNode` 函数里读一次 `offsetHeight` 可强制 reflow（对 TOC 空数据不是根因，但对视口测量有影响）。
28. **TOC 侧边栏创建时用空 toc 渲染（Lake 行为）**：`ready` 事件早于 `tocChange` 时侧边栏永远不会被填充 → 打开文档大纲为 0，编辑后才出现。补丁：`refreshTocSidebar()`（`kernel.getDocExtraContent().toc` 取权威数据 + `kernel.emitPluginEvent("tocChange", data)` 走官方路径重放 + 递增重试 ~600ms）。
29. **TOC 条目是 `div.ne-toc-item`，不是 `<a>`**：探测/选择器用 `a` 会数出 0 造成误判。
30. **多标签共用滚动容器 → 滚动位置共享**：`.document-pane` 包所有标签时，A 标签滚到中部，切 B 也在中部。解法：每标签独立滚动容器（`.lake-editor-tab` height:100% + overflow-y:auto，`tab-panels` grid 1fr 钉高度）。
31. **`npm run dev` 会启动两个 Electron**：`vite-plugin-electron` 默认自动拉起 Electron，脚本里再 `wait-on && electron .` 就是双实例 → 单实例锁冲突 + ERR_FAILED。已修：dev 只跑 vite（commit 3b7db20）。
32. **打包版卸载后 SingletonLock 残留**：`~/Library/Application Support/lake-notes-electron/SingletonLock|SingletonSocket|SingletonCookie` 残留会挡 dev 启动（"Failed to create SingletonLock: File exists"）。确认无进程后改名 `.stale-bak` 即可（沙箱禁 `rm -f`，用 mv）。
33. **埋点/日志坑**：`console.debug` 被 DevTools 默认过滤（改用 `console.log`）；HMR 不重建已创建的编辑器实例（测新埋点必须 Cmd+R 或重启）；`editor.on("tocChange")` 收不到内核事件（要走 `editor.kernel.onPluginEvent`）。
34. **docInitPerf 探针不生效**：monitorLog 走内核 emitter，`editor.on("monitorLog")` 收不到（facade 不转发）；本会话未修，非功能问题。

### E. 环境与工具

26. **杀进程误杀 Trae CN**：永远用 `grep "lake-notes-electron"` 精确匹配，禁 `pkill -f Electron`。
27. **npm 私有镜像不可达**：显式用 `registry.npmmirror.com` + 独立 cache 目录。
28. **better-sqlite3 ABI**：装完必须 `@electron/rebuild`（Node ABI ≠ Electron ABI）。
29. **React StrictMode**：useEffect 双执行，setOpenTabs 需去重（`tabs.some(...)`）。
30. **Tauri 自定义协议闪退**：当初不做资源归一化的原因；Electron 无此问题，用 HTTP 方案。

### F. S3 / 七牛

31. **七牛报 `UnknownError` = Bucket 名不存在**（404 的字面 message）。先 `ListBuckets` 确认真实空间名，再排查网络。
32. **Endpoint 必须是区域级地址**：bucket 专用虚拟主机地址（`local-lake-hebei.s3.cn-north-1.qiniucs.com`）+ path-style 会 404，不勾 path-style 会拼出双 bucket 域名导致 TLS 失败。用 `https://s3.cn-north-1.qiniucs.com` + path-style。
33. **Region 填 `cn-north-1`**，不是空间名。
34. **单实例锁（audit 新增）**：dev 与打包版共用 userData/SingletonLock，不能同时运行；开发前先退出打包版。
35. **better-sqlite3 为 Electron ABI，纯 Node 的 vitest 无法 require**：同步引擎测试用 FakeStore + mock @aws-sdk/client-s3（`electron/sync.test.ts`）规避，勿直接 new Store() 写测试。

---

## 十一、关键版本与依赖

| 依赖 | 版本 | 备注 |
|---|---|---|
| electron | 33.4.11 | ^33.0.0 |
| electron-builder | 25.1.8 | devDependency |
| vite / rolldown | 8.1.5 | 需 Node ≥ 20.12 |
| better-sqlite3 | 11.3.0 | 原生，需 rebuild |
| sharp | 0.35.3 | 原生，webp→png |
| @aws-sdk/client-s3 | 3.1101.0 | S3 同步 |
| lakex-editor-react-component | 0.1.2 | Lake 编辑器 ESM |
| lakex-drawnix / -react-board / -react-text | 0.1.0 | 画板 |

**提交历史**（master 主线）：
```
74062e3 阶段B收尾：资源本地化+同步进度UI+dmg打包
898e7b9 同步面板入口：状态栏点击同步状态打开 S3 配置面板
c57a3a4 阶段 B：S3 备份同步（七牛云等 S3 兼容服务）
a703492 正式版 v1 基础：资源归一化 + 第三方图片下载/复制修复
61ee469 baseline: before asset server POC
```
