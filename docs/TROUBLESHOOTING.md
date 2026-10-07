# 踩过的坑（按主题整理，修改前必读）

## A. 打包与发布（electron-builder）

1. **preload 必须纯 JS，绝不能混 TS 语法**：曾把 `: (progress: unknown) => void` 类型注解写进 `electron/preload.cjs` → 开发/打包全部 `SyntaxError: Unexpected token ':'`（以 sandbox_bundle 或 makeContextifyScript 两种面目出现，曾误判为沙箱/asar 冲突）。**preload.cjs 里禁止任何 TS 语法。**
2. **build.files 必须包含 `electron/preload.cjs`**：漏配 → asar 里没有 preload → `lakeNative` undefined → 页面空白。
3. **产物目录必须独立**：输出目录用 `dist/` 会把上一轮的 dmg/zip/.app 递归打进 asar（曾膨胀到 1GB）。必须 `directories.output: "release"`。
4. **vite 8（rolldown）需要 Node ≥ 20.12**：系统 node 18 报 `styleText` 缺失；用 nvm v24。
5. **asar CLI extract-file 会剥离目录**：`asar extract-file app.asar dist/index.html` 会把文件写到**当前目录**（不是 dist/），曾覆盖根 index.html → `git checkout -- index.html` 恢复。
6. **防御性配置（实测可用，暂勿回退）**：`webPreferences.sandbox: false`（contextIsolation 仍开）+ `asarUnpack: ["electron/preload.cjs"]` + 打包版 preload 直接指向 `path.join(__dirname, "../../app.asar.unpacked/electron/preload.cjs")`。
7. **打包版必须用相对路径加载 vendor**：`file://` 下 `/vendor/...` 会指向系统根目录。`index.html` 与 `lakeRuntime.ts` 用 `./vendor/...`（dev 下等价）。

## B. 资源本地化（CDN）

8. **CDN 重定向 handler 不要 decodeURIComponent**：asset server 统一 decode 一次即可；hitu 文件名是双编码 `%25E5...`，二次 decode 会 404。
9. **math.KaTexURL 传数组**（katex + mhchem）；插件对 string/array 都兼容，但 mhchem 需要数组第二个元素。
10. **vendored codemirror.js 要与包默认版本逐字节一致**：实测 7.1.27 与 CDN sha256 一致才可离线工作；另有 7.1.3（代码块卡片回退）也要镜像。

## C. 图片下载与复制（阶段 A 核心）

11. **Node fetch 的 TLS 指纹被 CDN 识别（403）**：知乎等做 JA3 检测，curl/Go/undici 时 200 时 403。解法：主进程 `electronNet.fetch`（Chromium 栈 = Chrome 指纹）+ `Referer=图片URL自身` + 浏览器 UA + 3 次重试 + SSRF 防护。
12. **原生 paste 的 clipboardData 只读**：`setData` 无效（合成事件可写会骗过测试）。解法：`installPasteInterceptor()` 在 **document 捕获阶段 patch `getData("text/html")`**，且必须在编辑器创建前安装。
13. **验证剪贴板必须走真实路径**：用 `webContents.paste()` + 系统剪贴板；合成 `dispatchEvent` 会骗过自己。
14. **Electron nativeImage 不支持 WebP 解码**（`createFromBuffer` 实测 isEmpty）：复制到微信的 webp/avif 转换必须用 **sharp**。
15. **同步 XHR 不支持 arraybuffer**：`responseType="arraybuffer"` 静默失败、`overrideMimeType` 会丢字节。解法：服务器 `?base64=1` 直接返回 base64 文本，客户端零转换。
16. **navigator.clipboard.write() 对 macOS 原生应用无效**：微信读不到 text/html。必须 `event.clipboardData.setData()` 同步写入（因此用了同步 XHR）。
17. **复制到微信的空行**：Lake 图片前后有空段落（零宽字符 `\u200B`、`<span><br></span>`）。`normalizeClipboardHtml` 末尾正则清理。
18. **Lake copy handler 优先级**：用捕获阶段 + `stopImmediatePropagation()` 确保先于 Lake 内部 handler。
19. **`isCaptureImageURL` 必须排除本地 URL**：否则每次 `setDocument` 都重新下载上传本地图片，产生冗余文件与竞态。当前实现已排除 `http://127.0.0.1:19876/`。

