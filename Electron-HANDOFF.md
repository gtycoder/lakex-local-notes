# Lake Notes Electron 交接文档

更新时间：2026-07-31 下午
状态：**桌面端基本可用，多 Tab 布局有一个 CSS 问题待修，大文档 OOM 待优化**

本文面向完全没有此前上下文的新会话。请先读完本文，再修改代码。

---

## 一、任务目标

将 Lake Notes 笔记应用从 **Tauri 2** 迁移到 **Electron**，解决 Tauri 在 macOS 上使用 WKWebView 导致的一系列渲染 bug（foreignObject 文字不绘制、viewport 偏移等）。

**为什么换 Electron**：
- Tauri 在 macOS 强制使用系统 WKWebView，无法替换。WKWebView 对 SVG foreignObject 负坐标不渲染 HTML 文字
- Lake 编辑器是 Web 组件，Chromium 是它的原生环境（语雀自己就跑在 Chrome 上）
- Electron 有完整 Chrome DevTools，调试效率提升 10 倍
- 思源笔记（同类型产品）也是 Electron

**核心设计理念（继承自 Tauri 版）**：
- 图片直接用 base64 存储在 .lake 文件中（大就大，离线可用）
- 不做资源归一化管理，不做独立资源目录
- 后期用 S3 做备份，不做实时同步
- 复制到第三方应用（微信）时图片能正常显示
- **不要弹"正在加载"之类的 toast**

**技术栈**：Electron 33 + React 18 + TypeScript + better-sqlite3 + Lake 编辑器（ESM，`lakex-editor-react-component`）+ Drawnix 画板（`lakex-drawnix`）

---

## 二、工作区与分支

### 项目位置
`/Users/admin/file/local-lake/lake-notes-electron`（独立 git 仓库，所有文件 untracked）

### 只读参考（不要修改）
- `/Users/admin/file/local-lake/lake-notes-tauri-poc/`：Tauri 版源码，架构参考，**CSS 基准**
- `/Users/admin/file/local-lake/siyuan/`：思源笔记，Electron 架构参考

---

## 三、启动方式

```bash
export PATH="/Users/admin/.nvm/versions/node/v24.18.0/bin:$PATH"
export NPM_CONFIG_USERCONFIG=$(mktemp)
export NPM_CONFIG_GLOBALCONFIG=$(mktemp)
export npm_config_registry=https://registry.npmmirror.com
export npm_config_cache=/tmp/npm-cache-lake
cd /Users/admin/file/local-lake/lake-notes-electron
npx vite --host 127.0.0.1 --port 1421
```

`vite-plugin-electron` 会自动启动 Electron。Vite dev server 地址：`http://127.0.0.1:1421/`

**⚠️ 杀进程时绝不能用 `pkill -f "Electron"`**——Trae CN（用户的 IDE）也是 Electron 应用，主进程二进制也叫 `Electron`，会被误杀。正确方式：
```bash
kill $(ps aux | grep "lake-notes-electron" | grep -v grep | awk '{print $2}')
```

---

## 四、已完成内容

### 4.1 项目脚手架 ✅
- `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`
- `vite-plugin-electron` 同时构建前端和 Electron 主进程
- Vite alias：`@plait-board/react-board` → `lakex-drawnix-react-board`，`@plait-board/react-text` → `lakex-drawnix-react-text`

### 4.2 Electron 主进程 ✅
- `electron/main.ts`：窗口创建（hiddenInset + trafficLightPosition）、IPC 注册、`--max-old-space-size=8192`
- `electron/preload.cjs`：**原生 CJS 文件**，不走 Vite 编译（见踩坑 §9.3）
- `electron/store.ts`：Node.js 后端（better-sqlite3 + 文件系统），从 Tauri Rust 后端移植

### 4.3 前端代码迁移 ✅
从 Tauri 版复制并适配。以下文件与 Tauri 版**逐字节相同**：
- `clipboardHtml.ts`（复制到微信的 HTML 清洗）
- `imageFormat.ts`（图片格式嗅探）
- `resourceUpload.ts`（图片上传管线：WebP→PNG、base64、远程下载）
- `concurrency.ts`、`retry.ts`、`tree.ts`、`types.ts`、`workerPool.ts`
- `Sidebar.tsx`、`MobileLibrary.tsx`、`SyncPanel.tsx`、`LakeEditor.tsx`

以下文件做了适配（功能等价）：
- `App.tsx`：`isTauri()` → `isDesktop()`
- `EditorTab.tsx`：API 名称适配
- `lakeRuntime.ts`：简化 API 签名 + 注册 BoardCard
- `native.ts`：`isTauri()` → `isDesktop()`，缺少 4 个 S3 方法
- `MultiTabEditor.tsx`：与 Tauri 版相同（性能优化已回退）
- `main.tsx`：移除 wkprobe

