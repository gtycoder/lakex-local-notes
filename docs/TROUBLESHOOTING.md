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
- **切换标签时内核工具条空 1~4 帧（261008 排查）**：非活动宿主靠 `visibility: hidden` 隐藏 ⇒ 浏览器丢弃其绘制图层，切回来整棵子树重栅格化，内核工具条（`.ne-ui`）最后画完。**别误判成 CSS 淡入或状态错位**：实测切换瞬间 `.ne-ui` 已 `opacity:1/visibility:visible/transition-duration:0s`，且 rAF 逐帧显示标签高亮与可见宿主同帧、布局不跳。给宿主加 `will-change: opacity` **无效**（`visibility` 照样丢层）；机制级解法 = 不丢层（`opacity:0` + `inert`），代价是非活动编辑器保持绘制。
- **面包屑必须归属「文档宿主」，不能是 pane 级全局一条**（用户 261008 定稿）：原先它是 `MultiTabEditor` 里按 `activeNoteId` 渲染的**一条**（`headingPath`/`navigateToHeading` 都只取活动文档的大纲）⇒ 分屏时①不随栏宽收缩（整块文档区宽度）、②只在「焦点标签是 doc」时出现、③换栏/点编辑区会闪烁。正解 = 移进 `EditorTab`，用**本文档自己的**大纲句柄自算/自导航；`useEditorTopVar` 的候选也必须只从 `activeEditorHost()` 内取（分屏有两条面包屑，否则会被叠起来量错 `--lake-editor-top`）。⚠️ 宿主改 flex 纵向两段后必须给 `.lake-editor-main` `flex:1; min-height:0`，否则内部百分比高度链断掉、编辑器塌高。
- **CDP 验收陷阱**：`Input.dispatchMouseEvent` 注入的 `mouseMoved` **不会**产生 `pointermove`（`pointerdown` 会）。
  验拖拽要用合成的 `PointerEvent`（在元素上 dispatch pointerdown、在 window 上 pointermove/pointerup），否则会误判成"拖不动"。
  另外：**后台/被遮挡的 Electron 窗口会整批丢弃 CDP 注入的鼠标事件**（事件日志全空）⇒ 真实鼠标链路只能在可见/前台实例上验，或改用合成事件。
- **portal 浮层的 outside-dismiss 必须把浮层表面也算「里面」**：`Menu`（Overlay）是 portal 到 `body` 的；若只在锚点容器（如 `[data-split-menu]`）里判断，
  真实鼠标落在**菜单项**上的 `pointerdown` 会先触发 dismiss → 菜单卸载 → 随后的 `click` 落空（现象＝「点菜单项没反应」，用户 261008 报「点分屏没效果」）。
  接法：把 `surfaceRef` 同时写进自己的 `menuRef`，判断 `target.closest(锚点容器) || menuRef.current.contains(target)`。分屏入口与右栏菜单各修一处。

## M. 2026-10-08 表格图标改成云端 lakex 图标（iconfont 字形）+ 补丁重建

- **图标是内联 `<symbol>` 雪碧图，不是图标字体、也不是独立 SVG 文件**（语雀云端是后者：`background-image: url(....svg)` +
  `::before`）。内核用 `React.createElement("symbol", {...}, …)` 定义、`<use xlinkHref="#bold">` 引用 ⇒ **换形状只能改 symbol 的 path**。
  一律走 `scripts/sheet-icons.mjs` + `scripts/sheet-icons.cloud.json`（幂等，`--check` 干跑不落盘），**不要手改 bundle**。