## D. 编辑器与 CSS

20. **性能优化破坏 TOC（历史教训，已被 2026-08-02 会话推翻/解决）**：历史上 `content-visibility: auto`、`virtualRendering`、Tab 离屏销毁、MutationObserver 懒加载都曾破坏 TOC。**现已证明可行**：`virtualRendering` + `scrollNode` 指对真实滚动容器（`.ne-editor-wrap`）+ setDocument 后重放 `tocChange`，TOC 正常工作（打开时延迟 ~600ms 出现）；高亮/点击/列表跟随由自研 `setupTocScrollFollow` 补齐。
21. **overflow 修改影响 Lake 浮动 UI（已演进）**：`.multi-tab-editor`/`.tab-panels` 设 overflow 曾裁剪表格工具栏与 TOC 按钮。最终方案：**每标签独立滚动容器**——`.lake-editor-tab` 固定高度外壳（`overflow:hidden`）+ 高度链让 Lake 原生 `.ne-editor-wrap`（`height:100%; overflow-y:auto`）内部滚动；`.multi-tab-editor` 用 `height:100%`（确定高度）而非 `min-height`（否则内容撑高、内部滚动失效、外层裁剪）。
22. **`-webkit-app-region: drag` 原生层吃点击**：`pointer-events: none` 无效。`.tab-bar` 设 drag、`.tab-item` 设 no-drag。
23. **CSS 修改铁律**：改前先看样式层叠顺序（`scripts/css-audit/README.md`；改了声明量必须跑 `vitest src/styles/cssLayers.test.ts` 对基线，只允许变小或合法抬高并注明），别造第四套类名；绝不加 `content-visibility`/`contain` 到引擎层。（原 `lake-notes-tauri-poc` CSS 基准仓库已清理，历史 diff 走 git 历史。）
24. **Drawnix CSS 不能直接 import**：包的 exports 没导出 CSS。复制到 `src/vendor/` 从本地路径导入。
25. **DefaultEditorConfig 必须递归深合并**：一层合并丢嵌套配置（`deepMerge` 已实现）。
26. **scrollNode 必须指向真实滚动容器**（虚拟渲染/大纲定位前提）：本项目桌面多标签下是 `.ne-editor-wrap`（高度链修复后）；`body` 是 `overflow:hidden`，Lake 默认回退 `document.scrollingElement || document.body` 会拿错，导致视口测量/TOC 全乱。
27. **新建标签元素在编辑器创建时尚未布局**：`useEffect` 同步阶段 `clientHeight=0`，虚拟渲染初始视口按 0 算 → 首屏/大纲异常。`scrollNode` 函数里读一次 `offsetHeight` 可强制 reflow。
28. **TOC 侧边栏创建时用空 toc 渲染（Lake 行为）**：`ready` 事件早于 `tocChange` 时侧边栏永远不会被填充 → 打开文档大纲为 0，编辑后才出现。补丁：`refreshTocSidebar()`（`kernel.getDocExtraContent().toc` 取权威数据 + `kernel.emitPluginEvent("tocChange", data)` 走官方路径重放 + 重试）。
29. **TOC 条目是 `div.ne-toc-item`，不是 `<a>`**：探测/选择器用 `a` 会数出 0 造成误判。
30. **多标签共用滚动容器 → 滚动位置共享**：`.document-pane` 包所有标签时，A 标签滚到中部，切 B 也在中部。解法：每标签独立滚动容器。
31. **`npm run dev` 会启动两个 Electron**：`vite-plugin-electron` 默认自动拉起 Electron，脚本里再 `wait-on && electron .` 就是双实例 → 单实例锁冲突 + ERR_FAILED。已修：dev 只跑 vite（commit 3b7db20）。
32. **打包版卸载后 SingletonLock 残留**：`~/Library/Application Support/lake-notes-electron/SingletonLock|SingletonSocket|SingletonCookie` 残留会挡 dev 启动（"Failed to create SingletonLock: File exists"）。确认无进程后改名 `.stale-bak` 即可（沙箱禁 `rm -f`，用 mv）。
33. **埋点/日志坑**：`console.debug` 被 DevTools 默认过滤（改用 `console.log`）；HMR 不重建已创建的编辑器实例（测新埋点必须 Cmd+R 或重启）；`editor.on("tocChange")` 收不到内核事件（要走 `editor.kernel.onPluginEvent`）。
34. **docInitPerf 探针**：monitorLog 走内核 emitter，`editor.on("monitorLog")` 收不到（facade 不转发）；当前 `__lakePerfReport` 的 docInitPerf 采集是否生效取决于订阅路径，非功能问题。
55. **原生大纲点击把整个壳滚乱（260916）**：内核 TOC 点击除 `scrollByNodeId` 外还会 `location.hash = 标题节点id`（`toc.allowModifyHash` 内核默认 true）→ 浏览器锚点导航滚锚点的**整条祖先滚动链** → `html` 被滚满 42px（=topbar 高，html 未锁 overflow）→ 整壳上移、topbar 滚出视野、tab 栏顶到第一行、fixed 状态栏不动（观感即「点一下大纲布局全乱」）。双层修复：① `toc: { allowModifyHash: false }`（**扁平 schema**——`toc.editing/reading` 嵌套是 LakexEditor 组件层转换，直传 `Doc.createOpenEditor` 无效）；② `html,body { overflow: hidden }`（base.css，原来只锁 body）兜底一切内核误滚 html 的路径。详见 LAKEX-CONTRACT §5.1。
56. **首次打开「非内核写入」的文档会被内核重写（260917）**：外部脚本/自动化若**绕过应用**直接写库 + 写 `.lake`，并把图片写成**裸 `<img src="http://127.0.0.1:19876/<noteId>/<file>">`**，桌面内核打开时会把它判为**远程图片**去抓 → 主进程 SSRF 护栏拒（`[LAKE_IPC_CODE:INVALID_INPUT] 不允许下载本机或私网地址`）→ 内核回写**失败态卡片**（`"src":"","status":"error"`）→ 正文变化被当成用户编辑 → 1s 防抖保存 → `syncState: synced→local` → 随下次同步**上传**（把"图已失效"传播到其他端）。实测：`压测3-图片-神里凌华.png` 438B→1365B；全库 **287/511** 篇含裸 `<img>`。
    - **分界线是"容器"，不是"新旧形态"**：`<card type="inline" name="image" value="data:…">` → 内核认作**本地资产**（不下载、零重写；小记转换产物实测如此）；裸 `<img>` → 判为远程资源，必踩护栏。纯文本旧形态（`<p class="ne-p"><br></p>`、手写 `<h1>/<p>`）内核**原样保留**，无害。
    - 写入约定 / 反例 / 校验判据见 **`docs/LAKE-CONTENT-WRITING.md`**；仓库内 4 处手拼写入者已收口到 `src/core/lakeDocForm.ts`（含"绝不产出裸 `<img>`"的单测围栏）。
    - **排查提示**：直接打开这类文档 = 触发上面的重写（不可逆地把图降级）。要验证用 `node scripts/lake-roundtrip-check.mjs --note <id>`（**只动副本、原件不打开**；退出码 1 = 该文档一打开就会被改写）。
    - 判定"是否被重写"的口径：`.lake` 的 **mtime 不变** + 标签无脏点 + 无新增历史快照 + 正文里 `status%22%3A%22error%22` 为 0。