### 4.4 Drawnix 画板集成 ✅
- `src/features/editor/BoardCard.tsx`：干净实现，无 WKWebView workaround
- CSS 从 `src/vendor/` 导入（3 个文件，从 node_modules 复制，见踩坑 §9.5）
- 在 `lakeRuntime.ts` 注册到斜杠菜单（"程序员" 分组）
- 画板有边框样式（`.board-card-wrapper--editor`）

### 4.5 功能迁移审计 ✅
所有核心编辑功能已 100% 迁移：图片粘贴、复制到微信、WebP 转换、自动保存、多 Tab、目录树拖拽、画板。唯一缺口：S3 同步（4 个 IPC 方法 + 后端逻辑未迁移，低优先级）。

### 4.6 imageConverter.worker.ts 修复 ✅
Tauri 版在 Worker 中用 `new Image()`（DOM API，Worker 中不可用）。已改为 `createImageBitmap()`。

---

## 五、当前问题

### 5.1 🔴 多 Tab 模式下文档无法滚动（P0）

**现象**：多 Tab 模式下，文档内容无法向下滚动。

**根因**：`src/styles.css` 第 83 行有：
```css
.document-pane:has(.multi-tab-editor) { overflow: hidden; }
```
这条规则禁止了 `.document-pane` 的滚动。同时 `.lake-editor-tab` 被加了 `overflow-y: auto` 试图让每个 Tab 内部滚动，但这与 Lake 编辑器的 DOM 结构不兼容。

**正确修复方案**（已分析但未实施）：
```css
/* 1. 删除 .document-pane:has(.multi-tab-editor) { overflow: hidden; } */
/* 2. 删除 .lake-editor-tab 上的 overflow-y: auto; overflow-x: hidden; */
/* 3. .tab-bar 改为 sticky：*/
.tab-bar {
  position: sticky;
  top: 0;
  z-index: 200;
}
```

**原理**：`.multi-tab-editor` 有 `overflow: visible`（不创建滚动上下文），所以 `.tab-bar` 的 `position: sticky` 会相对于 `.document-pane`（真正的滚动容器）生效。Tab 栏粘在顶部，内容在其下方滚动。TOC 不受影响（`.ne-toc-sidebar` 用 `position: fixed`，不受 overflow 影响）。

**⚠️ 之前的错误尝试**：
- `overflow: clip` → 禁止所有滚动，用户直接骂了
- `overflow: hidden` on `.multi-tab-editor` 或 `.tab-panels` → 裁剪 Lake 的浮动 overlay（表格工具栏、TOC 切换按钮）
- `overflow: hidden` on `.document-pane:has(...)` → 禁止文档滚动（当前状态）

### 5.2 🟡 大文档 OOM 崩溃（P1）

**现象**：包含大量 base64 图片的长文档会导致渲染进程 V8 OOM 崩溃（白屏）。

**已做**：`electron/main.ts` 中加了 `app.commandLine.appendSwitch("js-flags", "--max-old-space-size=8192")`，将内存限制从默认 ~1.7GB 提升到 8GB。

**仍不够**：极端大文档仍可能崩溃。根本原因是 base64 图片存储方式——一张 5MB 图片在内存中占 ~7MB（base64 膨胀 + V8 字符串开销），100 张图片就是 700MB。

**可能的优化方向**（都需要谨慎，不能破坏 TOC 和 Lake 编辑器）：
- 图片改用 blob URL 或文件路径引用（需要改存储架构，工作量大）
- 对 `.ne-engine` 的非标题子元素加 `contain: layout style paint`（**不能加 `content-visibility: auto`**，见踩坑 §9.7）
- 图片懒加载用 CSS `loading="lazy"` 属性（**不能用 MutationObserver**，见踩坑 §9.7）

### 5.3 🟢 S3 同步未迁移（P2）

`native.ts` 缺少 `getS3Settings`、`saveS3Settings`、`testS3Connection`、`syncNow` 四个方法。`SyncPanel.tsx` 是死代码（未被引用）。后端 `store.ts` 缺少 `import_remote`、`mark_synced` 等同步方法。

---

## 六、CSS 架构说明（⚠️ 最重要的一节）

### 6.1 CSS 基准

`src/styles.css` 的基础是 **Tauri 版的 CSS 逐字节复制**，然后只加了以下 Electron 差异：