- **图标从哪来**（用户 261008 定稿：**用云端 lakex 表格的图标**；`lucide` 那版被否：「很丑而且不直观」）：
  ① **云端工具栏/菜单是阿里 iconfont `lake-icon`**（`@font-face` 指 `at.alicdn.com/.../font_943843_*.ttf`，
  CSS 里 `.lake-icon-<name>:before { content: "\ea46" }`）⇒ 下载 ttf，用 fontTools 的 `SVGPathPen` 抽字形，
  **em 盒（unitsPerEm=1024）映射到 24 并翻转 Y**（`Transform(24/1024, 0, 0, -24/1024, 0, 24)`），TrueType 用非零环绕
  ⇒ 存成 `{"d": ...}` + `fill="currentColor"`。
  ② **云端没字形的**：文字颜色 / 背景色是**内联 SVG**（256 viewBox，与内核 `icon-editor-color` / `icon-editor-cellBgColor` 同一张图），
  边框族是 `.lake-sheet-svg-icon-border-*` 的 **svg 资源**（`gw.alipayobjects.com/zos/...`）⇒ `scale(24/256)` 后内联。
  ⚠️ 这两类**必须保留 `<g transform>` 嵌套**（扁平化成兄弟节点会丢掉 `translate`，图形整体移位）；填充色除产品自带的色条红
  （`#F5222D`）一律换成 `currentColor`。
  ③ **两边都没有的保持内核原样**（26 个：`border-horizontal` / `border_diagonal_*` / `border-vertical` / `border-slash` /
  `comment` / `merge-horizontal` / `merge-vertical` / `minus` / `fx` / `percentage-format` / `text-rotation-*`（6）/
  `screenshot` / `splitColumn` / `locationCondition` / `dataVerification` / `eraser` / `filter-fill` / `filter-fill-white` /
  `tab` / `default`）。覆盖 76/102。
  ⚠️ **下拉箭头**：云端是「右向 chevron + CSS `rotate(90deg)`」⇒ 抽的时候要把旋转**烘进 transform**（否则方向是横的）。
- ⚠️ **别按名字想当然挑字形**（261008 现场返工一次）：对齐族该用字体的 **`left` / `center` / `right` / `top` / `middle` / `bottom` / `justify`**
  （≡ 与箭头样式，= 云端工具栏 `lake-icon-left` / `-middle` 那一支）；按名字直译去挑 `align-left` / `align-h-center` / `align-v-center`
  会拿到「框 + 竖条」的另一套（看着也像对齐，但外层按钮与下拉项全错）。**逐个渲染出来对照截图再定映射**。
- ⚠️ **下拉项里图标与文案的先后顺序**：云端是「**图标在前、文案在后**」且左对齐；内核默认 `.fortune-toolbar-menu-line`
  是 `justify-content: space-between`（文案顶左、图标甩最右）⇒ 用一行 CSS 在 `.fortune-toolbar-combo-popup` 内
  `flex-direction: row-reverse; justify-content: flex-end` 改排布（不动 DOM）。
- ⚠️ **ESM 与 CJS 的 callee 不同**：`dist/index.esm.js` 是 `React.createElement`，`dist/index.js` 是
  `React__default['default'].createElement`。生成器必须**先识别 callee 前缀再替换**；写死 `React.` 会产出
  `React.React.createElement`（`React.React` 为 undefined）⇒ 表格整块渲染崩，被 `SheetEditorErrorBoundary` 接住成
  「该类型编辑器渲染出错」。症状是**只有表格挂着、其它编辑器正常**。
- ⚠️ **`npm install --ignore-scripts` 会把包还原成"只有原始包"**（其它 hunk 全失效）。在那之后重建补丁 = 把别人的本地改动
  一起抹掉——本轮踩过一次，靠 `sheetEditorMount.test.ts`（断言补丁里含 `context.allowEdit === false ? false` /
  `_lakeUseInternal`）才抓出来。要动某个包的 node_modules：**先 `git checkout -- patches/<该包>.patch` 恢复补丁**，
  再移走目录、`npm install`（**不带** `--ignore-scripts`）让它重新打上，然后才做改动。
- **重建流程**（改完 node_modules 之后）：
  ```bash
  node scripts/sheet-icons.mjs                                                  # 幂等；加 --check 只报告
  PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" npx patch-package @fortune-sheet/react
  ```
  重建会**重排 hunk**，可能多出「纯空格上下文行」（行内容只有一个空格）⇒ `git diff --check` 报尾随空格。
  把这些行转成真空行即可（实测 `patch-package` 仍能从头应用；`patches/@plait+draw+0.93.4.patch` 本来就有这种写法）。