57. **壳层底部一条很窄的灰缝（260917）**：文档页最底露出约 4px 的 `.app-shell` 灰底（`rgb(235,236,240)`）。根因 = `src/styles/app/shell.css` 的 `.workspace { margin: calc(var(--topbar-height) + 4px) 0 4px 0 }` 底部那个 `4px`：`.app-shell` 是单行网格（852px），工作区被底部 margin 收到 848 → 最底 4px 露灰。**这是"同一几何只修了一处视图"的漂移**：小记视图早已单独覆盖 `margin: … 0 0` 去掉这 4px（注释："让工作面直接贴到窗口底"），基础 `.workspace` 漏改。修法 = 基础层底部改 `0`（顶部那 4px 是固定 `.tab-bar` 的拼接缝，保留）+ 收掉小记里已**逐字等价**的 margin 覆盖。**不要**用"给 `.app-shell` 加白底/加高度"这类叠层补丁绕开——根在 `margin`。实测：底部 dy=1..4 命中从 `.app-shell`（灰）变为白色 `.ne-editor`（bottom=852）；文档/小记两视图都齐底。
58. **审计装置会随 UI 批次漂移（260917）**：`scripts/css-audit/css-audit.mjs` 的 `nav.search` 一直在左上角下拉里找"全文搜索"菜单项，而 260917 该入口已搬到文档页右上角 → 跑 `ab2` 全矩阵时 `search-empty` 状态**在装置准备阶段直接抛 `no 全文搜索`**（崩的是状态准备、不是比对结果，容易误读成"清理导致回归"）。修法 = 按 `title/aria` 找右上角搜索按钮。**两个连带坑**：① 跑审计装置前先确认它跟得上最近的 UI 搬位；② `ab2` 的 `only` 过滤是**状态全名精确匹配**（传 `search-empty` 匹配不到 `search-empty:1315:light`，会被**静默跳过**）。另外 `ab2 plan` 模式**测不了 `app/*.css`**（被 Vite 内联进 `src/styles.css` 那张表）——必须用 `SPEC` 注入整份内联内容，否则给假 PASS（见 `scripts/css-audit/README.md` §七）。

