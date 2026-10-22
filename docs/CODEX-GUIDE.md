# Codex 自主开发指南（本项目操作姿势）

> 本项目全程由 Codex 开发。**让 Codex 自主操作电脑是本项目的常态**——Codex 具备
> Playwright（node_repl 内置）、Computer Use（可操控 Mac 界面）、应用内浏览器
> （Chrome，可复用已登录会话）三种能力；**有些会话会用、有些不会，但本项目的正确
> 姿势是「Playwright 驱动真实 Electron 实测」**（2026-08-02 全链路修复就是这么做的，
> 效果最好）。
>
> 核心原则：**能精确驱动真实应用，就绝不靠读代码/模拟猜测**。Electron 应用的 DOM
> 几何、事件、布局、剪贴板、IPC 问题，必须跑真实应用验证。

---

## 方式一（首选）：Playwright 驱动真实 Electron

### 为什么
- Lake 编辑器/虚拟渲染的问题（TOC 几何、卡片水合、工具栏 hover、滚动补偿）全是
  DOM/事件层问题，只有真实跑起来才看得到
- Playwright 可读真实 DOM、派发真实鼠标/键盘、截图给用户看，且能访问真实
  IPC/asset server/DB（比 jsdom/单元测试真实得多）
- 比 Computer Use 更快更精确（直接读几何数据，不用"看屏幕猜坐标"）

### 环境要点
- **node_repl MCP**（JavaScript 内核）内置 playwright：`const { _electron } = await import("playwright")`
- 主进程 `isDev = !app.isPackaged` 会 `loadURL("http://127.0.0.1:1421")` →
  用**静态 HTTP 服务器 serve `dist/`**（先 `vite build`，Node 24），应用即可加载生产渲染层
- node_repl 沙箱**禁 `process`**（别 `...process.env`）；顶层绑定会冲突
  （`Identifier already declared`）——换名或复用已有绑定
- 启动一次约 10s；每个改动要重启应用（渲染层是构建产物，改完重新 build）

### 启动模板（可直接复制）
```js
// 0) 构建（Node 24）
// export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
// node node_modules/vite/bin/vite.js build

// 1) 静态服务器 serve dist/（常驻 node_repl）
const http = await import("node:http"), fs = await import("node:fs"), path = await import("node:path");
const DIST = "/Users/admin/file/local-lake/lake-notes-electron/dist";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
globalThis.staticServer = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const file = path.join(DIST, p);
    if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  } catch (e) { res.writeHead(404); res.end(String(e)); }
});
await new Promise(r => staticServer.listen(1421, "127.0.0.1", r));

// 2) 启动应用
const { _electron } = await import("playwright");
globalThis.app = await _electron.launch({
  executablePath: "/Users/admin/file/local-lake/lake-notes-electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  args: ["."],
  cwd: "/Users/admin/file/local-lake/lake-notes-electron",
  timeout: 60000,
});
const win = await app.firstWindow();
await new Promise(r => setTimeout(r, 9000)); // 等 React/编辑器加载

// 3) 常用操作
await win.evaluate(() => { /* 读 DOM：getBoundingClientRect / class / computed style */ });
await win.mouse.click(x, y);           // 真实点击（合成 dispatchEvent 不触发真实焦点）
await win.mouse.move(x, y);            // 真实悬停（hover 类 UI 必须用这个）
await win.keyboard.press("Meta+v");    // 真实键盘
await win.evaluate(async () => { /* navigator.clipboard.write([new ClipboardItem({...})]) */ });
await win.screenshot({ path: "/tmp/xxx.png" });  // 截图给用户看
```

### 常用手法
- **读真实 DOM**：`getBoundingClientRect`/`className`/`getComputedStyle`；虚拟渲染下
  视口外元素不在 DOM——先滚动（`wrap.scrollTop = n` + `dispatchEvent(new Event("scroll"))`）
- **定位"监听绑在哪个元素"**：对候选元素逐个派发合成 mouseenter/mouseleave，看谁生效
- **真实剪贴板**：页面内 `navigator.clipboard.write([new ClipboardItem({...})])` 后按
  `Meta+v`；注意原生 paste 的 DataTransfer 只读
- **打开笔记/标签**：`tree-row.type-note` 行用 `win.mouse.click`（合成 click 有时不触发）
- **窗口状态**：`app.evaluate(({BrowserWindow}) => ...)` 查主进程侧

### 测试纪律（很重要）
- **测试数据会写进用户真实笔记**：粘贴/建笔记后必须清理（从 .lake 文件按块删除），
  并全库扫描验证无残留；`.lake` 是 HTML+URL 编码文本，grep 用编码后的模式
- **杀进程只 `grep "local-lakex-notes"`**（禁 `pkill -f Electron`，会误杀 Trae CN）
- **单实例锁**：dev 与打包版不能同时跑；端口 1421 冲突先 `lsof -ti tcp:1421 | xargs kill -9`
- 结束前关闭应用 + 静态服务器，释放端口

## 方式二：Computer Use（Mac 界面操控）

- **适用**：Playwright 驱动不了的场景——打包版 .app 冒烟、系统弹窗/钥匙串、
  拖文件到 Finder、向微信等第三方应用真实复制粘贴
- 用法：Codex 通过 computer-use 看屏幕 → 移动鼠标/键盘操作；用户已授予高权限
- **建议**：先试 Playwright；搞不定再上 Computer Use（本项目 GUI 交互少，大部分
  问题 Playwright 都能覆盖）

## 方式三：应用内浏览器（Chrome）

- **适用**：网页类操作——Gitee 仓库设置（切默认分支/Webhook）、在线文档、
  npm/GitHub 查资料（已登录会话可直接用）
- 本项目**代码调试不用它**

## 推荐会话工作流

1. **读交接**：`HANDOFF.md`（唯一交接文档：当前状态 / 真正的待办 / 踩坑）
2. **改码前先想验证方式**：能实测的一律 Playwright 驱动真实应用
3. **每个修复的闭环**：
   复现（拿数据）→ 根因（必要时反编译 Lake dist 确认）→ 改 → 实测数据 → 回归
   → 清理测试数据 → 更新交接文档 → 提交/推送（master）
4. **会话结束**：把任务目标/已完成/当前问题/下一步/踩坑写进 `HANDOFF.md`
   + `docs/TROUBLESHOOTING.md`

## 环境速查

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"   # Node 24（vite 8 必需）
export npm_config_registry=https://registry.npmmirror.com   # npm 私有镜像不可达
export npm_config_cache=/tmp/npm-cache-lake
node node_modules/vite/bin/vite.js build                    # 构建渲染层+主进程
npx vitest run                                              # 测试（better-sqlite3 13.x N-API，无需双 ABI 基建）
```