- **必须做"全新安装"复验**，别只看本机现在能跑：`mv node_modules/@fortune-sheet/react <备份>` → `npm install` →
  确认日志里 `@fortune-sheet/react@1.0.4 ✔`，再 `rg -c "strokeWidth|_LAKE_MENU_ICONS|_lakeUseInternal" node_modules/@fortune-sheet/react/dist/index.esm.js`。
- **右键菜单图标位**：内核 `Menu` 只渲染文案 ⇒ 补丁注入 `_LAKE_MENU_ICONS`（key→symbol）与 `_lakeMenuIcon` 装饰器
  （在容器两处 `map` 外包一层，用 `cloneElement` 把 `key` 变成 `menuKey` 传给 `Menu`），`Menu` 再渲染「图标 + 文案」。
  图标落进菜单项本来就留着的 30px 左内边距（原来是空的勾选位），**不动内边距与条目顺序**。

## N. 2026-10-08 表格「自动换行」不撑开行高

- **内核只做一条路**：`@fortune-sheet/core` 的自适应写在 `updateCell`（**单格编辑提交**）里，而且前置条件是
  「`config.columnlen[c]` 与 `config.rowlen[r]` **都没设过**」——列宽被手动调过、或行高被设过，就**永久跳过**（源码里那句
  `if (!(cfg.columnlen?.[c] && cfg.rowlen?.[r]))`）。它用的度量是内核的 `getCellTextInfo`（canvas 精确换行）。
- **三条路根本不触发**：粘贴（批量写入）、改列宽、打开已有文档。实测：粘贴 2×5 数据后 `rowlen` 只保留旧值，新行没有条目。
- **我们的补法**：`SheetEditor.syncAutoRowHeights(rows?)`（**只涨不缩**、只算自动换行的单元格、按整行取最大值），
  触发点 = ① `afterUpdateCell`（单格）② `onOp` → `scheduleAutoRowHeights()`（节流 160ms；粘贴后内核把选区设成落盘范围，
  正好用来定位行）③ 首次可见时 `rowsWithCells()` 补一遍（吃老文档）。自己算是因为 `getCellTextInfo` 要内核内部 ctx，
  公开 API 拿不到；口径按 `fontSize × 96/72` 与 `defaultRowHeight(19)` 对齐。
- ⚠️ **粘贴进来的单元格没有 `tb`**：我们的默认 WRAP 是在 `withCellDefaults` 里对**已有内容**补的，内核批量写入不经过它
  ⇒ 行高判定必须把 **缺省 tb 当 WRAP**，只跳过显式 `0` / `1`（截断 / 溢出）。漏了这条 = 粘贴的行永远不参与自适应。
- **更根上的那条：内核默认 `tb` 是 `"0"`（截断）**。`normalizedCellAttr` 里那句 `attr === "tb" || attr === "tr"` 把两者
  的缺省都设成 `"0"` —— 与本产品默认（自动换行）相反 ⇒ 粘贴进来的单元格**渲染上也不换行**（不只是行高的事）。
  已在 `patches/@fortune-sheet+core+1.0.4.patch` 拆开：`tb` 缺省 `"2"`、`tr` 仍 `"0"`（`tr` 是文字旋转，别一起改）。
  **别把 `tb` 缺省改回 `"0"`**：改回去 = 粘贴不换行 + 内核自适应认不到（`curv.tb === "2"` 判据）。