59. **浏览器端 = 本机附属窗口，不是伺服（260917）**：`electron/webApiServer.ts` 起的 HTTP 服务（默认端口 19880）把桌面渲染层交给**本机**浏览器：`POST /api/<channel>` 复用同一批 IPC handler、静态服务 `dist/`、`/__native.js` 注入 `window.lakeNative` 的 HTTP shim；**只绑 127.0.0.1**。用户 260917 明确**不做伺服**（不监听局域网、不对外开放）。开关在「设置 → 浏览器端」：**不落盘**（内存态，每次启动默认关闭）、**打开/关闭即时起停、无需重启**（`createWebServerController`）。「打开浏览器」按钮走 IPC `open_web_client` → 主进程 `shell.openExternal(url)`；**URL 由主进程按固定端口构造、渲染层不传 URL**（防开放重定向）。已知缺口（本批未做）：推送缺失（shim 里 `onSyncProgress`/`onPendingSummaryChanged` 是 no-op）、`dialog`/`shell`/`clipboard` 类通道在浏览器里语义错（会操作桌面机）、`/api/*` 只校验 `x-lake-token`（复用 assetToken、不校验 Origin）、`/__native.js` 不校验 token。
60. **改 `electron/preload.cjs` 在 dev 不会热重启（260917）**：vite-plugin-electron 只 watch 入口 `electron/main.ts`，而 dev 下 preload 是**直接读源文件** `../electron/preload.cjs`（不是 `dist-electron/` 里的构建产物）。改完 preload 必须**手动重启 Electron**（或 `touch electron/main.ts` 触发重建）才生效；否则渲染层还是旧方法，症状是 `window.lakeNative.xxx is not a function`。

## E. 环境与工具

35. **杀进程误杀 Trae CN**：永远用 `grep "lake-notes-electron"` 精确匹配，禁 `pkill -f Electron`。
36. **npm 私有镜像不可达**：显式用 `registry.npmmirror.com` + 独立 cache 目录。
37. **better-sqlite3 ABI**：装完必须 `@electron/rebuild`（Node ABI ≠ Electron ABI）。
38. **React StrictMode**：useEffect 双执行，setOpenTabs 需去重（`tabs.some(...)`）。
39. **Tauri 自定义协议闪退**：当初不做资源归一化的原因；Electron 无此问题，用 HTTP 方案。