| 行号区域 | 改动 | 原因 |
|---------|------|------|
| `:root` | `--topbar-height: 38px`（Tauri 是 `0px`） | macOS 红绿灯按钮空间 |
| `.sidebar` | 加了 `padding-top: var(--topbar-height)` | 侧边栏顶部留空 |
| `.tab-bar` | 加了 `padding-top: var(--topbar-height)` + `-webkit-app-region: drag` + `position: relative; z-index: 200` | 拖拽区域 + Tab 按钮 `no-drag` |
| `.ne-ui` | `z-index: 1` → `150` | 工具栏不被内容覆盖 |
| `.ne-toc-sidebar` | 加了 `bottom: 40px; overflow-y: auto` | 长大纲可滚动 |
| 文件末尾 | `.board-card-wrapper--editor` 边框样式 | 画板视觉边界 |

**另外有两条需要删除/修改的问题规则**（见 §5.1）：
- 第 83 行 `.document-pane:has(.multi-tab-editor) { overflow: hidden; }` → **删除**
- `.lake-editor-tab` 上的 `overflow-y: auto; overflow-x: hidden;` → **删除**
- `.tab-bar` 的 `position: relative` → **改为 `position: sticky; top: 0`**

### 6.2 ⚠️ CSS 修改铁律

1. **绝不修改 `.multi-tab-editor` 的 `overflow`**——必须是 `visible`，否则 Lake 的浮动 overlay（表格工具栏、TOC 切换按钮）被裁剪
2. **绝不修改 `.tab-panels` 的 `overflow`**——必须是 `visible`，同上
3. **绝不加 `content-visibility: auto`**——会让浏览器跳过标题渲染，TOC 扫描不到
4. **绝不加 `contain: layout style paint` 到 `.ne-engine > *`**——同上，影响 TOC
5. **修改 CSS 前先对比 Tauri 版**：`diff lake-notes-tauri-poc/src/styles.css lake-notes-electron/src/styles.css`

---

## 七、下一步计划

### 第一阶段：修复布局（立即）
1. 按 §5.1 的方案修复多 Tab 滚动（删 overflow:hidden，tab-bar 改 sticky）
2. 验证：文档可滚动 + Tab 栏不被覆盖 + TOC 正常 + 工具栏不被覆盖

### 第二阶段：性能优化（谨慎）
3. 大文档 OOM：尝试对非标题元素加 `contain: layout style paint`（**不加 content-visibility**）
4. 图片懒加载：在 `lakeRuntime.ts` 的 Lake 配置中看是否有原生 lazy loading 选项

### 第三阶段：功能补齐
5. S3 备份同步
6. `electron-builder` 打包（dmg for macOS）
7. 应用图标、窗口标题栏美化
8. 测试文件迁移（5 个 `.test.ts`）

---

## 八、关键文件索引

| 文件 | 用途 |
|---|---|
| `electron/main.ts` | Electron 主进程（窗口 + IPC + 内存限制） |
| `electron/preload.cjs` | contextBridge 安全桥接（**原生 CJS，不走 Vite**） |
| `electron/preload.ts` | 旧文件，已废弃，可删除 |
| `electron/store.ts` | Node.js 后端（SQLite + 文件系统） |
| `src/App.tsx` | 主应用组件 |
| `src/main.tsx` | React 入口 |
| `src/lib/native.ts` | 前端 IPC 封装（`window.lakeNative`） |
| `src/features/editor/lakeRuntime.ts` | Lake 编辑器创建/销毁 + BoardCard 注册 |
| `src/features/editor/BoardCard.tsx` | Drawnix 画板卡片 |
| `src/features/editor/EditorTab.tsx` | 多 Tab 单编辑器 |
| `src/features/editor/MultiTabEditor.tsx` | Tab 栏 + 容器 |
| `src/features/editor/resourceUpload.ts` | 图片/附件上传管道 |
| `src/styles.css` | 全局样式（**基于 Tauri 版 + 少量 Electron 差异**） |
| `src/vendor/drawnix*.css` | Drawnix CSS（从 node_modules 复制） |
| `vite.config.ts` | Vite + vite-plugin-electron + Drawnix alias |

---

## 九、踩过的坑

### 9.1 npm 安装
- **必须用国内镜像**：用户没有 VPN
  ```bash
  export npm_config_registry=https://registry.npmmirror.com
  export npm_config_cache=/tmp/npm-cache-lake
  ```
- `better-sqlite3` 安装后必须用 `@electron/rebuild` 重编译，否则 ABI 不匹配（Node 24 = ABI 137，Electron 33 = ABI 130）

### 9.2 SQL INSERT 占位符
`electron/store.ts` 的 `migrate()` 和 `createNoteIn()` 方法中 INSERT 语句的 VALUES 占位符数量与列数不匹配。已修复，但如果重写 store.ts 要注意。