- **右键「自动行高」**：内核右键菜单对**未知 key** 会兜底到 `settings.customToolbarItems`（`getMenuElement` 末尾那段）
  ⇒ 加一个 `{key, tooltip, icon, onClick}` 就能进菜单；**只要不把这个 key 列进 `TOOLBAR_ITEMS`，它就不会出现在工具栏**。
  ⚠️ **已知余量**：点完「自动行高」后，该行在内核里的 `config.customHeight[r]` **仍留着**（内核没有清这个标记的公开 API：
  `setRowHeight(info, options, custom=false)` 只写 `rowlen`、不删 `customHeight`）⇒ 之后**只涨不缩**的那些自动触发
  （单格提交 / 批量 op）仍会跳过这一行，直到下次列宽变化（整表 refit）或再点一次「自动行高」。实测（261008 隔离实例）：
  手动把第 1 行设成 300px（`rowlen[0]=300, customHeight={"0":1}`）→ 点「自动行高」→ `rowlen[0]=117`（=长 URL 换行后的高度），
  `customHeight` 仍为 `{"0":1}`。要彻底"恢复自动"得往 config 里删这个键，属独立小项，**别顺手改内核**。
- **列宽变化要整表重算**（用户 261008：「需要全都算」）：拖列宽时内核**可能只落一次 op、甚至不落**（mouseup 直接改 config），
 所以判据用「`config.columnlen` 快照变了」而不是 op 类型；命中就按 `rowsWithCells()` 整表重算（节流 160ms）。
- ⚠️ **第一遍 Cmd+V 整块丢（用户 261008 报「要按两次才生效 / 闪烁了一下没有内容」）= 内核单例 `selectionCache` × 多实例挂载**
  （261008 结案，**不是**「两段式协议太脆」）：
  · 粘贴协议：**keydown** 里 `handleWithCtrlOrMetaKey` 把 `selectionCache.isPasteAction = true`，**paste 事件**里 `handlePaste`
    消费它并复位。`selectionCache` 在 `@fortune-sheet/core` 里是**模块级单例**（`var selectionCache = {…}`，被所有 Workbook 共用）。
  · 而 react 侧 `onPaste` 是**每份挂载的 Workbook 各挂一次**的 `document` 监听，判据只看 `document.activeElement.className
    === "fortune-sheet-overlay"`。本应用**多标签常驻挂载**（隐藏标签页里的表格实例仍在 DOM 里，`getBoundingClientRect` 非 0）⇒
    隐藏那份**也满足判据**，于是**先注册的那份抢先把标志消费掉、把剪贴板内容写进自己的表**；活动表格这一遍
    `isPasteAction` 已是 false ⇒ `handlePaste` 空转，但 react 侧的**插行是另一条 state 更新、不看这个标志**，所以行被撑开到
    300 而内容为空 —— 正是用户描述的「闪烁了一下没有内容」。第二遍为什么好？第一遍后隐藏实例的 data 变了 → 它的
    `onPaste` 依赖（`[context, setContextWithProduce]`）变化 → `useEffect` 重挂监听 → 它排到最后，轮到活动表格消费。
  · **修法（只在 react 补丁里，core 保持内核原样）**：判据限定在**本实例容器内** ——
    `… className === "fortune-sheet-overlay" && workbookContainer.current?.contains(document.activeElement)`。
    ⚠️ **不要再回到「在 core 里放宽判据」那条路**（曾试过 `if (selectionCache.isPasteAction || e.clipboardData || window.clipboardData)`）：
    那会让**每一份挂载的实例**各自粘贴一遍（隐藏表格也被写入）。护栏见 `sheetEditorMount.test.ts`。
  · **复现/验收姿势（隔离实例实测，300 行 HTML 表格 → 空表 = 需要插 250 行）**：① 剪贴板要带 **`text/html` 的 `<table>`**
    （`pbpaste` 只有纯文本时 `trs=0`、不触发插行分支 ⇒ 测不到；macOS 可用
    `osascript -e 'set the clipboard to (read (POSIX file "x.html") as «class HTML»)'`）；② **必须开两份表格实例**（两个表格标签页，
    隐藏那份才是元凶；单实例永远不复现）；③ 焦点落在目标表的 overlay（CDP 里先 `Input.dispatchMouseEvent` 点网格，再
    `document.querySelector('.sheet-editor[data-active="true"] .fortune-sheet-overlay').focus()`，否则 `onPaste` 判据不成立）；
    ④ `Input.dispatchKeyEvent({modifiers:4, commands:["Paste"]})`；⑤ 落盘**有几秒延迟**（`…/workspace-default/sheets/<noteId>.sheet.json`
    会晚于界面出现）。修前：活动表 `row=300 / celldata=0`（丢），隐藏表 `celldata=1500`（被写入）；修后：活动表
    `row=300 / rowlen=300 / celldata=1500`，隐藏表 `celldata=0`。
  · **别顺手把「插行」挪进同一次 `setContextWithProduce`**：261008 试过并撤回了 —— 单实例路径下上游那两次 state 更新本来
    就按序 flush（只按一次 Cmd+V 就能落 300 行），合并**不解决**这个问题，只是多一处与上游的偏离。