## F. S3 / 七牛

40. **七牛报 `UnknownError` = Bucket 名不存在**（404 的字面 message）。先 `ListBuckets` 确认真实空间名，再排查网络。
41. **Endpoint 必须是区域级地址**：bucket 专用虚拟主机地址（`local-lake-hebei.s3.cn-north-1.qiniucs.com`）+ path-style 会 404，不勾 path-style 会拼出双 bucket 域名导致 TLS 失败。用 `https://s3.cn-north-1.qiniucs.com` + path-style。
42. **Region 填 `cn-north-1`**，不是空间名。
43. **单实例锁（audit 新增）**：dev 与打包版共用 userData/SingletonLock，不能同时运行；开发前先退出打包版。
44. **S3 配置校验**：`s3Store.ts` / `syncUtils.ts` 的配置校验要求 endpoint/bucket/accessKeyId/secretAccessKey 非空（trim），否则抛「Endpoint、Bucket 和访问密钥均不能为空」；`testConnection`/`syncNow` 未保存配置时抛「请先保存 S3 配置」。

## G. 虚拟渲染 / 调试（2026-08-02 会话新增）

45. **Lake TOC watcher 二分探测失效**：`TWe._checkIndex` 用二分 `querySelector('[id=...]')` 探测标题，虚拟渲染下视口外标题无 DOM → 探测 null → 立即返回 -1 → 永远不选中。**不要试图修 watcher，用自研跟随覆盖（`setupTocScrollFollow`）**。
46. **Lake TOC 列表跟随挂在 watcher 的 `_reset` 上**：`GY._makeVisible`（选中项超出可视带 ±10px 时把 `.ne-toc-view-inner` 滚动到居中）只由 watcher change 触发；绕过高亮后必须自己在 `apply()` 里复刻（10px 容忍带 + `scrollTop += r.top - (vp.top + vp.height/2)`）。
47. **表格卡片 `_rootNode` 是 `ne-table-wrap` 不是 `ne-table-hole`**：卡片工具栏 overlay 的 mouseenter/mouseleave 监听绑在 `_rootNode`（表格为 `ne-table-wrap`，hole 的**子孙**）上；补发合成事件必须命中 `_rootNode`，只发到 hole 无效。
48. **表格工具栏 hover 消失机制**：overlay 的 `hovered` 状态只由卡片根节点的 mouseenter/mouseleave 驱动，工具栏渲染在卡片外（上方），鼠标一移过去就触发 mouseleave → 300ms lazyCancel 隐藏。解法：`mouseleave` 不冒泡但有**捕获阶段**，document 捕获层先于目标监听器；目标为卡片且 relatedTarget 在工具栏上下文（`.ne-card-toolbar` / `.ne-ui-boundary-popover` / `ne-overlay-tmp` / `[data-event-boundary=overlay]`）时 `stopImmediatePropagation`；离开工具栏时补发合成 mouseleave（untrusted 放行）触发正常隐藏。
49. **卡片水合与 `$appear`**：cardLazyInit 下新插入的卡片可能永远停在空壳——Lake 可见性观察器作用在 hole 节点，`hole.$appear` 不传播到卡片 UI；直接调 `卡片._neRef._virtualNode.$appear()` 可立即水合（`ensureCardsInViewHydrated`）。
50. **双 ABI 测试基建（已废弃）**：Electron ABI 的 better-sqlite3 在纯 Node 报 `NODE_MODULE_VERSION 1`；旧方案用 `test-node-abi/` 单独装 Node 构建 + vitest `resolve.alias`。**better-sqlite3 13.x 起为 N-API 单二进制，Node/Electron 通用，已无需此基建**。`electron/store.ts` 模块加载即 import `electron`，测试仍需 `vi.mock("electron")`。
51. **grep .lake 内容坑**：.lake 是 HTML+URL 编码文本，空格等字符被编码（`const real` → `const%20real%20%3D%201`），直接 grep 原串会漏匹配。排查用编码后的模式或解码后再查。
52. **Playwright 驱动 Electron 调试**：合成 `dispatchEvent` 不触发真实焦点（真实点击用 `page.mouse.click`）；node_repl 沙箱禁 `process`；electron 主进程 `isDev = !app.isPackaged` 会去连 1421 dev server——用静态服务器 serve `dist/` 即可跑生产渲染层。
53. **虚拟渲染滚动补偿**：滚动后 `wrap.scrollTop` 会因内容高度变化被 Lake 调整（scroll 补偿），定位表格/元素要用**实时** `getBoundingClientRect`，不要缓存旧坐标。
54. **e2e 测试残留**：测试里 `createNote` 被调两次会残留笔记/资源目录；每次测试后要验证清理（`listOrphanAssets` + 笔记文件数）。