### 9.3 Preload 必须是 CJS
`vite-plugin-electron` **总是**把 preload 编译为 ESM（忽略 `format: "cjs"` 配置）。Electron 的 preload 脚本**必须是 CJS**。解决方案：手写 `electron/preload.cjs`，用 `require("electron")`，不经过 Vite 编译。`vite.config.ts` 中只保留 `electron/main.ts` 一个 entry。

### 9.4 `-webkit-app-region: drag` 吃点击事件
Electron 中 `-webkit-app-region: drag` 在**原生层**拦截所有鼠标事件，即使设了 `pointer-events: none` 也无效。之前用全局 `.titlebar-drag` 覆盖层导致 Tab 栏点击全部失效。正确做法：在 `.tab-bar` 上设 `drag`，在 `.tab-item` 上设 `no-drag`。

### 9.5 Drawnix CSS 导入
`lakex-drawnix-react-board` 和 `lakex-drawnix-react-text` 的 `package.json` 的 `exports` 字段**没有导出 CSS**。Vite 不允许导入未在 exports 中声明的文件。解决方案：把 CSS 复制到 `src/vendor/` 目录，从本地路径导入。

### 9.6 杀进程误杀 Trae CN
Trae CN（用户的 IDE）也是 Electron 应用，主进程二进制叫 `Electron`。`pkill -f "Electron"` 会把它一起杀掉。**永远用精确匹配**：
```bash
kill $(ps aux | grep "lake-notes-electron" | grep -v grep | awk '{print $2}')
```

### 9.7 性能优化破坏 TOC（最大教训）

以下 4 项优化**全部导致 TOC/大纲功能失效**，已全部回退：

| 优化 | 破坏原因 |
|------|---------|
| `content-visibility: auto` | 浏览器跳过标题元素渲染，TOC 扫描器找不到标题 |
| `virtualRendering: true` | Lake 跳过离屏标题的 DOM 渲染，TOC 为空 |
| Tab 离屏销毁（`return null`） | 编辑器实例被销毁重建，TOC 状态丢失 |
| MutationObserver 懒加载 | 干扰 Lake 内部 DOM 变更检测 |

**教训**：Lake 编辑器的 TOC 依赖完整的 DOM 树扫描。任何跳过/延迟/销毁 DOM 元素的优化都会破坏 TOC。做性能优化时**必须先验证 TOC 是否正常**。

### 9.8 overflow 修改破坏 Lake 浮动 UI

| 修改 | 后果 |
|------|------|
| `.multi-tab-editor { overflow: hidden }` | 裁剪 Lake 表格工具栏 + TOC 切换按钮 |
| `.tab-panels { overflow: hidden }` | 同上 |
| `.document-pane:has(...) { overflow: clip }` | 禁止所有滚动 |
| `.document-pane:has(...) { overflow: hidden }` | 禁止文档滚动 |

**正确方案**：不修改任何 overflow，用 `position: sticky` 让 tab-bar 粘在滚动容器顶部。

### 9.9 Vite 缓存
改了 `node_modules` 中的文件或 CSS 导入路径后，Vite 可能用旧的预打包缓存。清理方式：
```bash
mv node_modules/.vite /tmp/vite-cache-old
```

### 9.10 React StrictMode
`useEffect` 执行两次，`setOpenTabs` 回调中必须用 `tabs.some(t => t.noteId === id)` 去重。

### 9.11 DefaultEditorConfig 必须递归深合并
一层合并会丢失嵌套配置（如 `slash.cardSelect.recordSelectedItemConfig`）。`lakeRuntime.ts` 中的 `deepMerge` 是递归实现。

---

## 十、与 Tauri 版的功能差异

| 功能 | Tauri 版 | Electron 版 |
|---|---|---|
| Lake 编辑器 | ✅ ESM + Drawnix 画板 | ✅ ESM + Drawnix 画板 |
| 多 Tab | ✅ 8 Tab + LRU | ✅ 同 |
| 图片上传 | ✅ base64 + WebP→PNG | ✅ 同 |
| 目录树 | ✅ 拖拽排序 | ✅ 同 |
| 复制到微信 | ✅ | ✅ |
| 大纲/TOC | ✅ | ✅ |
| S3 备份 | ✅ | ❌ 待实现 |
| 调试 | ❌ 几乎不可用 | ✅ Chrome DevTools |
| 多 Tab 滚动布局 | ⚠️ 有覆盖 bug | ⚠️ 有覆盖 bug（待修） |
| 大文档性能 | ⚠️ 卡 | ⚠️ OOM（待优化） |