- **没虚拟化 ⇒ 行数多就重**：280×5 粘贴实测 JS 工作量 ~350ms、无 long task（Profile 采样），但**高行会让画布重绘变重**；
  要追大表滚动性能属于「表格行虚拟化」立项（同 §3#11 的多维表那条），不在小修范围。
- **验收姿势**：把带长 URL 的表格 `pbcopy` → 应用里选一个空行 → CDP
  `Input.dispatchKeyEvent({modifiers:4, commands:["Paste"]})`（macOS 的 Cmd+V）→ 读
  `<userData>/workspace-default/sheets/<noteId>.sheet.json` 的 `config.rowlen` 是否新增该行。**注意**
  `Input.insertText` 不会触发内核的输入处理（DOM 里有字、模型是空的），要用逐字符 keyDown+text 或真 Cmd+V。

## O. 2026-10-08 表格字体不是 MiSans（用户 261008）

- **现象**：表格（单元格文字、工具栏、右键菜单、工作表标签）看着不是产品字体 MiSans。**属实**，且有两个不同来源：

- **① 单元格文字（canvas）**：字体取每格 `ff`，而 `@fortune-sheet/core` 的 `getFontSet` 会把 **`ff` 字符串去掉引号后
  整体当成"一个"族名**（源码：`fontfamily.replace(/"/g,"")` → 若有空格再包一层引号）。实测（node 直调 `core.getFontSet`）：
  ```
  ff = 'BlinkMacSystemFont, "Segoe UI", "PingFang SC", …'   // 我们 261008 之前写进正文的旧值
  →  normal normal normal 10pt "BlinkMacSystemFont, Segoe UI, PingFang SC, …","Helvetica Neue", Helvetica, Arial, "PingFang SC", …
  ff = "MiSans"
  →  normal normal normal 10pt MiSans,"Helvetica Neue", Helvetica, Arial, "PingFang SC", …
  ```
  即：**多族串整体变成一个不存在的族名 ⇒ 实际渲染落到内核自带的 `Helvetica Neue`（拉丁）/ `PingFang SC`（中文）回退栈**；
  单族名不会被加引号，后面的内核回退栈照常兜底（生僻字/emoji）。⇒ 我们的口径 = `GLOBAL_FONT = "MiSans"`（**只给单族名**，
  与 `--lake-font-family` 首族一致），并把这个旧值当"已知历史值"在打开文档时归一化（`withCellDefaults` 精确匹配替换）。
  **别再写成多族栈**（包括别把 `--lake-font-family` 整串搬进 `ff`）。

- **② DOM 外壳（工具栏/右键菜单/公式栏/工作表标签/单元格编辑框）**：内核 CSS
  （`@fortune-sheet/react/dist/index.css`）把字体栈**硬编码**在 `.fortune-container` 上
  （`"Helvetica Neue", Helvetica, Arial, "PingFang SC", …`），单元格编辑框 `.luckysheet-input-box(-inner)` 另用
  `font` 简写写死 arial。