## H. 2026-08-03 代码审计修复踩坑

- **Chromium `net.fetch` 的 `redirect:"manual"` 直接抛 "Redirect was cancelled"**：Electron 的
  `net.fetch`（Chromium 网络栈）不支持手动重定向模式。要逐跳校验必须改用 **`net.request` +
  `followRedirect:false`**（`redirect` 事件给目标 URL，`req.abort()` 后对新 URL 重新发请求）。
- **`net.request` 的 Referer 必须每跳用"当前 URL 自身"**：固定用原始 URL 作 Referer 会被部分 CDN
  （如 Google）客户端级拦截（`net::ERR_BLOCKED_BY_CLIENT`），自引用 Referer 则放行
  （对齐 Rust 版"Referer=图片自身"防盗链策略）。
- **DNS 感知 SSRF 校验**：`isBlockedHost` 只拦字面 IP；域名要 `dns.promises.lookup(host, {all:true,
  verbatim:true})` 逐地址校验（localtest.me→127.0.0.1/::1 一测就中）。解析失败宁可拒绝。
- **渲染层回退是安全黑洞**：主进程 SSRF 拒绝后渲染进程再 fetch 会把策略彻底绕开——安全错误
  （InvalidInput/SSRF）绝不回退；Electron 下唯一下载路径是主进程。
- **vitest `mockRestore()` 后重新 `mockResolvedValue` 不生效**：spy 恢复原实现后 re-mock 会被忽略
  （实测仍走真实 DNS）。每用例独立 spy 或用 `mockImplementation`。
- **store.ts 大批量 Python 替换要小心索引边界**：用 `s.index("  }\\n\\n  uploadResource(")` 找方法结尾
  会命中前一个方法的结尾导致整段错位。改大文件优先 `git checkout` 恢复后重放补丁，或逐段验证。

## I. 2026-08-03 中文斜体失效（font-synthesis）

- **现象**：编辑器里斜体（Cmd+I / 工具栏 / em 标签）对中文不生效，英文正常。
- **根因**：`styles.css` 的 `:root { font-synthesis: none }` 禁止浏览器合成缺失的字体样式。
  中文字体（PingFang SC / Microsoft YaHei 等）没有 italic 变体，`none` 会禁止合成斜体 →
  中文 `font-style: italic` 完全不倾斜；英文有斜体变体所以正常。
- **修复**：`font-synthesis: style weight`（允许合成斜体 + 粗体）。
- **验证**：同一行中文 normal vs italic 截图像素差异率 92.2%（合成斜体生效）。
- **Lake 侧确认**：Lake 斜体用 `ne-text[ne-italic="true"]` 标记（不是 em/i），
  CSS 有 `[ne-italic] { font-style: italic }`；`i`/`em` 标签会被 Lake 解析为 ne-italic。

## J. 2026-09-20 画板（Drawnix/Plait）带图片导出静默失败：CSP 拦掉 `fetch(data:)`

- **现象**：画板里有图片时点「导出 → 导出 PNG / 导出 SVG」没反应，控制台一串
  `Connecting to 'data:image/png;base64,…' violates the following Content Security Policy directive` +
  `Fetch API cannot load data:image/…`（3 张图 = 9 条）。
- **根因**：plait 的导出/预览路径 `convertImageToBase64(url)`（`@plait/core` 的 `cloneImageNodes`）是
  `fetch(url)` → `blob()` → `FileReader`；而我们的 `connect-src` 只放行 `'self' http://127.0.0.1:*`
  （`img-src`/`font-src`/`media-src` 才放行 `data:`）⇒ **data URL 也被 CSP 拦**。
  改造前画板图片本来就是 data URL，所以这是**既有缺陷**，不是画板资产化引入的。
- **修复**：`vite.config.ts` 的 DEV_CSP/PROD_CSP 与 `vite.mobile.config.ts` 的 MOBILE_CSP
  在 `connect-src` 加 `data:`（data: 无网络来源 ⇒ 不构成外发通道）。改后导出 SVG/PNG 各 0 报错。
- **相关**：同一路径若拿**跨源**资产 URL（`http://127.0.0.1:19876/…`）去 fetch，会被资产服务的
  CORS 规则拦掉（`Access to fetch … blocked`）⇒ 独立画板文档因此采用「**写盘 = 资产 URL / 内存 = data URL**」
  的口径（见 `docs/STORAGE-LAYERS.md` §九）。

## K. 2026-10-08 表格（FortuneSheet）暗色模式

- **canvas 才是主角**：单元格区、行列头、网格线由**同一个 `<canvas>`** 画（`.fortune-container` 的 CSS
  白底会被 `drawMain` 的白色 fillRect 完全盖住）⇒ 只改 CSS 只能得到「暗壳 + 白格」，要真暗必须让 canvas 读主题。
- **颜色来源（`@fortune-sheet/core/dist/index.js`）**：
  · 整格区底 `drawMain` 的 `fillStyle="#ffffff"`；空/非空格底 `nullCellRender`/`cellRender` 的 `"#FFFFFF"`；
  · 网格线/表头分隔线 `defaultStyle.strokeStyle`（`#dfdfdf`）；表头底 `#ffffff`、表头字 `#000000`（写死）；
  · 默认字色 = `normalizedCellAttr(cell,"fc")` 在没有 fc 时回落 `#000000`（**不是** `defaultStyle.fillStyle`）。
- **接法（本仓库）**：`patches/@fortune-sheet+core+1.0.4.patch` 把上述常量改成读 `defaultStyle.{cellBgStyle,
  headerBgStyle,fillStyle,strokeStyle}`，并新增 `syncLakeSheetCanvasTheme()` 从 `--lake-bg-canvas`/`--lake-bg-subtle`/
  `--lake-text-1`/`--lake-border-1` 读取，调用点挂在 `updateContextWithCanvas`（挂载 / window.resize）。
  **展示层，不写正文 / S3 / 历史 / 撤销栈**（正文文件哈希实测不变）。
- **图标是 shadow 树，文档 CSS 打不到**：工具栏/菜单图标是 `<svg><use href="#id">` → `SVGDefines` 里的 `<symbol>`；
  `fill`/`stroke` 写在 symbol 子元素上，外部 CSS 的 `fill: …` **无效**，只能把补丁里这些色值改成 `currentColor`
  （`patches/@fortune-sheet+react+1.0.4.patch`），再由 `.fortune-toolbar-button { color: var(--lake-text-2) }` 驱动。
- **重绘靠 `window.resize`**：FortuneSheet 没有 ResizeObserver，只在 `window.resize` 重算容器并重绘 ⇒ 主题切换
  要补发一次 resize（`SheetEditor` 里观察 `data-theme`）。⚠️ **不能用 rAF 派发**：隐藏窗口（CDP 依附）里
  `document.hidden === true` 时 rAF 不触发，会漏同步（表现＝主题已切、canvas 仍是白格）；用 `setTimeout`/直接派发。