- ⚠️ **覆盖它必须放"未分层"的 `features/sheet/sheetEditor.css`，不能放 `styles/fonts/font-overrides.css`**：
  前者由组件直接 `import` ⇒ **未分层**，与内核 CSS 同层，用 `.sheet-editor` 前缀提高特异性（0-2-0 > 0-1-0）取胜；
  后者是 `@import … layer(feature)`（已分层），而 **未分层 > 任何 @layer** ⇒ 分层那条永远压不过内核 CSS。
  规则：`.sheet-editor .fortune-container, .sheet-editor .luckysheet-input-box, .sheet-editor .luckysheet-input-box-inner { font-family: var(--lake-font-family) } `。
  产物核对（`dist/assets/SheetEditor-*.css`）：内核那条在前、我们这条在后且特异性更高。

- **护栏**：`sheetEditorMount.test.ts` 断 `GLOBAL_FONT === "MiSans"` + 旧值归一化 + 字体规则落在 `sheetEditor.css`；
  `styles/cssLayers.test.ts` 基线 `sheetEditor.css` 156 → 157（+1，理由写在基线处）。

### O.2 全量排查：除功能性字形外全部 MiSans（用户 261008「彻底检查一遍」）

- **方法**：抽出**真正被加载**的两个第三方样式（`@dlient/lakex-doc-react/dist/style.css`、`@fortune-sheet/react/dist/index.css`）
  里**所有** `font-family` 与 `font` 简写值（共 **44 种**），逐条定性；定性结果与「我们用哪条选择器接管」一起**入护栏**
  `src/styles/fonts/fontUnification.test.ts`（第三方新增未登记的栈、或我们删掉某条接管规则 ⇒ 直接红）。
- **分类口径**：
  · **special（故意不动）**：KaTeX_*（数学字形）、emoji 字体、`ne-heading-anchor` 的 `lake-icon`、`inherit`；
    以及**内核 JS 运行时写进 SVG 图标的字体**（`<text font-family="sans-serif">` 的 H2/H3 图标、`STYuanti-SC-Regular`、
    `LucidaGrande`、`SFMono-Semibold`）与**导图主题**的 root/node 字体（属内容样式、且是内联，CSS 改不动）。
  · **mono → `--lake-font-family-mono`（JetBrains Mono）**：`pre/code/kbd/samp`、`.CodeMirror`、`.cm-*`、
    阅读态代码正文 `ne-code-content`、公式输入 `textarea.ne-math-input`、导图代码编辑器 / 文本绘图对话框（ttd-*）。
  · **unified → `--lake-font-family`（MiSans）**：其余全部 —— antd 基底（`.ant-select-multiple`/`.ant-pagination*`/
    `.ant-statistic-content`/`.ant-steps-item-icon`/必填星号）、`.ne-block-context-menu`、`.ne-image-toolbar`、
    列表序号与大纲前缀（内核用 `Helvetica Neue, Consolas`）、`.mindmap-*` UI、`.text-to-diagram`、
    drawnix 未定义的 `var(--ui-font)` 那一族，以及 FortuneSheet 的 `.fortune-toolbar-subtext`（数字格式示例，内核写死 Arial）。
- **同时抓出我们自己的一处**：`styles/app/quick-notes.css` 的 `.quick-note-composer .quick-note-editor` 原写死
  `font: 450 14px/1.7 -apple-system, …` ⇒ 改 `var(--lake-font-family)`。护栏第二条用例**扫我们自己的 CSS**：
  除 `themes/`（令牌定义）、`fonts/`（@font-face）、`vendor/` 外，出现任何字体字面量即红。
- **有意例外（写在这里免得再排查一遍）**：`src/core/mdToHtml.ts` 的 `wrapHtmlPage` 是**导出到应用外**的独立 HTML，
  拿不到 MiSans/令牌 ⇒ 必须用系统栈（已在代码里注明）。
  同轮修掉它另一处真 bug：模板里 `code`/`blockquote` 原本引用 `var(--lake-radius-2xs)`/`var(--lake-border-strong)`/
  `var(--lake-text-2)` —— 独立页面没有这些定义 ⇒ 引用块竖线**直接消失**、次级色丢失。现改为 light 主题字面量
  （4px / `#d3d7de` / `#4e5969`），并在 `mdToHtml.test.ts` 加护栏：导出页**不得出现任何 `var(--`**。