- **外壳仍要走令牌**：工具栏/工作表标签/浮层/选区/输入框在 `src/features/sheet/sheetEditor.css` 映射到 `--lake-*`
  （三方组件是「自有设计系统」的唯一例外，几何沿用内核）；内核输入框额外显式给面板底，别依赖 UA 的 `color-scheme`。

## L. 2026-10-08 文档分屏（左右两栏）

- **身份模型**：标签唯一键是 `noteId`（没有实例 id），保存定时器 / 保存状态 / revision / 正文捕获 / 滚动记忆 / 大纲注册全按 `noteId`。
  ⇒ **同一文档不能开两次**（两个实例会互相覆盖，且是"静默丢输入"红线）；分屏只做**不同文档**。若将来要同文档多开，
  必须先把这套身份拆成 `instanceId` 并定义并发保存语义，别只改 UI。
- **`data-active` 仍必须全局唯一**（`activeEditor.ts` 只认它，浮栏/AI/滚动归零都按它找「当前编辑器」）。分屏的"显示"另走
  新增的 `data-pane-visible`：隐藏判据仍是 `tabs.css` 的 `:not([data-active]):not([data-pane-visible])` 单一来源，别在别处再写隐藏。
- **每栏顶部被编辑器自己的工具条占满**（文档 `.ne-ui-toolbar`、表格 `.fortune-toolbar`、多维表同理），最右还常有「更多」。
  分屏控件若放在栏的 `top: 8px` 会盖住它 ⇒ 下移一个 `--editor-toolbar-height`（见 `features/editor/splitView.css`），
  并用 `--lake-z-editor-sticky` 抬到内容之上。
- **分隔条只有一处实现**：`src/components/ui/SplitHandle.tsx`（`SplitPane` 与分屏共用）。⚠️ 拖拽**不要只依赖 `setPointerCapture`**：
  合成鼠标/无活动指针时它会抛错并中止拖拽 ⇒ 用 try/catch 包住，并在 window 上监听 `pointermove/pointerup`。
- **面包屑必须归属「文档宿主」，不能是 pane 级全局一条**（用户 261008 定稿）：原先它是 `MultiTabEditor` 里按 `activeNoteId` 渲染的**一条**（`headingPath`/`navigateToHeading` 都只取活动文档的大纲）⇒ 分屏时①不随栏宽收缩（整块文档区宽度）、②只在「焦点标签是 doc」时出现、③换栏/点编辑区会闪烁。正解 = 移进 `EditorTab`，用**本文档自己的**大纲句柄自算/自导航；`useEditorTopVar` 的候选也必须只从 `activeEditorHost()` 内取（分屏有两条面包屑，否则会被叠起来量错 `--lake-editor-top`）。⚠️ 宿主改 flex 纵向两段后必须给 `.lake-editor-main` `flex:1; min-height:0`，否则内部百分比高度链断掉、编辑器塌高。
- **CDP 验收陷阱**：`Input.dispatchMouseEvent` 注入的 `mouseMoved` **不会**产生 `pointermove`（`pointerdown` 会）。
  验拖拽要用合成的 `PointerEvent`（在元素上 dispatch pointerdown、在 window 上 pointermove/pointerup），否则会误判成"拖不动"。
  另外：**后台/被遮挡的 Electron 窗口会整批丢弃 CDP 注入的鼠标事件**（事件日志全空）⇒ 真实鼠标链路只能在可见/前台实例上验，或改用合成事件。
- **portal 浮层的 outside-dismiss 必须把浮层表面也算「里面」**：`Menu`（Overlay）是 portal 到 `body` 的；若只在锚点容器（如 `[data-split-menu]`）里判断，
  真实鼠标落在**菜单项**上的 `pointerdown` 会先触发 dismiss → 菜单卸载 → 随后的 `click` 落空（现象＝「点菜单项没反应」，用户 261008 报「点分屏没效果」）。
  接法：把 `surfaceRef` 同时写进自己的 `menuRef`，判断 `target.closest(锚点容器) || menuRef.current.contains(target)`。分屏入口与右栏菜单各修一处。