- **真实端实测（261008，隔离实例 + CDP）**：37 个 mock 选择器在真实页面里**全部**取到 MiSans / JetBrains Mono；
  整页 DOM 扫描**只剩**上面那几处 SVG 图标字形；把产物 `dist/assets/SheetEditor-*.css` 注入后，
  `.fortune-container` / `.fortune-toolbar-subtext` / `.luckysheet-input-box(-inner)` / `.fortune-context-menu` /
  `.luckysheet-sheets-item` / `.fortune-stat-area` 等 14 项**全部 MiSans**。
## P. 2026-10-08 表格右键菜单：哪些 key 真会渲染 + 本轮精简口径

- **单元格右键（`cellContextMenu`）**：本版内核（`@fortune-sheet/react` 1.0.4）的渲染器**只处理 17 个名字**：
  `copy` / `paste` / `insert-row` / `insert-column` / `delete-row` / `delete-column` / `hide-row` / `hide-column` /
  `set-row-height` / `set-column-width` / `sort` / `orderAZ` / `orderZA` / `filter` / `link` / `image` / `clear`。
  ⇒ `delete-cell` / `chart` / `data` / `cell-format` **列了也不渲染**（内核默认清单里那个 `delete-cell` 就是死键）；
  我们另外用 `customToolbarItems` 提供 `cell-image`（插入图片）与 `auto-row-height`（自动行高）两个自定义键。
  判定依据 = dist 里 `name === "…"` 的全集 + 真实端右键实测（两者一致）。
- **`hide-row` / `hide-column` 各渲染两行**（`rightclick.hideSelected|showHide + rightclick.row|column` =
  「隐藏选中行 / 显示隐藏行」「隐藏选中列 / 显示隐藏列」）⇒ 要去掉那 4 行就删这两个 key（261008 用户第二轮要求；
  代价：隐藏/取消隐藏行列从此没有菜单入口，要用得走 `wb.hideRowOrColumn / showRowOrColumn`）。
- **工作表标签右键（`sheetTabContextMenu`）**：内核默认 `["delete","copy","rename","color","hide","|","move"]`；
  去掉 `move`（渲染成「向左移 / 向右移」两行）时**末位 `"|"` 要一起删**，否则菜单尾部留一条分隔线。
- **真实端验收姿势**（隔离实例 + CDP，`Runtime.evaluate` 里合成事件就够，不必真鼠标）：给 **`.fortune-cell-area`**
  与 **`.luckysheet-sheets-item`** dispatch 一个 `contextmenu` MouseEvent（带上 `clientX/clientY/pageX/pageY/button:2`），
  再读可见 `.fortune-context-menu` 的 `innerText`。两个坑：① 单元格菜单要打在 `.fortune-cell-area` 上（打
  `.fortune-sheet-overlay` 不出菜单）；② 菜单**不会自动关**，右击下一个目标前必须先用**真实**左键点一下别处
  （合成 `mousedown` 关不掉）——否则读到的是上一个菜单，会误判成「标签菜单没生效」。
- 实测结果（最终产物）：单元格右键 = 复制 / 粘贴 / 向上插入行 / 向下插入行 / 向左插入列 / 向右插入列 / 自动行高 /
  清除内容 / 插入图片；工作表标签右键 = 删除 / 复制 / 重命名 / 更改颜色 / 隐藏。
## Q. 2026-10-08 表格颜色入口：图标错乱 + 内核选色盘不可用（改成宿主自绘 + 公共选色盘）

- **用户报的两件事**：① 工具栏「文字颜色 / 背景颜色」**选完颜色展示错乱**；② 工作表标签右键「更改颜色」的选色盘**点不动**。
- **①的真因（两层色条）**：内核这两个按钮的画法是 —— 图标（sprite `<symbol>`）+ **另一个硬编码的色条 div**
  （inline style：17×2、`bottom:8`、`left:9`、背景 = `globalCache.recentTextColor/BackgroundColor`）。
  而 261008 我们把图标换成**云端 lakex 字形**后，云端字形**自己就带一条色条**（`font-color` 的第 1 条 path；
  `background` 的第 3 条 path），且云端那条写死 `#F5222D` ⇒ 选完颜色就看到**红条 + 主题色条叠着、位置还错位**。
- **②的真因**：内核 `ChangeColor` 面板（`#fortune-change-color`）在 `.fortune-context-menu`（`overflow-y:auto`）里按
  `bottom:-110px; left:197px` 绝对定位 ⇒ 大片落在菜单可视区外/被裁，点不到；且它走 `context.currentSheetId`，
  右键非当前表时还会改错表。
- **修法（不放内核 UI，全走宿主自己的按钮 + 公共选色盘）**：
  · `TOOLBAR_ITEMS` 把 `font-color`/`background` 换成 `lake-text-color`/`lake-bg-color` —— 这两个 key 内核不认，
    但 `getToolbarItem` 末尾有 `customToolbarItems.find(n => n.key === name)` **原位兜底** ⇒ 位置不变、UI 全归我们。
  · 图标 = `src/features/sheet/sheetColorIcons.tsx`（**由 `scripts/sheet-icons.cloud.json` 生成**，与内核 sprite 同源）：
    字形 `currentColor`、色条 `fill={color}`（未着色 = none）⇒ 只剩一条色条，且跟着焦点格颜色走。
  · 上色走内核公开 API `wb.setCellFormatByRange("fc"|"bg", color, range)`（一次调用一条历史；`null` = 恢复默认）。
  · 标签颜色：补丁给 `generateAPIs` 加了 `setSheetColor(color, sheetId?)`，并把标签菜单的 `color` 分支改成
    **有 `settings.hooks.onSheetTabColor` 就只回调宿主**（内核那套 `ChangeColor` 面板被旁路，条目/箭头不变）。
  · 三处颜色入口共用 `components/ColorPalette`（**261008 从 `features/bitable/bitableCells.tsx` 连同它的 `Popover`
    与原语一起移出**，bitableCells 继续 re-export ⇒ 多维表调用点零改动），最近使用按入口分桶：
    `sheet-text-color` / `sheet-bg-color` / `sheet-tab-color`。
- **内核事实（顺手记下，别再踩）**：
  · `core.api.setCellFormat` **对空行直接 return**（`if (targetSheetData[row] == null) return;`）⇒ 空表上选颜色是 no-op，
    这与内核自己的按钮行为一致，不是我们没接上；验证时要先往格子里写点内容。
  · 内核自带 `palette`（toolbar ColorPicker）**色值是坏的**（`#f00f00`/`#f90f90`/`#0f00f0`…）—— 我们不再渲染它。
- ⚠️ **右键菜单开出来的浮层必须用「坐标锚点」**：菜单项在内核 `close()` 之后**会卸载** ⇒ 把元素当锚点存下来，等浮层渲染时它已是游离
  节点（`getBoundingClientRect()` 全 0）⇒ 选色盘跑到**左上角**（用户 261008 报）。口径：在**点击那一刻**量好 `{x, y}`，走
  `ColorPalette` 的 `at` 透传给 `usePopoverPosition`（`at` 优先，且自带「下方放不下翻上方 + 夹进视口」——标签在窗口底部时会自动翻到上方）。

- **实测（隔离实例 + CDP）**：工具栏出现 `data-tips="文字颜色/背景颜色"` 的自绘按钮、内核旧颜色图标（`#font-color`/`#background`）
  在工具栏里为 0；点开是公共选色盘（71 个格子 + 最近使用 + 更多颜色）；选红后图标色条 = `#F5222D`，正文里写入 `{fc:"#F5222D"}`；
  标签右键「更改颜色」打开同一选色盘，选绿后正文 `sheets[0].color = #389E0D`。
